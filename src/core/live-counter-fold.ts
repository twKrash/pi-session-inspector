import type { IntegrationKey } from "./events.ts";

export const MAX_SKILL_KEYS = 64;
export const MAX_COUNTER_KEYS = 16;
/** Upper bound shared by the fold, the checkpoint parser, and the reader. */
export const MAX_FOLDED_COUNT = 1_000_000_000;
/** Bounded skill-name grammar; shared by the fold table and the producer adapter. */
export const SKILL_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/;
const COUNTER_KEY_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const SKILL_SOURCE = "pi-input";
export type FoldedCounters = {
  counters: Partial<Record<IntegrationKey, Record<string, number>>>;
  skillInvocations: Record<string, number>;
  otherInvocations: number;
  presence: { permission: boolean };
};

export function emptyFoldedCounters(): FoldedCounters {
  return {
    counters: {},
    skillInvocations: {},
    otherInvocations: 0,
    presence: { permission: false },
  };
}

/**
 * Adds two counter buckets; presence is a logical OR, every count is an integer
 * sum. The binding caps are re-applied here so every caller inherits them:
 * base keys are kept first, then delta keys are considered in sorted order.
 * A skill key that would exceed `MAX_SKILL_KEYS` is not tracked, but its whole
 * count is added to `otherInvocations` (exactness), matching the fold rule; a
 * counter key that would exceed `MAX_COUNTER_KEYS` per integration is dropped.
 */
export function mergeFoldedCounters(
  base: FoldedCounters | undefined,
  delta: FoldedCounters,
): FoldedCounters {
  const merged =
    base === undefined ? emptyFoldedCounters() : cloneFoldedCounters(base);
  merged.otherInvocations += delta.otherInvocations;
  merged.presence = {
    permission: merged.presence.permission || delta.presence.permission,
  };
  for (const name of Object.keys(delta.skillInvocations).sort()) {
    const count = delta.skillInvocations[name] ?? 0;
    if (merged.skillInvocations[name] !== undefined) {
      merged.skillInvocations[name] += count;
      continue;
    }
    if (Object.keys(merged.skillInvocations).length >= MAX_SKILL_KEYS) {
      // Not tracked, but the invocations are still counted exactly.
      merged.otherInvocations += count;
      continue;
    }
    merged.skillInvocations[name] = count;
  }
  for (const integration of Object.keys(
    delta.counters,
  ).sort() as IntegrationKey[]) {
    const deltaCounters = delta.counters[integration] ?? {};
    const target = merged.counters[integration] ?? {};
    merged.counters[integration] = target;
    for (const key of Object.keys(deltaCounters).sort()) {
      const count = deltaCounters[key] ?? 0;
      if (target[key] !== undefined) {
        target[key] += count;
        continue;
      }
      if (Object.keys(target).length >= MAX_COUNTER_KEYS) continue;
      target[key] = count;
    }
  }
  return merged;
}

/**
 * Reader-side view of persisted checkpoint counter aggregates. Checkpoint
 * parsing already rejects invalid state, but this reader re-validates so a
 * caller holding partially typed aggregates can never inject a name or an
 * unsafe number: invalid entries are dropped, never repaired or coerced.
 */
export type CheckpointCounterAggregates = {
  integrationCounters?: Record<string, Record<string, number>>;
  skillInvocations?: Record<string, number>;
  skillOverflowInvocations?: number;
  presence?: { permission?: boolean };
};

/**
 * Reconstructs the already-folded bucket from persisted checkpoint aggregates
 * so maintenance adds only the post-cursor delta and repeated passes stay
 * idempotent. Absent fields mean "not folded", never zero.
 */
export function foldedFromCheckpointAggregates(
  aggregates: CheckpointCounterAggregates | undefined,
): FoldedCounters {
  const folded = emptyFoldedCounters();
  if (aggregates === undefined) return folded;

  if (isSafeCount(aggregates.skillOverflowInvocations)) {
    folded.otherInvocations = aggregates.skillOverflowInvocations;
  }

  const skills = aggregates.skillInvocations;
  if (isRecord(skills)) {
    for (const name of Object.keys(skills).sort()) {
      const count = skills[name];
      if (!SKILL_NAME_PATTERN.test(name) || !isSafeCount(count)) continue;
      if (Object.keys(folded.skillInvocations).length >= MAX_SKILL_KEYS)
        continue;
      folded.skillInvocations[name] = count;
    }
  }

  const counters = aggregates.integrationCounters;
  if (isRecord(counters)) {
    const parsed: [string, Record<string, number>][] = [];
    for (const integration of Object.keys(counters).sort()) {
      const entries = counters[integration];
      if (!COUNTER_KEY_PATTERN.test(integration) || !isRecord(entries))
        continue;
      const keys = Object.keys(entries);
      if (keys.length > MAX_COUNTER_KEYS) continue;
      const countersForIntegration: [string, number][] = [];
      for (const key of keys.sort()) {
        const count = entries[key];
        if (!COUNTER_KEY_PATTERN.test(key) || !isSafeCount(count)) continue;
        countersForIntegration.push([key, count]);
      }
      if (countersForIntegration.length > 0)
        parsed.push([integration, Object.fromEntries(countersForIntegration)]);
    }
    if (parsed.length > 0) {
      folded.counters = Object.fromEntries(
        parsed,
      ) as FoldedCounters["counters"];
    }
  }

  folded.presence = { permission: aggregates.presence?.permission === true };
  return folded;
}

/**
 * Folds only telemetry strictly after each writer's checkpoint cursor, so a
 * caller that replays records from a checkpoint can never re-add folded facts.
 */
export function counterDeltaAfterCursors(
  records: readonly {
    writerId: string;
    writerSequence: number;
    telemetry?: Record<string, unknown>;
  }[],
  cursors: Readonly<Record<string, number>>,
): FoldedCounters {
  return foldTelemetryCounters(
    records.flatMap((record) => {
      const cursor = cursors[record.writerId];
      const afterCursor =
        cursor === undefined || record.writerSequence > cursor;
      return afterCursor && record.telemetry !== undefined
        ? [record.telemetry]
        : [];
    }),
  );
}

export function foldTelemetryCounters(
  envelopes: readonly unknown[],
  initial: FoldedCounters = emptyFoldedCounters(),
): FoldedCounters {
  const folded = cloneFoldedCounters(initial);
  for (const envelope of envelopes) addEnvelope(folded, envelope);
  return folded;
}

function cloneFoldedCounters(source: FoldedCounters): FoldedCounters {
  return {
    counters: Object.fromEntries(
      Object.entries(source.counters).map(([key, value]) => [
        key,
        { ...(value ?? {}) },
      ]),
    ) as FoldedCounters["counters"],
    skillInvocations: { ...source.skillInvocations },
    otherInvocations: source.otherInvocations,
    presence: { permission: source.presence.permission },
  };
}

function addEnvelope(folded: FoldedCounters, input: unknown): void {
  if (!isRecord(input) || input.kind !== "counter" || input.value !== 1) return;
  const metric = input.metric;
  const dimensions = isRecord(input.dimensions) ? input.dimensions : undefined;
  if (metric === "permission.decision") {
    const result = dimensions?.result;
    const resolution = dimensions?.resolution;
    if (result !== "allow" && result !== "deny") return;
    if (typeof resolution !== "string") return;
    bump(folded, "permission", "decisions");
    bump(folded, "permission", result === "allow" ? "allowed" : "denied");
    if (resolution === "gate_error") bump(folded, "permission", "gateErrors");
    return;
  }
  if (metric === "permission.prompt") {
    const source = dimensions?.promptSource;
    if (
      source !== "tool_call" &&
      source !== "skill_input" &&
      source !== "skill_read"
    )
      return;
    bump(folded, "permission", "prompts");
    bump(
      folded,
      "permission",
      `prompt${source === "tool_call" ? "ToolCall" : source === "skill_input" ? "SkillInput" : "SkillRead"}`,
    );
    return;
  }
  if (metric === "permission.ready") {
    // Presence only: durable boolean, never an activity counter.
    folded.presence.permission = true;
    return;
  }
  if (input.source === SKILL_SOURCE && metric === "skill.invocation") {
    const skill = dimensions?.skill;
    if (typeof skill !== "string" || !SKILL_NAME_PATTERN.test(skill)) return;
    if (folded.skillInvocations[skill] !== undefined) {
      folded.skillInvocations[skill] = folded.skillInvocations[skill] + 1;
      return;
    }
    if (Object.keys(folded.skillInvocations).length >= MAX_SKILL_KEYS) {
      // The key is not tracked, but the invocation is still counted exactly.
      folded.otherInvocations += 1;
      return;
    }
    folded.skillInvocations[skill] = 1;
  }
}

function bump(
  folded: FoldedCounters,
  integration: IntegrationKey,
  key: string,
): void {
  const counters = folded.counters[integration] ?? {};
  folded.counters[integration] = counters;
  if (
    counters[key] === undefined &&
    Object.keys(counters).length >= MAX_COUNTER_KEYS
  )
    return;
  counters[key] = (counters[key] ?? 0) + 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSafeCount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_FOLDED_COUNT
  );
}

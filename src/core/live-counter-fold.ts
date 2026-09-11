import type { IntegrationKey } from "./events.ts";

export const MAX_SKILL_KEYS = 64;
export const MAX_COUNTER_KEYS = 16;
const SKILL_NAME = /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/;
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

/** Adds two counter buckets; presence is a logical OR, every count is an integer sum. */
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
  for (const [name, count] of Object.entries(delta.skillInvocations)) {
    merged.skillInvocations[name] =
      (merged.skillInvocations[name] ?? 0) + count;
  }
  for (const [integration, counters] of Object.entries(delta.counters) as Array<
    [IntegrationKey, Record<string, number>]
  >) {
    const target = merged.counters[integration] ?? {};
    merged.counters[integration] = target;
    for (const [key, count] of Object.entries(counters)) {
      target[key] = (target[key] ?? 0) + count;
    }
  }
  return merged;
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
    if (typeof skill !== "string" || !SKILL_NAME.test(skill)) return;
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

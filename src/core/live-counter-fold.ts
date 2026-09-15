import type { AppliedTelemetryFold } from "../integrations/contract.ts";
import { integrations } from "../integrations/index.ts";
import type { Integration } from "../integrations/contract.ts";
import type { IntegrationKey } from "../integrations/index.ts";
import {
  emptyPresence,
  type PresenceMap,
  mergePresence,
  presenceFromCheckpointV1,
} from "./presence.ts";

/** The one source label the generic skill producer publishes under. */
const SKILL_SOURCE = "pi-input";

export const MAX_SKILL_KEYS = 64;
export const MAX_COUNTER_KEYS = 16;
/** Upper bound shared by the fold, the checkpoint parser, and the reader. */
export const MAX_FOLDED_COUNT = 1_000_000_000;
/** Bounded skill-name grammar; shared by the fold table and the producer adapter. */
export const SKILL_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/;
const COUNTER_KEY_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
export type FoldedCounters = {
  counters: Partial<Record<IntegrationKey, Record<string, number>>>;
  skillInvocations: Record<string, number>;
  otherInvocations: number;
  /**
   * Durable presence sightings, keyed by integration. The map is generic: the
   * fold applies whatever key the registry's telemetry fold reports, and the
   * checkpoint v1 shape is mapped at its own compatibility boundary
   * (`core/presence.ts`).
   */
  presence: PresenceMap;
};

export function emptyFoldedCounters(): FoldedCounters {
  return {
    counters: {},
    skillInvocations: {},
    otherInvocations: 0,
    presence: emptyPresence(),
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
  merged.presence = mergePresence(merged.presence, delta.presence);
  for (const name of Object.keys(delta.skillInvocations).sort()) {
    const count = delta.skillInvocations[name] ?? 0;
    // Own-key check: `constructor`/`toString` are legal skill names, and an
    // inherited prototype member would make the count a string concatenation
    // instead of an integer addition (R45).
    if (Object.hasOwn(merged.skillInvocations, name)) {
      merged.skillInvocations[name] =
        (merged.skillInvocations[name] ?? 0) + count;
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
      // Own-key read for counter keys, defensive for a caller-supplied delta
      // map: a plain read would concatenate onto an inherited prototype member
      // (`constructor`) instead of adding an integer. No current caller
      // demonstrates that route — a foreign checkpoint's `Object.fromEntries`
      // already produces own keys, and `bump()` writes only hardcoded counter
      // names (P2-4) — so this guards the exported merge API, not an observed
      // production path.
      if (Object.hasOwn(target, key)) {
        target[key] = (target[key] ?? 0) + count;
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

  // The checkpoint's frozen v1 shape becomes the generic presence map here.
  folded.presence = presenceFromCheckpointV1(aggregates.presence);
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
      // Own-key read: a plain object answers an absent cursor for a writer
      // named `__proto__`/`constructor` with an inherited prototype member,
      // silently excluding that writer's retained telemetry (an undercount).
      const cursor = Object.hasOwn(cursors, record.writerId)
        ? cursors[record.writerId]
        : undefined;
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

/**
 * The telemetry subsystem's iteration: ask each declared integration with a
 * `telemetry` hook, stamp the key it applied, and apply the result generically.
 * One failing integration yields no counters rather than a partial fold and
 * never blocks another.
 */
export function applyIntegrationTelemetry(
  folded: FoldedCounters,
  envelope: unknown,
  list: readonly Integration[] = integrations,
): boolean {
  for (const integration of list) {
    if (integration.legacyOnly === true) continue;
    const hook = integration.hooks?.telemetry;
    if (hook === undefined) continue;
    try {
      const value = hook(envelope);
      if (value !== undefined) {
        applyTelemetryFold(folded, { integration: integration.key, ...value });
        return true;
      }
    } catch {
      // One failing integration never blocks another.
    }
  }
  return false;
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
    presence: { ...source.presence },
  };
}

/**
 * Applies one registry-produced telemetry fold: counters are added under the
 * key the registry reported (never a hardcoded integration), and a presence
 * sighting is recorded for that same key.
 */
function applyTelemetryFold(
  folded: FoldedCounters,
  applied: AppliedTelemetryFold,
): void {
  if (applied.presence === true) folded.presence[applied.integration] = true;
  for (const [key, count] of Object.entries(applied.counters ?? {}).sort()) {
    bump(folded, applied.integration as IntegrationKey, key, count);
  }
}

function addEnvelope(folded: FoldedCounters, input: unknown): void {
  if (!isRecord(input) || input.kind !== "counter" || input.value !== 1) return;

  // Integration telemetry is translated by the integration that owns it; the
  // telemetry subsystem stamps the key it applied, so the fold itself owns no
  // integration vocabulary.
  if (applyIntegrationTelemetry(folded, input)) return;

  const dimensions = isRecord(input.dimensions) ? input.dimensions : undefined;
  if (input.source === SKILL_SOURCE && input.metric === "skill.invocation") {
    const skill = dimensions?.skill;
    if (typeof skill !== "string" || !SKILL_NAME_PATTERN.test(skill)) return;
    // Own-key check (R45): a skill named after a prototype member must start
    // at an integer 1, not append to the inherited function's string form.
    if (Object.hasOwn(folded.skillInvocations, skill)) {
      folded.skillInvocations[skill] =
        (folded.skillInvocations[skill] ?? 0) + 1;
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
  amount = 1,
): void {
  const counters = folded.counters[integration] ?? {};
  folded.counters[integration] = counters;
  if (
    counters[key] === undefined &&
    Object.keys(counters).length >= MAX_COUNTER_KEYS
  )
    return;
  counters[key] = (counters[key] ?? 0) + amount;
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

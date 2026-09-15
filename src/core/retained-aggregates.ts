import { findIntegration } from "../integrations/catalog.ts";
import type { IntegrationKey } from "../integrations/index.ts";
import { integrations } from "../integrations/index.ts";
import type {
  CheckpointEvidence,
  CheckpointResourceCounts,
} from "../storage/checkpoint.ts";
import type { TimeEvidence } from "./evidence.ts";
import {
  MAX_COUNTER_KEYS,
  MAX_FOLDED_COUNT,
  MAX_SKILL_KEYS,
  SKILL_NAME_PATTERN,
} from "./live-counter-fold.ts";

/** Counter-key grammar shared with the checkpoint parser and the live fold. */
const COUNTER_KEY_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
// Bounded ISO-8601 instant; the boundary never carries free-form text.
const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_TIMESTAMP_LENGTH = 35;

/**
 * Narrowing guard over the declared integration keys (report and legacy alike:
 * a historical aggregate may name either). Membership comes from the
 * declaration, never from a second list.
 */
export function isIntegrationKey(value: string): value is IntegrationKey {
  return findIntegration(integrations, value) !== undefined;
}

/**
 * One aggregate value that may be the only survivor of pruned detail. It is
 * always labelled `aggregate-only` and carries the exact fold/seal boundary so
 * a consumer can add retained atomic records strictly after it without ever
 * counting the folded prefix twice. It never gains an event time or a row.
 */
export type AggregateValue<T> = {
  value: T;
  state: "aggregate-only";
  boundary: {
    /** writerId -> inclusive fold cursor. */
    foldedThrough: Record<string, number>;
    /** writerId -> prune seal; detail past it no longer exists. */
    sealedThrough: Record<string, number>;
  };
};

/**
 * Checkpoint-surviving counters and counts (spec §11). `boundary.detail`
 * states what is still observable: `full` when no folded or pruned
 * contribution exists, `aggregate-only` when folded/pruned contributions
 * remain, and `expired` when no checkpoint (and therefore no boundary) is
 * available. Absent values mean "not observed"; they are never emitted as a
 * synthetic zero.
 */
export type CanonicalRetainedAggregates = {
  schemaVersion: 1;
  boundary: {
    detail: "full" | "aggregate-only" | "expired";
    foldedThrough: Record<string, number>;
    sealedThrough: Record<string, number>;
    checkpointedAt: TimeEvidence;
    detailExpiredBefore?: string;
  };
  integration?: Partial<
    Record<IntegrationKey, AggregateValue<Record<string, number>>>
  >;
  skillInvocations?: {
    named?: AggregateValue<Record<string, number>>;
    overflow?: AggregateValue<number>;
  };
  permissionPresence?: AggregateValue<true>;
  resources?: {
    counts: {
      commands?: number;
      skills?: number;
      resources?: number;
      toolSources?: number;
    };
    state: "observed" | "aggregate-only";
    observedAt: TimeEvidence;
  };
};

/**
 * Retained atomic evidence measured against the checkpoint boundary. Counts
 * here are the atomic suffix; the builder unions them once with the folded
 * prefix and never re-adds a record the fold already covers.
 */
export type RetainedAtomicEvidence = {
  /**
   * Bounded skill names of retained atomic skill-invocation records. Names the
   * folded prefix already carries keep the folded count (the folded value and
   * the retained records for that key are one evidence class, not two).
   */
  skillNames: readonly string[];
  /** Retained post-cursor atomic counter increments by integration. */
  counters: Record<string, Record<string, number>>;
  /** Durable OR of retained atomic permission-readiness events. */
  permissionPresence: boolean;
  /**
   * Last observed retained WAL sequence per writer. Present only when the
   * caller knows it; a cursor ahead of it without a matching seal is rejected.
   */
  lastSequence?: Record<string, number>;
};

/**
 * Structural view of the checkpoint fields that govern retained aggregates.
 * It accepts either a validated full `Checkpoint` or the exact subset a caller
 * holds (R5), so no caller is forced to fabricate `cursors.pi`.
 */
export type RetainedAggregateCheckpoint = {
  aggregates?: {
    integrationCounters?: Record<string, Record<string, number>>;
    skillInvocations?: Record<string, number>;
    skillOverflowInvocations?: number;
    presence?: { permission?: boolean };
    resourceCounts?: CheckpointResourceCounts;
  };
  cursors?: { pi?: unknown; wal?: Record<string, number> };
  sealedWal?: Record<string, number>;
  evidence?: CheckpointEvidence;
};

export type RetainedAggregatesInput = {
  sessionId: string;
  checkpoint?: RetainedAggregateCheckpoint;
  retained: RetainedAtomicEvidence;
};

/**
 * Reconciles checkpoint aggregates with retained atomic evidence under the
 * spec §14.1.1 supplementation contract. Everything is derived: no rows, no
 * timestamps, no synthetic events, and `unavailable` never becomes zero.
 * A boundary inconsistency throws instead of being repaired.
 */
export function buildRetainedAggregates(
  input: RetainedAggregatesInput,
): CanonicalRetainedAggregates {
  const { checkpoint, retained } = input;

  if (checkpoint === undefined) {
    // No boundary can be trusted, so no aggregate value is emitted at all.
    return {
      schemaVersion: 1,
      boundary: {
        detail: "expired",
        foldedThrough: {},
        sealedThrough: {},
        checkpointedAt: { state: "unavailable" },
      },
    };
  }

  const foldedThrough = cloneSequences(checkpoint.cursors?.wal);
  const sealedThrough = cloneSequences(checkpoint.sealedWal);
  assertBoundaryConsistent(foldedThrough, sealedThrough, retained.lastSequence);

  const boundary = {
    foldedThrough,
    sealedThrough,
    checkpointedAt: checkpointedAtEvidence(checkpoint.evidence),
    ...expirationBoundary(checkpoint.evidence),
  };

  if (!hasFoldedOrPrunedContribution(checkpoint.aggregates, sealedThrough)) {
    // Atomic detail is complete: there is no aggregate-only survivor.
    return {
      schemaVersion: 1,
      boundary: { detail: "full", ...boundary },
    };
  }

  const valueBoundary = { foldedThrough, sealedThrough };
  const integration = mergeIntegrationCounters(
    checkpoint.aggregates?.integrationCounters,
    retained.counters,
    valueBoundary,
  );
  const skillInvocations = buildSkillAggregates(
    checkpoint.aggregates?.skillInvocations,
    checkpoint.aggregates?.skillOverflowInvocations,
    retained.skillNames,
    valueBoundary,
  );
  const permissionPresence = buildPermissionPresence(
    checkpoint.aggregates?.presence,
    retained.permissionPresence,
    valueBoundary,
  );
  const resources = buildResourceCounts(checkpoint.aggregates?.resourceCounts);

  return {
    schemaVersion: 1,
    boundary: { detail: "aggregate-only", ...boundary },
    ...(Object.keys(integration).length === 0 ? {} : { integration }),
    ...(skillInvocations === undefined ? {} : { skillInvocations }),
    ...(permissionPresence === undefined ? {} : { permissionPresence }),
    ...(resources === undefined ? {} : { resources }),
  };
}

function hasFoldedOrPrunedContribution(
  aggregates: RetainedAggregateCheckpoint["aggregates"],
  sealedThrough: Record<string, number>,
): boolean {
  if (Object.keys(sealedThrough).length > 0) return true;
  if (aggregates === undefined) return false;
  if (Object.keys(aggregates.integrationCounters ?? {}).length > 0) return true;
  if (Object.keys(aggregates.skillInvocations ?? {}).length > 0) return true;
  if (isFoldCount(aggregates.skillOverflowInvocations)) return true;
  if (aggregates.presence?.permission === true) return true;
  if (aggregates.resourceCounts !== undefined) return true;
  return false;
}

/**
 * Rejects a cursor that claims more than the retained sequence for a writer
 * unless that writer's detail was pruned past the same point (a matching
 * seal). It never clamps, subtracts, or guesses a boundary.
 */
function assertBoundaryConsistent(
  foldedThrough: Record<string, number>,
  sealedThrough: Record<string, number>,
  lastSequence: Record<string, number> | undefined,
): void {
  for (const [writerId, sealed] of Object.entries(sealedThrough)) {
    const folded = foldedThrough[writerId];
    if (folded === undefined || sealed > folded) {
      throw new Error("retained aggregate boundary inconsistent");
    }
  }
  if (lastSequence === undefined) return;
  for (const [writerId, cursor] of Object.entries(foldedThrough)) {
    const observed = lastSequence[writerId];
    if (observed === undefined || cursor <= observed) continue;
    const sealed = sealedThrough[writerId];
    if (sealed === undefined || sealed < cursor) {
      throw new Error("retained aggregate boundary inconsistent");
    }
  }
}

function mergeIntegrationCounters(
  folded: Record<string, Record<string, number>> | undefined,
  retained: Record<string, Record<string, number>>,
  boundary: AggregateValue<unknown>["boundary"],
): Partial<Record<IntegrationKey, AggregateValue<Record<string, number>>>> {
  const merged: Partial<
    Record<IntegrationKey, AggregateValue<Record<string, number>>>
  > = {};

  if (isRecord(folded)) {
    for (const integration of Object.keys(folded).sort()) {
      if (!isIntegrationKey(integration)) continue;
      const counters = parseCounterMap(folded[integration]);
      if (counters !== undefined) {
        merged[integration as IntegrationKey] = {
          value: counters,
          state: "aggregate-only",
          boundary,
        };
      }
    }
  }

  if (isRecord(retained)) {
    for (const integration of Object.keys(retained).sort()) {
      if (!isIntegrationKey(integration)) continue;
      const counters = retained[integration];
      if (!isRecord(counters)) continue;
      const target =
        merged[integration as IntegrationKey]?.value ?? Object.create(null);
      for (const key of Object.keys(counters).sort()) {
        const count = counters[key];
        if (!COUNTER_KEY_PATTERN.test(key) || !isFoldCount(count)) continue;
        const base = target[key];
        if (base === undefined) {
          if (Object.keys(target).length >= MAX_COUNTER_KEYS) continue;
          target[key] = count;
          continue;
        }
        target[key] = addBounded(base, count);
      }
      if (Object.keys(target).length > 0) {
        merged[integration as IntegrationKey] = {
          value: target,
          state: "aggregate-only",
          boundary,
        };
      }
    }
  }

  return merged;
}

function parseCounterMap(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;
  const parsed: [string, number][] = [];
  for (const key of Object.keys(value).sort()) {
    const count = value[key];
    if (!COUNTER_KEY_PATTERN.test(key) || !isFoldCount(count)) continue;
    if (parsed.length >= MAX_COUNTER_KEYS) break;
    parsed.push([key, count]);
  }
  return parsed.length === 0 ? undefined : Object.fromEntries(parsed);
}

/**
 * Named skill counts come from the folded prefix plus retained names the fold
 * does not already carry; names absent from both are omitted rather than
 * reported as zero. Skill names that overflow the shared key cap are counted
 * exactly in `overflow`.
 */
function buildSkillAggregates(
  folded: Record<string, number> | undefined,
  foldedOverflow: number | undefined,
  retainedNames: readonly string[],
  boundary: AggregateValue<unknown>["boundary"],
): CanonicalRetainedAggregates["skillInvocations"] {
  const named: Record<string, number> = Object.create(null);
  const foldedNames = new Set<string>();

  if (isRecord(folded)) {
    for (const name of Object.keys(folded).sort()) {
      const count = folded[name];
      if (
        named[name] !== undefined ||
        Object.keys(named).length >= MAX_SKILL_KEYS
      )
        continue;
      if (!SKILL_NAME_PATTERN.test(name) || !isFoldCount(count)) continue;
      named[name] = count;
      foldedNames.add(name);
    }
  }

  let overflow = isFoldCount(foldedOverflow) ? foldedOverflow : undefined;
  if (Array.isArray(retainedNames)) {
    for (const name of retainedNames) {
      if (typeof name !== "string" || !SKILL_NAME_PATTERN.test(name)) continue;
      if (foldedNames.has(name)) continue;
      const current = named[name];
      if (current === undefined) {
        if (Object.keys(named).length >= MAX_SKILL_KEYS) {
          overflow = addBounded(overflow ?? 0, 1);
          continue;
        }
        named[name] = 1;
        continue;
      }
      named[name] = addBounded(current, 1);
    }
  }

  if (Object.keys(named).length === 0 && overflow === undefined)
    return undefined;

  return {
    ...(Object.keys(named).length === 0
      ? {}
      : { named: { value: named, state: "aggregate-only", boundary } }),
    ...(overflow === undefined
      ? {}
      : {
          overflow: { value: overflow, state: "aggregate-only", boundary },
        }),
  };
}

function buildPermissionPresence(
  folded: { permission?: boolean } | undefined,
  retained: boolean,
  boundary: AggregateValue<unknown>["boundary"],
): AggregateValue<true> | undefined {
  if (folded?.permission !== true && retained !== true) return undefined;
  return { value: true, state: "aggregate-only", boundary };
}

function buildResourceCounts(
  resourceCounts: CheckpointResourceCounts | undefined,
): CanonicalRetainedAggregates["resources"] | undefined {
  if (!isRecord(resourceCounts)) return undefined;
  const commands = resourceCounts.commands;
  const skills = resourceCounts.skills;
  if (!isFoldCount(commands) || !isFoldCount(skills)) return undefined;
  const resources = resourceCounts.resources;
  const toolSources = resourceCounts.toolSources;
  const observedAt = resourceCounts.observedAt;
  return {
    counts: {
      commands,
      skills,
      ...(isFoldCount(resources) ? { resources } : {}),
      ...(isFoldCount(toolSources) ? { toolSources } : {}),
    },
    state: "aggregate-only",
    observedAt: isBoundedTimestamp(observedAt)
      ? { state: "known", at: observedAt, basis: "inventory-observer" }
      : { state: "unavailable" },
  };
}

function checkpointedAtEvidence(
  evidence: CheckpointEvidence | undefined,
): TimeEvidence {
  const at = evidence?.checkpointedAt;
  return isBoundedTimestamp(at)
    ? { state: "known", at, basis: "checkpoint-observer" }
    : { state: "unavailable" };
}

function expirationBoundary(evidence: CheckpointEvidence | undefined): {
  detailExpiredBefore?: string;
} {
  const expiredBefore = evidence?.detailCoverage?.walDetailExpiredBefore;
  return isBoundedTimestamp(expiredBefore)
    ? { detailExpiredBefore: expiredBefore }
    : {};
}

/**
 * Copies only safe, bounded writer cursors. A malformed cursor cannot be
 * silently rounded to zero, because that would move the exact boundary.
 */
function cloneSequences(
  value: Record<string, number> | undefined,
): Record<string, number> {
  // Null prototype: a legal `__proto__` writer id must survive the copy rather
  // than being swallowed by the inherited setter.
  const copy: Record<string, number> = Object.create(null);
  if (!isRecord(value)) return copy;
  for (const [writerId, cursor] of Object.entries(value)) {
    if (
      typeof writerId !== "string" ||
      writerId.length === 0 ||
      !isCursor(cursor)
    ) {
      throw new Error("retained aggregate boundary inconsistent");
    }
    copy[writerId] = cursor;
  }
  return copy;
}

/** Bounded sum; an overflowing aggregate is rejected, never clamped. */
function addBounded(base: number, delta: number): number {
  const sum = base + delta;
  if (!Number.isSafeInteger(sum) || sum > MAX_FOLDED_COUNT) {
    throw new Error("retained aggregate count out of bounds");
  }
  return sum;
}

function isFoldCount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_FOLDED_COUNT
  );
}

function isCursor(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isBoundedTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_TIMESTAMP_LENGTH &&
    ISO_INSTANT.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

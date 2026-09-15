/**
 * In-memory presence map and the checkpoint v1 compatibility boundary.
 *
 * Presence is generic infrastructure state: a map from integration key to
 * "was observed". The live fold, the canonical session, and the report
 * projection all speak this shape, so no generic module names another
 * integration's signal.
 *
 * The persisted checkpoint, however, has a *frozen v1 shape* (`presence:
 * { permission?: boolean }`, ADR 0014) that older readers must keep
 * understanding. This module is the single place where that version meets the
 * generic map; a future checkpoint schema can widen it without touching the
 * fold, the canonical session, or the report.
 */

/** Integration key → observed. Absent or false means "not observed". */
export type PresenceMap = Record<string, boolean>;

/**
 * The one integration key the checkpoint v1 presence aggregate can carry. The
 * v1 schema named the permission integration explicitly instead of using the
 * generic map.
 */
export const CHECKPOINT_V1_PRESENCE_KEY = "permission";

export function emptyPresence(): PresenceMap {
  return {};
}

/** Every observed integration key, sorted for deterministic output. */
export function presenceKeys(
  presence: Readonly<PresenceMap> | undefined,
): readonly string[] {
  if (presence === undefined) return [];
  return Object.keys(presence)
    .filter((key) => presence[key] === true)
    .sort();
}

/** Logical OR per key; never a count. */
export function mergePresence(
  base: Readonly<PresenceMap> | undefined,
  delta: Readonly<PresenceMap> | undefined,
): PresenceMap {
  const merged: PresenceMap = { ...(base ?? {}) };
  for (const [key, seen] of Object.entries(delta ?? {})) {
    merged[key] = seen === true || merged[key] === true;
  }
  return merged;
}

/** Reads the frozen v1 aggregate into the generic map. */
export function presenceFromCheckpointV1(
  value: { permission?: boolean } | undefined,
): PresenceMap {
  return value?.[CHECKPOINT_V1_PRESENCE_KEY] === true
    ? { [CHECKPOINT_V1_PRESENCE_KEY]: true }
    : emptyPresence();
}

/**
 * Writes the generic map back as the frozen v1 aggregate. Returns `undefined`
 * when nothing v1 can represent is observed, so the persisted field is omitted
 * rather than written empty.
 */
export function presenceToCheckpointV1(
  presence: Readonly<PresenceMap> | undefined,
): { permission?: boolean } | undefined {
  return presence?.[CHECKPOINT_V1_PRESENCE_KEY] === true
    ? { [CHECKPOINT_V1_PRESENCE_KEY]: true }
    : undefined;
}

/** Whether the generic map observed the integration the v1 aggregate names. */
export function presenceAggregateObserved(
  presence: Readonly<PresenceMap> | undefined,
): boolean {
  return presence?.[CHECKPOINT_V1_PRESENCE_KEY] === true;
}

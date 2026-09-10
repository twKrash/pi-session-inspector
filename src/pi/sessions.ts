import type { Scope, SessionEntry } from "../core/events.ts";

const TRACKING_START_TYPE = "session-inspector:tracking-start";
const TRACKING_START_SCHEMA_VERSION = 1;

/** Selects entries after tracking began, preserving Pi's native tree positions. */
export function selectScope(
  entries: readonly SessionEntry[],
  leafId: string | null,
  scope: Scope,
): SessionEntry[] {
  const boundary = entries.findIndex(isTrackingStartMarker);
  const postBoundaryEntries =
    boundary === -1 ? entries : entries.slice(boundary + 1);

  if (scope === "tree") return [...postBoundaryEntries];
  if (leafId === null) return [];

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const postBoundarySet = new Set(postBoundaryEntries);
  const path: SessionEntry[] = [];
  const visited = new Set<string>();
  let next = byId.get(leafId);
  while (next && !visited.has(next.id)) {
    if (postBoundarySet.has(next)) path.push(next);
    visited.add(next.id);
    next = next.parentId === null ? undefined : byId.get(next.parentId);
  }
  return path.reverse();
}

export function hasTrackingStartMarker(
  entries: readonly SessionEntry[],
): boolean {
  return entries.some(isTrackingStartMarker);
}

function isTrackingStartMarker(entry: SessionEntry): boolean {
  return (
    entry.type === "custom" &&
    entry.customType === TRACKING_START_TYPE &&
    isRecord(entry.data) &&
    entry.data.schemaVersion === TRACKING_START_SCHEMA_VERSION
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

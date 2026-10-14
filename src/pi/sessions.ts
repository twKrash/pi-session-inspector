import type { Scope, SessionEntry } from "../core/events.ts";
import { buildGraphNodes } from "./graph.ts";
import { isTrackingMarkerRecord, resolveScope } from "./scope.ts";

/** Selects tracked entries in scope order, keeping the first record per native id. */
export function selectScope(
  entries: readonly SessionEntry[],
  leafId: string | null,
  scope: Scope,
): SessionEntry[] {
  const resolution = resolveScope(
    entries,
    buildGraphNodes(entries),
    leafId,
    scope,
  );
  if (resolution.state === "unavailable") return [];

  const byId = new Map<string, SessionEntry>();
  for (const entry of entries) {
    if (!byId.has(entry.id)) byId.set(entry.id, entry);
  }
  const selected: SessionEntry[] = [];
  for (const id of resolution.entryIds) {
    const entry = byId.get(id);
    if (entry !== undefined) selected.push(entry);
  }
  return selected;
}

export function hasTrackingStartMarker(
  entries: readonly SessionEntry[],
): boolean {
  return entries.some(isTrackingStartMarker);
}

function isTrackingStartMarker(entry: SessionEntry): boolean {
  return isTrackingMarkerRecord(entry);
}

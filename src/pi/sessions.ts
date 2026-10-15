import type { Scope, SessionEntry } from "../core/events.ts";
import { buildGraphNodes } from "./graph.ts";
import {
  isTrackingMarkerRecord,
  resolveScope,
  selectResolvedEntries,
} from "./scope.ts";

export { selectResolvedEntries };

/** Selects tracked entries in scope order, keeping the first post-marker record per native id. */
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
  return resolution.state === "unavailable"
    ? []
    : selectResolvedEntries(entries, resolution.entryIds);
}

export function hasTrackingStartMarker(
  entries: readonly SessionEntry[],
): boolean {
  return entries.some(isTrackingStartMarker);
}

function isTrackingStartMarker(entry: SessionEntry): boolean {
  return isTrackingMarkerRecord(entry);
}

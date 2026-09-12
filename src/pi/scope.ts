import type { Scope } from "../core/events.ts";
import type { PiGraphNode } from "./graph.ts";

const TRACKING_START_TYPE = "session-inspector:tracking-start";
const TRACKING_START_SCHEMA_VERSION = 1;

export type ScopeResolution =
  | {
      state: "available";
      entryIds: string[];
      markerEntryId: string;
      duplicateMarkers: number;
    }
  | {
      state: "unavailable";
      reason: "tracking-marker-missing" | "active-leaf-unavailable";
    };

/** The single tracking-marker rule; every boundary check delegates here. */
export function isTrackingMarkerRecord(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    value.type === "custom" &&
    value.customType === TRACKING_START_TYPE &&
    isRecord(value.data) &&
    value.data.schemaVersion === TRACKING_START_SCHEMA_VERSION
  );
}

/**
 * Resolves the tracked scope boundary over the full structural graph. The
 * earliest valid marker record wins; every later match is counted, never
 * treated as a new boundary. Scope is unavailable without a marker, so no
 * caller can silently fall back to "all entries".
 */
export function resolveScope(
  records: readonly Record<string, unknown>[],
  nodes: readonly PiGraphNode[],
  leafId: string | null,
  scope: Scope,
): ScopeResolution {
  const markerIndex = records.findIndex(isTrackingMarkerRecord);
  if (markerIndex === -1) {
    return { state: "unavailable", reason: "tracking-marker-missing" };
  }
  const markerRecord = records[markerIndex] as Record<string, unknown>;
  const markerEntryId =
    typeof markerRecord.id === "string" ? markerRecord.id : "";
  const duplicateMarkers = records
    .slice(markerIndex + 1)
    .filter(isTrackingMarkerRecord).length;
  const preMarkerIds = new Set<string>();
  for (const record of records.slice(0, markerIndex + 1)) {
    if (typeof record.id === "string") preMarkerIds.add(record.id);
  }

  const postMarkerNodes = nodes.filter(
    (node) => !preMarkerIds.has(node.entryId),
  );

  if (scope === "tree") {
    return {
      state: "available",
      entryIds: postMarkerNodes.map((node) => node.entryId),
      markerEntryId,
      duplicateMarkers,
    };
  }

  const nodeById = new Map(nodes.map((node) => [node.entryId, node]));
  const leaf = leafId === null ? undefined : nodeById.get(leafId);
  if (leaf === undefined) {
    return { state: "unavailable", reason: "active-leaf-unavailable" };
  }

  const postMarkerSet = new Set(postMarkerNodes.map((node) => node.entryId));
  const path: string[] = [];
  const visited = new Set<string>();
  let next: PiGraphNode | undefined = leaf;
  while (next !== undefined && !visited.has(next.entryId)) {
    visited.add(next.entryId);
    if (postMarkerSet.has(next.entryId)) path.push(next.entryId);
    next = next.parentId === null ? undefined : nodeById.get(next.parentId);
  }
  path.reverse();

  return {
    state: "available",
    entryIds: path,
    markerEntryId,
    duplicateMarkers,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

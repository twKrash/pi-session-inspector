import type { Scope } from "../core/events.ts";
import { MAX_ID_BYTES, type PiGraphNode } from "./graph.ts";

const TRACKING_START_TYPE = "session-inspector:tracking-start";
const TRACKING_START_SCHEMA_VERSION = 1;
const encoder = new TextEncoder();

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
  // The boundary is the marker node's append ordinal, never an id set derived
  // from a records list that may differ from the list that produced the nodes
  // (controller ruling R16). A marker whose id is not a bounded string, or
  // whose id has no node, cannot anchor a boundary and is unavailable.
  const markerEntryId = boundedMarkerId(markerRecord.id);
  const markerNode =
    markerEntryId === undefined
      ? undefined
      : nodes.find((node) => node.entryId === markerEntryId);
  if (markerEntryId === undefined || markerNode === undefined) {
    return { state: "unavailable", reason: "tracking-marker-missing" };
  }
  const duplicateMarkers = records
    .slice(markerIndex + 1)
    .filter(isTrackingMarkerRecord).length;

  const postMarkerNodes = nodes.filter(
    (node) => node.appendOrdinal > markerNode.appendOrdinal,
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

/** The marker id is usable only when it is a non-empty id bounded like a node id. */
function boundedMarkerId(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    encoder.encode(value).byteLength <= MAX_ID_BYTES
    ? value
    : undefined;
}

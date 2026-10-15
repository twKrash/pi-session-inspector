import type { Scope, SessionEntry } from "../core/events.ts";
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

/** Selects resolved IDs from the first matching post-marker records. */
export function selectResolvedEntries(
  entries: readonly SessionEntry[],
  entryIds: readonly string[],
): SessionEntry[] {
  const markerIndex = entries.findIndex(isTrackingMarkerRecord);
  if (markerIndex === -1) return [];

  const byId = new Map<string, SessionEntry>();
  for (const entry of entries.slice(markerIndex + 1)) {
    if (!byId.has(entry.id)) byId.set(entry.id, entry);
  }
  const selected: SessionEntry[] = [];
  const seenIds = new Set<string>();
  for (const id of entryIds) {
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    const entry = byId.get(id);
    if (entry !== undefined) selected.push(entry);
  }
  return selected;
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
    // A duplicated native id still owns one logical row. Keep the first node
    // in append/scope order, matching L1's first-win entry ownership.
    const seenIds = new Set<string>();
    const entryIds = postMarkerNodes.flatMap((node) => {
      if (seenIds.has(node.entryId)) return [];
      seenIds.add(node.entryId);
      return [node.entryId];
    });
    return {
      state: "available",
      entryIds,
      markerEntryId,
      duplicateMarkers,
    };
  }

  // Resolve tracked ancestry first, then use unambiguous pre-marker nodes only
  // as structural sentinels. Pre-marker facts never replace tracked nodes.
  const nodeById = new Map<string, PiGraphNode>();
  const duplicateIds = new Set<string>();
  for (const node of [markerNode, ...postMarkerNodes]) {
    if (nodeById.has(node.entryId)) duplicateIds.add(node.entryId);
    else nodeById.set(node.entryId, node);
  }
  const preMarkerNodeById = new Map<string, PiGraphNode>();
  const duplicatePreMarkerIds = new Set<string>();
  for (const node of nodes) {
    if (node.appendOrdinal > markerNode.appendOrdinal) continue;
    if (preMarkerNodeById.has(node.entryId)) {
      duplicatePreMarkerIds.add(node.entryId);
    } else {
      preMarkerNodeById.set(node.entryId, node);
    }
    if (!nodeById.has(node.entryId)) nodeById.set(node.entryId, node);
  }
  const leaf = leafId === null ? undefined : nodeById.get(leafId);
  const postMarkerSet = new Set(postMarkerNodes.map((node) => node.entryId));
  if (
    leaf === undefined ||
    duplicateIds.has(leaf.entryId) ||
    !postMarkerSet.has(leaf.entryId)
  ) {
    return { state: "unavailable", reason: "active-leaf-unavailable" };
  }

  const path: string[] = [];
  const visited = new Set<PiGraphNode>();
  let next: PiGraphNode | undefined = leaf;
  while (next !== undefined) {
    // A repeated node, duplicate id, or missing parent cannot prove active
    // ancestry (§8.2). Unknown semantic *types* still have nodes and therefore
    // remain valid structure (R18).
    if (
      visited.has(next) ||
      duplicateIds.has(next.entryId) ||
      (next.appendOrdinal < markerNode.appendOrdinal &&
        duplicatePreMarkerIds.has(next.entryId))
    ) {
      return { state: "unavailable", reason: "active-leaf-unavailable" };
    }
    visited.add(next);
    if (next.appendOrdinal > markerNode.appendOrdinal) {
      path.push(next.entryId);
    }
    if (next.parentId === null) break;
    // A pre-marker node may refer to an earlier id reused later. Follow that
    // structural occurrence; otherwise allow forward references into scope.
    next =
      next.appendOrdinal <= markerNode.appendOrdinal
        ? (preMarkerNodeById.get(next.parentId) ?? nodeById.get(next.parentId))
        : nodeById.get(next.parentId);
    if (next === undefined) {
      return { state: "unavailable", reason: "active-leaf-unavailable" };
    }
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

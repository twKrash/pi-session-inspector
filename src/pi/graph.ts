export const MAX_ID_BYTES = 128;
const MAX_TYPE_BYTES = 64;
const MAX_TIMESTAMP_BYTES = 64;
const encoder = new TextEncoder();

/**
 * Pi v3 entry types with a semantic mapping in the adapter. Unknown raw type
 * text is never retained on a node, so this inventory is also the only way a
 * node can reach `semanticType.state: "known"`.
 */
export const KNOWN_PI_ENTRY_TYPES: ReadonlySet<string> = new Set([
  "message",
  "model_change",
  "thinking_level_change",
  "compaction",
  "branch_summary",
  "custom",
  "custom_message",
  "label",
  "session_info",
]);

export type PiGraphNode = {
  entryId: string;
  parentId: string | null;
  appendOrdinal: number;
  semanticType: { state: "known"; type: string } | { state: "unknown" };
  timestamp: string | undefined;
};

/**
 * Emits one node for every structurally valid entry record, in Pi append
 * order, keeping unknown-semantic entries as ordinary graph nodes with no
 * payload and no raw type text. Structurally invalid records emit no node.
 */
export function buildGraphNodes(
  values: readonly Record<string, unknown>[],
): PiGraphNode[] {
  const nodes: PiGraphNode[] = [];
  for (const value of values) {
    const entryId = value.id;
    const type = value.type;
    if (!isBoundedText(entryId, MAX_ID_BYTES)) continue;
    if (!isBoundedText(type, MAX_TYPE_BYTES)) continue;
    const parentId = value.parentId === undefined ? null : value.parentId;
    if (!isBoundedParentId(parentId)) continue;
    nodes.push({
      entryId,
      parentId,
      appendOrdinal: nodes.length,
      semanticType: KNOWN_PI_ENTRY_TYPES.has(type)
        ? { state: "known", type }
        : { state: "unknown" },
      timestamp: isBoundedText(value.timestamp, MAX_TIMESTAMP_BYTES)
        ? value.timestamp
        : undefined,
    });
  }
  return nodes;
}

function isBoundedText(value: unknown, maxBytes: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    encoder.encode(value).byteLength <= maxBytes
  );
}

function isBoundedParentId(value: unknown): value is string | null {
  return value === null || isBoundedText(value, MAX_ID_BYTES);
}

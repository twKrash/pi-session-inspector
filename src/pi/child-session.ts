import type {
  ChildSessionParent,
  ChildSessionProjection,
  SessionEntry,
  Usage,
} from "../core/events.ts";
import { secretLikeValue } from "../core/redact.ts";
import { addUsage, readUsage } from "../core/reduce.ts";
import type { ParsedSession } from "./adapter.ts";
import type { PiGraphNode } from "./graph.ts";

// ADR 0028: a child Pi session file explicitly referenced by a persisted
// pi-subagents notice. This module only projects an already-parsed file; the
// caller owns locator, path-safety, and run-identity checks.
const SUPPORTED_FORMAT_VERSION = 3;
const MAX_MODEL_LABEL_BYTES = 128;
const encoder = new TextEncoder();

/**
 * Returns `undefined` (unsupported) unless the file is a well-formed, linear
 * format-3 session that proves one dedicated execution. The header proves
 * parentage only, never the run id. A resumed child appends a user message to
 * the same file, so exactly one user message is required; a `context: "fork"`
 * child copies parent entries, so any shared entry id is rejected.
 * Compaction/branch-summary usage and forked trees have no unambiguous per-run
 * meaning either, so they fail closed.
 */
export function projectChildSession(
  parsed: ParsedSession,
  parent: ChildSessionParent,
): ChildSessionProjection | undefined {
  return isDedicatedExecution(parsed, parent)
    ? projectAssistants(parsed.entries)
    : undefined;
}

function isDedicatedExecution(
  parsed: ParsedSession,
  parent: ChildSessionParent,
): boolean {
  return (
    parsed.hasSessionHeader &&
    parsed.formatVersion === SUPPORTED_FORMAT_VERSION &&
    !parsed.hasMalformedJson &&
    parsed.parentSession === parent.sessionFile &&
    onlyUnknownTypesDropped(parsed) &&
    isSingleChain(parsed.graphNodes) &&
    !parsed.graphNodes.some((node) => parent.entryIds.has(node.entryId)) &&
    countUserMessages(parsed.entries) === 1
  );
}

function projectAssistants(
  entries: readonly SessionEntry[],
): ChildSessionProjection {
  const messages = [...assistantMessages(entries)];
  const { usage, usageCoverage } = projectUsage(messages);
  const model = singleModel(messages);
  return {
    ...(usage === undefined ? {} : { usage }),
    usageCoverage,
    ...(model === undefined ? {} : { model }),
    ...(messages.length === 0
      ? {}
      : {
          toolCalls: new Set(
            messages.flatMap((message) => toolCallIds(message.content)),
          ).size,
        }),
  };
}

function projectUsage(messages: readonly Record<string, unknown>[]): {
  usage?: Usage;
  usageCoverage: ChildSessionProjection["usageCoverage"];
} {
  let usage: Usage | undefined;
  let summed = 0;
  for (const message of messages) {
    const sum = sumUsage(usage, readUsage(message.usage));
    if (sum !== usage) {
      usage = sum;
      summed++;
    }
  }
  return {
    ...(usage === undefined ? {} : { usage }),
    usageCoverage:
      summed === 0
        ? "unavailable"
        : summed === messages.length
          ? "complete"
          : "partial",
  };
}

/** One bounded label only when every assistant message reports that same one. */
function singleModel(
  messages: readonly Record<string, unknown>[],
): string | undefined {
  const labels = new Set(messages.map((message) => modelLabel(message.model)));
  const [only] = labels;
  return labels.size === 1 ? only : undefined;
}

/** Returns `total` unchanged when `next` is missing or the sum leaves the bound. */
function sumUsage(total: Usage | undefined, next: Usage | undefined) {
  if (next === undefined) return total;
  // addUsage returns its left operand when the sum leaves the bounded range.
  return total === undefined ? next : addUsage(total, next);
}

function* assistantMessages(
  entries: readonly SessionEntry[],
): Generator<Record<string, unknown>> {
  for (const entry of entries) {
    if (
      entry.type === "message" &&
      isRecord(entry.message) &&
      entry.message.role === "assistant"
    ) {
      yield entry.message;
    }
  }
}

function countUserMessages(entries: readonly SessionEntry[]): number {
  let count = 0;
  for (const entry of entries) {
    if (
      entry.type === "message" &&
      isRecord(entry.message) &&
      entry.message.role === "user"
    ) {
      count++;
    }
  }
  return count;
}

type Links = { root?: string; childOf: ReadonlyMap<string, string> };

const SUMMARY_TYPES: ReadonlySet<string> = new Set([
  "compaction",
  "branch_summary",
]);

/**
 * The parser drops records it cannot use as entries. A well-formed record of an
 * extension-defined type is harmless and still takes part in the structural
 * checks through the graph; any other dropped record (a non-object line, a
 * non-string id, a missing field) could hide a root, a prompt, or a compaction,
 * so the file is not trusted.
 */
function onlyUnknownTypesDropped(parsed: ParsedSession): boolean {
  const unknownTypes = parsed.graphNodes.filter(
    (node) => node.semanticType.state === "unknown",
  ).length;
  return parsed.unknownEntryCount === unknownTypes;
}

/**
 * One connected chain over every well-formed record: exactly one root, no
 * branching, and a walk from the root that reaches each node once (so no
 * duplicate id, orphan, cycle, or second tree). Compaction and branch-summary
 * entries carry usage with no per-run meaning and are rejected.
 */
function isSingleChain(nodes: readonly PiGraphNode[]): boolean {
  const links = linkNodes(nodes);
  return links !== undefined && chainLength(links) === nodes.length;
}

function linkNodes(nodes: readonly PiGraphNode[]): Links | undefined {
  const childOf = new Map<string, string>();
  let root: string | undefined;
  for (const node of nodes) {
    if (isSummary(node)) return undefined;
    if (node.parentId === null) {
      if (root !== undefined) return undefined;
      root = node.entryId;
    } else if (childOf.has(node.parentId)) {
      return undefined;
    } else {
      childOf.set(node.parentId, node.entryId);
    }
  }
  return { root, childOf };
}

function isSummary({ semanticType }: PiGraphNode): boolean {
  return semanticType.state === "known" && SUMMARY_TYPES.has(semanticType.type);
}

/**
 * Distinct ids on the walk from the root. The walk stops at a revisit, which
 * only a duplicate id can cause, and a duplicate always leaves this below the
 * node count.
 */
function chainLength({ root, childOf }: Links): number {
  const seen = new Set<string>();
  for (let id = root; id !== undefined && !seen.has(id); id = childOf.get(id)) {
    seen.add(id);
  }
  return seen.size;
}

function modelLabel(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    encoder.encode(value).byteLength <= MAX_MODEL_LABEL_BYTES &&
    !secretLikeValue(value)
    ? value
    : undefined;
}

function toolCallIds(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((item) =>
    isRecord(item) && item.type === "toolCall" && typeof item.id === "string"
      ? [item.id]
      : [],
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

import type {
  ChildSessionParent,
  ChildSessionProjection,
  SessionEntry,
  Usage,
} from "../core/events.ts";
import { secretLikeValue } from "../core/redact.ts";
import { addUsage, readUsage } from "../core/reduce.ts";
import type { ParsedSession } from "./adapter.ts";

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
    isLinear(parsed.entries) &&
    !parsed.entries.some((entry) => parent.entryIds.has(entry.id)) &&
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

function isLinear(entries: readonly SessionEntry[]): boolean {
  const parents = new Set<string>();
  for (const entry of entries) {
    if (entry.type === "compaction" || entry.type === "branch_summary") {
      return false;
    }
    if (entry.parentId === null) continue;
    if (parents.has(entry.parentId)) return false;
    parents.add(entry.parentId);
  }
  return true;
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

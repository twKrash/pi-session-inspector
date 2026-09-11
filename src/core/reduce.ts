import type {
  Compaction,
  ErrorKind,
  ErrorRecord,
  Generation,
  ReducedSession,
  SessionEntry,
  Tool,
  Usage,
  UsageComposition,
} from "./events.ts";

const zeroUsage: Usage = { totalTokens: 0, cost: 0 };
const MAX_REPORT_LABEL_BYTES = 128;
const REDACTED = "[REDACTED]";
/** Token and cost fields stay inside the safe, finite aggregate range. */
const MAX_USAGE_VALUE = Number.MAX_SAFE_INTEGER;
// Explicit allowlist: only recognisably errored/aborted/truncated stop reasons
// become error records, so an unlisted term degrades to absent (PRD-08).
const STOP_REASON_ERROR_KINDS: Readonly<Record<string, ErrorKind>> = {
  error: "generation-error",
  aborted: "generation-aborted",
  length: "generation-length",
};
const OPTIONAL_TOKEN_FIELDS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
] as const;
const encoder = new TextEncoder();

export function reduceEntries(
  sessionId: string,
  entries: readonly SessionEntry[],
): ReducedSession {
  const generations: Generation[] = [];
  const tools: Tool[] = [];
  const compactions: Compaction[] = [];
  const errors: ErrorRecord[] = [];
  const toolsByCallId = new Map<string, Tool>();
  const statusResolvedToolCalls = new Set<string>();
  const usageCountedToolCalls = new Set<string>();
  let usage = { ...zeroUsage };
  const composition: UsageComposition = {
    generations: { ...zeroUsage },
    toolResults: { ...zeroUsage },
    compactions: { ...zeroUsage },
    branchSummaries: { ...zeroUsage },
  };

  for (const entry of entries) {
    if (entry.type === "message" && isRecord(entry.message)) {
      const message = entry.message;
      if (message.role === "assistant") {
        const generationUsage = readUsage(message.usage) ?? { ...zeroUsage };
        const generation = {
          id: `generation:${entry.id}`,
          timestamp: entry.timestamp,
          provider: reportLabel(message.provider, "unknown"),
          model: reportLabel(message.model, "unknown"),
          usage: generationUsage,
        };
        generations.push(generation);
        usage = addUsage(usage, generationUsage);
        composition.generations = addUsage(
          composition.generations,
          generationUsage,
        );
        const generationError = readGenerationError(message);
        if (generationError !== undefined) {
          errors.push({
            id: generation.id,
            timestamp: entry.timestamp,
            kind: generationError,
            confidence: "native",
          });
        }
        for (const call of toolCalls(message.content)) {
          const tool: Tool = {
            id: `tool:${call.id}`,
            timestamp: entry.timestamp,
            name: reportLabel(call.name, "unknown"),
            status: "interrupted",
          };
          tools.push(tool);
          toolsByCallId.set(call.id, tool);
        }
      } else if (message.role === "toolResult") {
        const callId =
          typeof message.toolCallId === "string" ? message.toolCallId : "";
        const tool = toolsByCallId.get(callId);
        // The first result wins status and error classification for a call id,
        // so a duplicate result never overwrites the resolved tool.
        if (tool !== undefined && !statusResolvedToolCalls.has(callId)) {
          statusResolvedToolCalls.add(callId);
          tool.status = message.isError === true ? "failed" : "succeeded";
          if (message.isError === true) {
            errors.push({
              id: tool.id,
              timestamp: entry.timestamp,
              kind: "tool-error",
              confidence: "native",
            });
          }
        }
        // Usage comes from the first result that observed it and is counted once
        // per call id, so a usage-less first result never discards a later
        // observed value and a duplicate never double counts.
        const resultUsage = readUsage(message.usage);
        if (
          tool !== undefined &&
          resultUsage !== undefined &&
          !usageCountedToolCalls.has(callId)
        ) {
          usageCountedToolCalls.add(callId);
          tool.usage = resultUsage;
          usage = addUsage(usage, resultUsage);
          composition.toolResults = addUsage(
            composition.toolResults,
            resultUsage,
          );
        }
      }
    }
    if (entry.type === "compaction" || entry.type === "branch_summary") {
      const compactionUsage = readUsage(entry.usage) ?? { ...zeroUsage };
      compactions.push({
        id: `compaction:${entry.id}`,
        timestamp: entry.timestamp,
        kind: entry.type === "branch_summary" ? "branch_summary" : "compaction",
        usage: compactionUsage,
      });
      usage = addUsage(usage, compactionUsage);
      // Branch summaries stay in `compactions` for ledger/count consumers, but
      // the composition keeps their usage distinct from compaction usage.
      if (entry.type === "branch_summary") {
        composition.branchSummaries = addUsage(
          composition.branchSummaries,
          compactionUsage,
        );
      } else {
        composition.compactions = addUsage(
          composition.compactions,
          compactionUsage,
        );
      }
    }
  }

  return {
    sessionId,
    usage,
    usageComposition: composition,
    generations,
    tools,
    compactions,
    errors,
  };
}

function readGenerationError(
  message: Record<string, unknown>,
): ErrorKind | undefined {
  const stopReason = message.stopReason;
  // Only a bounded classification leaves this function; the persisted stop
  // reason is never copied into the report (PRD-08).
  return typeof stopReason === "string" &&
    Object.hasOwn(STOP_REASON_ERROR_KINDS, stopReason)
    ? STOP_REASON_ERROR_KINDS[stopReason]
    : undefined;
}

/**
 * Adds bounded usage parts. A part with out-of-range fields, or a sum that
 * leaves the safe range, contributes nothing so totals never reach a
 * non-finite or unsafe number. Optional token fields stay absent unless at
 * least one input observed them, so unknown never becomes a fabricated zero.
 */
export function addUsage(left: Usage, right: Usage): Usage {
  if (!isBoundedUsage(right)) return left;
  const totalTokens = left.totalTokens + right.totalTokens;
  const cost = roundCost(left.cost + right.cost);
  const optionalTokens = sumOptionalTokens(left, right);
  if (
    !isBoundedTokens(totalTokens) ||
    !isBoundedCost(cost) ||
    !Object.values(optionalTokens).every(isBoundedTokens)
  ) {
    return left;
  }
  return { totalTokens, cost, ...optionalTokens };
}

/**
 * A missing, malformed, or out-of-range usage record stays absent so unknown
 * never becomes a fabricated zero.
 */
function readUsage(value: unknown): Usage | undefined {
  if (!isRecord(value) || !isRecord(value.cost)) return undefined;
  if (!isBoundedTokens(value.totalTokens) || !isBoundedCost(value.cost.total)) {
    return undefined;
  }
  return {
    totalTokens: value.totalTokens,
    cost: value.cost.total,
    ...readOptionalTokens(value),
  };
}

function isBoundedUsage(usage: Usage): boolean {
  return (
    isBoundedTokens(usage.totalTokens) &&
    isBoundedCost(usage.cost) &&
    OPTIONAL_TOKEN_FIELDS.every((field) => {
      const value = usage[field];
      return value === undefined || isBoundedTokens(value);
    })
  );
}

function isBoundedTokens(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isBoundedCost(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_USAGE_VALUE
  );
}

function roundCost(value: number): number {
  return Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
}

function sumOptionalTokens(left: Usage, right: Usage): Partial<Usage> {
  const summed: Partial<Usage> = {};
  for (const field of OPTIONAL_TOKEN_FIELDS) {
    const leftValue = left[field];
    const rightValue = right[field];
    if (leftValue === undefined && rightValue === undefined) continue;
    summed[field] = (leftValue ?? 0) + (rightValue ?? 0);
  }
  return summed;
}

function readOptionalTokens(value: Record<string, unknown>): Partial<Usage> {
  const tokens: Partial<Usage> = {};
  const input = boundedToken(value.input);
  if (input !== undefined) tokens.inputTokens = input;
  const output = boundedToken(value.output);
  if (output !== undefined) tokens.outputTokens = output;
  const cacheRead = boundedToken(value.cacheRead);
  if (cacheRead !== undefined) tokens.cacheReadTokens = cacheRead;
  const cacheWrite = boundedToken(value.cacheWrite);
  if (cacheWrite !== undefined) tokens.cacheWriteTokens = cacheWrite;
  return tokens;
}

function boundedToken(value: unknown): number | undefined {
  return isBoundedTokens(value) ? value : undefined;
}

function toolCalls(value: unknown): { id: string; name: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) =>
    isRecord(item) &&
    item.type === "toolCall" &&
    typeof item.id === "string" &&
    typeof item.name === "string"
      ? [{ id: item.id, name: item.name }]
      : [],
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function reportLabel(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  if (
    encoder.encode(value).byteLength > MAX_REPORT_LABEL_BYTES ||
    secretLikeValue(value)
  ) {
    return REDACTED;
  }
  return value;
}

function secretLikeValue(value: string): boolean {
  return (
    /(?:secret|token|password|credential)/i.test(value) ||
    /(?:^|\s)bearer\s+\S+/i.test(value) ||
    /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----/i.test(value) ||
    /(?:[A-Za-z0-9_-]+\.){2}[A-Za-z0-9_-]+/.test(value) ||
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/.test(
      value,
    ) ||
    /[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@/i.test(value) ||
    /^[A-Za-z_][A-Za-z0-9_]*\s*=\s*\S+/.test(value) ||
    /(?:^|[\\/])\.env(?:[.\\/]|$)|(?:^|[\\/])(?:credentials?|secrets?)(?:[.\\/]|$)/i.test(
      value,
    )
  );
}

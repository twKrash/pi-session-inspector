import { createHash } from "node:crypto";
import type {
  AgentRun,
  EvidenceState,
  SessionEntry,
  Usage,
} from "../core/events.ts";

/** Persisted pi-subagents tool names, in the report's fixed column order. */
const SUBAGENT_TOOL_NAMES = [
  "subagent",
  "subagent_wait",
  "subagent_supervisor",
] as const;
const SUBAGENT_TOOLS: ReadonlySet<string> = new Set(SUBAGENT_TOOL_NAMES);
/** Producer run ids are hashed before they leave this adapter. */
const RAW_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
/** Bounded agent label token; an unusable producer value stays absent. */
const AGENT_LABEL = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,63}$/;
const MAX_RUNS = 256;
const MAX_TOTAL_TOKENS = 1_000_000_000;
const MAX_COST = 1_000_000_000;

/** Native subagent tool activity; usage is a breakdown, never a session total. */
export type AgentToolActivity = {
  state: EvidenceState;
  calls: number;
  succeeded: number;
  failed: number;
  interrupted: number;
  tools: readonly { name: string; calls: number }[];
  usage?: Usage;
};

export type SubagentEvidence = {
  activity: AgentToolActivity;
  runs: readonly AgentRun[];
  state: EvidenceState;
};

/** Bounded label grammar shared with the report projection. */
export function isAgentLabel(value: unknown): value is string {
  return typeof value === "string" && AGENT_LABEL.test(value);
}

/**
 * Derives subagent evidence from persisted Pi entries only: native tool
 * activity joined by `toolCallId`, plus cooperative rich runs read from the
 * documented `details.results[]`/`details.completions[]` projections.
 *
 * Child usage is a breakdown of the parent session's own tool-result usage and
 * is never added to session totals. Malformed or unknown input yields no rows;
 * nothing is ever guessed and no raw producer id, path, or task text leaves.
 */
export function readSubagentEvidence(
  entries: readonly SessionEntry[],
): SubagentEvidence {
  try {
    return deriveEvidence(entries);
  } catch {
    return unavailableEvidence();
  }
}

function deriveEvidence(entries: readonly SessionEntry[]): SubagentEvidence {
  const calls: { name: string; callId?: string }[] = [];
  const resultsByCallId = new Map<string, Readonly<Record<string, unknown>>>();
  for (const entry of entries) {
    const message = snapshotRecord(entry.message);
    if (message === undefined) continue;
    if (message.role === "assistant") collectCalls(message.content, calls);
    else if (message.role === "toolResult") {
      collectResult(message, resultsByCallId);
    }
  }

  const countsByTool = new Map<string, number>();
  const runs: AgentRun[] = [];
  const seenRunIds = new Set<string>();
  let succeeded = 0;
  let failed = 0;
  let interrupted = 0;
  let totalTokens = 0;
  let cost = 0;
  let hasUsage = false;
  const usageCountedCallIds = new Set<string>();

  for (const call of calls) {
    countsByTool.set(call.name, (countsByTool.get(call.name) ?? 0) + 1);
    const result =
      call.callId === undefined ? undefined : resultsByCallId.get(call.callId);
    if (result === undefined) {
      interrupted++;
      continue;
    }
    if (result.isError === true) failed++;
    else succeeded++;

    // Tool-result usage is already part of `usageComposition.toolResults` and
    // is counted once per call id, so an activity sum can never double count.
    const counted =
      call.callId !== undefined && usageCountedCallIds.has(call.callId);
    const usage = counted ? undefined : readPersistedUsage(result.usage);
    if (usage !== undefined && call.callId !== undefined) {
      usageCountedCallIds.add(call.callId);
      const nextTokens = totalTokens + usage.totalTokens;
      const nextCost = roundCost(cost + usage.cost);
      if (isBoundedTokens(nextTokens) && isBoundedCost(nextCost)) {
        totalTokens = nextTokens;
        cost = nextCost;
        hasUsage = true;
      }
    }
    collectRuns(result, runs, seenRunIds);
  }

  const activity: AgentToolActivity = {
    state: calls.length > 0 ? "supported" : "unavailable",
    calls: calls.length,
    succeeded,
    failed,
    interrupted,
    tools: SUBAGENT_TOOL_NAMES.filter(
      (name) => (countsByTool.get(name) ?? 0) > 0,
    ).map((name) => ({ name, calls: countsByTool.get(name) ?? 0 })),
    ...(hasUsage ? { usage: { totalTokens, cost } } : {}),
  };
  return {
    activity,
    runs,
    state: runs.length > 0 ? "supported" : "unavailable",
  };
}

function collectCalls(
  content: unknown,
  calls: { name: string; callId?: string }[],
): void {
  if (!Array.isArray(content)) return;
  for (const value of content) {
    const call = snapshotRecord(value);
    if (call === undefined || call.type !== "toolCall") continue;
    if (typeof call.name !== "string" || !SUBAGENT_TOOLS.has(call.name))
      continue;
    calls.push({
      name: call.name,
      ...(typeof call.id === "string" && call.id.length > 0
        ? { callId: call.id }
        : {}),
    });
  }
}

function collectResult(
  message: Readonly<Record<string, unknown>>,
  results: Map<string, Readonly<Record<string, unknown>>>,
): void {
  const callId = message.toolCallId;
  if (typeof callId !== "string" || callId.length === 0) return;
  // The first result wins the join, so a duplicate can never overwrite status.
  if (!results.has(callId)) results.set(callId, message);
}

/** Reads documented `details.results[]`/`details.completions[]` rows. */
function collectRuns(
  result: Readonly<Record<string, unknown>>,
  runs: AgentRun[],
  seenRunIds: Set<string>,
): void {
  const details = snapshotRecord(result.details);
  if (details === undefined) return;
  // A `subagent` result names its own run; anonymous children inherit it.
  const fallbackRunId = readRawRunId(details.runId);

  if (Array.isArray(details.completions)) {
    for (const value of details.completions.slice(0, MAX_RUNS)) {
      const completion = snapshotRecord(value);
      if (completion === undefined) continue;
      const completionRunId = readRawRunId(completion.runId);
      pushRun(completion, runs, seenRunIds, completionRunId, undefined);
      if (!Array.isArray(completion.results)) continue;
      for (const child of completion.results.slice(0, MAX_RUNS)) {
        const record = snapshotRecord(child);
        if (record === undefined) continue;
        // Nested children need their own run id to stay distinct rows.
        pushRun(
          record,
          runs,
          seenRunIds,
          readRawRunId(record.runId),
          completionRunId,
        );
      }
    }
  }

  if (Array.isArray(details.results)) {
    for (const value of details.results.slice(0, MAX_RUNS)) {
      const record = snapshotRecord(value);
      if (record === undefined) continue;
      pushRun(
        record,
        runs,
        seenRunIds,
        readRawRunId(record.runId) ?? fallbackRunId,
        undefined,
      );
    }
  }
}

function pushRun(
  record: Readonly<Record<string, unknown>>,
  runs: AgentRun[],
  seenRunIds: Set<string>,
  rawRunId: string | undefined,
  parentRawRunId: string | undefined,
): void {
  if (rawRunId === undefined || runs.length >= MAX_RUNS) return;
  const id = opaqueSubagentId(rawRunId);
  if (seenRunIds.has(id)) return;
  seenRunIds.add(id);

  const parentId =
    parentRawRunId !== undefined && parentRawRunId !== rawRunId
      ? opaqueSubagentId(parentRawRunId)
      : undefined;
  const agent = isAgentLabel(record.agent) ? record.agent : undefined;
  const usage = readChildUsage(record.usage);
  runs.push({
    id,
    ...(parentId === undefined ? {} : { parentId }),
    ...(agent === undefined ? {} : { agent }),
    status: mapRunStatus(record),
    confidence: "cooperative",
    ...(usage === undefined ? {} : { usage }),
  });
}

/**
 * Closed status vocabulary from the documented producer fields. An unknown
 * term resolves to `unknown`; it is never guessed from unrelated fields.
 */
function mapRunStatus(
  record: Readonly<Record<string, unknown>>,
): AgentRun["status"] {
  if (record.success === true) return "succeeded";
  if (record.success === false) return "failed";
  if (typeof record.state === "string") {
    switch (record.state) {
      case "complete":
      case "completed":
      case "succeeded":
        return "succeeded";
      case "failed":
      case "error":
        return "failed";
      case "running":
      case "queued":
      case "pending":
      case "started":
        return "running";
      case "cancelled":
      case "canceled":
      case "interrupted":
      case "stopped":
      case "aborted":
      case "killed":
        return "interrupted";
      default:
        return "unknown";
    }
  }
  if (
    typeof record.exitCode === "number" &&
    Number.isSafeInteger(record.exitCode)
  ) {
    return record.exitCode === 0 ? "succeeded" : "failed";
  }
  if (record.isError === true) return "failed";
  if (record.isError === false) return "succeeded";
  return "unknown";
}

/**
 * Validates a persisted tool-result usage record. A missing or malformed
 * record stays absent so unknown never becomes a fabricated zero.
 */
function readPersistedUsage(value: unknown): Usage | undefined {
  const usage = snapshotRecord(value);
  if (usage === undefined) return undefined;
  const totalTokens = isBoundedTokens(usage.totalTokens)
    ? usage.totalTokens
    : undefined;
  const cost = readCostTotal(usage.cost);
  if (totalTokens === undefined || cost === undefined) return undefined;
  return { totalTokens, cost };
}

/**
 * Reads a child usage group only when it is complete: all four token parts and
 * a numeric cost must be present, and the total is their sum. Partial groups
 * yield no usage rather than a zero-filled row.
 */
function readChildUsage(value: unknown): Usage | undefined {
  const usage = snapshotRecord(value);
  if (usage === undefined) return undefined;
  const input = usage.input;
  const output = usage.output;
  const cacheRead = usage.cacheRead;
  const cacheWrite = usage.cacheWrite;
  if (
    !isBoundedTokens(input) ||
    !isBoundedTokens(output) ||
    !isBoundedTokens(cacheRead) ||
    !isBoundedTokens(cacheWrite) ||
    !isBoundedCost(usage.cost)
  ) {
    return undefined;
  }
  const totalTokens = input + output + cacheRead + cacheWrite;
  if (!isBoundedTokens(totalTokens)) return undefined;
  return { totalTokens, cost: roundCost(usage.cost) };
}

function readCostTotal(value: unknown): number | undefined {
  if (isBoundedCost(value)) return roundCost(value);
  const cost = snapshotRecord(value);
  if (cost === undefined) return undefined;
  return isBoundedCost(cost.total) ? roundCost(cost.total) : undefined;
}

function readRawRunId(value: unknown): string | undefined {
  return typeof value === "string" && RAW_RUN_ID.test(value)
    ? value
    : undefined;
}

/**
 * Producer run ids are producer-controlled metadata. Hash them before they
 * leave this adapter so reports retain explicit parentage without copying IDs.
 */
function opaqueSubagentId(id: string): string {
  return `subagent-${createHash("sha256")
    .update("pi-session-inspector:subagent-artifact-id:v1\0")
    .update(id)
    .digest("hex")}`;
}

function isBoundedTokens(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_TOTAL_TOKENS
  );
}

function isBoundedCost(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_COST
  );
}

function roundCost(value: number): number {
  return Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
}

function snapshotRecord(
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const snapshot: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") return undefined;
    const descriptor = descriptors[key];
    if (descriptor?.enumerable !== true || !("value" in descriptor)) {
      return undefined;
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

function unavailableEvidence(): SubagentEvidence {
  return {
    activity: {
      state: "unavailable",
      calls: 0,
      succeeded: 0,
      failed: 0,
      interrupted: 0,
      tools: [],
    },
    runs: [],
    state: "unavailable",
  };
}

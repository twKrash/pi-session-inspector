import type {
  AgentFailure,
  AgentRun,
  EvidenceState,
  SessionEntry,
  Usage,
} from "../core/events.ts";
import { boundedProducerLabel } from "../core/evidence.ts";
import { canonicalOpaqueDigest } from "../core/opaque-id.ts";
import { readPublishedArchiveState } from "./subagent-archive.ts";

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
/** Bound on a published archive path so a corrupt session cannot retain an arbitrarily large string. */
const MAX_ARCHIVE_PATH = 4096;
const MAX_COST = 1_000_000_000;
/** Exit-code detail bound, shared with the report projection (R24). */
const MAX_EXIT_CODE = 2_147_483_647;
/** Bounded native tool-call id used to name the publishing result. */
const TOOL_CALL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
/** Persisted Pi entry timestamps are ISO instants, never free text. */
const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
/**
 * Closed POSIX signal vocabulary. A producer value outside it is not evidence
 * and leaves the failure detail absent rather than copying an unknown token.
 */
const PROCESS_SIGNALS: ReadonlySet<string> = new Set([
  "SIGABRT",
  "SIGALRM",
  "SIGBUS",
  "SIGCHLD",
  "SIGCLD",
  "SIGCONT",
  "SIGEMT",
  "SIGIOT",
  "SIGPWR",
  "SIGSTKFLT",
  "SIGFPE",
  "SIGHUP",
  "SIGILL",
  "SIGINT",
  "SIGKILL",
  "SIGPIPE",
  "SIGPOLL",
  "SIGPROF",
  "SIGQUIT",
  "SIGSEGV",
  "SIGSTOP",
  "SIGSYS",
  "SIGTERM",
  "SIGTRAP",
  "SIGTSTP",
  "SIGTTIN",
  "SIGTTOU",
  "SIGURG",
  "SIGUSR1",
  "SIGUSR2",
  "SIGVTALRM",
  "SIGXCPU",
  "SIGXFSZ",
]);

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

/** Only a closed conflict code is emitted; a count carries the occurrence. */
export type SubagentEvidenceDiagnostic = {
  code: "cooperative-evidence-conflict";
  count: number;
};

export type SubagentEvidence = {
  activity: AgentToolActivity;
  runs: readonly AgentRun[];
  state: EvidenceState;
  /**
   * Bounded, closed-code diagnostics. Repeated observations of one run that
   * disagree on identity or regress a terminal status are counted here.
   */
  diagnostics: readonly SubagentEvidenceDiagnostic[];
};

/**
 * Archive-aware subagent evidence: {@link readSubagentEvidence} plus the
 * validated presence of any archive a completion published.
 *
 * At most `MAX_RUNS` validations run concurrently and a rejection from one
 * yields `"missing"` for that run alone. The published path, the raw run id,
 * and every archive field stay inside this adapter: only the bounded
 * `"available" | "missing"` verdict reaches a run. Runs without a published
 * reference keep `artifacts` absent.
 */
export async function readSubagentEvidenceWithArchives(
  entries: readonly SessionEntry[],
  sessionId: string,
): Promise<SubagentEvidence> {
  const evidence = readSubagentEvidence(entries, sessionId);
  if (evidence.runs.length === 0) return evidence;

  let references: Map<string, { path: string; runId: string }>;
  try {
    references = collectArchiveReferences(entries, sessionId);
  } catch {
    return evidence;
  }
  if (references.size === 0) return evidence;

  try {
    const runs = await Promise.all(
      evidence.runs.slice(0, MAX_RUNS).map(async (run) => {
        const reference = references.get(run.id);
        if (reference === undefined) return run;
        let artifacts: "available" | "missing";
        try {
          artifacts = await readPublishedArchiveState(
            reference.path,
            reference.runId,
          );
        } catch {
          artifacts = "missing";
        }
        return { ...run, artifacts };
      }),
    );
    return { ...evidence, runs };
  } catch {
    return evidence;
  }
}

/** Bounded label grammar shared with the report projection. */
export function isAgentLabel(value: unknown): value is string {
  return typeof value === "string" && AGENT_LABEL.test(value);
}

/** Closed POSIX signal vocabulary shared with the report projection. */
export function isProcessSignal(value: unknown): value is string {
  return typeof value === "string" && PROCESS_SIGNALS.has(value);
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
  sessionId: string,
): SubagentEvidence {
  try {
    return deriveEvidence(entries, sessionId);
  } catch {
    return unavailableEvidence();
  }
}

/** A joined result plus the publishing entry's ordinal and timestamp. */
type JoinedResult = {
  message: Readonly<Record<string, unknown>>;
  ordinal: number;
  timestamp: string | undefined;
};

/** Publication provenance carried by one persisted result. */
type RunPublication = {
  observedAt?: string;
  evidenceToolId?: string;
};

/**
 * Mutable accumulator for one hashed run id. Identity-like fields carry an
 * explicit conflict flag so a dropped field can never be restored by a later
 * agreeing observation.
 */
type RunAccumulator = {
  id: string;
  parentId?: string;
  parentIdConflict: boolean;
  agent?: string;
  agentConflict: boolean;
  status: AgentRun["status"];
  statusConflict: boolean;
  observedAt?: string;
  evidenceToolId?: string;
  model?: string;
  thinking?: string;
  failure?: AgentFailure;
  usage?: Usage;
};

type RunCollector = {
  runs: RunAccumulator[];
  byId: Map<string, RunAccumulator>;
  conflicts: number;
};

function deriveEvidence(
  entries: readonly SessionEntry[],
  sessionId: string,
): SubagentEvidence {
  const calls: { name: string; callId?: string }[] = [];
  const resultsByCallId = new Map<string, JoinedResult>();
  entries.forEach((entry, ordinal) => {
    const message = snapshotRecord(entry.message);
    if (message === undefined) return;
    if (message.role === "assistant") collectCalls(message.content, calls);
    else if (message.role === "toolResult") {
      collectResult(message, entry.timestamp, ordinal, resultsByCallId);
    }
  });

  const countsByTool = new Map<string, number>();
  const collector: RunCollector = {
    runs: [],
    byId: new Map(),
    conflicts: 0,
  };
  const publications: {
    result: Readonly<Record<string, unknown>>;
    publication: RunPublication;
    ordinal: number;
  }[] = [];
  let succeeded = 0;
  let failed = 0;
  let interrupted = 0;
  let totalTokens = 0;
  let cost = 0;
  let hasUsage = false;
  const usageCountedCallIds = new Set<string>();

  for (const call of calls) {
    countsByTool.set(call.name, (countsByTool.get(call.name) ?? 0) + 1);
    const joined =
      call.callId === undefined ? undefined : resultsByCallId.get(call.callId);
    if (joined === undefined) {
      interrupted++;
      continue;
    }
    const result = joined.message;
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
    publications.push({
      result,
      publication: publicationOf(joined),
      ordinal: joined.ordinal,
    });
  }

  // §8.5: merge repeated observations in publishing-entry order, then producer
  // row index (preserved by the stable sort within one result).
  publications.sort((a, b) => a.ordinal - b.ordinal);
  for (const { result, publication } of publications) {
    collectRuns(result, publication, collector, sessionId);
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
  const runs = collector.runs.map(toAgentRun);
  return {
    activity,
    runs,
    state: runs.length > 0 ? "supported" : "unavailable",
    diagnostics:
      collector.conflicts > 0
        ? [
            {
              code: "cooperative-evidence-conflict",
              count: collector.conflicts,
            },
          ]
        : [],
  };
}

/** Publication provenance: publishing result timestamp and canonical tool id. */
function publicationOf(joined: JoinedResult): RunPublication {
  const observedAt = readObservedAt(joined.timestamp);
  const toolCallId = joined.message.toolCallId;
  const evidenceToolId =
    typeof toolCallId === "string" && TOOL_CALL_ID.test(toolCallId)
      ? `tool:${toolCallId}`
      : undefined;
  return {
    ...(observedAt === undefined ? {} : { observedAt }),
    ...(evidenceToolId === undefined ? {} : { evidenceToolId }),
  };
}

function readObservedAt(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 35) return undefined;
  if (!ISO_INSTANT.test(value) || Number.isNaN(Date.parse(value))) {
    return undefined;
  }
  return value;
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
  timestamp: string | undefined,
  ordinal: number,
  results: Map<string, JoinedResult>,
): void {
  const callId = message.toolCallId;
  if (typeof callId !== "string" || callId.length === 0) return;
  // The first result wins the join, so a duplicate can never overwrite status.
  if (!results.has(callId))
    results.set(callId, { message, ordinal, timestamp });
}

/** Reads documented `details.results[]`/`details.completions[]` rows. */
function collectRuns(
  result: Readonly<Record<string, unknown>>,
  publication: RunPublication,
  collector: RunCollector,
  sessionId: string,
): void {
  const details = snapshotRecord(result.details);
  if (details === undefined) return;
  // Aggregate run id used to parent rows that carry no run id of their own.
  const aggregateRunId = readRawRunId(details.runId);
  const aggregateParentId =
    aggregateRunId === undefined
      ? undefined
      : opaqueSubagentId(sessionId, aggregateRunId);

  // §8.5 within-entry order is `results[]` → `completions[]` →
  // `workflowChildren.children[]`: completions carry terminal evidence and
  // therefore win as the later observation.
  if (Array.isArray(details.results)) {
    for (const value of details.results.slice(0, MAX_RUNS)) {
      const record = snapshotRecord(value);
      if (record === undefined) continue;
      // A published `results[]` row may carry its own run id (an async or
      // completion-replayed run). Only foreground children without one fall
      // back to the aggregate run id plus the launch-order `index`; without
      // either the row is unidentifiable and skipped rather than collapsed
      // onto the parent (which would drop every child after the first).
      const rowRunId = readRawRunId(record.runId);
      const index = readChildIndex(record.index);
      const id =
        rowRunId !== undefined
          ? opaqueSubagentId(sessionId, rowRunId)
          : aggregateRunId === undefined || index === undefined
            ? undefined
            : opaqueSubagentId(sessionId, `${aggregateRunId}#${index}`);
      pushRun(record, collector, publication, id, aggregateParentId);
    }
  }

  if (Array.isArray(details.completions)) {
    for (const value of details.completions.slice(0, MAX_RUNS)) {
      const completion = snapshotRecord(value);
      if (completion === undefined) continue;
      const completionRunId = readRawRunId(completion.runId);
      pushRun(
        completion,
        collector,
        publication,
        completionRunId === undefined
          ? undefined
          : opaqueSubagentId(sessionId, completionRunId),
        undefined,
      );
      if (!Array.isArray(completion.results)) continue;
      for (const child of completion.results.slice(0, MAX_RUNS)) {
        const record = snapshotRecord(child);
        if (record === undefined) continue;
        // Nested completion children are identified by their own run id.
        const childRunId = readRawRunId(record.runId);
        pushRun(
          record,
          collector,
          publication,
          childRunId === undefined
            ? undefined
            : opaqueSubagentId(sessionId, childRunId),
          completionRunId === undefined
            ? undefined
            : opaqueSubagentId(sessionId, completionRunId),
        );
      }
    }
  }
}

function pushRun(
  record: Readonly<Record<string, unknown>>,
  collector: RunCollector,
  publication: RunPublication,
  id: string | undefined,
  parentId: string | undefined,
): void {
  if (id === undefined) return;
  let run = collector.byId.get(id);
  if (run === undefined) {
    if (collector.runs.length >= MAX_RUNS) return;
    run = {
      id,
      parentIdConflict: false,
      agentConflict: false,
      status: "unknown",
      statusConflict: false,
    };
    collector.byId.set(id, run);
    collector.runs.push(run);
  }
  mergeRunObservation(run, record, publication, parentId, collector);
}

/**
 * §8.5 merge for repeated observations of one run id. `observedAt` and
 * `evidenceToolId` come from the latest accepted publication; mutable fields
 * take the latest valid value; identity fields must agree or are dropped with
 * `cooperative-evidence-conflict`; usage is selected, never summed.
 */
function mergeRunObservation(
  run: RunAccumulator,
  record: Readonly<Record<string, unknown>>,
  publication: RunPublication,
  parentId: string | undefined,
  collector: RunCollector,
): void {
  if (!run.parentIdConflict && parentId !== undefined && parentId !== run.id) {
    if (run.parentId === undefined) run.parentId = parentId;
    else if (run.parentId !== parentId) {
      run.parentId = undefined;
      run.parentIdConflict = true;
      collector.conflicts++;
    }
  }

  const agent = isAgentLabel(record.agent) ? record.agent : undefined;
  if (!run.agentConflict && agent !== undefined) {
    if (run.agent === undefined) run.agent = agent;
    else if (run.agent !== agent) {
      run.agent = undefined;
      run.agentConflict = true;
      collector.conflicts++;
    }
  }

  mergeRunStatus(run, mapRunStatus(record), collector);

  const model = boundedProducerLabel(record.model);
  if (model !== undefined) run.model = model;
  const thinking = boundedProducerLabel(record.thinking);
  if (thinking !== undefined) run.thinking = thinking;
  const failure = readAgentFailure(record);
  if (failure !== undefined) run.failure = failure;
  const usage = readChildUsage(record.usage);
  if (usage !== undefined) run.usage = usage;

  if (publication.observedAt !== undefined) {
    run.observedAt = publication.observedAt;
  }
  if (publication.evidenceToolId !== undefined) {
    run.evidenceToolId = publication.evidenceToolId;
  }
}

/** Non-terminal `running` is progress; any other resolved status is terminal. */
function mergeRunStatus(
  run: RunAccumulator,
  next: AgentRun["status"],
  collector: RunCollector,
): void {
  if (run.statusConflict || next === "unknown") return;
  const nextTerminal = next !== "running";
  const currentTerminal = run.status !== "unknown" && run.status !== "running";
  if (currentTerminal && (!nextTerminal || run.status !== next)) {
    // Conflicting terminal statuses or a terminal-to-running regression.
    run.status = "unknown";
    run.statusConflict = true;
    collector.conflicts++;
    return;
  }
  run.status = next;
}

/**
 * Bounded failure derived only from closed producer evidence: a non-zero exit
 * code, a known POSIX signal, an explicit completion failure, or an absent
 * output state. Free-text reasons never become evidence.
 */
function readAgentFailure(
  record: Readonly<Record<string, unknown>>,
): AgentFailure | undefined {
  // R21 precedence: signal first (it carries the process cause), then exit
  // code, then an explicit failure, then absent output.
  const signal = record.processSignal;
  if (isProcessSignal(signal)) {
    return { reason: "process-signal", detail: signal };
  }
  const exitCode = record.exitCode;
  if (
    typeof exitCode === "number" &&
    Number.isSafeInteger(exitCode) &&
    exitCode >= 0 &&
    exitCode <= MAX_EXIT_CODE &&
    exitCode !== 0
  ) {
    return { reason: "exit-nonzero", detail: exitCode };
  }
  if (record.success === false) return { reason: "completion-failed" };
  if (record.outputState === "absent") return { reason: "output-absent" };
  return undefined;
}

function toAgentRun(run: RunAccumulator): AgentRun {
  return {
    id: run.id,
    ...(run.parentId === undefined ? {} : { parentId: run.parentId }),
    ...(run.agent === undefined ? {} : { agent: run.agent }),
    status: run.status,
    confidence: "cooperative",
    ...(run.usage === undefined ? {} : { usage: run.usage }),
    ...(run.observedAt === undefined ? {} : { observedAt: run.observedAt }),
    ...(run.evidenceToolId === undefined
      ? {}
      : { evidenceToolId: run.evidenceToolId }),
    ...(run.model === undefined ? {} : { model: run.model }),
    ...(run.thinking === undefined ? {} : { thinking: run.thinking }),
    ...(run.failure === undefined ? {} : { failure: run.failure }),
  };
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

/**
 * Reads documented `details.completions[]` rows keyed by the opaque identity
 * of the run that published the reference. The raw path and raw run id are
 * held only long enough to validate them, then discarded.
 *
 * Archive references are followed only from `details.completions[]` because
 * that is the only surface the pinned producer publishes `archivePath` on
 * (`WaitCompletion` in pi-subagents). Child-row references are deliberately
 * not followed: the archive records the aggregate run's own `runId`, while a
 * foreground child is identified as `opaque("<aggregate>#<index>")`, so
 * validating a child-level reference would require weakening the exact-runId
 * check that makes the archive adapter trustworthy. A `details.results[]` row
 * that happens to publish `archivePath` is therefore deliberately ignored —
 * the run keeps `artifacts` absent (not `"missing"`).
 */
function collectArchiveReferences(
  entries: readonly SessionEntry[],
  sessionId: string,
): Map<string, { path: string; runId: string }> {
  const references = new Map<string, { path: string; runId: string }>();
  for (const entry of entries) {
    const message = snapshotRecord(entry.message);
    if (message === undefined || message.role !== "toolResult") continue;
    if (
      typeof message.toolName !== "string" ||
      !SUBAGENT_TOOLS.has(message.toolName)
    ) {
      continue;
    }
    const details = snapshotRecord(message.details);
    if (details === undefined || !Array.isArray(details.completions)) continue;
    for (const value of details.completions.slice(0, MAX_RUNS)) {
      const completion = snapshotRecord(value);
      if (completion === undefined) continue;
      const runId = readRawRunId(completion.runId);
      const path = readArchivePath(completion.archivePath);
      if (runId === undefined || path === undefined) continue;
      const id = opaqueSubagentId(sessionId, runId);
      if (!references.has(id)) references.set(id, { path, runId });
    }
  }
  return references;
}

/**
 * A published reference must be a non-empty string no longer than
 * `MAX_ARCHIVE_PATH`; `isAbsolute` is checked at read.
 */
function readArchivePath(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ARCHIVE_PATH
    ? value
    : undefined;
}

function readRawRunId(value: unknown): string | undefined {
  return typeof value === "string" && RAW_RUN_ID.test(value)
    ? value
    : undefined;
}

/**
 * A foreground child's stable identity within its aggregate run. Only a safe
 * non-negative integer is usable; anything else leaves the row unidentifiable.
 */
function readChildIndex(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

/**
 * Producer run ids are producer-controlled metadata. Hash them session-scoped
 * through the canonical opaque-id binding before they leave this adapter, so
 * reports retain explicit parentage without copying or cross-session-colliding
 * IDs.
 */
function opaqueSubagentId(sessionId: string, id: string): string {
  return `subagent-${canonicalOpaqueDigest("subagent-run", sessionId, id)}`;
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
    diagnostics: [],
  };
}

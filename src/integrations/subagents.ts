import { Buffer } from "node:buffer";
import type {
  AgentFailure,
  AgentRun,
  AgentRunIdentityAlias,
  AgentRunSourceObservation,
  AgentRunUsage,
  AgentToolActivity,
  SessionEntry,
  SubagentSourceEvidence,
  Usage,
} from "../core/events.ts";
import { MAX_AGENT_RUN_TOOL_CALLS } from "../core/events.ts";
import { boundedProducerLabel } from "../core/evidence.ts";
import { canonicalOpaqueDigest } from "../core/opaque-id.ts";
import { roundCost } from "../core/rounding.ts";
import { readPublishedArchiveState } from "./subagent-archive.ts";
import {
  readForegroundHistoryOutcomes,
  type ForegroundHistoryRequest,
} from "./subagent-foreground-history.ts";
import { readReferencedLifecycleEnrichment } from "./subagent-lifecycle.ts";

/** Persisted pi-subagents tool names, in the report's fixed column order. */
const SUBAGENT_TOOL_NAMES = [
  "subagent",
  "subagent_wait",
  "bg_wait",
  "subagent_supervisor",
] as const;
const SUBAGENT_TOOLS: ReadonlySet<string> = new Set(SUBAGENT_TOOL_NAMES);
const ASYNC_WAIT_TOOL_NAMES: ReadonlySet<string> = new Set([
  "bg_wait",
  "subagent_wait",
]);
/** Producer run ids are hashed before they leave this adapter. */
const RAW_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const WORKFLOW_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** Bounded agent label token; an unusable producer value stays absent. */
const AGENT_LABEL = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,63}$/;
const MAX_RUNS = 256;
// Keep lifecycle materialization within reconciler's two sources per run.
const MAX_LIFECYCLE_OBSERVATIONS = MAX_RUNS * 2;
const MAX_WORKFLOW_ID_BYTES = 4096;
const WORKFLOW_SUMMARY_FIELDS: ReadonlySet<string> = new Set([
  "version",
  "parentToolCallId",
  "workflowRunId",
  "inventoryComplete",
  "workflowState",
  "children",
]);
const WORKFLOW_SUMMARY_STATES: ReadonlySet<string> = new Set([
  "queued",
  "running",
  "completed",
  "failed",
  "paused",
  "stopped",
]);
const WORKFLOW_CHILD_FIELDS: ReadonlySet<string> = new Set([
  "childId",
  "runId",
  "agent",
  "sessionName",
  "model",
  "thinking",
  "state",
  "activity",
]);
const WORKFLOW_CHILD_STATES: ReadonlySet<string> = new Set([
  "pending",
  "running",
  "completed",
  "failed",
  "paused",
  "stopped",
  "rejected",
  "detached",
]);
const WORKFLOW_ACTIVITY_COUNTERS: ReadonlySet<string> = new Set([
  "currentToolStartedAt",
  "lastActivityAt",
  "durationMs",
  "toolCount",
  "turnCount",
  "tokens",
  "inputTokens",
  "outputTokens",
]);
const WORKFLOW_CHILD_TEXT_LIMITS = {
  runId: 256,
  agent: 256,
  sessionName: 256,
  model: 256,
  thinking: 32,
} as const;
const MAX_TOTAL_TOKENS = 1_000_000_000;
/** Bound on a published archive path so a corrupt session cannot retain an arbitrarily large string. */
const MAX_ARCHIVE_PATH = 4096;
const MAX_COST = 1_000_000_000;
/** Exit-code detail bound, shared with the report projection (R24). */
const MAX_EXIT_CODE = 2_147_483_647;
const MAX_DURATION_MS = 86_400_000_000;
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

/** Canonical agent DTOs owned by core (see ADR 0007 and ADR 0019). */
export type {
  AgentToolActivity,
  SubagentSourceEvidence,
} from "../core/events.ts";

/**
 * Archive-aware source evidence. Archive paths and raw run ids stay in this
 * adapter; only bounded verdicts are added to observations.
 */
export async function readSubagentEvidenceWithArchives(
  entries: readonly SessionEntry[],
  sessionId: string,
  sessionFile?: string,
): Promise<SubagentSourceEvidence> {
  const evidence = readSubagentEvidence(entries, sessionId);
  if (evidence.state !== "supported") return evidence;
  let references: Map<string, { path: string; runId: string }>;
  try {
    references = collectArchiveReferences(entries, sessionId);
  } catch {
    references = new Map();
  }
  if (references.size === 0) {
    return sessionFile === undefined
      ? evidence
      : enrichCurrentSession(entries, sessionId, sessionFile, evidence);
  }

  const artifactsBySource = new Map<string, "available" | "missing">();
  try {
    await Promise.all(
      [...references].map(async ([sourceIdentity, reference]) => {
        try {
          return artifactsBySource.set(
            sourceIdentity,
            await readPublishedArchiveState(reference.path, reference.runId),
          );
        } catch {
          return artifactsBySource.set(sourceIdentity, "missing");
        }
      }),
    );
  } catch {
    return evidence;
  }

  const archivedEvidence: SubagentSourceEvidence = {
    ...evidence,
    observations: {
      *[Symbol.iterator]() {
        for (const observation of evidence.observations) {
          const artifacts = artifactsBySource.get(observation.sourceIdentity);
          yield artifacts === undefined
            ? observation
            : { ...observation, run: { ...observation.run, artifacts } };
        }
      },
    },
  };
  return sessionFile === undefined
    ? archivedEvidence
    : enrichCurrentSession(entries, sessionId, sessionFile, archivedEvidence);
}

async function enrichCurrentSession(
  entries: readonly SessionEntry[],
  sessionId: string,
  sessionFile: string,
  evidence: SubagentSourceEvidence,
): Promise<SubagentSourceEvidence> {
  const lifecycle = await enrichCurrentLifecycle(
    entries,
    sessionId,
    sessionFile,
    evidence,
  );
  return enrichCurrentForegroundHistory(entries, sessionId, lifecycle);
}

async function enrichCurrentForegroundHistory(
  entries: readonly SessionEntry[],
  sessionId: string,
  evidence: SubagentSourceEvidence,
): Promise<SubagentSourceEvidence> {
  try {
    const observations = [...evidence.observations];
    const terminalSources = new Set(
      observations
        .filter(({ run }) => run.status !== "unknown")
        .map(({ sourceIdentity }) => sourceIdentity),
    );
    const detachedSources = new Set(
      observations
        .filter(
          ({ run, sourceIdentity }) =>
            run.executionDisposition === "detached" &&
            run.status === "unknown" &&
            !terminalSources.has(sourceIdentity),
        )
        .map(({ sourceIdentity }) => sourceIdentity),
    );
    if (detachedSources.size === 0) return evidence;
    const references = collectDetachedForegroundReferences(
      entries,
      sessionId,
      detachedSources,
    );
    if (references.size === 0) return evidence;
    const outcomes = await readForegroundHistoryOutcomes(
      sessionId,
      [...references.values()].map(({ runId, index }) => ({ runId, index })),
    );
    return {
      ...evidence,
      observations: observations.map((observation) => {
        const reference = references.get(observation.sourceIdentity);
        const outcome =
          reference === undefined
            ? undefined
            : outcomes.get(`${reference.runId}#${reference.index}`);
        return outcome === undefined
          ? observation
          : { ...observation, run: { ...observation.run, status: outcome } };
      }),
    };
  } catch {
    return evidence;
  }
}

function collectDetachedForegroundReferences(
  entries: readonly SessionEntry[],
  sessionId: string,
  detachedSources: ReadonlySet<string>,
): Map<string, ForegroundHistoryRequest> {
  const calls = new Set<string>();
  for (const entry of entries) {
    const message = snapshotRecord(entry.message);
    if (message?.role !== "assistant" || !Array.isArray(message.content))
      continue;
    for (const value of message.content) {
      const call = snapshotRecord(value);
      if (
        call?.type !== "toolCall" ||
        call.name !== "subagent" ||
        typeof call.id !== "string" ||
        call.id.length === 0
      )
        continue;
      calls.add(call.id);
      if (calls.size > MAX_RUNS) return new Map();
    }
  }

  const results = new Map<string, JoinedResult>();
  entries.forEach((entry, ordinal) => {
    const message = snapshotRecord(entry.message);
    const callId = message?.toolCallId;
    if (
      message?.role !== "toolResult" ||
      typeof callId !== "string" ||
      !calls.has(callId) ||
      results.has(callId)
    )
      return;
    results.set(callId, {
      message,
      ordinal,
      timestamp: entry.timestamp,
    });
  });

  const references = new Map<string, ForegroundHistoryRequest>();
  for (const callId of calls) {
    const result = results.get(callId)?.message;
    const details = snapshotRecord(result?.details);
    const runId = readRawRunId(details?.runId);
    if (
      result?.toolName !== "subagent" ||
      details === undefined ||
      runId === undefined ||
      !Array.isArray(details.results)
    )
      continue;
    for (const value of details.results.slice(0, MAX_RUNS)) {
      const record = snapshotRecord(value);
      if (
        record === undefined ||
        record.detached !== true ||
        record.runId !== undefined
      )
        continue;
      const index = readChildIndex(record.index);
      if (index === undefined) continue;
      const sourceIdentity = opaqueSubagentSourceIdentity(
        sessionId,
        `${runId}#${index}`,
        "foreground",
      );
      if (!detachedSources.has(sourceIdentity)) continue;
      if (!references.has(sourceIdentity)) {
        if (references.size === MAX_RUNS) return new Map();
        references.set(sourceIdentity, { runId, index });
      }
    }
  }
  return references;
}

async function enrichCurrentLifecycle(
  entries: readonly SessionEntry[],
  sessionId: string,
  sessionFile: string,
  evidence: SubagentSourceEvidence,
): Promise<SubagentSourceEvidence> {
  try {
    const references = collectAsyncLifecycleReferences(entries, sessionId);
    if (references === undefined) return evidence;
    const observations: AgentRunSourceObservation[] = [];
    for (const observation of evidence.observations) {
      if (observations.length >= MAX_LIFECYCLE_OBSERVATIONS) return evidence;
      observations.push(observation);
    }
    const publicIdBySource = new Map(
      (evidence.aliases ?? []).map(({ sourceIdentity, publicId }) => [
        sourceIdentity,
        publicId,
      ]),
    );
    const persistedModels = new Set<string>();
    const persistedToolCalls = new Set<string>();
    for (const observation of observations) {
      const runId =
        publicIdBySource.get(observation.sourceIdentity) ?? observation.run.id;
      if (observation.run.model !== undefined) persistedModels.add(runId);
      if (observation.run.toolCalls !== undefined)
        persistedToolCalls.add(runId);
    }
    const observedSources = new Set(
      observations.map(({ sourceIdentity }) => sourceIdentity),
    );
    const enrichmentBySource = new Map<
      string,
      Awaited<ReturnType<typeof readReferencedLifecycleEnrichment>>
    >();
    for (const [sourceIdentity, reference] of references) {
      if (!observedSources.has(sourceIdentity)) continue;
      enrichmentBySource.set(
        sourceIdentity,
        await readReferencedLifecycleEnrichment(
          reference.asyncDir,
          reference.runId,
          sessionFile,
        ),
      );
    }

    return {
      ...evidence,
      observations: observations.map((observation) => {
        const enrichment = enrichmentBySource.get(observation.sourceIdentity);
        if (enrichment === undefined) return observation;
        const logicalRunId =
          publicIdBySource.get(observation.sourceIdentity) ??
          observation.run.id;
        const model =
          observation.run.model ??
          (persistedModels.has(logicalRunId) ? undefined : enrichment.model);
        const toolCalls =
          observation.run.toolCalls ??
          (persistedToolCalls.has(logicalRunId)
            ? undefined
            : enrichment.toolCalls);
        if (
          model === observation.run.model &&
          toolCalls === observation.run.toolCalls
        )
          return observation;
        return {
          ...observation,
          run: {
            ...observation.run,
            ...(model === undefined ? {} : { model }),
            ...(toolCalls === undefined ? {} : { toolCalls }),
            ...(observation.run.toolCalls === undefined &&
            toolCalls !== undefined
              ? {
                  effortCoverage: {
                    ...observation.run.effortCoverage,
                    tools: "partial" as const,
                  },
                }
              : {}),
          },
        };
      }),
    };
  } catch {
    return evidence;
  }
}

function collectAsyncLifecycleReferences(
  entries: readonly SessionEntry[],
  sessionId: string,
): Map<string, { asyncDir: unknown; runId: string }> | undefined {
  const callIds = new Set<string>();
  for (const entry of entries) {
    const message = snapshotRecord(entry.message);
    if (message?.role !== "assistant" || !Array.isArray(message.content))
      continue;
    for (const value of message.content) {
      const call = snapshotRecord(value);
      if (
        call?.type !== "toolCall" ||
        call.name !== "subagent" ||
        typeof call.id !== "string" ||
        call.id.length === 0 ||
        callIds.has(call.id)
      ) {
        continue;
      }
      if (callIds.size >= MAX_RUNS) return undefined;
      callIds.add(call.id);
    }
  }

  const results = new Map<string, JoinedResult>();
  for (const [ordinal, entry] of entries.entries()) {
    const message = snapshotRecord(entry.message);
    if (
      message?.role === "toolResult" &&
      typeof message.toolCallId === "string" &&
      callIds.has(message.toolCallId)
    ) {
      collectResult(message, entry.timestamp, ordinal, results);
    }
  }

  const byRunId = new Map<string, { asyncDir: unknown; conflicted: boolean }>();
  for (const callId of callIds) {
    const result = results.get(callId)?.message;
    if (
      result === undefined ||
      result.toolName !== "subagent" ||
      result.isError !== false
    ) {
      continue;
    }
    const details = snapshotRecord(result.details);
    if (details === undefined) continue;
    const runId = readAsyncLaunchRunId("subagent", result, details);
    if (runId === undefined) continue;
    const previous = byRunId.get(runId);
    if (previous === undefined) {
      if (byRunId.size >= MAX_RUNS) return undefined;
      byRunId.set(runId, { asyncDir: details.asyncDir, conflicted: false });
    } else if (previous.asyncDir !== details.asyncDir) {
      previous.conflicted = true;
    }
  }

  const references = new Map<string, { asyncDir: unknown; runId: string }>();
  for (const [runId, reference] of byRunId) {
    if (!reference.conflicted) {
      references.set(opaqueSubagentSourceIdentity(sessionId, runId, "async"), {
        asyncDir: reference.asyncDir,
        runId,
      });
    }
  }
  return references;
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
): SubagentSourceEvidence {
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

type ObservationCursor = { value: number };

function deriveEvidence(
  entries: readonly SessionEntry[],
  sessionId: string,
): SubagentSourceEvidence {
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
  const publications: {
    result: Readonly<Record<string, unknown>>;
    publication: RunPublication;
    ordinal: number;
    toolName: string;
    successfulMatchingResult: boolean;
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
      toolName: call.name,
      successfulMatchingResult:
        result.toolName === call.name && result.isError === false,
    });
  }

  // Persisted entry order, then producer row order, defines precedence.
  publications.sort((a, b) => a.ordinal - b.ordinal);
  const asyncLaunchRunIds = new Set<string>();
  const asyncCompletionRunIds = new Set<string>();
  for (const { result, toolName, successfulMatchingResult } of publications) {
    const details = snapshotRecord(result.details);
    if (details === undefined) continue;
    const launchRunId = readAsyncLaunchRunId(toolName, result, details);
    if (launchRunId !== undefined && asyncLaunchRunIds.size < MAX_RUNS) {
      asyncLaunchRunIds.add(launchRunId);
    }
    if (
      !successfulMatchingResult ||
      !ASYNC_WAIT_TOOL_NAMES.has(toolName) ||
      !Array.isArray(details.completions)
    ) {
      continue;
    }
    for (const value of details.completions.slice(0, MAX_RUNS)) {
      const completion = snapshotRecord(value);
      if (
        completion === undefined ||
        isSuppressedAsyncWaitContainer(toolName, completion)
      ) {
        continue;
      }
      const completionRunId = readRawRunId(completion.runId);
      if (
        completionRunId !== undefined &&
        asyncCompletionRunIds.size < MAX_RUNS
      ) {
        asyncCompletionRunIds.add(completionRunId);
      }
    }
  }
  const aliases: AgentRunIdentityAlias[] = [];
  for (const runId of [...asyncLaunchRunIds].sort()) {
    if (!asyncCompletionRunIds.has(runId) || aliases.length >= MAX_RUNS * 2) {
      continue;
    }
    const canonicalIdentity =
      "subagent-canonical-" +
      canonicalOpaqueDigest(
        "subagent-run",
        sessionId,
        `canonical:async:${runId}`,
      );
    const publicId = opaqueSubagentId(sessionId, runId, "completion");
    aliases.push(
      {
        sourceIdentity: opaqueSubagentSourceIdentity(sessionId, runId, "async"),
        canonicalIdentity,
        publicId,
      },
      {
        sourceIdentity: opaqueSubagentSourceIdentity(
          sessionId,
          runId,
          "completion",
        ),
        canonicalIdentity,
        publicId,
      },
    );
  }
  const observations: Iterable<AgentRunSourceObservation> = {
    *[Symbol.iterator]() {
      const cursor = { value: 0 };
      for (const {
        result,
        publication,
        toolName,
        successfulMatchingResult,
      } of publications) {
        yield* collectRuns(
          result,
          publication,
          sessionId,
          cursor,
          toolName,
          successfulMatchingResult,
        );
      }
    },
  };
  const hasObservations = !observations[Symbol.iterator]().next().done;

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
    observations: hasObservations ? observations : [],
    ...(aliases.length === 0 ? {} : { aliases }),
    state: hasObservations ? "supported" : "unavailable",
    diagnostics: [],
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

function readAsyncLaunchRunId(
  toolName: string,
  result: Readonly<Record<string, unknown>>,
  details: Readonly<Record<string, unknown>>,
): string | undefined {
  if (
    toolName !== "subagent" ||
    result.toolName !== toolName ||
    result.isError !== false ||
    details.mode !== "single" ||
    !Array.isArray(details.results) ||
    details.results.length !== 0
  ) {
    return undefined;
  }
  const runId = readRawRunId(details.runId);
  return runId !== undefined && readRawRunId(details.asyncId) === runId
    ? runId
    : undefined;
}

function isSuppressedAsyncWaitContainer(
  toolName: string,
  completion: Readonly<Record<string, unknown>>,
): boolean {
  return (
    ASYNC_WAIT_TOOL_NAMES.has(toolName) &&
    (completion.mode === "workflow" || completion.mode === "parallel")
  );
}

/** Reads documented `details.results[]`/`details.completions[]` rows. */
function* collectRuns(
  result: Readonly<Record<string, unknown>>,
  publication: RunPublication,
  sessionId: string,
  cursor: ObservationCursor,
  toolName: string,
  successfulMatchingResult: boolean,
): Generator<AgentRunSourceObservation> {
  const details = snapshotRecord(result.details);
  if (details === undefined) return;
  // Aggregate run id used to parent rows that carry no run id of their own.
  // Producer semantics (pi-subagents `Details`, extension-api.md): this is the
  // identity of the run container that published the result - a foreground
  // fan-out run or a workflow run - whose children are its `(runId, index)`
  // members. It is a real parent relationship, but the container is not itself
  // an agent run and is never materialized as an AgentRun row, so the UI states
  // that distinction (L2's `orchestration-run` verdict) rather than reporting a
  // missing parent.
  const aggregateRunId = readRawRunId(details.runId);
  const aggregateParentId =
    aggregateRunId === undefined
      ? undefined
      : opaqueSubagentId(sessionId, aggregateRunId, "foreground-parent");
  const workflowParentId =
    aggregateRunId === undefined
      ? undefined
      : opaqueSubagentId(sessionId, aggregateRunId, "workflow-parent");

  // §8.5 replacement stays scoped to one publication surface. Workflow
  // result keys below attribute evidence to child rows; they never deduplicate
  // the result and workflow AgentRun identities.
  const workflowChildren = snapshotRecord(details.workflowChildren);
  const workflowChildRows = workflowChildren?.children;
  const workflowResultsByKey = readWorkflowResultMatches(
    details,
    workflowChildren,
  );
  const asyncLaunchRunId = readAsyncLaunchRunId(toolName, result, details);
  if (asyncLaunchRunId !== undefined) {
    // One producer async run id owns one public identity for its whole
    // lifecycle: the launch-only row already carries the settled `completion`
    // public id, which is exactly the canonical id the launch/completion
    // aliases below pin, so arriving completion evidence never renames the
    // row. The source identity keeps its distinct `async` surface, so the two
    // publications stay exact and separately addressable in private state.
    yield* pushRun(
      {},
      publication,
      opaqueSubagentId(sessionId, asyncLaunchRunId, "completion"),
      opaqueSubagentSourceIdentity(sessionId, asyncLaunchRunId, "async"),
      undefined,
      "disabled",
      cursor,
      "async",
    );
  }
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
      const effortMode =
        rowRunId === undefined &&
        aggregateRunId !== undefined &&
        index !== undefined
          ? "enabled"
          : "disabled";
      const observationRawId =
        rowRunId !== undefined
          ? rowRunId
          : aggregateRunId === undefined || index === undefined
            ? undefined
            : `${aggregateRunId}#${index}`;
      const id =
        observationRawId === undefined
          ? undefined
          : opaqueSubagentId(sessionId, observationRawId, "foreground");
      const sourceIdentity =
        observationRawId === undefined
          ? undefined
          : opaqueSubagentSourceIdentity(
              sessionId,
              observationRawId,
              "foreground",
            );
      yield* pushRun(
        record,
        publication,
        id,
        sourceIdentity,
        aggregateParentId,
        effortMode,
        cursor,
        undefined,
        toolName === "subagent" && record.detached === true
          ? "detached"
          : undefined,
      );
    }
  }

  if (
    Array.isArray(details.completions) &&
    (!ASYNC_WAIT_TOOL_NAMES.has(toolName) || successfulMatchingResult)
  ) {
    for (const value of details.completions.slice(0, MAX_RUNS)) {
      const completion = snapshotRecord(value);
      if (completion === undefined) continue;
      const completionRunId = readRawRunId(completion.runId);
      const completionId =
        completionRunId === undefined
          ? undefined
          : opaqueSubagentId(sessionId, completionRunId, "completion");
      const completionSourceIdentity =
        completionRunId === undefined
          ? undefined
          : opaqueSubagentSourceIdentity(
              sessionId,
              completionRunId,
              "completion",
            );
      if (!isSuppressedAsyncWaitContainer(toolName, completion)) {
        yield* pushRun(
          completion,
          publication,
          completionId,
          completionSourceIdentity,
          undefined,
          "disabled",
          cursor,
          ASYNC_WAIT_TOOL_NAMES.has(toolName) ? "async" : undefined,
        );
      }
      if (!Array.isArray(completion.results)) continue;
      for (const child of completion.results.slice(0, MAX_RUNS)) {
        const record = snapshotRecord(child);
        if (record === undefined) continue;
        // Nested completion children retain their own identity, but their
        // parent is the exact outer completion identity and domain. This is
        // parentage, not cross-surface correlation.
        const childRunId = readRawRunId(record.runId);
        const childId =
          childRunId === undefined
            ? undefined
            : opaqueSubagentId(sessionId, childRunId, "completion-child");
        const childSourceIdentity =
          childRunId === undefined
            ? undefined
            : opaqueSubagentSourceIdentity(
                sessionId,
                childRunId,
                "completion-child",
              );
        yield* pushRun(
          record,
          publication,
          childId,
          childSourceIdentity,
          completionRunId === undefined
            ? undefined
            : opaqueSubagentId(sessionId, completionRunId, "completion"),
          "disabled",
          cursor,
        );
      }
    }
  }

  // Workflow summaries remain a distinct publication surface. Parse them
  // after other arrays for deterministic output order; correlated evidence
  // does not replace a row from another surface.
  if (Array.isArray(workflowChildRows)) {
    for (const value of workflowChildRows.slice(0, MAX_RUNS)) {
      const record = snapshotRecord(value);
      if (record === undefined) continue;
      const workflowKey = readWorkflowKey(record.childId);
      const matchedResult =
        workflowKey === undefined
          ? undefined
          : workflowResultsByKey.get(workflowKey);
      const hasCorrelatedEffort =
        matchedResult !== undefined &&
        !Object.hasOwn(record, "progressSummary") &&
        Object.hasOwn(matchedResult, "progressSummary");
      const hasCorrelatedUsage =
        matchedResult !== undefined &&
        !Object.hasOwn(record, "usage") &&
        Object.hasOwn(matchedResult, "usage");
      // Workflow child summaries carry identity/state only; usage comes from
      // an exact-key-matched result row.
      const attributedRecord =
        matchedResult === undefined
          ? { ...record, usage: undefined }
          : {
              ...record,
              usage: hasCorrelatedUsage ? matchedResult.usage : undefined,
              ...(hasCorrelatedEffort
                ? { progressSummary: matchedResult.progressSummary }
                : {}),
            };
      const rowRunId = readRawRunId(record.runId);
      const index = readChildIndex(record.index);
      const observationRawId =
        rowRunId !== undefined
          ? rowRunId
          : aggregateRunId === undefined || index === undefined
            ? undefined
            : `${aggregateRunId}#${index}`;
      const id =
        observationRawId === undefined
          ? undefined
          : opaqueSubagentId(sessionId, observationRawId, "workflow");
      const sourceIdentity =
        observationRawId === undefined
          ? undefined
          : opaqueSubagentSourceIdentity(
              sessionId,
              observationRawId,
              "workflow",
            );
      yield* pushRun(
        attributedRecord,
        publication,
        id,
        sourceIdentity,
        workflowParentId,
        hasCorrelatedEffort ? "enabled" : "disabled",
        cursor,
      );
    }
  }
}

function* pushRun(
  record: Readonly<Record<string, unknown>>,
  publication: RunPublication,
  id: string | undefined,
  sourceIdentity: string | undefined,
  parentId: string | undefined,
  effortMode: "enabled" | "disabled",
  cursor: ObservationCursor,
  executionKind?: "async",
  executionDisposition?: "detached",
): Generator<AgentRunSourceObservation> {
  if (id === undefined || sourceIdentity === undefined) return;
  yield {
    sourceIdentity,
    order: cursor.value++,
    run: toAgentRun(
      record,
      publication,
      id,
      parentId,
      effortMode,
      executionKind,
      executionDisposition,
    ),
  };
}

function readEffort(record: Readonly<Record<string, unknown>>): {
  durationMs?: number;
  toolCalls?: number;
} {
  const progress = snapshotRecord(record.progressSummary);
  const durationMs = progress?.durationMs;
  const toolCalls = progress?.toolCount;
  return {
    ...(typeof durationMs === "number" &&
    Number.isSafeInteger(durationMs) &&
    durationMs >= 0 &&
    durationMs <= MAX_DURATION_MS
      ? { durationMs }
      : {}),
    ...(typeof toolCalls === "number" &&
    Number.isSafeInteger(toolCalls) &&
    toolCalls >= 0 &&
    toolCalls <= MAX_AGENT_RUN_TOOL_CALLS
      ? { toolCalls }
      : {}),
  };
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

function toAgentRun(
  record: Readonly<Record<string, unknown>>,
  publication: RunPublication,
  id: string,
  parentId: string | undefined,
  effortMode: "enabled" | "disabled",
  executionKind?: "async",
  executionDisposition?: "detached",
): AgentRun {
  const agent = isAgentLabel(record.agent) ? record.agent : undefined;
  const model = boundedProducerLabel(record.model);
  const thinking = boundedProducerLabel(record.thinking);
  const failure = readAgentFailure(record);
  const usage = readChildUsage(record.usage);
  const effort = effortMode === "enabled" ? readEffort(record) : {};
  const hasTokens = usage?.totalTokens !== undefined;
  const hasCost = usage?.cost !== undefined;
  return {
    id,
    ...(parentId === undefined ? {} : { parentId }),
    ...(executionKind === undefined ? {} : { executionKind }),
    ...(executionDisposition === undefined ? {} : { executionDisposition }),
    ...(agent === undefined ? {} : { agent }),
    status: mapRunStatus(record, executionDisposition),
    confidence: "cooperative",
    ...(usage === undefined ? {} : { usage }),
    ...(publication.observedAt === undefined
      ? {}
      : { observedAt: publication.observedAt }),
    ...(publication.evidenceToolId === undefined
      ? {}
      : { evidenceToolId: publication.evidenceToolId }),
    ...(model === undefined ? {} : { model }),
    ...(thinking === undefined ? {} : { thinking }),
    ...(failure === undefined ? {} : { failure }),
    ...(effort.durationMs === undefined
      ? {}
      : { durationMs: effort.durationMs }),
    ...(effort.toolCalls === undefined ? {} : { toolCalls: effort.toolCalls }),
    effortCoverage: {
      duration: effort.durationMs === undefined ? "unavailable" : "partial",
      generations: "unavailable",
      tools: effort.toolCalls === undefined ? "unavailable" : "partial",
      errors: "unavailable",
      usage: hasTokens ? "partial" : "unavailable",
      cost: hasCost ? "partial" : "unavailable",
    },
  };
}

/**
 * Closed status vocabulary from the documented producer fields. An unknown
 * term resolves to `unknown`; it is never guessed from unrelated fields.
 */
function mapRunStatus(
  record: Readonly<Record<string, unknown>>,
  executionDisposition?: "detached",
): AgentRun["status"] {
  if (
    record.interrupted === true ||
    record.timedOut === true ||
    record.stopped === true
  ) {
    return "interrupted";
  }
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
        return executionDisposition === "detached" ? "unknown" : "running";
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
    return executionDisposition === "detached" && record.exitCode === -2
      ? "unknown"
      : record.exitCode === 0
        ? "succeeded"
        : "failed";
  }
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
function readChildUsage(value: unknown): AgentRunUsage | undefined {
  const usage = snapshotRecord(value);
  if (usage === undefined) return undefined;
  const tokenParts = [
    usage.input,
    usage.output,
    usage.cacheRead,
    usage.cacheWrite,
  ];
  const totalTokens = tokenParts.every(isBoundedTokens)
    ? tokenParts.reduce((total, part) => total + part, 0)
    : undefined;
  const boundedTotalTokens = isBoundedTokens(totalTokens)
    ? totalTokens
    : undefined;
  const cost = isBoundedCost(usage.cost) ? roundCost(usage.cost) : undefined;
  if (boundedTotalTokens === undefined && cost === undefined) return undefined;
  return {
    ...(boundedTotalTokens === undefined
      ? {}
      : { totalTokens: boundedTotalTokens }),
    ...(cost === undefined ? {} : { cost }),
  };
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
      const sourceIdentity = opaqueSubagentSourceIdentity(
        sessionId,
        runId,
        "completion",
      );
      if (!references.has(sourceIdentity) && references.size < MAX_RUNS) {
        references.set(sourceIdentity, { path, runId });
      }
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

function readWorkflowKey(value: unknown): string | undefined {
  return typeof value === "string" && WORKFLOW_KEY.test(value)
    ? value
    : undefined;
}

function readWorkflowResultMatches(
  details: Readonly<Record<string, unknown>>,
  workflowChildren: Readonly<Record<string, unknown>> | undefined,
): Map<string, Readonly<Record<string, unknown>>> {
  const results = details.results;
  const children = workflowChildren?.children;
  if (
    details.mode !== "workflow" ||
    workflowChildren === undefined ||
    Object.keys(workflowChildren).some(
      (field) => !WORKFLOW_SUMMARY_FIELDS.has(field),
    ) ||
    workflowChildren.version !== 1 ||
    !isBoundedWorkflowText(details.runId, MAX_WORKFLOW_ID_BYTES) ||
    !isBoundedWorkflowText(
      workflowChildren.parentToolCallId,
      MAX_WORKFLOW_ID_BYTES,
    ) ||
    workflowChildren.workflowRunId !== details.runId ||
    workflowChildren.inventoryComplete !== true ||
    typeof workflowChildren.workflowState !== "string" ||
    !WORKFLOW_SUMMARY_STATES.has(workflowChildren.workflowState) ||
    !Array.isArray(results) ||
    !Array.isArray(children) ||
    results.length > MAX_RUNS ||
    children.length > MAX_RUNS
  ) {
    return new Map();
  }

  const resultsByKey = new Map<string, Readonly<Record<string, unknown>>>();
  const duplicateResultKeys = new Set<string>();
  for (const value of results) {
    const record = snapshotRecord(value);
    const key = readWorkflowKey(record?.workflowKey);
    if (record === undefined || key === undefined) continue;
    if (resultsByKey.has(key)) duplicateResultKeys.add(key);
    else resultsByKey.set(key, record);
  }

  const childCounts = new Map<string, number>();
  for (const value of children) {
    const record = snapshotRecord(value);
    if (!isSupportedWorkflowChild(record)) return new Map();
    const key = readWorkflowKey(record.childId);
    if (key === undefined) return new Map();
    childCounts.set(key, (childCounts.get(key) ?? 0) + 1);
  }
  for (const key of resultsByKey.keys()) {
    if (duplicateResultKeys.has(key) || childCounts.get(key) !== 1) {
      resultsByKey.delete(key);
    }
  }
  return resultsByKey;
}

function isBoundedWorkflowText(
  value: unknown,
  maxBytes: number,
): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    Buffer.byteLength(value, "utf8") <= maxBytes
  );
}

function isSupportedWorkflowChild(
  value: Readonly<Record<string, unknown>> | undefined,
): value is Readonly<Record<string, unknown>> {
  if (
    value === undefined ||
    Object.keys(value).some((field) => !WORKFLOW_CHILD_FIELDS.has(field)) ||
    readWorkflowKey(value.childId) === undefined ||
    typeof value.state !== "string" ||
    !WORKFLOW_CHILD_STATES.has(value.state)
  ) {
    return false;
  }
  for (const [field, maxBytes] of Object.entries(WORKFLOW_CHILD_TEXT_LIMITS)) {
    if (
      value[field] !== undefined &&
      !isBoundedWorkflowText(value[field], maxBytes)
    ) {
      return false;
    }
  }
  return (
    value.activity === undefined ||
    (value.state === "running" && isSupportedWorkflowActivity(value.activity))
  );
}

function isSupportedWorkflowActivity(value: unknown): boolean {
  const activity = snapshotRecord(value);
  if (activity === undefined) return false;
  return Object.entries(activity).every(([field, counter]) =>
    field === "currentTool"
      ? isBoundedWorkflowText(counter, 256)
      : WORKFLOW_ACTIVITY_COUNTERS.has(field) &&
        typeof counter === "number" &&
        Number.isFinite(counter) &&
        counter >= 0,
  );
}

/** A foreground child's stable identity within its aggregate run. Only a safe
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
 * IDs. Every identity is surface-scoped: the pre-ADR-0022 unscoped digest is
 * not reachable from this adapter.
 */
function opaqueSubagentId(
  sessionId: string,
  id: string,
  surface: string,
): string {
  return `subagent-${canonicalOpaqueDigest("subagent-run", sessionId, `${surface}:${id}`)}`;
}

function opaqueSubagentSourceIdentity(
  sessionId: string,
  id: string,
  surface: string,
): string {
  return `subagent-source-${canonicalOpaqueDigest(
    "subagent-run",
    sessionId,
    `source:${surface}:${id}`,
  )}`;
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

function unavailableEvidence(): SubagentSourceEvidence {
  return {
    activity: {
      state: "unavailable",
      calls: 0,
      succeeded: 0,
      failed: 0,
      interrupted: 0,
      tools: [],
    },
    observations: [],
    state: "unavailable",
    diagnostics: [],
  };
}

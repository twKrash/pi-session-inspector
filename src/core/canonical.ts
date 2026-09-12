import { readPiEntryEvidence } from "../integrations/pi-entries.ts";
import type { SubagentEvidence } from "../integrations/subagents.ts";
import type { ParsedSession } from "../pi/adapter.ts";
import { resolveScope } from "../pi/scope.ts";
import {
  buildEvidenceHealth,
  defaultDiagnosticSeverity,
  type EvidenceDiagnostic,
  type EvidenceDiagnosticCode,
  type EvidenceDiagnosticSeverity,
  type EvidenceHealthState,
  type SessionEvidenceHealth,
  type SourceEvidenceHealth,
} from "./evidence-health.ts";
import {
  boundedProducerLabel,
  type AtomicEvidence,
  type EvidenceSource,
  type FoldedAggregateEvidence,
  type FactProvenance,
  type L0Evidence,
  type LiveTimingObservation,
  type SkillInvocationObservation,
  type TimeEvidence,
} from "./evidence.ts";
import type {
  AgentRun,
  Compaction,
  ErrorRecord,
  EvidenceState,
  Generation,
  IntegrationKey,
  IntegrationObservationInput,
  IntegrationPresence,
  Scope,
  SessionEntry,
  Tool,
  Usage,
  UsageComposition,
} from "./events.ts";
import {
  counterDeltaAfterCursors,
  foldedFromCheckpointAggregates,
  mergeFoldedCounters,
  type CheckpointCounterAggregates,
  type FoldedCounters,
} from "./live-counter-fold.ts";
import { canonicalOpaqueDigest } from "./opaque-id.ts";
import { readUsage, reduceEntries } from "./reduce.ts";
import { boundedDescription, secretLikeValue } from "./redact.ts";
import {
  buildRetainedAggregates,
  isIntegrationKey,
  type CanonicalRetainedAggregates,
  type RetainedAggregateCheckpoint,
} from "./retained-aggregates.ts";

/**
 * L1 canonical session builder (design §6.2, §8, §9, §10, §11). It reconciles
 * every accepted source into one in-memory model plus bounded evidence health.
 * Nothing here reads storage, Pi payload text, or renderer state; every failure
 * becomes a bounded diagnostic or an unavailable state and never crosses the
 * observer boundary. The model is rebuilt in memory and never written.
 */

type WalFold = Extract<
  FoldedAggregateEvidence,
  { kind: "checkpoint-wal-aggregates" }
>;
type ResourceFold = Extract<
  FoldedAggregateEvidence,
  { kind: "checkpoint-resource-aggregates" }
>;

type TimeBasis = Extract<TimeEvidence, { state: "known" }>["basis"];

const MAX_ID_BYTES = 128;
const MAX_USAGE = Number.MAX_SAFE_INTEGER;
const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_TIMESTAMP_LENGTH = 35;
const OPTIONAL_TOKEN_FIELDS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
] as const;
const encoder = new TextEncoder();

export type CanonicalRelationship =
  | { state: "known"; id: string }
  | { state: "unavailable" };

export type CanonicalEntryGraphNode = {
  entryId: string;
  parentId: string | null;
  appendOrdinal: number;
  semanticType: { state: "known"; type: string } | { state: "unknown" };
};

export type CanonicalEntryGraph = { nodes: CanonicalEntryGraphNode[] };

export type CanonicalSkillInvocation = {
  id: string;
  skill: string;
  observedAt: TimeEvidence;
  provenance: {
    source: "integration-telemetry";
    authority: "live";
    recordId: string;
    wal: { writerId: string; writerSequence: number };
    schemaVersion: 1;
  };
};

export type CanonicalLiveTiming = {
  id: string;
  category: "agent" | "turn" | "tool" | "provider" | "model";
  status: "running" | "complete" | "unsupported";
  subjectId?: string;
  startedAt: TimeEvidence;
  endedAt: TimeEvidence;
  durationMs?: number;
  provenance: FactProvenance;
};

export type CanonicalStateTransition = {
  id: string;
  kind: "model" | "thinking";
  value: string;
  provider?: string;
  at: TimeEvidence;
};

export type CanonicalIntegrationEvent = {
  id: string;
  integration: IntegrationKey | "mode";
  presence: IntegrationPresence;
  state: EvidenceState;
  version?: number;
  counters?: Readonly<Record<string, number | boolean>>;
};

export type CanonicalInventoryObservation = {
  observedAt: TimeEvidence;
  commands: readonly {
    name: string;
    source: string;
    sourceLabel: string;
    scope: string;
    origin: string;
    description?: string;
  }[];
  skills: readonly {
    name: string;
    sourceLabel?: string;
    scope?: string;
    origin?: string;
    description?: string;
  }[];
  resources: readonly {
    sourceLabel: string;
    scope: string;
    origin: string;
    commands: number;
    skills: number;
    prompts: number;
    tools: number;
  }[];
  toolSources: Readonly<Record<string, string>>;
};

export type UsageCoverage = {
  state: "complete" | "partial" | "unavailable";
  owners: number;
  ownersWithUsage: number;
};

export type UsageBucket =
  | "generation"
  | "tool-result"
  | "compaction"
  | "branch-summary"
  | "child-run";

export type CanonicalUsageLine = {
  id: string;
  ownerId: string;
  domain: "native-session" | "child-breakdown";
  bucket: UsageBucket;
  usage: Usage;
  contributesToSession: boolean;
  observedAt: TimeEvidence;
  attributedAt: TimeEvidence;
  provenance: FactProvenance;
};

export type CanonicalUsageSummary =
  | {
      state: "known";
      known: Usage;
      composition: UsageComposition;
      lines: CanonicalUsageLine[];
      coverage: Record<UsageBucket, UsageCoverage>;
    }
  | {
      state: "unavailable";
      reason: "overflow";
      lines: CanonicalUsageLine[];
      coverage: Record<UsageBucket, UsageCoverage>;
    };

export type CanonicalSession = {
  schemaVersion: 1;
  sessionId: string;
  formatVersion: 3;
  createdAt: TimeEvidence;
  trackingStartedAt: TimeEvidence;
  parentSession: CanonicalRelationship;
  graph: CanonicalEntryGraph;
  markerEntryId: string;
  /**
   * R49: the scope decision L2 consumes, in resolution order (active ancestry
   * after the marker, or every entry after it). L2 maps these ids back to
   * parsed entries and never re-derives scope; an id without a parsed entry
   * (an unknown-semantic node) is skipped downstream.
   */
  scopedEntryIds: string[];
  generations: Generation[];
  tools: Tool[];
  compactions: Compaction[];
  errors: ErrorRecord[];
  agents: AgentRun[];
  stateTransitions: CanonicalStateTransition[];
  integrationEvents: CanonicalIntegrationEvent[];
  skillInvocations: CanonicalSkillInvocation[];
  liveTimings: CanonicalLiveTiming[];
  inventory?: CanonicalInventoryObservation;
  usage: CanonicalUsageSummary;
  retainedAggregates: CanonicalRetainedAggregates;
  health: SessionEvidenceHealth;
};

export type CanonicalSessionBuildResult =
  | { state: "ready"; session: CanonicalSession }
  | {
      state: "unavailable" | "unsupported";
      health: SessionEvidenceHealth;
    };

export type CanonicalDiagnosticInput = {
  code: EvidenceDiagnosticCode;
  source: EvidenceSource;
  count?: number;
  severity?: EvidenceDiagnosticSeverity;
};

/**
 * Raw retained WAL record shape the builder folds a post-cursor suffix from.
 * It is the same bounded form `src/storage/recovery.ts` replays; no raw
 * producer content is carried.
 *
 * R41: `walRecords` must be WAL-validated records from recovery, not raw
 * producer input. `eventId` and `timestamp` are accepted for shape fidelity
 * with the recovery record but are unused by the builder; only `writerId`,
 * `writerSequence`, and `telemetry` affect the fold.
 */
export type RetainedWalRecord = {
  eventId: string;
  writerId: string;
  writerSequence: number;
  timestamp?: string;
  telemetry?: Record<string, unknown>;
};

/**
 * Structural, already-bounded inventory observation. It mirrors the persisted
 * snapshot shape so a caller can pass `boundInventorySnapshot(...)` unchanged.
 */
export type InventoryObservationInput = {
  observedAt?: string;
  commands: readonly unknown[];
  skills: readonly unknown[];
  resources: readonly unknown[];
  toolSources: Readonly<Record<string, unknown>>;
};

export type CanonicalSessionInput = {
  /**
   * R40: identity comes from `parsed.id`; no separate session id is accepted.
   */
  parsed: ParsedSession;
  scope: Scope;
  leafId: string | null;
  evidence: L0Evidence;
  /**
   * R41: retained, WAL-validated records carrying the post-cursor counter
   * suffix and per-writer sequences. L1 owns folding; L2 does not.
   */
  walRecords?: readonly RetainedWalRecord[];
  /** Saturating dropped-tool-start count from the live registration (R29). */
  liveOverflow?: number;
  subagents?: SubagentEvidence;
  inventory?: InventoryObservationInput;
  parentSession?: CanonicalRelationship;
  /** Bounded diagnostics contributed by the caller's source adapters. */
  diagnostics?: readonly CanonicalDiagnosticInput[];
};

/**
 * The one L1 entry point. It never throws: an unexpected failure degrades to an
 * `unavailable` result with bounded health rather than crossing the observer
 * boundary.
 */
export function buildCanonicalSession(
  input: CanonicalSessionInput,
): CanonicalSessionBuildResult {
  try {
    return build(input);
  } catch {
    return {
      state: "unavailable",
      health: unavailableHealth({
        core: "unavailable",
        recordsSeen: 0,
        factsAccepted: 0,
        recordsRejected: 0,
        diagnostics: [
          {
            code: "source-malformed",
            source: "pi-jsonl",
            severity: "error",
            count: 1,
          },
        ],
      }),
    };
  }
}

/** The canonical health projection. L2 and renderers share this exact value. */
export function projectEvidenceHealth(
  session: CanonicalSession,
): SessionEvidenceHealth {
  return session.health;
}

function build(input: CanonicalSessionInput): CanonicalSessionBuildResult {
  const diagnostics = new DiagnosticAccumulator();
  for (const extra of input.diagnostics ?? []) {
    diagnostics.add(extra.source, extra.code, extra.count ?? 1, extra.severity);
  }

  const parsed = input.parsed;
  if (!parsed.hasSessionHeader) {
    diagnostics.add("pi-jsonl", "source-not-found", 1, "error");
    return {
      state: "unavailable",
      health: healthFor({
        core: "unavailable",
        parsed,
        diagnostics: diagnostics.list(),
      }),
    };
  }
  if (parsed.formatVersion !== 3) {
    diagnostics.add("pi-jsonl", "source-format-unsupported", 1, "error");
    return {
      state: "unsupported",
      health: healthFor({
        core: "unsupported",
        parsed,
        diagnostics: diagnostics.list(),
      }),
    };
  }
  const sessionId = parsed.id;
  if (!isBoundedId(sessionId)) {
    diagnostics.add("pi-jsonl", "source-not-found", 1, "error");
    return {
      state: "unavailable",
      health: healthFor({
        core: "unavailable",
        parsed,
        diagnostics: diagnostics.list(),
      }),
    };
  }

  // Core (Pi+marker reportability) is decided before any semantic work.
  const resolution = resolveScope(
    parsed.entries,
    parsed.graphNodes,
    input.leafId,
    input.scope,
  );
  if (resolution.state === "unavailable") {
    diagnostics.add("pi-jsonl", resolution.reason, 1);
    return {
      state: "unavailable",
      health: healthFor({
        core:
          resolution.reason === "tracking-marker-missing"
            ? "unavailable"
            : "partial",
        parsed,
        diagnostics: diagnostics.list(),
      }),
    };
  }
  if (resolution.duplicateMarkers > 0) {
    diagnostics.add(
      "pi-jsonl",
      "tracking-marker-duplicate",
      resolution.duplicateMarkers,
    );
  }

  const graph = buildGraph(parsed, diagnostics);
  const entryById = new Map(parsed.entries.map((entry) => [entry.id, entry]));
  const entries = resolution.entryIds.flatMap((id) => {
    const entry = entryById.get(id);
    return entry === undefined ? [] : [entry];
  });

  const reduced = reduceEntries(sessionId, entries);
  const usage = buildUsage(entries, reduced, input.subagents, diagnostics);
  const toolResults = entries.filter(
    (entry) =>
      entry.type === "message" &&
      isRecord(entry.message) &&
      entry.message.role === "toolResult",
  ).length;
  const skillInvocations = input.evidence.atomic
    .filter(isSkillInvocation)
    .map(toCanonicalSkillInvocation);
  const liveFacts = input.evidence.atomic.filter(isLiveTiming);
  const liveTimings = liveFacts.map(toCanonicalLiveTiming);
  const tools = correlateLiveDuration(sessionId, reduced.tools, liveFacts);
  const stateTransitions = readStateTransitions(entries);
  const integrationEvents = readIntegrationEvents(entries);
  const agents = [...(input.subagents?.runs ?? [])];
  for (const conflict of input.subagents?.diagnostics ?? []) {
    diagnostics.add("subagent-result", conflict.code, conflict.count);
  }
  const inventory = sanitizeInventory(input.inventory);
  if (
    input.inventory !== undefined &&
    inventory?.observedAt.state !== "known"
  ) {
    diagnostics.add("inventory", "inventory-observation-time-missing", 1);
  }

  const parentSession = normalizeParentSession(
    input.parentSession,
    diagnostics,
  );
  const retained = buildRetainedAggregatesSafely(sessionId, input, diagnostics);

  if (parsed.unknownEntryCount > 0) {
    diagnostics.add("pi-jsonl", "unknown-entry", parsed.unknownEntryCount);
  }
  if (parsed.hasMalformedJson) {
    diagnostics.add("pi-jsonl", "source-malformed", 1, "error");
  }

  const health = healthFor({
    core: parsed.hasMalformedJson ? "partial" : "supported",
    parsed,
    diagnostics: diagnostics.list(),
    usage,
    retained,
    skillInvocations,
    liveFacts,
    liveOverflow: input.liveOverflow,
    tools,
    toolResults,
    agents,
    evidence: input.evidence,
    walRecords: input.walRecords,
    inventory,
    subagents: input.subagents,
  });

  const session: CanonicalSession = {
    schemaVersion: 1,
    sessionId,
    formatVersion: 3,
    createdAt: timeKnown(parsed.createdAt, "pi-session-header"),
    trackingStartedAt: markerTime(parsed, resolution.markerEntryId),
    parentSession,
    graph,
    markerEntryId: resolution.markerEntryId,
    scopedEntryIds: [...resolution.entryIds],
    generations: reduced.generations,
    tools,
    compactions: reduced.compactions,
    errors: reduced.errors,
    agents,
    stateTransitions,
    integrationEvents,
    skillInvocations,
    liveTimings,
    ...(inventory === undefined ? {} : { inventory }),
    usage,
    retainedAggregates: retained.aggregates,
    health,
  };
  return { state: "ready", session };
}

// ---------------------------------------------------------------------------
// Graph, transitions, integrations
// ---------------------------------------------------------------------------

function buildGraph(
  parsed: ParsedSession,
  diagnostics: DiagnosticAccumulator,
): CanonicalEntryGraph {
  const nodes: CanonicalEntryGraphNode[] = parsed.graphNodes.map((node) => ({
    entryId: node.entryId,
    parentId: node.parentId,
    appendOrdinal: node.appendOrdinal,
    semanticType: node.semanticType,
  }));
  const ids = new Set(nodes.map((node) => node.entryId));
  const seen = new Set<string>();
  let duplicates = 0;
  let orphaned = 0;
  for (const node of nodes) {
    if (seen.has(node.entryId)) duplicates++;
    else seen.add(node.entryId);
  }
  for (const node of nodes) {
    if (node.parentId !== null && !ids.has(node.parentId)) orphaned++;
  }
  if (duplicates > 0) {
    diagnostics.add("pi-jsonl", "duplicate-entry-id", duplicates);
  }
  if (orphaned > 0) {
    diagnostics.add("pi-jsonl", "missing-entry-parent", orphaned);
  }
  return { nodes };
}

function readStateTransitions(
  entries: readonly SessionEntry[],
): CanonicalStateTransition[] {
  const transitions: CanonicalStateTransition[] = [];
  for (const entry of entries) {
    if (entry.type === "model_change") {
      const value = boundedProducerLabel(entry.modelId);
      if (value === undefined) continue;
      const provider = boundedProducerLabel(entry.provider);
      transitions.push({
        id: `transition:${entry.id}:model`,
        kind: "model",
        value,
        ...(provider === undefined ? {} : { provider }),
        at: timeKnown(entry.timestamp, "pi-entry"),
      });
    } else if (entry.type === "thinking_level_change") {
      const value = boundedProducerLabel(entry.thinkingLevel);
      if (value === undefined) continue;
      transitions.push({
        id: `transition:${entry.id}:thinking`,
        kind: "thinking",
        value,
        at: timeKnown(entry.timestamp, "pi-entry"),
      });
    }
  }
  return transitions;
}

function readIntegrationEvents(
  entries: readonly SessionEntry[],
): CanonicalIntegrationEvent[] {
  return readPiEntryEvidence(entries).map(
    (row: IntegrationObservationInput) => {
      const presence =
        row.presence ?? (row.state === "supported" ? "present" : "unknown");
      return {
        id: `integration:${row.integration}`,
        integration: row.integration,
        presence,
        state: row.state,
        ...(row.version === undefined ? {} : { version: row.version }),
        ...(row.counters === undefined ? {} : { counters: row.counters }),
      };
    },
  );
}

// ---------------------------------------------------------------------------
// Skill invocations and live timings
// ---------------------------------------------------------------------------

function isSkillInvocation(
  fact: AtomicEvidence,
): fact is SkillInvocationObservation {
  return fact.kind === "skill-invocation";
}

function isLiveTiming(fact: AtomicEvidence): fact is LiveTimingObservation {
  return fact.kind === "live-timing";
}

function toCanonicalSkillInvocation(
  fact: SkillInvocationObservation,
): CanonicalSkillInvocation {
  return {
    id: fact.factId,
    skill: fact.skill,
    observedAt: fact.time,
    provenance: {
      source: "integration-telemetry",
      authority: "live",
      recordId: fact.wal.eventId,
      wal: {
        writerId: fact.wal.writerId,
        writerSequence: fact.wal.writerSequence,
      },
      schemaVersion: 1,
    },
  };
}

function toCanonicalLiveTiming(
  fact: LiveTimingObservation,
): CanonicalLiveTiming {
  return {
    id: fact.factId,
    category: fact.category,
    status: fact.status,
    ...(fact.subjectId === undefined ? {} : { subjectId: fact.subjectId }),
    startedAt: timeKnown(fact.startedAt, "wal-observer"),
    endedAt: timeKnown(fact.endedAt, "wal-observer"),
    ...(fact.durationMs === undefined ? {} : { durationMs: fact.durationMs }),
    provenance: {
      source: "inspector-wal",
      authority: "live",
      ...(fact.provenance.recordId === undefined
        ? {}
        : { recordId: fact.provenance.recordId }),
      schemaVersion: 1,
    },
  };
}

/**
 * Per-tool duration exists only from an exact live subject correlation (§13.1):
 * the native call id is hashed through the shared helper and matched against a
 * completed `live-tool-` subject. Name or time proximity never links a row.
 */
function correlateLiveDuration(
  sessionId: string,
  tools: readonly Tool[],
  liveFacts: readonly LiveTimingObservation[],
): Tool[] {
  const durationBySubject = new Map<string, number>();
  for (const fact of liveFacts) {
    if (fact.category !== "tool" || fact.status !== "complete") continue;
    if (fact.subjectId === undefined || fact.durationMs === undefined) continue;
    if (!durationBySubject.has(fact.subjectId)) {
      durationBySubject.set(fact.subjectId, fact.durationMs);
    }
  }
  if (durationBySubject.size === 0) return [...tools];
  return tools.map((tool) => {
    const subject = toolSubjectId(sessionId, tool.id);
    if (subject.length === 0) return tool;
    const durationMs = durationBySubject.get(subject);
    return durationMs === undefined ? tool : { ...tool, durationMs };
  });
}

/** Returns the subject only when it is the canonical `live-tool-<64hex>` form. */
function toolSubjectId(sessionId: string, toolId: string): string {
  const rawId = toolId.startsWith("tool:") ? toolId.slice("tool:".length) : "";
  if (rawId.length === 0) return "";
  try {
    return `live-tool-${canonicalOpaqueDigest("live-tool", sessionId, rawId)}`;
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Usage ledger
// ---------------------------------------------------------------------------

function buildUsage(
  entries: readonly SessionEntry[],
  reduced: ReturnType<typeof reduceEntries>,
  subagents: SubagentEvidence | undefined,
  diagnostics: DiagnosticAccumulator,
): CanonicalUsageSummary {
  const presence = readUsagePresence(entries);
  const lines: CanonicalUsageLine[] = [];

  // Spec §7.2 gate 8: a present-but-invalid usage record is rejected, its
  // owner fact is preserved, and the affected bucket is marked partial. Emit a
  // single bounded diagnostic whose count reflects the rejected owners.
  if (presence.invalidUsage.size > 0) {
    diagnostics.add("pi-jsonl", "usage-invalid", presence.invalidUsage.size);
  }

  for (const generation of reduced.generations) {
    const entryId = generation.id.replace(/^generation:/, "");
    // Spec §10.2: missing usage never creates a zero-valued line.
    if (!presence.generationsWithUsage.has(entryId)) continue;
    lines.push({
      id: `usage-line:generation:${entryId}`,
      ownerId: generation.id,
      domain: "native-session",
      bucket: "generation",
      usage: generation.usage,
      contributesToSession: true,
      observedAt: timeKnown(generation.timestamp, "pi-entry"),
      attributedAt: timeKnown(generation.timestamp, "pi-entry"),
      provenance: nativeProvenance(entryId),
    });
  }
  for (const tool of reduced.tools) {
    if (tool.usage === undefined) continue;
    const entryId = tool.id.startsWith("tool:")
      ? tool.id.slice("tool:".length)
      : tool.id;
    lines.push({
      id: `usage-line:tool:${tool.id}`,
      ownerId: tool.id,
      domain: "native-session",
      bucket: "tool-result",
      usage: tool.usage,
      contributesToSession: true,
      observedAt: timeKnown(tool.timestamp, "pi-entry"),
      attributedAt: timeKnown(tool.timestamp, "pi-entry"),
      provenance: nativeProvenance(entryId),
    });
  }
  for (const compaction of reduced.compactions) {
    const entryId = compaction.id.replace(/^compaction:/, "");
    // Spec §10.2: a usage-less compaction contributes no fabricated zero. A
    // branch summary is a disjoint owner family, so its usage presence is
    // tracked separately; gating both on `compactionsWithUsage` made the
    // `branch-summary` bucket unreachable.
    const withUsage =
      compaction.kind === "branch_summary"
        ? presence.branchSummariesWithUsage
        : presence.compactionsWithUsage;
    if (!withUsage.has(entryId)) continue;
    lines.push({
      id: `usage-line:compaction:${entryId}`,
      ownerId: compaction.id,
      domain: "native-session",
      bucket:
        compaction.kind === "branch_summary" ? "branch-summary" : "compaction",
      usage: compaction.usage,
      contributesToSession: true,
      observedAt: timeKnown(compaction.timestamp, "pi-entry"),
      attributedAt: timeKnown(compaction.timestamp, "pi-entry"),
      provenance: nativeProvenance(entryId),
    });
  }
  for (const run of subagents?.runs ?? []) {
    if (run.usage === undefined) continue;
    lines.push({
      id: `usage-line:child:${run.id}`,
      ownerId: run.id,
      domain: "child-breakdown",
      bucket: "child-run",
      usage: run.usage,
      // Child usage is a breakdown; it never enters a session total.
      contributesToSession: false,
      observedAt: timeKnown(run.observedAt, "pi-publication-entry"),
      attributedAt: timeKnown(run.observedAt, "pi-publication-entry"),
      provenance: {
        source: "subagent-result",
        authority: "cooperative",
        recordId: run.id,
      },
    });
  }

  const coverage: Record<UsageBucket, UsageCoverage> = {
    generation: coverageOf(
      presence.generations.size,
      presence.generationsWithUsage.size,
    ),
    "tool-result": coverageOf(
      presence.toolCalls.size,
      presence.toolCallsWithUsage.size,
    ),
    compaction: coverageOf(
      presence.compactions.size,
      presence.compactionsWithUsage.size,
    ),
    "branch-summary": coverageOf(
      presence.branchSummaries.size,
      presence.branchSummariesWithUsage.size,
    ),
    "child-run": coverageOf(
      subagents?.runs.length ?? 0,
      (subagents?.runs ?? []).filter((run) => run.usage !== undefined).length,
    ),
  };

  const composition: UsageComposition = {
    generations: zeroUsage(),
    toolResults: zeroUsage(),
    compactions: zeroUsage(),
    branchSummaries: zeroUsage(),
  };
  let known = zeroUsage();
  let overflow = false;
  for (const line of lines) {
    if (!line.contributesToSession) continue;
    const nextTotal = safeAdd(known, line.usage);
    const bucket = compositionBucket(line.bucket);
    const nextBucket = safeAdd(composition[bucket], line.usage);
    if (nextTotal === undefined || nextBucket === undefined) {
      overflow = true;
      break;
    }
    known = nextTotal;
    composition[bucket] = nextBucket;
  }
  if (overflow) {
    // A clamped aggregate is never published: bounded lines remain, the
    // aggregate state becomes unavailable, and usage health turns partial.
    diagnostics.add("pi-jsonl", "usage-overflow", 1, "error");
    return { state: "unavailable", reason: "overflow", lines, coverage };
  }

  if (!compositionEqual(composition, known)) {
    diagnostics.add("pi-jsonl", "usage-reconciliation-mismatch", 1, "error");
  }
  return { state: "known", known, composition, lines, coverage };
}

function compositionBucket(bucket: UsageBucket): keyof UsageComposition {
  if (bucket === "generation") return "generations";
  if (bucket === "tool-result") return "toolResults";
  if (bucket === "branch-summary") return "branchSummaries";
  return "compactions";
}

function nativeProvenance(recordId: string): FactProvenance {
  return {
    source: "pi-jsonl",
    authority: "native",
    recordId,
    schemaVersion: 3,
  };
}

function zeroUsage(): Usage {
  return { totalTokens: 0, cost: 0 };
}

function coverageOf(owners: number, ownersWithUsage: number): UsageCoverage {
  if (owners === 0) {
    return { state: "unavailable", owners: 0, ownersWithUsage: 0 };
  }
  return {
    state: ownersWithUsage >= owners ? "complete" : "partial",
    owners,
    ownersWithUsage,
  };
}

type UsagePresence = {
  generations: Set<string>;
  generationsWithUsage: Set<string>;
  compactions: Set<string>;
  compactionsWithUsage: Set<string>;
  branchSummaries: Set<string>;
  branchSummariesWithUsage: Set<string>;
  toolCalls: Set<string>;
  toolCallsWithUsage: Set<string>;
  /** `${bucket}\u0000${ownerId}` where usage is present but fails `readUsage`. */
  invalidUsage: Set<string>;
};

/**
 * Exact owner/usage presence read from the scoped entries, so a missing usage
 * value makes a bucket partial instead of contributing a fabricated zero. The
 * `*WithUsage` sets hold only owners whose record passes the reducer's own
 * validator, so a present-but-invalid record can never fabricate a zero line or
 * claim completeness; it is tracked separately in `invalidUsage` (spec §7.2
 * gate 8).
 */
function readUsagePresence(entries: readonly SessionEntry[]): UsagePresence {
  const presence: UsagePresence = {
    generations: new Set(),
    generationsWithUsage: new Set(),
    compactions: new Set(),
    compactionsWithUsage: new Set(),
    branchSummaries: new Set(),
    branchSummariesWithUsage: new Set(),
    toolCalls: new Set(),
    toolCallsWithUsage: new Set(),
    invalidUsage: new Set(),
  };
  for (const entry of entries) {
    if (entry.type === "message" && isRecord(entry.message)) {
      const message = entry.message;
      if (message.role === "assistant") {
        presence.generations.add(entry.id);
        trackUsage(presence, "generation", entry.id, message.usage);
      } else if (message.role === "toolResult") {
        const callId = message.toolCallId;
        if (typeof callId === "string" && callId.length > 0) {
          presence.toolCalls.add(callId);
          trackUsage(presence, "tool-result", callId, message.usage);
        }
      }
    } else if (entry.type === "compaction") {
      presence.compactions.add(entry.id);
      trackUsage(presence, "compaction", entry.id, entry.usage);
    } else if (entry.type === "branch_summary") {
      presence.branchSummaries.add(entry.id);
      trackUsage(presence, "branch-summary", entry.id, entry.usage);
    }
  }
  return presence;
}

/**
 * Structural presence is kept for the owner set; only a validated read enters
 * the `WithUsage` set. A structurally present record the reducer rejects is
 * recorded in `invalidUsage` for the bounded diagnostic.
 */
function trackUsage(
  presence: UsagePresence,
  bucket: UsageBucket,
  ownerId: string,
  value: unknown,
): void {
  if (!isRecord(value)) return;
  if (readUsage(value) === undefined) {
    presence.invalidUsage.add(`${bucket}\u0000${ownerId}`);
    return;
  }
  const target =
    bucket === "generation"
      ? presence.generationsWithUsage
      : bucket === "tool-result"
        ? presence.toolCallsWithUsage
        : bucket === "compaction"
          ? presence.compactionsWithUsage
          : presence.branchSummariesWithUsage;
  target.add(ownerId);
}

function safeAdd(left: Usage, right: Usage): Usage | undefined {
  const totalTokens = left.totalTokens + right.totalTokens;
  const cost = roundCost(left.cost + right.cost);
  if (!isSafeToken(totalTokens) || !isSafeCost(cost)) return undefined;
  const next: Usage = { totalTokens, cost };
  for (const field of OPTIONAL_TOKEN_FIELDS) {
    const leftValue = left[field];
    const rightValue = right[field];
    if (leftValue === undefined && rightValue === undefined) continue;
    const sum = (leftValue ?? 0) + (rightValue ?? 0);
    if (!isSafeToken(sum)) return undefined;
    next[field] = sum;
  }
  return next;
}

function compositionEqual(
  composition: UsageComposition,
  known: Usage,
): boolean {
  let total = zeroUsage();
  for (const bucket of [
    composition.generations,
    composition.toolResults,
    composition.compactions,
    composition.branchSummaries,
  ]) {
    const next = safeAdd(total, bucket);
    if (next === undefined) return false;
    total = next;
  }
  return total.totalTokens === known.totalTokens && total.cost === known.cost;
}

function roundCost(value: number): number {
  return Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
}

function isSafeToken(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isSafeCost(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= MAX_USAGE;
}

// ---------------------------------------------------------------------------
// Retained aggregates (R38 single path)
// ---------------------------------------------------------------------------

type RetainedBuild = {
  aggregates: CanonicalRetainedAggregates;
  invalid: boolean;
};

/**
 * R38: checkpoint skill values are a hybrid, never a total. Exactly one path:
 * `buildRetainedAggregates` is asked for the folded projection plus the exact
 * boundary/labels with empty retained inputs, and the retained suffix is
 * computed here as `mergeFoldedCounters(foldedFromCheckpointAggregates(...),
 * counterDeltaAfterCursors(...))`. A throw is mapped to the bounded
 * `checkpoint-aggregate-invalid` diagnostic and never escapes.
 */
function buildRetainedAggregatesSafely(
  sessionId: string,
  input: CanonicalSessionInput,
  diagnostics: DiagnosticAccumulator,
): RetainedBuild {
  const wal = input.evidence.folded.find(isWalFold);
  const resources = input.evidence.folded.find(isResourceFold);
  if (wal === undefined && resources === undefined) {
    return { aggregates: expiredRetained(), invalid: false };
  }

  const foldedThrough = { ...(wal?.foldedThrough ?? {}) };
  const sealedThrough = { ...(wal?.sealedThrough ?? {}) };
  const checkpoint: RetainedAggregateCheckpoint = {
    aggregates: {
      ...(wal?.integrationCounters === undefined
        ? {}
        : { integrationCounters: wal.integrationCounters }),
      ...(wal?.skillInvocations === undefined
        ? {}
        : { skillInvocations: wal.skillInvocations }),
      ...(wal?.skillOverflowInvocations === undefined
        ? {}
        : { skillOverflowInvocations: wal.skillOverflowInvocations }),
      ...(wal?.presence === undefined ? {} : { presence: wal.presence }),
      ...resourceCountsFor(resources),
    },
    cursors: { wal: foldedThrough },
    sealedWal: sealedThrough,
    evidence: checkpointEvidence(wal),
  };

  try {
    const sequences = lastSequence(input);
    const foldedOnly = buildRetainedAggregates({
      sessionId,
      checkpoint,
      retained: {
        skillNames: [],
        counters: {},
        permissionPresence: false,
        ...(sequences === undefined ? {} : { lastSequence: sequences }),
      },
    });
    const suffix = mergeRetainedSuffix(wal, input.walRecords ?? []);
    return { aggregates: supplement(foldedOnly, suffix), invalid: false };
  } catch {
    diagnostics.add("checkpoint", "checkpoint-aggregate-invalid", 1, "error");
    return { aggregates: expiredRetained(), invalid: true };
  }
}

function isWalFold(folded: FoldedAggregateEvidence): folded is WalFold {
  return folded.kind === "checkpoint-wal-aggregates";
}

function isResourceFold(
  folded: FoldedAggregateEvidence,
): folded is ResourceFold {
  return folded.kind === "checkpoint-resource-aggregates";
}

type ResourceCounts = NonNullable<
  RetainedAggregateCheckpoint["aggregates"]
>["resourceCounts"];

function resourceCountsFor(resources: ResourceFold | undefined): {
  resourceCounts?: ResourceCounts;
} {
  if (resources === undefined) return {};
  const counts = resources.resourceCounts;
  // buildResourceCounts omits an incomplete pair; do not fabricate a zero.
  if (
    typeof counts.commands !== "number" ||
    typeof counts.skills !== "number"
  ) {
    return {};
  }
  const observedAt = resources.observedAt;
  return {
    resourceCounts: {
      commands: counts.commands,
      skills: counts.skills,
      ...(counts.resources === undefined
        ? {}
        : { resources: counts.resources }),
      ...(counts.toolSources === undefined
        ? {}
        : { toolSources: counts.toolSources }),
      ...(observedAt.state === "known" ? { observedAt: observedAt.at } : {}),
    },
  };
}

function checkpointEvidence(
  wal: WalFold | undefined,
): RetainedAggregateCheckpoint["evidence"] {
  if (wal === undefined) return undefined;
  const checkpointedAt =
    wal.checkpointedAt.state === "known" ? wal.checkpointedAt.at : undefined;
  const detailExpiredBefore = wal.detailExpiredBefore;
  if (checkpointedAt === undefined && detailExpiredBefore === undefined) {
    return undefined;
  }
  return {
    ...(checkpointedAt === undefined ? {} : { checkpointedAt }),
    ...(detailExpiredBefore === undefined
      ? {}
      : { detailCoverage: { walDetailExpiredBefore: detailExpiredBefore } }),
  };
}

/** Max retained WAL sequence per writer, so the boundary check is armed (R38). */
function lastSequence(
  input: CanonicalSessionInput,
): Record<string, number> | undefined {
  const sequences: Record<string, number> = {};
  for (const record of input.walRecords ?? []) {
    if (!isBoundedId(record.writerId) || !isSequence(record.writerSequence)) {
      continue;
    }
    sequences[record.writerId] = Math.max(
      sequences[record.writerId] ?? 0,
      record.writerSequence,
    );
  }
  for (const fact of input.evidence.atomic) {
    if (fact.kind !== "skill-invocation") continue;
    sequences[fact.wal.writerId] = Math.max(
      sequences[fact.wal.writerId] ?? 0,
      fact.wal.writerSequence,
    );
  }
  return Object.keys(sequences).length === 0 ? undefined : sequences;
}

/**
 * The retained atomic suffix: counters folded strictly after the checkpoint
 * cursor, unioned once with the already-folded prefix.
 */
function mergeRetainedSuffix(
  wal: WalFold | undefined,
  records: readonly RetainedWalRecord[],
): FoldedCounters {
  const folded = foldedFromCheckpointAggregates(toCheckpointCounters(wal));
  const delta = counterDeltaAfterCursors(
    records.map((record) => ({
      writerId: record.writerId,
      writerSequence: record.writerSequence,
      ...(record.telemetry === undefined
        ? {}
        : { telemetry: record.telemetry }),
    })),
    wal?.foldedThrough ?? {},
  );
  return mergeFoldedCounters(folded, delta);
}

function toCheckpointCounters(
  wal: WalFold | undefined,
): CheckpointCounterAggregates | undefined {
  if (wal === undefined) return undefined;
  return {
    ...(wal.integrationCounters === undefined
      ? {}
      : { integrationCounters: wal.integrationCounters }),
    ...(wal.skillInvocations === undefined
      ? {}
      : { skillInvocations: wal.skillInvocations }),
    ...(wal.skillOverflowInvocations === undefined
      ? {}
      : { skillOverflowInvocations: wal.skillOverflowInvocations }),
    ...(wal.presence === undefined ? {} : { presence: wal.presence }),
  };
}

/**
 * Overrides the folded-only aggregate values with the union of folded prefix
 * and retained atomic suffix, once per key. Only an aggregate-only boundary
 * publishes values; a `full` boundary keeps atomic detail authoritative and an
 * `expired` boundary publishes nothing.
 */
function supplement(
  foldedOnly: CanonicalRetainedAggregates,
  suffix: FoldedCounters,
): CanonicalRetainedAggregates {
  if (foldedOnly.boundary.detail !== "aggregate-only") return foldedOnly;
  const boundary = {
    foldedThrough: foldedOnly.boundary.foldedThrough,
    sealedThrough: foldedOnly.boundary.sealedThrough,
  };
  const integration: NonNullable<CanonicalRetainedAggregates["integration"]> = {
    ...(foldedOnly.integration ?? {}),
  };
  for (const key of Object.keys(suffix.counters).sort()) {
    // Re-apply the validated canonical key set: a pattern-valid but
    // non-canonical key can never be republished through the cast.
    if (!isIntegrationKey(key)) continue;
    const counters = suffix.counters[key];
    if (counters === undefined || Object.keys(counters).length === 0) continue;
    integration[key] = {
      value: counters,
      state: "aggregate-only",
      boundary,
    };
  }
  const named =
    Object.keys(suffix.skillInvocations).length === 0
      ? foldedOnly.skillInvocations?.named
      : {
          value: { ...suffix.skillInvocations },
          state: "aggregate-only" as const,
          boundary,
        };
  const overflow =
    suffix.otherInvocations === 0
      ? foldedOnly.skillInvocations?.overflow
      : {
          value: suffix.otherInvocations,
          state: "aggregate-only" as const,
          boundary,
        };
  const permissionPresence = suffix.presence.permission
    ? { value: true as const, state: "aggregate-only" as const, boundary }
    : foldedOnly.permissionPresence;
  return {
    ...foldedOnly,
    ...(Object.keys(integration).length === 0 ? {} : { integration }),
    ...(named === undefined && overflow === undefined
      ? {}
      : {
          skillInvocations: {
            ...(named === undefined ? {} : { named }),
            ...(overflow === undefined ? {} : { overflow }),
          },
        }),
    ...(permissionPresence === undefined ? {} : { permissionPresence }),
  };
}

function expiredRetained(): CanonicalRetainedAggregates {
  return {
    schemaVersion: 1,
    boundary: {
      detail: "expired",
      foldedThrough: {},
      sealedThrough: {},
      checkpointedAt: { state: "unavailable" },
    },
  };
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

const MAX_INVENTORY_COMMANDS = 256;
const MAX_INVENTORY_SKILLS = 128;
const MAX_INVENTORY_RESOURCES = 64;
const INVENTORY_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const INVENTORY_SOURCES = new Set(["extension", "prompt", "skill"]);
const INVENTORY_SCOPES = new Set(["user", "project", "temporary"]);
const INVENTORY_ORIGINS = new Set(["package", "top-level"]);
const MAX_SOURCE_LABEL_BYTES = 64;

/**
 * Re-validates the already-bounded snapshot into a canonical observation. A
 * malformed row is dropped, never repaired; `observedAt` is never inferred.
 */
function sanitizeInventory(
  input: InventoryObservationInput | undefined,
): CanonicalInventoryObservation | undefined {
  if (input === undefined) return undefined;
  const toolSources: Record<string, string> = Object.create(null);
  for (const name of Object.keys(input.toolSources).sort().slice(0, 256)) {
    const label = boundedSourceLabel(input.toolSources[name]);
    if (INVENTORY_NAME.test(name) && label !== undefined) {
      toolSources[name] = label;
    }
  }
  return {
    observedAt: timeKnown(input.observedAt, "inventory-observer"),
    commands: sanitizeRows(input.commands, MAX_INVENTORY_COMMANDS).flatMap(
      (row) => {
        const name = boundedName(row.name);
        const source = row.source;
        const sourceLabel = boundedSourceLabel(row.sourceLabel);
        if (name === undefined || sourceLabel === undefined) return [];
        if (typeof source !== "string" || !INVENTORY_SOURCES.has(source)) {
          return [];
        }
        const description = boundedDescription(row.description, 120);
        return [
          {
            name,
            source,
            sourceLabel,
            scope: readScope(row.scope),
            origin: readOrigin(row.origin),
            ...(description === undefined ? {} : { description }),
          },
        ];
      },
    ),
    skills: sanitizeRows(input.skills, MAX_INVENTORY_SKILLS).flatMap((row) => {
      const name = boundedName(row.name);
      if (name === undefined) return [];
      const sourceLabel = boundedSourceLabel(row.sourceLabel);
      const description = boundedDescription(row.description, 120);
      return [
        {
          name,
          ...(sourceLabel === undefined ? {} : { sourceLabel }),
          ...(row.scope === undefined ? {} : { scope: readScope(row.scope) }),
          ...(row.origin === undefined
            ? {}
            : { origin: readOrigin(row.origin) }),
          ...(description === undefined ? {} : { description }),
        },
      ];
    }),
    resources: sanitizeRows(input.resources, MAX_INVENTORY_RESOURCES).flatMap(
      (row) => {
        const sourceLabel = boundedSourceLabel(row.sourceLabel);
        const commands = safeCount(row.commands);
        const skills = safeCount(row.skills);
        const prompts = safeCount(row.prompts);
        const tools = safeCount(row.tools);
        if (
          sourceLabel === undefined ||
          commands === undefined ||
          skills === undefined ||
          prompts === undefined ||
          tools === undefined
        ) {
          return [];
        }
        return [
          {
            sourceLabel,
            scope: readScope(row.scope),
            origin: readOrigin(row.origin),
            commands,
            skills,
            prompts,
            tools,
          },
        ];
      },
    ),
    toolSources,
  };
}

function sanitizeRows(
  values: readonly unknown[],
  max: number,
): Record<string, unknown>[] {
  return values
    .slice(0, max)
    .filter(
      (value): value is Record<string, unknown> =>
        typeof value === "object" && value !== null && !Array.isArray(value),
    );
}

function boundedName(value: unknown): string | undefined {
  return typeof value === "string" && INVENTORY_NAME.test(value)
    ? value
    : undefined;
}

function boundedSourceLabel(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  if (encoder.encode(value).byteLength > MAX_SOURCE_LABEL_BYTES)
    return undefined;
  if (secretLikeValue(value)) return undefined;
  return value;
}

function readScope(value: unknown): string {
  return typeof value === "string" && INVENTORY_SCOPES.has(value)
    ? value
    : "temporary";
}

function readOrigin(value: unknown): string {
  return typeof value === "string" && INVENTORY_ORIGINS.has(value)
    ? value
    : "top-level";
}

function safeCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

// ---------------------------------------------------------------------------
// Health assembly
// ---------------------------------------------------------------------------

type HealthContext = {
  core: EvidenceHealthState;
  parsed: ParsedSession;
  diagnostics: EvidenceDiagnostic[];
  usage?: CanonicalUsageSummary;
  retained?: RetainedBuild;
  skillInvocations?: readonly CanonicalSkillInvocation[];
  liveFacts?: readonly LiveTimingObservation[];
  liveOverflow?: number;
  tools?: readonly Tool[];
  toolResults?: number;
  agents?: readonly AgentRun[];
  evidence?: L0Evidence;
  walRecords?: readonly RetainedWalRecord[];
  inventory?: CanonicalInventoryObservation;
  subagents?: SubagentEvidence;
};

function healthFor(context: HealthContext): SessionEvidenceHealth {
  const usage = context.usage;
  const retained = context.retained;
  const skills = context.skillInvocations ?? [];
  const liveFacts = context.liveFacts ?? [];
  const tools = context.tools ?? [];
  const agents = context.agents ?? [];
  const walRecords = context.walRecords;
  const subagents = context.subagents;

  const nativeLines =
    usage?.lines.filter((line) => line.domain === "native-session").length ?? 0;
  const childLines =
    usage?.lines.filter((line) => line.domain === "child-breakdown").length ??
    0;
  const correlatedTools = tools.filter(
    (tool) => tool.durationMs !== undefined,
  ).length;
  // Live-source partiality derives from native tool calls vs correlated live
  // subjects, never process memory alone; a supplied overflow count adds to it.
  const livePartial =
    (context.liveOverflow ?? 0) > 0 ||
    (tools.length > 0 && correlatedTools < tools.length) ||
    liveFacts.some((fact) => fact.status === "running");
  const hasWalEvidence = (walRecords?.length ?? 0) > 0 || liveFacts.length > 0;

  const sources: SourceEvidenceHealth[] = [
    {
      source: "pi-jsonl",
      authority: "native",
      state: context.core === "unsupported" ? "unsupported" : context.core,
      schemaVersion: 3,
      recordsSeen:
        context.parsed.entries.length + context.parsed.unknownEntryCount,
      factsAccepted: context.parsed.entries.length,
      recordsRejected: context.parsed.unknownEntryCount,
      detail:
        context.core === "unsupported"
          ? "unsupported"
          : context.core === "unavailable"
            ? "not-observed"
            : "full",
    },
    {
      source: "inspector-wal",
      authority: "live",
      state: hasWalEvidence
        ? livePartial
          ? "partial"
          : "supported"
        : "unavailable",
      ...(hasWalEvidence ? { schemaVersion: 1 } : {}),
      recordsSeen: Math.max(walRecords?.length ?? 0, liveFacts.length),
      factsAccepted: liveFacts.length,
      recordsRejected: 0,
      detail: hasWalEvidence ? "full" : "not-observed",
    },
  ];
  if (skills.length > 0) {
    sources.push({
      source: "integration-telemetry",
      authority: "live",
      state: "supported",
      schemaVersion: 1,
      recordsSeen: skills.length,
      factsAccepted: skills.length,
      recordsRejected: 0,
      detail: "full",
    });
  }
  if (context.evidence !== undefined && context.evidence.folded.length > 0) {
    const invalid = retained?.invalid ?? false;
    const detail = retained?.aggregates.boundary.detail ?? "expired";
    sources.push({
      source: "checkpoint",
      authority: "derived",
      state: invalid
        ? "partial"
        : detail === "expired"
          ? "expired"
          : "supported",
      schemaVersion: 1,
      recordsSeen: context.evidence.folded.length,
      factsAccepted: context.evidence.folded.length - (invalid ? 1 : 0),
      recordsRejected: invalid ? 1 : 0,
      detail: detail === "expired" ? "aggregate-only" : detail,
      ...(retained?.aggregates.boundary.detailExpiredBefore === undefined
        ? {}
        : { expiredBefore: retained.aggregates.boundary.detailExpiredBefore }),
    });
  }
  if (context.inventory !== undefined) {
    sources.push({
      source: "inventory",
      authority: "observed",
      state:
        context.inventory.observedAt.state === "known"
          ? "supported"
          : "partial",
      schemaVersion: 1,
      recordsSeen: 1,
      factsAccepted: 1,
      recordsRejected: 0,
      detail: "full",
      ...(context.inventory.observedAt.state === "known"
        ? { observedAt: context.inventory.observedAt.at }
        : {}),
    });
  }
  if (subagents !== undefined) {
    sources.push({
      source: "subagent-result",
      authority: "cooperative",
      state: subagents.state === "supported" ? "supported" : "unavailable",
      schemaVersion: 1,
      recordsSeen: subagents.runs.length,
      factsAccepted: subagents.runs.length,
      recordsRejected: 0,
      detail: "full",
    });
    const artifacts = subagents.runs.filter(
      (run) => run.artifacts !== undefined,
    ).length;
    if (artifacts > 0) {
      sources.push({
        source: "subagent-archive",
        authority: "cooperative",
        state: "supported",
        schemaVersion: 1,
        recordsSeen: artifacts,
        factsAccepted: artifacts,
        recordsRejected: 0,
        detail: "full",
      });
    }
  }

  const nativeUsageLines = (usage?.lines ?? []).filter(
    (line) => line.domain === "native-session",
  );
  const dated: EvidenceHealthState =
    nativeLines === 0
      ? "unavailable"
      : nativeUsageLines.every((line) => line.attributedAt.state === "known")
        ? "supported"
        : "partial";

  return buildEvidenceHealth({
    core: context.core,
    sources,
    joins: {
      toolCalls: tools.length,
      toolResults: context.toolResults ?? 0,
      matchedToolResults: tools.filter((tool) => tool.status !== "interrupted")
        .length,
      matchedLiveToolTimings: correlatedTools,
      agentRuns: agents.length,
      knownAgentParents: agents.filter((run) => run.parentId !== undefined)
        .length,
    },
    usage: {
      nativeLines,
      childLines,
      compositionReconciled:
        usage?.state === "known" &&
        compositionEqual(usage.composition, usage.known),
      dated,
    },
    aggregates: {
      detail: retained?.aggregates.boundary.detail ?? "expired",
      integrationCounters: Object.keys(retained?.aggregates.integration ?? {})
        .length,
      skillInvocations: {
        names:
          retained?.aggregates.skillInvocations?.named === undefined
            ? 0
            : Object.keys(retained.aggregates.skillInvocations.named.value)
                .length,
        overflow: retained?.aggregates.skillInvocations?.overflow?.value ?? 0,
        retainedInvocations: skills.length,
      },
      permissionPresence: retained?.aggregates.permissionPresence
        ? "supported"
        : "unavailable",
      resources: retained?.aggregates.resources
        ? "supported"
        : retained?.aggregates.boundary.detail === "expired"
          ? "expired"
          : "unavailable",
    },
    diagnostics: context.diagnostics,
  });
}

function unavailableHealth(context: {
  core: EvidenceHealthState;
  recordsSeen: number;
  factsAccepted: number;
  recordsRejected: number;
  diagnostics: EvidenceDiagnostic[];
}): SessionEvidenceHealth {
  return buildEvidenceHealth({
    core: context.core,
    sources: [
      {
        source: "pi-jsonl",
        authority: "native",
        state: context.core,
        schemaVersion: 3,
        recordsSeen: context.recordsSeen,
        factsAccepted: context.factsAccepted,
        recordsRejected: context.recordsRejected,
        detail: "not-observed",
      },
    ],
    joins: {
      toolCalls: 0,
      toolResults: 0,
      matchedToolResults: 0,
      matchedLiveToolTimings: 0,
      agentRuns: 0,
      knownAgentParents: 0,
    },
    usage: {
      nativeLines: 0,
      childLines: 0,
      compositionReconciled: false,
      dated: "unavailable",
    },
    aggregates: {
      detail: "expired",
      integrationCounters: 0,
      skillInvocations: { names: 0, overflow: 0, retainedInvocations: 0 },
      permissionPresence: "unavailable",
      resources: "unavailable",
    },
    diagnostics: context.diagnostics,
  });
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

class DiagnosticAccumulator {
  readonly #seen = new Map<string, EvidenceDiagnostic>();

  add(
    source: EvidenceSource,
    code: EvidenceDiagnosticCode,
    count = 1,
    severity?: EvidenceDiagnosticSeverity,
  ): void {
    const key = `${source}\u0000${code}`;
    const prior = this.#seen.get(key);
    const resolved = severity ?? defaultDiagnosticSeverity(code);
    if (prior === undefined) {
      this.#seen.set(key, {
        source,
        code,
        count: Math.max(1, count),
        severity: resolved,
      });
      return;
    }
    this.#seen.set(key, {
      ...prior,
      count: prior.count + Math.max(1, count),
      severity: resolved === "error" ? "error" : prior.severity,
    });
  }

  list(): EvidenceDiagnostic[] {
    return [...this.#seen.values()];
  }
}

function normalizeParentSession(
  relationship: CanonicalRelationship | undefined,
  diagnostics: DiagnosticAccumulator,
): CanonicalRelationship {
  if (relationship === undefined) return { state: "unavailable" };
  if (relationship.state === "unavailable") {
    diagnostics.add("pi-jsonl", "parent-session-unavailable", 1);
  }
  return relationship;
}

function markerTime(
  parsed: ParsedSession,
  markerEntryId: string,
): TimeEvidence {
  const node = parsed.graphNodes.find(
    (entry) => entry.entryId === markerEntryId,
  );
  return timeKnown(node?.timestamp, "pi-entry");
}

function timeKnown(value: unknown, basis: TimeBasis): TimeEvidence {
  return isBoundedTimestamp(value)
    ? { state: "known", at: value, basis }
    : { state: "unavailable" };
}

function isBoundedTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_TIMESTAMP_LENGTH &&
    ISO_INSTANT.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function isBoundedId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    encoder.encode(value).byteLength <= MAX_ID_BYTES
  );
}

function isSequence(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

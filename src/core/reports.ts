import type {
  CanonicalInventoryObservation,
  CanonicalSession,
} from "./canonical.ts";
import {
  isAllowedIntegrationCounter,
  isKnownIntegrationVersion,
} from "./integration-counter-allowlists.ts";
import {
  MAX_COUNTER_KEYS,
  MAX_FOLDED_COUNT,
  MAX_SKILL_KEYS,
  SKILL_NAME_PATTERN,
  type FoldedCounters,
} from "./live-counter-fold.ts";
import {
  sanitizeSourceLabel,
  type CommandRow,
  type InventorySnapshot,
  type ResourceSourceRow,
  type SkillRow,
} from "../integrations/inventory.ts";
import { boundedDescription } from "./redact.ts";
import {
  boundedProducerLabel,
  type EvidenceAuthority,
  type EvidenceSource,
  type TimeEvidence,
} from "./evidence.ts";
import {
  buildEvidenceHealth,
  defaultDiagnosticSeverity,
  EVIDENCE_SOURCE_ORDER,
  MAX_EVIDENCE_COUNT,
  type EvidenceDiagnostic,
  type EvidenceDiagnosticCode,
  type EvidenceDiagnosticSeverity,
  type EvidenceHealthState,
  type SessionEvidenceHealth,
  type SourceEvidenceHealth,
} from "./evidence-health.ts";
import {
  isIntegrationKey as isCanonicalIntegrationKey,
  type AggregateValue,
  type CanonicalRetainedAggregates,
} from "./retained-aggregates.ts";
import {
  isAgentLabel,
  isProcessSignal,
  type AgentToolActivity,
} from "../integrations/subagents.ts";

// The report-facing activity projection reuses the reader's shape so the
// native subagent evidence has exactly one DTO definition (never re-declared).
export type { AgentToolActivity };
import type {
  AgentFailure,
  AgentRun,
  Compaction,
  EvidenceState,
  IntegrationKey,
  IntegrationObservation,
  IntegrationObservationInput,
  IntegrationPresence,
  ReducedSession,
  Tool,
  Usage,
} from "./events.ts";

const MAX_AGENT_ROWS = 256;
/** Seven known keys plus the legacy `mode` compatibility row. */
const MAX_INTEGRATION_ROWS = 8;
const MAX_INVENTORY_DESCRIPTION_BYTES = 120;
const MAX_INVENTORY_COMMANDS = 256;
const MAX_INVENTORY_SKILLS = 128;
const MAX_INVENTORY_RESOURCES = 64;
const INVENTORY_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const INVENTORY_SOURCES = new Set(["extension", "prompt", "skill"]);
const INVENTORY_SCOPES = new Set(["user", "project", "temporary"]);
const INVENTORY_ORIGINS = new Set(["package", "top-level"]);
/** Adapter schema counters are capped separately from the fold's hard cap. */
const MAX_COUNTERS = 12;
const MAX_TOTAL_TOKENS = 1_000_000_000;
const MAX_COST = 1_000_000_000;
const OPAQUE_SUBAGENT_ID = /^subagent-[a-f0-9]{64}$/;
// The adapter emits `tool:<native toolCallId>`; re-validate the bounded form.
const OPAQUE_TOOL_ID = /^tool:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const FAILURE_REASONS = new Set<AgentFailure["reason"]>([
  "exit-nonzero",
  "process-signal",
  "completion-failed",
  "output-absent",
]);
const MAX_EXIT_CODE = 2_147_483_647;
const AGENT_STATUSES = new Set<AgentRun["status"]>([
  "running",
  "succeeded",
  "failed",
  "interrupted",
  "unknown",
]);
const CONFIDENCES = new Set<AgentRun["confidence"]>([
  "native",
  "live",
  "cooperative",
  "inferred",
  "unavailable",
  "unsupported",
]);
const EVIDENCE_STATES = new Set<EvidenceState>([
  "supported",
  "unavailable",
  "unsupported",
]);
// Tool names are a bounded producer vocabulary; evidence stays untrusted, so
// the same bounded token grammar (extended to `_`) is re-validated here.
const ACTIVITY_TOOL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_ACTIVITY_TOOLS = 64;
const INTEGRATION_KEYS = new Set<IntegrationKey | "mode">([
  "context",
  "rtk",
  "ponytail",
  "caveman",
  "mode",
  "permission",
  "subagents",
  "lens",
]);
const INTEGRATION_PRESENCES = new Set<IntegrationPresence>([
  "present",
  "absent",
  "unknown",
]);
const INTEGRATION_ORDER: readonly IntegrationKey[] = [
  "context",
  "rtk",
  "ponytail",
  "caveman",
  "permission",
  "subagents",
  "lens",
];

// Canonical health is a bounded, closed-enum DTO. The report projection
// re-validates every member rather than trusting the builder, so forged health
// can never publish an out-of-enum value, an unbounded count, or producer text.
const HEALTH_STATES = new Set<EvidenceHealthState>([
  "supported",
  "partial",
  "unavailable",
  "unsupported",
  "expired",
]);
const EVIDENCE_AUTHORITIES = new Set<EvidenceAuthority>([
  "native",
  "live",
  "cooperative",
  "observed",
  "derived",
]);
const EVIDENCE_SOURCES = new Set<EvidenceSource>(EVIDENCE_SOURCE_ORDER);
const SOURCE_DETAILS = new Set<SourceEvidenceHealth["detail"]>([
  "full",
  "aggregate-only",
  "not-observed",
  "unsupported",
]);
const DIAGNOSTIC_SEVERITIES = new Set<EvidenceDiagnosticSeverity>([
  "info",
  "warning",
  "error",
]);
const DIAGNOSTIC_CODES = new Set<EvidenceDiagnosticCode>([
  "source-not-found",
  "source-format-unsupported",
  "source-malformed",
  "unknown-entry",
  "duplicate-entry-id",
  "missing-entry-parent",
  "tracking-marker-missing",
  "tracking-marker-duplicate",
  "active-leaf-unavailable",
  "tool-call-id-duplicate",
  "tool-result-orphan",
  "tool-result-duplicate",
  "usage-invalid",
  "usage-overflow",
  "usage-reconciliation-mismatch",
  "wal-record-legacy",
  "wal-record-invalid",
  "wal-sequence-gap",
  "wal-detail-expired",
  "live-correlation-missing",
  "inventory-observation-time-missing",
  "aggregate-supplement-applied",
  "aggregate-only-fallback",
  "checkpoint-aggregate-invalid",
  "parent-session-unavailable",
  "integration-contract-unsupported",
  "cooperative-evidence-conflict",
  "archive-unavailable",
  "archive-invalid",
  "clock-regression",
]);
const AGGREGATE_DETAILS = new Set<
  CanonicalRetainedAggregates["boundary"]["detail"]
>(["full", "aggregate-only", "expired"]);
const RETAINED_RESOURCE_STATES = new Set<
  NonNullable<CanonicalRetainedAggregates["resources"]>["state"]
>(["observed", "aggregate-only"]);
const TIME_BASES = new Set<Extract<TimeEvidence, { state: "known" }>["basis"]>([
  "pi-session-header",
  "pi-entry",
  "pi-publication-entry",
  "wal-observer",
  "inventory-observer",
  "current-observer",
  "checkpoint-observer",
]);
// Aggregate value maps share the checkpoint counter-key grammar.
const RETAINED_COUNTER_KEY = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
// Boundary cursors carry a bounded writer token, never a path or free text.
// Mirrors the storage writer grammar (`src/storage/wal.ts`) so a legitimately
// created writer (e.g. an underscore-leading id) is never dropped here.
const WRITER_ID = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const ISO_INSTANT_OR_DATE =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2}))?$/;
const MAX_TIMESTAMP_LENGTH = 35;
const MAX_HEALTH_SOURCES = EVIDENCE_SOURCE_ORDER.length;
export const MAX_HEALTH_DIAGNOSTICS = 256;

export type ModelSummary = {
  provider: string;
  model: string;
  generations: number;
  totalTokens: number;
  cost: number;
};

export type AdapterAgentEvidence = {
  state: EvidenceState;
  runs: readonly AgentRun[];
};

/** Correlated live timing; rows only match existing native tool-call IDs. */
export type DurationEvidence = {
  state: EvidenceState;
  tools?: readonly { id: string; durationMs: number }[];
};

/** Only bounded, explicit integration-adapter output may enter a report. */
export type SessionReportEvidence = {
  walDetail?: "expired";
  agents?: AdapterAgentEvidence;
  /** Native subagent tool activity; validated into the report DTO. */
  agentActivity?: AgentToolActivity;
  integrations?: readonly IntegrationObservationInput[];
  /** Explicit per-key presence model from the process-local observation. */
  presence?: Readonly<Record<IntegrationKey, IntegrationPresence>>;
  /** Effective folded counters (`merge(checkpoint, delta)`), never a delta alone. */
  counters?: FoldedCounters;
  /** Sanitized inventory snapshot read at session start or on reload. */
  inventory?: InventorySnapshot;
  /**
   * Persisted inventory counts from checkpoint aggregates. Present only for
   * history/global reads where the snapshot itself may already have expired;
   * absence means unknown, never zero.
   */
  resourceCounts?: { commands: number; skills: number };
  duration?: DurationEvidence;
  /** Canonical bounded health; re-validated before it reaches the report. */
  evidenceHealth?: SessionEvidenceHealth;
  /** Canonical checkpoint-surviving aggregates, if a boundary exists. */
  retainedAggregates?: CanonicalRetainedAggregates;
  /** L1's usage verdict; unavailable deliberately omits legacy totals. */
  usage?:
    | {
        state: "known";
        usage: Usage;
        composition: ReducedSession["usageComposition"];
      }
    | { state: "unavailable" };
};

/** Inventory rows are always a bounded, sanitized projection of a snapshot. */
export type CommandInventory = {
  state: EvidenceState;
  items: readonly CommandRow[];
  count: number | null;
};

export type SkillInventory = {
  state: EvidenceState;
  items: readonly SkillRow[];
  /**
   * Inventory availability only: how many INVENTORY skill rows exist, taken
   * before any counter-only row is appended, so a counted name the snapshot no
   * longer lists can never inflate it. `null` means no snapshot, never zero.
   */
  count: number | null;
  invocationState: EvidenceState;
  invocationCount: number | null;
  otherInvocations: number | null;
};

export type ResourceInventory = {
  state: EvidenceState;
  items: readonly ResourceSourceRow[];
};

/** A tool row plus its optional inventory source label (never a path). */
export type SessionReportTool = Tool & { source?: string };

export type SessionReport = {
  walDetail?: "expired";
  sessionId: string;
  /** Absent when L1 rejects the native aggregate (for example overflow). */
  usage?: Usage;
  /** Absent together with usage so the DTO cannot imply a zero total. */
  usageComposition?: ReducedSession["usageComposition"];
  models: ModelSummary[];
  tools: SessionReportTool[];
  compactions: Compaction[];
  generations: ReducedSession["generations"];
  errors: ReducedSession["errors"];
  agents: AgentRun[];
  /**
   * Child-usage completeness, derived from the projected run set above: how
   * many runs reported usage out of how many runs exist. A breakdown fraction
   * only — never a cost, and never added to a native total. Always present;
   * an empty run set is `0/0`, which every renderer shows as `Unavailable` and
   * never as `$0.00`.
   */
  agentUsage: { runsTotal: number; runsWithUsage: number };
  agentEvidence: EvidenceState;
  /** Native subagent tool activity; distinct from rich cooperative runs. */
  agentActivity: AgentToolActivity;
  integrations: IntegrationObservation[];
  durationEvidence: EvidenceState;
  commands: CommandInventory;
  skills: SkillInventory;
  resources: ResourceInventory;
  /**
   * Canonical bounded evidence health. Always present: when no health is
   * supplied the report carries an `unavailable` shape so every renderer sees
   * the same DTO, and `unavailable` never degrades to a fabricated zero.
   */
  evidenceHealth: SessionEvidenceHealth;
  /** Canonical checkpoint-surviving aggregates; absent when none exist. */
  retainedAggregates?: CanonicalRetainedAggregates;
};

/** Returns cache-read share of input-side tokens, or unknown. */
export function cacheHitPercent(usage: Usage | undefined): number | undefined {
  if (
    usage?.inputTokens === undefined ||
    usage.cacheReadTokens === undefined ||
    usage.cacheWriteTokens === undefined
  ) {
    return undefined;
  }
  const denominator =
    usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  if (!Number.isSafeInteger(denominator) || denominator <= 0) return undefined;
  return Math.round((usage.cacheReadTokens / denominator) * 1_000) / 10;
}

export function toSessionReport(
  source: ReducedSession | CanonicalSession,
  evidence: SessionReportEvidence = {},
): SessionReport {
  const canonical = isCanonicalSession(source) ? source : undefined;
  const generations = source.generations;
  const sourceTools = source.tools;
  const compactions = source.compactions;
  const errors = source.errors;
  const sessionId = source.sessionId;
  const sourceUsage = isCanonicalSession(source)
    ? source.usage.state === "known"
      ? {
          state: "known" as const,
          usage: source.usage.known,
          composition: source.usage.composition,
        }
      : undefined
    : evidence.usage?.state === "unavailable"
      ? undefined
      : evidence.usage?.state === "known"
        ? evidence.usage
        : {
            state: "known" as const,
            usage: source.usage,
            composition: source.usageComposition,
          };
  const projectedEvidence = projectEvidence(
    canonical === undefined
      ? evidence
      : canonicalReportEvidence(canonical, evidence),
  );
  const inventory = projectedEvidence.inventory;
  const models = new Map<string, ModelSummary>();
  for (const generation of generations) {
    const key = `${generation.provider}\u0000${generation.model}`;
    const current = models.get(key) ?? {
      provider: generation.provider,
      model: generation.model,
      generations: 0,
      totalTokens: 0,
      cost: 0,
    };
    current.generations++;
    current.totalTokens += generation.usage.totalTokens;
    current.cost = roundCost(current.cost + generation.usage.cost);
    models.set(key, current);
  }
  const tools = sourceTools.map((tool) => {
    const durationMs = projectedEvidence.duration.tools.get(tool.id);
    const source = inventory?.toolSources[tool.name];
    const projected: SessionReportTool = { ...tool };
    if (durationMs !== undefined) projected.durationMs = durationMs;
    // Guard against a prototype-derived value when a tool is named after an
    // `Object.prototype` member but absent from the inventory.
    if (typeof source === "string") projected.source = source;
    return projected;
  });
  // The fraction is derived from the run set that was just projected, never
  // from the adapter's input and never carried as evidence. Both counts are
  // taken from the same validated rows, so each is a non-negative safe integer
  // and `runsWithUsage <= runsTotal` holds by construction: no clamp is needed
  // and none may be invented.
  const runsTotal = projectedEvidence.agents.length;
  const runsWithUsage = projectedEvidence.agents.filter(
    (run) => run.usage !== undefined,
  ).length;
  const agentUsage = { runsTotal, runsWithUsage };
  return {
    sessionId,
    // L1 rejected this aggregate (for example overflow). Omit both fields
    // rather than publishing a clamped or zero total.
    ...(sourceUsage === undefined
      ? {}
      : {
          usage: sourceUsage.usage,
          usageComposition: sourceUsage.composition,
        }),
    generations,
    tools,
    compactions,
    errors,
    ...(projectedEvidence.walDetail === "expired"
      ? { walDetail: "expired" as const }
      : {}),
    agents: projectedEvidence.agents,
    agentUsage: agentUsage,
    agentEvidence: projectedEvidence.agentEvidence,
    agentActivity: projectedEvidence.agentActivity,
    integrations: projectedEvidence.integrations,
    durationEvidence: projectedEvidence.duration.state,
    commands: projectCommands(inventory, projectedEvidence.resourceCounts),
    skills: projectSkills(inventory, projectedEvidence.counters),
    resources: projectResources(inventory),
    evidenceHealth: projectedEvidence.health,
    ...(projectedEvidence.retainedAggregates === undefined
      ? {}
      : { retainedAggregates: projectedEvidence.retainedAggregates }),
    models: [...models.values()].sort(
      (a, b) =>
        a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model),
    ),
  };
}

function isCanonicalSession(
  source: ReducedSession | CanonicalSession,
): source is CanonicalSession {
  return (
    "schemaVersion" in source &&
    source.schemaVersion === 1 &&
    "health" in source
  );
}

function canonicalReportEvidence(
  session: CanonicalSession,
  evidence: SessionReportEvidence,
): SessionReportEvidence {
  const projection = { ...evidence };
  const agentState = projection.agents?.state;
  delete projection.agents;
  delete projection.integrations;
  delete projection.inventory;
  delete projection.usage;
  delete projection.duration;
  delete projection.evidenceHealth;
  delete projection.retainedAggregates;
  delete projection.walDetail;
  return {
    ...projection,
    agents: {
      state:
        agentState ??
        (session.agents.length === 0 ? "unavailable" : "supported"),
      runs: session.agents,
    },
    integrations: session.integrationEvents.map((event) => ({
      integration: event.integration,
      presence: event.presence,
      state: event.state,
      ...(event.version === undefined ? {} : { version: event.version }),
      ...(event.counters === undefined ? {} : { counters: event.counters }),
    })),
    ...(session.inventory === undefined
      ? {}
      : { inventory: canonicalInventorySnapshot(session.inventory) }),
    duration: canonicalDuration(session.tools),
    evidenceHealth: session.health,
    retainedAggregates: session.retainedAggregates,
    ...(hasSealedDetail(session) ? { walDetail: "expired" as const } : {}),
  };
}

function canonicalInventorySnapshot(
  input: CanonicalInventoryObservation,
): InventorySnapshot {
  return {
    schemaVersion: 1,
    ...(input.observedAt.state === "known"
      ? { observedAt: input.observedAt.at }
      : {}),
    commands: input.commands.map((row) => ({
      name: row.name,
      source: row.source as CommandRow["source"],
      sourceLabel: row.sourceLabel,
      scope: row.scope as CommandRow["scope"],
      origin: row.origin as CommandRow["origin"],
      ...(row.description === undefined
        ? {}
        : { description: row.description }),
    })),
    skills: input.skills.map((row) => ({
      name: row.name,
      ...(row.sourceLabel === undefined
        ? {}
        : { sourceLabel: row.sourceLabel }),
      ...(row.scope === undefined
        ? {}
        : { scope: row.scope as SkillRow["scope"] }),
      ...(row.origin === undefined
        ? {}
        : { origin: row.origin as SkillRow["origin"] }),
      ...(row.description === undefined
        ? {}
        : { description: row.description }),
    })),
    resources: input.resources.map((row) => ({
      sourceLabel: row.sourceLabel,
      scope: row.scope as ResourceSourceRow["scope"],
      origin: row.origin as ResourceSourceRow["origin"],
      commands: row.commands,
      skills: row.skills,
      prompts: row.prompts,
      tools: row.tools,
    })),
    toolSources: input.toolSources,
  };
}

function canonicalDuration(
  tools: readonly Tool[],
): SessionReportEvidence["duration"] {
  const durationTools = tools.flatMap((tool) =>
    tool.durationMs === undefined
      ? []
      : [{ id: tool.id, durationMs: tool.durationMs }],
  );
  return durationTools.length === 0
    ? { state: "unavailable" }
    : { state: "supported", tools: durationTools };
}

function hasSealedDetail(session: CanonicalSession): boolean {
  return Object.values(session.retainedAggregates.boundary.sealedThrough).some(
    (cursor) => cursor > 0,
  );
}

type ProjectedEvidence = {
  walDetail?: "expired";
  agents: AgentRun[];
  agentEvidence: EvidenceState;
  agentActivity: AgentToolActivity;
  integrations: IntegrationObservation[];
  duration: { state: EvidenceState; tools: Map<string, number> };
  inventory: InventorySnapshot | undefined;
  resourceCounts: { commands: number; skills: number } | undefined;
  counters: ProjectedCounters | undefined;
  health: SessionEvidenceHealth;
  retainedAggregates: CanonicalRetainedAggregates | undefined;
};

function projectEvidence(evidence: unknown): ProjectedEvidence {
  try {
    const input = snapshotRecord(evidence);
    if (input === undefined) return unavailableEvidence();
    const agents = projectAgentEvidence(input.agents);
    const counters = projectCounterEvidence(input.counters);
    return {
      ...(input.walDetail === "expired"
        ? { walDetail: "expired" as const }
        : {}),
      agents: agents.runs,
      agentEvidence: agents.state,
      agentActivity: projectAgentActivity(input.agentActivity),
      integrations: projectIntegrations(
        input.integrations,
        input.presence,
        input.counters,
        counters?.permissionPresent ?? false,
      ),
      duration: projectDuration(input.duration),
      inventory: projectInventory(input.inventory),
      resourceCounts: projectResourceCounts(input.resourceCounts),
      counters,
      health: projectEvidenceHealth(input.evidenceHealth),
      retainedAggregates: projectRetainedAggregates(input.retainedAggregates),
    };
  } catch {
    return unavailableEvidence();
  }
}

function projectDuration(value: unknown): {
  state: EvidenceState;
  tools: Map<string, number>;
} {
  const input = snapshotRecord(value);
  if (input === undefined || !isEvidenceState(input.state)) {
    return { state: "unavailable", tools: new Map() };
  }
  if (input.state !== "supported") {
    return { state: input.state, tools: new Map() };
  }

  const tools = new Map<string, number>();
  if (Array.isArray(input.tools)) {
    for (const row of input.tools) {
      const entry = snapshotRecord(row);
      if (
        entry !== undefined &&
        typeof entry.id === "string" &&
        isDurationMs(entry.durationMs) &&
        !tools.has(entry.id)
      ) {
        tools.set(entry.id, entry.durationMs);
      }
    }
  }
  return { state: tools.size > 0 ? "supported" : "unavailable", tools };
}

/**
 * Re-validates the native subagent activity so forged evidence can never emit
 * an unbounded name, a non-integer count, or a fabricated row. Absent or
 * malformed evidence degrades to `unavailable` with zero counts (never zero
 * activity disguised as observed). Optional usage is a breakdown only and is
 * never added to session totals.
 */
function projectAgentActivity(value: unknown): AgentToolActivity {
  const input = snapshotRecord(value);
  if (input === undefined || !isEvidenceState(input.state)) {
    return unavailableActivity();
  }
  // `unsupported`/`unavailable` carry no trustworthy counts, so they stay zero.
  if (input.state !== "supported") {
    return {
      state: input.state,
      calls: 0,
      succeeded: 0,
      failed: 0,
      interrupted: 0,
      tools: [],
    };
  }
  const calls = readActivityCount(input.calls);
  const succeeded = readActivityCount(input.succeeded);
  const failed = readActivityCount(input.failed);
  const interrupted = readActivityCount(input.interrupted);
  if (
    calls === undefined ||
    succeeded === undefined ||
    failed === undefined ||
    interrupted === undefined
  ) {
    return unavailableActivity();
  }
  const usage = projectUsage(input.usage);
  const tools = projectActivityTools(input.tools);
  return {
    state: "supported",
    calls,
    succeeded,
    failed,
    interrupted,
    tools,
    ...(usage === undefined ? {} : { usage }),
  };
}

function projectActivityTools(
  value: unknown,
): { name: string; calls: number }[] {
  if (!Array.isArray(value)) return [];
  const tools: { name: string; calls: number }[] = [];
  for (const row of value.slice(0, MAX_ACTIVITY_TOOLS)) {
    const entry = snapshotRecord(row);
    if (entry === undefined) continue;
    if (
      typeof entry.name !== "string" ||
      !ACTIVITY_TOOL_NAME.test(entry.name)
    ) {
      continue;
    }
    const calls = readActivityCount(entry.calls);
    if (calls === undefined) continue;
    tools.push({ name: entry.name, calls });
  }
  return tools;
}

/** Only a safe non-negative integer is a valid activity count. */
function readActivityCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function unavailableActivity(): AgentToolActivity {
  return {
    state: "unavailable",
    calls: 0,
    succeeded: 0,
    failed: 0,
    interrupted: 0,
    tools: [],
  };
}

function projectAgentEvidence(value: unknown): {
  state: EvidenceState;
  runs: AgentRun[];
} {
  const input = snapshotRecord(value);
  if (input === undefined || !isEvidenceState(input.state)) {
    return { state: "unavailable", runs: [] };
  }
  return {
    state: input.state,
    runs: input.state === "supported" ? projectAgents(input.runs) : [],
  };
}

function projectAgents(runs: unknown): AgentRun[] {
  if (!Array.isArray(runs)) return [];
  const agents: AgentRun[] = [];
  for (const run of runs.slice(0, MAX_AGENT_ROWS)) {
    const projected = projectAgent(run);
    if (projected !== undefined) agents.push(projected);
  }
  return agents;
}

function projectAgent(value: unknown): AgentRun | undefined {
  const run = snapshotRecord(value);
  if (
    run === undefined ||
    !isOpaqueSubagentId(run.id) ||
    !isAgentStatus(run.status) ||
    !isConfidence(run.confidence)
  ) {
    return undefined;
  }
  const parentId = isOpaqueSubagentId(run.parentId) ? run.parentId : undefined;
  const agent = isAgentLabel(run.agent) ? run.agent : undefined;
  const usage = projectUsage(run.usage);
  const artifacts = isArchiveState(run.artifacts) ? run.artifacts : undefined;
  const observedAt = isObservedAt(run.observedAt) ? run.observedAt : undefined;
  const evidenceToolId = isOpaqueToolId(run.evidenceToolId)
    ? run.evidenceToolId
    : undefined;
  const model = boundedProducerLabel(run.model);
  const thinking = boundedProducerLabel(run.thinking);
  const failure = projectAgentFailure(run.failure);
  return {
    id: run.id,
    ...(parentId === undefined ? {} : { parentId }),
    ...(agent === undefined ? {} : { agent }),
    status: run.status,
    confidence: run.confidence,
    ...(artifacts === undefined ? {} : { artifacts }),
    ...(observedAt === undefined ? {} : { observedAt }),
    ...(evidenceToolId === undefined ? {} : { evidenceToolId }),
    ...(model === undefined ? {} : { model }),
    ...(thinking === undefined ? {} : { thinking }),
    ...(failure === undefined ? {} : { failure }),
    ...(usage === undefined ? {} : { usage }),
  };
}

/** Re-validates bounded publication time and closed failure vocabulary. */
function isObservedAt(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 35 &&
    ISO_INSTANT.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function isOpaqueToolId(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_TOOL_ID.test(value);
}

function projectAgentFailure(value: unknown): AgentFailure | undefined {
  const failure = snapshotRecord(value);
  if (failure === undefined) return undefined;
  const reason = failure.reason;
  if (
    typeof reason !== "string" ||
    !FAILURE_REASONS.has(reason as AgentFailure["reason"])
  ) {
    return undefined;
  }
  const detail = projectFailureDetail(
    reason as AgentFailure["reason"],
    failure.detail,
  );
  return {
    reason: reason as AgentFailure["reason"],
    ...(detail === undefined ? {} : { detail }),
  };
}

/**
 * A failure detail is meaningful only for the two reasons that publish one:
 * a bounded signal token for `process-signal`, a bounded integer exit code for
 * `exit-nonzero`. Anything else is dropped, never guessed.
 */
function projectFailureDetail(
  reason: AgentFailure["reason"],
  detail: unknown,
): number | string | undefined {
  if (reason === "process-signal") {
    return isProcessSignal(detail) ? detail : undefined;
  }
  if (reason === "exit-nonzero") {
    return typeof detail === "number" &&
      Number.isSafeInteger(detail) &&
      detail >= 0 &&
      detail <= MAX_EXIT_CODE
      ? detail
      : undefined;
  }
  return undefined;
}

function projectUsage(value: unknown): Usage | undefined {
  const usage = snapshotRecord(value);
  if (
    usage === undefined ||
    !isTotalTokens(usage.totalTokens) ||
    !isCost(usage.cost)
  ) {
    return undefined;
  }
  return { totalTokens: usage.totalTokens, cost: usage.cost };
}

function projectIntegrations(
  value: unknown,
  presenceValue: unknown,
  countersValue: unknown,
  permissionPresent: boolean,
): IntegrationObservation[] {
  const adapterRows = projectAdapterRows(value);
  const presence = projectPresence(presenceValue);
  const counters = projectFoldedCounters(countersValue);
  // Without an observation the projection keeps its adapter-only shape; with one
  // it emits exactly one row per known key so absence is explicit. A persisted
  // `presence.permission` is itself an observation, so it also promotes the
  // permission row to `present` (never `absent`).
  if (presence === undefined && counters === undefined && !permissionPresent)
    return adapterRows;

  const adapterByKey = new Map<IntegrationKey, IntegrationObservation>();
  let legacyMode: IntegrationObservation | undefined;
  for (const row of adapterRows) {
    if (row.integration === "mode") {
      legacyMode = legacyMode ?? row;
      continue;
    }
    if (!adapterByKey.has(row.integration)) {
      adapterByKey.set(row.integration, row);
    }
  }

  const integrations = INTEGRATION_ORDER.map((integration) =>
    mergeIntegrationRow(
      integration,
      adapterByKey.get(integration),
      integration === "permission" && permissionPresent
        ? "present"
        : presence?.[integration],
      counters?.[integration],
    ),
  );
  if (legacyMode !== undefined && integrations.length < MAX_INTEGRATION_ROWS) {
    integrations.push(legacyMode);
  }
  return integrations;
}

function mergeIntegrationRow(
  integration: IntegrationKey,
  adapter: IntegrationObservation | undefined,
  presenceSignal: IntegrationPresence | undefined,
  folded: unknown,
): IntegrationObservation {
  const counters = projectFoldedCountersForIntegration(integration, folded);
  const state: EvidenceState =
    counters !== undefined ? "supported" : (adapter?.state ?? "unavailable");
  // `unknown` is the absence of a signal, so evidence still promotes the row to
  // `present`; only a definite presence/absence signal outranks evidence.
  const presence: IntegrationPresence = isDefinitePresence(presenceSignal)
    ? presenceSignal
    : isDefinitePresence(adapter?.presence)
      ? adapter.presence
      : state === "supported"
        ? "present"
        : "unknown";
  if (counters !== undefined) {
    // Folded counters are the v1 contract; evidence exists, so the row is supported.
    return { integration, presence, version: 1, state, counters };
  }
  if (adapter === undefined) {
    return { integration, presence, state };
  }
  return { ...adapter, presence };
}

function isDefinitePresence(
  value: IntegrationPresence | undefined,
): value is "present" | "absent" {
  return value === "present" || value === "absent";
}

/**
 * Folded counters are accepted only when the per-integration v1 allowlist names
 * them; a bucket over the fold's key cap is rejected rather than truncated.
 */
function projectFoldedCountersForIntegration(
  integration: IntegrationKey,
  value: unknown,
): Readonly<Record<string, number>> | undefined {
  const row = snapshotRecord(value);
  if (row === undefined) return undefined;
  const keys = Object.keys(row);
  if (keys.length > MAX_COUNTER_KEYS) return undefined;
  const projected: Record<string, number> = {};
  for (const key of keys.sort()) {
    const count = row[key];
    if (
      isAllowedIntegrationCounter(integration, 1, key) &&
      typeof count === "number" &&
      isCounterValue(count)
    ) {
      projected[key] = count;
    }
  }
  return Object.keys(projected).length === 0 ? undefined : projected;
}

function projectPresence(
  value: unknown,
):
  | Readonly<Record<IntegrationKey, IntegrationPresence | undefined>>
  | undefined {
  const input = snapshotRecord(value);
  if (input === undefined) return undefined;
  const presence = {} as Record<
    IntegrationKey,
    IntegrationPresence | undefined
  >;
  for (const integration of INTEGRATION_ORDER) {
    const signal = input[integration];
    presence[integration] = isIntegrationPresence(signal) ? signal : undefined;
  }
  return presence;
}

function projectFoldedCounters(
  value: unknown,
):
  | Readonly<Partial<Record<IntegrationKey, Readonly<Record<string, number>>>>>
  | undefined {
  const input = snapshotRecord(value);
  if (input === undefined) return undefined;
  const counters = snapshotRecord(input.counters);
  if (counters === undefined) return undefined;
  const folded: Partial<
    Record<IntegrationKey, Readonly<Record<string, number>>>
  > = {};
  // Only the seven known keys can carry folded counters; `mode` is legacy-only.
  for (const integration of INTEGRATION_ORDER) {
    const projected = projectFoldedCountersForIntegration(
      integration,
      counters[integration],
    );
    if (projected !== undefined) folded[integration] = projected;
  }
  return Object.keys(folded).length === 0 ? undefined : folded;
}

function projectAdapterRows(value: unknown): IntegrationObservation[] {
  if (!Array.isArray(value)) return [];
  const integrations: IntegrationObservation[] = [];
  for (const row of value.slice(0, MAX_INTEGRATION_ROWS)) {
    const projected = projectIntegration(row);
    if (projected !== undefined) integrations.push(projected);
  }
  return integrations;
}

function projectIntegration(
  value: unknown,
): IntegrationObservation | undefined {
  const row = snapshotRecord(value);
  if (
    row === undefined ||
    !isIntegrationKey(row.integration) ||
    !isEvidenceState(row.state)
  ) {
    return undefined;
  }
  const presence = isIntegrationPresence(row.presence)
    ? row.presence
    : "unknown";
  if (row.state === "unavailable") {
    return {
      integration: row.integration,
      presence,
      state: "unavailable",
      ...(isVersion(row.version) ? { version: row.version } : {}),
    };
  }
  if (
    !isVersion(row.version) ||
    (row.state !== "unsupported" &&
      !isKnownIntegrationVersion(row.integration, row.version))
  ) {
    return undefined;
  }
  const counters =
    row.state === "supported"
      ? projectCounters(row.counters, row.integration, row.version)
      : undefined;
  return {
    integration: row.integration,
    presence,
    version: row.version,
    state: row.state,
    ...(counters === undefined ? {} : { counters }),
  };
}

function projectCounters(
  value: unknown,
  integration: IntegrationKey | "mode",
  version: number,
): Readonly<Record<string, number | boolean>> | undefined {
  const counters = snapshotRecord(value);
  if (counters === undefined) return undefined;
  const entries = Object.entries(counters);
  if (entries.length > MAX_COUNTERS) return undefined;

  const projected: Record<string, number | boolean> = {};
  for (const [key, counter] of entries) {
    if (
      isAllowedIntegrationCounter(integration, version, key) &&
      isCounterValue(counter)
    ) {
      projected[key] = counter;
    }
  }
  return Object.keys(projected).length === 0 ? undefined : projected;
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

function isOpaqueSubagentId(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_SUBAGENT_ID.test(value);
}

function isCounterValue(value: unknown): value is number | boolean {
  return (
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
  );
}

function isTotalTokens(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_TOTAL_TOKENS
  );
}

function isCost(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_COST
  );
}

function isDurationMs(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isAgentStatus(value: unknown): value is AgentRun["status"] {
  return (
    typeof value === "string" && AGENT_STATUSES.has(value as AgentRun["status"])
  );
}

function isConfidence(value: unknown): value is AgentRun["confidence"] {
  return (
    typeof value === "string" &&
    CONFIDENCES.has(value as AgentRun["confidence"])
  );
}

/**
 * Only the closed two-term archive verdict is projected; an unknown producer
 * value stays absent rather than becoming a guess.
 */
function isArchiveState(value: unknown): value is "available" | "missing" {
  return value === "available" || value === "missing";
}

function isEvidenceState(value: unknown): value is EvidenceState {
  return (
    typeof value === "string" && EVIDENCE_STATES.has(value as EvidenceState)
  );
}

function isIntegrationPresence(value: unknown): value is IntegrationPresence {
  return (
    typeof value === "string" &&
    INTEGRATION_PRESENCES.has(value as IntegrationPresence)
  );
}

function isIntegrationKey(value: unknown): value is IntegrationKey | "mode" {
  return (
    typeof value === "string" &&
    INTEGRATION_KEYS.has(value as IntegrationKey | "mode")
  );
}

function roundCost(value: number): number {
  return Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
}

/** A validated, already-folded view of the evidence counters projection. */
type ProjectedCounters = {
  skillInvocations: Record<string, number>;
  otherInvocations: number;
  permissionPresent: boolean;
};

/**
 * Re-validates the folded counter evidence so forged evidence can never inject
 * an unbounded skill name or count. Invalid entries are dropped, never repaired;
 * absent evidence stays absent (unavailable), never zero.
 */
function projectCounterEvidence(value: unknown): ProjectedCounters | undefined {
  const input = snapshotRecord(value);
  if (input === undefined) return undefined;
  const skills = snapshotRecord(input.skillInvocations);
  const skillInvocations: Record<string, number> = {};
  if (skills !== undefined) {
    for (const name of Object.keys(skills).sort()) {
      if (Object.keys(skillInvocations).length >= MAX_SKILL_KEYS) break;
      const count = skills[name];
      if (!SKILL_NAME_PATTERN.test(name) || !isFoldedCount(count)) continue;
      skillInvocations[name] = count;
    }
  }
  const other = input.otherInvocations;
  const presence = snapshotRecord(input.presence);
  return {
    skillInvocations,
    otherInvocations: isFoldedCount(other) ? other : 0,
    permissionPresent: presence?.permission === true,
  };
}

function projectResourceCounts(
  value: unknown,
): { commands: number; skills: number } | undefined {
  const record = snapshotRecord(value);
  if (record === undefined) return undefined;
  if (!isFoldedCount(record.commands) || !isFoldedCount(record.skills))
    return undefined;
  return { commands: record.commands, skills: record.skills };
}

/**
 * Defensive copy of a sanitized inventory snapshot. Any structurally invalid
 * container, row, name, or label makes the whole snapshot unavailable (never a
 * truncated or fabricated empty inventory); invalid optional descriptions are
 * dropped exactly as the persisted parser does.
 */
function projectInventory(value: unknown): InventorySnapshot | undefined {
  const record = snapshotRecord(value);
  if (record === undefined || record.schemaVersion !== 1) return undefined;
  const commands = projectCommandRows(record.commands);
  const skills = projectSkillRows(record.skills);
  const resources = projectResourceRows(record.resources);
  const toolSources = projectToolSources(record.toolSources);
  if (
    commands === undefined ||
    skills === undefined ||
    resources === undefined ||
    toolSources === undefined
  ) {
    return undefined;
  }
  return { schemaVersion: 1, commands, skills, resources, toolSources };
}

function projectCommandRows(value: unknown): CommandRow[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_INVENTORY_COMMANDS)
    return undefined;
  const rows: CommandRow[] = [];
  for (const item of value) {
    const record = snapshotRecord(item);
    if (
      record === undefined ||
      !isInventoryName(record.name) ||
      !isInventoryMember(INVENTORY_SOURCES, record.source) ||
      !isInventoryMember(INVENTORY_SCOPES, record.scope) ||
      !isInventoryMember(INVENTORY_ORIGINS, record.origin)
    ) {
      return undefined;
    }
    const description = boundedDescription(
      record.description,
      MAX_INVENTORY_DESCRIPTION_BYTES,
    );
    rows.push({
      name: record.name,
      source: record.source as CommandRow["source"],
      sourceLabel: sanitizeSourceLabel(record.sourceLabel),
      scope: record.scope as CommandRow["scope"],
      origin: record.origin as CommandRow["origin"],
      ...(description === undefined ? {} : { description }),
    });
  }
  return rows;
}

function projectSkillRows(value: unknown): SkillRow[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_INVENTORY_SKILLS)
    return undefined;
  const rows: SkillRow[] = [];
  for (const item of value) {
    const record = snapshotRecord(item);
    if (record === undefined || !isInventoryName(record.name)) return undefined;
    const scope = readOptionalMember(INVENTORY_SCOPES, record.scope);
    const origin = readOptionalMember(INVENTORY_ORIGINS, record.origin);
    if (scope === false || origin === false) return undefined;
    const sourceLabel =
      record.sourceLabel === undefined
        ? undefined
        : sanitizeSourceLabel(record.sourceLabel);
    const description = boundedDescription(
      record.description,
      MAX_INVENTORY_DESCRIPTION_BYTES,
    );
    rows.push({
      name: record.name,
      ...(sourceLabel === undefined ? {} : { sourceLabel }),
      ...(scope === undefined ? {} : { scope: scope as SkillRow["scope"] }),
      ...(origin === undefined ? {} : { origin: origin as SkillRow["origin"] }),
      ...(description === undefined ? {} : { description }),
    });
  }
  return rows;
}

function projectResourceRows(value: unknown): ResourceSourceRow[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_INVENTORY_RESOURCES)
    return undefined;
  const rows: ResourceSourceRow[] = [];
  for (const item of value) {
    const record = snapshotRecord(item);
    if (record === undefined) return undefined;
    if (
      !isInventoryMember(INVENTORY_SCOPES, record.scope) ||
      !isInventoryMember(INVENTORY_ORIGINS, record.origin) ||
      !isFoldedCount(record.commands) ||
      !isFoldedCount(record.skills) ||
      !isFoldedCount(record.prompts) ||
      !isFoldedCount(record.tools)
    ) {
      return undefined;
    }
    rows.push({
      sourceLabel: sanitizeSourceLabel(record.sourceLabel),
      scope: record.scope as ResourceSourceRow["scope"],
      origin: record.origin as ResourceSourceRow["origin"],
      commands: record.commands,
      skills: record.skills,
      prompts: record.prompts,
      tools: record.tools,
    });
  }
  return rows;
}

function projectToolSources(
  value: unknown,
): Record<string, string> | undefined {
  const record = snapshotRecord(value);
  if (record === undefined) return undefined;
  // Null prototype so a tool named after an `Object.prototype` member never
  // resolves to an inherited value during later lookups.
  const sources: Record<string, string> = Object.create(null);
  for (const name of Object.keys(record).sort()) {
    if (!isInventoryName(name)) return undefined;
    sources[name] = sanitizeSourceLabel(record[name]);
  }
  return sources;
}

function projectCommands(
  inventory: InventorySnapshot | undefined,
  resourceCounts: { commands: number; skills: number } | undefined,
): CommandInventory {
  if (inventory !== undefined) {
    return {
      state: "supported",
      items: inventory.commands,
      count: inventory.commands.length,
    };
  }
  return {
    state: "unavailable",
    items: [],
    // A persisted count survives snapshot expiry; without it the count is
    // unknown, never zero.
    count: resourceCounts?.commands ?? null,
  };
}

function projectSkills(
  inventory: InventorySnapshot | undefined,
  counters: ProjectedCounters | undefined,
): SkillInventory {
  const invocations = counters?.skillInvocations ?? {};
  const otherInvocations = counters?.otherInvocations ?? 0;
  const counted = Object.keys(invocations).sort();
  const hasInvocations = counted.length > 0 || otherInvocations > 0;

  const items: SkillRow[] = [];
  const seen = new Set<string>();
  // Availability is counted before the counter-only rows are appended: a
  // counted name the snapshot does not list is activity, not a skill that is
  // available, so it can never inflate this figure.
  const count = inventory === undefined ? null : inventory.skills.length;
  if (inventory !== undefined) {
    for (const row of inventory.skills) {
      seen.add(row.name);
      const count = invocations[row.name];
      items.push(
        count === undefined
          ? { ...row }
          : { ...row, explicitInvocations: count },
      );
    }
  }
  for (const name of counted) {
    if (seen.has(name)) continue;
    items.push({ name, explicitInvocations: invocations[name] });
  }

  return {
    // `state` reports inventory availability only; counted names survive expiry.
    state: inventory !== undefined ? "supported" : "unavailable",
    items,
    count,
    invocationState: hasInvocations ? "supported" : "unavailable",
    invocationCount: hasInvocations
      ? counted.reduce((sum, name) => sum + invocations[name], 0) +
        otherInvocations
      : null,
    otherInvocations: hasInvocations ? otherInvocations : null,
  };
}

function projectResources(
  inventory: InventorySnapshot | undefined,
): ResourceInventory {
  return inventory === undefined
    ? { state: "unavailable", items: [] }
    : { state: "supported", items: inventory.resources };
}

function isInventoryName(value: unknown): value is string {
  return typeof value === "string" && INVENTORY_NAME.test(value);
}

function isInventoryMember(
  members: ReadonlySet<string>,
  value: unknown,
): boolean {
  return typeof value === "string" && members.has(value);
}

/** `undefined` when absent, `false` when present but invalid. */
function readOptionalMember(
  members: ReadonlySet<string>,
  value: unknown,
): string | undefined | false {
  if (value === undefined) return undefined;
  return isInventoryMember(members, value) ? (value as string) : false;
}

function isFoldedCount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_FOLDED_COUNT
  );
}

function unavailableEvidence(): ProjectedEvidence {
  return {
    agents: [],
    agentEvidence: "unavailable",
    agentActivity: unavailableActivity(),
    integrations: [],
    duration: { state: "unavailable", tools: new Map() },
    inventory: undefined,
    resourceCounts: undefined,
    counters: undefined,
    health: unavailableEvidenceHealth(),
    retainedAggregates: undefined,
  };
}

// ---------------------------------------------------------------------------
// Canonical evidence health projection
// ---------------------------------------------------------------------------

/**
 * The shape every renderer sees when no health was supplied. It is a complete,
 * bounded DTO with `unavailable`/`expired` states, never an omitted field and
 * never a fabricated zero.
 */
export function unavailableEvidenceHealth(): SessionEvidenceHealth {
  return {
    schemaVersion: 1,
    core: "unavailable",
    sources: [],
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
    diagnostics: [],
  };
}

/**
 * Re-validates the canonical health so a forged value can never publish an
 * out-of-enum state, an unbounded count, an unknown source/code, or producer
 * text. Valid rows are normalized through `buildEvidenceHealth`, so the report
 * keeps the fixed source order, saturating counts, and sorted diagnostics.
 */
function projectEvidenceHealth(value: unknown): SessionEvidenceHealth {
  try {
    const input = snapshotRecord(value);
    if (input === undefined || input.schemaVersion !== 1) {
      return unavailableEvidenceHealth();
    }
    const built = buildEvidenceHealth({
      // A forged `core` degrades to `unavailable`; valid members are still
      // projected rather than discarding the whole bounded health.
      core: isHealthState(input.core) ? input.core : "unavailable",
      sources: projectHealthSources(input.sources),
      joins: projectHealthJoins(input.joins),
      usage: projectHealthUsage(input.usage),
      aggregates: projectHealthAggregates(input.aggregates),
      diagnostics: projectHealthDiagnostics(input.diagnostics),
    });
    // Saturation is the only source of `truncated` in the rebuild, which cannot
    // re-derive a producer's flag. Preserve a supplied boolean `true` only.
    return input.truncated === true ? { ...built, truncated: true } : built;
  } catch {
    return unavailableEvidenceHealth();
  }
}

function projectHealthSources(value: unknown): SourceEvidenceHealth[] {
  if (!Array.isArray(value)) return [];
  const rows: SourceEvidenceHealth[] = [];
  for (const item of value.slice(0, MAX_HEALTH_SOURCES * 2)) {
    const row = snapshotRecord(item);
    if (row === undefined) continue;
    if (
      !isEvidenceSource(row.source) ||
      !isEvidenceAuthority(row.authority) ||
      !isHealthState(row.state) ||
      !isSourceDetail(row.detail)
    ) {
      continue;
    }
    rows.push({
      source: row.source,
      authority: row.authority,
      state: row.state,
      ...(isPositiveVersion(row.schemaVersion)
        ? { schemaVersion: row.schemaVersion }
        : {}),
      recordsSeen: boundedHealthCount(row.recordsSeen),
      factsAccepted: boundedHealthCount(row.factsAccepted),
      recordsRejected: boundedHealthCount(row.recordsRejected),
      detail: row.detail,
      // Time fields are re-checked by `buildEvidenceHealth`; only strings pass.
      ...(typeof row.observedAt === "string"
        ? { observedAt: row.observedAt }
        : {}),
      ...(typeof row.expiredBefore === "string"
        ? { expiredBefore: row.expiredBefore }
        : {}),
    });
  }
  return rows;
}

function projectHealthJoins(value: unknown): SessionEvidenceHealth["joins"] {
  const input = snapshotRecord(value);
  return {
    toolCalls: boundedHealthCount(input?.toolCalls),
    toolResults: boundedHealthCount(input?.toolResults),
    matchedToolResults: boundedHealthCount(input?.matchedToolResults),
    matchedLiveToolTimings: boundedHealthCount(input?.matchedLiveToolTimings),
    agentRuns: boundedHealthCount(input?.agentRuns),
    knownAgentParents: boundedHealthCount(input?.knownAgentParents),
  };
}

function projectHealthUsage(value: unknown): SessionEvidenceHealth["usage"] {
  const input = snapshotRecord(value);
  return {
    nativeLines: boundedHealthCount(input?.nativeLines),
    childLines: boundedHealthCount(input?.childLines),
    compositionReconciled: input?.compositionReconciled === true,
    dated: isHealthState(input?.dated) ? input.dated : "unavailable",
  };
}

function projectHealthAggregates(
  value: unknown,
): SessionEvidenceHealth["aggregates"] {
  const input = snapshotRecord(value);
  const skills = snapshotRecord(input?.skillInvocations);
  return {
    detail:
      typeof input?.detail === "string" &&
      AGGREGATE_DETAILS.has(
        input.detail as CanonicalRetainedAggregates["boundary"]["detail"],
      )
        ? (input.detail as CanonicalRetainedAggregates["boundary"]["detail"])
        : "expired",
    integrationCounters: boundedHealthCount(input?.integrationCounters),
    skillInvocations: {
      names: boundedHealthCount(skills?.names),
      overflow: boundedHealthCount(skills?.overflow),
      retainedInvocations: boundedHealthCount(skills?.retainedInvocations),
    },
    permissionPresence: isHealthState(input?.permissionPresence)
      ? input.permissionPresence
      : "unavailable",
    resources: isHealthState(input?.resources)
      ? input.resources
      : "unavailable",
  };
}

function projectHealthDiagnostics(value: unknown): EvidenceDiagnostic[] {
  if (!Array.isArray(value)) return [];
  const rows: EvidenceDiagnostic[] = [];
  for (const item of value.slice(0, MAX_HEALTH_DIAGNOSTICS)) {
    const row = snapshotRecord(item);
    if (row === undefined) continue;
    if (!isDiagnosticCode(row.code) || !isEvidenceSource(row.source)) continue;
    rows.push({
      code: row.code,
      severity: isDiagnosticSeverity(row.severity)
        ? row.severity
        : defaultDiagnosticSeverity(row.code),
      count: Math.max(1, boundedHealthCount(row.count)),
      source: row.source,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Canonical retained aggregates projection
// ---------------------------------------------------------------------------

/**
 * Re-validates the canonical checkpoint-surviving aggregates. A forged
 * boundary (non-token cursor, unknown detail) drops the whole aggregate, since
 * a repaired boundary would silently move the exact fold/seal point. Inner
 * values are re-checked to canonical integration/skill keys and bounded counts.
 */
function projectRetainedAggregates(
  value: unknown,
): CanonicalRetainedAggregates | undefined {
  try {
    const input = snapshotRecord(value);
    if (input === undefined || input.schemaVersion !== 1) return undefined;
    const boundaryRow = snapshotRecord(input.boundary);
    if (
      boundaryRow === undefined ||
      typeof boundaryRow.detail !== "string" ||
      !AGGREGATE_DETAILS.has(
        boundaryRow.detail as CanonicalRetainedAggregates["boundary"]["detail"],
      )
    ) {
      return undefined;
    }
    const foldedThrough = projectSequenceMap(boundaryRow.foldedThrough);
    const sealedThrough = projectSequenceMap(boundaryRow.sealedThrough);
    if (foldedThrough === undefined || sealedThrough === undefined) {
      return undefined;
    }
    const detail =
      boundaryRow.detail as CanonicalRetainedAggregates["boundary"]["detail"];
    // Cross-map boundary consistency (mirrors `assertBoundaryConsistent` in
    // `retained-aggregates.ts`). A boundary that cannot be merged is dropped
    // whole, never repaired: a clamped seal or an expired-but-populated cursor
    // map would silently move the fold point and could double count downstream.
    if (
      detail === "expired" &&
      (Object.keys(foldedThrough).length > 0 ||
        Object.keys(sealedThrough).length > 0)
    ) {
      return undefined;
    }
    for (const [writerId, sealed] of Object.entries(sealedThrough)) {
      const folded = foldedThrough[writerId];
      if (folded === undefined || sealed > folded) return undefined;
    }
    const detailExpiredBefore = boundedInstant(boundaryRow.detailExpiredBefore);
    const valueBoundary: AggregateValue<unknown>["boundary"] = {
      foldedThrough,
      sealedThrough,
    };
    const aggregates: CanonicalRetainedAggregates = {
      schemaVersion: 1,
      boundary: {
        detail,
        foldedThrough,
        sealedThrough,
        checkpointedAt: projectTimeEvidence(boundaryRow.checkpointedAt),
        ...(detailExpiredBefore === undefined ? {} : { detailExpiredBefore }),
      },
    };
    const integration = projectRetainedIntegration(
      input.integration,
      valueBoundary,
    );
    if (integration !== undefined) aggregates.integration = integration;
    const skillInvocations = projectRetainedSkills(
      input.skillInvocations,
      valueBoundary,
    );
    if (skillInvocations !== undefined) {
      aggregates.skillInvocations = skillInvocations;
    }
    const permissionPresence = projectRetainedPermission(
      input.permissionPresence,
      valueBoundary,
    );
    if (permissionPresence !== undefined) {
      aggregates.permissionPresence = permissionPresence;
    }
    const resources = projectRetainedResources(input.resources);
    if (resources !== undefined) aggregates.resources = resources;
    return aggregates;
  } catch {
    return undefined;
  }
}

function projectSequenceMap(
  value: unknown,
): Record<string, number> | undefined {
  const input = snapshotRecord(value);
  if (input === undefined) return undefined;
  // Null prototype: a legal `__proto__` writer id must survive the copy rather
  // than being swallowed by the inherited setter (storage precedent).
  const sequences: Record<string, number> = Object.create(null);
  for (const key of Object.keys(input)) {
    if (!WRITER_ID.test(key)) return undefined;
    const cursor = input[key];
    if (
      typeof cursor !== "number" ||
      !Number.isSafeInteger(cursor) ||
      cursor < 0
    ) {
      return undefined;
    }
    sequences[key] = cursor;
  }
  return sequences;
}

function projectRetainedIntegration(
  value: unknown,
  boundary: AggregateValue<unknown>["boundary"],
): CanonicalRetainedAggregates["integration"] | undefined {
  const input = snapshotRecord(value);
  if (input === undefined) return undefined;
  const projected: Partial<
    Record<IntegrationKey, AggregateValue<Record<string, number>>>
  > = {};
  for (const key of Object.keys(input).sort()) {
    if (!isCanonicalIntegrationKey(key)) continue;
    const row = snapshotRecord(input[key]);
    if (row === undefined || row.state !== "aggregate-only") continue;
    const counters = projectRetainedCounterMap(row.value);
    if (counters === undefined) continue;
    projected[key] = { value: counters, state: "aggregate-only", boundary };
  }
  return Object.keys(projected).length === 0 ? undefined : projected;
}

function projectRetainedCounterMap(
  value: unknown,
): Record<string, number> | undefined {
  const input = snapshotRecord(value);
  if (input === undefined) return undefined;
  const keys = Object.keys(input).sort();
  if (keys.length > MAX_COUNTER_KEYS) return undefined;
  // Null prototype: a legal `__proto__` counter key must survive the copy.
  const counters: Record<string, number> = Object.create(null);
  for (const key of keys) {
    if (!RETAINED_COUNTER_KEY.test(key)) continue;
    const count = input[key];
    if (!isFoldedCount(count)) continue;
    counters[key] = count;
  }
  return Object.keys(counters).length === 0 ? undefined : counters;
}

function projectRetainedSkills(
  value: unknown,
  boundary: AggregateValue<unknown>["boundary"],
): CanonicalRetainedAggregates["skillInvocations"] | undefined {
  const input = snapshotRecord(value);
  if (input === undefined) return undefined;
  const named = projectRetainedNamedSkills(input.named, boundary);
  const overflow = projectRetainedOverflow(input.overflow, boundary);
  if (named === undefined && overflow === undefined) return undefined;
  return {
    ...(named === undefined ? {} : { named }),
    ...(overflow === undefined ? {} : { overflow }),
  };
}

function projectRetainedNamedSkills(
  value: unknown,
  boundary: AggregateValue<unknown>["boundary"],
): AggregateValue<Record<string, number>> | undefined {
  const input = snapshotRecord(value);
  if (input === undefined || input.state !== "aggregate-only") return undefined;
  const rows = snapshotRecord(input.value);
  if (rows === undefined) return undefined;
  // Null prototype: a skill named `constructor`/`__proto__` must be copied as
  // an own key, never inherited from `Object.prototype`.
  const named: Record<string, number> = Object.create(null);
  for (const name of Object.keys(rows).sort()) {
    if (Object.keys(named).length >= MAX_SKILL_KEYS) break;
    const count = rows[name];
    if (!SKILL_NAME_PATTERN.test(name) || !isFoldedCount(count)) continue;
    named[name] = count;
  }
  if (Object.keys(named).length === 0) return undefined;
  return { value: named, state: "aggregate-only", boundary };
}

function projectRetainedOverflow(
  value: unknown,
  boundary: AggregateValue<unknown>["boundary"],
): AggregateValue<number> | undefined {
  const input = snapshotRecord(value);
  if (input === undefined || input.state !== "aggregate-only") return undefined;
  if (!isFoldedCount(input.value)) return undefined;
  return { value: input.value, state: "aggregate-only", boundary };
}

function projectRetainedPermission(
  value: unknown,
  boundary: AggregateValue<unknown>["boundary"],
): AggregateValue<true> | undefined {
  const input = snapshotRecord(value);
  if (input === undefined || input.state !== "aggregate-only") return undefined;
  if (input.value !== true) return undefined;
  return { value: true, state: "aggregate-only", boundary };
}

function projectRetainedResources(
  value: unknown,
): CanonicalRetainedAggregates["resources"] | undefined {
  const input = snapshotRecord(value);
  if (input === undefined) return undefined;
  if (
    typeof input.state !== "string" ||
    !RETAINED_RESOURCE_STATES.has(
      input.state as NonNullable<
        CanonicalRetainedAggregates["resources"]
      >["state"],
    )
  ) {
    return undefined;
  }
  const counts = snapshotRecord(input.counts);
  if (
    counts === undefined ||
    !isFoldedCount(counts.commands) ||
    !isFoldedCount(counts.skills)
  ) {
    return undefined;
  }
  const resources = isFoldedCount(counts.resources)
    ? counts.resources
    : undefined;
  const toolSources = isFoldedCount(counts.toolSources)
    ? counts.toolSources
    : undefined;
  return {
    counts: {
      commands: counts.commands,
      skills: counts.skills,
      ...(resources === undefined ? {} : { resources }),
      ...(toolSources === undefined ? {} : { toolSources }),
    },
    state: input.state as NonNullable<
      CanonicalRetainedAggregates["resources"]
    >["state"],
    observedAt: projectTimeEvidence(input.observedAt),
  };
}

function projectTimeEvidence(value: unknown): TimeEvidence {
  const input = snapshotRecord(value);
  if (
    input === undefined ||
    input.state !== "known" ||
    typeof input.basis !== "string" ||
    !TIME_BASES.has(
      input.basis as Extract<TimeEvidence, { state: "known" }>["basis"],
    )
  ) {
    return { state: "unavailable" };
  }
  const at = boundedInstant(input.at);
  if (at === undefined) return { state: "unavailable" };
  return {
    state: "known",
    at,
    basis: input.basis as Extract<TimeEvidence, { state: "known" }>["basis"],
  };
}

// ---------------------------------------------------------------------------
// Shared health/aggregate validators
// ---------------------------------------------------------------------------

/** A bounded non-negative count; anything else normalizes to zero. */
function boundedHealthCount(value: unknown): number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_EVIDENCE_COUNT
    ? value
    : 0;
}

function isPositiveVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isHealthState(value: unknown): value is EvidenceHealthState {
  return (
    typeof value === "string" && HEALTH_STATES.has(value as EvidenceHealthState)
  );
}

function isEvidenceAuthority(value: unknown): value is EvidenceAuthority {
  return (
    typeof value === "string" &&
    EVIDENCE_AUTHORITIES.has(value as EvidenceAuthority)
  );
}

function isEvidenceSource(value: unknown): value is EvidenceSource {
  return (
    typeof value === "string" && EVIDENCE_SOURCES.has(value as EvidenceSource)
  );
}

function isSourceDetail(
  value: unknown,
): value is SourceEvidenceHealth["detail"] {
  return (
    typeof value === "string" &&
    SOURCE_DETAILS.has(value as SourceEvidenceHealth["detail"])
  );
}

function isDiagnosticCode(value: unknown): value is EvidenceDiagnosticCode {
  return (
    typeof value === "string" &&
    DIAGNOSTIC_CODES.has(value as EvidenceDiagnosticCode)
  );
}

function isDiagnosticSeverity(
  value: unknown,
): value is EvidenceDiagnosticSeverity {
  return (
    typeof value === "string" &&
    DIAGNOSTIC_SEVERITIES.has(value as EvidenceDiagnosticSeverity)
  );
}

function boundedInstant(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_TIMESTAMP_LENGTH &&
    ISO_INSTANT_OR_DATE.test(value) &&
    !Number.isNaN(Date.parse(value))
    ? value
    : undefined;
}

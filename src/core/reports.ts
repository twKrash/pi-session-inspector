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
  isAgentLabel,
  type AgentToolActivity,
} from "../integrations/subagents.ts";

// The report-facing activity projection reuses the reader's shape so the
// native subagent evidence has exactly one DTO definition (never re-declared).
export type { AgentToolActivity };
import type {
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
  usage: Usage;
  usageComposition: ReducedSession["usageComposition"];
  models: ModelSummary[];
  tools: SessionReportTool[];
  compactions: Compaction[];
  generations: ReducedSession["generations"];
  errors: ReducedSession["errors"];
  agents: AgentRun[];
  agentEvidence: EvidenceState;
  /** Native subagent tool activity; distinct from rich cooperative runs. */
  agentActivity: AgentToolActivity;
  integrations: IntegrationObservation[];
  durationEvidence: EvidenceState;
  commands: CommandInventory;
  skills: SkillInventory;
  resources: ResourceInventory;
};

export function toSessionReport(
  reduced: ReducedSession,
  evidence: SessionReportEvidence = {},
): SessionReport {
  const models = new Map<string, ModelSummary>();
  for (const generation of reduced.generations) {
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
  const projectedEvidence = projectEvidence(evidence);
  const inventory = projectedEvidence.inventory;
  const tools = reduced.tools.map((tool) => {
    const durationMs = projectedEvidence.duration.tools.get(tool.id);
    const source = inventory?.toolSources[tool.name];
    const projected: SessionReportTool = { ...tool };
    if (durationMs !== undefined) projected.durationMs = durationMs;
    // Guard against a prototype-derived value when a tool is named after an
    // `Object.prototype` member but absent from the inventory.
    if (typeof source === "string") projected.source = source;
    return projected;
  });
  return {
    ...reduced,
    tools,
    ...(projectedEvidence.walDetail === "expired"
      ? { walDetail: "expired" as const }
      : {}),
    agents: projectedEvidence.agents,
    agentEvidence: projectedEvidence.agentEvidence,
    agentActivity: projectedEvidence.agentActivity,
    integrations: projectedEvidence.integrations,
    durationEvidence: projectedEvidence.duration.state,
    commands: projectCommands(inventory, projectedEvidence.resourceCounts),
    skills: projectSkills(inventory, projectedEvidence.counters),
    resources: projectResources(inventory),
    models: [...models.values()].sort(
      (a, b) =>
        a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model),
    ),
  };
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
  return {
    id: run.id,
    ...(parentId === undefined ? {} : { parentId }),
    ...(agent === undefined ? {} : { agent }),
    status: run.status,
    confidence: run.confidence,
    ...(artifacts === undefined ? {} : { artifacts }),
    ...(usage === undefined ? {} : { usage }),
  };
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
  };
}

import {
  isAllowedIntegrationCounter,
  isKnownIntegrationVersion,
} from "./integration-counter-allowlists.ts";
import { MAX_COUNTER_KEYS, type FoldedCounters } from "./live-counter-fold.ts";
import type { InventorySnapshot } from "../integrations/inventory.ts";
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
  integrations?: readonly IntegrationObservationInput[];
  /** Explicit per-key presence model from the process-local observation. */
  presence?: Readonly<Record<IntegrationKey, IntegrationPresence>>;
  /** Effective folded counters (`merge(checkpoint, delta)`), never a delta alone. */
  counters?: FoldedCounters;
  /** Sanitized inventory snapshot read at session start or on reload. */
  inventory?: InventorySnapshot;
  duration?: DurationEvidence;
};

export type SessionReport = {
  walDetail?: "expired";
  sessionId: string;
  usage: Usage;
  usageComposition: ReducedSession["usageComposition"];
  models: ModelSummary[];
  tools: Tool[];
  compactions: Compaction[];
  generations: ReducedSession["generations"];
  errors: ReducedSession["errors"];
  agents: AgentRun[];
  agentEvidence: EvidenceState;
  integrations: IntegrationObservation[];
  durationEvidence: EvidenceState;
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
  const tools = reduced.tools.map((tool) => {
    const durationMs = projectedEvidence.duration.tools.get(tool.id);
    return durationMs === undefined ? tool : { ...tool, durationMs };
  });
  return {
    ...reduced,
    tools,
    ...(projectedEvidence.walDetail === "expired"
      ? { walDetail: "expired" as const }
      : {}),
    agents: projectedEvidence.agents,
    agentEvidence: projectedEvidence.agentEvidence,
    integrations: projectedEvidence.integrations,
    durationEvidence: projectedEvidence.duration.state,
    models: [...models.values()].sort(
      (a, b) =>
        a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model),
    ),
  };
}

function projectEvidence(evidence: unknown): {
  walDetail?: "expired";
  agents: AgentRun[];
  agentEvidence: EvidenceState;
  integrations: IntegrationObservation[];
  duration: { state: EvidenceState; tools: Map<string, number> };
} {
  try {
    const input = snapshotRecord(evidence);
    if (input === undefined) return unavailableEvidence();
    const agents = projectAgentEvidence(input.agents);
    return {
      ...(input.walDetail === "expired"
        ? { walDetail: "expired" as const }
        : {}),
      agents: agents.runs,
      agentEvidence: agents.state,
      integrations: projectIntegrations(
        input.integrations,
        input.presence,
        input.counters,
      ),
      duration: projectDuration(input.duration),
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
  const usage = projectUsage(run.usage);
  return {
    id: run.id,
    ...(parentId === undefined ? {} : { parentId }),
    status: run.status,
    confidence: run.confidence,
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
): IntegrationObservation[] {
  const adapterRows = projectAdapterRows(value);
  const presence = projectPresence(presenceValue);
  const counters = projectFoldedCounters(countersValue);
  // Without an observation the projection keeps its adapter-only shape; with one
  // it emits exactly one row per known key so absence is explicit.
  if (presence === undefined && counters === undefined) return adapterRows;

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
      presence?.[integration],
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

function unavailableEvidence(): {
  agents: AgentRun[];
  agentEvidence: EvidenceState;
  integrations: IntegrationObservation[];
  duration: { state: EvidenceState; tools: Map<string, number> };
} {
  return {
    agents: [],
    agentEvidence: "unavailable",
    integrations: [],
    duration: { state: "unavailable", tools: new Map() },
  };
}

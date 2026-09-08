import type {
  AgentRun,
  Compaction,
  EvidenceState,
  IntegrationObservation,
  ReducedSession,
  Tool,
  Usage,
} from "./events.ts";

const MAX_AGENT_ROWS = 256;
const MAX_INTEGRATION_ROWS = 6;

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

/** Only bounded, explicit integration-adapter output may enter a report. */
export type SessionReportEvidence = {
  agents?: AdapterAgentEvidence;
  integrations?: readonly IntegrationObservation[];
};

export type SessionReport = {
  sessionId: string;
  usage: Usage;
  models: ModelSummary[];
  tools: Tool[];
  compactions: Compaction[];
  generations: ReducedSession["generations"];
  agents: AgentRun[];
  agentEvidence: EvidenceState;
  integrations: IntegrationObservation[];
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
    current.cost += generation.usage.cost;
    models.set(key, current);
  }
  return {
    ...reduced,
    agents: projectAgents(evidence.agents?.runs),
    agentEvidence: evidence.agents?.state ?? "unavailable",
    integrations: projectIntegrations(evidence.integrations),
    models: [...models.values()].sort(
      (a, b) =>
        a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model),
    ),
  };
}

function projectAgents(runs: readonly AgentRun[] | undefined): AgentRun[] {
  return (runs ?? []).slice(0, MAX_AGENT_ROWS).map((run) => ({
    id: run.id,
    ...(run.parentId === undefined ? {} : { parentId: run.parentId }),
    status: run.status,
    confidence: run.confidence,
    ...(run.usage === undefined
      ? {}
      : {
          usage: {
            totalTokens: run.usage.totalTokens,
            cost: run.usage.cost,
          },
        }),
  }));
}

function projectIntegrations(
  observations: readonly IntegrationObservation[] | undefined,
): IntegrationObservation[] {
  return (observations ?? []).slice(0, MAX_INTEGRATION_ROWS).map((row) => ({
    integration: row.integration,
    version: row.version,
    state: row.state,
    ...(row.counters === undefined ? {} : { counters: { ...row.counters } }),
  }));
}

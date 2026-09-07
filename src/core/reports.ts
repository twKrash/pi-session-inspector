import type { Compaction, ReducedSession, Tool, Usage } from "./events.ts";

export type ModelSummary = {
  provider: string;
  model: string;
  generations: number;
  totalTokens: number;
  cost: number;
};

export type SessionReport = {
  sessionId: string;
  usage: Usage;
  models: ModelSummary[];
  tools: Tool[];
  compactions: Compaction[];
  generations: ReducedSession["generations"];
};

export function toSessionReport(reduced: ReducedSession): SessionReport {
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
    models: [...models.values()].sort(
      (a, b) =>
        a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model),
    ),
  };
}

import type {
  AgentRun,
  AgentRunCoverage,
  AgentRunSourceObservation,
  AgentRunUsage,
  ChildSessionProjection,
  SubagentSourceEvidence,
} from "../core/events.ts";

// ADR 0028: a projected child session only fills fields no persisted
// observation of the same run already carries; persisted Pi evidence wins.
const TOKEN_FIELDS = [
  "totalTokens",
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "reasoningTokens",
] as const;
const COST_FIELDS = [
  "cost",
  "inputCost",
  "outputCost",
  "cacheReadCost",
  "cacheWriteCost",
] as const;
const USAGE_FIELDS = [...TOKEN_FIELDS, ...COST_FIELDS] as const;
// Same bound as the lifecycle reader.
const MAX_OBSERVATIONS = 512;

type Fill = {
  model?: string;
  toolCalls?: number;
  /** Only the usage fields taken from the child file. */
  filled: AgentRunUsage;
  /** Persisted usage (latest value per field) plus `filled`. */
  merged: AgentRunUsage;
};

/**
 * `projectionsBySource` is keyed by the private source identity of the run's
 * launch observation. Rows are never created and no persisted field is
 * overwritten; a filled field is `partial` coverage because the child file is a
 * mutable source.
 *
 * Reconciliation keeps one whole `usage` object per run, taken from its latest
 * observation. A fill written only onto the launch would vanish behind a later
 * completion, so every observation of the run carries the same merged usage.
 */
export function applyChildSessionProjections(
  evidence: SubagentSourceEvidence,
  projectionsBySource: ReadonlyMap<string, ChildSessionProjection>,
): SubagentSourceEvidence {
  if (projectionsBySource.size === 0) return evidence;
  const observations = boundedObservations(evidence.observations);
  if (observations === undefined) return evidence;
  const { aliases = [] } = evidence;
  const publicIdBySource = new Map(
    aliases.map((alias) => [alias.sourceIdentity, alias.publicId]),
  );
  const logicalId = (observation: AgentRunSourceObservation) => {
    const publicId = publicIdBySource.get(observation.sourceIdentity);
    return publicId === undefined ? observation.run.id : publicId;
  };
  const fills = planFills(observations, logicalId, projectionsBySource);
  return {
    ...evidence,
    observations: observations.map((observation) => {
      const fill = fills.get(logicalId(observation));
      if (fill === undefined) return observation;
      const run = fillRun(observation.run, fill);
      return run === observation.run ? observation : { ...observation, run };
    }),
  };
}

function boundedObservations(
  observations: Iterable<AgentRunSourceObservation>,
): AgentRunSourceObservation[] | undefined {
  const bounded: AgentRunSourceObservation[] = [];
  for (const observation of observations) {
    if (bounded.length >= MAX_OBSERVATIONS) return undefined;
    bounded.push(observation);
  }
  return bounded;
}

function planFills(
  observations: readonly AgentRunSourceObservation[],
  logicalId: (observation: AgentRunSourceObservation) => string,
  projectionsBySource: ReadonlyMap<string, ChildSessionProjection>,
): Map<string, Fill> {
  const members = new Map<string, AgentRunSourceObservation[]>();
  for (const observation of observations) {
    const id = logicalId(observation);
    const group = members.get(id);
    if (group === undefined) members.set(id, [observation]);
    else group.push(observation);
  }
  const fills = new Map<string, Fill>();
  for (const [id, group] of members) {
    const projection = projectionOf(group, projectionsBySource);
    if (projection !== undefined) fills.set(id, planFill(group, projection));
  }
  return fills;
}

function projectionOf(
  group: readonly AgentRunSourceObservation[],
  projectionsBySource: ReadonlyMap<string, ChildSessionProjection>,
): ChildSessionProjection | undefined {
  for (const { sourceIdentity } of group) {
    const projection = projectionsBySource.get(sourceIdentity);
    if (projection !== undefined) return projection;
  }
  return undefined;
}

function planFill(
  group: readonly AgentRunSourceObservation[],
  projection: ChildSessionProjection,
): Fill {
  const persisted = persistedUsage(group);
  const filled: AgentRunUsage = {};
  for (const field of USAGE_FIELDS) {
    const value = projection.usage?.[field];
    if (value !== undefined && persisted[field] === undefined) {
      filled[field] = value;
    }
  }
  const { model, toolCalls } = projection;
  return {
    ...(model === undefined || group.some(({ run }) => run.model !== undefined)
      ? {}
      : { model }),
    ...(toolCalls === undefined ||
    group.some(({ run }) => run.toolCalls !== undefined)
      ? {}
      : { toolCalls }),
    filled,
    merged: { ...persisted, ...filled },
  };
}

/** The latest observation that defines a usage field decides it, field by field. */
function persistedUsage(
  group: readonly AgentRunSourceObservation[],
): AgentRunUsage {
  const merged: AgentRunUsage = {};
  for (const { run } of [...group].sort((a, b) => a.order - b.order)) {
    for (const field of USAGE_FIELDS) {
      const value = run.usage?.[field];
      if (value !== undefined) merged[field] = value;
    }
  }
  return merged;
}

function fillRun(run: AgentRun, fill: Fill): AgentRun {
  const usageFilled = hasAny(fill.filled, USAGE_FIELDS);
  if (
    fill.model === undefined &&
    fill.toolCalls === undefined &&
    !usageFilled
  ) {
    return run;
  }
  return {
    ...run,
    ...(fill.model === undefined ? {} : { model: fill.model }),
    ...(fill.toolCalls === undefined ? {} : { toolCalls: fill.toolCalls }),
    ...(usageFilled ? { usage: { ...fill.merged } } : {}),
    effortCoverage: raisedCoverage(run.effortCoverage, fill),
  };
}

function raisedCoverage(
  coverage: AgentRun["effortCoverage"],
  fill: Fill,
): AgentRun["effortCoverage"] {
  return {
    ...coverage,
    ...(hasAny(fill.filled, TOKEN_FIELDS)
      ? { usage: raise(coverage.usage) }
      : {}),
    ...(hasAny(fill.filled, COST_FIELDS) ? { cost: raise(coverage.cost) } : {}),
    ...(fill.toolCalls === undefined ? {} : { tools: raise(coverage.tools) }),
  };
}

function hasAny(
  usage: AgentRunUsage,
  fields: readonly (keyof AgentRunUsage)[],
): boolean {
  return fields.some((field) => usage[field] !== undefined);
}

function raise(current: AgentRunCoverage): AgentRunCoverage {
  return current === "unavailable" ? "partial" : current;
}

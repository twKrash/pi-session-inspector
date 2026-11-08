import type {
  AgentRun,
  AgentRunCoverage,
  AgentRunSourceObservation,
  AgentRunUsage,
  SubagentSourceEvidence,
} from "../core/events.ts";
import type { ChildSessionProjection } from "./subagent-child-session.ts";

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

type Fill = { model?: string; toolCalls?: number; usage: AgentRunUsage };

/**
 * `projectionsBySource` is keyed by the private source identity of the run's
 * launch observation. Rows are never created and no field is overwritten; a
 * filled field is `partial` coverage because the child file is a mutable source.
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
  const present = presentByRun(observations, logicalId);
  return {
    ...evidence,
    observations: observations.map((observation) => {
      const projection = projectionsBySource.get(observation.sourceIdentity);
      if (projection === undefined) return observation;
      const run = fillRun(
        observation.run,
        projection,
        fieldsFor(present, logicalId(observation)),
      );
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

/** The fields any persisted observation of each logical run already carries. */
function presentByRun(
  observations: readonly AgentRunSourceObservation[],
  logicalId: (observation: AgentRunSourceObservation) => string,
): Map<string, Set<string>> {
  const present = new Map<string, Set<string>>();
  for (const observation of observations) {
    const fields = fieldsFor(present, logicalId(observation));
    for (const field of presentFields(observation.run)) fields.add(field);
  }
  return present;
}

function fieldsFor(present: Map<string, Set<string>>, id: string): Set<string> {
  const known = present.get(id);
  if (known !== undefined) return known;
  const created = new Set<string>();
  present.set(id, created);
  return created;
}

function presentFields(run: AgentRun): string[] {
  return [
    ...(run.model === undefined ? [] : ["model"]),
    ...(run.toolCalls === undefined ? [] : ["toolCalls"]),
    ...USAGE_FIELDS.filter((field) => run.usage?.[field] !== undefined),
  ];
}

function planFill(
  projection: ChildSessionProjection,
  present: ReadonlySet<string>,
): Fill {
  const { model, toolCalls } = projection;
  return {
    ...(model === undefined || present.has("model") ? {} : { model }),
    ...(toolCalls === undefined || present.has("toolCalls")
      ? {}
      : { toolCalls }),
    usage: fillableUsage(projection, present),
  };
}

function fillRun(
  run: AgentRun,
  projection: ChildSessionProjection,
  present: ReadonlySet<string>,
): AgentRun {
  const fill = planFill(projection, present);
  const usageFilled = hasAny(fill.usage, USAGE_FIELDS);
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
    ...(usageFilled ? { usage: { ...run.usage, ...fill.usage } } : {}),
    effortCoverage: raisedCoverage(run.effortCoverage, fill),
  };
}

function raisedCoverage(
  coverage: AgentRun["effortCoverage"],
  fill: Fill,
): AgentRun["effortCoverage"] {
  return {
    ...coverage,
    ...(hasAny(fill.usage, TOKEN_FIELDS)
      ? { usage: raise(coverage.usage) }
      : {}),
    ...(hasAny(fill.usage, COST_FIELDS) ? { cost: raise(coverage.cost) } : {}),
    ...(fill.toolCalls === undefined ? {} : { tools: raise(coverage.tools) }),
  };
}

function hasAny(
  usage: AgentRunUsage,
  fields: readonly (keyof AgentRunUsage)[],
): boolean {
  return fields.some((field) => usage[field] !== undefined);
}

function fillableUsage(
  projection: ChildSessionProjection,
  present: ReadonlySet<string>,
): AgentRunUsage {
  const usage: AgentRunUsage = {};
  for (const field of USAGE_FIELDS) {
    const value = projection.usage?.[field];
    if (value !== undefined && !present.has(field)) usage[field] = value;
  }
  return usage;
}

function raise(current: AgentRunCoverage): AgentRunCoverage {
  return current === "unavailable" ? "partial" : current;
}

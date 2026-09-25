import type {
  AgentRun,
  AgentRunIdentityAlias,
  AgentRunSourceObservation,
  SubagentEvidenceDiagnostic,
} from "./events.ts";

const MAX_RUNS = 256;
const SOURCE_ID = /^subagent-source-[a-f0-9]{64}$/;
const CANONICAL_ID = /^subagent-canonical-[a-f0-9]{64}$/;
const PUBLIC_ID = /^subagent-[a-f0-9]{64}$/;
const MUTABLE_FIELDS = [
  "artifacts",
  "observedAt",
  "evidenceToolId",
  "model",
  "thinking",
  "failure",
  "usage",
  "durationMs",
  "toolCalls",
] as const;
type MutableField = (typeof MUTABLE_FIELDS)[number];
type IdentityField = "parentId" | "agent";
type TerminalStatus = Exclude<AgentRun["status"], "running" | "unknown">;
type ConflictCounter = { count: number };
type StatusState = {
  terminal?: TerminalStatus;
  terminalOrder?: number;
  runningOrder?: number;
  conflict: boolean;
};
type RunAccumulator = {
  sourceIdentity: string;
  publicId: string;
  firstOrder: number;
  run: AgentRun;
  fieldOrders: Partial<Record<MutableField, number>>;
  fieldConflicts: Set<MutableField>;
  identityConflicts: Set<IdentityField>;
  publicIdConflict: boolean;
  status: StatusState;
};
type RunRow = { firstOrder: number; tie: string; run: AgentRun };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSourceIdentity(value: unknown): value is string {
  return typeof value === "string" && SOURCE_ID.test(value);
}

function isCanonicalIdentity(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (SOURCE_ID.test(value) || CANONICAL_ID.test(value))
  );
}

function isPublicId(value: unknown): value is string {
  return typeof value === "string" && PUBLIC_ID.test(value);
}

function isRunStatus(value: unknown): value is AgentRun["status"] {
  return (
    value === "running" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "interrupted" ||
    value === "unknown"
  );
}

function readObservation(
  value: unknown,
): AgentRunSourceObservation | undefined {
  try {
    if (!isRecord(value) || !isRecord(value.run)) return undefined;
    const run = value.run;
    if (
      !isSourceIdentity(value.sourceIdentity) ||
      typeof value.order !== "number" ||
      !Number.isSafeInteger(value.order) ||
      value.order < 0 ||
      !isPublicId(run.id) ||
      !isRunStatus(run.status)
    ) {
      return undefined;
    }
    return {
      sourceIdentity: value.sourceIdentity,
      order: value.order,
      run: run as unknown as AgentRun,
    };
  } catch {
    return undefined;
  }
}

function readAlias(value: unknown): AgentRunIdentityAlias | undefined {
  if (!isRecord(value)) return undefined;
  return isSourceIdentity(value.sourceIdentity) &&
    isCanonicalIdentity(value.canonicalIdentity) &&
    isPublicId(value.publicId)
    ? {
        sourceIdentity: value.sourceIdentity,
        canonicalIdentity: value.canonicalIdentity,
        publicId: value.publicId,
      }
    : undefined;
}

function addConflict(counter: ConflictCounter): void {
  counter.count = Math.min(MAX_RUNS, counter.count + 1);
}

function newAccumulator(
  sourceIdentity: string,
  publicId: string,
  order: number,
): RunAccumulator {
  return {
    sourceIdentity,
    publicId,
    firstOrder: order,
    run: {
      id: publicId,
      status: "unknown",
      confidence: "unavailable",
      effortCoverage: {
        duration: "unavailable",
        generations: "unavailable",
        tools: "unavailable",
        errors: "unavailable",
        usage: "unavailable",
        cost: "unavailable",
      },
    },
    fieldOrders: {},
    fieldConflicts: new Set(),
    identityConflicts: new Set(),
    publicIdConflict: false,
    status: { conflict: false },
  };
}

function updateIdentity(
  accumulator: RunAccumulator,
  field: IdentityField,
  value: string | undefined,
  selfId: string,
  conflicts: ConflictCounter,
): void {
  if (
    value === undefined ||
    (field === "parentId" && value === selfId) ||
    accumulator.identityConflicts.has(field)
  ) {
    return;
  }
  const current = accumulator.run[field];
  if (current === undefined) Object.assign(accumulator.run, { [field]: value });
  else if (current !== value) {
    Object.assign(accumulator.run, { [field]: undefined });
    accumulator.identityConflicts.add(field);
    addConflict(conflicts);
  }
}

function updateField(
  accumulator: RunAccumulator,
  field: MutableField,
  value: unknown,
  order: number,
  conflicts: ConflictCounter,
): void {
  if (value === undefined) return;
  const currentOrder = accumulator.fieldOrders[field];
  if (currentOrder === undefined || order > currentOrder) {
    Object.assign(accumulator.run, { [field]: value });
    accumulator.fieldOrders[field] = order;
    accumulator.fieldConflicts.delete(field);
  } else if (
    order === currentOrder &&
    !accumulator.fieldConflicts.has(field) &&
    !Object.is(accumulator.run[field], value)
  ) {
    Object.assign(accumulator.run, { [field]: undefined });
    accumulator.fieldConflicts.add(field);
    addConflict(conflicts);
  }
}

function updateStatus(
  status: StatusState,
  next: AgentRun["status"],
  order: number,
  conflicts: ConflictCounter,
): void {
  if (next === "unknown") return;
  if (next === "running") {
    status.runningOrder = Math.max(status.runningOrder ?? order, order);
  } else {
    if (
      status.terminal !== undefined &&
      status.terminal !== next &&
      !status.conflict
    ) {
      status.conflict = true;
      addConflict(conflicts);
    }
    if (status.terminalOrder === undefined || order < status.terminalOrder) {
      status.terminal = next;
      status.terminalOrder = order;
    }
  }
  if (
    status.terminalOrder !== undefined &&
    status.runningOrder !== undefined &&
    status.runningOrder >= status.terminalOrder &&
    !status.conflict
  ) {
    status.conflict = true;
    addConflict(conflicts);
  }
}

function addObservation(
  accumulator: RunAccumulator,
  observation: AgentRunSourceObservation,
  conflicts: ConflictCounter,
): void {
  const { run, order } = observation;
  if (run.id !== accumulator.publicId) {
    if (!accumulator.publicIdConflict) {
      accumulator.publicIdConflict = true;
      addConflict(conflicts);
    }
    return;
  }
  accumulator.firstOrder = Math.min(accumulator.firstOrder, order);
  updateIdentity(accumulator, "parentId", run.parentId, run.id, conflicts);
  updateIdentity(accumulator, "agent", run.agent, run.id, conflicts);
  updateStatus(accumulator.status, run.status, order, conflicts);
  for (const field of MUTABLE_FIELDS) {
    updateField(accumulator, field, run[field], order, conflicts);
  }
}

function mergeStatus(
  target: StatusState,
  source: StatusState,
  conflicts: ConflictCounter,
): void {
  const terminalConflict =
    target.terminal !== undefined &&
    source.terminal !== undefined &&
    target.terminal !== source.terminal;
  if (
    source.terminalOrder !== undefined &&
    (target.terminalOrder === undefined ||
      source.terminalOrder < target.terminalOrder)
  ) {
    target.terminal = source.terminal;
    target.terminalOrder = source.terminalOrder;
  }
  if (source.runningOrder !== undefined) {
    target.runningOrder = Math.max(
      target.runningOrder ?? source.runningOrder,
      source.runningOrder,
    );
  }
  target.conflict ||= source.conflict;
  const regression =
    target.terminalOrder !== undefined &&
    target.runningOrder !== undefined &&
    target.runningOrder >= target.terminalOrder;
  if ((terminalConflict || regression) && !target.conflict) {
    target.conflict = true;
    addConflict(conflicts);
  }
}

function mergeAccumulator(
  target: RunAccumulator,
  source: RunAccumulator,
  conflicts: ConflictCounter,
): void {
  target.firstOrder = Math.min(target.firstOrder, source.firstOrder);
  for (const field of ["parentId", "agent"] as const) {
    if (source.identityConflicts.has(field)) {
      target.identityConflicts.add(field);
      Object.assign(target.run, { [field]: undefined });
    } else {
      updateIdentity(
        target,
        field,
        source.run[field],
        target.publicId,
        conflicts,
      );
    }
  }
  mergeStatus(target.status, source.status, conflicts);
  for (const field of MUTABLE_FIELDS) {
    const order = source.fieldOrders[field];
    if (order === undefined) continue;
    const targetOrder = target.fieldOrders[field];
    if (source.fieldConflicts.has(field)) {
      if (targetOrder === undefined || order >= targetOrder) {
        target.fieldOrders[field] = order;
        target.fieldConflicts.add(field);
        Object.assign(target.run, { [field]: undefined });
      }
    } else {
      updateField(target, field, source.run[field], order, conflicts);
    }
  }
}

function mergeAliases(
  members: readonly RunAccumulator[],
  publicId: string,
  conflicts: ConflictCounter,
): RunAccumulator {
  const sorted = [...members].sort((a, b) =>
    a.sourceIdentity < b.sourceIdentity
      ? -1
      : a.sourceIdentity > b.sourceIdentity
        ? 1
        : 0,
  );
  const first = sorted[0];
  if (first === undefined)
    throw new Error("Cannot reconcile an empty alias group");
  const merged = newAccumulator(
    first.sourceIdentity,
    publicId,
    first.firstOrder,
  );
  for (const member of sorted) mergeAccumulator(merged, member, conflicts);
  return merged;
}

function toAgentRun(accumulator: RunAccumulator): AgentRun {
  const { run, status, fieldConflicts, identityConflicts } = accumulator;
  const usage = run.usage;
  const result: AgentRun = {
    ...run,
    id: accumulator.publicId,
    status: status.conflict
      ? "unknown"
      : (status.terminal ??
        (status.runningOrder === undefined ? "unknown" : "running")),
    confidence: "cooperative",
    effortCoverage: {
      duration: run.durationMs === undefined ? "unavailable" : "partial",
      generations: "unavailable",
      tools: run.toolCalls === undefined ? "unavailable" : "partial",
      errors: "unavailable",
      usage: usage?.totalTokens === undefined ? "unavailable" : "partial",
      cost: usage?.cost === undefined ? "unavailable" : "partial",
    },
  };
  for (const field of fieldConflicts) delete result[field];
  for (const field of identityConflicts) delete result[field];
  if (result.failure !== undefined) result.failure = { ...result.failure };
  if (result.usage !== undefined) result.usage = { ...result.usage };
  return result;
}

function buildAliasIndex(
  aliases: readonly AgentRunIdentityAlias[] | undefined,
  conflicts: ConflictCounter,
): Map<string, AgentRunIdentityAlias> {
  const bySource = new Map<string, AgentRunIdentityAlias>();
  const ambiguous = new Set<string>();
  if (aliases === undefined) return bySource;
  if (aliases.length > MAX_RUNS) {
    addConflict(conflicts);
    return bySource;
  }
  for (const value of aliases) {
    const alias = readAlias(value);
    if (alias === undefined) {
      const source = isRecord(value) ? value.sourceIdentity : undefined;
      if (isSourceIdentity(source)) {
        bySource.delete(source);
        ambiguous.add(source);
      }
      addConflict(conflicts);
      continue;
    }
    if (ambiguous.has(alias.sourceIdentity)) continue;
    const previous = bySource.get(alias.sourceIdentity);
    if (
      previous !== undefined &&
      (previous.canonicalIdentity !== alias.canonicalIdentity ||
        previous.publicId !== alias.publicId)
    ) {
      bySource.delete(alias.sourceIdentity);
      ambiguous.add(alias.sourceIdentity);
      addConflict(conflicts);
    } else {
      bySource.set(alias.sourceIdentity, alias);
    }
  }
  return bySource;
}

function diagnostics(
  runs: AgentRun[],
  conflicts: ConflictCounter,
): { runs: AgentRun[]; diagnostics: readonly SubagentEvidenceDiagnostic[] } {
  return {
    runs,
    diagnostics:
      conflicts.count === 0
        ? []
        : [{ code: "cooperative-evidence-conflict", count: conflicts.count }],
  };
}

/** Reconcile by private source identity; merge other sources only through exact aliases. */
export function reconcileAgentRuns(
  observations: Iterable<AgentRunSourceObservation>,
  aliases?: readonly AgentRunIdentityAlias[],
): { runs: AgentRun[]; diagnostics: readonly SubagentEvidenceDiagnostic[] } {
  const conflicts = { count: 0 };
  const bySource = new Map<string, RunAccumulator>();
  for (const value of observations) {
    const observation = readObservation(value);
    if (observation === undefined) {
      addConflict(conflicts);
      continue;
    }
    let accumulator = bySource.get(observation.sourceIdentity);
    if (accumulator === undefined) {
      if (bySource.size >= MAX_RUNS) {
        addConflict(conflicts);
        return diagnostics([], conflicts);
      }
      accumulator = newAccumulator(
        observation.sourceIdentity,
        observation.run.id,
        observation.order,
      );
      bySource.set(observation.sourceIdentity, accumulator);
    }
    addObservation(accumulator, observation, conflicts);
  }

  // The persisted adapter uses this path: one proven merge per exact source ID.
  if (aliases === undefined || aliases.length === 0) {
    const runs = [...bySource.values()]
      .filter((accumulator) => !accumulator.publicIdConflict)
      .sort(
        (a, b) =>
          a.firstOrder - b.firstOrder ||
          (a.sourceIdentity < b.sourceIdentity
            ? -1
            : a.sourceIdentity > b.sourceIdentity
              ? 1
              : 0),
      )
      .map(toAgentRun);
    return diagnostics(runs, conflicts);
  }

  const byAlias = buildAliasIndex(aliases, conflicts);
  const rows: RunRow[] = [];
  const groups = new Map<
    string,
    { aliases: AgentRunIdentityAlias[]; members: RunAccumulator[] }
  >();
  for (const accumulator of bySource.values()) {
    if (accumulator.publicIdConflict) continue;
    const alias = byAlias.get(accumulator.sourceIdentity);
    if (alias === undefined) {
      rows.push({
        firstOrder: accumulator.firstOrder,
        tie: `source:${accumulator.sourceIdentity}`,
        run: toAgentRun(accumulator),
      });
      continue;
    }
    const group = groups.get(alias.canonicalIdentity) ?? {
      aliases: [],
      members: [],
    };
    group.aliases.push(alias);
    group.members.push(accumulator);
    groups.set(alias.canonicalIdentity, group);
  }

  for (const [canonicalIdentity, group] of groups) {
    const publicId = group.aliases[0]?.publicId;
    if (
      publicId === undefined ||
      !group.aliases.every((alias) => alias.publicId === publicId) ||
      !group.members.some((member) => member.publicId === publicId)
    ) {
      addConflict(conflicts);
      for (const member of group.members) {
        rows.push({
          firstOrder: member.firstOrder,
          tie: `source:${member.sourceIdentity}`,
          run: toAgentRun(member),
        });
      }
      continue;
    }
    const merged = mergeAliases(group.members, publicId, conflicts);
    rows.push({
      firstOrder: merged.firstOrder,
      tie: `canonical:${canonicalIdentity}`,
      run: toAgentRun(merged),
    });
  }

  rows.sort(
    (a, b) =>
      a.firstOrder - b.firstOrder ||
      (a.tie < b.tie ? -1 : a.tie > b.tie ? 1 : 0),
  );
  return diagnostics(
    rows.slice(0, MAX_RUNS).map((row) => row.run),
    conflicts,
  );
}

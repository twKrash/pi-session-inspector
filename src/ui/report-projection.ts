import type { EvidenceState } from "../core/events.ts";
import { buildLedger, type LedgerItem } from "../core/ledger.ts";
import { cacheHitPercent, type SessionReport } from "../core/reports.ts";
import { roundCost } from "../core/rounding.ts";
import type { SessionCoverage } from "../core/session-coverage.ts";
import type { DateUsageRow, DatedModelRow } from "./dated-usage.ts";
import type { GlobalReport, HistoryReport } from "./load-history.ts";
import { createTranslator } from "./i18n.ts";
import { ENGLISH_CATALOG, type MessageKey } from "./i18n/catalog.ts";

const t = createTranslator();

/**
 * The one catalog-independent report projection (ADR 0018): every safe, bounded
 * row and total the report surfaces read, with no renderer, route, loader,
 * filesystem or browser state. The L2 DTO in `ui-projection.ts` builds on these
 * transforms and `snapshot.ts` renders them, so no surface reimplements report
 * semantics.
 *
 * Every function here is pure: it reads a `SessionReport`/`HistoryReport`/
 * `GlobalReport` (or the bounded dated rows a loader published) and returns
 * bounded values. Nothing in this module reads a producer payload, a file, a
 * clock, or the DOM.
 */

type SafeUsage = NonNullable<SessionReport["usage"]>;
type CompositionKey =
  | "generations"
  | "toolResults"
  | "compactions"
  | "branchSummaries";
export type CompositionView = {
  available: boolean;
  parts: Array<{
    key: CompositionKey;
    totalTokens: number;
    cost: number;
    confidence: "native";
  }>;
  total?: { totalTokens: number; cost: number };
  reconciles: boolean;
};
export type ModelRow = {
  provider: string;
  model: string;
  generations: number;
  totalTokens: number;
  cost: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};
type BarRow = { label: string; value: string; percent: number };
/**
 * The bounded call fields both tools views read (design §7.6). The derivation is
 * typed to exactly these names, so a persisted argument payload or result body
 * has no path into either view even when a producer planted one.
 */
export type ToolCallRow = {
  name: string;
  /** Sanitized inventory source label; absent when no source was attributed. */
  source?: string;
  status: SessionReport["tools"][number]["status"];
  /**
   * The persisted call timestamp (spec §5.7). The UTC day it names is the only
   * time attribution for a tool row, so usage stays on the call day.
   */
  timestamp: string;
  /** Persisted usage, or `null` when the matching result carried none. */
  usage: { totalTokens: number; cost: number } | null;
};

/** The projected call row: the shared fields plus the table-only ones. */
export type ToolRow = Omit<ToolCallRow, "usage"> & {
  id: string;
  usage: SafeUsage | null;
  durationMs: number | null;
  durationLabel: string | null;
};
export type AgentRow = {
  id: string;
  parentId: string | null;
  agent: SessionReport["agents"][number]["agent"] | null;
  status: SessionReport["agents"][number]["status"];
  confidence: SessionReport["agents"][number]["confidence"];
  artifacts: SessionReport["agents"][number]["artifacts"] | null;
  /** Observation time only; never a run start, end, or duration. */
  observedAt: string | null;
  evidenceToolId: string | null;
  model: SessionReport["agents"][number]["model"] | null;
  thinking: SessionReport["agents"][number]["thinking"] | null;
  failure: SessionReport["agents"][number]["failure"] | null;
  usage: SafeUsage | null;
};
export type IntegrationRow = {
  integration: string;
  presence: SessionReport["integrations"][number]["presence"];
  version: number | null;
  state: EvidenceState;
  counters: string[];
};
export type EvidenceRow = {
  source: string;
  observation: string;
  confidence: string;
};
export type ErrorRow = {
  id: string;
  timestamp: string;
  kind: string;
  confidence: string;
  /** Bounded redacted persisted message; absent means Unavailable. */
  message?: string;
  /** The joined tool's name; null when no tool carries this error's id. */
  toolName: string | null;
  /** The joined tool's bounded source label; null when absent or unmatched. */
  toolSource: string | null;
  /** The joined tool's persisted status; null when no tool carries this id. */
  toolStatus: SessionReport["tools"][number]["status"] | null;
  /**
   * Every child run the publishing result observed, in run order. The relation
   * is one-to-many and names no run as the cause (design §7.5).
   */
  relatedChildIds: string[];
};
export type StatusView = {
  key: "status.errors" | "status.interrupted" | "status.clean";
  tone: "neutral" | "warn";
};
export type SessionReportView = {
  sessionId: string;
  usage?: SafeUsage;
  cacheHitPercent: number | null;
  compactionCount: number;
  composition: CompositionView;
  generationCount: number;
  toolCount: number;
  durationMs: number | null;
  durationLabel: string | null;
  span: { from: string; to: string } | null;
  agentCount: number | null;
  agentEvidence: EvidenceState;
  agentActivity: SessionReport["agentActivity"];
  durationEvidence: EvidenceState;
  status: StatusView;
  models: ModelRow[];
  modelBars: BarRow[];
  tools: ToolRow[];
  toolBars: BarRow[];
  agents: AgentRow[];
  integrations: IntegrationRow[];
  errors: ErrorRow[];
  commands: SessionReport["commands"];
  skills: SessionReport["skills"];
  resources: SessionReport["resources"];
  ledger: LedgerItem[];
};
export type HistoryEntryView = {
  availability: "available" | "unavailable";
  sessionId: string;
  firstDate: string | null;
  lastDate: string | null;
  durationLabel: string | null;
  totalTokens: number | null;
  cost: number | null;
  generationCount: number | null;
  agentCount: number | null;
  status: StatusView | null;
  /**
   * The session's own bounded per-date rows, the only evidence that can decide
   * range membership (design §5.6). Absent when the session has no dated
   * evidence at all, which is exactly when it cannot be attributed to a range.
   */
  usageByDate?: readonly DateUsageRow[];
  usageByDateTruncated?: boolean;
  /**
   * The same session's per-date model rows, so its detail filters the Models
   * tab exactly like the current section. Absent when the payload carries no
   * dated projection, which labels the aggregate table.
   */
  datedModels?: readonly DatedModelRow[];
  modelsTruncated?: boolean;
  view?: SessionReportView;
};

const COMPOSITION_KEYS: readonly CompositionKey[] = [
  "generations",
  "toolResults",
  "compactions",
  "branchSummaries",
];
const DAY = /^(\d{4}-\d{2}-\d{2})/;

/**
 * The one wording ladder for an aggregate's labels. Value availability
 * (`usageUnavailable`) is independent of coverage availability: an all-
 * unavailable session set still has a known inspection size, while a report
 * without `coverage` has values of unknown completeness.
 */
export type UsageLabels = {
  cost: MessageKey;
  tokens: MessageKey;
  usageUnavailable: boolean;
  sessions: MessageKey;
};

export function aggregateUsageLabels(input: {
  availability: "available" | "unavailable";
  coverage: SessionCoverage | undefined;
}): UsageLabels {
  if (input.availability !== "available") {
    return {
      cost: "metric.costUnavailable",
      tokens: "metric.costUnavailable",
      usageUnavailable: true,
      sessions: "coverage.unknown",
    };
  }
  const coverage = input.coverage;
  if (coverage === undefined) {
    return {
      cost: "coverage.unknownCompletenessCost",
      tokens: "coverage.unknownCompletenessTokens",
      usageUnavailable: false,
      sessions: "coverage.unknown",
    };
  }
  if (coverage.inspected === 0) {
    return {
      cost: "metric.costUnavailable",
      tokens: "metric.costUnavailable",
      usageUnavailable: true,
      sessions: "coverage.none",
    };
  }
  if (coverage.complete) {
    return {
      cost: "metric.cost",
      tokens: "metric.tokens",
      usageUnavailable: false,
      sessions: "coverage.complete",
    };
  }
  return {
    cost: "metric.knownCost",
    tokens: "metric.knownTokens",
    usageUnavailable: coverage.available === 0,
    sessions: coverage.discoveryLimited
      ? "coverage.sessionsLimited"
      : "coverage.sessions",
  };
}

/** Aggregate-only coverage projection: the report's coverage plus its wording. */
export type CoverageProjection = {
  inspected: number;
  available: number;
  unavailable: number;
  sessionRatio: number | null;
  complete: boolean;
  discoveryLimited: boolean;
  /** Pre-joined bounded reason tokens, `reason: count` in enumeration order. */
  reasons: string;
  /** Pre-rendered session line; the catalog key comes from the one ladder. */
  line: string;
};

/**
 * `null` when the report carries no coverage at all (unavailable aggregate or a
 * report older than the coverage field), never a fabricated zero pass. The
 * session line is interpolated here from the catalog template the ladder chose,
 * so the document states its own completeness without a second wording ladder
 * and without waiting for the browser runtime.
 */
export function coverageProjection(
  availability: "available" | "unavailable",
  coverage: SessionCoverage | undefined,
): CoverageProjection | null {
  if (coverage === undefined) return null;
  const key = aggregateUsageLabels({ availability, coverage }).sessions;
  return {
    ...coverage,
    reasons: Object.entries(coverage.reasons)
      .map(([reason, count]) => `${reason}: ${count}`)
      .join(" · "),
    line: t(key as MessageKey, {
      available: coverage.available,
      inspected: coverage.inspected,
      unavailable: coverage.unavailable,
    }),
  };
}

/** Optional token fields stay absent unless an input observed them. */
export function safeUsage(
  usage: NonNullable<SessionReport["usage"]>,
): SafeUsage {
  return {
    totalTokens: usage.totalTokens,
    cost: usage.cost,
    ...(usage.inputTokens === undefined
      ? {}
      : { inputTokens: usage.inputTokens }),
    ...(usage.outputTokens === undefined
      ? {}
      : { outputTokens: usage.outputTokens }),
    ...(usage.cacheReadTokens === undefined
      ? {}
      : { cacheReadTokens: usage.cacheReadTokens }),
    ...(usage.cacheWriteTokens === undefined
      ? {}
      : { cacheWriteTokens: usage.cacheWriteTokens }),
  };
}

/** Earliest to latest native record span; fewer than two records is unknown. */
function sessionSpanMs(report: SessionReport): number | undefined {
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  let count = 0;
  for (const record of nativeRecords(report)) {
    const timestamp = Date.parse(record.timestamp);
    if (!Number.isFinite(timestamp)) continue;
    earliest = Math.min(earliest, timestamp);
    latest = Math.max(latest, timestamp);
    count += 1;
  }
  if (count < 2) return undefined;
  return latest - earliest;
}

function nativeRecords(report: SessionReport): Array<{ timestamp: string }> {
  return [
    ...report.generations,
    ...report.tools,
    ...report.compactions,
    ...report.errors,
  ];
}

function reportDates(report: SessionReport): string[] {
  const dates = new Set<string>();
  for (const record of nativeRecords(report)) {
    const date = utcDate(record.timestamp);
    if (date !== undefined) dates.add(date);
  }
  return [...dates].sort();
}

function utcDate(timestamp: string): string | undefined {
  return DAY.exec(timestamp)?.[1];
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  if (total < 1_000) return `${total} ms`;
  const seconds = Math.floor(total / 1_000);
  if (seconds < 60) return `${(total / 1_000).toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return `${minutes}m ${String(rest).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function compositionView(report: SessionReport): CompositionView {
  const usage = report.usage;
  const composition = report.usageComposition;
  if (usage === undefined || composition === undefined) {
    return { available: false, parts: [], reconciles: false };
  }
  const parts = COMPOSITION_KEYS.map((key) => {
    const part = composition[key];
    return {
      key,
      totalTokens: part.totalTokens,
      cost: part.cost,
      confidence: "native" as const,
    };
  });
  const total = {
    totalTokens: usage.totalTokens,
    cost: usage.cost,
  };
  const tokens = parts.reduce((sum, part) => sum + part.totalTokens, 0);
  const cost = roundCost(parts.reduce((sum, part) => sum + part.cost, 0));
  return {
    available: true,
    parts,
    total,
    reconciles: tokens === total.totalTokens && cost === total.cost,
  };
}

/** Shared model summary plus the per-model token split derived from generations. */
function modelRows(report: SessionReport): ModelRow[] {
  const rows = new Map<string, ModelRow>();
  const base =
    report.models.length > 0 ? report.models : groupGenerations(report);
  for (const model of base) {
    const key = `${model.provider}\u0000${model.model}`;
    rows.set(key, {
      provider: model.provider,
      model: model.model,
      generations: model.generations,
      totalTokens: model.totalTokens,
      cost: model.cost,
    });
  }
  for (const generation of report.generations) {
    const key = `${generation.provider}\u0000${generation.model}`;
    const row = rows.get(key);
    if (row !== undefined) addOptionalTokens(row, generation.usage);
  }
  return [...rows.values()].sort(
    (left, right) =>
      left.provider.localeCompare(right.provider) ||
      left.model.localeCompare(right.model),
  );
}

function groupGenerations(report: SessionReport): SessionReport["models"] {
  const rows = new Map<string, SessionReport["models"][number]>();
  for (const generation of report.generations) {
    const key = `${generation.provider}\u0000${generation.model}`;
    const row = rows.get(key) ?? {
      provider: generation.provider,
      model: generation.model,
      generations: 0,
      totalTokens: 0,
      cost: 0,
    };
    row.generations += 1;
    row.totalTokens += generation.usage.totalTokens;
    row.cost = roundCost(row.cost + generation.usage.cost);
    rows.set(key, row);
  }
  return [...rows.values()];
}

function addOptionalTokens(row: ModelRow, usage: SafeUsage): void {
  if (usage.inputTokens !== undefined)
    row.inputTokens = (row.inputTokens ?? 0) + usage.inputTokens;
  if (usage.outputTokens !== undefined)
    row.outputTokens = (row.outputTokens ?? 0) + usage.outputTokens;
  if (usage.cacheReadTokens !== undefined)
    row.cacheReadTokens = (row.cacheReadTokens ?? 0) + usage.cacheReadTokens;
  if (usage.cacheWriteTokens !== undefined)
    row.cacheWriteTokens = (row.cacheWriteTokens ?? 0) + usage.cacheWriteTokens;
}

/**
 * One range's dated model rows grouped by provider and model (design §5.2): the
 * Models tab's filtered table. Two dates of the same model are one row, sorted
 * by `provider\u0000model` so the fixed order never depends on the fold.
 */
export function modelRangeRows(rows: readonly DatedModelRow[]): ModelRow[] {
  const groups = new Map<string, ModelRow>();
  const order: string[] = [];
  for (const row of rows) {
    const key = `${row.provider}\u0000${row.model}`;
    const group = groups.get(key) ?? {
      provider: row.provider,
      model: row.model,
      generations: 0,
      totalTokens: 0,
      cost: 0,
    };
    if (!groups.has(key)) order.push(key);
    groups.set(key, group);
    group.generations += row.generations || 0;
    group.totalTokens += row.totalTokens || 0;
    group.cost += row.cost || 0;
  }
  return order.sort().map((key) => {
    const group = groups.get(key) as ModelRow;
    group.cost = roundCost(group.cost);
    return group;
  });
}

function modelBars(report: SessionReport): BarRow[] {
  const totalCost = report.usage?.cost;
  if (totalCost === undefined) return [];
  return modelRows(report).map((row) => ({
    label: `${row.provider}/${row.model}`,
    value: money(row.cost),
    percent: totalCost > 0 ? Math.round((row.cost / totalCost) * 100) : 0,
  }));
}

function toolBars(report: SessionReport): BarRow[] {
  const counts = new Map<string, number>();
  for (const tool of report.tools)
    counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
  const total = report.tools.length;
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, count]) => ({
      label: name,
      value: `${count} calls`,
      percent: total > 0 ? Math.round((count / total) * 100) : 0,
    }));
}

function toolRows(report: SessionReport): ToolRow[] {
  return report.tools.map((tool) => ({
    id: tool.id,
    name: tool.name,
    ...(tool.source === undefined ? {} : { source: tool.source }),
    status: tool.status,
    timestamp: tool.timestamp,
    usage: tool.usage === undefined ? null : safeUsage(tool.usage),
    durationMs: tool.durationMs === undefined ? null : tool.durationMs,
    durationLabel:
      tool.durationMs === undefined ? null : formatDuration(tool.durationMs),
  }));
}

/** One tool name's grouped calls: the summary view's row (design §7.6). */
export type ToolSummaryRow = {
  name: string;
  /** The first known inventory source label of this name; absent when none. */
  source?: string;
  calls: number;
  succeeded: number;
  failed: number;
  interrupted: number;
  /** Known usage: the sum over this name's usage-bearing calls only. */
  tokens: number;
  cost: number;
  /** How many of `calls` persisted usage; `0` makes tokens/cost Unavailable. */
  withUsage: number;
  /**
   * How many of `calls` correlated to a live duration. A call with no
   * correlated boundary contributes to `calls` and never to the duration
   * figures, so an incomplete coverage is visible rather than averaged away.
   */
  withDuration: number;
  /** The sum of this name's correlated durations; `0` when none correlated. */
  durationMs: number;
  /** Total correlated duration, formatted; `null` makes Duration Unavailable. */
  durationLabel: string | null;
  /** Mean correlated duration, formatted; `null` when none correlated. */
  averageLabel: string | null;
  /** The maximum persisted call timestamp; fixed-width UTC sorts by string. */
  lastUsed: string;
};

/**
 * The rows a summary groups: a call plus the optional correlated duration the
 * per-call projection publishes. Absent means "not correlated", never zero.
 */
export type ToolSummaryInput = ToolCallRow & {
  durationMs?: number | null;
};

/**
 * The summary view: `view.tools` grouped by tool name, one row per name, sorted
 * by name (design §7.6). `calls` is the set the caller selected, so a range
 * filter narrows the summary and its counts together; `lastUsed` is the maximum
 * persisted call timestamp of that selected set (range-filtered like the counts,
 * §5.2) and `source` the first known label of that name, which is a static
 * inventory fact and not a range figure. A call with no persisted usage
 * contributes to `calls` and never to `tokens`, `cost`, or `withUsage`; a call
 * with no correlated duration contributes to `calls` and never to the duration
 * figures, whose labels stay `null` (Unavailable) until at least one call
 * correlated.
 */
export function toolSummary(view: {
  tools?: readonly ToolSummaryInput[];
}): ToolSummaryRow[] {
  const grouped = new Map<string, ToolSummaryRow>();
  for (const row of view.tools ?? []) {
    const group = grouped.get(row.name) ?? {
      name: row.name,
      calls: 0,
      succeeded: 0,
      failed: 0,
      interrupted: 0,
      tokens: 0,
      cost: 0,
      withUsage: 0,
      withDuration: 0,
      durationMs: 0,
      durationLabel: null,
      averageLabel: null,
      lastUsed: row.timestamp,
    };
    grouped.set(row.name, group);
    group.calls += 1;
    if (row.status === "succeeded") group.succeeded += 1;
    else if (row.status === "failed") group.failed += 1;
    else group.interrupted += 1;
    if (group.source === undefined && row.source !== undefined) {
      group.source = row.source;
    }
    if (row.usage !== null && row.usage !== undefined) {
      group.withUsage += 1;
      group.tokens += row.usage.totalTokens;
      group.cost =
        Math.round((group.cost + row.usage.cost) * 1_000_000_000_000) /
        1_000_000_000_000;
    }
    // Duration is a correlation fact, never an estimate: only a call the live
    // boundary matched contributes, and the count travels with the total.
    if (typeof row.durationMs === "number") {
      group.withDuration += 1;
      group.durationMs += row.durationMs;
    }
    if (row.timestamp > group.lastUsed) group.lastUsed = row.timestamp;
  }
  for (const group of grouped.values()) {
    if (group.withDuration === 0) continue;
    group.durationLabel = formatDuration(group.durationMs);
    group.averageLabel = formatDuration(group.durationMs / group.withDuration);
  }
  return [...grouped.values()].sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );
}

/**
 * The calls/timeline view: one row per call, newest first by its own persisted
 * timestamp, narrowed to `filter` when a summary row selected a tool name and to
 * every call when the filter is `null`. Equal timestamps keep source order.
 */
export function toolCalls<T extends ToolCallRow>(
  view: { tools?: readonly T[] },
  filter: string | null,
): T[] {
  const rows = view.tools ?? [];
  const selected =
    filter === null || filter === undefined
      ? rows
      : rows.filter((row) => row.name === filter);
  return selected
    .slice()
    .sort((left, right) =>
      left.timestamp < right.timestamp
        ? 1
        : left.timestamp > right.timestamp
          ? -1
          : 0,
    );
}

/**
 * The live duration a call row may render, or `null` for Unavailable. Duration
 * is live-correlated evidence only: without `durationEvidence === "supported"`
 * no value is shown, so it is never estimated from this call's timestamp or a
 * neighbouring one (design §7.6).
 */
export function toolDuration(
  row: { durationLabel: string | null },
  durationEvidence: EvidenceState,
): string | null {
  if (durationEvidence !== "supported") return null;
  return row.durationLabel ?? null;
}

/**
 * Every `AgentRun` field reaches the browser row, and an absent optional field
 * is `null`: never `""` and never a placeholder entity (spec §6.2).
 */
function agentRows(report: SessionReport): AgentRow[] {
  return report.agents.map((agent) => ({
    id: agent.id,
    parentId: agent.parentId ?? null,
    agent: agent.agent ?? null,
    status: agent.status,
    confidence: agent.confidence,
    artifacts: agent.artifacts ?? null,
    observedAt: agent.observedAt ?? null,
    evidenceToolId: agent.evidenceToolId ?? null,
    model: agent.model ?? null,
    thinking: agent.thinking ?? null,
    failure: agent.failure ?? null,
    usage: agent.usage === undefined ? null : safeUsage(agent.usage),
  }));
}

/**
 * The headline an error row renders (design §7.5-1): the joined tool's name when
 * the record carries one, else the bounded classification label for its kind
 * family. The catalog key and bounded values are returned separately so the
 * snapshot renderer can resolve them through its translator; the raw
 * `tool:call_…` id is never a headline.
 */
export function errorHeadline(row: {
  kind: string;
  toolName: string | null;
}):
  | { key: "errors.toolFailed"; values: { tool: string } }
  | { key: "errors.failed" | "errors.generation"; values: null } {
  if (row.toolName !== null) {
    return { key: "errors.toolFailed", values: { tool: row.toolName } };
  }
  return row.kind === "tool-error"
    ? { key: "errors.failed", values: null }
    : { key: "errors.generation", values: null };
}

/**
 * The bounded redacted message a row may render, or `null` for `Unavailable`.
 * Reduction owns extraction and redaction; this projection only renders the
 * validated DTO field. No text is taken from tool arguments or child output.
 * Exported so the snapshot renderer and the tests read the same rule.
 */
export function errorMessage(row: {
  kind: string;
  message?: string;
}): string | null {
  return row.message ?? null;
}

/**
 * The one error → tool → child joint projection (design §7.5). A tool error and
 * its call share the reducer's canonical id, so the join is `error.id ===
 * tool.id`; every run whose `evidenceToolId` is that same id was observed by
 * the publishing result and is a candidate child, never a named cause. One
 * result may publish many runs, so the relation is one-to-many.
 */
function errorRows(report: SessionReport): ErrorRow[] {
  const toolsById = new Map(report.tools.map((tool) => [tool.id, tool]));
  const childrenById = new Map<string, string[]>();
  for (const run of report.agents) {
    if (run.evidenceToolId === undefined) continue;
    const children = childrenById.get(run.evidenceToolId) ?? [];
    children.push(run.id);
    childrenById.set(run.evidenceToolId, children);
  }
  return report.errors.map((error) => {
    const tool = toolsById.get(error.id);
    return {
      id: error.id,
      timestamp: error.timestamp,
      kind: error.kind,
      confidence: error.confidence,
      ...(error.message === undefined ? {} : { message: error.message }),
      toolName: tool?.name ?? null,
      toolSource: tool?.source ?? null,
      toolStatus: tool?.status ?? null,
      relatedChildIds: childrenById.get(error.id) ?? [],
    };
  });
}

function integrationRows(report: SessionReport): IntegrationRow[] {
  return report.integrations.map((integration) => ({
    integration: integration.integration,
    presence: integration.presence,
    version: integration.version ?? null,
    state: integration.state,
    counters: Object.entries(integration.counters ?? {}).map(
      ([key, value]) => `${key}: ${String(value)}`,
    ),
  }));
}

function statusView(report: SessionReport): StatusView {
  if (report.errors.length > 0) return { key: "status.errors", tone: "warn" };
  if (report.tools.some((tool) => tool.status === "interrupted"))
    return { key: "status.interrupted", tone: "warn" };
  return { key: "status.clean", tone: "neutral" };
}

export function sessionView(report: SessionReport): SessionReportView {
  const durationMs = sessionSpanMs(report);
  const dates = reportDates(report);
  return {
    sessionId: report.sessionId,
    ...(report.usage === undefined ? {} : { usage: safeUsage(report.usage) }),
    cacheHitPercent: cacheHitPercent(report.usage) ?? null,
    compactionCount: report.compactions.filter(
      (compaction) => compaction.kind === "compaction",
    ).length,
    composition: compositionView(report),
    generationCount: report.generations.length,
    toolCount: report.tools.length,
    durationMs: durationMs ?? null,
    durationLabel: durationMs === undefined ? null : formatDuration(durationMs),
    span:
      dates.length === 0
        ? null
        : { from: dates[0], to: dates[dates.length - 1] },
    agentCount:
      report.agentEvidence === "supported" ? report.agents.length : null,
    agentEvidence: report.agentEvidence,
    agentActivity: report.agentActivity,
    durationEvidence: report.durationEvidence,
    status: statusView(report),
    models: modelRows(report),
    modelBars: modelBars(report),
    tools: toolRows(report),
    toolBars: toolBars(report),
    agents: agentRows(report),
    integrations: integrationRows(report),
    errors: errorRows(report),
    commands: report.commands,
    skills: report.skills,
    resources: report.resources,
    ledger: buildLedger(report),
  };
}

export function sessionEvidenceRows(
  report: SessionReport,
  view: SessionReportView,
): EvidenceRow[] {
  const timedTools = report.tools.filter(
    (tool) => tool.durationMs !== undefined,
  ).length;
  const rows: EvidenceRow[] = [
    {
      source: ENGLISH_CATALOG["evidence.piRecords"],
      observation: t("evidence.piRecords.detail", {
        generations: view.generationCount,
        tools: view.toolCount,
        models: view.models.length,
      }),
      confidence: "native",
    },
    {
      source: ENGLISH_CATALOG["evidence.span"],
      observation:
        view.durationLabel === null
          ? ENGLISH_CATALOG["evidence.span.missing"]
          : `${view.durationLabel} · ${ENGLISH_CATALOG["evidence.span.detail"]}`,
      confidence: view.durationLabel === null ? "unavailable" : "native",
    },
    {
      source: ENGLISH_CATALOG["evidence.toolTiming"],
      observation:
        timedTools > 0
          ? t("evidence.toolTiming.detail", {
              count: timedTools,
            })
          : ENGLISH_CATALOG["evidence.toolTiming.missing"],
      confidence: timedTools > 0 ? "live" : report.durationEvidence,
    },
    {
      source: ENGLISH_CATALOG["evidence.child"],
      // The completeness fraction is the report's own derived `agentUsage`:
      // this row describes the whole session, so it states how many of the
      // projected runs reported usage instead of publishing a partial sum as a
      // total. The Agents tab recomputes the same fraction from the rows it
      // renders, so a range filter never reuses this figure.
      observation:
        report.agentEvidence === "supported"
          ? `${t("evidence.child.detail", {
              count: report.agents.length,
            })} · ${t("agents.usageFraction", {
              withUsage: report.agentUsage.runsWithUsage,
              total: report.agentUsage.runsTotal,
            })}`
          : ENGLISH_CATALOG["evidence.child.missing"],
      confidence:
        report.agentEvidence === "supported"
          ? "cooperative"
          : report.agentEvidence,
    },
    {
      source: ENGLISH_CATALOG["evidence.errors"],
      observation: t("evidence.errors.detail", {
        count: report.errors.length,
      }),
      confidence: "native",
    },
    {
      source: ENGLISH_CATALOG["evidence.retries"],
      observation: ENGLISH_CATALOG["evidence.retries.detail"],
      confidence: "unavailable",
    },
  ];
  if (report.integrations.length === 0) {
    rows.push({
      source: ENGLISH_CATALOG["evidence.integration"],
      observation: ENGLISH_CATALOG["evidence.integration.missing"],
      confidence: "unavailable",
    });
    return rows;
  }
  for (const integration of integrationRows(report)) {
    rows.push({
      source: ENGLISH_CATALOG["evidence.integration"],
      observation: `${integration.integration} · ${integration.state}${
        integration.counters.length === 0
          ? ""
          : ` · ${integration.counters.join(", ")}`
      }`,
      confidence: integration.state,
    });
  }
  return rows;
}

export function historyEvidenceRows(history: HistoryReport): EvidenceRow[] {
  const available = history.sessions.filter(
    (session) => session.availability === "available",
  );
  const reports = available.map((session) => session.report);
  const spans = reports.filter(
    (report) => sessionSpanMs(report) !== undefined,
  ).length;
  const childSessions = reports.filter(
    (report) => report.agentEvidence === "supported",
  ).length;
  const integrations = new Set<string>();
  for (const report of reports) {
    for (const integration of report.integrations) {
      if (integration.state === "supported")
        integrations.add(integration.integration);
    }
  }
  const errorSessions = reports.filter(
    (report) => report.errors.length > 0,
  ).length;
  return [
    {
      source: ENGLISH_CATALOG["evidence.piRecords"],
      observation: t("evidence.history.sessions", {
        available: available.length,
        total: history.sessions.length,
      }),
      confidence: available.length > 0 ? "native" : "unavailable",
    },
    {
      source: ENGLISH_CATALOG["evidence.span"],
      observation: t("evidence.history.span", {
        count: spans,
      }),
      confidence: spans > 0 ? "native" : "unavailable",
    },
    {
      source: ENGLISH_CATALOG["evidence.child"],
      observation: t("evidence.history.child", {
        count: childSessions,
      }),
      confidence: childSessions > 0 ? "cooperative" : "unavailable",
    },
    {
      source: ENGLISH_CATALOG["evidence.integration"],
      observation: t("evidence.history.integrations", {
        count: integrations.size,
      }),
      confidence: integrations.size > 0 ? "supported" : "unavailable",
    },
    {
      source: ENGLISH_CATALOG["evidence.errors"],
      observation: t("evidence.history.errors", {
        count: errorSessions,
      }),
      confidence: "native",
    },
    {
      source: ENGLISH_CATALOG["evidence.retries"],
      observation: ENGLISH_CATALOG["evidence.retries.detail"],
      confidence: "unavailable",
    },
  ];
}

export function globalEvidenceRows(report: GlobalReport): EvidenceRow[] {
  const replayed = report.sessions.filter(
    (session) => session.availability === "available",
  ).length;
  return [
    {
      source: ENGLISH_CATALOG["evidence.piRecords"],
      observation: t("evidence.global.days", {
        days: report.dates.length,
        sessions: replayed,
      }),
      confidence: report.dates.length > 0 ? "native" : "unavailable",
    },
    {
      source: ENGLISH_CATALOG["usage.title"],
      observation: ENGLISH_CATALOG["evidence.global.composition"],
      confidence: "unavailable",
    },
    {
      source: ENGLISH_CATALOG["evidence.child"],
      observation: ENGLISH_CATALOG["evidence.global.agents"],
      confidence: "unavailable",
    },
    {
      source: ENGLISH_CATALOG["evidence.integration"],
      observation: ENGLISH_CATALOG["evidence.global.integrations"],
      confidence: "unavailable",
    },
    {
      source: ENGLISH_CATALOG["evidence.errors"],
      observation: ENGLISH_CATALOG["evidence.global.errors"],
      confidence: "unavailable",
    },
    {
      source: ENGLISH_CATALOG["evidence.retries"],
      observation: ENGLISH_CATALOG["evidence.retries.detail"],
      confidence: "unavailable",
    },
  ];
}

export function historyEntry(
  session: HistoryReport["sessions"][number],
): HistoryEntryView {
  if (session.availability === "unavailable") {
    return {
      availability: "unavailable",
      sessionId: session.sessionId,
      firstDate: null,
      lastDate: null,
      durationLabel: null,
      totalTokens: null,
      cost: null,
      generationCount: null,
      agentCount: null,
      status: null,
    };
  }
  const view = sessionView(session.report);
  return {
    availability: "available",
    sessionId: session.sessionId,
    firstDate: view.span === null ? null : view.span.from,
    lastDate: view.span === null ? null : view.span.to,
    durationLabel: view.durationLabel,
    totalTokens: view.usage?.totalTokens ?? null,
    cost: view.usage?.cost ?? null,
    generationCount: view.generationCount,
    agentCount: view.agentCount,
    status: view.status,
    // R19: the browser decides range membership from the same bounded dated
    // rows the aggregate fold consumed, never from a span comparison.
    usageByDate: session.usageByDate,
    usageByDateTruncated: session.usageByDateTruncated,
    ...(session.datedModels === undefined
      ? {}
      : {
          datedModels: session.datedModels,
          modelsTruncated: session.modelsTruncated ?? false,
        }),
    view,
  };
}

/** The bounded identity and dates the fixed history order compares. */
export type HistoryOrderKey = Pick<
  HistoryEntryView,
  "lastDate" | "firstDate" | "sessionId"
>;

export function compareHistoryEntries(
  left: HistoryOrderKey,
  right: HistoryOrderKey,
): number {
  const leftDate = left.lastDate ?? left.firstDate;
  const rightDate = right.lastDate ?? right.firstDate;
  if (leftDate === null)
    return rightDate === null
      ? left.sessionId.localeCompare(right.sessionId)
      : 1;
  if (rightDate === null) return -1;
  return (
    rightDate.localeCompare(leftDate) ||
    (right.firstDate ?? "").localeCompare(left.firstDate ?? "") ||
    left.sessionId.localeCompare(right.sessionId)
  );
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

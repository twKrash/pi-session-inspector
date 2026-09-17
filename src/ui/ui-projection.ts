import type { EvidenceState, Scope } from "../core/events.ts";
import type { LedgerItem } from "../core/ledger.ts";
import { roundCost } from "../core/rounding.ts";
import {
  CAPABILITIES,
  type CurrentView,
  type InspectorBundle,
} from "./bundle.ts";
import { buildDailyRows, type DailyRow } from "./daily.ts";
import type { DatedModelRow } from "./dated-usage.ts";
import type {
  GlobalReport,
  HistoricalSession,
  HistoryReport,
} from "./load-history.ts";
import {
  filterView,
  historyRowRange,
  isInRange,
  resolveRange,
  type RangeIntent,
  type RangeState,
} from "./range.ts";
import {
  aggregateUsageLabels,
  compareHistoryEntries,
  coverageProjection,
  globalEvidenceRows,
  historyEvidenceRows,
  modelRangeRows,
  safeUsage,
  sessionEvidenceRows,
  sessionView,
  toolCalls,
  toolSummary,
  type AgentRow,
  type CompositionView,
  type CoverageProjection,
  type ErrorRow,
  type EvidenceRow,
  type ModelRow,
  type SessionReportView,
  type StatusView,
  type ToolRow,
  type ToolSummaryRow,
  type UsageLabels,
} from "./report-projection.ts";

/**
 * The one TypeScript L2 projection of report semantics (ADR 0018): range
 * resolution, date attribution, usage accounting, history membership,
 * truncation, coverage and unavailable-versus-zero all live here, so no browser
 * asset, HTTP handler or snapshot renderer recomputes them.
 *
 * Every entry point is pure and reads no loader, filesystem path, clock or
 * browser object: it takes already-loaded DTOs and returns bounded,
 * deterministic data. Range work is delegated to the Task 1 range contract
 * (`resolveRange`, `filterView`, `historyRowRange`) and the report tables come
 * from `report-projection.ts`, so the semantics have exactly one home.
 *
 * Ordering and unknown values are part of the contract: every row list keeps the
 * fixed order its transform produces, a resolved range is metadata of one
 * projection (two views of one request may anchor differently), and a `null`
 * usage or a `null` resolved range means unknown, never zero.
 */

/** A view that failed to replay renders no tab at all. */
const NO_CAPABILITIES: readonly string[] = [];

/** The four additive usage parts, in the fixed order every composition uses. */
const COMPOSITION_PARTS: readonly CompositionView["parts"][number]["key"][] = [
  "generations",
  "toolResults",
  "compactions",
  "branchSummaries",
];

/**
 * One inventory's bounded availability figure, or `null` for Unavailable:
 * inventory counts are availability, never activity.
 */
export type UiInventoryAvailability = {
  commands: number | null;
  skills: number | null;
  resources: number | null;
};

/**
 * One range selection's child-run breakdown. Runs are a breakdown only and are
 * never added to a native or global total; `totalTokens`/`cost` are the known
 * sums over the runs that reported usage (`null` when none did, never a
 * fabricated zero) and `byStatus` counts the selected runs per status.
 */
export type UiChildUsage = {
  runsTotal: number;
  runsWithUsage: number;
  totalTokens: number | null;
  cost: number | null;
  failedCost: number | null;
  failedRunsWithUsage: number;
  byStatus: {
    succeeded: number;
    failed: number;
    interrupted: number;
    running: number;
    unknown: number;
  };
};

/** One tool-summary row plus L2's own partial-usage verdict. */
export type UiToolSummaryRow = ToolSummaryRow & {
  /** Some calls persisted usage and some did not. */
  partial: boolean;
  /** Some calls correlated to a duration and some did not. */
  durationPartial: boolean;
};

/**
 * One rendered run's parent verdict. `none` is a run the report carries no
 * parent identity for; `in-range`/`outside-range` answer whether the selected
 * rows carry the parent AgentRun. `orchestration-run` is a valid parent
 * identity with no materialized AgentRun anywhere in the report: the subagent
 * adapter parents a child row on the id of the run that published it (the
 * producer's `details.runId`, which pi-subagents documents as the run identity
 * paired with `results[].index`), and that run container is never itself an
 * agent row. It is a real relationship to the orchestration/fan-out run, never
 * the same fact as a missing identity. `unknown` is L2's own boundary guard for
 * a value that is not an Inspector-owned opaque identity: canonical projection
 * already drops an unusable producer value, so a malformed producer parent
 * surfaces as `none` in practice. Bounded ceiling: if the report's agent rows
 * were capped, a dropped parent row can make this verdict name a container
 * where an uncapped report would have linked the run.
 */
export type UiAgentParent =
  | "none"
  | "in-range"
  | "outside-range"
  | "orchestration-run"
  | "unknown";

/**
 * The opaque run identity the adapter publishes (see `core/opaque-id.ts`); L2
 * re-checks it so an input it did not project (a stored or foreign DTO) can
 * never be reported as a known parent.
 */
const OPAQUE_SUBAGENT_ID = /^subagent-[a-f0-9]{64}$/;

/** One range-filtered run plus L2's own verdict for its parent. */
export type UiAgentRow = AgentRow & { parent: UiAgentParent };

/**
 * One projection's range and everything that changes with it. `requested` is
 * the intent the route/command carried (`null` when none) and `resolved` the
 * range that intent produced against this projection's own observed dates —
 * `null` when no range exists (no observed date, or an invalid custom pair), in
 * which case every range-derived field is empty rather than a claimed zero.
 */
export type UiRangeProjection = {
  requested: RangeIntent | null;
  resolved: RangeState | null;
  truncated: boolean;
  daily: readonly DailyRow[];
  totals: {
    totalTokens: number;
    cost: number;
    generations: number;
    tools: number;
    days: number;
  };
  composition: CompositionView | null;
  models: readonly ModelRow[];
  modelsTruncated: boolean;
  toolSummary: readonly UiToolSummaryRow[];
  toolCalls: readonly ToolRow[];
  agents: readonly UiAgentRow[];
  childUsage: UiChildUsage;
  errors: readonly ErrorRow[];
  ledger: readonly LedgerItem[];
};

/**
 * One session's resolved projection: the safe all-date report, its evidence,
 * the tabs it can render, and its own range. `range` is present for every
 * available session; an unavailable one carries a bounded `diagnostic` instead
 * and no report, evidence or range at all.
 */
export type UiSessionProjection = {
  availability: CurrentView["availability"];
  /** Bounded cause; never a producer string or a raw error message. */
  diagnostic?: string;
  /** The scope this projection was resolved in; absent for a history session. */
  scope?: Scope;
  capabilities: readonly string[];
  report?: SessionReportView;
  evidence: readonly EvidenceRow[];
  /** Per-inventory availability: the count the DTO carries, `null` unknown. */
  inventoryAvailability: UiInventoryAvailability;
  walDetail?: "expired";
  range?: UiRangeProjection;
};

/**
 * One history membership row plus, when the session replayed, its own
 * projection. The verdict is L2's: `membership` says whether a retained dated
 * row lies inside the aggregate's resolved range, `totalTokens`/`cost` are the
 * verified in-range values (`null` when the range lies entirely inside omitted
 * history), and `partial` says the range reaches before a window this session
 * cannot restore.
 */
export type UiHistorySession = {
  sessionId: string;
  availability: HistoricalSession["availability"];
  membership: "member" | "out" | "unknown";
  totalTokens: number | null;
  cost: number | null;
  partial: boolean;
  /** True when a member's report published a session usage total to render. */
  published: boolean;
  firstDate: string | null;
  lastDate: string | null;
  durationLabel: string | null;
  generationCount: number | null;
  agentCount: number | null;
  status: StatusView | null;
  view?: UiSessionProjection;
};

/**
 * The history aggregate: its own resolved range, the fold of the contributing
 * sessions' dated rows, coverage and wording, all-date evidence, and the
 * membership rows with each available session's own projection.
 */
export type UiHistoryProjection = {
  availability: HistoryReport["availability"];
  requested: RangeIntent | null;
  resolved: RangeState | null;
  truncated: boolean;
  daily: readonly DailyRow[];
  totals: UiRangeProjection["totals"];
  coverage: CoverageProjection | null;
  usageLabels: UsageLabels;
  evidence: readonly EvidenceRow[];
  sessions: readonly UiHistorySession[];
};

/** One global day: the aggregate's own bounded row, flattened for rendering. */
export type UiGlobalDailyRow = {
  date: string;
  sessions: number;
  totalTokens: number;
  cost: number;
};

/**
 * The global aggregate: its resolved range and bounded daily rows, the
 * all-date composition an aggregate can only report as unavailable, coverage,
 * wording, evidence, inventory, and the tracked/unavailable session counts.
 */
export type UiGlobalProjection = {
  availability: GlobalReport["availability"];
  requested: RangeIntent | null;
  resolved: RangeState | null;
  truncated: boolean;
  daily: readonly UiGlobalDailyRow[];
  totals: { totalTokens: number; cost: number; days: number };
  composition: CompositionView;
  coverage: CoverageProjection | null;
  usageLabels: UsageLabels;
  evidence: readonly EvidenceRow[];
  inventory: GlobalReport["inventory"];
  trackedSessions: number;
  unavailableSessions: number;
};

/** Endpoint-compatible alias: the global resource returns this projection. */
export type GlobalReportProjection = UiGlobalProjection;

/** The one `/api/v1/ui` payload: both current views, history and global. */
export type InspectorUiSnapshot = {
  kind: "ui";
  schemaVersion: 1;
  theme: "light" | "dark";
  initialScope: Scope;
  current: {
    active: UiSessionProjection;
    tree: UiSessionProjection;
    sameReportProjection: boolean;
  };
  history: UiHistoryProjection;
  global: UiGlobalProjection;
};

/** One view's projection, from the bundle's own precomputed section. */
export function projectCurrentView(
  view: CurrentView,
  scope: Scope,
  intent?: RangeIntent,
): UiSessionProjection {
  if (view.availability !== "available" || view.report === undefined) {
    return noSessionProjection(view.diagnostic, scope);
  }
  const report = sessionView(view.report);
  const daily = view.daily ?? [];
  return {
    availability: "available",
    scope,
    capabilities: view.capabilities ?? CAPABILITIES.current,
    report,
    evidence: sessionEvidenceRows(view.report, report),
    inventoryAvailability: inventoryAvailabilityOf(report),
    ...(view.report.walDetail === "expired"
      ? { walDetail: "expired" as const }
      : {}),
    range: sessionRange({
      report,
      daily,
      ...(view.datedModels === undefined
        ? {}
        : { datedModels: view.datedModels }),
      modelsTruncated: view.modelsTruncated === true,
      intent,
      kind: "current",
      // A capped view's window is partial only while the range reaches before
      // the oldest retained date it can still restore.
      truncation: (range) =>
        view.dailyTruncated === true && reachesBeforeRetained(daily, range),
    }),
  };
}

/**
 * One history session's own projection. Its range resolves against its own
 * dated window (aggregate defaults, like every history view), so a selected
 * session never inherits the aggregate's anchor.
 */
export function projectHistoricalSession(
  session: HistoricalSession,
  intent?: RangeIntent,
): UiSessionProjection {
  if (session.availability !== "available") {
    return noSessionProjection(session.reason);
  }
  const report = sessionView(session.report);
  const daily = session.usageByDate.map((row) => ({
    date: row.date,
    sessions: 1,
    totalTokens: row.totalTokens,
    cost: row.cost,
    generations: row.generations,
    tools: row.tools,
    composition: row.composition,
  }));
  return {
    availability: "available",
    capabilities: CAPABILITIES.historySession,
    report,
    evidence: sessionEvidenceRows(session.report, report),
    inventoryAvailability: inventoryAvailabilityOf(report),
    ...(session.report.walDetail === "expired"
      ? { walDetail: "expired" as const }
      : {}),
    range: sessionRange({
      report,
      daily,
      datedModels: session.datedModels,
      modelsTruncated: session.modelsTruncated,
      intent,
      kind: "aggregate",
      truncation: (range) => historyRowRange(session, range).partial === true,
    }),
  };
}

/**
 * The history aggregate. It folds the contributing sessions' own dated rows
 * (R19: no session timestamp is walked twice), resolves its own range against
 * the fold's dates, decides each session's membership from its retained window,
 * and carries every available session's own projection.
 */
export function projectHistoryReport(
  report: HistoryReport,
  intent?: RangeIntent,
): UiHistoryProjection {
  const requested = intent ?? null;
  const folded = buildDailyRows(
    report.sessions.flatMap((session) =>
      session.availability === "available"
        ? [
            {
              sessionId: session.sessionId,
              rows: session.usageByDate,
              truncated: session.usageByDateTruncated,
            },
          ]
        : [],
    ),
  );
  const resolved =
    resolveRange(
      intent,
      folded.rows.map((row) => row.date),
      "aggregate",
    ) ?? null;
  const daily =
    resolved === null
      ? []
      : folded.rows.filter((row) => isInRange(row.date, resolved));
  const sessions = report.sessions
    .map((session) =>
      historySessionRow(
        session,
        projectHistoricalSession(session, intent),
        resolved,
      ),
    )
    .sort(compareHistoryEntries);
  return {
    availability: report.availability,
    requested,
    resolved,
    // The aggregate is partial when its own fold cannot represent the range, or
    // when any contributing session's retained window cannot (design §5.6).
    truncated:
      resolved === null
        ? false
        : (folded.truncated && reachesBeforeRetained(folded.rows, resolved)) ||
          partialContribution(report.sessions, resolved),
    daily,
    totals: periodTotals(daily),
    coverage: coverageProjection(report.availability, report.coverage),
    usageLabels: aggregateUsageLabels({
      availability: report.availability,
      coverage: report.coverage,
    }),
    evidence: historyEvidenceRows(report),
    sessions,
  };
}

/**
 * The minimum one contributing window must carry for the aggregate's partiality
 * verdict: a history session or the global report's own opt-in bounded session
 * window (`GlobalReport.sessionWindows`). Both shapes are accepted so the one
 * verdict is decided from the windows a caller actually has, never from
 * reconstructed session DTOs.
 */
type PartialityWindow = {
  availability: "available" | "unavailable";
  usageByDate?: readonly {
    date?: string;
    totalTokens?: number;
    cost?: number;
  }[];
  usageByDateTruncated?: boolean;
};

/**
 * The global aggregate: its own bounded date rows resolved against its own
 * latest date, plus the all-date composition an aggregate can only report as
 * unavailable. `historyWindows` are the bounded session windows of the same
 * request (the history sections' sessions), which decide whether any
 * contributing window makes this aggregate partial.
 */
export function projectGlobalReport(
  report: GlobalReport,
  intent?: RangeIntent,
  historyWindows?: readonly PartialityWindow[],
): UiGlobalProjection {
  const requested = intent ?? null;
  const rows: UiGlobalDailyRow[] = report.dates.map((row) => ({
    date: row.date,
    sessions: row.sessions,
    totalTokens: row.usage.totalTokens,
    cost: row.usage.cost,
  }));
  const resolved =
    resolveRange(
      intent,
      report.dates.map((row) => row.date),
      "aggregate",
    ) ?? null;
  const daily =
    resolved === null
      ? []
      : rows.filter((row) => isInRange(row.date, resolved));
  const totals = { totalTokens: 0, cost: 0, days: 0 };
  for (const row of daily) {
    totals.totalTokens += row.totalTokens;
    totals.cost += row.cost;
    totals.days += 1;
  }
  return {
    availability: report.availability,
    requested,
    resolved,
    truncated:
      resolved === null
        ? false
        : (report.sessions.some(
            (session) =>
              session.availability === "available" &&
              session.usageByDateTruncated === true,
          ) &&
            reachesBeforeRetained(rows, resolved)) ||
          partialContribution(historyWindows ?? [], resolved),
    daily,
    totals: { ...totals, cost: roundCost(totals.cost) },
    // An aggregate never has one native composition; the all-date total stays
    // visible beside an explicit `available: false`.
    composition: {
      available: false,
      parts: [],
      total: safeUsage(report.usage),
      reconciles: false,
    },
    coverage: coverageProjection(report.availability, report.coverage),
    usageLabels: aggregateUsageLabels({
      availability: report.availability,
      coverage: report.coverage,
    }),
    evidence: globalEvidenceRows(report),
    inventory: report.inventory,
    trackedSessions: report.sessions.length,
    unavailableSessions: report.sessions.filter(
      (session) => session.availability === "unavailable",
    ).length,
  };
}

/**
 * The one inspector UI projection: both current views projected separately
 * (each against its own dates), history with each available session's own view,
 * and global with the history sessions' bounded windows as its partiality
 * input. `sameReportProjection` is the loader's report-equality statement,
 * copied rather than recomputed: it is never a claim about entry sets.
 */
export function projectInspectorUi(input: {
  bundle: InspectorBundle;
  intent?: RangeIntent;
}): InspectorUiSnapshot {
  const { bundle, intent } = input;
  return {
    kind: "ui",
    schemaVersion: 1,
    theme: bundle.theme,
    initialScope: bundle.initialScope,
    current: {
      active: projectCurrentView(bundle.current.active, "active", intent),
      tree: projectCurrentView(bundle.current.tree, "tree", intent),
      sameReportProjection: bundle.current.sameReportProjection,
    },
    history: projectHistoryReport(bundle.history, intent),
    global: projectGlobalReport(bundle.global, intent, bundle.history.sessions),
  };
}

/** A view with no report: one bounded diagnostic, no rows, no tabs. */
function noSessionProjection(
  diagnostic: string | undefined,
  scope?: Scope,
): UiSessionProjection {
  return {
    availability: "unavailable",
    ...(diagnostic === undefined ? {} : { diagnostic }),
    ...(scope === undefined ? {} : { scope }),
    capabilities: NO_CAPABILITIES,
    evidence: [],
    inventoryAvailability: { commands: null, skills: null, resources: null },
  };
}

/**
 * One session-shaped projection's range: the view's own dated rows are the
 * range's date series, the report's own rows are the ones every tab filters,
 * and the caller supplies the truncation verdict for this view kind.
 */
function sessionRange(input: {
  report: SessionReportView;
  daily: readonly DailyRow[];
  datedModels?: readonly DatedModelRow[];
  modelsTruncated: boolean;
  intent: RangeIntent | undefined;
  kind: "current" | "aggregate";
  truncation: (range: RangeState) => boolean;
}): UiRangeProjection {
  const requested = input.intent ?? null;
  const resolved =
    resolveRange(
      input.intent,
      input.daily.map((row) => row.date),
      input.kind,
    ) ?? null;
  if (resolved === null) {
    return {
      requested,
      resolved,
      truncated: false,
      daily: [],
      totals: zeroTotals(),
      composition: null,
      models: [],
      modelsTruncated: false,
      toolSummary: [],
      toolCalls: [],
      agents: [],
      childUsage: emptyChildUsage(),
      errors: [],
      ledger: [],
    };
  }
  const daily = input.daily.filter((row) => isInRange(row.date, resolved));
  const totals = periodTotals(daily);
  const filtered = filterView(
    {
      rows: [],
      models: [],
      tools: input.report.tools,
      agents: input.report.agents,
      errors: input.report.errors,
    },
    resolved,
  );
  const agents = agentParentVerdicts(input.report.agents, filtered.agents);
  return {
    requested,
    resolved,
    truncated: input.truncation(resolved),
    daily,
    totals,
    composition: periodComposition(daily, totals),
    models: modelRangeRows(
      (input.datedModels ?? []).filter((row) => isInRange(row.date, resolved)),
    ),
    modelsTruncated: input.modelsTruncated,
    toolSummary: toolSummary({ tools: filtered.tools }).map(toolUsageVerdict),
    toolCalls: toolCalls({ tools: filtered.tools }, null),
    agents,
    childUsage: childUsageBreakdown(agents),
    errors: filtered.errors,
    // A ledger row is dated by its own persisted timestamp, the same field the
    // tab renders.
    ledger: input.report.ledger.filter((item) =>
      isInRange(item.timestamp.slice(0, 10), resolved),
    ),
  };
}

/** The in-range sums of one view's own dated rows (design §5.2). */
function periodTotals(rows: readonly DailyRow[]): UiRangeProjection["totals"] {
  const totals = zeroTotals();
  for (const row of rows) {
    totals.days += 1;
    totals.totalTokens += row.totalTokens || 0;
    totals.cost += row.cost || 0;
    totals.generations += row.generations || 0;
    totals.tools += row.tools || 0;
  }
  totals.cost = roundCost(totals.cost);
  return totals;
}

/**
 * The four additive parts of an already-resolved period, reconciled against the
 * same period's own total: an unreconciled composition is reported as such, not
 * rounded into agreement.
 */
function periodComposition(
  rows: readonly DailyRow[],
  totals: UiRangeProjection["totals"],
): CompositionView {
  const parts = COMPOSITION_PARTS.map((key) => {
    let totalTokens = 0;
    let cost = 0;
    for (const row of rows) {
      const part = row.composition[key];
      totalTokens += part.totalTokens;
      cost += part.cost;
    }
    return { key, totalTokens, cost, confidence: "native" as const };
  });
  const tokens = parts.reduce((sum, part) => sum + part.totalTokens, 0);
  const cost = roundCost(parts.reduce((sum, part) => sum + part.cost, 0));
  return {
    available: true,
    parts,
    total: { totalTokens: totals.totalTokens, cost: totals.cost },
    reconciles: tokens === totals.totalTokens && cost === totals.cost,
  };
}

/**
 * True when `range` reaches before a retained window the view cannot restore:
 * the window is flagged partial and the range starts before its oldest row.
 * Decided without summing, so an omitted range is never published as a zero.
 */
function reachesBeforeRetained(
  rows: readonly { date?: string }[],
  range: RangeState,
): boolean {
  return (
    historyRowRange({ usageByDate: rows, usageByDateTruncated: true }, range)
      .partial === true
  );
}

/** Any contributing session whose retained window cannot represent `range`. */
function partialContribution(
  sessions: readonly PartialityWindow[],
  range: RangeState,
): boolean {
  return sessions.some(
    (session) =>
      session.availability === "available" &&
      historyRowRange(session, range).partial === true,
  );
}

/**
 * The aggregate's verdict for one session (design §5.6): membership needs an
 * in-range retained row, an unavailable session or a range that cannot be
 * resolved is `unknown`, and a truncated window with no in-range row is
 * `unknown` — its usage is `null`, never a fabricated zero. An empty retained
 * window is only "complete" when it is untruncated; a truncated one still
 * reaches omitted history, so it falls through to `historyRowRange` and its
 * per-row partiality matches the view it carries.
 */
function membershipVerdict(
  entry: HistoricalSession,
  range: RangeState | null,
): Pick<UiHistorySession, "membership" | "totalTokens" | "cost" | "partial"> {
  if (
    entry.availability !== "available" ||
    range === null ||
    (entry.usageByDate.length === 0 && entry.usageByDateTruncated !== true)
  ) {
    return {
      membership: "unknown",
      totalTokens: null,
      cost: null,
      partial: false,
    };
  }
  const verdict = historyRowRange(entry, range);
  if (verdict.member) {
    return {
      membership: "member",
      totalTokens: verdict.totalTokens,
      cost: verdict.cost,
      partial: verdict.partial,
    };
  }
  return {
    membership: verdict.partial ? "unknown" : "out",
    totalTokens: verdict.totalTokens,
    cost: verdict.cost,
    partial: verdict.partial,
  };
}

/** One membership row plus the session's own projection when it replayed. */
function historySessionRow(
  session: HistoricalSession,
  view: UiSessionProjection,
  range: RangeState | null,
): UiHistorySession {
  const report = view.report;
  const verdict = membershipVerdict(session, range);
  return {
    sessionId: session.sessionId,
    availability: session.availability,
    ...verdict,
    published: verdict.membership === "member" && report?.usage !== undefined,
    firstDate: report?.span?.from ?? null,
    lastDate: report?.span?.to ?? null,
    durationLabel: report?.durationLabel ?? null,
    generationCount: report?.generationCount ?? null,
    agentCount: report?.agentCount ?? null,
    status: report?.status ?? null,
    ...(report === undefined ? {} : { view }),
  };
}

function zeroTotals(): UiRangeProjection["totals"] {
  return { totalTokens: 0, cost: 0, generations: 0, tools: 0, days: 0 };
}

/** One range selection's bounded child breakdown (never a native-total input). */
function childUsageBreakdown(runs: readonly AgentRow[]): UiChildUsage {
  const byStatus = {
    succeeded: 0,
    failed: 0,
    interrupted: 0,
    running: 0,
    unknown: 0,
  };
  let runsWithUsage = 0;
  let failedRunsWithUsage = 0;
  let totalTokens = 0;
  let cost = 0;
  let failedCost = 0;
  for (const run of runs) {
    byStatus[run.status] += 1;
    if (run.usage === null) continue;
    runsWithUsage += 1;
    totalTokens += run.usage.totalTokens;
    cost = roundCost(cost + run.usage.cost);
    if (run.status === "failed") {
      failedRunsWithUsage += 1;
      failedCost = roundCost(failedCost + run.usage.cost);
    }
  }
  return {
    runsTotal: runs.length,
    runsWithUsage,
    totalTokens: runsWithUsage === 0 ? null : totalTokens,
    cost: runsWithUsage === 0 ? null : cost,
    failedCost: failedRunsWithUsage === 0 ? null : failedCost,
    failedRunsWithUsage,
    byStatus,
  };
}

/**
 * Each rendered run's parent verdict, decided here and never in a renderer: a
 * parent the selected rows carry is `in-range`, one only the full report knows
 * is `outside-range`, one only the run container published is
 * `orchestration-run`, and a value that is not an Inspector-owned identity is
 * `unknown`.
 */
export function agentParentVerdicts(
  all: readonly AgentRow[],
  selected: readonly AgentRow[],
): UiAgentRow[] {
  const rendered = new Set(selected.map((run) => run.id));
  const known = new Set(all.map((run) => run.id));
  return selected.map((run) => ({
    ...run,
    parent:
      run.parentId === null
        ? "none"
        : !OPAQUE_SUBAGENT_ID.test(run.parentId)
          ? "unknown"
          : rendered.has(run.parentId)
            ? "in-range"
            : known.has(run.parentId)
              ? "outside-range"
              : "orchestration-run",
  }));
}

/** A selection with no runs: zero runs, no known usage, never a zero sum. */
function emptyChildUsage(): UiChildUsage {
  return childUsageBreakdown([]);
}

/**
 * The coverage verdicts the browser row renders: some-but-not-all usage, and
 * some-but-not-all duration correlation. Both are computed from the counts the
 * summary already carries, so a row can never claim completeness it lacks.
 */
export function toolUsageVerdict(row: ToolSummaryRow): UiToolSummaryRow {
  return {
    ...row,
    partial: row.withUsage > 0 && row.withUsage < row.calls,
    durationPartial: row.withDuration > 0 && row.withDuration < row.calls,
  };
}

/**
 * Each inventory's availability figure: its own persisted count when it has
 * one, else the inventory rows only while the state says they are the whole
 * inventory, else `null` (Unavailable, never a fabricated zero). Skills use the
 * inventory's own count only: its counter-only rows are activity and would
 * inflate a rendered-row count.
 */
function inventoryAvailabilityOf(
  report: SessionReportView,
): UiInventoryAvailability {
  return {
    commands: declaredOrRows(
      report.commands.count,
      report.commands.state,
      report.commands.items.length,
    ),
    skills: report.skills.count,
    resources: declaredOrRows(
      null,
      report.resources.state,
      report.resources.items.length,
    ),
  };
}

function declaredOrRows(
  declared: number | null,
  state: EvidenceState,
  rows: number,
): number | null {
  if (typeof declared === "number") return declared;
  return state === "supported" ? rows : null;
}

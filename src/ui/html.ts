import type { EvidenceState, Scope } from "../core/events.ts";
import { buildLedger, type LedgerItem } from "../core/ledger.ts";
import type { SessionReport } from "../core/reports.ts";
import type { SessionCoverage } from "../core/session-coverage.ts";
// `CAPABILITIES` is report wiring, not report data: the document embeds the very
// table the server built, so the browser's tab strip cannot drift from what each
// section can actually render (design §9.3).
import {
  CAPABILITIES,
  type CurrentView,
  type DailyRow,
  type InspectorBundle,
} from "./bundle.ts";
import { buildDailyRows, type DailyContribution } from "./daily.ts";
import type { GlobalReport, HistoryReport } from "./load-history.ts";
import {
  filterView,
  historyRowRange,
  isInRange,
  latestObservedDate,
  parseRangeQuery,
  resolveRange,
} from "./range.ts";
import { deriveView, parseRoute, routeKey, serializeRoute } from "./route.ts";

export const ENGLISH_CATALOG = {
  "report.title": "Pi Session Inspector",
  "nav.current": "Current session",
  "nav.history": "Session history",
  "nav.global": "Global report",
  "nav.back": "Back to tracked sessions",
  workspace: "Workspace",
  "tag.local": "LOCAL REPORT",
  "tag.snapshot": "Snapshot",
  "heading.current": "A session, in focus.",
  "heading.history": "Pick up the trail.",
  "heading.global": "The bigger picture.",
  "kicker.current": "SESSION REPORT",
  "kicker.history": "TRACKED HISTORY",
  "kicker.global": "WORKSPACE REPORT",
  "subtitle.current":
    "Resource use, tool activity, and the evidence behind it.",
  "subtitle.history":
    "Browse tracked sessions. No global Pi scan. No raw conversation content.",
  "subtitle.global":
    "Native usage within the selected dates. Each session counted once.",
  "theme.dark": "Dark theme",
  "theme.light": "Light theme",
  "scope.label": "Entry scope",
  "scope.active": "Active path",
  "scope.tree": "Full session tree",
  "scope.active.note": "Selected entry and its parent ancestry",
  "scope.tree.note": "All tracked branches in this session",
  "scope.sameReport":
    "Active path and Full session tree produce the same report data for this session.",
  "scope.fixed": "History & Global use full tree.",
  "range.label": "Date range",
  "range.last": "Last {days} days",
  "range.custom": "Custom range",
  "range.inclusive": "Inclusive UTC dates",
  "range.custom.title": "Custom date range",
  "range.from": "From",
  "range.to": "To",
  "range.cancel": "Cancel",
  "range.apply": "Apply range",
  "range.error": "From must be on or before To.",
  "range.truncated": "Older days beyond the retained window are not shown.",
  "range.restored": "Range could not be restored; showing the default range.",
  // The one-line degradation notice a hash can produce (design §9.1): a section
  // or tab this document cannot render is named, never silently ignored.
  "nav.unavailable": "That view isn't available here.",
  // The live-region suffix a followed entity link adds; the highlighted row is
  // named by its own label, never by this string.
  "nav.entityFocus": "Focused entity",
  "panel.allDates": "All report dates",
  "tab.overview": "Overview",
  "tab.models": "Models",
  "tab.tools": "Tools",
  // The browser's inventory grouping (design §9.3): Commands, Skills and
  // Resources are sub-navigation inside this one environment panel, never
  // primary tabs beside Overview/Tools/Errors.
  "tab.environment": "Environment",
  "tab.commands": "Commands",
  "tab.agents": "Agents",
  "tab.skills": "Skills",
  "tab.integrations": "Integrations",
  "tab.errors": "Errors",
  "tab.ledger": "Ledger",
  "metric.cost": "Native cost",
  "metric.knownCost": "Known native cost",
  "metric.costUnavailable": "Unavailable",
  "metric.tokens": "Total tokens",
  "metric.knownTokens": "Known tokens",
  "metric.generations": "Generations",
  "metric.tools": "Tool calls",
  "metric.sessions": "Tracked sessions",
  "metric.days": "Observed days",
  "metric.native": "Persisted usage · USD",
  "metric.input": "Input",
  "metric.output": "Output",
  "metric.cache": "Cache",
  "metric.cacheRead": "Cache read",
  "metric.cacheWrite": "Cache write",
  "metric.tokens.note": "Persisted split, summed by source",
  "metric.generations.note": "Recorded model responses",
  "metric.tools.note": "Observed native calls",
  "metric.days.note": "UTC days with persisted records",
  "metric.sessions.global.note":
    "All report dates; daily rows carry range detail",
  "metric.duration": "Duration",
  "metric.duration.note": "First to last native record · native confidence",
  "metric.usage.generations": "Generations",
  "metric.usage.toolResults": "Tool results",
  "metric.usage.compactions": "Compactions",
  "metric.usage.branchSummaries": "Branch summaries",
  "usage.title": "Usage composition",
  "usage.note":
    "Generations, tool results, compactions, and branch summaries are persisted native usage, counted once.",
  "usage.total": "Total",
  "usage.reconciled": "Reconciles to total",
  "usage.unreconciled": "Does not reconcile to total",
  "panel.models": "Model cost",
  "panel.tools": "Tool activity",
  "panel.evidence": "Evidence, not estimates.",
  "panel.daily": "Daily activity",
  "panel.history": "Tracked sessions",
  "panel.agents": "Agent breakdown",
  "panel.agentActivity": "Agent tool activity",
  "panel.integrations": "Integrations",
  "panel.ledger": "Chronological ledger",
  "evidence.native": "Native",
  "evidence.live": "Live",
  "evidence.cooperative": "Cooperative",
  "evidence.supported": "Supported",
  "evidence.unavailable": "Unavailable",
  "evidence.unsupported": "Unsupported",
  "evidence.source": "Source-aware",
  "evidence.note":
    "Every metric keeps its source. Missing observations stay missing.",
  "evidence.piRecords": "Pi persisted records",
  "evidence.piRecords.detail":
    "{generations} generations · {tools} tool calls · {models} models",
  "evidence.span": "Session span",
  "evidence.span.detail": "first to last native record",
  "evidence.span.missing": "Fewer than two native records",
  "evidence.toolTiming": "Tool timing (live)",
  "evidence.toolTiming.detail": "{count} correlated tool durations",
  "evidence.toolTiming.missing": "No correlated live timing",
  "evidence.child": "Child agent usage",
  "evidence.child.detail": "{count} runs · breakdown only, never added",
  "evidence.child.missing": "No native subagent activity observed",
  "evidence.errors": "Persisted error records",
  "evidence.errors.detail": "{count} bounded classifications",
  "evidence.integration": "Integration evidence",
  "evidence.integration.missing": "No persisted integration evidence",
  "evidence.retries": "Provider retries",
  "evidence.retries.detail": "Not observed; provider retries are unavailable",
  "evidence.history.sessions":
    "{available} of {total} tracked sessions replayed",
  "evidence.history.span": "{count} sessions with a native span",
  "evidence.history.child": "{count} sessions with supported child evidence",
  "evidence.history.integrations": "{count} supported integration observations",
  "evidence.history.errors": "{count} sessions with persisted error records",
  "evidence.global.days":
    "{days} observed UTC days · {sessions} replayed sessions",
  "evidence.global.composition": "Not exposed by global daily aggregates",
  "evidence.global.agents":
    "Global daily aggregates carry no native subagent activity",
  "evidence.global.integrations":
    "Global report carries no integration observations",
  "evidence.global.errors": "Global report carries no error records",
  "models.note": "Native usage grouped by provider and model.",
  "models.none": "No native generations recorded.",
  "tools.note":
    "Tokens and cost appear only when a matching tool result persisted usage.",
  "tools.none": "No native tool calls recorded.",
  "tools.summary": "Tools summary",
  "tools.calls": "Calls timeline",
  "tools.lastUsed": "Last used",
  "tools.usageFraction": "{withUsage} of {total} calls reported usage",
  "tools.filteredBy": "Filtered by {tool}",
  "tools.clearFilter": "Show all tools",
  "tools.succeeded": "Succeeded",
  "tools.failed": "Failed",
  "tools.interrupted": "Interrupted",
  "tools.bars.note": "Call count by tool",
  "bars.empty": "No observations in the selected scope.",
  "agents.note":
    "Child usage is a breakdown only. It is never added to native totals.",
  "agents.activity.note":
    "Calls recorded from persisted tool results. Usage is a breakdown only.",
  "agents.childRuns": "Child runs",
  "agents.none":
    "Child-run evidence is unavailable for this session, so no run count is inferred.",
  "agents.succeeded": "Succeeded",
  "agents.failed": "Failed",
  "agents.interrupted": "Interrupted",
  "agents.running": "Running",
  "agents.unknown": "Unknown",
  "agents.knownTokens": "Known child tokens",
  "agents.knownCost": "Known child cost",
  "agents.knownFailedCost": "Known failed-run cost",
  "agents.usageFraction": "{withUsage} of {total} runs reported usage",
  "agents.parentOutsideScope": "Parent: outside selected scope",
  "agents.parentUnknown": "Parent: Unavailable",
  // A run without an observed time cannot be placed in any range, so an empty
  // range view states the cause instead of blaming the range for the gap.
  "agents.undated":
    "Child runs carry no observed time, so none can be placed in the selected range.",
  "agents.undatedAndOutOfRange":
    "No child run falls inside the selected range, and runs without an observed time cannot be placed in one.",
  "agents.outOfRange": "No child run falls inside the selected range.",
  "commands.note":
    "Loaded or available commands: inventory ≠ invocations. Counts are availability, never activity.",
  "commands.count":
    "No commands inventory on disk. {count} commands were recorded at session start.",
  "skills.note":
    "Loaded or available skills plus observed explicit invocations: inventory ≠ invocations.",
  "skills.empty": "No skills inventory or explicit invocations recorded.",
  "skills.otherInvocations": "+ {count} other invocations",
  "panel.resources": "Resource sources",
  "resources.note":
    "Loaded or available resources by source. Counts are availability, never activity.",
  "resources.unavailable": "No resource-source inventory recorded.",
  // The Environment summary (design §8.1): availability is inventory state and,
  // for skills only, the explicit folded counters are the invocation figure.
  // Commands have no counter evidence, so their observed side is Unavailable.
  "env.commands": "Commands",
  "env.skills": "Skills",
  "env.resources": "Resources",
  "env.available": "Available: {count}",
  "env.observed": "Observed invocations: {value}",
  "env.invocationsObserved": "Explicit invocations observed: {count}",
  "env.invocationsUnavailable": "Explicit invocations observed: Unavailable",
  "env.sources": "Sources: {count}",
  // Inventory is the current environment, not session activity, so the panel
  // carries this period label instead of any range label (§5.2).
  "env.note":
    "Current environment · Inventory is availability, never activity, and is not filtered by the selected range.",
  "table.error": "Error",
  "table.name": "Name",
  "table.invocations": "Invocations",
  "table.scope": "Scope",
  "table.origin": "Origin",
  "table.description": "Description",
  "table.commands": "Commands",
  "table.skills": "Skills",
  "table.prompts": "Prompts",
  "table.calls": "Calls",
  "table.presence": "Presence",
  "table.message": "Message",
  "presence.present": "Present",
  "presence.absent": "Not observed",
  "presence.unknown": "Unknown",
  "integrations.note": "Evidence availability is not installation status.",
  // The four independent integration columns (design §8.2). Detection is
  // inventory-derived, telemetry is evidence-derived, and the two are never
  // reconciled; the reason strings are the closed telemetry vocabulary and the
  // note is a non-state remark that never changes the telemetry value.
  "integration.detected": "Detected",
  "integration.telemetry": "Telemetry",
  "integration.activity": "Activity",
  "integration.version": "Version",
  "integration.sessionTotal": "Session total",
  "integration.reasonUnsupported": "no compatible telemetry evidence",
  "integration.reasonMissing": "no telemetry observed in this session",
  "integration.noteNotDetected": "producer not detected in current inventory",
  "errors.note": "Bounded classifications from persisted stop and error state.",
  "errors.none": "No persisted error records. An observed zero stays zero.",
  // The Errors row leads with what failed: the joined tool's name when the
  // record has one, else the bounded classification label. The raw
  // `tool:call_…` id is never a headline; it stays a row detail.
  "errors.toolFailed": "{tool} failed",
  "errors.failed": "Tool call failed",
  "errors.generation": "Generation error",
  "errors.relatedTool": "Related tool",
  // One row may have many candidates, so the label stays plural-safe and no
  // candidate is ever named as the cause (design §7.5-3).
  "errors.relatedChildren": "Related child run(s)",
  // A tool error has no safe structured message at all, so this is the only
  // value its message column may carry (design §7.5-4).
  "errors.messageUnavailable": "Unavailable",
  "empty.ledger": "No persisted records to order.",
  "history.note":
    "Open a row to inspect its full-tree sections with the same tabs.",
  "history.sessions.note": "Tracked sessions in the selected range",
  // The aggregate's own notice when a contributing session's retained dated
  // window cannot represent its spend; same bounded sentence as the current
  // view's `range.truncated` (design §5.1).
  "history.dailyTruncated":
    "Older days beyond the retained window are not shown.",
  // Sessions with no dated evidence cannot be attributed to any range.
  "history.groupUnknown": "Unavailable · dates unknown",
  "models.truncated":
    "Older dates' model rows beyond the retained window are not shown.",
  "notice.sensitive": "Local does not mean safe to share.",
  "notice.copy":
    "Report metadata can be sensitive. Review exports before sharing.",
  "walDetail.expired": "Detailed records expired",
  "walDetail.copy":
    "Records older than the 14-day retention window were pruned. Aggregates and native usage remain.",
  "footer.authority":
    "Pi-native usage is billing authority. Child usage is never added.",
  search: "Search rows",
  "search.placeholder": "Filter this table…",
  sort: "Sort order",
  "sort.default": "Source order",
  "sort.name": "Name A–Z",
  "sort.reverse": "Reverse source order",
  "chart.metric": "Chart metric",
  "chart.sessions": "Sessions",
  "chart.cost": "Cost",
  "chart.tokens": "Tokens",
  "chart.generations": "Generations",
  "chart.tools": "Tool calls",
  "chart.empty": "No daily observations match the selected range.",
  "chart.note":
    "{metric} per observed UTC day. Days without records are not counted as zero.",
  "chart.aria":
    "Daily {metric} across {days} observed UTC days. Exact values are in the chart data table.",
  "chart.data": "View chart data",
  "table.source": "Source",
  "table.observation": "Observation",
  "table.confidence": "Confidence",
  "table.date": "Date",
  "table.session": "Session",
  "table.sessions": "Sessions",
  "table.tokens": "Tokens",
  "table.generations": "Generations",
  "table.tools": "Tool calls",
  "table.cost": "Cost (USD)",
  "table.duration": "Duration",
  "table.agents": "Agents",
  "table.status": "Status",
  "table.inspect": "Inspect",
  "table.open": "Open",
  "table.provider": "Provider",
  "table.model": "Model",
  "table.input": "Input",
  "table.output": "Output",
  "table.cacheRead": "Cache read",
  "table.cacheWrite": "Cache write",
  "table.tool": "Tool",
  "table.run": "Run",
  "table.role": "Role",
  "table.artifacts": "Artifacts",
  "table.parent": "Parent",
  "table.evidence": "Evidence",
  "table.integration": "Integration",
  "table.version": "Version",
  "table.counters": "Counters",
  "table.id": "ID",
  // The one label of an opaque id's copy control (§16); the control names the id
  // it copies, so one row's button is never confused with another's.
  "table.copyId": "Copy ID",
  "table.kind": "Kind",
  "table.timestamp": "Timestamp",
  "table.category": "Category",
  "table.action": "Action",
  "history.scope": "Full-tree report summaries.",
  "status.errors": "Error records",
  "status.interrupted": "Interrupted calls",
  "status.clean": "No error records",
  "unavailable.title": "Unavailable, not zero.",
  "unavailable.copy":
    "Inspector does not infer activity from prompts, outputs, or missing records.",
  "unavailable.session": "Open a tracked session row to inspect this section.",
  "unavailable.global":
    "Global reports carry daily aggregates only. The History report has per-session sections.",
  "unavailable.commands":
    "Pi does not persist command invocation records. Inspector will not infer them from prompts, outputs, or tool names.",
  "unavailable.skills":
    "Pi does not persist skill attribution records. Inspector will not infer them from prompts, outputs, or tool names.",
  "unavailable.composition": "This report carries no per-source usage split.",
  "unavailable.usage":
    "Usage unavailable. The native aggregate was rejected; no total is shown.",
  "unavailable.agents":
    "No native subagent activity recorded for this session.",
  "unavailable.current": "This current view could not be replayed offline.",
  "unavailable.integrations": "No persisted integration observations.",
  "ledger.materialized":
    "Shared projection rows, materialized only when this section opens.",
  offline: "OFFLINE · EN",
  "brand.tagline": "Understand your agent.",
  "local.design": "Local by design",
  "metric.child": "Child breakdown",
  "metric.child.note": "breakdown only · never added",
  "coverage.title": "Coverage",
  "coverage.sessions":
    "{available} / {inspected} sessions · {unavailable} unavailable",
  "coverage.complete": "{available} / {inspected} sessions",
  "coverage.sessionsLimited":
    "{inspected} sessions inspected · additional sessions not inspected",
  "coverage.none": "No tracked sessions",
  "coverage.unknown": "Sessions: Unavailable",
  "coverage.reasons": "Reasons: {reasons}",
  "coverage.unknownCompletenessCost":
    "Known native cost — completeness unknown",
  "coverage.unknownCompletenessTokens": "Known tokens — completeness unknown",
} as const;

export type HtmlReport =
  | { kind: "current"; report: SessionReport; scope: Scope }
  | { kind: "history"; report: HistoryReport }
  | { kind: "global"; report: GlobalReport };

export type DailyActivityRow = {
  date: string;
  sessions: number;
  totalTokens: number;
  cost: number;
  generations?: number;
  tools?: number;
};

type SafeUsage = NonNullable<SessionReport["usage"]>;
type CompositionKey =
  | "generations"
  | "toolResults"
  | "compactions"
  | "branchSummaries";
type CompositionView = {
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
type ModelRow = {
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
type ToolRow = Omit<ToolCallRow, "usage"> & {
  id: string;
  usage: SafeUsage | null;
  durationMs: number | null;
  durationLabel: string | null;
};
type AgentRow = {
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
type IntegrationRow = {
  integration: string;
  presence: SessionReport["integrations"][number]["presence"];
  version: number | null;
  state: EvidenceState;
  counters: string[];
};
type EvidenceRow = {
  source: string;
  observation: string;
  confidence: string;
};
type ErrorRow = {
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
type StatusView = {
  key: "status.errors" | "status.interrupted" | "status.clean";
  tone: "neutral" | "warn";
};
type SessionView = {
  sessionId: string;
  usage?: SafeUsage;
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
type HistoryEntry = {
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
  usageByDate?: NonNullable<CurrentView["usageByDate"]>;
  usageByDateTruncated?: boolean;
  /**
   * The same session's per-date model rows, so its detail filters the Models
   * tab exactly like the current section. Absent for a payload that carries no
   * dated projection (the legacy adapter), which labels the aggregate table.
   */
  datedModels?: NonNullable<CurrentView["datedModels"]>;
  modelsTruncated?: boolean;
  view?: SessionView;
};

/**
 * The document's pure browser half, inlined into the generated document so the
 * client and the tests run exactly the same source: there is one range filter,
 * one tools derivation and one route, and none of them can drift from the
 * functions the unit tests import. Each entry is emitted as `const <name>=<source>;`
 * so the script defines the very bindings the tests exercise.
 *
 * Every listed function is self-contained (`src/ui/range.ts` documents why:
 * no module scope, no clock, no named nested helper, hence no `__name`) and has
 * a call site in the emitted script: a helper the client never calls is not
 * inlined, so the document carries no dead weight.
 */
const INLINED_FUNCTIONS = [
  latestObservedDate,
  resolveRange,
  isInRange,
  parseRangeQuery,
  filterView,
  historyRowRange,
  toolSummary,
  toolCalls,
  toolDuration,
  errorHeadline,
  errorMessage,
  // The route functions follow the range helpers they call, so every cross-call
  // in the emitted block is already declared when the block is evaluated.
  serializeRoute,
  routeKey,
  parseRoute,
  deriveView,
] as const;

/**
 * The inlined block as emitted. The result is a classic-script statement list
 * that declares every listed function by its own name; evaluating it with
 * `new Function` proves there is no module scope to resolve.
 */
export function inlineModuleSource(): string {
  return INLINED_FUNCTIONS.map((fn) => `const ${fn.name}=${String(fn)};`).join(
    "\n",
  );
}

/**
 * Evaluates the emitted source with no DOM, no imports and no module scope, and
 * calls two of the inlined functions. A helper that reaches for module scope,
 * or a nested function the transpiler wrapped in its module-scope `__name`
 * helper, therefore fails here instead of in the browser.
 */
export function assertInlinedModulesEvaluate(): void {
  const source = inlineModuleSource();
  if (/__name\(/.test(source)) {
    throw new Error("the inlined source calls a module-scope helper");
  }
  const inlined = new Function(
    `${source}\nreturn {serializeRoute,routeKey,parseRoute,deriveView};`,
  )() as {
    serializeRoute: typeof serializeRoute;
    routeKey: typeof routeKey;
    parseRoute: typeof parseRoute;
    deriveView: typeof deriveView;
  };
  const route = {
    section: "current" as const,
    tab: "overview",
    scope: "active" as const,
  };
  const key = inlined.serializeRoute(route);
  if (key !== inlined.routeKey(route)) {
    throw new Error("the inlined serializer and key disagree");
  }
  const parsed = inlined.parseRoute(key, {
    scope: "tree",
    capabilities: { current: ["overview"], history: [], global: [] },
    knownIds: new Set<string>(),
  });
  const view = inlined.deriveView(
    parsed.route,
    { current: ["overview"], history: [], global: [] },
    [],
  );
  if (view.activeTab !== "overview") {
    throw new Error("the inlined derivation did not coerce the tab");
  }
}

const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'";
const SESSION_CHART_METRICS = [
  "sessions",
  "cost",
  "tokens",
  "generations",
  "tools",
] as const;
const GLOBAL_CHART_METRICS = ["sessions", "cost", "tokens"] as const;
const COMPOSITION_KEYS: readonly CompositionKey[] = [
  "generations",
  "toolResults",
  "compactions",
  "branchSummaries",
];
const DAY = /^(\d{4}-\d{2}-\d{2})/;
function renderHead(t: typeof ENGLISH_CATALOG): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${CSP}"><title>${t["report.title"]}</title><style>\n`;
}
const STYLES =
  '\n:root{color-scheme:light;--bg:#f7f7f4;--surface:#fff;--soft:#f0f0eb;--ink:#252820;--muted:#535b4f;--line:#dddfd6;--accent:#aa3e13;--tint:#fff0e6;--green:#34624b;--green-bg:#edf5ee;--warning:#825719;--mono:ui-monospace,SFMono-Regular,Consolas,monospace}\n*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input,select{font:inherit;color:inherit}button,select{cursor:pointer}button{background:var(--surface);border:1px solid var(--line);border-radius:7px;min-height:40px;padding:8px 14px}button:hover{border-color:var(--muted);background:var(--soft)}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid var(--accent);outline-offset:3px}button[aria-pressed=true]{background:var(--tint);color:var(--accent);border-color:var(--accent)}h1,h2,h3,p{margin:0}h1{font-size:30px;font-weight:620;letter-spacing:-1px;line-height:1.25}h2{font-size:16px;font-weight:620}h3{font-size:14px}small,.muted{color:var(--muted)}small{font-size:12px}.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}.skip{position:absolute;top:-60px;left:16px;z-index:10;background:var(--surface);padding:10px}.skip:focus{top:10px}.shell{display:grid;grid-template-columns:224px minmax(0,1fr);min-height:100vh}aside{padding:28px 18px;border-right:1px solid var(--line);display:flex;flex-direction:column;background:var(--surface)}.brand{display:flex;align-items:center;gap:10px;font-size:16px;font-weight:650;line-height:1.3;padding:0 10px 32px}.mark{display:grid;place-items:center;background:var(--ink);color:var(--surface);width:34px;height:34px;border-radius:9px;font:24px Georgia,serif}.brand small{font-weight:400}.eyebrow{font:11px var(--mono);text-transform:uppercase;letter-spacing:1.4px;color:var(--muted)}aside .eyebrow{padding:0 12px;margin:20px 0 8px}.nav{display:grid;gap:4px}nav.nav a{border-color:transparent;background:transparent;display:flex;align-items:center;gap:10px;text-align:left;padding:10px 12px;min-height:44px;color:inherit;text-decoration:none}nav.nav a[aria-current=page]{background:var(--tint);color:var(--accent)}.nav svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.5}.rail-foot{margin-top:auto;padding:40px 12px 0}.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--green);margin-right:7px}.rail-foot p{margin-top:8px;font-size:12px;color:var(--muted)}.workspace{min-width:0}.topbar{padding:16px 36px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:16px;background:var(--surface)}.topbar .trail{font-size:12px;color:var(--muted)}.topbar .trail strong{color:var(--ink);font-weight:500}.preview{font:11px var(--mono);color:var(--accent);border:1px solid var(--line);border-radius:5px;padding:5px 8px;white-space:nowrap}.content{max-width:1440px;margin:auto;padding:34px 36px}.heading{display:flex;justify-content:space-between;gap:24px;align-items:center}.heading p{color:var(--muted);margin-top:9px}.actions{display:flex;gap:8px;flex-wrap:wrap}.primary{background:var(--ink);color:var(--surface);border-color:var(--ink)}.primary:hover{background:var(--muted);color:var(--surface)}.context{display:flex;justify-content:space-between;gap:16px;align-items:center;margin:26px 0 22px}.context small{display:block;margin-top:5px}.segments{display:flex;gap:4px}.segments button{padding:6px 14px;min-height:36px}.badge{font-size:11px;display:inline-block;padding:3px 8px;border-radius:5px;background:var(--green-bg);color:var(--green);white-space:nowrap}.badge.neutral{background:var(--soft);color:var(--muted)}.badge.warn{background:var(--tint);color:var(--warning)}.tabs{display:flex;flex-wrap:wrap;gap:4px;border-bottom:1px solid var(--line);margin-bottom:24px;padding-bottom:8px}nav.tabs a{border:0;background:none;color:var(--muted);padding:8px 11px;text-decoration:none}nav.tabs a[aria-current=page]{color:var(--accent);background:var(--tint)}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(196px,1fr));gap:16px}.card{border:1px solid var(--line);background:var(--surface);border-radius:10px;overflow:hidden}.metric{padding:20px}.metric .value{font-size:30px;letter-spacing:-1px;margin:12px 0 8px;line-height:1.2}.metric:first-child{border-top:3px solid var(--accent);padding-top:18px}.metric .value small{font-size:14px;letter-spacing:0}.panel-head{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:20px 22px}.panel-head p{font-size:12px;color:var(--muted);margin-top:4px}.grid{display:grid;grid-template-columns:1.6fr 1fr;gap:20px;margin-top:20px}.bars{padding:6px 22px 22px;display:grid;gap:20px}.bar-label{display:flex;justify-content:space-between;gap:12px;margin-bottom:8px;font-size:13px}.track{height:8px;background:var(--soft);border-radius:3px;overflow:hidden}.fill{height:100%;background:var(--accent);border-radius:3px}.bar:nth-child(even) .fill{background:#747f67}.footnote{border-top:1px solid var(--line);padding:12px 22px;font-size:12px;color:var(--muted)}.notice{display:flex;gap:12px;border:1px solid var(--line);background:var(--soft);padding:14px 18px;border-radius:8px;margin-top:24px;font-size:12px;color:var(--muted)}.notice strong{color:var(--ink)}.toolbar{display:flex;gap:12px;flex-wrap:wrap;align-items:end;padding:0 22px 18px}.toolbar label{display:grid;gap:5px;font-size:12px;color:var(--muted)}input,select{background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:9px 12px;min-height:40px;max-width:100%}input{width:250px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;text-align:left}th{font-size:11px;text-transform:uppercase;letter-spacing:.7px;color:var(--muted);font-weight:500;background:var(--bg)}th,td{padding:13px 22px;border-top:1px solid var(--line);vertical-align:top}td{font-size:13px}.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.wrap{white-space:normal}.id-cell{max-width:18ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--mono)}.id-cell .id-value{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.id-cell .copy-id{display:block;min-height:32px;padding:4px 10px;font-size:12px}.status-cell{white-space:nowrap}tbody tr:hover{background:var(--bg)}.empty{text-align:center;padding:56px 24px}.empty h2{margin:12px 0 8px}.empty p{max-width:440px;margin:auto;color:var(--muted)}.empty .eyebrow{color:var(--accent)}.chart{display:grid;grid-template-columns:52px minmax(0,1fr);gap:10px;padding:8px 22px 0}.chart-axis{display:flex;flex-direction:column;justify-content:space-between;text-align:right;padding:4px 0;font:12px var(--mono);color:var(--muted)}.line-chart{display:block;width:100%;height:180px;overflow:visible}.chart-grid{stroke:var(--line);stroke-width:1;vector-effect:non-scaling-stroke}.activity-line{fill:none;stroke:var(--accent);stroke-width:2.5;stroke-linejoin:round;vector-effect:non-scaling-stroke}.line-point{fill:var(--surface);stroke:var(--accent);stroke-width:2;vector-effect:non-scaling-stroke}.chart-dates{grid-column:2;display:flex;justify-content:space-between;font:12px var(--mono);color:var(--muted)}.chart-note{padding:20px 22px;font-size:12px;color:var(--muted)}.section-gap{margin-top:20px}footer{display:flex;justify-content:space-between;gap:12px;margin-top:20px;font-size:11px;color:var(--muted)}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}details{padding:12px 22px}summary{cursor:pointer;min-height:32px}.theme-dark{color-scheme:dark;--bg:#181c19;--surface:#202521;--soft:#2b312b;--ink:#eef0e8;--muted:#bdc5b8;--line:#40493e;--accent:#ffad80;--tint:#392b22;--green:#b1d4b9;--green-bg:#29372d;--warning:#edc78f}noscript{display:block;padding:24px}.content a{color:var(--accent)}@media(max-width:1100px){.shell{grid-template-columns:188px minmax(0,1fr)}.content{padding:28px 24px}.topbar{padding:16px 24px}.grid{grid-template-columns:1fr}.metrics{gap:10px}.metric{padding:16px}.metric:first-child{padding-top:14px}.metric .value{font-size:26px}.heading{align-items:flex-start}}@media(max-width:760px){.shell{display:block}aside{padding:16px;border-right:0;border-bottom:1px solid var(--line)}.brand{padding:0 0 16px}.nav{display:flex;flex-wrap:wrap}nav.nav a{flex:1}.rail-foot,aside .eyebrow{display:none}.topbar{padding:12px 16px}.content{padding:24px 16px}.heading{display:block}.actions{margin-top:18px}.context{align-items:flex-start;flex-direction:column}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.tabs a{min-height:44px}.panel-head{padding:18px 16px;flex-wrap:wrap}.toolbar{padding-left:16px;padding-right:16px}input{width:100%}.toolbar label{flex:1;min-width:120px}footer{flex-wrap:wrap}.chart{gap:8px;padding-left:16px;padding-right:16px}.notice{align-items:flex-start}.trail{overflow-wrap:anywhere}}@media(prefers-reduced-motion:no-preference){button{transition:background .15s,border-color .15s}}@media print{aside,.topbar,.actions,.tabs,.toolbar,.segments{display:none}.shell{display:block}.content{padding:0}.card{break-inside:avoid}}\n[hidden]{display:none!important}.time-range{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:16px 20px;margin-bottom:22px;background:var(--surface);border:1px solid var(--line);border-radius:10px}.time-range small{display:block;margin-top:4px}.time-range .segments{flex-wrap:wrap}.time-range button{min-height:44px}dialog{background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:12px;padding:24px;width:min(440px,calc(100% - 32px))}dialog::backdrop{background:#0008}dialog form{display:grid;gap:18px}dialog label{display:grid;gap:6px}dialog input{width:100%}dialog .actions{justify-content:flex-end;margin-top:0}.date-error{color:var(--accent);font-size:13px}\n.utility-actions button{background:transparent;color:var(--muted);font-size:12px;padding:6px 10px}.utility-actions button:hover{color:var(--ink);background:var(--soft)}.data-scope{display:flex;gap:24px;flex-wrap:wrap;align-items:center;border:1px solid var(--line);border-radius:10px;background:var(--surface);padding:16px 20px;margin-bottom:22px}.scope-group{display:grid;gap:8px}.scope-group .eyebrow{font-weight:600}.scope-group button{min-height:44px}button:disabled{opacity:.6;cursor:not-allowed}.data-scope .time-range{flex:1;min-width:240px;border:0;border-radius:0;padding:0;margin:0}.data-scope .time-range small{font-size:12px}.breakdown{display:grid;gap:4px;margin-top:12px;padding-top:10px;border-top:1px solid var(--line);font-size:12px;color:var(--muted)}.breakdown-row{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}.breakdown .mono{color:var(--ink)}.history-table th,.history-table td{padding:10px 12px}.history-table th:first-child,.history-table td:first-child{padding-left:20px}.history-table small{display:block}.history-table button{min-height:40px;padding:6px 10px}.history-table .badge{font-size:12px}.history-table-wrap:focus-visible{outline:3px solid var(--accent);outline-offset:-3px}@media(max-width:760px){.data-scope{padding:16px;gap:16px}.data-scope .time-range{flex-basis:100%;min-width:0;border-top:1px solid var(--line);padding-top:16px}.utility-actions{margin-top:12px}.chart{grid-template-columns:42px minmax(0,1fr);padding-left:16px;padding-right:16px}.chart-axis,.chart-dates{font-size:12px}}.range-note{flex-basis:100%;font-size:12px;color:var(--muted);margin:8px 0 0}\n.entity-focus{background:var(--tint);outline:3px solid var(--accent);outline-offset:2px;border-radius:5px}\n';
function renderBody(
  data: string,
  bodyClass = "",
  themePressed = false,
  rangeTruncated = false,
): string {
  const t = ENGLISH_CATALOG;
  const rangeNotice = rangeTruncated
    ? `<p class="range-note" id="range-truncated">${t["range.truncated"]}</p>`
    : "";
  return `\n</style></head><body${bodyClass === "" ? "" : ` class="${bodyClass}"`}>
<a class="skip" href="#main">Skip to report</a><div class="shell"><aside aria-label="${t.workspace}"><div class="brand"><span class="mark" aria-hidden="true">π</span><span>${t["report.title"]}<br><small>${t["brand.tagline"]}</small></span></div><p class="eyebrow">${t.workspace}</p><nav class="nav" id="navigation" aria-label="Report range"></nav><div class="rail-foot"><span class="dot"></span>${t["local.design"]}<p>Offline report. No tracking.<br>No prompts or outputs.</p><p class="mono">${t.offline}</p></div></aside><div class="workspace"><header class="topbar"><span class="trail">Inspector / <strong id="breadcrumb"></strong></span><span class="preview">${t["tag.local"]}</span></header><main id="main" class="content" tabindex="-1">
<div class="heading"><div><p class="eyebrow" id="kicker"></p><h1 id="title" tabindex="-1"></h1><p id="subtitle"></p></div><div class="actions utility-actions"><button id="theme" aria-pressed="${themePressed ? "true" : "false"}">${themePressed ? t["theme.light"] : t["theme.dark"]}</button></div></div><div class="context"><div><span class="mono" id="session-label"></span> <span class="badge neutral">${t["tag.snapshot"]}</span><small id="scope-note"></small></div></div>
<div class="notice" id="wal-detail" hidden><span aria-hidden="true">ⓘ</span><div><strong>${t["walDetail.expired"]}</strong> ${t["walDetail.copy"]}</div></div>
<div class="data-scope" role="group" aria-label="Data scope"><div class="scope-group"><p class="eyebrow">${t["scope.label"]}</p><div class="segments" id="scope" aria-label="${t["scope.label"]}"><button data-scope="active">${t["scope.active"]}</button><button data-scope="tree">${t["scope.tree"]}</button></div><small id="scope-sub"></small><small id="scope-fixed" hidden>${t["scope.fixed"]}</small></div><section class="time-range" id="time-range" aria-label="${t["range.label"]}" hidden><div><p class="eyebrow">${t["range.label"]}</p><strong id="range-name"></strong><div class="mono" id="range-dates" aria-live="polite"></div><small>${t["range.inclusive"]}</small></div><div class="segments"><button data-days="7">7D</button><button data-days="14">14D</button><button data-days="30">30D</button><button id="custom-range" aria-haspopup="dialog">${t["range.custom"]}</button></div>${rangeNotice}</section></div>
<dialog id="date-dialog" aria-labelledby="date-title"><form id="date-form"><h2 id="date-title">${t["range.custom.title"]}</h2><p class="muted">${t["range.inclusive"]}</p><label>${t["range.from"]}<input id="date-from" type="date" required aria-describedby="date-error"></label><label>${t["range.to"]}<input id="date-to" type="date" required aria-describedby="date-error"></label><p id="date-error" class="date-error" role="alert"></p><div class="actions"><button type="button" id="date-cancel">${t["range.cancel"]}</button><button type="submit" class="primary">${t["range.apply"]}</button></div></form></dialog>
<nav class="tabs" id="tabs" aria-label="Report section"></nav><p class="range-note" id="route-notice" hidden></p><div id="view"></div><div class="notice"><span aria-hidden="true">ⓘ</span><div><strong>${t["notice.sensitive"]}</strong> ${t["notice.copy"]}</div></div><footer><span>${t["footer.authority"]}</span><span class="mono">${t.offline}</span></footer><p id="announcement" class="sr-only" role="status"></p></main></div></div><noscript>This report requires JavaScript. It is self-contained and makes no network requests.</noscript><script type="application/json" id="report-data">${data}</script><script type="application/json" id="catalog-data">${JSON.stringify(t)}</script><script>\n`;
}
/** Escapes one inline JSON payload so hostile strings can never break out. */
function escapeInlineJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/**
 * Renders a self-contained document from one escaped bundle-shaped payload.
 * Both public entry points share this tail and therefore the SAME client
 * script, so there is exactly one browser runtime to keep in sync.
 */
function renderDocument(input: {
  payload: unknown;
  theme: "light" | "dark";
  rangeTruncated: boolean;
}): string {
  const data = escapeInlineJson(input.payload);
  const t = ENGLISH_CATALOG;
  const dark = input.theme === "dark";
  return `${renderHead(t)}${STYLES}${renderBody(
    data,
    dark ? "theme-dark" : "",
    dark,
    input.rangeTruncated,
  )}${BUNDLE_DIRECTIVE}${inlineModuleSource()}\n${BUNDLE_SCRIPT}\n</script></body></html>`;
}

/** Empty sections stand in for the two report kinds a single-section report does not carry. */
const UNAVAILABLE_HISTORY: HistoryReport = {
  availability: "unavailable",
  sessions: [],
  diagnostics: [],
};
const UNAVAILABLE_GLOBAL: GlobalReport = {
  availability: "unavailable",
  sessions: [],
  usage: { totalTokens: 0, cost: 0 },
  dates: [],
  diagnostics: [],
  inventory: { commands: null, skills: null, resources: null },
};
const CURRENT_UNAVAILABLE_VIEW: CurrentView = {
  availability: "unavailable",
  diagnostic: "current-unavailable",
};

/**
 * Adapts the legacy per-section `HtmlReport` to the one bundle payload shape the
 * shared client script consumes: the requested section is populated and the
 * other two are explicit unavailable sections. `renderHtml` therefore stays a
 * thin projection adapter with no second rendering runtime.
 */
function bundlePayloadFromReport(input: HtmlReport): Record<string, unknown> {
  const currentReport = input.kind === "current" ? input.report : undefined;
  // The legacy adapter has no canonical session, so its current-view rows keep
  // the pre-attribution bucketing (spec §5.4, the one documented exception).
  const currentView = (report: SessionReport): CurrentView => ({
    availability: "available",
    report,
    daily: buildDailyActivityRows([report]),
    dailyTruncated: false,
  });
  // This adapter emits no same-projection flag: it always renders one report
  // kind, so one of its two views is the explicit unavailable view.
  const current: { active: CurrentView; tree: CurrentView } =
    currentReport === undefined
      ? { active: CURRENT_UNAVAILABLE_VIEW, tree: CURRENT_UNAVAILABLE_VIEW }
      : input.kind === "current" && input.scope === "tree"
        ? { active: CURRENT_UNAVAILABLE_VIEW, tree: currentView(currentReport) }
        : {
            active: currentView(currentReport),
            tree: CURRENT_UNAVAILABLE_VIEW,
          };
  const payload: Record<string, unknown> = {
    kind: "bundle",
    theme: "light",
    initialScope: input.kind === "current" ? input.scope : "tree",
    capabilities: CAPABILITIES,
    current: {
      active: currentViewProjection(current.active, "active"),
      tree: currentViewProjection(current.tree, "tree"),
    },
    history: sectionProjection({
      kind: "history",
      report: input.kind === "history" ? input.report : UNAVAILABLE_HISTORY,
    }),
    global: sectionProjection({
      kind: "global",
      report: input.kind === "global" ? input.report : UNAVAILABLE_GLOBAL,
    }),
  };
  // The cold-detail notice is a rendering concern; carry it explicitly so the
  // single-section adapter keeps surfacing the same warning as the old script.
  if (currentReport?.walDetail === "expired") {
    payload.walDetail = "expired";
  }
  return payload;
}

/** Renders a self-contained report from shared DTOs only; no source locator or content fields are projected. */
export function renderHtml(input: HtmlReport): string {
  return renderDocument({
    payload: bundlePayloadFromReport(input),
    theme: "light",
    rangeTruncated: false,
  });
}

/**
 * One current view's browser projection. `report` is the only home for every
 * report-derived table and `daily` the only range/chart source; there is no
 * flattened mirror and the browser resolves exactly one path per table.
 */
type CurrentViewProjection = {
  availability: CurrentView["availability"];
  diagnostic?: string;
  scope: Scope;
  /**
   * The tabs this view can render: an unavailable view renders none, so the
   * browser never offers a tab that would open a guaranteed `Unavailable`
   * panel (design §9.3).
   */
  capabilities: readonly string[];
  report?: SessionView;
  /** Precomputed evidence rows for this view; absent when unavailable. */
  evidence?: readonly EvidenceRow[];
  daily?: readonly DailyRow[];
  dailyTruncated?: boolean;
  /**
   * The view's own per-date model rows (Task 5's `datedModels`), so the Models
   * tab filters the same dated evidence the daily rows fold. Absent when the
   * view carries no dated projection at all (the legacy adapter), which is why
   * the Models tab falls back to the aggregate rows and labels them.
   */
  datedModels?: CurrentView["datedModels"];
  modelsTruncated?: boolean;
};

function currentViewProjection(
  view: CurrentView,
  scope: Scope,
): CurrentViewProjection {
  const source = view.report;
  const report = source === undefined ? undefined : sessionView(source);
  return {
    availability: view.availability,
    ...(view.diagnostic === undefined ? {} : { diagnostic: view.diagnostic }),
    scope,
    capabilities:
      view.capabilities ??
      (view.availability === "available" ? CAPABILITIES.current : []),
    ...(report === undefined || source === undefined
      ? {}
      : { report, evidence: sessionEvidenceRows(source, report) }),
    ...(view.daily === undefined
      ? {}
      : { daily: view.daily, dailyTruncated: view.dailyTruncated ?? false }),
    ...(view.datedModels === undefined
      ? {}
      : {
          datedModels: view.datedModels,
          modelsTruncated: view.modelsTruncated ?? false,
        }),
  };
}

/** History/global keep the existing section projection without its `kind`. */
function sectionProjection(input: HtmlReport): Record<string, unknown> {
  const projected = projectReport(input);
  delete projected.kind;
  return projected;
}

/**
 * The one wording ladder for an aggregate's labels. Value availability
 * (`usageUnavailable`) is independent of coverage availability: an all-
 * unavailable session set still has a known inspection size, while a report
 * without `coverage` has values of unknown completeness.
 */
export function aggregateUsageLabels(input: {
  availability: "available" | "unavailable";
  coverage: SessionCoverage | undefined;
}): {
  cost: string;
  tokens: string;
  usageUnavailable: boolean;
  sessions: string;
} {
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
type CoverageProjection = {
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
function coverageProjection(
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
    line: fill(ENGLISH_CATALOG[key as keyof typeof ENGLISH_CATALOG], {
      available: coverage.available,
      inspected: coverage.inspected,
      unavailable: coverage.unavailable,
    }),
  };
}

/**
 * Renders the complete offline Inspector document: both precomputed current
 * views, the history and global sections, and one nav/scope/theme control. It
 * embeds exactly one escaped payload, never fetches, and is byte-identical for
 * identical bundles.
 */
export function renderInspectorBundle(bundle: InspectorBundle): string {
  const payload: Record<string, unknown> = {
    kind: "bundle",
    theme: bundle.theme,
    initialScope: bundle.initialScope,
    // The section table the browser parses a hash with, plus the wider set a
    // selected history session offers (R15). The per-view table below is what it
    // derives the visible tab strip from.
    capabilities: CAPABILITIES,
    current: {
      active: currentViewProjection(bundle.current.active, "active"),
      tree: currentViewProjection(bundle.current.tree, "tree"),
      // Renderer-visible only: the note claims report equality, nothing else.
      sameReportProjection: bundle.current.sameReportProjection,
    },
    history: sectionProjection({ kind: "history", report: bundle.history }),
    global: sectionProjection({ kind: "global", report: bundle.global }),
  };
  const initialView = bundle.current[bundle.initialScope];
  if (initialView.report?.walDetail === "expired") {
    payload.walDetail = "expired";
  }
  // The notice is the only change for a capped view; daily rows are never
  // fabricated or padded to fill the window.
  return renderDocument({
    payload,
    theme: bundle.theme,
    rangeTruncated: initialView.dailyTruncated === true,
  });
}

/** Optional token fields stay absent unless an input observed them. */
function safeUsage(usage: NonNullable<SessionReport["usage"]>): SafeUsage {
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

/**
 * The legacy pre-attribution bucketing of raw report records (spec §5.4, the
 * one documented exception): it dates records itself instead of folding the
 * session's own dated projection, and only the no-production-caller
 * single-section adapter still calls it. The bundle path uses
 * `buildDailyRows` over the published projection.
 */
export function buildDailyActivityRows(
  reports: readonly SessionReport[],
): DailyRow[] {
  const rows = new Map<string, DailyAccumulator>();
  const at = (date: string): DailyAccumulator => {
    const existing = rows.get(date);
    if (existing !== undefined) return existing;
    const created: DailyAccumulator = {
      date,
      sessionIds: new Set(),
      totalTokens: 0,
      cost: 0,
      generations: 0,
      tools: 0,
      composition: {
        generations: { totalTokens: 0, cost: 0 },
        toolResults: { totalTokens: 0, cost: 0 },
        compactions: { totalTokens: 0, cost: 0 },
        branchSummaries: { totalTokens: 0, cost: 0 },
      },
    };
    rows.set(date, created);
    return created;
  };
  for (const report of reports) {
    for (const generation of report.generations) {
      const date = utcDate(generation.timestamp);
      if (date === undefined) continue;
      const row = at(date);
      row.sessionIds.add(report.sessionId);
      row.generations += 1;
      addDailyUsage(row, generation.usage, "generations");
    }
    for (const tool of report.tools) {
      const date = utcDate(tool.timestamp);
      if (date === undefined) continue;
      const row = at(date);
      row.sessionIds.add(report.sessionId);
      row.tools += 1;
      if (tool.usage !== undefined)
        addDailyUsage(row, tool.usage, "toolResults");
    }
    for (const compaction of report.compactions) {
      const date = utcDate(compaction.timestamp);
      if (date === undefined) continue;
      const row = at(date);
      row.sessionIds.add(report.sessionId);
      addDailyUsage(
        row,
        compaction.usage,
        compaction.kind === "branch_summary"
          ? "branchSummaries"
          : "compactions",
      );
    }
  }
  return [...rows.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((row) => ({
      date: row.date,
      sessions: row.sessionIds.size,
      totalTokens: row.totalTokens,
      cost: row.cost,
      generations: row.generations,
      tools: row.tools,
      composition: row.composition,
    }));
}

type DailyAccumulator = {
  date: string;
  sessionIds: Set<string>;
  totalTokens: number;
  cost: number;
  generations: number;
  tools: number;
  composition: DailyRow["composition"];
};

function addDailyUsage(
  row: DailyAccumulator,
  usage: SafeUsage,
  part: keyof DailyRow["composition"],
): void {
  row.totalTokens += usage.totalTokens;
  row.cost = roundCost(row.cost + usage.cost);
  row.composition[part].totalTokens += usage.totalTokens;
  row.composition[part].cost = roundCost(
    row.composition[part].cost + usage.cost,
  );
}

/** Earliest to latest native record span; fewer than two records is unknown. */
export function sessionSpanMs(report: SessionReport): number | undefined {
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

export function formatDuration(ms: number): string {
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
  /** The maximum persisted call timestamp; fixed-width UTC sorts by string. */
  lastUsed: string;
};

/**
 * The summary view: `view.tools` grouped by tool name, one row per name, sorted
 * by name (design §7.6). `calls` is the set the caller selected, so a range
 * filter narrows the summary and its counts together; `lastUsed` is the maximum
 * persisted call timestamp of that selected set (range-filtered like the counts,
 * §5.2) and `source` the first known label of that name, which is a static
 * inventory fact and not a range figure. A call with no persisted usage
 * contributes to `calls` and never to `tokens`, `cost`, or `withUsage`.
 */
export function toolSummary(view: {
  tools?: readonly ToolCallRow[];
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
    if (row.timestamp > group.lastUsed) group.lastUsed = row.timestamp;
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
 * family. The template and the fill value are returned separately so the
 * browser fills the one catalog entry the tests read; the raw `tool:call_…` id
 * is never a headline. Exported and inlined, so the browser and the tests run
 * the same rule (see `INLINED_FUNCTIONS`).
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
 * The bounded message a row may render, or `null` for `Unavailable`. A tool
 * error has no safe structured message at all (design §7.5-4), so a row for one
 * is `null` whatever it carries; a generation error renders the persisted
 * bounded redacted `errorMessage` when present. No text is ever taken from
 * `content`, tool output, arguments, or child output. Exported and inlined, so
 * the browser and the tests run the same rule.
 */
export function errorMessage(row: {
  kind: string;
  message?: string;
}): string | null {
  if (row.kind === "tool-error") return null;
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

function sessionView(report: SessionReport): SessionView {
  const durationMs = sessionSpanMs(report);
  const dates = reportDates(report);
  return {
    sessionId: report.sessionId,
    ...(report.usage === undefined ? {} : { usage: safeUsage(report.usage) }),
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

function fill(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    String(values[key] ?? match),
  );
}

function sessionEvidenceRows(
  report: SessionReport,
  view: SessionView,
): EvidenceRow[] {
  const timedTools = report.tools.filter(
    (tool) => tool.durationMs !== undefined,
  ).length;
  const rows: EvidenceRow[] = [
    {
      source: ENGLISH_CATALOG["evidence.piRecords"],
      observation: fill(ENGLISH_CATALOG["evidence.piRecords.detail"], {
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
          ? fill(ENGLISH_CATALOG["evidence.toolTiming.detail"], {
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
          ? `${fill(ENGLISH_CATALOG["evidence.child.detail"], {
              count: report.agents.length,
            })} · ${fill(ENGLISH_CATALOG["agents.usageFraction"], {
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
      observation: fill(ENGLISH_CATALOG["evidence.errors.detail"], {
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

function historyEvidenceRows(history: HistoryReport): EvidenceRow[] {
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
      observation: fill(ENGLISH_CATALOG["evidence.history.sessions"], {
        available: available.length,
        total: history.sessions.length,
      }),
      confidence: available.length > 0 ? "native" : "unavailable",
    },
    {
      source: ENGLISH_CATALOG["evidence.span"],
      observation: fill(ENGLISH_CATALOG["evidence.history.span"], {
        count: spans,
      }),
      confidence: spans > 0 ? "native" : "unavailable",
    },
    {
      source: ENGLISH_CATALOG["evidence.child"],
      observation: fill(ENGLISH_CATALOG["evidence.history.child"], {
        count: childSessions,
      }),
      confidence: childSessions > 0 ? "cooperative" : "unavailable",
    },
    {
      source: ENGLISH_CATALOG["evidence.integration"],
      observation: fill(ENGLISH_CATALOG["evidence.history.integrations"], {
        count: integrations.size,
      }),
      confidence: integrations.size > 0 ? "supported" : "unavailable",
    },
    {
      source: ENGLISH_CATALOG["evidence.errors"],
      observation: fill(ENGLISH_CATALOG["evidence.history.errors"], {
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

function globalEvidenceRows(report: GlobalReport): EvidenceRow[] {
  const replayed = report.sessions.filter(
    (session) => session.availability === "available",
  ).length;
  return [
    {
      source: ENGLISH_CATALOG["evidence.piRecords"],
      observation: fill(ENGLISH_CATALOG["evidence.global.days"], {
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

function historyEntry(
  session: HistoryReport["sessions"][number],
): HistoryEntry {
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

function projectReport(input: HtmlReport): Record<string, unknown> {
  if (input.kind === "current") {
    const view = sessionView(input.report);
    const daily = buildDailyActivityRows([input.report]);
    return {
      kind: "current",
      scope: input.scope,
      ...(input.report.walDetail === "expired"
        ? { walDetail: "expired" as const }
        : {}),
      daily,
      chartMetrics: SESSION_CHART_METRICS,
      evidence: sessionEvidenceRows(input.report, view),
      report: view,
    };
  }
  if (input.kind === "history") {
    // R19: the aggregate folds the sessions' own dated rows. It never walks a
    // session timestamp and it never looks complete while a contributing
    // window is partial (spec §5.4).
    const contributions: DailyContribution[] = input.report.sessions.flatMap(
      (session) =>
        session.availability === "available"
          ? [
              {
                sessionId: session.sessionId,
                rows: session.usageByDate,
                truncated: session.usageByDateTruncated,
              },
            ]
          : [],
    );
    const folded = buildDailyRows(contributions);
    const daily = folded.rows;
    return {
      kind: "history",
      availability: input.report.availability,
      coverage: coverageProjection(
        input.report.availability,
        input.report.coverage,
      ),
      usageLabels: aggregateUsageLabels({
        availability: input.report.availability,
        coverage: input.report.coverage,
      }),
      daily,
      dailyTruncated: folded.truncated,
      chartMetrics: SESSION_CHART_METRICS,
      evidence: historyEvidenceRows(input.report),
      sessions: input.report.sessions.map(historyEntry),
    };
  }
  const daily = input.report.dates.map((row) => ({
    date: row.date,
    sessions: row.sessions,
    totalTokens: row.usage.totalTokens,
    cost: row.usage.cost,
  }));
  // The loader folds the sessions' own dated rows into `dates`; a session whose
  // window cannot represent its spend still makes the aggregate partial.
  const dailyTruncated = input.report.sessions.some(
    (session) =>
      session.availability === "available" &&
      session.usageByDateTruncated === true,
  );
  return {
    kind: "global",
    availability: input.report.availability,
    coverage: coverageProjection(
      input.report.availability,
      input.report.coverage,
    ),
    usageLabels: aggregateUsageLabels({
      availability: input.report.availability,
      coverage: input.report.coverage,
    }),
    daily,
    dailyTruncated,
    chartMetrics: GLOBAL_CHART_METRICS,
    evidence: globalEvidenceRows(input.report),
    usage: safeUsage(input.report.usage),
    composition: {
      available: false,
      parts: [],
      total: safeUsage(input.report.usage),
      reconciles: false,
    },
    trackedSessions: input.report.sessions.length,
    unavailableSessions: input.report.sessions.filter(
      (session) => session.availability === "unavailable",
    ).length,
  };
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function roundCost(value: number): number {
  return Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
}

/**
 * The client script's directive prologue. It stays the script's first statement
 * and the inlined modules follow it, so the runtime keeps strict mode.
 */
const BUNDLE_DIRECTIVE = '"use strict";\n';

const BUNDLE_SCRIPT = String.raw`
const data=JSON.parse(document.getElementById("report-data").textContent), t=JSON.parse(document.getElementById("catalog-data").textContent);
// SVG namespace identifier only; it is never fetched, so the report stays network-free.
const SVG_NS="http:"+"//www.w3.org/2000/svg";
const CURRENT_METRICS=["sessions","cost","tokens","generations","tools"];
const GLOBAL_METRICS=["sessions","cost","tokens"];
const CHART_LABELS={sessions:"chart.sessions",cost:"chart.cost",tokens:"chart.tokens",generations:"chart.generations",tools:"chart.tools"};
const PRESENCE_LABELS={present:"presence.present",absent:"presence.absent",unknown:"presence.unknown"};
const q=id=>document.getElementById(id);
const text=value=>String(value===null||value===undefined?"":value);
const number=value=>new Intl.NumberFormat("en").format(Number(value||0));
const money=value=>"$"+Number(value||0).toFixed(2);
const tr=(key,values)=>text(t[key]).replace(/\{(\w+)\}/g,(match,key)=>text((values||{})[key]));
const el=(name,cls,value)=>{const node=document.createElement(name);if(cls)node.className=cls;if(value!==undefined)node.textContent=value;return node;};
const badge=(value,tone)=>el("span","badge "+(tone||"neutral"),value);
const confidenceTone=value=>value==="native"||value==="live"||value==="cooperative"||value==="supported"?"":(value==="inferred"?"warn":"neutral");
const orUnavailable=value=>(value===null||value===undefined)?tr("evidence.unavailable"):text(value);
const numberOrUnavailable=value=>(value===null||value===undefined)?tr("evidence.unavailable"):number(value);
const presenceBadge=value=>badge(tr(PRESENCE_LABELS[value]||"presence.unknown"),value==="absent"?"warn":"neutral");
// The payload's capability table (design §9.3): the tabs each section may
// render, plus the wider set a selected history session offers. A hand-built
// payload without the key degrades to no tabs, never to a guess.
const CAPS=data.capabilities||{};
const tabsOf=value=>Array.isArray(value)?value:[];
// The widest table a hash is parsed with. Derivation uses the state table below,
// so a tab this document cannot render is coerced (never silently kept).
const parseCapabilities=()=>({current:tabsOf(CAPS.current),history:tabsOf(CAPS.historySession!==undefined?CAPS.historySession:CAPS.history),global:tabsOf(CAPS.global)});
// The APPLIED route (design §9.1): the one navigation state. It is written only
// by navigate() and applyLocation(); every rendered value is derived from it by
// render(), so no control ever holds state of its own.
let state={section:"current",tab:"overview",scope:data.initialScope};
// What the applied hash itself said when derivation had nothing to add; only a
// "range-restored" code is produced by a raw hash (design §9.2).
let stateNotice=undefined;
// The canonical key of the applied route, so a navigation the browser reports
// twice (hashchange and popstate) renders once.
let lastAppliedKey="";
// The derived view the current render writes from; render() is its only writer.
let view=null;
// One unresolved range intent per view identity: "current" is shared by both
// scopes, history is split between its aggregate and each session. The ACTIVE
// identity's range lives in the route; these are the ephemeral memories of the
// identities a route does not carry (design §5.3) and never reach a deep link.
const rangeIntents={};
// One selected tool name per view identity: that identity's calls view narrows
// to it and the clear-filter control returns every call. A filter is per-table
// state of the view it was chosen in, never a figure another view inherits.
const toolFilters={};
// Per-(identity, tab) settings of the views this document is not showing (design
// §9.5): the active table's query and sort live in the route, everything else —
// the Environment sub-section, the chart metric, the leaving table's settings —
// is ephemeral and dies with the document.
const viewSettings={};
const currentView=()=>data.current[state.scope];
const currentReport=()=>{const view=currentView();return view&&view.availability==="available"?view.report:null;};
const historySessions=()=>data.history.sessions||[];
// A session entry by the id the route carries; anything else is no selection.
const sessionEntry=route=>{const r=route||state;if(r.section!=="history"||typeof r.session!=="string")return null;const list=historySessions();for(let index=0;index<list.length;index++){const entry=list[index];if(entry&&entry.sessionId===r.session)return entry;}return null;};
const selectedSession=()=>sessionEntry(state);
const viewIdentity=(route)=>{const r=route||state;return r.section==="history"?(typeof r.session==="string"?"history:"+r.session:"history:aggregate"):r.section;};
const activeSection=()=>view!==null?view.activeSection:state.section;
const activeTab=()=>view!==null?view.activeTab:state.tab;
// The active table's own state, which the route carries (§9.5).
const routeTable=()=>state.table||{};
const activeQuery=()=>typeof routeTable().query==="string"?routeTable().query:"";
const activeSort=()=>typeof routeTable().sort==="string"?routeTable().sort:"default";
// The settings of the active (identity, tab): the two the route does not carry.
const settingsKey=(route)=>{const r=route||state;return viewIdentity(r)+"/"+r.tab;};
const activeSettings=()=>viewSettings[settingsKey()]||{};
// The Environment sub-section a route entity names, when it names one: the
// destination of an inventory link is the sub-section that lists that row.
const entityEnvTab=()=>{const entity=state.entity;return entity===undefined?undefined:entity.kind==="command"?"commands":entity.kind==="skill"?"skills":entity.kind==="resource"?"resources":undefined;};
const activeEnvTab=()=>entityEnvTab()||activeSettings().envTab||"commands";
const activeMetric=()=>activeSettings().metric||activeMetrics()[0]||"sessions";
const activeToolFilter=()=>toolFilters[viewIdentity()]||null;
// The range intent the APPLIED route carries: the route is the only source, so a
// restore claim is about this navigation, never a cached memory of another one.
const activeIntent=()=>state.range;
// The view's own observed dates, taken from the projection that view renders.
const routeDaily=route=>{const r=route||state;if(r.section==="current"){const current=data.current[r.scope];return (current&&current.daily)||[];}if(r.section==="global")return data.global.daily||[];const session=sessionEntry(r);if(session)return session.availability==="available"?(session.usageByDate||[]).map(row=>({...row,sessions:1})):[];return data.history.daily||[];};
const activeDaily=()=>routeDaily(state);
const rangeDates=()=>activeDaily().map(row=>row.date);
// The one range the active view renders: the derived view resolved the route's
// intent against this view's own dates, never the machine clock.
const activeRange=()=>view!==null?view.range:undefined;
const period=()=>activeRange()||{preset:null,from:"",to:""};
const rangeText=()=>{const range=activeRange();return range?range.from+" → "+range.to:tr("evidence.unavailable");};

function chartValue(row,metric){if(metric==="cost")return row.cost;if(metric==="tokens")return row.totalTokens;if(metric==="generations")return row.generations||0;if(metric==="tools")return row.tools||0;return row.sessions;}
function chartText(metric,value){return metric==="cost"?money(value):number(value);}
function chartLabel(metric){return tr(CHART_LABELS[metric]);}
function selectedDays(){return activeDaily().filter(row=>row.date>=period().from&&row.date<=period().to);}
function tokenCell(usage,key){return orUnavailable(usage[key]);}
const activeMetrics=()=>activeSection()==="current"?CURRENT_METRICS:(activeSection()==="history"?(data.history.chartMetrics||CURRENT_METRICS):(data.global.chartMetrics||GLOBAL_METRICS));
const COMPOSITION_PARTS=["generations","toolResults","compactions","branchSummaries"];
// The period label every widget that is not range-filtered has to carry.
const ALL_DATES=" · "+tr("panel.allDates");
// The one range filter every range-aware widget reads (design §5.2/§5.4). The
// dated model rows come from the caller's source argument, never from the view:
// a SessionView carries no dated rows. Tools, agents and errors filter their own
// canonical rows by their own time field (§5.7), so a row without a usable date
// is never in range. A view with no resolved range returns null.
function filteredView(view,source){const range=activeRange();if(!range)return null;return filterView({rows:[],models:(source&&source.datedModels)||[],tools:(view&&view.tools)||[],agents:(view&&view.agents)||[],errors:(view&&view.errors)||[]},range);}
// The one dated-source shape the Models tab reads: a payload's own dated model
// rows, or undefined when it carries none (the legacy adapter).
function datedSource(view){return view.datedModels===undefined?undefined:{datedModels:view.datedModels,modelsTruncated:view.modelsTruncated===true};}
// The in-range sums of a view's own dated rows (design §5.2).
function periodTotals(rows,range){const t={totalTokens:0,cost:0,generations:0,tools:0,days:0,parts:{}};COMPOSITION_PARTS.forEach(key=>{t.parts[key]={totalTokens:0,cost:0}});rows.forEach(row=>{if(!isInRange(row.date,range))return;t.days+=1;t.totalTokens+=row.totalTokens||0;t.cost+=row.cost||0;t.generations+=row.generations||0;t.tools+=row.tools||0;COMPOSITION_PARTS.forEach(key=>{const part=row.composition&&row.composition[key];if(!part)return;t.parts[key].totalTokens+=part.totalTokens;t.parts[key].cost+=part.cost})});t.cost=Math.round(t.cost*1e12)/1e12;return t;}
function periodComposition(t){const parts=COMPOSITION_PARTS.map(key=>({key:key,totalTokens:t.parts[key].totalTokens,cost:t.parts[key].cost,confidence:"native"})),tokens=parts.reduce((sum,part)=>sum+part.totalTokens,0),cost=Math.round(parts.reduce((sum,part)=>sum+part.cost,0)*1e12)/1e12;return {available:true,parts:parts,total:{totalTokens:t.totalTokens,cost:t.cost},reconciles:tokens===t.totalTokens&&cost===t.cost};}
// A range reaching before a retained window the view cannot restore is flagged.
// Every section's notice reads this one comparison (design §5.1).
function reachesBeforeRetained(rows,range){return historyRowRange({usageByDate:rows||[],usageByDateTruncated:true},range).partial===true;}
function rangeTruncated(){const range=activeRange();if(!range)return false;if(activeSection()==="current"){const current=currentView();return !!current&&current.dailyTruncated===true&&reachesBeforeRetained(current.daily,range);}if(activeSection()==="global")return data.global.dailyTruncated===true&&reachesBeforeRetained(data.global.daily,range);const session=selectedSession();if(session)return session.availability==="available"&&!!(session.usageByDate||[]).length&&historyRowRange(session,range).partial===true;return partialContribution(range);}
// A restore claim needs a view with observed dates: with none, no range — and no default — exists.
function syncRangeNotice(){const text=activeIntent()!==undefined&&!activeRange()&&latestObservedDate(activeDaily().map(row=>row.date))!==undefined?tr("range.restored"):(rangeTruncated()?tr(state.section==="current"?"range.truncated":"history.dailyTruncated"):"");let notice=q("range-truncated");if(!text){if(notice)notice.hidden=true;return;}if(!notice){notice=el("p","range-note",text);notice.id="range-truncated";q("time-range").append(notice);}notice.textContent=text;notice.hidden=false;}
// An aggregate row's range verdict (design §5.6): membership needs an in-range
// retained row, never a span overlap; omitted history is unknown, never zero.
function inPeriodRow(entry,range){if(!entry||entry.availability!=="available"||!range||!(entry.usageByDate||[]).length)return {group:"unknown"};const verdict=historyRowRange(entry,range);if(verdict.member)return {group:"member",verdict:verdict};return {group:verdict.partial?"unknown":"out"};}
function historyMetrics(members){let totalTokens=0,cost=0,partial=false;members.forEach(item=>{partial=partial||item.verdict.partial;totalTokens+=item.verdict.totalTokens;cost+=item.verdict.cost});return {totalTokens:totalTokens,cost:Math.round(cost*1e12)/1e12,sessions:members.length,partial:partial};}
function historyRows(){const range=activeRange(),members=[],unknown=[];historySessions().forEach(entry=>{const row=inPeriodRow(entry,range);if(row.group==="member")members.push({entry:entry,verdict:row.verdict});else if(row.group==="unknown")unknown.push({entry:entry})});return {members:members,unknown:unknown};}
// Any contributing session whose retained window cannot represent this range.
function partialContribution(range){return historySessions().some(entry=>!!entry&&entry.availability==="available"&&!!(entry.usageByDate||[]).length&&historyRowRange(entry,range).partial===true);}
function knownValue(value,key,note){const node=el("span","",value+" ");node.append(badge(tr(key),"warn"));if(note)node.append(el("small","",note));return node;}
/** The search and sort text of one cell; an id column's descriptor reads its content. */
function cellText(cell){if(cell!==null&&typeof cell==="object"&&typeof cell.fullId==="string")cell=cell.content;return cell instanceof Node?text(cell.textContent):text(cell);}
// One table's column classes (design §16): one entry per header, applied to that
// column's header and every one of its cells. The classes ARE the table's
// alignment and whitespace rules, so a table now says per column what it used to
// inherit from the document. An "id-cell" column is opaque: its cells carry the
// id they show and a copy control.
function columnClass(classes,index){return classes&&classes[index]?classes[index]:"";}
// One opaque id's cell in an id column: the value the column truncates and its
// copy control copies, plus the content the cell renders (the history table shows
// the session's dates beside the id, the ledger shows the id alone). A plain value
// in an id column is its own id.
function idValue(fullId,content){return {fullId:text(fullId),content:content};}
// One opaque id's copy control: a real button, so Enter and Space work and the
// shared focus ring applies, labelled with the id it names. It copies the id the
// cell already shows (data-full-id="<id>", set from the rendered value) and never
// re-reads the report payload.
function copyControl(fullId){const button=el("button","copy-id",tr("table.copyId"));button.dataset.copyId="true";button.setAttribute("aria-label",tr("table.copyId")+" "+fullId);return button;}
// A copy is the browser's to refuse (an insecure context has no clipboard at all)
// and the document is observer-only, so a refused write is swallowed: the id stays
// visible, selectable and named by the control either way.
function copyId(button){const cell=button.closest("[data-full-id]"),value=cell===null?"":text(cell.dataset.fullId);if(value===""||typeof navigator==="undefined"||!navigator.clipboard||typeof navigator.clipboard.writeText!=="function")return;navigator.clipboard.writeText(value).catch(()=>{});}
function card(title,subtitle,right){const node=el("section","card"),head=el("div","panel-head"),copy=document.createElement("div");copy.append(el("h2","",title),el("p","",subtitle));head.append(copy);if(right)head.append(right);node.append(head);return node;}
function simpleTable(section,headers,rows,classes){const wrap=el("div","table-wrap"),node=document.createElement("table"),head=document.createElement("thead"),headRow=document.createElement("tr"),body=document.createElement("tbody");headers.forEach((value,index)=>headRow.append(el("th",columnClass(classes,index),value)));head.append(headRow);rows.forEach(row=>{const rowNode=document.createElement("tr"),perColumn=row.length===headers.length;row.forEach((value,index)=>{const cell=document.createElement("td"),className=perColumn?columnClass(classes,index):"",opaque=className==="id-cell"&&value!==null&&typeof value==="object"&&typeof value.fullId==="string",content=opaque?value.content:value;cell.className=className;if(content instanceof Node)cell.append(content);else cell.textContent=text(content);if(className==="id-cell"){const fullId=opaque?text(value.fullId):cellText(content);cell.setAttribute("data-full-id",fullId);cell.append(copyControl(fullId));}rowNode.append(cell);});body.append(rowNode);});node.append(head,body);wrap.append(node);section.append(wrap);return section;}
function table(title,subtitle,headers,rows,classes,before){const section=card(title,subtitle);if(before)section.append(before);const toolbar=el("div","toolbar"),searchLabel=el("label","",tr("search")),search=document.createElement("input"),sortLabel=el("label","",tr("sort")),sort=document.createElement("select");search.id="search";search.type="search";search.value=activeQuery();search.placeholder=tr("search.placeholder");sort.id="sort";[["default","sort.default"],["name","sort.name"],["reverse","sort.reverse"]].forEach(item=>{const option=el("option","",tr(item[1]));option.value=item[0];option.selected=activeSort()===item[0];sort.append(option);});searchLabel.append(search);sortLabel.append(sort);toolbar.append(searchLabel,sortLabel);section.append(toolbar);const query=activeQuery().toLowerCase(),order=activeSort();let shown=rows.filter(row=>row.map(cellText).join(" ").toLowerCase().includes(query));if(order==="name")shown=shown.slice().sort((left,right)=>cellText(left[0]).localeCompare(cellText(right[0]),"en"));if(order==="reverse")shown=shown.slice().reverse();return simpleTable(section,headers,shown,classes);}
function metric(title,value,note,details){const node=el("section","card metric");node.append(el("div","muted",title),el("div","value mono",value),el("small","",note));const block=el("div","breakdown");(details||[]).forEach(item=>{const row=el("div","breakdown-row");row.append(el("span","",item[0]),el("span","mono",text(item[1])));block.append(row);});node.append(block);return node;}
function bars(title,subtitle,rows,kind){const section=card(title,subtitle,badge(tr("evidence.native"),"")),body=el("div","bars");if(rows.length===0)body.append(el("p","muted",tr("bars.empty")));rows.forEach(item=>{const row=el("div","bar"),label=el("div","bar-label");label.append(kind?linkRow(kind,item.label,item.label,"mono"):el("span","mono",item.label),el("span","mono",item.value));const track=el("div","track"),fill=el("div","fill");fill.style.width=item.percent+"%";track.append(fill);row.append(label,track);body.append(row);});section.append(body);return section;}
function emptyCard(title,note,eyebrowKey){const section=el("section","card empty");section.append(el("p","eyebrow",tr(eyebrowKey)),el("h2","",title),el("p","",note));return section;}
function unavailableSection(title,reason){return emptyCard(title,reason,"evidence.unavailable");}
function coveragePanel(section){const coverage=section.coverage,labels=section.usageLabels,line=coverage&&coverage.line?coverage.line:tr(labels.sessions),node=card(tr("coverage.title"),line);if(coverage&&coverage.reasons)node.append(el("div","footnote",tr("coverage.reasons",{reasons:coverage.reasons})));return node;}
function compositionCard(composition,subtitle){if(!composition.available)return unavailableSection(tr("usage.title"),tr("unavailable.composition"));const section=card(tr("usage.title"),subtitle||tr("usage.note"),badge(composition.reconciles?tr("usage.reconciled"):tr("usage.unreconciled"),composition.reconciles?"":"warn")),rows=composition.parts.map(part=>[tr("metric.usage."+part.key),number(part.totalTokens),money(part.cost),badge(tr("evidence."+part.confidence),confidenceTone(part.confidence))]);rows.push([tr("usage.total"),number(composition.total.totalTokens),money(composition.total.cost),badge(tr("evidence.native"),"")]);return simpleTable(section,[tr("table.source"),tr("table.tokens"),tr("table.cost"),tr("table.confidence")],rows,["wrap","num","num","status-cell"]);}
function evidencePanel(evidence){const section=card(tr("panel.evidence"),tr("evidence.note"),badge(tr("evidence.source"),"neutral"));return simpleTable(section,[tr("table.source"),tr("table.observation"),tr("table.confidence")],evidence.map(row=>[row.source,row.observation,badge(row.confidence,confidenceTone(row.confidence))]),["status-cell","wrap","status-cell"]);}
function currentEvidence(){const view=data.current[state.scope];return (view&&view.evidence)||[];}
function activeEvidence(){if(activeSection()==="current")return currentEvidence();if(activeSection()==="history")return data.history.evidence||[];return data.global.evidence||[];}
function chart(){const rows=selectedDays(),label=chartLabel(activeMetric()),section=card(tr("panel.daily"),rangeText()),select=document.createElement("select");select.id="chart-metric";select.setAttribute("aria-label",tr("chart.metric"));activeMetrics().forEach(value=>{const option=el("option","",chartLabel(value));option.value=value;option.selected=activeMetric()===value;select.append(option);});section.querySelector(".panel-head").append(select);if(rows.length===0){section.append(el("div","chart-note",tr("chart.empty")));return section;}const values=rows.map(row=>chartValue(row,activeMetric())),maximum=Math.max.apply(null,values.concat([1])),firstDate=Date.parse(rows[0].date+"T00:00:00Z"),lastDate=Date.parse(rows[rows.length-1].date+"T00:00:00Z"),span=lastDate-firstDate,points=rows.map((row,index)=>{const x=span<=0?400:8+((Date.parse(row.date+"T00:00:00Z")-firstDate)/span)*784;return {x:x,y:172-(values[index]/maximum)*164,row:row,value:values[index]};}),chartNode=el("div","chart"),axis=el("div","chart-axis");axis.setAttribute("aria-hidden","true");[maximum,maximum/2,0].forEach(value=>axis.append(el("span","",chartText(activeMetric(),value))));const svg=document.createElementNS(SVG_NS,"svg");svg.setAttribute("class","line-chart");svg.setAttribute("viewBox","0 0 800 180");svg.setAttribute("preserveAspectRatio","none");svg.setAttribute("role","img");svg.setAttribute("aria-label",tr("chart.aria",{metric:label,days:rows.length}));[8,90,172].forEach(y=>{const line=document.createElementNS(SVG_NS,"line");line.setAttribute("class","chart-grid");line.setAttribute("x1","8");line.setAttribute("x2","792");line.setAttribute("y1",String(y));line.setAttribute("y2",String(y));svg.append(line);});const polyline=document.createElementNS(SVG_NS,"polyline");polyline.setAttribute("class","activity-line");polyline.setAttribute("points",points.map(point=>point.x.toFixed(2)+","+point.y.toFixed(2)).join(" "));svg.append(polyline);points.forEach(point=>{const circle=document.createElementNS(SVG_NS,"circle");circle.setAttribute("class","line-point");circle.setAttribute("cx",point.x.toFixed(2));circle.setAttribute("cy",point.y.toFixed(2));circle.setAttribute("r","3");const title=document.createElementNS(SVG_NS,"title");title.textContent=point.row.date+" · "+chartText(activeMetric(),point.value);circle.append(title);svg.append(circle);});chartNode.append(axis,svg,el("div","chart-dates",rows[0].date+" → "+rows[rows.length-1].date));section.append(chartNode,el("div","chart-note",tr("chart.note",{metric:label})));const details=document.createElement("details"),summary=el("summary","",tr("chart.data")),headers=[tr("table.date"),tr("table.sessions"),tr("table.tokens"),tr("table.cost")],classes=["status-cell","num","num","num"],withGenerations=activeMetrics().indexOf("generations")>=0,withTools=activeMetrics().indexOf("tools")>=0;if(withGenerations){headers.push(tr("table.generations"));classes.push("num");}if(withTools){headers.push(tr("table.tools"));classes.push("num");}const tableRows=rows.map(row=>{const cells=[row.date,number(row.sessions),number(row.totalTokens),money(row.cost)];if(withGenerations)cells.push(number(row.generations));if(withTools)cells.push(number(row.tools));return cells;});details.append(summary);simpleTable(details,headers,tableRows,classes);section.append(details);return section;}
function overview(view){if(view.usage===undefined)return unavailableSection(tr("usage.title"),tr("unavailable.usage"));const range=activeRange(),totals=range?periodTotals(activeDaily(),range):null;if(!totals||totals.days===0)return emptyOverview();const partial=rangeTruncated(),cost=money(totals.cost),tokens=number(totals.totalTokens),metrics=el("div","metrics");metrics.append(metric(tr(partial?"metric.knownCost":"metric.cost"),cost,tr("metric.native"),[[tr("evidence.native"),cost],[tr("metric.child")+ALL_DATES,view.agentCount===null?tr("evidence.unavailable"):number(view.agentCount)+" · "+tr("metric.child.note")]]),metric(tr(partial?"metric.knownTokens":"metric.tokens"),tokens,tr("metric.tokens.note"),[[tr("metric.input")+ALL_DATES,tokenCell(view.usage,"inputTokens")],[tr("metric.output")+ALL_DATES,tokenCell(view.usage,"outputTokens")],[tr("metric.cacheRead")+ALL_DATES,tokenCell(view.usage,"cacheReadTokens")],[tr("metric.cacheWrite")+ALL_DATES,tokenCell(view.usage,"cacheWriteTokens")],[tr("usage.total"),tokens]]),metric(tr("metric.generations"),number(totals.generations),tr("metric.generations.note"),[[tr("evidence.native"),number(view.generationCount)+ALL_DATES]]),metric(tr("metric.tools"),number(view.toolCount),tr("metric.tools.note")+ALL_DATES,[[tr("evidence.native"),number(view.toolCount)]]),metric(tr("metric.duration"),orUnavailable(view.durationLabel),tr("metric.duration.note")+ALL_DATES,[[tr("evidence.native"),view.span?view.span.from+" → "+view.span.to:tr("evidence.unavailable")]]));const grid=el("div","grid");grid.append(bars(tr("panel.models"),tr("models.note")+ALL_DATES,view.modelBars,"model"),bars(tr("panel.tools"),tr("tools.bars.note")+ALL_DATES,view.toolBars,"tool"));const all=el("div","");all.append(metrics,grid,compositionCard(totals&&activeDaily().some(row=>row.composition)?periodComposition(totals):view.composition,totals&&activeDaily().some(row=>row.composition)?null:tr("usage.note")+ALL_DATES),evidencePanel(activeEvidence()));return all;}
// A selected range with no in-range observation renders the empty state: never
// a clamped window, never a fabricated zero (design §5.5-4).
// The one range-qualified empty state: a selected range with no in-range observation.
function rangeEmpty(){return unavailableSection(tr("usage.title"),tr("chart.empty"));}
function emptyOverview(){const node=el("div","");node.append(rangeEmpty(),evidencePanel(activeEvidence()));return node;}
// Child-run metrics: the closed status enum's buckets in one fixed order, so
// every run is counted in exactly one bucket and none is dropped or folded.
const AGENT_STATUS_BUCKETS=["succeeded","failed","interrupted","running","unknown"];
// The run ids a parent may resolve to: every projection of this same session the
// document carries, never another session's runs. The sibling projection is a
// current-section lookup (active path vs full tree, §7.4's middle verdict); a
// history session detail carries exactly one report, which IS the rendered view,
// so the loop below already contributes its own ids and no branch is needed.
function sameSessionAgentIds(view){const ids=new Set(),add=candidate=>{const projection=candidate&&candidate.availability==="available"?candidate.report:null;if(!projection||projection.sessionId!==view.sessionId)return;(projection.agents||[]).forEach(run=>{ids.add(run.id)});};if(activeSection()==="current"){add(data.current.active);add(data.current.tree);}(view.agents||[]).forEach(run=>{ids.add(run.id)});return ids;}
// Parent resolution (spec §7.4): a parent the selected projection resolves is an
// anchor to that run, labelled with the run's own role label or, when the
// producer published no role, the bounded Unavailable — never the bare opaque
// id; a parent the selected projection excludes is labelled and never linked, and
// an id nothing knows stays Unavailable.
function parentCell(row,rendered,known){if(row.parentId===null)return tr("evidence.unavailable");const parent=rendered[row.parentId];if(parent)return linkRow("agent",row.parentId,orUnavailable(parent.agent));return known.has(row.parentId)?tr("agents.parentOutsideScope"):tr("agents.parentUnknown");}
// Why a range-filtered run set can be empty: a run with no observed time cannot
// be placed in any range, and a dated run outside the range is not a data gap.
function agentRangeNote(view){const undated=view.agents.filter(run=>!run.observedAt).length;if(undated===0)return tr("agents.outOfRange");if(undated===view.agents.length)return tr("agents.undated");return tr("agents.undatedAndOutOfRange");}
// Role, status, model, tokens, cost, artifacts and parent verdict, in the fixed
// column order. The role cell is the row's entity identity, so an entity link
// into this tab lands on the run it named. Child model and thinking stay
// metadata: there is no Agent -> Models link, and thinking is shown by the row's
// own detail, never as a link.
function agentRunCells(rows,known){const rendered={};rows.forEach(run=>{rendered[run.id]=run;});return rows.map(row=>[entitySpan("agent",row.id,orUnavailable(row.agent)),badge(tr("agents."+row.status),row.status==="failed"||row.status==="interrupted"?"warn":"neutral"),orUnavailable(row.model),row.usage?number(row.usage.totalTokens):tr("evidence.unavailable"),row.usage?money(row.usage.cost):tr("evidence.unavailable"),orUnavailable(row.artifacts),parentCell(row,rendered,known)]);}
// The child-run summary is drawn from the rows being rendered, so a range filter
// narrows the counts and the fraction instead of reusing a full-session figure.
// Usage stays a breakdown: no rendered run reporting usage makes tokens and cost
// read Unavailable, never a fabricated zero.
function agentSummary(rows){const total=rows.length,withUsage=rows.filter(run=>!!run.usage).length,fraction=tr("agents.usageFraction",{withUsage:withUsage,total:total}),failed=rows.filter(run=>run.status==="failed"),failedWithUsage=failed.filter(run=>!!run.usage).length,tokens=rows.reduce((sum,run)=>sum+(run.usage?run.usage.totalTokens:0),0),cost=rows.reduce((sum,run)=>sum+(run.usage?run.usage.cost:0),0),failedCost=failed.reduce((sum,run)=>sum+(run.usage?run.usage.cost:0),0),metrics=el("div","metrics");metrics.append(metric(tr("agents.childRuns"),number(total),tr("metric.child.note")));AGENT_STATUS_BUCKETS.forEach(status=>{const count=rows.filter(run=>run.status===status).length;if(count>0)metrics.append(metric(tr("agents."+status),number(count),tr("metric.child.note")));});metrics.append(metric(tr("agents.knownTokens"),withUsage===0?tr("evidence.unavailable"):number(tokens),fraction),metric(tr("agents.knownCost"),withUsage===0?tr("evidence.unavailable"):money(cost),fraction));if(failedWithUsage>0)metrics.append(metric(tr("agents.knownFailedCost"),money(failedCost),tr("agents.usageFraction",{withUsage:failedWithUsage,total:failed.length})));return metrics;}
// Child runs first (summary then table), then the separate native agent tool
// activity card: how often the launching tool ran is never a child-run count.
function agentsPanel(view,title){const wrap=el("div",""),activity=view.agentActivity;if(view.agentEvidence==="supported"){const filtered=filteredView(view),rows=filtered?filtered.agents:view.agents;if(rows.length===0&&filtered&&view.agents.length>0)wrap.append(emptyCard(title,agentRangeNote(view),"evidence.unavailable"));else{const section=table(title,tr("agents.note")+(filtered?"":ALL_DATES),[tr("table.role"),tr("table.status"),tr("table.model"),tr("table.tokens"),tr("table.cost"),tr("table.artifacts"),tr("table.parent")],agentRunCells(rows,sameSessionAgentIds(view)),["status-cell","status-cell","status-cell","num","num","status-cell","status-cell"],agentSummary(rows));wrap.append(section);}}else wrap.append(unavailableSection(title,tr("agents.none")));if(activity&&activity.state==="supported"){const section=card(tr("panel.agentActivity"),tr("agents.activity.note")+ALL_DATES,badge(tr("evidence."+activity.state),confidenceTone(activity.state))),metrics=el("div","metrics");metrics.append(metric(tr("table.calls"),number(activity.calls),tr("metric.tools.note"),[[tr("agents.succeeded"),number(activity.succeeded)],[tr("agents.failed"),number(activity.failed)],[tr("agents.interrupted"),number(activity.interrupted)]]));section.append(metrics);if(activity.tools&&activity.tools.length>0)simpleTable(section,[tr("table.tool"),tr("table.calls")],activity.tools.map(row=>[row.name,number(row.calls)]),["status-cell","num"]);wrap.append(section);}return wrap;}
function commandsPanel(view,title){const commands=view.commands;if(!commands||commands.items.length===0)return emptyCard(title,commands&&commands.count!==null?tr("commands.count",{count:number(commands.count)}):tr("unavailable.commands"),"evidence.unavailable");return table(title,tr("commands.note"),[tr("table.name"),tr("table.source"),tr("table.scope"),tr("table.origin"),tr("table.description")],commands.items.map(row=>[linkRow("command",row.name,row.name),orUnavailable(row.sourceLabel||row.source||null),row.scope,row.origin,orUnavailable(row.description)]),["status-cell","status-cell","status-cell","status-cell","wrap"]);}
function skillsPanel(view,title){const skills=view.skills;if(!skills)return unavailableSection(title,tr("unavailable.skills"));const section=skills.items.length===0?emptyCard(title,tr("skills.empty"),"evidence.unavailable"):table(title,tr("skills.note"),[tr("table.name"),tr("table.source"),tr("table.scope"),tr("table.origin"),tr("table.invocations")],skills.items.map(row=>[linkRow("skill",row.name,row.name),orUnavailable(row.sourceLabel),orUnavailable(row.scope),orUnavailable(row.origin),row.explicitInvocations===undefined?tr("evidence.unavailable"):number(row.explicitInvocations)]),["status-cell","status-cell","status-cell","status-cell","num"]);if(skills.otherInvocations!==null&&skills.otherInvocations!==undefined&&skills.otherInvocations>0)section.append(el("div","footnote",tr("skills.otherInvocations",{count:number(skills.otherInvocations)})));return section;}
function resourcesCard(resources){if(!resources||resources.state!=="supported"||resources.items.length===0)return unavailableSection(tr("panel.resources"),tr("resources.unavailable"));return simpleTable(card(tr("panel.resources"),tr("resources.note")),[tr("table.source"),tr("table.scope"),tr("table.origin"),tr("table.commands"),tr("table.skills"),tr("table.prompts"),tr("table.tools")],resources.items.map(row=>[linkRow("resource",row.sourceLabel,row.sourceLabel),row.scope,row.origin,number(row.commands),number(row.skills),number(row.prompts),number(row.tools)]),["status-cell","status-cell","status-cell","num","num","num","num"]);}
// The availability count of one inventory (design §8.1): its own persisted count
// when the DTO carries one, else its rows. An unsupported inventory with neither
// is Unavailable. Commands and resources have no activity-only rows, so their row
// count is availability; skills does, and reads skillsCount instead.
function inventoryCount(inventory,items){if(!inventory)return null;if(inventory.count!==null&&inventory.count!==undefined)return inventory.count;if(inventory.state!=="supported")return null;return (items||[]).length;}
// Skills availability is the inventory's own count of INVENTORY rows, taken
// before any counter-only name was appended, so a counted name the snapshot does
// not list can never inflate it (design §8.3-3). A missing count (no snapshot, or
// a payload without the field) is Unavailable — never the rendered row count,
// which is activity.
function skillsCount(skills){return skills&&typeof skills.count==="number"?skills.count:null;}
function inventoryLine(label,count,observed){return el("div","metric",label+" "+tr("env.available",{count:count===null?tr("evidence.unavailable"):number(count)})+" · "+observed);}
// The environment summary: availability is inventory state and, for skills only,
// the explicit folded invocation counters are the invocation figure. No inventory
// count is ever presented as activity, and no line is range-filtered or labelled
// with the selected range.
function environmentSummary(view){const lines=el("div","metrics"),commands=view.commands,skills=view.skills,resources=view.resources;lines.append(inventoryLine(tr("env.commands"),inventoryCount(commands,commands&&commands.items),tr("env.observed",{value:tr("evidence.unavailable")})));const observed=skills&&skills.invocationState==="supported"&&skills.invocationCount!==null&&skills.invocationCount!==undefined?tr("env.invocationsObserved",{count:number(skills.invocationCount)}):tr("env.invocationsUnavailable");lines.append(inventoryLine(tr("env.skills"),skillsCount(skills),observed));const sources=inventoryCount(resources,resources&&resources.items);lines.append(el("div","metric",tr("env.resources")+" "+tr("env.sources",{count:sources===null?tr("evidence.unavailable"):number(sources)})));return lines;}
// One Environment panel: the summary lines stay visible while the sub-navigation
// selects which inventory table is shown, so the inventory is secondary to the
// diagnostic flow and never a primary tab (§8.1).
function environmentPanel(view,title){const wrap=el("div",""),summary=card(title,tr("env.note")),subnav=el("div","segments");summary.append(environmentSummary(view));subnav.setAttribute("aria-label",tr("tab.environment"));[['commands',tr("env.commands")],["skills",tr("env.skills")],["resources",tr("env.resources")]].forEach(item=>{const button=el("button","",item[1]);button.dataset.envTab=item[0];button.setAttribute("aria-pressed",String(activeEnvTab()===item[0]));subnav.append(button);});wrap.append(summary,subnav);wrap.append(activeEnvTab()==="skills"?skillsPanel(view,tr("env.skills")):activeEnvTab()==="resources"?resourcesCard(view.resources):commandsPanel(view,tr("env.commands")));return wrap;}
// Telemetry is this row's evidence verdict plus its closed-vocabulary reason when
// the state is not supported. The detection note is a non-state remark: it never
// changes the telemetry value, and an absent producer with persisted telemetry
// stays a valid row (ADR 0009/0014).
function integrationTelemetry(row){const cell=el("span",""),reason=row.state==="unsupported"?tr("integration.reasonUnsupported"):row.state==="unavailable"?tr("integration.reasonMissing"):null;cell.append(badge(tr("evidence."+row.state),confidenceTone(row.state)));if(reason)cell.append(el("small","",reason));if(row.presence==="absent")cell.append(el("small","",tr("integration.noteNotDetected")));return cell;}
// Counters are the session-scope activity value, so the cell states the period;
// an absent counter object is Unavailable, never a fabricated zero.
function integrationActivity(row){return row.counters.length===0?tr("evidence.unavailable"):tr("integration.sessionTotal")+" · "+row.counters.join(" · ");}
function integrationVersion(row){return row.version===null?tr("evidence.unavailable"):String(row.version);}
// The integration's own column is the link to its detail panel (design §9.4):
// the row that carries its detection, telemetry, counters and version, so the
// destination is its own identity in this table.
function integrationsTable(view){return table(tr("panel.integrations"),tr("integrations.note"),[tr("table.integration"),tr("integration.detected"),tr("integration.telemetry"),tr("integration.activity"),tr("integration.version")],(view.integrations||[]).map(row=>[linkRow("integration",row.integration,row.integration),presenceBadge(row.presence),integrationTelemetry(row),integrationActivity(row),integrationVersion(row)]),["status-cell","status-cell","wrap","wrap","status-cell"]);}
function integrationsPanel(view,title){const integrations=view.integrations||[];return integrations.length===0?unavailableSection(title,tr("unavailable.integrations")):integrationsTable(view);}
// The Models tab reads the view's own per-date model rows through the one
// filter, so a range change genuinely changes model figures (design §5.2). A
// current view and a history session detail both thread their projection's dated
// rows in; a payload without them (the legacy adapter) renders the aggregate
// rows unfiltered and states that they are all report dates. A dated source with
// no rows at all cannot be attributed to any date — Unavailable — while dated
// rows outside the range are a range statement.
function modelRangeRows(rows){const groups={},order=[];rows.forEach(row=>{const key=row.provider+"\u0000"+row.model,g=groups[key]||{provider:row.provider,model:row.model,generations:0,totalTokens:0,cost:0};if(!groups[key])order.push(key);groups[key]=g;g.generations+=row.generations||0;g.totalTokens+=row.totalTokens||0;g.cost+=row.cost||0});return order.sort().map(key=>{const g=groups[key];g.cost=Math.round(g.cost*1e12)/1e12;return g});}
function modelsPanel(view,title,source){if(source===undefined)return view.models.length===0?emptyCard(title,tr("models.none"),"evidence.native"):table(title,tr("models.note")+ALL_DATES,[tr("table.provider"),tr("table.model"),tr("table.generations"),tr("table.input"),tr("table.output"),tr("table.cacheRead"),tr("table.cacheWrite"),tr("table.tokens"),tr("table.cost")],view.models.map(row=>[row.provider,entitySpan("model",row.provider+"/"+row.model,row.model),number(row.generations),numberOrUnavailable(row.inputTokens),numberOrUnavailable(row.outputTokens),numberOrUnavailable(row.cacheReadTokens),numberOrUnavailable(row.cacheWriteTokens),number(row.totalTokens),money(row.cost)]),["status-cell","status-cell","num","num","num","num","num","num","num"]);const filtered=filteredView(view,source),rows=filtered?modelRangeRows(filtered.models):[],section=rows.length===0?(source.datedModels.length===0?unavailableSection(title,tr("models.none")):emptyCard(title,tr("chart.empty"),"evidence.unavailable")):table(title,tr("models.note"),[tr("table.provider"),tr("table.model"),tr("table.generations"),tr("table.tokens"),tr("table.cost")],rows.map(row=>[row.provider,entitySpan("model",row.provider+"/"+row.model,row.model),number(row.generations),number(row.totalTokens),money(row.cost)]),["status-cell","status-cell","num","num","num"]);if(source.modelsTruncated)section.append(el("div","footnote",tr("models.truncated")));return section;}
// The Tools tab renders two views over one projection: the summary groups the
// same in-range call rows the calls timeline lists, so both move with the range
// and the summary totals always equal the sum of its own call rows (design
// §7.6, §7.7-7). A summary row's tool name is the anchor that narrows the calls
// view; the clear-filter control returns that view to every call. One table()
// call per panel keeps one search/sort pair, so the calls timeline renders
// through the plain table helper inside the same card style.
const TOOL_STATUS_BUCKETS=["succeeded","failed","interrupted"];
// Known usage only: a set whose calls reported no usage states Unavailable,
// never a fabricated zero, and a partial set keeps its Known qualifier. The row
// carries its own "n of m calls reported usage" (design §7.6), stated over its
// own calls so the panel's aggregate sentence can never stand in for it.
function toolValueCell(value,key,row){if(row.withUsage===0)return tr("evidence.unavailable");if(row.withUsage<row.calls)return knownValue(value,key,tr("tools.usageFraction",{withUsage:row.withUsage,total:row.calls}));return value;}
// The panel's own note repeats the fraction while at least one row is partial;
// a row whose calls reported no usage at all renders Unavailable, so no
// fraction is stated over it and the note falls back to the plain metric note.
function toolSummaryMetrics(summary){const calls=summary.reduce((sum,row)=>sum+row.calls,0),withUsage=summary.reduce((sum,row)=>sum+row.withUsage,0),tokens=summary.reduce((sum,row)=>sum+row.tokens,0),cost=Math.round(summary.reduce((sum,row)=>sum+row.cost,0)*1e12)/1e12,partial=summary.some(row=>row.withUsage>0&&row.withUsage<row.calls),note=partial?tr("tools.usageFraction",{withUsage:withUsage,total:calls}):tr("metric.tools.note"),metrics=el("div","metrics");metrics.append(metric(tr("table.calls"),number(calls),tr("metric.tools.note")));TOOL_STATUS_BUCKETS.forEach(status=>{const count=summary.reduce((sum,row)=>sum+row[status],0);if(count>0)metrics.append(metric(tr("tools."+status),number(count),tr("metric.tools.note")));});metrics.append(metric(tr("metric.knownTokens"),withUsage===0?tr("evidence.unavailable"):number(tokens),note),metric(tr("metric.knownCost"),withUsage===0?tr("evidence.unavailable"):money(cost),note));return metrics;}
// The summary row's own tool name is the anchor that narrows the calls view, so
// the name is also this tool's entity identity: an Overview tool row links here.
function toolFilterAnchor(name){const button=el("button","",name);button.dataset.toolFilter=name;button.setAttribute("aria-label",tr("tools.filteredBy",{tool:name}));entityMark(button,"tool",name);return button;}
function toolSummaryCells(row){return [toolFilterAnchor(row.name),number(row.calls),number(row.succeeded),number(row.failed),number(row.interrupted),toolValueCell(number(row.tokens),"metric.knownTokens",row),toolValueCell(money(row.cost),"metric.knownCost",row),row.lastUsed,orUnavailable(row.source)];}
// Duration is live-correlated evidence only, never estimated from timestamps.
function toolDurationCell(row,evidence){const label=toolDuration(row,evidence);return label===null?tr("evidence.unavailable"):label+" · "+tr("evidence.live");}
// The calls timeline's tool cell is the call's entity identity (its canonical id
// is what a related-tool reference names), and a call that failed with a
// persisted error is joined to it by that same id (design §7.5-1): the status is
// then the link to the Errors row, so the join is navigable in both directions.
function toolCallCells(rows,evidence,errorIds){return rows.map(row=>[row.timestamp,entitySpan("tool",row.id,row.name),orUnavailable(row.source),row.status!=="succeeded"&&errorIds.has(row.id)?linkRow("error",row.id,tr("tools."+row.status),"badge warn"):badge(tr("tools."+row.status),row.status==="succeeded"?"":"warn"),row.usage?number(row.usage.totalTokens):tr("evidence.unavailable"),row.usage?money(row.usage.cost):tr("evidence.unavailable"),toolDurationCell(row,evidence)]);}
// The error ids of the unfiltered view: the tool join is a session fact (§7.5-3),
// so a call whose error falls outside the selected range is still linked to it.
function errorIdsOf(view){const ids=new Set();[].concat((view&&view.errors)||[]).forEach(row=>{if(row&&typeof row.id==="string")ids.add(row.id);});return ids;}
function toolFilterBar(filter){const bar=el("div","toolbar"),clear=el("button","",tr("tools.clearFilter"));clear.dataset.clearFilter="true";bar.append(el("span","muted",tr("tools.filteredBy",{tool:filter})),clear);return bar;}
function toolCallsCard(rows,filtered,evidence,filter,errorIds){const section=card(tr("tools.calls"),tr("tools.note")+(filtered?"":ALL_DATES));if(filter!==null)section.append(toolFilterBar(filter));return simpleTable(section,[tr("table.timestamp"),tr("table.tool"),tr("table.source"),tr("table.status"),tr("table.tokens"),tr("table.cost"),tr("table.duration")],toolCallCells(rows,evidence,errorIds),["status-cell","status-cell","status-cell","status-cell","num","num","status-cell"]);}
function toolsPanel(view,title,filtered,context){const summary=toolSummary(context);if(summary.length===0)return emptyCard(title,filtered?tr("chart.empty"):tr("tools.none"),"evidence.native");const filter=activeToolFilter(),calls=toolCalls(context,filter),wrap=el("div",""),summarySection=table(tr("tools.summary"),tr("tools.note")+(filtered?"":ALL_DATES),[tr("table.tool"),tr("table.calls"),tr("tools.succeeded"),tr("tools.failed"),tr("tools.interrupted"),tr("table.tokens"),tr("table.cost"),tr("tools.lastUsed"),tr("table.source")],summary.map(toolSummaryCells),["status-cell","num","num","num","num","num","num","status-cell","status-cell"],toolSummaryMetrics(summary)),callsSection=calls.length===0?emptyCard(tr("tools.calls"),tr("chart.empty"),"evidence.unavailable"):toolCallsCard(calls,filtered,view.durationEvidence,filter,errorIdsOf(view));if(filter!==null&&calls.length===0)callsSection.append(toolFilterBar(filter));wrap.append(summarySection,callsSection);return wrap;}
// Errors are identity-first (design §7.5): the first column is what failed and
// the internal tool:call_… id never reaches a column — it stays in the row's
// details panel beside the tool join, the calls reference and the related child
// candidates. The headline and the message are the rules inlined above
// (errorHeadline/errorMessage), so the browser cannot drift from the tests.
function errorHeadlineText(row){const headline=errorHeadline(row);return tr(headline.key,headline.values||{});}
function errorMessageText(row){const message=errorMessage(row);return message===null?tr("errors.messageUnavailable"):message;}
// One labelled value line inside a row's details panel; the value is a node when
// it is itself a reference.
function errorFieldLine(label,value){const line=el("div","breakdown-row"),cell=el("span","mono","");if(value instanceof Node)cell.append(value);else cell.textContent=text(value);line.append(el("span","",label),cell);return line;}
// The tool reference is the tool call's own entity link: its data-entity is the
// call's canonical id, so a following navigation lands on that call's row in the
// calls timeline (design §7.5-1, §9.4).
function errorToolReference(row){return linkRow("tool",row.id,text(row.toolName),"mono");}
// Every candidate the publishing result observed, in run order, one entity link
// per run and none of them named as a cause: the relation is one-to-many. A run
// whose role the projection does not carry is labelled Unavailable, never the raw
// run id. Zero candidates returns null, so the section is omitted entirely rather
// than inferred from a timestamp or padded with an unrelated run (design §7.5-3).
function errorChildrenLine(row,runs){if(row.relatedChildIds.length===0)return null;const list=el("span","mono","");row.relatedChildIds.forEach(id=>{const run=runs[id];list.append(linkRow("agent",id,run&&run.agent?run.agent:tr("evidence.unavailable"),"mono"));});return errorFieldLine(tr("errors.relatedChildren"),list);}
// The row's summary is the error's entity identity: a failed tool call links to
// this row, and the summary is natively focusable, so the focus effect can land
// on it and toggle the details beside it.
function errorDetails(row,runs){const details=document.createElement("details"),summary=el("summary","",errorHeadlineText(row)),body=el("div","breakdown");entityMark(summary,"error",row.id);details.append(summary);body.append(errorFieldLine(tr("table.id"),row.id));if(row.toolName!==null)body.append(errorFieldLine(tr("errors.relatedTool"),errorToolReference(row)),errorFieldLine(tr("table.source"),orUnavailable(row.toolSource)),errorFieldLine(tr("table.status"),row.toolStatus===null?tr("evidence.unavailable"):badge(tr("tools."+row.toolStatus),row.toolStatus==="succeeded"?"":"warn")));const related=errorChildrenLine(row,runs);if(related!==null)body.append(related);details.append(body);return details;}
// The runs of the unfiltered view: a range filter narrows which errors are
// listed, never which run a candidate names — the join is a session fact — so a
// candidate keeps its own role even when its run falls outside the range.
function runRowsById(view){const runs={};(view.agents||[]).forEach(run=>{runs[run.id]=run;});return runs;}
function errorsPanel(view,title,filtered){const errors=filtered?filtered.errors:view.errors;if(errors.length===0)return emptyCard(title,filtered?tr("chart.empty"):tr("errors.none"),"evidence.native");const runs=runRowsById(view);return table(title,tr("errors.note")+(filtered?"":ALL_DATES),[tr("table.error"),tr("table.kind"),tr("table.timestamp"),tr("table.message"),tr("table.confidence")],errors.map(row=>[errorDetails(row,runs),row.kind,row.timestamp,errorMessageText(row),badge(tr("evidence."+row.confidence),confidenceTone(row.confidence))]),["wrap","status-cell","status-cell","wrap","status-cell"]);}
function detail(view,title,source){const tab=activeTab();if(tab==="models")return modelsPanel(view,title,source);if(tab==="tools"){const filtered=filteredView(view);return toolsPanel(view,title,filtered,filtered||view);}if(tab==="environment")return environmentPanel(view,title);if(tab==="agents")return agentsPanel(view,title);if(tab==="integrations")return integrationsPanel(view,title);if(tab==="errors"){const filtered=filteredView(view);return errorsPanel(view,title,filtered);}if(tab==="ledger"){if(view.ledger.length===0)return emptyCard(title,tr("empty.ledger"),"evidence.unavailable");return table(title,tr("ledger.materialized"),[tr("table.timestamp"),tr("table.id"),tr("table.category"),tr("table.action"),tr("table.confidence")],view.ledger.map(item=>[item.timestamp,item.id,item.kind,item.status,item.confidence]),["status-cell","id-cell","status-cell","status-cell","status-cell"]);}return unavailableSection(title,tr("unavailable.copy"));}
// The session row's own cell: the opaque id an id column truncates and copies,
// plus the observed span it carries. The dates are a wrapping line of their own,
// so the narrow id column never hides them.
function sessionCell(entry){const cell=el("div","id-value");cell.append(el("span","mono",entry.sessionId));cell.append(el("small","wrap",entry.firstDate?(entry.firstDate+(entry.lastDate&&entry.lastDate!==entry.firstDate?" → "+entry.lastDate:"")):tr("evidence.unavailable")));return cell;}
function openButton(sessionId){const link=el("a","",tr("table.open"));link.dataset.session=sessionId;link.setAttribute("aria-label",tr("table.open")+" "+sessionId);link.setAttribute("href",serializeRoute(routeFor({section:"history",tab:"overview",session:sessionId})));return link;}
function historyRowCells(item,group){const entry=item.entry,verdict=item.verdict,partial=group==="member"&&verdict.partial,member=group==="member";return [idValue(entry.sessionId,sessionCell(entry)),orUnavailable(entry.durationLabel),member?(partial?knownValue(number(verdict.totalTokens),"metric.knownTokens"):number(verdict.totalTokens)):tr("evidence.unavailable"),entry.generationCount===null?tr("evidence.unavailable"):number(entry.generationCount),entry.agentCount===null?tr("evidence.unavailable"):number(entry.agentCount),entry.status?badge(tr(entry.status.key),entry.status.tone):tr("evidence.unavailable"),member?(partial?knownValue(money(verdict.cost),"metric.knownCost"):money(verdict.cost)):tr("evidence.unavailable"),entry.view?openButton(entry.sessionId):""];}
function historyTable(classified){const section=card(tr("panel.history"),tr("history.note")),headers=[tr("table.session"),tr("table.duration"),tr("table.tokens"),tr("table.generations"),tr("table.agents"),tr("table.status"),tr("table.cost")],classes=["id-cell","status-cell","num","num","num","status-cell","num"];headers.push(tr("table.inspect"));classes.push("status-cell");const rows=classified.members.map(item=>historyRowCells(item,"member"));if(classified.unknown.length){rows.push([el("strong","",tr("history.groupUnknown"))]);classified.unknown.forEach(item=>rows.push(historyRowCells(item,"unknown")))}simpleTable(section,headers,rows,classes);section.append(el("div","footnote",tr("table.duration")+", "+tr("table.generations")+", "+tr("table.agents")+ALL_DATES));const wrap=section.querySelector(".table-wrap"),node=section.querySelector("table");if(wrap)wrap.className="table-wrap history-table-wrap";if(node)node.className="history-table";return section;}
function historyOverview(){const range=activeRange(),classified=historyRows(),members=historyMetrics(classified.members),partial=members.partial||!!range&&partialContribution(range),totals=range?periodTotals(activeDaily(),range):null,empty=!!totals&&totals.days===0,labels=data.history.usageLabels,costLabel=partial&&labels.cost==="metric.cost"?"metric.knownCost":labels.cost,tokensLabel=partial&&labels.tokens==="metric.tokens"?"metric.knownTokens":labels.tokens,attributable=members.sessions>0||classified.unknown.length===0,costValue=labels.usageUnavailable?tr("metric.costUnavailable"):(totals&&attributable?money(totals.cost):tr("evidence.unavailable")),tokensValue=labels.usageUnavailable?tr("metric.costUnavailable"):(totals&&attributable?number(totals.totalTokens):tr("evidence.unavailable")),blocks=empty?rangeEmpty():el("div","metrics");if(!empty)blocks.append(metric(tr(costLabel),costValue,tr("metric.native"),[[tr("table.date"),rangeText()]]),metric(tr(tokensLabel),tokensValue,tr("metric.tokens.note"),[[tr("table.date"),rangeText()]]),metric(tr("metric.generations"),totals?number(totals.generations):tr("evidence.unavailable"),tr("metric.generations.note"),[[tr("table.date"),rangeText()]]),metric(tr("metric.sessions"),number(members.sessions),tr("history.sessions.note"),[[tr("evidence.native"),number(historySessions().length)+" tracked"]]));const all=el("div","");all.append(blocks,coveragePanel(data.history),historyTable(classified),evidencePanel(activeEvidence()));return all;}
function backBar(){const bar=el("div","toolbar"),link=el("a","",tr("nav.back"));link.dataset.back="true";link.setAttribute("href",serializeRoute(routeFor({section:"history",tab:"overview",session:null})));bar.append(link);return bar;}
// The coverage ladder AND the range verdict qualify the global headline (design
// §5.6), exactly as the history aggregate's does.
function globalOverview(){const days=selectedDays(),empty=!!activeRange()&&days.length===0,tokens=days.reduce((sum,row)=>sum+row.totalTokens,0),cost=days.reduce((sum,row)=>sum+row.cost,0),labels=data.global.usageLabels,partial=rangeTruncated(),costLabel=partial&&labels.cost==="metric.cost"?"metric.knownCost":labels.cost,tokensLabel=partial&&labels.tokens==="metric.tokens"?"metric.knownTokens":labels.tokens,costValue=labels.usageUnavailable?tr("metric.costUnavailable"):money(cost),tokensValue=labels.usageUnavailable?tr("metric.costUnavailable"):number(tokens),metrics=empty?rangeEmpty():el("div","metrics");if(!empty)metrics.append(metric(tr(costLabel),costValue,tr("metric.native"),[[tr("table.date"),rangeText()]]),metric(tr(tokensLabel),tokensValue,tr("metric.tokens.note"),[[tr("table.date"),rangeText()]]),metric(tr("metric.days"),number(days.length),tr("metric.days.note"),[[tr("range.label"),rangeText()]]));const all=el("div","");all.append(metrics,coveragePanel(data.global),compositionCard(data.global.composition),evidencePanel(activeEvidence()));return all;}
function sessionPanel(entry){const tab=activeTab();if(!entry||!entry.view)return unavailableSection(tr("tab."+tab),tr("unavailable.session"));return tab==="overview"?overview(entry.view):detail(entry.view,tr("tab."+tab),datedSource(entry));}
function renderView(){const nodes=[],tab=activeTab(),session=selectedSession();if(activeSection()==="global"){if(tab==="overview"){nodes.push(globalOverview());nodes.push(chart());}else nodes.push(unavailableSection(tr("tab."+tab),tr("unavailable.global")));return nodes;}if(activeSection()==="history"){if(session===null){nodes.push(historyOverview());if(tab==="overview")nodes.push(chart());else nodes.push(unavailableSection(tr("tab."+tab),tr("unavailable.session")));return nodes;}nodes.push(sessionPanel(session));if(tab==="overview")nodes.push(chart());nodes.push(backBar());return nodes;}const current=currentView();if(!current||current.availability!=="available"){nodes.push(unavailableSection(tr("tab."+tab),tr("unavailable.current")+(current&&current.diagnostic?" · "+current.diagnostic:"")));return nodes;}if(tab==="overview"){nodes.push(overview(current.report));nodes.push(chart());}else nodes.push(detail(current.report,tr("tab."+tab),datedSource(current)));return nodes;}
function sessionScopeNote(){const entry=selectedSession();return (entry.firstDate||tr("evidence.unavailable"))+(entry.lastDate&&entry.lastDate!==entry.firstDate?" → "+entry.lastDate:"")+" · "+tr("scope.tree")+" · after tracking marker";}
const scopeButtons=[].slice.call(q("scope").querySelectorAll("button"));
const navNode=q("navigation"),tabsNode=q("tabs");
["current","history","global"].forEach(kind=>{const link=el("a","",tr("nav."+kind));link.dataset.range=kind;navNode.append(link);});
// The sidebar links and the tab strip are anchors (design §9.2), so Enter,
// middle-click and copy-link all work; their hrefs and their active one are both
// written by render() from the derived view, so no control carries state over.
function syncNavigation(derived){[].slice.call(navNode.querySelectorAll("a")).forEach(link=>{const kind=link.dataset.range;link.setAttribute("href",serializeRoute(routeFor({section:kind,tab:"overview",session:null})));if(kind===derived.activeSection)link.setAttribute("aria-current","page");else link.removeAttribute("aria-current");});}
function tabLink(tab,active){const link=el("a","",tr("tab."+tab));link.dataset.tab=tab;link.setAttribute("href",serializeRoute(routeFor({tab:tab})));if(active)link.setAttribute("aria-current","page");return link;}
// The strip is rebuilt every render, so a tab that held keyboard focus would be
// destroyed by any re-render (a range change, a tab activation). The rebuilt strip
// gets that focus back — the same tab when it is still rendered, else the active
// one. A section change is exempt: render() moves focus to the section heading.
function syncTabs(derived,effects){const active=document.activeElement,held=active&&active.dataset?active.dataset.tab:undefined;tabsNode.replaceChildren.apply(tabsNode,derived.visibleTabs.map(tab=>tabLink(tab,tab===derived.activeTab)));if(held===undefined||(effects&&effects.sectionChanged))return;const links=[].slice.call(tabsNode.querySelectorAll("a")),link=links.filter(node=>node.dataset.tab===held)[0]||links.filter(node=>node.dataset.tab===derived.activeTab)[0];if(link&&typeof link.focus==="function")link.focus();}
function syncScope(derived){scopeButtons.forEach(button=>{const scope=button.dataset.scope,current=data.current[scope],unavailable=derived.activeSection!=="current"||current.availability!=="available";button.disabled=unavailable;button.setAttribute("aria-pressed",String(derived.activeSection==="current"&&scope===derived.scope));if(current.diagnostic)button.title=current.diagnostic;else button.removeAttribute("title");});// The fixed note renders once, in its own element beside the disabled control.
q("scope-fixed").hidden=derived.activeSection==="current";q("scope-sub").textContent=derived.activeSection==="current"?tr(derived.scope==="active"?"scope.active.note":"scope.tree.note"):"";let same=q("scope-same"),current=data.current[derived.scope],show=derived.activeSection==="current"&&data.current.sameReportProjection===true&&!!current&&current.availability==="available";if(!show){if(same)same.hidden=true;return;}if(!same){same=el("p","range-note",tr("scope.sameReport"));same.id="scope-same";q("scope").parentNode.append(same);}same.hidden=false;}
// The one-line degradation notice (design §9.1): the derived view's notice wins,
// and a code only a raw hash can produce ("range-restored") is carried through
// when derivation had nothing to add.
function syncRouteNotice(notice){const node=q("route-notice");if(!node)return;const copy=notice==="range-restored"?tr("range.restored"):notice==="tab-unavailable"||notice==="section-unavailable"?tr("nav.unavailable"):"";node.textContent=copy;node.hidden=copy==="";}
// The tabs the state tables offer a route: an unavailable view renders none, and
// a selected history session offers the wider session set (design §9.3). The hash
// itself is parsed with the widest table, so derivation is what coerces.
function stateCapabilities(route){const entry=sessionEntry(route),current=data.current[route.scope],history=entry!==null?(entry.view!==undefined?tabsOf(CAPS.historySession):[]):tabsOf(CAPS.history);return {current:current&&Array.isArray(current.capabilities)?current.capabilities:[],history:history,global:tabsOf(CAPS.global)};}
// The SessionViews the payload carries: both current scopes' own report and each
// history session's view. Every id a hash may name comes from these, so a value
// is only ever echoed when the projection already exposes it.
function knownViews(){const views=[];["active","tree"].forEach(scope=>{const current=data.current[scope],view=current&&(current.report||current);if(view)views.push(view);});historySessions().forEach(entry=>{if(entry&&entry.view)views.push(entry.view);});return views;}
// The payload never changes, so the id set is built once: every later navigation
// validates against the same bounded ids. Every declared entity kind has an id
// space here — tool call ids and tool names, agent/error row ids, model
// identities, integration ids, command/skill names and resource labels (each one
// already bounded by the projection: a source label is a closed set or a
// registry package name, never a path).
let knownIdCache=null;
function knownIds(){if(knownIdCache!==null)return knownIdCache;const ids=new Set(),add=value=>{if(typeof value==="string"&&value!=="")ids.add(value);};historySessions().forEach(entry=>add(entry&&entry.sessionId));knownViews().forEach(view=>{(view.tools||[]).forEach(row=>{add(row&&row.id);add(row&&row.name);});[].concat(view.agents||[],view.errors||[]).forEach(row=>add(row&&row.id));(view.models||[]).forEach(row=>add(row.provider+"/"+row.model));(view.integrations||[]).forEach(row=>add(row.integration));if(view.commands)view.commands.items.forEach(row=>add(row.name));if(view.skills)view.skills.items.forEach(row=>add(row.name));if(view.resources)view.resources.items.forEach(row=>add(row.sourceLabel));});knownIdCache=ids;return ids;}
// The COERCED form of a route: the tab it actually renders, derived with the same
// tables rendering uses, so a navigation can never serialize a tab its section
// does not support (design §9.3).
function coercedRoute(route){const derived=deriveView(route,stateCapabilities(route),routeDaily(route).map(row=>row.date));const next={...route,tab:derived.activeTab};if(derived.activeSection!==route.section)next.section=derived.activeSection;return next;}
// The one writer of the route (design §9.2): it serializes the coerced route into
// the address bar and applies it. Every discrete change — a section/tab/scope/
// session/entity navigation, a range preset, a custom range and a sort — pushes a
// history entry, so Back restores the state it came from; only in-progress search
// typing replaces the current entry (R16b), so a search box never fills the stack.
// The replacement is best-effort for the same reason applyLocation's
// canonicalization is (a file:// document may refuse it): the hash is the
// fallback, so a keystroke still reaches the route it names — at the cost of one
// entry per keystroke in that environment — and a document that refuses both
// writes is swallowed, so the in-memory route still renders.
function navigate(next,push){
const route=coercedRoute(next),key=routeKey(route);
if(key===lastAppliedKey)return;
if(push===false&&typeof history!=="undefined"&&history.replaceState){
// An in-progress replace may not throw out of the input listener either.
try{history.replaceState(null,"",key);}catch(error){try{location.hash=key;}catch(inner){}}
}else location.hash=key;
applyLocation();
}
// The one link-route builder (design §9.4): a destination keeps the context it can
// carry. A link that stays on the same view identity keeps the active range; a
// link to another identity leaves the range out, so the entering view's own
// remembered range decides (§5.3). A null explicitly clears a field: it is the
// absence of that state, never a value to carry.
function routeFor(patch){const section=patch.section!==undefined?patch.section:state.section,rawSession=patch.session!==undefined?patch.session:(section===state.section?state.session:undefined),session=section==="history"&&typeof rawSession==="string"?rawSession:undefined,tab=patch.tab!==undefined?patch.tab:state.tab,next={section:section,tab:tab,scope:patch.scope!==undefined?patch.scope:state.scope};if(session!==undefined)next.session=session;const sameIdentity=viewIdentity(next)===viewIdentity(state),range=patch.range!==undefined?patch.range:(sameIdentity?state.range:undefined);if(range!==undefined&&range!==null)next.range=range;const entity=patch.entity!==undefined?patch.entity:(sameIdentity?state.entity:undefined);if(entity!==undefined&&entity!==null)next.entity=entity;const table=patch.table!==undefined?patch.table:(sameIdentity&&tab===state.tab?state.table:undefined);if(table!==undefined&&table!==null)next.table=table;return next;}
// The tab one entity kind belongs to (design §9.4). The three inventory kinds
// share the Environment panel, which selects its sub-section from the kind.
function tabFor(kind){if(kind==="model")return "models";if(kind==="tool")return "tools";if(kind==="agent")return "agents";if(kind==="error")return "errors";if(kind==="integration")return "integrations";return "environment";}
// One element's entity identity, in the same data-entity vocabulary the links
// carry plus the entity class the focus effect looks for. An id the payload
// does not already expose is never emitted, so such a node stays exactly as it
// was built and the function reports that nothing was marked.
function entityMark(node,kind,id){if(!knownIds().has(id))return false;node.dataset.entity=kind+":"+id;node.className=node.className===""?"entity":node.className+" entity";return true;}
// One entity link (design §9.4): an anchor whose href is the destination route,
// built through routeFor so it keeps the context a link can carry — section,
// session, scope and the active range — and carrying the entity it names. An id
// the payload does not expose never becomes a link: the label stays plain text.
function linkRow(kind,id,label,className){const node=el("a",className||"",label);if(!entityMark(node,kind,id))return el("span",className||"",label);node.setAttribute("href",serializeRoute(routeFor({tab:tabFor(kind),entity:{kind:kind,id:id}})));return node;}
// A row identity that is not itself an anchor: a plain span, focusable only
// programmatically (no tab stop), so the focus ring can land on the row that
// represents the entity without styling a label as a link.
function entitySpan(kind,id,label){const node=el("span","mono",label);if(entityMark(node,kind,id))node.setAttribute("tabindex","-1");return node;}
// The one post-render focus effect (design §9.2, §9.4): the route's entity is
// highlighted and focused in the view just rendered, so a followed link lands on
// the row it named. Returns whether an element was found, so the caller can fall
// back to the section heading — and never runs for a range-only or table-only
// change, so such a render cannot steal focus.
function focusEntity(view){if(!view.entity)return false;const node=q("view"),key=view.entity.kind+":"+view.entity.id,found=[].slice.call(node.querySelectorAll(".entity")).filter(candidate=>candidate.dataset.entity===key)[0];if(!found)return false;found.classList.add("entity-focus");if(typeof found.focus==="function")found.focus();return true;}
// The active table's own state after a patch, with an empty value removed: the
// table's query and sort are the route's (§9.5), so Back restores what was typed.
// An emptied table is expressed as null, which routeFor reads as "no table" —
// the route carries no table key at all, never a null one.
function withTable(patch){const table={},current=routeTable();if(typeof current.query==="string"&&current.query!=="")table.query=current.query;if(typeof current.sort==="string"&&current.sort!=="")table.sort=current.sort;Object.keys(patch).forEach(key=>{const value=patch[key];if(value===null||value==="")delete table[key];else table[key]=value;});return routeFor({table:Object.keys(table).length===0?null:table});}
// One view-local setting that is not route state (§9.5): remembered for this
// (identity, tab) and re-rendered, never serialized into the hash.
function setViewSetting(name,value){const key=settingsKey(),settings=viewSettings[key]||(viewSettings[key]={});settings[name]=value;render();}
// The settings of the view being left, kept in the ephemeral cache so switching
// tabs and returning restores a table's query; the active range is remembered
// under its own view identity (§5.3/§9.5).
function rememberView(){const key=settingsKey(),settings=viewSettings[key]||(viewSettings[key]={});if(state.table!==undefined)settings.table=state.table;else delete settings.table;if(state.range!==undefined)rangeIntents[viewIdentity()]=state.range;}
// What the entering view remembers: its range when the view IDENTITY changes and
// its table settings when the (identity, tab) changes, and never a value the route
// already carries — so a deep link reproduces exactly the view it points at.
function restoreMemory(route,previous){const next={...route},identity=viewIdentity(next);if(next.range===undefined&&identity!==viewIdentity(previous)&&rangeIntents[identity]!==undefined)next.range=rangeIntents[identity];const key=settingsKey(next);if(key!==settingsKey(previous)){const settings=viewSettings[key];if(settings&&next.table===undefined&&settings.table!==undefined)next.table=settings.table;}return next;}
// The applied route is ONE object, mutated in place, so every reader of it (the
// render path and the exported test handle) sees the same navigation state.
function adopt(route){state.section=route.section;state.tab=route.tab;state.scope=route.scope;["session","range","entity","table"].forEach(key=>{if(route[key]===undefined||route[key]===null)delete state[key];else state[key]=route[key];});}
// Two entity refs name the same navigation target when both fields match: the
// parser builds a fresh object for every event, so a reference comparison would
// call a range-only change structural and steal focus (design §9.2).
const sameEntity=(left,right)=>left===right||(left!==undefined&&right!==undefined&&left.kind===right.kind&&left.id===right.id);
// The ONE event path (design §9.2), bound to both hashchange and popstate. It
// canonicalizes the hash into a route, adds what the entering view remembers, and
// returns without rendering when that canonical route is the one already applied —
// so however many events one navigation produces, it renders exactly once.
function applyLocation(){const previous={section:state.section,tab:state.tab,session:state.session,entity:state.entity},parsed=parseRoute(location.hash||"",{scope:data.initialScope,capabilities:parseCapabilities(),knownIds:knownIds()}),restored=restoreMemory(parsed.route,previous),derived=deriveView(restored,stateCapabilities(restored),routeDaily(restored).map(row=>row.date)),applied={...restored,tab:derived.activeTab},key=routeKey(applied);
// The range of the active view identity IS navigation state (§5.3), so the address
// bar is canonicalized to the route that was just applied — a replacement, never a
// new entry. Canonicalization is best-effort: a file:// document may refuse the
// call (a SecurityError), and a refused rewrite must never suppress the render, so
// the route stays applied in memory and the dedupe keeps running on the applied
// key. The hash navigate wrote equals this key afterwards, so the browser's own
// event for that navigation re-parses to the applied route and renders nothing.
if(typeof history!=="undefined"&&history.replaceState&&location.hash!==key){try{history.replaceState(null,"",key);}catch(error){}}
if(key===lastAppliedKey)return;lastAppliedKey=key;stateNotice=derived.notice!==undefined?derived.notice:parsed.notice;adopt(applied);render({structural:previous.section!==applied.section||previous.tab!==applied.tab||previous.session!==applied.session||!sameEntity(previous.entity,applied.entity),sectionChanged:previous.section!==applied.section});}
function render(effects){const scrollY=window.scrollY||0,active=document.activeElement,caret=active&&active.id==="search"&&typeof active.selectionStart==="number"?active.selectionStart:null;
// The one derivation (design §9.2): every value written below — the heading, the
// active sidebar link, the visible tabs and their active one, the scope controls,
// the range controls and the table's search and sort — comes from this view.
view=deriveView(state,stateCapabilities(state),rangeDates());rememberView();const derived=view;syncNavigation(derived);syncTabs(derived,effects);syncScope(derived);syncRouteNotice(derived.notice!==undefined?derived.notice:stateNotice);q("wal-detail").hidden=!(derived.activeSection==="current"&&data.walDetail==="expired");q("time-range").hidden=false;syncRangeNotice();const range=activeRange();q("range-name").textContent=range?(range.preset?tr("range.last",{days:range.preset}):tr("range.custom")):tr("evidence.unavailable");q("range-dates").textContent=rangeText();[].slice.call(document.querySelectorAll("[data-days]")).forEach(node=>node.setAttribute("aria-pressed",String(!!range&&Number(node.dataset.days)===range.preset)));q("custom-range").setAttribute("aria-pressed",String(!!range&&range.preset===null));const titles={current:["kicker.current","heading.current","subtitle.current"],history:["kicker.history","heading.history","subtitle.history"],global:["kicker.global","heading.global","subtitle.global"]}[derived.activeSection];q("kicker").textContent=tr(titles[0]);q("title").textContent=tr(titles[1]);q("subtitle").textContent=tr(titles[2]);const session=selectedSession();q("breadcrumb").textContent=session!==null?session.sessionId:tr("nav."+derived.activeSection);q("session-label").textContent=derived.activeSection==="current"?(currentReport()?currentReport().sessionId:tr("evidence.unavailable")):session!==null?session.sessionId:number(derived.activeSection==="history"?historySessions().length:data.global.trackedSessions)+" tracked sessions";q("scope-note").textContent=derived.activeSection==="current"?(state.scope==="active"?tr("scope.active"):tr("scope.tree"))+" · after tracking marker":session!==null?sessionScopeNote():rangeText();const output=q("view");output.replaceChildren.apply(output,renderView());
// A range-only or table-only change re-renders without stealing focus or moving
// the page; a structural change focuses the entity the route names, and only
// falls back to the section heading when there is none (design §9.2, §9.4).
const focused=effects&&effects.structural?focusEntity(derived):false;
if(effects&&effects.structural)window.scrollTo(0,0);else window.scrollTo(0,scrollY);if(!focused&&effects&&effects.sectionChanged&&derived.focusTarget==="section-heading"){const heading=q("title");if(heading&&typeof heading.focus==="function")heading.focus();}if(caret!==null){const search=q("search");if(search){search.focus();try{search.setSelectionRange(caret,caret);}catch(error){}}}q("announcement").textContent=tr("nav."+derived.activeSection)+", "+tr("tab."+derived.activeTab)+", "+rangeText()+(focused?" · "+tr("nav.entityFocus"):"");}
scopeButtons.forEach(button=>button.addEventListener("click",()=>{if(button.disabled)return;navigate(routeFor({scope:button.dataset.scope}));}));
document.addEventListener("input",event=>{if(event.target.id!=="search")return;navigate(withTable({query:event.target.value}),false);});
document.addEventListener("change",event=>{if(event.target.id==="sort")navigate(withTable({sort:event.target.value==="default"?"":event.target.value}));else if(event.target.id==="chart-metric"){setViewSetting("metric",event.target.value);const select=q("chart-metric");if(select&&typeof select.focus==="function")select.focus();}});
document.addEventListener("click",event=>{if(!event.target||!event.target.closest)return;
// A modified or non-primary click is the browser's own navigation (new tab, new
// window, copy link): the anchor's href is the destination, and no handler may
// take that away (design §9.2).
if(event.defaultPrevented||event.button||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;const link=event.target.closest("a"),control=link!==null?link:event.target.closest("button");if(!control)return;const data=control.dataset;if(data.range!==undefined||data.tab!==undefined||data.session!==undefined||data.back!==undefined){if(event.preventDefault)event.preventDefault();if(data.back!==undefined)navigate(routeFor({section:"history",tab:"overview",session:null}));else if(data.session!==undefined)navigate(routeFor({section:"history",tab:"overview",session:data.session}));else if(data.range!==undefined)navigate(routeFor({section:data.range,tab:"overview",session:null}));else navigate(routeFor({tab:data.tab}));return;}// A tool filter is per-identity ephemeral state, never a route field (§9.5), so it
// has no hash to push or replace: it re-renders the view it was chosen in.
if(data.toolFilter!==undefined){toolFilters[viewIdentity()]=data.toolFilter;render();return;}if(data.clearFilter!==undefined){toolFilters[viewIdentity()]=null;render();return;}// An opaque id's copy control is document-local: it copies the value the cell
// already renders and changes no route, view or table state, so the one click
// handler treats it as its own case instead of falling through to a navigation.
if(data.copyId!==undefined){copyId(control);return;}if(data.envTab!==undefined){const named=entityEnvTab();if(named!==undefined&&named!==data.envTab)navigate(routeFor({entity:null}));setViewSetting("envTab",data.envTab);return;}// An entity link (design §9.4) rebuilds exactly the destination its href names,
// so a plain click, Enter and a copied link all land on the same view.
if(data.entity!==undefined){if(event.preventDefault)event.preventDefault();const separator=data.entity.indexOf(":"),kind=data.entity.slice(0,separator);navigate(routeFor({tab:tabFor(kind),entity:{kind:kind,id:data.entity.slice(separator+1)}}));}});
[].slice.call(document.querySelectorAll("[data-days]")).forEach(button=>button.addEventListener("click",()=>{navigate(routeFor({range:{kind:"preset",preset:Number(button.dataset.days)}}));}));
q("custom-range").addEventListener("click",()=>{const range=activeRange();q("date-from").value=range?range.from:"";q("date-to").value=range?range.to:"";q("date-error").textContent="";q("date-dialog").showModal();});
q("date-cancel").addEventListener("click",()=>q("date-dialog").close());
q("date-form").addEventListener("submit",event=>{event.preventDefault();const from=q("date-from").value,to=q("date-to").value;if(!from||!to||from>to){q("date-error").textContent=tr("range.error");return;}q("date-dialog").close();navigate(routeFor({range:{kind:"custom",from:from,to:to}}));});
q("theme").addEventListener("click",event=>{const dark=document.body.classList.toggle("theme-dark");event.currentTarget.textContent=tr(dark?"theme.light":"theme.dark");event.currentTarget.setAttribute("aria-pressed",String(dark));});
// The bootstrap applies the address bar exactly like every later event does.
window.addEventListener("hashchange",applyLocation);
window.addEventListener("popstate",applyLocation);
applyLocation();
`;

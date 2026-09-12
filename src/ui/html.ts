import type { EvidenceState, Scope } from "../core/events.ts";
import { buildLedger, type LedgerItem } from "../core/ledger.ts";
import type { SessionReport } from "../core/reports.ts";
import type { SessionCoverage } from "../core/session-coverage.ts";
import type { CurrentView, DailyRow, InspectorBundle } from "./bundle.ts";
import { buildDailyRows, type DailyContribution } from "./daily.ts";
import type { GlobalReport, HistoryReport } from "./load-history.ts";
import {
  filterView,
  historyRowRange,
  isInRange,
  latestObservedDate,
  parseRangeQuery,
  presetRange,
  resolveRange,
  serializeRangeQuery,
  shiftUtcDay,
} from "./range.ts";

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
 * client and the tests run exactly the same source: there is one range filter
 * and one tools derivation, and neither can drift from the functions the unit
 * tests import. Each entry is emitted as `const <name>=<source>;` so the script
 * defines the very bindings the tests exercise. Task 14 extends this list with
 * the route functions.
 *
 * Every listed function is self-contained (`src/ui/range.ts` documents why:
 * no module scope, no clock, no named nested helper, hence no `__name`).
 */
const INLINED_FUNCTIONS = [
  shiftUtcDay,
  latestObservedDate,
  presetRange,
  resolveRange,
  isInRange,
  serializeRangeQuery,
  parseRangeQuery,
  filterView,
  historyRowRange,
  toolSummary,
  toolCalls,
  toolDuration,
  errorHeadline,
  errorMessage,
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
  '\n:root{color-scheme:light;--bg:#f7f7f4;--surface:#fff;--soft:#f0f0eb;--ink:#252820;--muted:#535b4f;--line:#dddfd6;--accent:#aa3e13;--tint:#fff0e6;--green:#34624b;--green-bg:#edf5ee;--warning:#825719;--mono:ui-monospace,SFMono-Regular,Consolas,monospace}\n*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input,select{font:inherit;color:inherit}button,select{cursor:pointer}button{background:var(--surface);border:1px solid var(--line);border-radius:7px;min-height:40px;padding:8px 14px}button:hover{border-color:var(--muted);background:var(--soft)}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid var(--accent);outline-offset:3px}button[aria-pressed=true]{background:var(--tint);color:var(--accent);border-color:var(--accent)}h1,h2,h3,p{margin:0}h1{font-size:30px;font-weight:620;letter-spacing:-1px;line-height:1.25}h2{font-size:16px;font-weight:620}h3{font-size:14px}small,.muted{color:var(--muted)}small{font-size:12px}.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}.skip{position:absolute;top:-60px;left:16px;z-index:10;background:var(--surface);padding:10px}.skip:focus{top:10px}.shell{display:grid;grid-template-columns:224px minmax(0,1fr);min-height:100vh}aside{padding:28px 18px;border-right:1px solid var(--line);display:flex;flex-direction:column;background:var(--surface)}.brand{display:flex;align-items:center;gap:10px;font-size:16px;font-weight:650;line-height:1.3;padding:0 10px 32px}.mark{display:grid;place-items:center;background:var(--ink);color:var(--surface);width:34px;height:34px;border-radius:9px;font:24px Georgia,serif}.brand small{font-weight:400}.eyebrow{font:11px var(--mono);text-transform:uppercase;letter-spacing:1.4px;color:var(--muted)}aside .eyebrow{padding:0 12px;margin:20px 0 8px}.nav{display:grid;gap:4px}.nav button{border-color:transparent;background:transparent;display:flex;align-items:center;gap:10px;text-align:left;padding:10px 12px;min-height:44px}.nav button[aria-pressed=true]{background:var(--tint);color:var(--accent)}.nav svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.5}.rail-foot{margin-top:auto;padding:40px 12px 0}.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--green);margin-right:7px}.rail-foot p{margin-top:8px;font-size:12px;color:var(--muted)}.workspace{min-width:0}.topbar{padding:16px 36px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:16px;background:var(--surface)}.topbar .trail{font-size:12px;color:var(--muted)}.topbar .trail strong{color:var(--ink);font-weight:500}.preview{font:11px var(--mono);color:var(--accent);border:1px solid var(--line);border-radius:5px;padding:5px 8px;white-space:nowrap}.content{max-width:1440px;margin:auto;padding:34px 36px}.heading{display:flex;justify-content:space-between;gap:24px;align-items:center}.heading p{color:var(--muted);margin-top:9px}.actions{display:flex;gap:8px;flex-wrap:wrap}.primary{background:var(--ink);color:var(--surface);border-color:var(--ink)}.primary:hover{background:var(--muted);color:var(--surface)}.context{display:flex;justify-content:space-between;gap:16px;align-items:center;margin:26px 0 22px}.context small{display:block;margin-top:5px}.segments{display:flex;gap:4px}.segments button{padding:6px 14px;min-height:36px}.badge{font-size:11px;display:inline-block;padding:3px 8px;border-radius:5px;background:var(--green-bg);color:var(--green);white-space:nowrap}.badge.neutral{background:var(--soft);color:var(--muted)}.badge.warn{background:var(--tint);color:var(--warning)}.tabs{display:flex;flex-wrap:wrap;gap:4px;border-bottom:1px solid var(--line);margin-bottom:24px;padding-bottom:8px}.tabs button{border:0;background:none;color:var(--muted);padding:8px 11px}.tabs button[aria-pressed=true]{color:var(--accent);background:var(--tint)}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(196px,1fr));gap:16px}.card{border:1px solid var(--line);background:var(--surface);border-radius:10px;overflow:hidden}.metric{padding:20px}.metric .value{font-size:30px;letter-spacing:-1px;margin:12px 0 8px;line-height:1.2}.metric:first-child{border-top:3px solid var(--accent);padding-top:18px}.metric .value small{font-size:14px;letter-spacing:0}.panel-head{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:20px 22px}.panel-head p{font-size:12px;color:var(--muted);margin-top:4px}.grid{display:grid;grid-template-columns:1.6fr 1fr;gap:20px;margin-top:20px}.bars{padding:6px 22px 22px;display:grid;gap:20px}.bar-label{display:flex;justify-content:space-between;gap:12px;margin-bottom:8px;font-size:13px}.track{height:8px;background:var(--soft);border-radius:3px;overflow:hidden}.fill{height:100%;background:var(--accent);border-radius:3px}.bar:nth-child(even) .fill{background:#747f67}.footnote{border-top:1px solid var(--line);padding:12px 22px;font-size:12px;color:var(--muted)}.notice{display:flex;gap:12px;border:1px solid var(--line);background:var(--soft);padding:14px 18px;border-radius:8px;margin-top:24px;font-size:12px;color:var(--muted)}.notice strong{color:var(--ink)}.toolbar{display:flex;gap:12px;flex-wrap:wrap;align-items:end;padding:0 22px 18px}.toolbar label{display:grid;gap:5px;font-size:12px;color:var(--muted)}input,select{background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:9px 12px;min-height:40px;max-width:100%}input{width:250px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;text-align:left;white-space:nowrap}th{font-size:11px;text-transform:uppercase;letter-spacing:.7px;color:var(--muted);font-weight:500;background:var(--bg)}th,td{padding:13px 22px;border-top:1px solid var(--line)}td{font-size:13px}td:last-child{text-align:right}tbody tr:hover{background:var(--bg)}.empty{text-align:center;padding:56px 24px}.empty h2{margin:12px 0 8px}.empty p{max-width:440px;margin:auto;color:var(--muted)}.empty .eyebrow{color:var(--accent)}.chart{display:grid;grid-template-columns:52px minmax(0,1fr);gap:10px;padding:8px 22px 0}.chart-axis{display:flex;flex-direction:column;justify-content:space-between;text-align:right;padding:4px 0;font:12px var(--mono);color:var(--muted)}.line-chart{display:block;width:100%;height:180px;overflow:visible}.chart-grid{stroke:var(--line);stroke-width:1;vector-effect:non-scaling-stroke}.activity-line{fill:none;stroke:var(--accent);stroke-width:2.5;stroke-linejoin:round;vector-effect:non-scaling-stroke}.line-point{fill:var(--surface);stroke:var(--accent);stroke-width:2;vector-effect:non-scaling-stroke}.chart-dates{grid-column:2;display:flex;justify-content:space-between;font:12px var(--mono);color:var(--muted)}.chart-note{padding:20px 22px;font-size:12px;color:var(--muted)}.section-gap{margin-top:20px}footer{display:flex;justify-content:space-between;gap:12px;margin-top:20px;font-size:11px;color:var(--muted)}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}details{padding:12px 22px}summary{cursor:pointer;min-height:32px}.theme-dark{color-scheme:dark;--bg:#181c19;--surface:#202521;--soft:#2b312b;--ink:#eef0e8;--muted:#bdc5b8;--line:#40493e;--accent:#ffad80;--tint:#392b22;--green:#b1d4b9;--green-bg:#29372d;--warning:#edc78f}noscript{display:block;padding:24px}.content a{color:var(--accent)}@media(max-width:1100px){.shell{grid-template-columns:188px minmax(0,1fr)}.content{padding:28px 24px}.topbar{padding:16px 24px}.grid{grid-template-columns:1fr}.metrics{gap:10px}.metric{padding:16px}.metric:first-child{padding-top:14px}.metric .value{font-size:26px}.heading{align-items:flex-start}}@media(max-width:760px){.shell{display:block}aside{padding:16px;border-right:0;border-bottom:1px solid var(--line)}.brand{padding:0 0 16px}.nav{display:flex;flex-wrap:wrap}.nav button{flex:1}.rail-foot,aside .eyebrow{display:none}.topbar{padding:12px 16px}.content{padding:24px 16px}.heading{display:block}.actions{margin-top:18px}.context{align-items:flex-start;flex-direction:column}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.tabs button{min-height:44px}.panel-head{padding:18px 16px;flex-wrap:wrap}.toolbar{padding-left:16px;padding-right:16px}input{width:100%}.toolbar label{flex:1;min-width:120px}footer{flex-wrap:wrap}.chart{gap:8px;padding-left:16px;padding-right:16px}.notice{align-items:flex-start}.trail{overflow-wrap:anywhere}}@media(prefers-reduced-motion:no-preference){button{transition:background .15s,border-color .15s}}@media print{aside,.topbar,.actions,.tabs,.toolbar,.segments{display:none}.shell{display:block}.content{padding:0}.card{break-inside:avoid}}\n[hidden]{display:none!important}.time-range{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:16px 20px;margin-bottom:22px;background:var(--surface);border:1px solid var(--line);border-radius:10px}.time-range small{display:block;margin-top:4px}.time-range .segments{flex-wrap:wrap}.time-range button{min-height:44px}dialog{background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:12px;padding:24px;width:min(440px,calc(100% - 32px))}dialog::backdrop{background:#0008}dialog form{display:grid;gap:18px}dialog label{display:grid;gap:6px}dialog input{width:100%}dialog .actions{justify-content:flex-end;margin-top:0}.date-error{color:var(--accent);font-size:13px}\n.utility-actions button{background:transparent;color:var(--muted);font-size:12px;padding:6px 10px}.utility-actions button:hover{color:var(--ink);background:var(--soft)}.data-scope{display:flex;gap:24px;flex-wrap:wrap;align-items:center;border:1px solid var(--line);border-radius:10px;background:var(--surface);padding:16px 20px;margin-bottom:22px}.scope-group{display:grid;gap:8px}.scope-group .eyebrow{font-weight:600}.scope-group button{min-height:44px}button:disabled{opacity:.6;cursor:not-allowed}.data-scope .time-range{flex:1;min-width:240px;border:0;border-radius:0;padding:0;margin:0}.data-scope .time-range small{font-size:12px}.breakdown{display:grid;gap:4px;margin-top:12px;padding-top:10px;border-top:1px solid var(--line);font-size:12px;color:var(--muted)}.breakdown-row{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}.breakdown .mono{color:var(--ink)}.history-table th,.history-table td{padding:10px 12px}.history-table th:first-child,.history-table td:first-child{padding-left:20px}.history-table small{display:block}.history-table .number{text-align:right;font-variant-numeric:tabular-nums}.history-table button{min-height:40px;padding:6px 10px}.history-table .badge{font-size:12px}.history-table-wrap:focus-visible{outline:3px solid var(--accent);outline-offset:-3px}@media(max-width:760px){.data-scope{padding:16px;gap:16px}.data-scope .time-range{flex-basis:100%;min-width:0;border-top:1px solid var(--line);padding-top:16px}.utility-actions{margin-top:12px}.chart{grid-template-columns:42px minmax(0,1fr);padding-left:16px;padding-right:16px}.chart-axis,.chart-dates{font-size:12px}}.range-note{flex-basis:100%;font-size:12px;color:var(--muted);margin:8px 0 0}\n';
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
<div class="heading"><div><p class="eyebrow" id="kicker"></p><h1 id="title"></h1><p id="subtitle"></p></div><div class="actions utility-actions"><button id="theme" aria-pressed="${themePressed ? "true" : "false"}">${themePressed ? t["theme.light"] : t["theme.dark"]}</button></div></div><div class="context"><div><span class="mono" id="session-label"></span> <span class="badge neutral">${t["tag.snapshot"]}</span><small id="scope-note"></small></div></div>
<div class="notice" id="wal-detail" hidden><span aria-hidden="true">ⓘ</span><div><strong>${t["walDetail.expired"]}</strong> ${t["walDetail.copy"]}</div></div>
<div class="data-scope" role="group" aria-label="Data scope"><div class="scope-group"><p class="eyebrow">${t["scope.label"]}</p><div class="segments" id="scope" aria-label="${t["scope.label"]}"><button data-scope="active">${t["scope.active"]}</button><button data-scope="tree">${t["scope.tree"]}</button></div><small id="scope-sub"></small><small id="scope-fixed" hidden>${t["scope.fixed"]}</small></div><section class="time-range" id="time-range" aria-label="${t["range.label"]}" hidden><div><p class="eyebrow">${t["range.label"]}</p><strong id="range-name"></strong><div class="mono" id="range-dates" aria-live="polite"></div><small>${t["range.inclusive"]}</small></div><div class="segments"><button data-days="7">7D</button><button data-days="14">14D</button><button data-days="30">30D</button><button id="custom-range" aria-haspopup="dialog">${t["range.custom"]}</button></div>${rangeNotice}</section></div>
<dialog id="date-dialog" aria-labelledby="date-title"><form id="date-form"><h2 id="date-title">${t["range.custom.title"]}</h2><p class="muted">${t["range.inclusive"]}</p><label>${t["range.from"]}<input id="date-from" type="date" required aria-describedby="date-error"></label><label>${t["range.to"]}<input id="date-to" type="date" required aria-describedby="date-error"></label><p id="date-error" class="date-error" role="alert"></p><div class="actions"><button type="button" id="date-cancel">${t["range.cancel"]}</button><button type="submit" class="primary">${t["range.apply"]}</button></div></form></dialog>
<nav class="tabs" id="tabs" aria-label="Report section"></nav><div id="view"></div><div class="notice"><span aria-hidden="true">ⓘ</span><div><strong>${t["notice.sensitive"]}</strong> ${t["notice.copy"]}</div></div><footer><span>${t["footer.authority"]}</span><span class="mono">${t.offline}</span></footer><p id="announcement" class="sr-only" role="status"></p></main></div></div><noscript>This report requires JavaScript. It is self-contained and makes no network requests.</noscript><script type="application/json" id="report-data">${data}</script><script type="application/json" id="catalog-data">${JSON.stringify(t)}</script><script>\n`;
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
const TABS=["overview","models","tools","environment","agents","integrations","errors","ledger"];
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
const state={section:"current",scope:data.initialScope,tab:"overview",envTab:"commands",session:null,query:"",sort:"default",metric:CURRENT_METRICS[0],resetScroll:false};
// One unresolved range intent per view identity: "current" is shared by both
// scopes, history is split between its aggregate and each session.
const rangeIntents={};
// One selected tool name per view identity: that identity's calls view narrows
// to it and the clear-filter control returns every call. A filter is per-table
// state of the view it was chosen in, never a figure another view inherits.
const toolFilters={};
const currentView=()=>data.current[state.scope];
const currentReport=()=>{const view=currentView();return view&&view.availability==="available"?view.report:null;};
const historySessions=()=>data.history.sessions||[];
const selectedSession=()=>state.section==="history"&&state.session!==null?historySessions()[state.session]:null;
const viewIdentity=()=>state.section==="history"?(state.session===null?"history:aggregate":"history:"+historySessions()[state.session].sessionId):state.section;
const activeIntent=()=>rangeIntents[viewIdentity()];
const activeToolFilter=()=>toolFilters[viewIdentity()]||null;
const activeDaily=()=>{if(state.section==="current")return (currentView()&&currentView().daily)||[];if(state.section==="global")return data.global.daily||[];const session=selectedSession();if(session)return session.availability==="available"?(session.usageByDate||[]).map(row=>({...row,sessions:1})):[];return data.history.daily||[];};
const activeRange=()=>resolveRange(activeIntent(),activeDaily().map(row=>row.date),viewIdentity()==="current"?"current":"aggregate");
const period=()=>activeRange()||{preset:null,from:"",to:""};
const rangeText=()=>{const range=activeRange();return range?range.from+" → "+range.to:tr("evidence.unavailable");};

function chartValue(row,metric){if(metric==="cost")return row.cost;if(metric==="tokens")return row.totalTokens;if(metric==="generations")return row.generations||0;if(metric==="tools")return row.tools||0;return row.sessions;}
function chartText(metric,value){return metric==="cost"?money(value):number(value);}
function chartLabel(metric){return tr(CHART_LABELS[metric]);}
function selectedDays(){return activeDaily().filter(row=>row.date>=period().from&&row.date<=period().to);}
function tokenCell(usage,key){return orUnavailable(usage[key]);}
const activeMetrics=()=>state.section==="current"?CURRENT_METRICS:(state.section==="history"?(data.history.chartMetrics||CURRENT_METRICS):(data.global.chartMetrics||GLOBAL_METRICS));
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
function rangeTruncated(){const range=activeRange();if(!range)return false;if(state.section==="current"){const view=currentView();return !!view&&view.dailyTruncated===true&&reachesBeforeRetained(view.daily,range);}if(state.section==="global")return data.global.dailyTruncated===true&&reachesBeforeRetained(data.global.daily,range);const session=selectedSession();if(session)return session.availability==="available"&&!!(session.usageByDate||[]).length&&historyRowRange(session,range).partial===true;return partialContribution(range);}
// A restore claim needs a view with observed dates: with none, no range — and no default — exists.
function syncRangeNotice(){const text=activeIntent()!==undefined&&!activeRange()&&latestObservedDate(activeDaily().map(row=>row.date))!==undefined?tr("range.restored"):(rangeTruncated()?tr(state.section==="current"?"range.truncated":"history.dailyTruncated"):"");let notice=q("range-truncated");if(!text){if(notice)notice.hidden=true;return;}if(!notice){notice=el("p","range-note",text);notice.id="range-truncated";q("time-range").append(notice);}notice.textContent=text;notice.hidden=false;}
// An aggregate row's range verdict (design §5.6): membership needs an in-range
// retained row, never a span overlap; omitted history is unknown, never zero.
function inPeriodRow(entry,range){if(!entry||entry.availability!=="available"||!range||!(entry.usageByDate||[]).length)return {group:"unknown"};const verdict=historyRowRange(entry,range);if(verdict.member)return {group:"member",verdict:verdict};return {group:verdict.partial?"unknown":"out"};}
function historyMetrics(members){let totalTokens=0,cost=0,partial=false;members.forEach(item=>{partial=partial||item.verdict.partial;totalTokens+=item.verdict.totalTokens;cost+=item.verdict.cost});return {totalTokens:totalTokens,cost:Math.round(cost*1e12)/1e12,sessions:members.length,partial:partial};}
function historyRows(){const range=activeRange(),members=[],unknown=[];historySessions().forEach((entry,index)=>{const row=inPeriodRow(entry,range);if(row.group==="member")members.push({entry:entry,index:index,verdict:row.verdict});else if(row.group==="unknown")unknown.push({entry:entry,index:index})});return {members:members,unknown:unknown};}
// Any contributing session whose retained window cannot represent this range.
function partialContribution(range){return historySessions().some(entry=>!!entry&&entry.availability==="available"&&!!(entry.usageByDate||[]).length&&historyRowRange(entry,range).partial===true);}
function knownValue(value,key,note){const node=el("span","",value+" ");node.append(badge(tr(key),"warn"));if(note)node.append(el("small","",note));return node;}
const cellText=cell=>cell instanceof Node?text(cell.textContent):text(cell);
function card(title,subtitle,right){const node=el("section","card"),head=el("div","panel-head"),copy=document.createElement("div");copy.append(el("h2","",title),el("p","",subtitle));head.append(copy);if(right)head.append(right);node.append(head);return node;}
function simpleTable(section,headers,rows){const wrap=el("div","table-wrap"),node=document.createElement("table"),head=document.createElement("thead"),headRow=document.createElement("tr"),body=document.createElement("tbody");headers.forEach(value=>headRow.append(el("th","",value)));head.append(headRow);rows.forEach(row=>{const rowNode=document.createElement("tr");row.forEach(value=>{const cell=document.createElement("td");if(value instanceof Node)cell.append(value);else cell.textContent=text(value);rowNode.append(cell);});body.append(rowNode);});node.append(head,body);wrap.append(node);section.append(wrap);return section;}
function table(title,subtitle,headers,rows,before){const section=card(title,subtitle);if(before)section.append(before);const toolbar=el("div","toolbar"),searchLabel=el("label","",tr("search")),search=document.createElement("input"),sortLabel=el("label","",tr("sort")),sort=document.createElement("select");search.id="search";search.type="search";search.value=state.query;search.placeholder=tr("search.placeholder");sort.id="sort";[["default","sort.default"],["name","sort.name"],["reverse","sort.reverse"]].forEach(item=>{const option=el("option","",tr(item[1]));option.value=item[0];option.selected=state.sort===item[0];sort.append(option);});searchLabel.append(search);sortLabel.append(sort);toolbar.append(searchLabel,sortLabel);section.append(toolbar);let shown=rows.filter(row=>row.map(cellText).join(" ").toLowerCase().includes(state.query.toLowerCase()));if(state.sort==="name")shown=shown.slice().sort((left,right)=>cellText(left[0]).localeCompare(cellText(right[0]),"en"));if(state.sort==="reverse")shown=shown.slice().reverse();return simpleTable(section,headers,shown);}
function metric(title,value,note,details){const node=el("section","card metric");node.append(el("div","muted",title),el("div","value mono",value),el("small","",note));const block=el("div","breakdown");(details||[]).forEach(item=>{const row=el("div","breakdown-row");row.append(el("span","",item[0]),el("span","mono",text(item[1])));block.append(row);});node.append(block);return node;}
function bars(title,subtitle,rows){const section=card(title,subtitle,badge(tr("evidence.native"),"")),body=el("div","bars");if(rows.length===0)body.append(el("p","muted",tr("bars.empty")));rows.forEach(item=>{const row=el("div","bar"),label=el("div","bar-label");label.append(el("span","mono",item.label),el("span","mono",item.value));const track=el("div","track"),fill=el("div","fill");fill.style.width=item.percent+"%";track.append(fill);row.append(label,track);body.append(row);});section.append(body);return section;}
function emptyCard(title,note,eyebrowKey){const section=el("section","card empty");section.append(el("p","eyebrow",tr(eyebrowKey)),el("h2","",title),el("p","",note));return section;}
function unavailableSection(title,reason){return emptyCard(title,reason,"evidence.unavailable");}
function coveragePanel(section){const coverage=section.coverage,labels=section.usageLabels,line=coverage&&coverage.line?coverage.line:tr(labels.sessions),node=card(tr("coverage.title"),line);if(coverage&&coverage.reasons)node.append(el("div","footnote",tr("coverage.reasons",{reasons:coverage.reasons})));return node;}
function compositionCard(composition,subtitle){if(!composition.available)return unavailableSection(tr("usage.title"),tr("unavailable.composition"));const section=card(tr("usage.title"),subtitle||tr("usage.note"),badge(composition.reconciles?tr("usage.reconciled"):tr("usage.unreconciled"),composition.reconciles?"":"warn")),rows=composition.parts.map(part=>[tr("metric.usage."+part.key),number(part.totalTokens),money(part.cost),badge(tr("evidence."+part.confidence),confidenceTone(part.confidence))]);rows.push([tr("usage.total"),number(composition.total.totalTokens),money(composition.total.cost),badge(tr("evidence.native"),"")]);return simpleTable(section,[tr("table.source"),tr("table.tokens"),tr("table.cost"),tr("table.confidence")],rows);}
function evidencePanel(evidence){const section=card(tr("panel.evidence"),tr("evidence.note"),badge(tr("evidence.source"),"neutral"));return simpleTable(section,[tr("table.source"),tr("table.observation"),tr("table.confidence")],evidence.map(row=>[row.source,row.observation,badge(row.confidence,confidenceTone(row.confidence))]));}
function currentEvidence(){const view=data.current[state.scope];return (view&&view.evidence)||[];}
function activeEvidence(){if(state.section==="current")return currentEvidence();if(state.section==="history")return data.history.evidence||[];return data.global.evidence||[];}
function chart(){const rows=selectedDays(),label=chartLabel(state.metric),section=card(tr("panel.daily"),rangeText()),select=document.createElement("select");select.id="chart-metric";select.setAttribute("aria-label",tr("chart.metric"));activeMetrics().forEach(value=>{const option=el("option","",chartLabel(value));option.value=value;option.selected=state.metric===value;select.append(option);});section.querySelector(".panel-head").append(select);if(rows.length===0){section.append(el("div","chart-note",tr("chart.empty")));return section;}const values=rows.map(row=>chartValue(row,state.metric)),maximum=Math.max.apply(null,values.concat([1])),firstDate=Date.parse(rows[0].date+"T00:00:00Z"),lastDate=Date.parse(rows[rows.length-1].date+"T00:00:00Z"),span=lastDate-firstDate,points=rows.map((row,index)=>{const x=span<=0?400:8+((Date.parse(row.date+"T00:00:00Z")-firstDate)/span)*784;return {x:x,y:172-(values[index]/maximum)*164,row:row,value:values[index]};}),chartNode=el("div","chart"),axis=el("div","chart-axis");axis.setAttribute("aria-hidden","true");[maximum,maximum/2,0].forEach(value=>axis.append(el("span","",chartText(state.metric,value))));const svg=document.createElementNS(SVG_NS,"svg");svg.setAttribute("class","line-chart");svg.setAttribute("viewBox","0 0 800 180");svg.setAttribute("preserveAspectRatio","none");svg.setAttribute("role","img");svg.setAttribute("aria-label",tr("chart.aria",{metric:label,days:rows.length}));[8,90,172].forEach(y=>{const line=document.createElementNS(SVG_NS,"line");line.setAttribute("class","chart-grid");line.setAttribute("x1","8");line.setAttribute("x2","792");line.setAttribute("y1",String(y));line.setAttribute("y2",String(y));svg.append(line);});const polyline=document.createElementNS(SVG_NS,"polyline");polyline.setAttribute("class","activity-line");polyline.setAttribute("points",points.map(point=>point.x.toFixed(2)+","+point.y.toFixed(2)).join(" "));svg.append(polyline);points.forEach(point=>{const circle=document.createElementNS(SVG_NS,"circle");circle.setAttribute("class","line-point");circle.setAttribute("cx",point.x.toFixed(2));circle.setAttribute("cy",point.y.toFixed(2));circle.setAttribute("r","3");const title=document.createElementNS(SVG_NS,"title");title.textContent=point.row.date+" · "+chartText(state.metric,point.value);circle.append(title);svg.append(circle);});chartNode.append(axis,svg,el("div","chart-dates",rows[0].date+" → "+rows[rows.length-1].date));section.append(chartNode,el("div","chart-note",tr("chart.note",{metric:label})));const details=document.createElement("details"),summary=el("summary","",tr("chart.data")),headers=[tr("table.date"),tr("table.sessions"),tr("table.tokens"),tr("table.cost")],withGenerations=activeMetrics().indexOf("generations")>=0,withTools=activeMetrics().indexOf("tools")>=0;if(withGenerations)headers.push(tr("table.generations"));if(withTools)headers.push(tr("table.tools"));const tableRows=rows.map(row=>{const cells=[row.date,number(row.sessions),number(row.totalTokens),money(row.cost)];if(withGenerations)cells.push(number(row.generations));if(withTools)cells.push(number(row.tools));return cells;});details.append(summary);simpleTable(details,headers,tableRows);section.append(details);return section;}
function overview(view){if(view.usage===undefined)return unavailableSection(tr("usage.title"),tr("unavailable.usage"));const range=activeRange(),totals=range?periodTotals(activeDaily(),range):null;if(!totals||totals.days===0)return emptyOverview();const partial=rangeTruncated(),cost=money(totals.cost),tokens=number(totals.totalTokens),metrics=el("div","metrics");metrics.append(metric(tr(partial?"metric.knownCost":"metric.cost"),cost,tr("metric.native"),[[tr("evidence.native"),cost],[tr("metric.child")+ALL_DATES,view.agentCount===null?tr("evidence.unavailable"):number(view.agentCount)+" · "+tr("metric.child.note")]]),metric(tr(partial?"metric.knownTokens":"metric.tokens"),tokens,tr("metric.tokens.note"),[[tr("metric.input")+ALL_DATES,tokenCell(view.usage,"inputTokens")],[tr("metric.output")+ALL_DATES,tokenCell(view.usage,"outputTokens")],[tr("metric.cacheRead")+ALL_DATES,tokenCell(view.usage,"cacheReadTokens")],[tr("metric.cacheWrite")+ALL_DATES,tokenCell(view.usage,"cacheWriteTokens")],[tr("usage.total"),tokens]]),metric(tr("metric.generations"),number(totals.generations),tr("metric.generations.note"),[[tr("evidence.native"),number(view.generationCount)+ALL_DATES]]),metric(tr("metric.tools"),number(view.toolCount),tr("metric.tools.note")+ALL_DATES,[[tr("evidence.native"),number(view.toolCount)]]),metric(tr("metric.duration"),orUnavailable(view.durationLabel),tr("metric.duration.note")+ALL_DATES,[[tr("evidence.native"),view.span?view.span.from+" → "+view.span.to:tr("evidence.unavailable")]]));const grid=el("div","grid");grid.append(bars(tr("panel.models"),tr("models.note")+ALL_DATES,view.modelBars),bars(tr("panel.tools"),tr("tools.bars.note")+ALL_DATES,view.toolBars));const all=el("div","");all.append(metrics,grid,compositionCard(totals&&activeDaily().some(row=>row.composition)?periodComposition(totals):view.composition,totals&&activeDaily().some(row=>row.composition)?null:tr("usage.note")+ALL_DATES),evidencePanel(activeEvidence()));return all;}
// A selected range with no in-range observation renders the empty state: never
// a clamped window, never a fabricated zero (design §5.5-4).
// The one range-qualified empty state: a selected range with no in-range observation.
function rangeEmpty(){return unavailableSection(tr("usage.title"),tr("chart.empty"));}
function emptyOverview(){const node=el("div","");node.append(rangeEmpty(),evidencePanel(activeEvidence()));return node;}
// Child-run metrics: the closed status enum's buckets in one fixed order, so
// every run is counted in exactly one bucket and none is dropped or folded.
const AGENT_STATUS_BUCKETS=["succeeded","failed","interrupted","running","unknown"];
// The run ids a parent may resolve to: every projection of this same session the
// document carries (both current scopes, or the selected history session's own
// tree projection), never another session's runs.
function sameSessionAgentIds(view){const ids=new Set(),add=candidate=>{const projection=candidate&&candidate.availability==="available"?candidate.report:null;if(!projection||projection.sessionId!==view.sessionId)return;(projection.agents||[]).forEach(run=>{ids.add(run.id)});};if(state.section==="current"){add(data.current.active);add(data.current.tree);}else{add(selectedSession()&&selectedSession().view);}(view.agents||[]).forEach(run=>{ids.add(run.id)});return ids;}
// Parent resolution (spec §7.4): the rendered parent is named by its role label
// (its own bounded id is the fallback), a parent the selected projection
// excludes is labelled and never linked, and an id nothing knows stays
// Unavailable. A bare hash is never shown without one of these verdicts.
function parentCell(row,rendered,known){if(row.parentId===null)return tr("evidence.unavailable");const parent=rendered[row.parentId];if(parent)return parent.agent===null?row.parentId:parent.agent;return known.has(row.parentId)?tr("agents.parentOutsideScope"):tr("agents.parentUnknown");}
// Why a range-filtered run set can be empty: a run with no observed time cannot
// be placed in any range, and a dated run outside the range is not a data gap.
function agentRangeNote(view){const undated=view.agents.filter(run=>!run.observedAt).length;if(undated===0)return tr("agents.outOfRange");if(undated===view.agents.length)return tr("agents.undated");return tr("agents.undatedAndOutOfRange");}
// Role, status, model, tokens, cost, artifacts and parent verdict, in the fixed
// column order. Child model and thinking stay metadata: there is no Agent ->
// Models link, and thinking is shown by the row's own detail, never as a link.
function agentRunCells(rows,known){const rendered={};rows.forEach(run=>{rendered[run.id]=run;});return rows.map(row=>[orUnavailable(row.agent),badge(tr("agents."+row.status),row.status==="failed"||row.status==="interrupted"?"warn":"neutral"),orUnavailable(row.model),row.usage?number(row.usage.totalTokens):tr("evidence.unavailable"),row.usage?money(row.usage.cost):tr("evidence.unavailable"),orUnavailable(row.artifacts),parentCell(row,rendered,known)]);}
// The child-run summary is drawn from the rows being rendered, so a range filter
// narrows the counts and the fraction instead of reusing a full-session figure.
// Usage stays a breakdown: no rendered run reporting usage makes tokens and cost
// read Unavailable, never a fabricated zero.
function agentSummary(rows){const total=rows.length,withUsage=rows.filter(run=>!!run.usage).length,fraction=tr("agents.usageFraction",{withUsage:withUsage,total:total}),failed=rows.filter(run=>run.status==="failed"),failedWithUsage=failed.filter(run=>!!run.usage).length,tokens=rows.reduce((sum,run)=>sum+(run.usage?run.usage.totalTokens:0),0),cost=rows.reduce((sum,run)=>sum+(run.usage?run.usage.cost:0),0),failedCost=failed.reduce((sum,run)=>sum+(run.usage?run.usage.cost:0),0),metrics=el("div","metrics");metrics.append(metric(tr("agents.childRuns"),number(total),tr("metric.child.note")));AGENT_STATUS_BUCKETS.forEach(status=>{const count=rows.filter(run=>run.status===status).length;if(count>0)metrics.append(metric(tr("agents."+status),number(count),tr("metric.child.note")));});metrics.append(metric(tr("agents.knownTokens"),withUsage===0?tr("evidence.unavailable"):number(tokens),fraction),metric(tr("agents.knownCost"),withUsage===0?tr("evidence.unavailable"):money(cost),fraction));if(failedWithUsage>0)metrics.append(metric(tr("agents.knownFailedCost"),money(failedCost),tr("agents.usageFraction",{withUsage:failedWithUsage,total:failed.length})));return metrics;}
// Child runs first (summary then table), then the separate native agent tool
// activity card: how often the launching tool ran is never a child-run count.
function agentsPanel(view,title){const wrap=el("div",""),activity=view.agentActivity;if(view.agentEvidence==="supported"){const filtered=filteredView(view),rows=filtered?filtered.agents:view.agents;if(rows.length===0&&filtered&&view.agents.length>0)wrap.append(emptyCard(title,agentRangeNote(view),"evidence.unavailable"));else{const section=table(title,tr("agents.note")+(filtered?"":ALL_DATES),[tr("table.role"),tr("table.status"),tr("table.model"),tr("table.tokens"),tr("table.cost"),tr("table.artifacts"),tr("table.parent")],agentRunCells(rows,sameSessionAgentIds(view)),agentSummary(rows));wrap.append(section);}}else wrap.append(unavailableSection(title,tr("agents.none")));if(activity&&activity.state==="supported"){const section=card(tr("panel.agentActivity"),tr("agents.activity.note")+ALL_DATES,badge(tr("evidence."+activity.state),confidenceTone(activity.state))),metrics=el("div","metrics");metrics.append(metric(tr("table.calls"),number(activity.calls),tr("metric.tools.note"),[[tr("agents.succeeded"),number(activity.succeeded)],[tr("agents.failed"),number(activity.failed)],[tr("agents.interrupted"),number(activity.interrupted)]]));section.append(metrics);if(activity.tools&&activity.tools.length>0)simpleTable(section,[tr("table.tool"),tr("table.calls")],activity.tools.map(row=>[row.name,number(row.calls)]));wrap.append(section);}return wrap;}
function commandsPanel(view,title){const commands=view.commands;if(!commands||commands.items.length===0)return emptyCard(title,commands&&commands.count!==null?tr("commands.count",{count:number(commands.count)}):tr("unavailable.commands"),"evidence.unavailable");return table(title,tr("commands.note"),[tr("table.name"),tr("table.source"),tr("table.scope"),tr("table.origin"),tr("table.description")],commands.items.map(row=>[row.name,orUnavailable(row.sourceLabel||row.source||null),row.scope,row.origin,orUnavailable(row.description)]));}
function skillsPanel(view,title){const skills=view.skills;if(!skills)return unavailableSection(title,tr("unavailable.skills"));const section=skills.items.length===0?emptyCard(title,tr("skills.empty"),"evidence.unavailable"):table(title,tr("skills.note"),[tr("table.name"),tr("table.source"),tr("table.scope"),tr("table.origin"),tr("table.invocations")],skills.items.map(row=>[row.name,orUnavailable(row.sourceLabel),orUnavailable(row.scope),orUnavailable(row.origin),row.explicitInvocations===undefined?tr("evidence.unavailable"):number(row.explicitInvocations)]));if(skills.otherInvocations!==null&&skills.otherInvocations!==undefined&&skills.otherInvocations>0)section.append(el("div","footnote",tr("skills.otherInvocations",{count:number(skills.otherInvocations)})));return section;}
function resourcesCard(resources){if(!resources||resources.state!=="supported"||resources.items.length===0)return unavailableSection(tr("panel.resources"),tr("resources.unavailable"));return simpleTable(card(tr("panel.resources"),tr("resources.note")),[tr("table.source"),tr("table.scope"),tr("table.origin"),tr("table.commands"),tr("table.skills"),tr("table.prompts"),tr("table.tools")],resources.items.map(row=>[row.sourceLabel,row.scope,row.origin,number(row.commands),number(row.skills),number(row.prompts),number(row.tools)]));}
// The availability count of one inventory (design §8.1): its own persisted count
// when the DTO carries one, else its rows. An unsupported inventory with neither
// is Unavailable, and a folded counter that outlived its inventory is never read
// as availability.
function inventoryCount(inventory,items){if(!inventory)return null;if(inventory.count!==null&&inventory.count!==undefined)return inventory.count;if(inventory.state!=="supported")return null;return (items||[]).length;}
function inventoryLine(label,inventory,items,observed){const count=inventoryCount(inventory,items);return el("div","metric",label+" "+tr("env.available",{count:count===null?tr("evidence.unavailable"):number(count)})+" · "+observed);}
// The environment summary: availability is inventory state and, for skills only,
// the explicit folded invocation counters are the invocation figure. No inventory
// count is ever presented as activity, and no line is range-filtered or labelled
// with the selected range.
function environmentSummary(view){const lines=el("div","metrics"),commands=view.commands,skills=view.skills,resources=view.resources;lines.append(inventoryLine(tr("env.commands"),commands,commands&&commands.items,tr("env.observed",{value:tr("evidence.unavailable")})));const observed=skills&&skills.invocationState==="supported"&&skills.invocationCount!==null&&skills.invocationCount!==undefined?tr("env.invocationsObserved",{count:number(skills.invocationCount)}):tr("env.invocationsUnavailable");lines.append(inventoryLine(tr("env.skills"),skills,skills&&skills.items,observed));const sources=inventoryCount(resources,resources&&resources.items);lines.append(el("div","metric",tr("env.resources")+" "+tr("env.sources",{count:sources===null?tr("evidence.unavailable"):number(sources)})));return lines;}
// One Environment panel: the summary lines stay visible while the sub-navigation
// selects which inventory table is shown, so the inventory is secondary to the
// diagnostic flow and never a primary tab (§8.1).
function environmentPanel(view,title){const wrap=el("div",""),summary=card(title,tr("env.note")),subnav=el("div","segments");summary.append(environmentSummary(view));subnav.setAttribute("aria-label",tr("tab.environment"));[["commands",tr("env.commands")],["skills",tr("env.skills")],["resources",tr("env.resources")]].forEach(item=>{const button=el("button","",item[1]);button.dataset.envTab=item[0];button.setAttribute("aria-pressed",String(state.envTab===item[0]));subnav.append(button);});wrap.append(summary,subnav);wrap.append(state.envTab==="skills"?skillsPanel(view,tr("env.skills")):state.envTab==="resources"?resourcesCard(view.resources):commandsPanel(view,tr("env.commands")));return wrap;}
// Telemetry is this row's evidence verdict plus its closed-vocabulary reason when
// the state is not supported. The detection note is a non-state remark: it never
// changes the telemetry value, and an absent producer with persisted telemetry
// stays a valid row (ADR 0009/0014).
function integrationTelemetry(row){const cell=el("span",""),reason=row.state==="unsupported"?tr("integration.reasonUnsupported"):row.state==="unavailable"?tr("integration.reasonMissing"):null;cell.append(badge(tr("evidence."+row.state),confidenceTone(row.state)));if(reason)cell.append(el("small","",reason));if(row.presence==="absent")cell.append(el("small","",tr("integration.noteNotDetected")));return cell;}
// Counters are the session-scope activity value, so the cell states the period;
// an absent counter object is Unavailable, never a fabricated zero.
function integrationActivity(row){return row.counters.length===0?tr("evidence.unavailable"):tr("integration.sessionTotal")+" · "+row.counters.join(" · ");}
function integrationVersion(row){return row.version===null?tr("evidence.unavailable"):String(row.version);}
function integrationsTable(view){return table(tr("panel.integrations"),tr("integrations.note"),[tr("table.integration"),tr("integration.detected"),tr("integration.telemetry"),tr("integration.activity"),tr("integration.version")],(view.integrations||[]).map(row=>[row.integration,presenceBadge(row.presence),integrationTelemetry(row),integrationActivity(row),integrationVersion(row)]));}
function integrationsPanel(view,title){const integrations=view.integrations||[];return integrations.length===0?unavailableSection(title,tr("unavailable.integrations")):integrationsTable(view);}
// The Models tab reads the view's own per-date model rows through the one
// filter, so a range change genuinely changes model figures (design §5.2). A
// current view and a history session detail both thread their projection's dated
// rows in; a payload without them (the legacy adapter) renders the aggregate
// rows unfiltered and states that they are all report dates. A dated source with
// no rows at all cannot be attributed to any date — Unavailable — while dated
// rows outside the range are a range statement.
function modelRangeRows(rows){const groups={},order=[];rows.forEach(row=>{const key=row.provider+"\u0000"+row.model,g=groups[key]||{provider:row.provider,model:row.model,generations:0,totalTokens:0,cost:0};if(!groups[key])order.push(key);groups[key]=g;g.generations+=row.generations||0;g.totalTokens+=row.totalTokens||0;g.cost+=row.cost||0});return order.sort().map(key=>{const g=groups[key];g.cost=Math.round(g.cost*1e12)/1e12;return g});}
function modelsPanel(view,title,source){if(source===undefined)return view.models.length===0?emptyCard(title,tr("models.none"),"evidence.native"):table(title,tr("models.note")+ALL_DATES,[tr("table.provider"),tr("table.model"),tr("table.generations"),tr("table.input"),tr("table.output"),tr("table.cacheRead"),tr("table.cacheWrite"),tr("table.tokens"),tr("table.cost")],view.models.map(row=>[row.provider,row.model,number(row.generations),numberOrUnavailable(row.inputTokens),numberOrUnavailable(row.outputTokens),numberOrUnavailable(row.cacheReadTokens),numberOrUnavailable(row.cacheWriteTokens),number(row.totalTokens),money(row.cost)]));const filtered=filteredView(view,source),rows=filtered?modelRangeRows(filtered.models):[],section=rows.length===0?(source.datedModels.length===0?unavailableSection(title,tr("models.none")):emptyCard(title,tr("chart.empty"),"evidence.unavailable")):table(title,tr("models.note"),[tr("table.provider"),tr("table.model"),tr("table.generations"),tr("table.tokens"),tr("table.cost")],rows.map(row=>[row.provider,row.model,number(row.generations),number(row.totalTokens),money(row.cost)]));if(source.modelsTruncated)section.append(el("div","footnote",tr("models.truncated")));return section;}
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
function toolFilterAnchor(name){const button=el("button","",name);button.dataset.toolFilter=name;button.setAttribute("aria-label",tr("tools.filteredBy",{tool:name}));return button;}
function toolSummaryCells(row){return [toolFilterAnchor(row.name),number(row.calls),number(row.succeeded),number(row.failed),number(row.interrupted),toolValueCell(number(row.tokens),"metric.knownTokens",row),toolValueCell(money(row.cost),"metric.knownCost",row),row.lastUsed,orUnavailable(row.source)];}
// Duration is live-correlated evidence only, never estimated from timestamps.
function toolDurationCell(row,evidence){const label=toolDuration(row,evidence);return label===null?tr("evidence.unavailable"):label+" · "+tr("evidence.live");}
function toolCallCells(rows,evidence){return rows.map(row=>[row.timestamp,row.name,orUnavailable(row.source),badge(tr("tools."+row.status),row.status==="succeeded"?"":"warn"),row.usage?number(row.usage.totalTokens):tr("evidence.unavailable"),row.usage?money(row.usage.cost):tr("evidence.unavailable"),toolDurationCell(row,evidence)]);}
function toolFilterBar(filter){const bar=el("div","toolbar"),clear=el("button","",tr("tools.clearFilter"));clear.dataset.clearFilter="true";bar.append(el("span","muted",tr("tools.filteredBy",{tool:filter})),clear);return bar;}
function toolCallsCard(rows,filtered,evidence,filter){const section=card(tr("tools.calls"),tr("tools.note")+(filtered?"":ALL_DATES));if(filter!==null)section.append(toolFilterBar(filter));return simpleTable(section,[tr("table.timestamp"),tr("table.tool"),tr("table.source"),tr("table.status"),tr("table.tokens"),tr("table.cost"),tr("table.duration")],toolCallCells(rows,evidence));}
function toolsPanel(view,title,filtered,context){const summary=toolSummary(context);if(summary.length===0)return emptyCard(title,filtered?tr("chart.empty"):tr("tools.none"),"evidence.native");const filter=activeToolFilter(),calls=toolCalls(context,filter),wrap=el("div",""),summarySection=table(tr("tools.summary"),tr("tools.note")+(filtered?"":ALL_DATES),[tr("table.tool"),tr("table.calls"),tr("tools.succeeded"),tr("tools.failed"),tr("tools.interrupted"),tr("table.tokens"),tr("table.cost"),tr("tools.lastUsed"),tr("table.source")],summary.map(toolSummaryCells),toolSummaryMetrics(summary)),callsSection=calls.length===0?emptyCard(tr("tools.calls"),tr("chart.empty"),"evidence.unavailable"):toolCallsCard(calls,filtered,view.durationEvidence,filter);if(filter!==null&&calls.length===0)callsSection.append(toolFilterBar(filter));wrap.append(summarySection,callsSection);return wrap;}
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
// The tool-call reference carries the call's own canonical id in data-tool-link:
// Task 15 points that reference at the calls route, and until the route exists it
// is an anchor with no href, so no dead destination is emitted (design §7.4).
function errorToolReference(row){const anchor=el("a","mono",text(row.toolName));anchor.dataset.toolLink=row.id;return anchor;}
// Every candidate the publishing result observed, in run order, one anchor per
// run and none of them named as a cause: the relation is one-to-many. A run whose
// role the projection does not carry is labelled Unavailable, never the raw run
// id. Zero candidates returns null, so the section is omitted entirely rather
// than inferred from a timestamp or padded with an unrelated run (design §7.5-3).
function errorChildrenLine(row,runs){if(row.relatedChildIds.length===0)return null;const list=el("span","mono","");row.relatedChildIds.forEach(id=>{const run=runs[id],anchor=el("a","mono",run&&run.agent?run.agent:tr("evidence.unavailable"));anchor.dataset.childLink=id;list.append(anchor);});return errorFieldLine(tr("errors.relatedChildren"),list);}
function errorDetails(row,runs){const details=document.createElement("details"),summary=el("summary","",errorHeadlineText(row)),body=el("div","breakdown");details.append(summary);body.append(errorFieldLine(tr("table.id"),row.id));if(row.toolName!==null)body.append(errorFieldLine(tr("errors.relatedTool"),errorToolReference(row)),errorFieldLine(tr("table.source"),orUnavailable(row.toolSource)),errorFieldLine(tr("table.status"),row.toolStatus===null?tr("evidence.unavailable"):badge(tr("tools."+row.toolStatus),row.toolStatus==="succeeded"?"":"warn")));const related=errorChildrenLine(row,runs);if(related!==null)body.append(related);details.append(body);return details;}
// The runs of the unfiltered view: a range filter narrows which errors are
// listed, never which run a candidate names — the join is a session fact — so a
// candidate keeps its own role even when its run falls outside the range.
function runRowsById(view){const runs={};(view.agents||[]).forEach(run=>{runs[run.id]=run;});return runs;}
function errorsPanel(view,title,filtered){const errors=filtered?filtered.errors:view.errors;if(errors.length===0)return emptyCard(title,filtered?tr("chart.empty"):tr("errors.none"),"evidence.native");const runs=runRowsById(view);return table(title,tr("errors.note")+(filtered?"":ALL_DATES),[tr("table.error"),tr("table.kind"),tr("table.timestamp"),tr("table.message"),tr("table.confidence")],errors.map(row=>[errorDetails(row,runs),row.kind,row.timestamp,errorMessageText(row),badge(tr("evidence."+row.confidence),confidenceTone(row.confidence))]));}
function detail(view,title,source){if(state.tab==="models")return modelsPanel(view,title,source);if(state.tab==="tools"){const filtered=filteredView(view);return toolsPanel(view,title,filtered,filtered||view);}if(state.tab==="environment")return environmentPanel(view,title);if(state.tab==="agents")return agentsPanel(view,title);if(state.tab==="integrations")return integrationsPanel(view,title);if(state.tab==="errors"){const filtered=filteredView(view);return errorsPanel(view,title,filtered);}if(state.tab==="ledger"){if(view.ledger.length===0)return emptyCard(title,tr("empty.ledger"),"evidence.unavailable");return table(title,tr("ledger.materialized"),[tr("table.timestamp"),tr("table.id"),tr("table.category"),tr("table.action"),tr("table.confidence")],view.ledger.map(item=>[item.timestamp,item.id,item.kind,item.status,item.confidence]));}return unavailableSection(title,tr("unavailable.copy"));}
function sessionCell(entry){const cell=document.createElement("div");cell.append(el("span","mono",entry.sessionId));cell.append(el("small","",entry.firstDate?(entry.firstDate+(entry.lastDate&&entry.lastDate!==entry.firstDate?" → "+entry.lastDate:"")):tr("evidence.unavailable")));return cell;}
function openButton(index){const button=el("button","",tr("table.open"));button.dataset.session=String(index);button.setAttribute("aria-label",tr("table.open")+" "+historySessions()[index].sessionId);return button;}
function historyRowCells(item,group){const entry=item.entry,verdict=item.verdict,partial=group==="member"&&verdict.partial,member=group==="member";return [sessionCell(entry),orUnavailable(entry.durationLabel),member?(partial?knownValue(number(verdict.totalTokens),"metric.knownTokens"):number(verdict.totalTokens)):tr("evidence.unavailable"),entry.generationCount===null?tr("evidence.unavailable"):number(entry.generationCount),entry.agentCount===null?tr("evidence.unavailable"):number(entry.agentCount),entry.status?badge(tr(entry.status.key),entry.status.tone):tr("evidence.unavailable"),member?(partial?knownValue(money(verdict.cost),"metric.knownCost"):money(verdict.cost)):tr("evidence.unavailable"),entry.view?openButton(item.index):""];}
function historyTable(classified){const section=card(tr("panel.history"),tr("history.note")),headers=[tr("table.session"),tr("table.duration"),tr("table.tokens"),tr("table.generations"),tr("table.agents"),tr("table.status"),tr("table.cost")];headers.push(tr("table.inspect"));const rows=classified.members.map(item=>historyRowCells(item,"member"));if(classified.unknown.length){rows.push([el("strong","",tr("history.groupUnknown"))]);classified.unknown.forEach(item=>rows.push(historyRowCells(item,"unknown")))}simpleTable(section,headers,rows);section.append(el("div","footnote",tr("table.duration")+", "+tr("table.generations")+", "+tr("table.agents")+ALL_DATES));const wrap=section.querySelector(".table-wrap"),node=section.querySelector("table");if(wrap)wrap.className="table-wrap history-table-wrap";if(node)node.className="history-table";return section;}
function historyOverview(){const range=activeRange(),classified=historyRows(),members=historyMetrics(classified.members),partial=members.partial||!!range&&partialContribution(range),totals=range?periodTotals(activeDaily(),range):null,empty=!!totals&&totals.days===0,labels=data.history.usageLabels,costLabel=partial&&labels.cost==="metric.cost"?"metric.knownCost":labels.cost,tokensLabel=partial&&labels.tokens==="metric.tokens"?"metric.knownTokens":labels.tokens,attributable=members.sessions>0||classified.unknown.length===0,costValue=labels.usageUnavailable?tr("metric.costUnavailable"):(totals&&attributable?money(totals.cost):tr("evidence.unavailable")),tokensValue=labels.usageUnavailable?tr("metric.costUnavailable"):(totals&&attributable?number(totals.totalTokens):tr("evidence.unavailable")),blocks=empty?rangeEmpty():el("div","metrics");if(!empty)blocks.append(metric(tr(costLabel),costValue,tr("metric.native"),[[tr("table.date"),rangeText()]]),metric(tr(tokensLabel),tokensValue,tr("metric.tokens.note"),[[tr("table.date"),rangeText()]]),metric(tr("metric.generations"),totals?number(totals.generations):tr("evidence.unavailable"),tr("metric.generations.note"),[[tr("table.date"),rangeText()]]),metric(tr("metric.sessions"),number(members.sessions),tr("history.sessions.note"),[[tr("evidence.native"),number(historySessions().length)+" tracked"]]));const all=el("div","");all.append(blocks,coveragePanel(data.history),historyTable(classified),evidencePanel(activeEvidence()));return all;}
function backBar(){const bar=el("div","toolbar"),button=el("button","",tr("nav.back"));button.dataset.back="true";bar.append(button);return bar;}
function globalOverview(){const days=selectedDays(),empty=!!activeRange()&&days.length===0,tokens=days.reduce((sum,row)=>sum+row.totalTokens,0),cost=days.reduce((sum,row)=>sum+row.cost,0),labels=data.global.usageLabels,costValue=labels.usageUnavailable?tr("metric.costUnavailable"):money(cost),tokensValue=labels.usageUnavailable?tr("metric.costUnavailable"):number(tokens),metrics=empty?rangeEmpty():el("div","metrics");if(!empty)metrics.append(metric(tr(labels.cost),costValue,tr("metric.native"),[[tr("table.date"),rangeText()]]),metric(tr(labels.tokens),tokensValue,tr("metric.tokens.note"),[[tr("table.date"),rangeText()]]),metric(tr("metric.days"),number(days.length),tr("metric.days.note"),[[tr("range.label"),rangeText()]]));const all=el("div","");all.append(metrics,coveragePanel(data.global),compositionCard(data.global.composition),evidencePanel(activeEvidence()));return all;}
function sessionPanel(entry){if(!entry||!entry.view)return unavailableSection(tr("tab."+state.tab),tr("unavailable.session"));return state.tab==="overview"?overview(entry.view):detail(entry.view,tr("tab."+state.tab),datedSource(entry));}
function renderView(){const nodes=[];if(state.section==="global"){if(state.tab==="overview"){nodes.push(globalOverview());nodes.push(chart());}else nodes.push(unavailableSection(tr("tab."+state.tab),tr("unavailable.global")));return nodes;}if(state.section==="history"){if(state.session===null){nodes.push(historyOverview());if(state.tab==="overview")nodes.push(chart());else nodes.push(unavailableSection(tr("tab."+state.tab),tr("unavailable.session")));return nodes;}nodes.push(sessionPanel(historySessions()[state.session]));if(state.tab==="overview")nodes.push(chart());nodes.push(backBar());return nodes;}const view=currentView();if(!view||view.availability!=="available"){nodes.push(unavailableSection(tr("tab."+state.tab),tr("unavailable.current")+(view&&view.diagnostic?" · "+view.diagnostic:"")));return nodes;}if(state.tab==="overview"){nodes.push(overview(view.report));nodes.push(chart());}else nodes.push(detail(view.report,tr("tab."+state.tab),datedSource(view)));return nodes;}
function sessionScopeNote(){const entry=historySessions()[state.session];return (entry.firstDate||tr("evidence.unavailable"))+(entry.lastDate&&entry.lastDate!==entry.firstDate?" → "+entry.lastDate:"")+" · "+tr("scope.tree")+" · after tracking marker";}
const scopeButtons=[].slice.call(q("scope").querySelectorAll("button"));
function syncScope(){scopeButtons.forEach(button=>{const scope=button.dataset.scope,view=data.current[scope],unavailable=state.section!=="current"||view.availability!=="available";button.disabled=unavailable;button.setAttribute("aria-pressed",String(state.section==="current"&&scope===state.scope));if(view.diagnostic)button.title=view.diagnostic;else button.removeAttribute("title");});// The fixed note renders once, in its own element beside the disabled control.
q("scope-fixed").hidden=state.section==="current";q("scope-sub").textContent=state.section==="current"?tr(state.scope==="active"?"scope.active.note":"scope.tree.note"):"";let same=q("scope-same"),view=currentView(),show=state.section==="current"&&data.current.sameReportProjection===true&&!!view&&view.availability==="available";if(!show){if(same)same.hidden=true;return;}if(!same){same=el("p","range-note",tr("scope.sameReport"));same.id="scope-same";q("scope").parentNode.append(same);}same.hidden=false;}
function render(){const scrollY=window.scrollY||0,active=document.activeElement,caret=active&&active.id==="search"&&typeof active.selectionStart==="number"?active.selectionStart:null;q("wal-detail").hidden=!(state.section==="current"&&data.walDetail==="expired");q("time-range").hidden=false;syncScope();syncRangeNotice();const range=activeRange();q("range-name").textContent=range?(range.preset?tr("range.last",{days:range.preset}):tr("range.custom")):tr("evidence.unavailable");q("range-dates").textContent=rangeText();[].slice.call(document.querySelectorAll("[data-days]")).forEach(node=>node.setAttribute("aria-pressed",String(!!range&&Number(node.dataset.days)===range.preset)));q("custom-range").setAttribute("aria-pressed",String(!!range&&range.preset===null));const titles={current:["kicker.current","heading.current","subtitle.current"],history:["kicker.history","heading.history","subtitle.history"],global:["kicker.global","heading.global","subtitle.global"]}[state.section];q("kicker").textContent=tr(titles[0]);q("title").textContent=tr(titles[1]);q("subtitle").textContent=tr(titles[2]);q("breadcrumb").textContent=state.section==="history"&&state.session!==null?historySessions()[state.session].sessionId:tr("nav."+state.section);q("session-label").textContent=state.section==="current"?(currentReport()?currentReport().sessionId:tr("evidence.unavailable")):state.section==="history"&&state.session!==null?historySessions()[state.session].sessionId:number(state.section==="history"?historySessions().length:data.global.trackedSessions)+" tracked sessions";q("scope-note").textContent=state.section==="current"?(state.scope==="active"?tr("scope.active"):tr("scope.tree"))+" · after tracking marker":state.section==="history"&&state.session!==null?sessionScopeNote():rangeText();const view=q("view");view.replaceChildren.apply(view,renderView());if(state.resetScroll){state.resetScroll=false;window.scrollTo(0,0);}else{window.scrollTo(0,scrollY);}if(caret!==null){const search=q("search");if(search){search.focus();try{search.setSelectionRange(caret,caret);}catch(error){}}}q("announcement").textContent=tr("nav."+state.section)+", "+tr("tab."+state.tab)+", "+rangeText();}
const nav=q("navigation");["current","history","global"].forEach(kind=>{const button=el("button","",tr("nav."+kind));button.dataset.range=kind;button.setAttribute("aria-pressed",String(kind===state.section));button.disabled=false;button.addEventListener("click",()=>{state.section=kind;state.tab="overview";state.session=null;state.metric=activeMetrics()[0]||"sessions";state.resetScroll=true;render();});nav.append(button);});
const tabsNode=q("tabs");TABS.forEach(tab=>{const button=el("button","",tr("tab."+tab));button.dataset.tab=tab;button.setAttribute("aria-pressed",String(tab===state.tab));button.addEventListener("click",()=>{state.tab=tab;[].slice.call(tabsNode.querySelectorAll("button")).forEach(item=>item.setAttribute("aria-pressed",String(item===button)));render();});tabsNode.append(button);});
scopeButtons.forEach(button=>button.addEventListener("click",()=>{if(button.disabled)return;state.scope=button.dataset.scope;state.resetScroll=true;render();}));
document.addEventListener("input",event=>{if(event.target.id!=="search")return;state.query=event.target.value;render();});
document.addEventListener("change",event=>{if(event.target.id==="sort"){state.sort=event.target.value;render();}else if(event.target.id==="chart-metric"){state.metric=event.target.value;render();const select=q("chart-metric");if(select)select.focus();}});
document.addEventListener("click",event=>{const button=event.target&&event.target.closest?event.target.closest("button"):null;if(!button)return;if(button.dataset.back!==undefined){state.session=null;state.tab="overview";state.resetScroll=true;render();}else if(button.dataset.session!==undefined){state.session=Number(button.dataset.session);state.tab="overview";state.resetScroll=true;render();}else if(button.dataset.toolFilter!==undefined){toolFilters[viewIdentity()]=button.dataset.toolFilter;render();}else if(button.dataset.clearFilter!==undefined){toolFilters[viewIdentity()]=null;render();}else if(button.dataset.envTab!==undefined){state.envTab=button.dataset.envTab;render();}});
[].slice.call(document.querySelectorAll("[data-days]")).forEach(button=>button.addEventListener("click",()=>{rangeIntents[viewIdentity()]={kind:"preset",preset:Number(button.dataset.days)};render();}));
q("custom-range").addEventListener("click",()=>{const range=activeRange();q("date-from").value=range?range.from:"";q("date-to").value=range?range.to:"";q("date-error").textContent="";q("date-dialog").showModal();});
q("date-cancel").addEventListener("click",()=>q("date-dialog").close());
q("date-form").addEventListener("submit",event=>{event.preventDefault();const from=q("date-from").value,to=q("date-to").value;if(!from||!to||from>to){q("date-error").textContent=tr("range.error");return;}rangeIntents[viewIdentity()]={kind:"custom",from:from,to:to};q("date-dialog").close();render();});
q("theme").addEventListener("click",event=>{const dark=document.body.classList.toggle("theme-dark");event.currentTarget.textContent=tr(dark?"theme.light":"theme.dark");event.currentTarget.setAttribute("aria-pressed",String(dark));});
render();
`;

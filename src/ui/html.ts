import type { EvidenceState, Scope } from "../core/events.ts";
import { buildLedger, type LedgerItem } from "../core/ledger.ts";
import type { SessionReport } from "../core/reports.ts";
import type { CurrentView, DailyRow, InspectorBundle } from "./bundle.ts";
import type { GlobalReport, HistoryReport } from "./load-history.ts";

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
  "scope.active": "Active ancestry",
  "scope.tree": "Full tree",
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
  "tab.overview": "Overview",
  "tab.models": "Models",
  "tab.tools": "Tools",
  "tab.commands": "Commands",
  "tab.agents": "Agents",
  "tab.skills": "Skills",
  "tab.integrations": "Integrations",
  "tab.errors": "Errors",
  "tab.ledger": "Ledger",
  "metric.cost": "Native cost",
  "metric.tokens": "Total tokens",
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
  "tools.bars.note": "Call count by tool",
  "bars.empty": "No observations in the selected scope.",
  "agents.note":
    "Child usage is a breakdown only. It is never added to native totals.",
  "agents.activity.note":
    "Calls recorded from persisted tool results. Usage is a breakdown only.",
  "agents.succeeded": "Succeeded",
  "agents.failed": "Failed",
  "agents.interrupted": "Interrupted",
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
  "errors.note": "Bounded classifications from persisted stop and error state.",
  "errors.none": "No persisted error records. An observed zero stays zero.",
  "empty.ledger": "No persisted records to order.",
  "history.note":
    "Open a row to inspect its full-tree sections with the same tabs.",
  "history.sessions.note": "Tracked sessions in the selected range",
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

export type ReportPeriod = {
  preset: number | null;
  from: string;
  to: string;
};

type SafeUsage = SessionReport["usage"];
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
  total: { totalTokens: number; cost: number };
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
type ToolRow = {
  id: string;
  name: string;
  /** Sanitized inventory source label; absent when no source was attributed. */
  source?: string;
  status: SessionReport["tools"][number]["status"];
  usage: SafeUsage | null;
  durationMs: number | null;
  durationLabel: string | null;
};
type AgentRow = {
  id: string;
  parentId: string | null;
  status: SessionReport["agents"][number]["status"];
  confidence: SessionReport["agents"][number]["confidence"];
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
};
type StatusView = {
  key: "status.errors" | "status.interrupted" | "status.clean";
  tone: "neutral" | "warn";
};
type SessionView = {
  sessionId: string;
  usage: SafeUsage;
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
  view?: SessionView;
};

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
<div class="data-scope" role="group" aria-label="Data scope"><div class="scope-group"><p class="eyebrow">${t["scope.label"]}</p><div class="segments" id="scope" aria-label="${t["scope.label"]}"><button data-scope="active">${t["scope.active"]}</button><button data-scope="tree">${t["scope.tree"]}</button></div><small id="scope-fixed" hidden>${t["scope.fixed"]}</small></div><section class="time-range" id="time-range" aria-label="${t["range.label"]}" hidden><div><p class="eyebrow">${t["range.label"]}</p><strong id="range-name"></strong><div class="mono" id="range-dates" aria-live="polite"></div><small>${t["range.inclusive"]}</small></div><div class="segments"><button data-days="7">7D</button><button data-days="14">14D</button><button data-days="30">30D</button><button id="custom-range" aria-haspopup="dialog">${t["range.custom"]}</button></div>${rangeNotice}</section></div>
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

/** Renders a self-contained report from shared DTOs only; no source locator or content fields are projected. */
export function renderHtml(input: HtmlReport): string {
  const data = escapeInlineJson(projectReport(input));
  const t = ENGLISH_CATALOG;
  return `${renderHead(t)}${STYLES}${renderBody(data)}${SCRIPT}\n</script></body></html>`;
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
  daily?: readonly DailyRow[];
  dailyTruncated?: boolean;
};

function currentViewProjection(
  view: CurrentView,
  scope: Scope,
): CurrentViewProjection {
  return {
    availability: view.availability,
    ...(view.diagnostic === undefined ? {} : { diagnostic: view.diagnostic }),
    scope,
    ...(view.report === undefined ? {} : { report: sessionView(view.report) }),
    ...(view.daily === undefined
      ? {}
      : { daily: view.daily, dailyTruncated: view.dailyTruncated ?? false }),
  };
}

/** History/global keep the existing section projection without its `kind`. */
function sectionProjection(input: HtmlReport): Record<string, unknown> {
  const projected = projectReport(input);
  delete projected.kind;
  return projected;
}

/**
 * Renders the complete offline Inspector document: both precomputed current
 * views, the history and global sections, and one nav/scope/theme control. It
 * embeds exactly one escaped payload, never fetches, and is byte-identical for
 * identical bundles.
 */
export function renderInspectorBundle(bundle: InspectorBundle): string {
  const payload = {
    kind: "bundle",
    theme: bundle.theme,
    initialScope: bundle.initialScope,
    current: {
      active: currentViewProjection(bundle.current.active, "active"),
      tree: currentViewProjection(bundle.current.tree, "tree"),
    },
    history: sectionProjection({ kind: "history", report: bundle.history }),
    global: sectionProjection({ kind: "global", report: bundle.global }),
  };
  const data = escapeInlineJson(payload);
  const t = ENGLISH_CATALOG;
  const dark = bundle.theme === "dark";
  // The notice is the only change for a capped view; daily rows are never
  // fabricated or padded to fill the window.
  const rangeTruncated =
    bundle.current[bundle.initialScope].dailyTruncated === true;
  return `${renderHead(t)}${STYLES}${renderBody(
    data,
    dark ? "theme-dark" : "",
    dark,
    rangeTruncated,
  )}${BUNDLE_SCRIPT}\n</script></body></html>`;
}

/** Optional token fields stay absent unless an input observed them. */
function safeUsage(usage: SessionReport["usage"]): SafeUsage {
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
 * Builds the daily rows every report kind charts and filters. The browser
 * consumes these rows verbatim and never walks raw report records.
 */
export function buildDailyActivityRows(
  reports: readonly SessionReport[],
): DailyActivityRow[] {
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
      addDailyUsage(row, generation.usage);
    }
    for (const tool of report.tools) {
      const date = utcDate(tool.timestamp);
      if (date === undefined) continue;
      const row = at(date);
      row.sessionIds.add(report.sessionId);
      row.tools += 1;
      if (tool.usage !== undefined) addDailyUsage(row, tool.usage);
    }
    for (const compaction of report.compactions) {
      const date = utcDate(compaction.timestamp);
      if (date === undefined) continue;
      const row = at(date);
      row.sessionIds.add(report.sessionId);
      addDailyUsage(row, compaction.usage);
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
    }));
}

type DailyAccumulator = {
  date: string;
  sessionIds: Set<string>;
  totalTokens: number;
  cost: number;
  generations: number;
  tools: number;
};

function addDailyUsage(row: DailyAccumulator, usage: SafeUsage): void {
  row.totalTokens += usage.totalTokens;
  row.cost = roundCost(row.cost + usage.cost);
}

/**
 * Default inclusive UTC window ending at the latest observed day. Never reads
 * the machine clock, so exports stay byte-identical for identical reports.
 */
export function defaultReportPeriod(
  kind: HtmlReport["kind"],
  daily: readonly DailyActivityRow[],
): ReportPeriod {
  const dates = daily.map((row) => row.date).sort();
  if (dates.length === 0) {
    return {
      preset: kind === "current" ? null : 14,
      from: "1970-01-01",
      to: "1970-01-01",
    };
  }
  const to = dates[dates.length - 1];
  if (kind === "current") return { preset: null, from: dates[0], to };
  return { preset: 14, from: shiftUtcDay(to, -13), to };
}

function shiftUtcDay(date: string, offset: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + offset);
  return parsed.toISOString().slice(0, 10);
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
  const parts = COMPOSITION_KEYS.map((key) => {
    const usage = report.usageComposition[key];
    return {
      key,
      totalTokens: usage.totalTokens,
      cost: usage.cost,
      confidence: "native" as const,
    };
  });
  const total = {
    totalTokens: report.usage.totalTokens,
    cost: report.usage.cost,
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
  const totalCost = report.usage.cost;
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
    usage: tool.usage === undefined ? null : safeUsage(tool.usage),
    durationMs: tool.durationMs === undefined ? null : tool.durationMs,
    durationLabel:
      tool.durationMs === undefined ? null : formatDuration(tool.durationMs),
  }));
}

function agentRows(report: SessionReport): AgentRow[] {
  return report.agents.map((agent) => ({
    id: agent.id,
    parentId: agent.parentId ?? null,
    status: agent.status,
    confidence: agent.confidence,
    usage: agent.usage === undefined ? null : safeUsage(agent.usage),
  }));
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
    usage: safeUsage(report.usage),
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
    errors: report.errors.map((error) => ({
      id: error.id,
      timestamp: error.timestamp,
      kind: error.kind,
      confidence: error.confidence,
      ...(error.message === undefined ? {} : { message: error.message }),
    })),
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
      observation:
        report.agentEvidence === "supported"
          ? fill(ENGLISH_CATALOG["evidence.child.detail"], {
              count: report.agents.length,
            })
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
    totalTokens: view.usage.totalTokens,
    cost: view.usage.cost,
    generationCount: view.generationCount,
    agentCount: view.agentCount,
    status: view.status,
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
      period: defaultReportPeriod("current", daily),
      latestDate: latestDate(daily),
      daily,
      chartMetrics: SESSION_CHART_METRICS,
      evidence: sessionEvidenceRows(input.report, view),
      report: view,
    };
  }
  if (input.kind === "history") {
    const reports = input.report.sessions.flatMap((session) =>
      session.availability === "available" ? [session.report] : [],
    );
    const daily = buildDailyActivityRows(reports);
    return {
      kind: "history",
      availability: input.report.availability,
      period: defaultReportPeriod("history", daily),
      latestDate: latestDate(daily),
      daily,
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
  return {
    kind: "global",
    availability: input.report.availability,
    period: defaultReportPeriod("global", daily),
    latestDate: latestDate(daily),
    daily,
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

function latestDate(daily: readonly DailyActivityRow[]): string | null {
  let latest: string | null = null;
  for (const row of daily) {
    if (latest === null || row.date > latest) latest = row.date;
  }
  return latest;
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function roundCost(value: number): number {
  return Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
}

const SCRIPT = String.raw`
"use strict";
const data=JSON.parse(document.getElementById("report-data").textContent), t=JSON.parse(document.getElementById("catalog-data").textContent);
// SVG namespace identifier only; it is never fetched, so the report stays network-free.
const SVG_NS="http:"+"//www.w3.org/2000/svg";
const tabs=["overview","models","tools","commands","agents","skills","integrations","errors","ledger"];
const CHART_LABELS={sessions:"chart.sessions",cost:"chart.cost",tokens:"chart.tokens",generations:"chart.generations",tools:"chart.tools"};
const state={kind:data.kind,tab:"overview",session:null,scope:data.scope||"tree",period:{preset:data.period.preset,from:data.period.from,to:data.period.to},query:"",sort:"default",metric:data.chartMetrics[0],resetScroll:false};
const q=id=>document.getElementById(id);
const text=value=>String(value===null||value===undefined?"":value);
const number=value=>new Intl.NumberFormat("en").format(Number(value||0));
const money=value=>"$"+Number(value||0).toFixed(2);
const tr=(key,values={})=>text(t[key]).replace(/\{(\w+)\}/g,(match,key)=>text((values||{})[key]));
const el=(name,cls,value)=>{const node=document.createElement(name);if(cls)node.className=cls;if(value!==undefined)node.textContent=value;return node;};
const badge=(value,tone)=>el("span","badge "+(tone||"neutral"),value);
const confidenceTone=value=>value==="native"||value==="live"||value==="cooperative"||value==="supported"?"":(value==="inferred"?"warn":"neutral");
const orUnavailable=value=>(value===null||value===undefined)?tr("evidence.unavailable"):text(value);
const numberOrUnavailable=value=>(value===null||value===undefined)?tr("evidence.unavailable"):number(value);
function tokenCell(usage,key){return orUnavailable(usage[key]);}
const cellText=cell=>cell instanceof Node?text(cell.textContent):text(cell);
function card(title,subtitle,right){const node=el("section","card"),head=el("div","panel-head"),copy=document.createElement("div");copy.append(el("h2","",title),el("p","",subtitle));head.append(copy);if(right)head.append(right);node.append(head);return node;}
function simpleTable(section,headers,rows){const wrap=el("div","table-wrap"),node=document.createElement("table"),head=document.createElement("thead"),headRow=document.createElement("tr"),body=document.createElement("tbody");headers.forEach(value=>headRow.append(el("th","",value)));head.append(headRow);rows.forEach(row=>{const rowNode=document.createElement("tr");row.forEach(value=>{const cell=document.createElement("td");if(value instanceof Node)cell.append(value);else cell.textContent=text(value);rowNode.append(cell);});body.append(rowNode);});node.append(head,body);wrap.append(node);section.append(wrap);return section;}
function table(title,subtitle,headers,rows){const section=card(title,subtitle),toolbar=el("div","toolbar"),searchLabel=el("label","",tr("search")),search=document.createElement("input"),sortLabel=el("label","",tr("sort")),sort=document.createElement("select");search.id="search";search.type="search";search.value=state.query;search.placeholder=tr("search.placeholder");sort.id="sort";[["default","sort.default"],["name","sort.name"],["reverse","sort.reverse"]].forEach(item=>{const option=el("option","",tr(item[1]));option.value=item[0];option.selected=state.sort===item[0];sort.append(option);});searchLabel.append(search);sortLabel.append(sort);toolbar.append(searchLabel,sortLabel);section.append(toolbar);let shown=rows.filter(row=>row.map(cellText).join(" ").toLowerCase().includes(state.query.toLowerCase()));if(state.sort==="name")shown=shown.slice().sort((left,right)=>cellText(left[0]).localeCompare(cellText(right[0]),"en"));if(state.sort==="reverse")shown=shown.slice().reverse();return simpleTable(section,headers,shown);}
function metric(title,value,note,details){const node=el("section","card metric");node.append(el("div","muted",title),el("div","value mono",value),el("small","",note));const block=el("div","breakdown");details.forEach(item=>{const row=el("div","breakdown-row");row.append(el("span","",item[0]),el("span","mono",text(item[1])));block.append(row);});node.append(block);return node;}
function bars(title,subtitle,rows){const section=card(title,subtitle,badge(tr("evidence.native"),"")),body=el("div","bars");if(rows.length===0)body.append(el("p","muted",tr("bars.empty")));rows.forEach(item=>{const row=el("div","bar"),label=el("div","bar-label");label.append(el("span","mono",item.label),el("span","mono",item.value));const track=el("div","track"),fill=el("div","fill");fill.style.width=item.percent+"%";track.append(fill);row.append(label,track);body.append(row);});section.append(body);return section;}
function emptyCard(title,note,eyebrowKey){const section=el("section","card empty");section.append(el("p","eyebrow",tr(eyebrowKey)),el("h2","",title),el("p","",note));return section;}
function unavailableSection(title,reason){return emptyCard(title,reason,"evidence.unavailable");}
function compositionCard(composition){if(!composition.available)return unavailableSection(tr("usage.title"),tr("unavailable.composition"));const section=card(tr("usage.title"),tr("usage.note"),badge(composition.reconciles?tr("usage.reconciled"):tr("usage.unreconciled"),composition.reconciles?"":"warn")),rows=composition.parts.map(part=>[tr("metric.usage."+part.key),number(part.totalTokens),money(part.cost),badge(tr("evidence."+part.confidence),confidenceTone(part.confidence))]);rows.push([tr("usage.total"),number(composition.total.totalTokens),money(composition.total.cost),badge(tr("evidence.native"),"")]);return simpleTable(section,[tr("table.source"),tr("table.tokens"),tr("table.cost"),tr("table.confidence")],rows);}
function evidencePanel(evidence){const section=card(tr("panel.evidence"),tr("evidence.note"),badge(tr("evidence.source"),"neutral"));return simpleTable(section,[tr("table.source"),tr("table.observation"),tr("table.confidence")],evidence.map(row=>[row.source,row.observation,badge(row.confidence,confidenceTone(row.confidence))]));}
function selectedDays(){return data.daily.filter(row=>row.date>=state.period.from&&row.date<=state.period.to)}
function chartValue(row,metric){if(metric==="cost")return row.cost;if(metric==="tokens")return row.totalTokens;if(metric==="generations")return row.generations||0;if(metric==="tools")return row.tools||0;return row.sessions;}
function chartText(metric,value){return metric==="cost"?money(value):number(value);}
function chartLabel(metric){return tr(CHART_LABELS[metric]);}
function chart(){const rows=selectedDays(),label=chartLabel(state.metric),section=card(tr("panel.daily"),state.period.from+" → "+state.period.to),select=document.createElement("select");select.id="chart-metric";select.setAttribute("aria-label",tr("chart.metric"));data.chartMetrics.forEach(value=>{const option=el("option","",chartLabel(value));option.value=value;option.selected=state.metric===value;select.append(option);});section.querySelector(".panel-head").append(select);if(rows.length===0){section.append(el("div","chart-note",tr("chart.empty")));return section;}const values=rows.map(row=>chartValue(row,state.metric)),maximum=Math.max.apply(null,values.concat([1])),firstDate=Date.parse(rows[0].date+"T00:00:00Z"),lastDate=Date.parse(rows[rows.length-1].date+"T00:00:00Z"),span=lastDate-firstDate,points=rows.map((row,index)=>{const x=span<=0?400:8+((Date.parse(row.date+"T00:00:00Z")-firstDate)/span)*784;return {x:x,y:172-(values[index]/maximum)*164,row:row,value:values[index]};}),chartNode=el("div","chart"),axis=el("div","chart-axis");axis.setAttribute("aria-hidden","true");[maximum,maximum/2,0].forEach(value=>axis.append(el("span","",chartText(state.metric,value))));const svg=document.createElementNS(SVG_NS,"svg");svg.setAttribute("class","line-chart");svg.setAttribute("viewBox","0 0 800 180");svg.setAttribute("preserveAspectRatio","none");svg.setAttribute("role","img");svg.setAttribute("aria-label",tr("chart.aria",{metric:label,days:rows.length}));[8,90,172].forEach(y=>{const line=document.createElementNS(SVG_NS,"line");line.setAttribute("class","chart-grid");line.setAttribute("x1","8");line.setAttribute("x2","792");line.setAttribute("y1",String(y));line.setAttribute("y2",String(y));svg.append(line);});const polyline=document.createElementNS(SVG_NS,"polyline");polyline.setAttribute("class","activity-line");polyline.setAttribute("points",points.map(point=>point.x.toFixed(2)+","+point.y.toFixed(2)).join(" "));svg.append(polyline);points.forEach(point=>{const circle=document.createElementNS(SVG_NS,"circle");circle.setAttribute("class","line-point");circle.setAttribute("cx",point.x.toFixed(2));circle.setAttribute("cy",point.y.toFixed(2));circle.setAttribute("r","3");const title=document.createElementNS(SVG_NS,"title");title.textContent=point.row.date+" · "+chartText(state.metric,point.value);circle.append(title);svg.append(circle);});chartNode.append(axis,svg,el("div","chart-dates",rows[0].date+" → "+rows[rows.length-1].date));section.append(chartNode,el("div","chart-note",tr("chart.note",{metric:label})));const details=document.createElement("details"),summary=el("summary","",tr("chart.data")),headers=[tr("table.date"),tr("table.sessions"),tr("table.tokens"),tr("table.cost")],withGenerations=data.chartMetrics.indexOf("generations")>=0,withTools=data.chartMetrics.indexOf("tools")>=0;if(withGenerations)headers.push(tr("table.generations"));if(withTools)headers.push(tr("table.tools"));const tableRows=rows.map(row=>{const cells=[row.date,number(row.sessions),number(row.totalTokens),money(row.cost)];if(withGenerations)cells.push(number(row.generations));if(withTools)cells.push(number(row.tools));return cells;});details.append(summary);simpleTable(details,headers,tableRows);section.append(details);return section;}
function overview(view){const metrics=el("div","metrics");metrics.append(metric(tr("metric.cost"),money(view.usage.cost),tr("metric.native"),[[tr("evidence.native"),money(view.usage.cost)],[tr("metric.child"),view.agentCount===null?tr("evidence.unavailable"):number(view.agentCount)+" · "+tr("metric.child.note")]]),metric(tr("metric.tokens"),number(view.usage.totalTokens),tr("metric.tokens.note"),[[tr("metric.input"),tokenCell(view.usage,"inputTokens")],[tr("metric.output"),tokenCell(view.usage,"outputTokens")],[tr("metric.cacheRead"),tokenCell(view.usage,"cacheReadTokens")],[tr("metric.cacheWrite"),tokenCell(view.usage,"cacheWriteTokens")],[tr("usage.total"),number(view.usage.totalTokens)]]),metric(tr("metric.generations"),number(view.generationCount),tr("metric.generations.note"),[[tr("evidence.native"),number(view.generationCount)]]),metric(tr("metric.tools"),number(view.toolCount),tr("metric.tools.note"),[[tr("evidence.native"),number(view.toolCount)]]),metric(tr("metric.duration"),orUnavailable(view.durationLabel),tr("metric.duration.note"),[[tr("evidence.native"),view.span?view.span.from+" → "+view.span.to:tr("evidence.unavailable")]]));const grid=el("div","grid");grid.append(bars(tr("panel.models"),tr("models.note"),view.modelBars),bars(tr("panel.tools"),tr("tools.bars.note"),view.toolBars));const all=el("div","");all.append(metrics,grid,compositionCard(view.composition),evidencePanel(data.evidence));return all;}
function inPeriod(entry){if(entry.firstDate===null||entry.lastDate===null)return true;return entry.firstDate<=state.period.to&&entry.lastDate>=state.period.from;}
function sessionCell(entry){const cell=document.createElement("div");cell.append(el("span","mono",entry.sessionId));cell.append(el("small","",entry.firstDate?(entry.firstDate+(entry.lastDate&&entry.lastDate!==entry.firstDate?" → "+entry.lastDate:"")):tr("evidence.unavailable")));return cell;}
function openButton(index){const button=el("button","",tr("table.open"));button.dataset.session=String(index);button.setAttribute("aria-label",tr("table.open")+" "+data.sessions[index].sessionId);return button;}
function historyTable(visible){const section=card(tr("panel.history"),tr("history.note")),headers=[tr("table.session"),tr("table.duration"),tr("table.tokens"),tr("table.generations"),tr("table.agents"),tr("table.status"),tr("table.cost")];headers.push(tr("table.inspect"));const rows=visible.map(item=>{const entry=item.entry;return [sessionCell(entry),orUnavailable(entry.durationLabel),entry.totalTokens===null?tr("evidence.unavailable"):number(entry.totalTokens),entry.generationCount===null?tr("evidence.unavailable"):number(entry.generationCount),entry.agentCount===null?tr("evidence.unavailable"):number(entry.agentCount),entry.status?badge(tr(entry.status.key),entry.status.tone):tr("evidence.unavailable"),entry.cost===null?tr("evidence.unavailable"):money(entry.cost),openButton(item.index)];});simpleTable(section,headers,rows);const wrap=section.querySelector(".table-wrap"),node=section.querySelector("table");if(wrap)wrap.className="table-wrap history-table-wrap";if(node)node.className="history-table";return section;}
function historyOverview(){const days=selectedDays(),tokens=days.reduce((sum,row)=>sum+row.totalTokens,0),cost=days.reduce((sum,row)=>sum+row.cost,0),generations=days.reduce((sum,row)=>sum+(row.generations||0),0),visible=data.sessions.map((entry,index)=>({entry:entry,index:index})).filter(item=>inPeriod(item.entry)),metrics=el("div","metrics");metrics.append(metric(tr("metric.cost"),money(cost),tr("metric.native"),[[tr("table.date"),state.period.from+" → "+state.period.to]]),metric(tr("metric.tokens"),number(tokens),tr("metric.tokens.note"),[[tr("table.date"),state.period.from+" → "+state.period.to]]),metric(tr("metric.generations"),number(generations),tr("metric.generations.note"),[[tr("table.date"),state.period.from+" → "+state.period.to]]),metric(tr("metric.sessions"),number(visible.length),tr("history.sessions.note"),[[tr("evidence.native"),number(data.sessions.length)+" tracked"]]));const all=el("div","");all.append(metrics,historyTable(visible),evidencePanel(data.evidence));return all;}
function backBar(){const bar=el("div","toolbar"),button=el("button","",tr("nav.back"));button.dataset.back="true";bar.append(button);return bar;}
function detail(view,title){if(state.tab==="models")return view.models.length===0?emptyCard(title,tr("models.none"),"evidence.native"):table(title,tr("models.note"),[tr("table.provider"),tr("table.model"),tr("table.generations"),tr("table.input"),tr("table.output"),tr("table.cacheRead"),tr("table.cacheWrite"),tr("table.tokens"),tr("table.cost")],view.models.map(row=>[row.provider,row.model,number(row.generations),numberOrUnavailable(row.inputTokens),numberOrUnavailable(row.outputTokens),numberOrUnavailable(row.cacheReadTokens),numberOrUnavailable(row.cacheWriteTokens),number(row.totalTokens),money(row.cost)]));if(state.tab==="tools")return view.tools.length===0?emptyCard(title,tr("tools.none"),"evidence.native"):table(title,tr("tools.note"),[tr("table.tool"),tr("table.status"),tr("table.tokens"),tr("table.cost"),tr("table.duration")],view.tools.map(row=>[row.name,row.status,row.usage?number(row.usage.totalTokens):tr("evidence.unavailable"),row.usage?money(row.usage.cost):tr("evidence.unavailable"),row.durationLabel===null?tr("evidence.unavailable"):row.durationLabel+" · "+tr("evidence.live")]));if(state.tab==="agents"){if(view.agentEvidence!=="supported")return unavailableSection(title,tr("unavailable.agents"));return table(title,tr("agents.note"),[tr("table.run"),tr("table.parent"),tr("table.status"),tr("table.tokens"),tr("table.cost"),tr("table.evidence")],view.agents.map(row=>[row.id,row.parentId===null?tr("evidence.unavailable"):row.parentId,row.status,row.usage?number(row.usage.totalTokens):tr("evidence.unavailable"),row.usage?money(row.usage.cost):tr("evidence.unavailable"),badge(tr("evidence."+row.confidence),confidenceTone(row.confidence))]));}if(state.tab==="integrations"){if(view.integrations.length===0)return unavailableSection(title,tr("unavailable.integrations"));return table(title,tr("integrations.note"),[tr("table.integration"),tr("table.evidence"),tr("table.version"),tr("table.counters")],view.integrations.map(row=>[row.integration,badge(tr("evidence."+row.state),confidenceTone(row.state)),row.version===null?tr("evidence.unavailable"):String(row.version),row.counters.join(" · ")]));}if(state.tab==="errors"){if(view.errors.length===0)return emptyCard(title,tr("errors.none"),"evidence.native");return table(title,tr("errors.note"),[tr("table.id"),tr("table.kind"),tr("table.timestamp"),tr("table.confidence")],view.errors.map(row=>[row.id,row.kind,row.timestamp,badge(tr("evidence."+row.confidence),confidenceTone(row.confidence))]));}if(state.tab==="ledger"){if(view.ledger.length===0)return emptyCard(title,tr("empty.ledger"),"evidence.unavailable");return table(title,tr("ledger.materialized"),[tr("table.timestamp"),tr("table.id"),tr("table.category"),tr("table.action"),tr("table.confidence")],view.ledger.map(item=>[item.timestamp,item.id,item.kind,item.status,item.confidence]));}if(state.tab==="commands")return unavailableSection(title,tr("unavailable.commands"));if(state.tab==="skills")return unavailableSection(title,tr("unavailable.skills"));return unavailableSection(title,tr("unavailable.copy"));}
function globalOverview(){const days=selectedDays(),tokens=days.reduce((sum,row)=>sum+row.totalTokens,0),cost=days.reduce((sum,row)=>sum+row.cost,0),metrics=el("div","metrics");metrics.append(metric(tr("metric.cost"),money(cost),tr("metric.native"),[[tr("table.date"),state.period.from+" → "+state.period.to]]),metric(tr("metric.tokens"),number(tokens),tr("metric.tokens.note"),[[tr("table.date"),state.period.from+" → "+state.period.to]]),metric(tr("metric.days"),number(days.length),tr("metric.days.note"),[[tr("range.label"),state.period.from+" → "+state.period.to]]),metric(tr("metric.sessions"),number(data.trackedSessions),tr("metric.sessions.global.note"),[[tr("evidence.native"),number(data.trackedSessions-data.unavailableSessions)+" replayed"],[tr("evidence.unavailable"),number(data.unavailableSessions)+" unavailable"]]));const all=el("div","");all.append(metrics,compositionCard(data.composition),evidencePanel(data.evidence));return all;}
function sessionPanel(entry){if(!entry.view)return unavailableSection(tr("tab."+state.tab),tr("unavailable.session"));return state.tab==="overview"?overview(entry.view):detail(entry.view,tr("tab."+state.tab));}
function renderView(){const nodes=[];if(state.kind==="global"){if(state.tab==="overview"){nodes.push(globalOverview());nodes.push(chart());}else nodes.push(unavailableSection(tr("tab."+state.tab),tr("unavailable.global")));return nodes;}if(state.kind==="history"){if(state.session===null){nodes.push(historyOverview());if(state.tab==="overview")nodes.push(chart());else nodes.push(unavailableSection(tr("tab."+state.tab),tr("unavailable.session")));return nodes;}nodes.push(sessionPanel(data.sessions[state.session]));if(state.tab==="overview")nodes.push(chart());nodes.push(backBar());return nodes;}if(state.tab==="overview"){nodes.push(overview(data.report));nodes.push(chart());}else nodes.push(detail(data.report,tr("tab."+state.tab)));return nodes;}
function sessionScopeNote(){const entry=data.sessions[state.session];return (entry.firstDate||tr("evidence.unavailable"))+(entry.lastDate&&entry.lastDate!==entry.firstDate?" → "+entry.lastDate:"")+" · "+tr("scope.tree")+" after tracking marker";}
function render(){const scrollY=window.scrollY||0,active=document.activeElement,caret=active&&active.id==="search"&&typeof active.selectionStart==="number"?active.selectionStart:null;q("wal-detail").hidden=!(data.kind==="current"&&data.walDetail==="expired");q("time-range").hidden=state.kind==="current";q("scope-fixed").hidden=state.kind==="current";q("range-name").textContent=state.period.preset?tr("range.last",{days:state.period.preset}):tr("range.custom");q("range-dates").textContent=state.period.from+" → "+state.period.to;[].slice.call(document.querySelectorAll("[data-days]")).forEach(node=>node.setAttribute("aria-pressed",String(Number(node.dataset.days)===state.period.preset)));q("custom-range").setAttribute("aria-pressed",String(state.period.preset===null));const titles={current:["kicker.current","heading.current","subtitle.current"],history:["kicker.history","heading.history","subtitle.history"],global:["kicker.global","heading.global","subtitle.global"]}[state.kind];q("kicker").textContent=tr(titles[0]);q("title").textContent=tr(titles[1]);q("subtitle").textContent=tr(titles[2]);q("breadcrumb").textContent=state.kind==="history"&&state.session!==null?data.sessions[state.session].sessionId:tr("nav."+state.kind);q("session-label").textContent=state.kind==="current"?data.report.sessionId:state.kind==="history"&&state.session!==null?data.sessions[state.session].sessionId:number(state.kind==="history"?data.sessions.length:data.trackedSessions)+" tracked sessions";q("scope-note").textContent=state.kind==="current"?(state.scope==="active"?tr("scope.active"):tr("scope.tree"))+" after tracking marker":state.kind==="history"&&state.session!==null?sessionScopeNote():tr("scope.fixed")+" · "+state.period.from+" → "+state.period.to;const view=q("view");view.replaceChildren.apply(view,renderView());if(state.resetScroll){state.resetScroll=false;window.scrollTo(0,0);}else{window.scrollTo(0,scrollY);}if(caret!==null){const search=q("search");if(search){search.focus();try{search.setSelectionRange(caret,caret);}catch(error){}}}q("announcement").textContent=tr("nav."+state.kind)+", "+tr("tab."+state.tab)+", "+state.period.from+" → "+state.period.to;}
const nav=q("navigation");["current","history","global"].forEach(kind=>{const button=el("button","",tr("nav."+kind));button.dataset.range=kind;button.disabled=kind!==data.kind;nav.append(button);});
const tabsNode=q("tabs");tabs.forEach(tab=>{const button=el("button","",tr("tab."+tab));button.dataset.tab=tab;button.setAttribute("aria-pressed",String(tab===state.tab));button.addEventListener("click",()=>{state.tab=tab;[].slice.call(tabsNode.children).forEach(item=>item.setAttribute("aria-pressed",String(item===button)));render();});tabsNode.append(button);});
[].slice.call(q("scope").querySelectorAll("button")).forEach(button=>{button.disabled=true;button.setAttribute("aria-pressed",String(button.dataset.scope===state.scope));});
document.addEventListener("input",event=>{if(event.target.id!=="search")return;state.query=event.target.value;render();});
document.addEventListener("change",event=>{if(event.target.id==="sort"){state.sort=event.target.value;render();}else if(event.target.id==="chart-metric"){state.metric=event.target.value;render();const select=q("chart-metric");if(select)select.focus();}});
document.addEventListener("click",event=>{const button=event.target&&event.target.closest?event.target.closest("button"):null;if(!button)return;if(button.dataset.back!==undefined){state.session=null;state.tab="overview";state.resetScroll=true;render();}else if(button.dataset.session!==undefined){state.session=Number(button.dataset.session);state.tab="overview";state.resetScroll=true;render();}});
[].slice.call(document.querySelectorAll("[data-days]")).forEach(button=>button.addEventListener("click",()=>{const days=Number(button.dataset.days),end=data.latestDate||"1970-01-01",start=new Date(end+"T00:00:00Z");start.setUTCDate(start.getUTCDate()-days+1);state.period={preset:days,from:start.toISOString().slice(0,10),to:end};render();}));
q("custom-range").addEventListener("click",()=>{q("date-from").value=state.period.from;q("date-to").value=state.period.to;q("date-error").textContent="";q("date-dialog").showModal();});
q("date-cancel").addEventListener("click",()=>q("date-dialog").close());
q("date-form").addEventListener("submit",event=>{event.preventDefault();const from=q("date-from").value,to=q("date-to").value;if(!from||!to||from>to){q("date-error").textContent=tr("range.error");return;}state.period={preset:null,from:from,to:to};q("date-dialog").close();render();});
q("theme").addEventListener("click",event=>{const dark=document.body.classList.toggle("theme-dark");event.currentTarget.textContent=tr(dark?"theme.light":"theme.dark");});
render();
`;

const BUNDLE_SCRIPT = String.raw`
"use strict";
const data=JSON.parse(document.getElementById("report-data").textContent), t=JSON.parse(document.getElementById("catalog-data").textContent);
// SVG namespace identifier only; it is never fetched, so the report stays network-free.
const SVG_NS="http:"+"//www.w3.org/2000/svg";
const TABS=["overview","models","tools","commands","agents","skills","integrations","errors","ledger"];
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
function defaultPeriod(daily,preset){const dates=(daily||[]).map(row=>row.date).sort();if(dates.length===0)return{preset:preset,from:"1970-01-01",to:"1970-01-01"};return{preset:preset,from:dates[0],to:dates[dates.length-1]};}
const periods={current:defaultPeriod(data.current[data.initialScope].daily,null),history:data.history.period,global:data.global.period};
const state={section:"current",scope:data.initialScope,tab:"overview",session:null,query:"",sort:"default",metric:CURRENT_METRICS[0],resetScroll:false};
const currentView=()=>data.current[state.scope];
const currentReport=()=>{const view=currentView();return view&&view.availability==="available"?view.report:null;};
const dailyTruncated=()=>state.section==="current"&&!!(currentView()&&currentView().dailyTruncated);
function syncRangeNotice(){const truncated=dailyTruncated();let notice=q("range-truncated");if(!truncated){if(notice)notice.hidden=true;return;}if(!notice){notice=el("p","range-note",tr("range.truncated"));notice.id="range-truncated";q("time-range").append(notice);}notice.hidden=false;}
const historySessions=()=>data.history.sessions||[];
const activeDaily=()=>state.section==="current"?((currentView()&&currentView().daily)||[]):(state.section==="history"?(data.history.daily||[]):(data.global.daily||[]));
const activeMetrics=()=>state.section==="current"?CURRENT_METRICS:(state.section==="history"?(data.history.chartMetrics||CURRENT_METRICS):(data.global.chartMetrics||GLOBAL_METRICS));
const period=()=>periods[state.section];
function latestDate(){let latest=null;activeDaily().forEach(row=>{if(latest===null||row.date>latest)latest=row.date;});return latest;}
function chartValue(row,metric){if(metric==="cost")return row.cost;if(metric==="tokens")return row.totalTokens;if(metric==="generations")return row.generations||0;if(metric==="tools")return row.tools||0;return row.sessions;}
function chartText(metric,value){return metric==="cost"?money(value):number(value);}
function chartLabel(metric){return tr(CHART_LABELS[metric]);}
function selectedDays(){return activeDaily().filter(row=>row.date>=period().from&&row.date<=period().to);}
function tokenCell(usage,key){return orUnavailable(usage[key]);}
const cellText=cell=>cell instanceof Node?text(cell.textContent):text(cell);
function card(title,subtitle,right){const node=el("section","card"),head=el("div","panel-head"),copy=document.createElement("div");copy.append(el("h2","",title),el("p","",subtitle));head.append(copy);if(right)head.append(right);node.append(head);return node;}
function simpleTable(section,headers,rows){const wrap=el("div","table-wrap"),node=document.createElement("table"),head=document.createElement("thead"),headRow=document.createElement("tr"),body=document.createElement("tbody");headers.forEach(value=>headRow.append(el("th","",value)));head.append(headRow);rows.forEach(row=>{const rowNode=document.createElement("tr");row.forEach(value=>{const cell=document.createElement("td");if(value instanceof Node)cell.append(value);else cell.textContent=text(value);rowNode.append(cell);});body.append(rowNode);});node.append(head,body);wrap.append(node);section.append(wrap);return section;}
function table(title,subtitle,headers,rows){const section=card(title,subtitle),toolbar=el("div","toolbar"),searchLabel=el("label","",tr("search")),search=document.createElement("input"),sortLabel=el("label","",tr("sort")),sort=document.createElement("select");search.id="search";search.type="search";search.value=state.query;search.placeholder=tr("search.placeholder");sort.id="sort";[["default","sort.default"],["name","sort.name"],["reverse","sort.reverse"]].forEach(item=>{const option=el("option","",tr(item[1]));option.value=item[0];option.selected=state.sort===item[0];sort.append(option);});searchLabel.append(search);sortLabel.append(sort);toolbar.append(searchLabel,sortLabel);section.append(toolbar);let shown=rows.filter(row=>row.map(cellText).join(" ").toLowerCase().includes(state.query.toLowerCase()));if(state.sort==="name")shown=shown.slice().sort((left,right)=>cellText(left[0]).localeCompare(cellText(right[0]),"en"));if(state.sort==="reverse")shown=shown.slice().reverse();return simpleTable(section,headers,shown);}
function metric(title,value,note,details){const node=el("section","card metric");node.append(el("div","muted",title),el("div","value mono",value),el("small","",note));const block=el("div","breakdown");(details||[]).forEach(item=>{const row=el("div","breakdown-row");row.append(el("span","",item[0]),el("span","mono",text(item[1])));block.append(row);});node.append(block);return node;}
function bars(title,subtitle,rows){const section=card(title,subtitle,badge(tr("evidence.native"),"")),body=el("div","bars");if(rows.length===0)body.append(el("p","muted",tr("bars.empty")));rows.forEach(item=>{const row=el("div","bar"),label=el("div","bar-label");label.append(el("span","mono",item.label),el("span","mono",item.value));const track=el("div","track"),fill=el("div","fill");fill.style.width=item.percent+"%";track.append(fill);row.append(label,track);body.append(row);});section.append(body);return section;}
function emptyCard(title,note,eyebrowKey){const section=el("section","card empty");section.append(el("p","eyebrow",tr(eyebrowKey)),el("h2","",title),el("p","",note));return section;}
function unavailableSection(title,reason){return emptyCard(title,reason,"evidence.unavailable");}
function compositionCard(composition){if(!composition.available)return unavailableSection(tr("usage.title"),tr("unavailable.composition"));const section=card(tr("usage.title"),tr("usage.note"),badge(composition.reconciles?tr("usage.reconciled"):tr("usage.unreconciled"),composition.reconciles?"":"warn")),rows=composition.parts.map(part=>[tr("metric.usage."+part.key),number(part.totalTokens),money(part.cost),badge(tr("evidence."+part.confidence),confidenceTone(part.confidence))]);rows.push([tr("usage.total"),number(composition.total.totalTokens),money(composition.total.cost),badge(tr("evidence.native"),"")]);return simpleTable(section,[tr("table.source"),tr("table.tokens"),tr("table.cost"),tr("table.confidence")],rows);}
function evidencePanel(evidence){const section=card(tr("panel.evidence"),tr("evidence.note"),badge(tr("evidence.source"),"neutral"));return simpleTable(section,[tr("table.source"),tr("table.observation"),tr("table.confidence")],evidence.map(row=>[row.source,row.observation,badge(row.confidence,confidenceTone(row.confidence))]));}
function currentEvidence(){const view=currentReport();if(!view)return[];const timedTools=view.tools.filter(tool=>tool.durationMs!==null&&tool.durationMs!==undefined).length;const rows=[{source:tr("evidence.piRecords"),observation:tr("evidence.piRecords.detail",{generations:view.generationCount,tools:view.toolCount,models:view.models.length}),confidence:"native"},{source:tr("evidence.span"),observation:view.durationLabel===null?tr("evidence.span.missing"):view.durationLabel+" · "+tr("evidence.span.detail"),confidence:view.durationLabel===null?"unavailable":"native"},{source:tr("evidence.toolTiming"),observation:timedTools>0?tr("evidence.toolTiming.detail",{count:timedTools}):tr("evidence.toolTiming.missing"),confidence:timedTools>0?"live":(view.durationEvidence||"unavailable")},{source:tr("evidence.child"),observation:view.agentEvidence==="supported"?tr("evidence.child.detail",{count:view.agents.length}):tr("evidence.child.missing"),confidence:view.agentEvidence==="supported"?"cooperative":view.agentEvidence},{source:tr("evidence.errors"),observation:tr("evidence.errors.detail",{count:view.errors.length}),confidence:"native"},{source:tr("evidence.retries"),observation:tr("evidence.retries.detail"),confidence:"unavailable"}];if(!view.integrations||view.integrations.length===0){rows.push({source:tr("evidence.integration"),observation:tr("evidence.integration.missing"),confidence:"unavailable"});return rows;}view.integrations.forEach(row=>{rows.push({source:tr("evidence.integration"),observation:row.integration+" · "+row.state+(row.counters.length?" · "+row.counters.join(", "):""),confidence:row.state});});return rows;}
function activeEvidence(){if(state.section==="current")return currentEvidence();if(state.section==="history")return data.history.evidence||[];return data.global.evidence||[];}
function chart(){const rows=selectedDays(),label=chartLabel(state.metric),section=card(tr("panel.daily"),period().from+" → "+period().to),select=document.createElement("select");select.id="chart-metric";select.setAttribute("aria-label",tr("chart.metric"));activeMetrics().forEach(value=>{const option=el("option","",chartLabel(value));option.value=value;option.selected=state.metric===value;select.append(option);});section.querySelector(".panel-head").append(select);if(rows.length===0){section.append(el("div","chart-note",tr("chart.empty")));return section;}const values=rows.map(row=>chartValue(row,state.metric)),maximum=Math.max.apply(null,values.concat([1])),firstDate=Date.parse(rows[0].date+"T00:00:00Z"),lastDate=Date.parse(rows[rows.length-1].date+"T00:00:00Z"),span=lastDate-firstDate,points=rows.map((row,index)=>{const x=span<=0?400:8+((Date.parse(row.date+"T00:00:00Z")-firstDate)/span)*784;return {x:x,y:172-(values[index]/maximum)*164,row:row,value:values[index]};}),chartNode=el("div","chart"),axis=el("div","chart-axis");axis.setAttribute("aria-hidden","true");[maximum,maximum/2,0].forEach(value=>axis.append(el("span","",chartText(state.metric,value))));const svg=document.createElementNS(SVG_NS,"svg");svg.setAttribute("class","line-chart");svg.setAttribute("viewBox","0 0 800 180");svg.setAttribute("preserveAspectRatio","none");svg.setAttribute("role","img");svg.setAttribute("aria-label",tr("chart.aria",{metric:label,days:rows.length}));[8,90,172].forEach(y=>{const line=document.createElementNS(SVG_NS,"line");line.setAttribute("class","chart-grid");line.setAttribute("x1","8");line.setAttribute("x2","792");line.setAttribute("y1",String(y));line.setAttribute("y2",String(y));svg.append(line);});const polyline=document.createElementNS(SVG_NS,"polyline");polyline.setAttribute("class","activity-line");polyline.setAttribute("points",points.map(point=>point.x.toFixed(2)+","+point.y.toFixed(2)).join(" "));svg.append(polyline);points.forEach(point=>{const circle=document.createElementNS(SVG_NS,"circle");circle.setAttribute("class","line-point");circle.setAttribute("cx",point.x.toFixed(2));circle.setAttribute("cy",point.y.toFixed(2));circle.setAttribute("r","3");const title=document.createElementNS(SVG_NS,"title");title.textContent=point.row.date+" · "+chartText(state.metric,point.value);circle.append(title);svg.append(circle);});chartNode.append(axis,svg,el("div","chart-dates",rows[0].date+" → "+rows[rows.length-1].date));section.append(chartNode,el("div","chart-note",tr("chart.note",{metric:label})));const details=document.createElement("details"),summary=el("summary","",tr("chart.data")),headers=[tr("table.date"),tr("table.sessions"),tr("table.tokens"),tr("table.cost")],withGenerations=activeMetrics().indexOf("generations")>=0,withTools=activeMetrics().indexOf("tools")>=0;if(withGenerations)headers.push(tr("table.generations"));if(withTools)headers.push(tr("table.tools"));const tableRows=rows.map(row=>{const cells=[row.date,number(row.sessions),number(row.totalTokens),money(row.cost)];if(withGenerations)cells.push(number(row.generations));if(withTools)cells.push(number(row.tools));return cells;});details.append(summary);simpleTable(details,headers,tableRows);section.append(details);return section;}
function overview(view){const metrics=el("div","metrics");metrics.append(metric(tr("metric.cost"),money(view.usage.cost),tr("metric.native"),[[tr("evidence.native"),money(view.usage.cost)],[tr("metric.child"),view.agentCount===null?tr("evidence.unavailable"):number(view.agentCount)+" · "+tr("metric.child.note")]]),metric(tr("metric.tokens"),number(view.usage.totalTokens),tr("metric.tokens.note"),[[tr("metric.input"),tokenCell(view.usage,"inputTokens")],[tr("metric.output"),tokenCell(view.usage,"outputTokens")],[tr("metric.cacheRead"),tokenCell(view.usage,"cacheReadTokens")],[tr("metric.cacheWrite"),tokenCell(view.usage,"cacheWriteTokens")],[tr("usage.total"),number(view.usage.totalTokens)]]),metric(tr("metric.generations"),number(view.generationCount),tr("metric.generations.note"),[[tr("evidence.native"),number(view.generationCount)]]),metric(tr("metric.tools"),number(view.toolCount),tr("metric.tools.note"),[[tr("evidence.native"),number(view.toolCount)]]),metric(tr("metric.duration"),orUnavailable(view.durationLabel),tr("metric.duration.note"),[[tr("evidence.native"),view.span?view.span.from+" → "+view.span.to:tr("evidence.unavailable")]]));const grid=el("div","grid");grid.append(bars(tr("panel.models"),tr("models.note"),view.modelBars),bars(tr("panel.tools"),tr("tools.bars.note"),view.toolBars));const all=el("div","");all.append(metrics,grid,compositionCard(view.composition),evidencePanel(activeEvidence()));return all;}
function agentsPanel(view,title){const wrap=el("div",""),activity=view.agentActivity;let has=false;if(activity&&activity.state==="supported"){has=true;const section=card(tr("panel.activity"),tr("agents.activity.note"),badge(tr("evidence."+activity.state),confidenceTone(activity.state))),metrics=el("div","metrics");metrics.append(metric(tr("metric.agentCalls"),number(activity.calls),tr("metric.tools.note"),[[tr("agents.succeeded"),number(activity.succeeded)],[tr("agents.failed"),number(activity.failed)],[tr("agents.interrupted"),number(activity.interrupted)] ]));section.append(metrics);if(activity.tools&&activity.tools.length>0)simpleTable(section,[tr("table.tool"),tr("table.calls")],activity.tools.map(row=>[row.name,number(row.calls)]));wrap.append(section);}if(view.agentEvidence==="supported"){has=true;wrap.append(table(title,tr("agents.note"),[tr("table.run"),tr("table.parent"),tr("table.status"),tr("table.tokens"),tr("table.cost"),tr("table.evidence")],view.agents.map(row=>[row.id,row.parentId===null?tr("evidence.unavailable"):row.parentId,row.status,row.usage?number(row.usage.totalTokens):tr("evidence.unavailable"),row.usage?money(row.usage.cost):tr("evidence.unavailable"),badge(tr("evidence."+row.confidence),confidenceTone(row.confidence))])));}if(!has)wrap.append(unavailableSection(title,tr("unavailable.agents")));return wrap;}
function skillsPanel(view,title){const skills=view.skills;if(!skills)return unavailableSection(title,tr("unavailable.skills"));const section=skills.items.length===0?emptyCard(title,tr("skills.empty"),"evidence.unavailable"):table(title,tr("skills.note"),[tr("table.name"),tr("table.source"),tr("table.scope"),tr("table.origin"),tr("table.invocations")],skills.items.map(row=>[row.name,orUnavailable(row.sourceLabel),orUnavailable(row.scope),orUnavailable(row.origin),row.explicitInvocations===undefined?tr("evidence.unavailable"):number(row.explicitInvocations)]));if(skills.otherInvocations!==null&&skills.otherInvocations!==undefined&&skills.otherInvocations>0)section.append(el("div","footnote",tr("skills.otherInvocations",{count:number(skills.otherInvocations)})));return section;}
function resourcesCard(resources){if(!resources||resources.state!=="supported"||resources.items.length===0)return unavailableSection(tr("panel.resources"),tr("resources.unavailable"));return simpleTable(card(tr("panel.resources"),tr("resources.note")),[tr("table.source"),tr("table.scope"),tr("table.origin"),tr("table.commands"),tr("table.skills"),tr("table.prompts"),tr("table.tools")],resources.items.map(row=>[row.sourceLabel,row.scope,row.origin,number(row.commands),number(row.skills),number(row.prompts),number(row.tools)]));}
function integrationsPanel(view,title){const wrap=el("div",""),integrations=view.integrations||[];if(integrations.length===0)wrap.append(unavailableSection(title,tr("unavailable.integrations")));else wrap.append(table(title,tr("integrations.note"),[tr("table.integration"),tr("table.presence"),tr("table.evidence"),tr("table.version"),tr("table.counters")],integrations.map(row=>[row.integration,presenceBadge(row.presence),badge(tr("evidence."+row.state),confidenceTone(row.state)),row.version===null?tr("evidence.unavailable"):String(row.version),row.counters.join(" · ")])));wrap.append(resourcesCard(view.resources));return wrap;}
function detail(view,title){if(state.tab==="models")return view.models.length===0?emptyCard(title,tr("models.none"),"evidence.native"):table(title,tr("models.note"),[tr("table.provider"),tr("table.model"),tr("table.generations"),tr("table.input"),tr("table.output"),tr("table.cacheRead"),tr("table.cacheWrite"),tr("table.tokens"),tr("table.cost")],view.models.map(row=>[row.provider,row.model,number(row.generations),numberOrUnavailable(row.inputTokens),numberOrUnavailable(row.outputTokens),numberOrUnavailable(row.cacheReadTokens),numberOrUnavailable(row.cacheWriteTokens),number(row.totalTokens),money(row.cost)]));if(state.tab==="tools")return view.tools.length===0?emptyCard(title,tr("tools.none"),"evidence.native"):table(title,tr("tools.note"),[tr("table.tool"),tr("table.source"),tr("table.status"),tr("table.tokens"),tr("table.cost"),tr("table.duration")],view.tools.map(row=>[row.name,orUnavailable(row.source),row.status,row.usage?number(row.usage.totalTokens):tr("evidence.unavailable"),row.usage?money(row.usage.cost):tr("evidence.unavailable"),row.durationLabel===null?tr("evidence.unavailable"):row.durationLabel+" · "+tr("evidence.live")]));if(state.tab==="commands"){const commands=view.commands;if(!commands||commands.items.length===0)return emptyCard(title,commands&&commands.count!==null?tr("commands.count",{count:number(commands.count)}):tr("unavailable.commands"),"evidence.unavailable");return table(title,tr("commands.note"),[tr("table.name"),tr("table.source"),tr("table.scope"),tr("table.origin"),tr("table.description")],commands.items.map(row=>[row.name,orUnavailable(row.sourceLabel||row.source||null),row.scope,row.origin,orUnavailable(row.description)]));}if(state.tab==="agents")return agentsPanel(view,title);if(state.tab==="skills")return skillsPanel(view,title);if(state.tab==="integrations")return integrationsPanel(view,title);if(state.tab==="errors"){if(view.errors.length===0)return emptyCard(title,tr("errors.none"),"evidence.native");return table(title,tr("errors.note"),[tr("table.id"),tr("table.kind"),tr("table.timestamp"),tr("table.message"),tr("table.confidence")],view.errors.map(row=>[row.id,row.kind,row.timestamp,orUnavailable(row.message),badge(tr("evidence."+row.confidence),confidenceTone(row.confidence))]));}if(state.tab==="ledger"){if(view.ledger.length===0)return emptyCard(title,tr("empty.ledger"),"evidence.unavailable");return table(title,tr("ledger.materialized"),[tr("table.timestamp"),tr("table.id"),tr("table.category"),tr("table.action"),tr("table.confidence")],view.ledger.map(item=>[item.timestamp,item.id,item.kind,item.status,item.confidence]));}return unavailableSection(title,tr("unavailable.copy"));}
function inPeriod(entry){if(entry.firstDate===null||entry.lastDate===null)return true;return entry.firstDate<=period().to&&entry.lastDate>=period().from;}
function sessionCell(entry){const cell=document.createElement("div");cell.append(el("span","mono",entry.sessionId));cell.append(el("small","",entry.firstDate?(entry.firstDate+(entry.lastDate&&entry.lastDate!==entry.firstDate?" → "+entry.lastDate:"")):tr("evidence.unavailable")));return cell;}
function openButton(index){const button=el("button","",tr("table.open"));button.dataset.session=String(index);button.setAttribute("aria-label",tr("table.open")+" "+historySessions()[index].sessionId);return button;}
function historyTable(visible){const section=card(tr("panel.history"),tr("history.note")),headers=[tr("table.session"),tr("table.duration"),tr("table.tokens"),tr("table.generations"),tr("table.agents"),tr("table.status"),tr("table.cost")];headers.push(tr("table.inspect"));const rows=visible.map(item=>{const entry=item.entry;return [sessionCell(entry),orUnavailable(entry.durationLabel),entry.totalTokens===null?tr("evidence.unavailable"):number(entry.totalTokens),entry.generationCount===null?tr("evidence.unavailable"):number(entry.generationCount),entry.agentCount===null?tr("evidence.unavailable"):number(entry.agentCount),entry.status?badge(tr(entry.status.key),entry.status.tone):tr("evidence.unavailable"),entry.cost===null?tr("evidence.unavailable"):money(entry.cost),openButton(item.index)];});simpleTable(section,headers,rows);const wrap=section.querySelector(".table-wrap"),node=section.querySelector("table");if(wrap)wrap.className="table-wrap history-table-wrap";if(node)node.className="history-table";return section;}
function historyOverview(){const days=selectedDays(),tokens=days.reduce((sum,row)=>sum+row.totalTokens,0),cost=days.reduce((sum,row)=>sum+row.cost,0),generations=days.reduce((sum,row)=>sum+(row.generations||0),0),sessions=historySessions(),visible=sessions.map((entry,index)=>({entry:entry,index:index})).filter(item=>inPeriod(item.entry)),metrics=el("div","metrics");metrics.append(metric(tr("metric.cost"),money(cost),tr("metric.native"),[[tr("table.date"),period().from+" → "+period().to]]),metric(tr("metric.tokens"),number(tokens),tr("metric.tokens.note"),[[tr("table.date"),period().from+" → "+period().to]]),metric(tr("metric.generations"),number(generations),tr("metric.generations.note"),[[tr("table.date"),period().from+" → "+period().to]]),metric(tr("metric.sessions"),number(visible.length),tr("history.sessions.note"),[[tr("evidence.native"),number(sessions.length)+" tracked"]]));const all=el("div","");all.append(metrics,historyTable(visible),evidencePanel(activeEvidence()));return all;}
function backBar(){const bar=el("div","toolbar"),button=el("button","",tr("nav.back"));button.dataset.back="true";bar.append(button);return bar;}
function globalOverview(){const days=selectedDays(),tokens=days.reduce((sum,row)=>sum+row.totalTokens,0),cost=days.reduce((sum,row)=>sum+row.cost,0),metrics=el("div","metrics");metrics.append(metric(tr("metric.cost"),money(cost),tr("metric.native"),[[tr("table.date"),period().from+" → "+period().to]]),metric(tr("metric.tokens"),number(tokens),tr("metric.tokens.note"),[[tr("table.date"),period().from+" → "+period().to]]),metric(tr("metric.days"),number(days.length),tr("metric.days.note"),[[tr("range.label"),period().from+" → "+period().to]]),metric(tr("metric.sessions"),number(data.global.trackedSessions),tr("metric.sessions.global.note"),[[tr("evidence.native"),number(data.global.trackedSessions-data.global.unavailableSessions)+" replayed"],[tr("evidence.unavailable"),number(data.global.unavailableSessions)+" unavailable"]]));const all=el("div","");all.append(metrics,compositionCard(data.global.composition),evidencePanel(activeEvidence()));return all;}
function sessionPanel(entry){if(!entry||!entry.view)return unavailableSection(tr("tab."+state.tab),tr("unavailable.session"));return state.tab==="overview"?overview(entry.view):detail(entry.view,tr("tab."+state.tab));}
function renderView(){const nodes=[];if(state.section==="global"){if(state.tab==="overview"){nodes.push(globalOverview());nodes.push(chart());}else nodes.push(unavailableSection(tr("tab."+state.tab),tr("unavailable.global")));return nodes;}if(state.section==="history"){if(state.session===null){nodes.push(historyOverview());if(state.tab==="overview")nodes.push(chart());else nodes.push(unavailableSection(tr("tab."+state.tab),tr("unavailable.session")));return nodes;}nodes.push(sessionPanel(historySessions()[state.session]));if(state.tab==="overview")nodes.push(chart());nodes.push(backBar());return nodes;}const view=currentView();if(!view||view.availability!=="available"){nodes.push(unavailableSection(tr("tab."+state.tab),tr("unavailable.current")+(view&&view.diagnostic?" · "+view.diagnostic:"")));return nodes;}if(state.tab==="overview"){nodes.push(overview(view.report));nodes.push(chart());}else nodes.push(detail(view.report,tr("tab."+state.tab)));return nodes;}
function sessionScopeNote(){const entry=historySessions()[state.session];return (entry.firstDate||tr("evidence.unavailable"))+(entry.lastDate&&entry.lastDate!==entry.firstDate?" → "+entry.lastDate:"")+" · "+tr("scope.tree")+" after tracking marker";}
const scopeButtons=[].slice.call(q("scope").querySelectorAll("button"));
function syncScope(){scopeButtons.forEach(button=>{const scope=button.dataset.scope,view=data.current[scope],unavailable=state.section!=="current"||view.availability!=="available";button.disabled=unavailable;button.setAttribute("aria-pressed",String(state.section==="current"&&scope===state.scope));if(view.diagnostic)button.title=view.diagnostic;else button.removeAttribute("title");});q("scope-fixed").hidden=state.section==="current";}
function render(){const scrollY=window.scrollY||0,active=document.activeElement,caret=active&&active.id==="search"&&typeof active.selectionStart==="number"?active.selectionStart:null;q("wal-detail").hidden=true;q("time-range").hidden=false;syncScope();syncRangeNotice();q("range-name").textContent=period().preset?tr("range.last",{days:period().preset}):tr("range.custom");q("range-dates").textContent=period().from+" → "+period().to;[].slice.call(document.querySelectorAll("[data-days]")).forEach(node=>node.setAttribute("aria-pressed",String(Number(node.dataset.days)===period().preset)));q("custom-range").setAttribute("aria-pressed",String(period().preset===null));const titles={current:["kicker.current","heading.current","subtitle.current"],history:["kicker.history","heading.history","subtitle.history"],global:["kicker.global","heading.global","subtitle.global"]}[state.section];q("kicker").textContent=tr(titles[0]);q("title").textContent=tr(titles[1]);q("subtitle").textContent=tr(titles[2]);q("breadcrumb").textContent=state.section==="history"&&state.session!==null?historySessions()[state.session].sessionId:tr("nav."+state.section);q("session-label").textContent=state.section==="current"?(currentReport()?currentReport().sessionId:tr("evidence.unavailable")):state.section==="history"&&state.session!==null?historySessions()[state.session].sessionId:number(state.section==="history"?historySessions().length:data.global.trackedSessions)+" tracked sessions";q("scope-note").textContent=state.section==="current"?(state.scope==="active"?tr("scope.active"):tr("scope.tree"))+" after tracking marker":state.section==="history"&&state.session!==null?sessionScopeNote():tr("scope.fixed")+" · "+period().from+" → "+period().to;const view=q("view");view.replaceChildren.apply(view,renderView());if(state.resetScroll){state.resetScroll=false;window.scrollTo(0,0);}else{window.scrollTo(0,scrollY);}if(caret!==null){const search=q("search");if(search){search.focus();try{search.setSelectionRange(caret,caret);}catch(error){}}}q("announcement").textContent=tr("nav."+state.section)+", "+tr("tab."+state.tab)+", "+period().from+" → "+period().to;}
const nav=q("navigation");["current","history","global"].forEach(kind=>{const button=el("button","",tr("nav."+kind));button.dataset.range=kind;button.setAttribute("aria-pressed",String(kind===state.section));button.disabled=false;button.addEventListener("click",()=>{state.section=kind;state.tab="overview";state.session=null;state.metric=activeMetrics()[0]||"sessions";state.resetScroll=true;render();});nav.append(button);});
const tabsNode=q("tabs");TABS.forEach(tab=>{const button=el("button","",tr("tab."+tab));button.dataset.tab=tab;button.setAttribute("aria-pressed",String(tab===state.tab));button.addEventListener("click",()=>{state.tab=tab;[].slice.call(tabsNode.children).forEach(item=>item.setAttribute("aria-pressed",String(item===button)));render();});tabsNode.append(button);});
scopeButtons.forEach(button=>button.addEventListener("click",()=>{if(button.disabled)return;state.scope=button.dataset.scope;periods.current=defaultPeriod(data.current[state.scope].daily,null);state.resetScroll=true;render();}));
document.addEventListener("input",event=>{if(event.target.id!=="search")return;state.query=event.target.value;render();});
document.addEventListener("change",event=>{if(event.target.id==="sort"){state.sort=event.target.value;render();}else if(event.target.id==="chart-metric"){state.metric=event.target.value;render();const select=q("chart-metric");if(select)select.focus();}});
document.addEventListener("click",event=>{const button=event.target&&event.target.closest?event.target.closest("button"):null;if(!button)return;if(button.dataset.back!==undefined){state.session=null;state.tab="overview";state.resetScroll=true;render();}else if(button.dataset.session!==undefined){state.session=Number(button.dataset.session);state.tab="overview";state.resetScroll=true;render();}});
[].slice.call(document.querySelectorAll("[data-days]")).forEach(button=>button.addEventListener("click",()=>{const days=Number(button.dataset.days),end=latestDate()||"1970-01-01",start=new Date(end+"T00:00:00Z");start.setUTCDate(start.getUTCDate()-days+1);periods[state.section]={preset:days,from:start.toISOString().slice(0,10),to:end};render();}));
q("custom-range").addEventListener("click",()=>{q("date-from").value=period().from;q("date-to").value=period().to;q("date-error").textContent="";q("date-dialog").showModal();});
q("date-cancel").addEventListener("click",()=>q("date-dialog").close());
q("date-form").addEventListener("submit",event=>{event.preventDefault();const dates=activeDaily().map(row=>row.date).sort(),min=dates.length?dates[0]:null,max=dates.length?dates[dates.length-1]:null;let from=q("date-from").value,to=q("date-to").value;if(min&&from<min)from=min;if(max&&to>max)to=max;if(!from||!to||from>to){q("date-error").textContent=tr("range.error");return;}periods[state.section]={preset:null,from:from,to:to};q("date-dialog").close();render();});
q("theme").addEventListener("click",event=>{const dark=document.body.classList.toggle("theme-dark");event.currentTarget.textContent=tr(dark?"theme.light":"theme.dark");event.currentTarget.setAttribute("aria-pressed",String(dark));});
render();
`;

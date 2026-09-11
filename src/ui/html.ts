import type { EvidenceState, Scope } from "../core/events.ts";
import { buildLedger, type LedgerItem } from "../core/ledger.ts";
import type { SessionReport } from "../core/reports.ts";
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
  "evidence.child.missing": "No supported child artifact",
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
  "evidence.global.agents": "Global report carries no child artifact",
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
  "unavailable.agents": "No supported child agent artifact was supplied.",
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
  status: StatusView;
  models: ModelRow[];
  modelBars: BarRow[];
  tools: ToolRow[];
  toolBars: BarRow[];
  agents: AgentRow[];
  integrations: IntegrationRow[];
  errors: ErrorRow[];
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
  '\n:root{color-scheme:light;--bg:#f7f7f4;--surface:#fff;--soft:#f0f0eb;--ink:#252820;--muted:#535b4f;--line:#dddfd6;--accent:#aa3e13;--tint:#fff0e6;--green:#34624b;--green-bg:#edf5ee;--warning:#825719;--mono:ui-monospace,SFMono-Regular,Consolas,monospace}\n*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input,select{font:inherit;color:inherit}button,select{cursor:pointer}button{background:var(--surface);border:1px solid var(--line);border-radius:7px;min-height:40px;padding:8px 14px}button:hover{border-color:var(--muted);background:var(--soft)}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid var(--accent);outline-offset:3px}button[aria-pressed=true]{background:var(--tint);color:var(--accent);border-color:var(--accent)}h1,h2,h3,p{margin:0}h1{font-size:30px;font-weight:620;letter-spacing:-1px;line-height:1.25}h2{font-size:16px;font-weight:620}h3{font-size:14px}small,.muted{color:var(--muted)}small{font-size:12px}.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}.skip{position:absolute;top:-60px;left:16px;z-index:10;background:var(--surface);padding:10px}.skip:focus{top:10px}.shell{display:grid;grid-template-columns:224px minmax(0,1fr);min-height:100vh}aside{padding:28px 18px;border-right:1px solid var(--line);display:flex;flex-direction:column;background:var(--surface)}.brand{display:flex;align-items:center;gap:10px;font-size:16px;font-weight:650;line-height:1.3;padding:0 10px 32px}.mark{display:grid;place-items:center;background:var(--ink);color:var(--surface);width:34px;height:34px;border-radius:9px;font:24px Georgia,serif}.brand small{font-weight:400}.eyebrow{font:11px var(--mono);text-transform:uppercase;letter-spacing:1.4px;color:var(--muted)}aside .eyebrow{padding:0 12px;margin:20px 0 8px}.nav{display:grid;gap:4px}.nav button{border-color:transparent;background:transparent;display:flex;align-items:center;gap:10px;text-align:left;padding:10px 12px;min-height:44px}.nav button[aria-pressed=true]{background:var(--tint);color:var(--accent)}.nav svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.5}.rail-foot{margin-top:auto;padding:40px 12px 0}.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--green);margin-right:7px}.rail-foot p{margin-top:8px;font-size:12px;color:var(--muted)}.workspace{min-width:0}.topbar{padding:16px 36px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:16px;background:var(--surface)}.topbar .trail{font-size:12px;color:var(--muted)}.topbar .trail strong{color:var(--ink);font-weight:500}.preview{font:11px var(--mono);color:var(--accent);border:1px solid var(--line);border-radius:5px;padding:5px 8px;white-space:nowrap}.content{max-width:1440px;margin:auto;padding:34px 36px}.heading{display:flex;justify-content:space-between;gap:24px;align-items:center}.heading p{color:var(--muted);margin-top:9px}.actions{display:flex;gap:8px;flex-wrap:wrap}.primary{background:var(--ink);color:var(--surface);border-color:var(--ink)}.primary:hover{background:var(--muted);color:var(--surface)}.context{display:flex;justify-content:space-between;gap:16px;align-items:center;margin:26px 0 22px}.context small{display:block;margin-top:5px}.segments{display:flex;gap:4px}.segments button{padding:6px 14px;min-height:36px}.badge{font-size:11px;display:inline-block;padding:3px 8px;border-radius:5px;background:var(--green-bg);color:var(--green);white-space:nowrap}.badge.neutral{background:var(--soft);color:var(--muted)}.badge.warn{background:var(--tint);color:var(--warning)}.tabs{display:flex;flex-wrap:wrap;gap:4px;border-bottom:1px solid var(--line);margin-bottom:24px;padding-bottom:8px}.tabs button{border:0;background:none;color:var(--muted);padding:8px 11px}.tabs button[aria-pressed=true]{color:var(--accent);background:var(--tint)}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(196px,1fr));gap:16px}.card{border:1px solid var(--line);background:var(--surface);border-radius:10px;overflow:hidden}.metric{padding:20px}.metric .value{font-size:30px;letter-spacing:-1px;margin:12px 0 8px;line-height:1.2}.metric:first-child{border-top:3px solid var(--accent);padding-top:18px}.metric .value small{font-size:14px;letter-spacing:0}.panel-head{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:20px 22px}.panel-head p{font-size:12px;color:var(--muted);margin-top:4px}.grid{display:grid;grid-template-columns:1.6fr 1fr;gap:20px;margin-top:20px}.bars{padding:6px 22px 22px;display:grid;gap:20px}.bar-label{display:flex;justify-content:space-between;gap:12px;margin-bottom:8px;font-size:13px}.track{height:8px;background:var(--soft);border-radius:3px;overflow:hidden}.fill{height:100%;background:var(--accent);border-radius:3px}.bar:nth-child(even) .fill{background:#747f67}.footnote{border-top:1px solid var(--line);padding:12px 22px;font-size:12px;color:var(--muted)}.notice{display:flex;gap:12px;border:1px solid var(--line);background:var(--soft);padding:14px 18px;border-radius:8px;margin-top:24px;font-size:12px;color:var(--muted)}.notice strong{color:var(--ink)}.toolbar{display:flex;gap:12px;flex-wrap:wrap;align-items:end;padding:0 22px 18px}.toolbar label{display:grid;gap:5px;font-size:12px;color:var(--muted)}input,select{background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:9px 12px;min-height:40px;max-width:100%}input{width:250px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;text-align:left;white-space:nowrap}th{font-size:11px;text-transform:uppercase;letter-spacing:.7px;color:var(--muted);font-weight:500;background:var(--bg)}th,td{padding:13px 22px;border-top:1px solid var(--line)}td{font-size:13px}td:last-child{text-align:right}tbody tr:hover{background:var(--bg)}.empty{text-align:center;padding:56px 24px}.empty h2{margin:12px 0 8px}.empty p{max-width:440px;margin:auto;color:var(--muted)}.empty .eyebrow{color:var(--accent)}.chart{display:grid;grid-template-columns:52px minmax(0,1fr);gap:10px;padding:8px 22px 0}.chart-axis{display:flex;flex-direction:column;justify-content:space-between;text-align:right;padding:4px 0;font:12px var(--mono);color:var(--muted)}.line-chart{display:block;width:100%;height:180px;overflow:visible}.chart-grid{stroke:var(--line);stroke-width:1;vector-effect:non-scaling-stroke}.activity-line{fill:none;stroke:var(--accent);stroke-width:2.5;stroke-linejoin:round;vector-effect:non-scaling-stroke}.line-point{fill:var(--surface);stroke:var(--accent);stroke-width:2;vector-effect:non-scaling-stroke}.chart-dates{grid-column:2;display:flex;justify-content:space-between;font:12px var(--mono);color:var(--muted)}.chart-note{padding:20px 22px;font-size:12px;color:var(--muted)}.section-gap{margin-top:20px}footer{display:flex;justify-content:space-between;gap:12px;margin-top:20px;font-size:11px;color:var(--muted)}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}details{padding:12px 22px}summary{cursor:pointer;min-height:32px}.theme-dark{color-scheme:dark;--bg:#181c19;--surface:#202521;--soft:#2b312b;--ink:#eef0e8;--muted:#bdc5b8;--line:#40493e;--accent:#ffad80;--tint:#392b22;--green:#b1d4b9;--green-bg:#29372d;--warning:#edc78f}noscript{display:block;padding:24px}.content a{color:var(--accent)}@media(max-width:1100px){.shell{grid-template-columns:188px minmax(0,1fr)}.content{padding:28px 24px}.topbar{padding:16px 24px}.grid{grid-template-columns:1fr}.metrics{gap:10px}.metric{padding:16px}.metric:first-child{padding-top:14px}.metric .value{font-size:26px}.heading{align-items:flex-start}}@media(max-width:760px){.shell{display:block}aside{padding:16px;border-right:0;border-bottom:1px solid var(--line)}.brand{padding:0 0 16px}.nav{display:flex;flex-wrap:wrap}.nav button{flex:1}.rail-foot,aside .eyebrow{display:none}.topbar{padding:12px 16px}.content{padding:24px 16px}.heading{display:block}.actions{margin-top:18px}.context{align-items:flex-start;flex-direction:column}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.tabs button{min-height:44px}.panel-head{padding:18px 16px;flex-wrap:wrap}.toolbar{padding-left:16px;padding-right:16px}input{width:100%}.toolbar label{flex:1;min-width:120px}footer{flex-wrap:wrap}.chart{gap:8px;padding-left:16px;padding-right:16px}.notice{align-items:flex-start}.trail{overflow-wrap:anywhere}}@media(prefers-reduced-motion:no-preference){button{transition:background .15s,border-color .15s}}@media print{aside,.topbar,.actions,.tabs,.toolbar,.segments{display:none}.shell{display:block}.content{padding:0}.card{break-inside:avoid}}\n[hidden]{display:none!important}.time-range{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:16px 20px;margin-bottom:22px;background:var(--surface);border:1px solid var(--line);border-radius:10px}.time-range small{display:block;margin-top:4px}.time-range .segments{flex-wrap:wrap}.time-range button{min-height:44px}dialog{background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:12px;padding:24px;width:min(440px,calc(100% - 32px))}dialog::backdrop{background:#0008}dialog form{display:grid;gap:18px}dialog label{display:grid;gap:6px}dialog input{width:100%}dialog .actions{justify-content:flex-end;margin-top:0}.date-error{color:var(--accent);font-size:13px}\n.utility-actions button{background:transparent;color:var(--muted);font-size:12px;padding:6px 10px}.utility-actions button:hover{color:var(--ink);background:var(--soft)}.data-scope{display:flex;gap:24px;flex-wrap:wrap;align-items:center;border:1px solid var(--line);border-radius:10px;background:var(--surface);padding:16px 20px;margin-bottom:22px}.scope-group{display:grid;gap:8px}.scope-group .eyebrow{font-weight:600}.scope-group button{min-height:44px}button:disabled{opacity:.6;cursor:not-allowed}.data-scope .time-range{flex:1;min-width:240px;border:0;border-radius:0;padding:0;margin:0}.data-scope .time-range small{font-size:12px}.breakdown{display:grid;gap:4px;margin-top:12px;padding-top:10px;border-top:1px solid var(--line);font-size:12px;color:var(--muted)}.breakdown-row{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}.breakdown .mono{color:var(--ink)}.history-table th,.history-table td{padding:10px 12px}.history-table th:first-child,.history-table td:first-child{padding-left:20px}.history-table small{display:block}.history-table .number{text-align:right;font-variant-numeric:tabular-nums}.history-table button{min-height:40px;padding:6px 10px}.history-table .badge{font-size:12px}.history-table-wrap:focus-visible{outline:3px solid var(--accent);outline-offset:-3px}@media(max-width:760px){.data-scope{padding:16px;gap:16px}.data-scope .time-range{flex-basis:100%;min-width:0;border-top:1px solid var(--line);padding-top:16px}.utility-actions{margin-top:12px}.chart{grid-template-columns:42px minmax(0,1fr);padding-left:16px;padding-right:16px}.chart-axis,.chart-dates{font-size:12px}}\n';
function renderBody(data: string): string {
  const t = ENGLISH_CATALOG;
  return `\n</style></head><body>
<a class="skip" href="#main">Skip to report</a><div class="shell"><aside aria-label="${t.workspace}"><div class="brand"><span class="mark" aria-hidden="true">π</span><span>${t["report.title"]}<br><small>${t["brand.tagline"]}</small></span></div><p class="eyebrow">${t.workspace}</p><nav class="nav" id="navigation" aria-label="Report range"></nav><div class="rail-foot"><span class="dot"></span>${t["local.design"]}<p>Offline report. No tracking.<br>No prompts or outputs.</p><p class="mono">${t.offline}</p></div></aside><div class="workspace"><header class="topbar"><span class="trail">Inspector / <strong id="breadcrumb"></strong></span><span class="preview">${t["tag.local"]}</span></header><main id="main" class="content" tabindex="-1">
<div class="heading"><div><p class="eyebrow" id="kicker"></p><h1 id="title"></h1><p id="subtitle"></p></div><div class="actions utility-actions"><button id="theme" aria-pressed="false">${t["theme.dark"]}</button></div></div><div class="context"><div><span class="mono" id="session-label"></span> <span class="badge neutral">${t["tag.snapshot"]}</span><small id="scope-note"></small></div></div>
<div class="notice" id="wal-detail" hidden><span aria-hidden="true">ⓘ</span><div><strong>${t["walDetail.expired"]}</strong> ${t["walDetail.copy"]}</div></div>
<div class="data-scope" role="group" aria-label="Data scope"><div class="scope-group"><p class="eyebrow">${t["scope.label"]}</p><div class="segments" id="scope" aria-label="${t["scope.label"]}"><button data-scope="active">${t["scope.active"]}</button><button data-scope="tree">${t["scope.tree"]}</button></div><small id="scope-fixed" hidden>${t["scope.fixed"]}</small></div><section class="time-range" id="time-range" aria-label="${t["range.label"]}" hidden><div><p class="eyebrow">${t["range.label"]}</p><strong id="range-name"></strong><div class="mono" id="range-dates" aria-live="polite"></div><small>${t["range.inclusive"]}</small></div><div class="segments"><button data-days="7">7D</button><button data-days="14">14D</button><button data-days="30">30D</button><button id="custom-range" aria-haspopup="dialog">${t["range.custom"]}</button></div></section></div>
<dialog id="date-dialog" aria-labelledby="date-title"><form id="date-form"><h2 id="date-title">${t["range.custom.title"]}</h2><p class="muted">${t["range.inclusive"]}</p><label>${t["range.from"]}<input id="date-from" type="date" required aria-describedby="date-error"></label><label>${t["range.to"]}<input id="date-to" type="date" required aria-describedby="date-error"></label><p id="date-error" class="date-error" role="alert"></p><div class="actions"><button type="button" id="date-cancel">${t["range.cancel"]}</button><button type="submit" class="primary">${t["range.apply"]}</button></div></form></dialog>
<nav class="tabs" id="tabs" aria-label="Report section"></nav><div id="view"></div><div class="notice"><span aria-hidden="true">ⓘ</span><div><strong>${t["notice.sensitive"]}</strong> ${t["notice.copy"]}</div></div><footer><span>${t["footer.authority"]}</span><span class="mono">${t.offline}</span></footer><p id="announcement" class="sr-only" role="status"></p></main></div></div><noscript>This report requires JavaScript. It is self-contained and makes no network requests.</noscript><script type="application/json" id="report-data">${data}</script><script type="application/json" id="catalog-data">${JSON.stringify(t)}</script><script>\n`;
}
/** Renders a self-contained report from shared DTOs only; no source locator or content fields are projected. */
export function renderHtml(input: HtmlReport): string {
  const data = JSON.stringify(projectReport(input)).replace(
    /[<>&\u2028\u2029]/g,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  const t = ENGLISH_CATALOG;
  return `${renderHead(t)}${STYLES}${renderBody(data)}${SCRIPT}\n</script></body></html>`;
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
    })),
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

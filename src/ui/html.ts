import type { Scope } from "../core/events.ts";
import type { SessionReport } from "../core/reports.ts";
import type { GlobalReport, HistoryReport } from "./load-history.ts";

export const ENGLISH_CATALOG = {
  "report.title": "Pi Session Inspector",
  "nav.current": "Current session",
  "nav.history": "Session history",
  "nav.global": "Global report",
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
  "metric.native": "Persisted usage · USD",
  "metric.input": "Input",
  "metric.output": "Output",
  "metric.cache": "Cache",
  "panel.models": "Model cost",
  "panel.tools": "Tool activity",
  "panel.evidence": "Evidence, not estimates.",
  "panel.daily": "Daily activity",
  "panel.history": "Tracked sessions",
  "panel.agents": "Agent breakdown",
  "panel.integrations": "Integrations",
  "panel.ledger": "Chronological ledger",
  "evidence.native": "Native",
  "evidence.cooperative": "Cooperative",
  "evidence.unavailable": "Unavailable",
  "evidence.unsupported": "Unsupported",
  "evidence.source": "Source-aware",
  "notice.sensitive": "Local does not mean safe to share.",
  "notice.copy":
    "Report metadata can be sensitive. Review exports before sharing.",
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
  "unavailable.title": "Unavailable, not zero.",
  "unavailable.copy":
    "This report has no supported observations for this section. Inspector does not infer activity from missing records.",
  "history.scope": "Full-tree report summaries.",
  offline: "OFFLINE · EN",
  "brand.tagline": "Understand your agent.",
  "local.design": "Local by design",
  "metric.child": "Child breakdown",
  "table.source": "Source",
  "ledger.materialized": "Materialized only when this section opens.",
  "chart.data": "View chart data",
} as const;

export type HtmlReport =
  | { kind: "current"; report: SessionReport; scope: Scope }
  | { kind: "history"; report: HistoryReport }
  | { kind: "global"; report: GlobalReport };

const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'";

/** Renders a self-contained report from shared DTOs only; no source locator or content fields are projected. */
export function renderHtml(input: HtmlReport): string {
  const data = JSON.stringify(projectReport(input)).replace(
    /[<>&\u2028\u2029]/g,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  const t = ENGLISH_CATALOG;
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${CSP}"><title>${t["report.title"]}</title><style>\n` +
    '\n:root{color-scheme:light;--bg:#f7f7f4;--surface:#fff;--soft:#f0f0eb;--ink:#252820;--muted:#535b4f;--line:#dddfd6;--accent:#aa3e13;--tint:#fff0e6;--green:#34624b;--green-bg:#edf5ee;--warning:#825719;--mono:ui-monospace,SFMono-Regular,Consolas,monospace}\n*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input,select{font:inherit;color:inherit}button,select{cursor:pointer}button{background:var(--surface);border:1px solid var(--line);border-radius:7px;min-height:40px;padding:8px 14px}button:hover{border-color:var(--muted);background:var(--soft)}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid var(--accent);outline-offset:3px}button[aria-pressed=true]{background:var(--tint);color:var(--accent);border-color:var(--accent)}h1,h2,h3,p{margin:0}h1{font-size:30px;font-weight:620;letter-spacing:-1px;line-height:1.25}h2{font-size:16px;font-weight:620}h3{font-size:14px}small,.muted{color:var(--muted)}small{font-size:12px}.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}.skip{position:absolute;top:-60px;left:16px;z-index:10;background:var(--surface);padding:10px}.skip:focus{top:10px}.shell{display:grid;grid-template-columns:224px minmax(0,1fr);min-height:100vh}aside{padding:28px 18px;border-right:1px solid var(--line);display:flex;flex-direction:column;background:var(--surface)}.brand{display:flex;align-items:center;gap:10px;font-size:16px;font-weight:650;line-height:1.3;padding:0 10px 32px}.mark{display:grid;place-items:center;background:var(--ink);color:var(--surface);width:34px;height:34px;border-radius:9px;font:24px Georgia,serif}.brand small{font-weight:400}.eyebrow{font:11px var(--mono);text-transform:uppercase;letter-spacing:1.4px;color:var(--muted)}aside .eyebrow{padding:0 12px;margin:20px 0 8px}.nav{display:grid;gap:4px}.nav button{border-color:transparent;background:transparent;display:flex;align-items:center;gap:10px;text-align:left;padding:10px 12px;min-height:44px}.nav button[aria-pressed=true]{background:var(--tint);color:var(--accent)}.nav svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.5}.rail-foot{margin-top:auto;padding:40px 12px 0}.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--green);margin-right:7px}.rail-foot p{margin-top:8px;font-size:12px;color:var(--muted)}.workspace{min-width:0}.topbar{padding:16px 36px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:16px;background:var(--surface)}.topbar .trail{font-size:12px;color:var(--muted)}.topbar .trail strong{color:var(--ink);font-weight:500}.preview{font:11px var(--mono);color:var(--accent);border:1px solid var(--line);border-radius:5px;padding:5px 8px;white-space:nowrap}.content{max-width:1440px;margin:auto;padding:34px 36px}.heading{display:flex;justify-content:space-between;gap:24px;align-items:center}.heading p{color:var(--muted);margin-top:9px}.actions{display:flex;gap:8px;flex-wrap:wrap}.primary{background:var(--ink);color:var(--surface);border-color:var(--ink)}.primary:hover{background:var(--muted);color:var(--surface)}.context{display:flex;justify-content:space-between;gap:16px;align-items:center;margin:26px 0 22px}.context small{display:block;margin-top:5px}.segments{display:flex;gap:4px}.segments button{padding:6px 14px;min-height:36px}.badge{font-size:11px;display:inline-block;padding:3px 8px;border-radius:5px;background:var(--green-bg);color:var(--green);white-space:nowrap}.badge.neutral{background:var(--soft);color:var(--muted)}.badge.warn{background:var(--tint);color:var(--warning)}.tabs{display:flex;flex-wrap:wrap;gap:4px;border-bottom:1px solid var(--line);margin-bottom:24px;padding-bottom:8px}.tabs button{border:0;background:none;color:var(--muted);padding:8px 11px}.tabs button[aria-pressed=true]{color:var(--accent);background:var(--tint)}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}.card{border:1px solid var(--line);background:var(--surface);border-radius:10px;overflow:hidden}.metric{padding:20px}.metric .value{font-size:30px;letter-spacing:-1px;margin:12px 0 8px;line-height:1.2}.metric:first-child{border-top:3px solid var(--accent);padding-top:18px}.metric .value small{font-size:14px;letter-spacing:0}.panel-head{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:20px 22px}.panel-head p{font-size:12px;color:var(--muted);margin-top:4px}.grid{display:grid;grid-template-columns:1.6fr 1fr;gap:20px;margin-top:20px}.bars{padding:6px 22px 22px;display:grid;gap:20px}.bar-label{display:flex;justify-content:space-between;gap:12px;margin-bottom:8px;font-size:13px}.track{height:8px;background:var(--soft);border-radius:3px;overflow:hidden}.fill{height:100%;background:var(--accent);border-radius:3px}.bar:nth-child(even) .fill{background:#747f67}.footnote{border-top:1px solid var(--line);padding:12px 22px;font-size:12px;color:var(--muted)}.notice{display:flex;gap:12px;border:1px solid var(--line);background:var(--soft);padding:14px 18px;border-radius:8px;margin-top:24px;font-size:12px;color:var(--muted)}.notice strong{color:var(--ink)}.toolbar{display:flex;gap:12px;flex-wrap:wrap;align-items:end;padding:0 22px 18px}.toolbar label{display:grid;gap:5px;font-size:12px;color:var(--muted)}input,select{background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:9px 12px;min-height:40px;max-width:100%}input{width:250px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;text-align:left;white-space:nowrap}th{font-size:11px;text-transform:uppercase;letter-spacing:.7px;color:var(--muted);font-weight:500;background:var(--bg)}th,td{padding:13px 22px;border-top:1px solid var(--line)}td{font-size:13px}td:last-child{text-align:right}tbody tr:hover{background:var(--bg)}.empty{text-align:center;padding:56px 24px}.empty h2{margin:12px 0 8px}.empty p{max-width:440px;margin:auto;color:var(--muted)}.empty .eyebrow{color:var(--accent)}.chart{display:grid;grid-template-columns:52px minmax(0,1fr);gap:10px;padding:8px 22px 0}.chart-axis{display:flex;flex-direction:column;justify-content:space-between;text-align:right;padding:4px 0;font:12px var(--mono);color:var(--muted)}.line-chart{display:block;width:100%;height:180px;overflow:visible}.chart-grid{stroke:var(--line);stroke-width:1;vector-effect:non-scaling-stroke}.activity-line{fill:none;stroke:var(--accent);stroke-width:2.5;stroke-linejoin:round;vector-effect:non-scaling-stroke}.line-point{fill:var(--surface);stroke:var(--accent);stroke-width:2;vector-effect:non-scaling-stroke}.chart-dates{grid-column:2;display:flex;justify-content:space-between;font:12px var(--mono);color:var(--muted)}.chart-note{padding:20px 22px;font-size:12px;color:var(--muted)}.section-gap{margin-top:20px}footer{display:flex;justify-content:space-between;gap:12px;margin-top:20px;font-size:11px;color:var(--muted)}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}details{padding:12px 22px}summary{cursor:pointer;min-height:32px}.theme-dark{color-scheme:dark;--bg:#181c19;--surface:#202521;--soft:#2b312b;--ink:#eef0e8;--muted:#bdc5b8;--line:#40493e;--accent:#ffad80;--tint:#392b22;--green:#b1d4b9;--green-bg:#29372d;--warning:#edc78f}noscript{display:block;padding:24px}.content a{color:var(--accent)}@media(max-width:1100px){.shell{grid-template-columns:188px minmax(0,1fr)}.content{padding:28px 24px}.topbar{padding:16px 24px}.grid{grid-template-columns:1fr}.metrics{gap:10px}.metric{padding:16px}.metric:first-child{padding-top:14px}.metric .value{font-size:26px}.heading{align-items:flex-start}}@media(max-width:760px){.shell{display:block}aside{padding:16px;border-right:0;border-bottom:1px solid var(--line)}.brand{padding:0 0 16px}.nav{display:flex;flex-wrap:wrap}.nav button{flex:1}.rail-foot,aside .eyebrow{display:none}.topbar{padding:12px 16px}.content{padding:24px 16px}.heading{display:block}.actions{margin-top:18px}.context{align-items:flex-start;flex-direction:column}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.tabs button{min-height:44px}.panel-head{padding:18px 16px;flex-wrap:wrap}.toolbar{padding-left:16px;padding-right:16px}input{width:100%}.toolbar label{flex:1;min-width:120px}footer{flex-wrap:wrap}.chart{gap:8px;padding-left:16px;padding-right:16px}.notice{align-items:flex-start}.trail{overflow-wrap:anywhere}}@media(prefers-reduced-motion:no-preference){button{transition:background .15s,border-color .15s}}@media print{aside,.topbar,.actions,.tabs,.toolbar,.segments{display:none}.shell{display:block}.content{padding:0}.card{break-inside:avoid}}\n[hidden]{display:none!important}.time-range{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:16px 20px;margin-bottom:22px;background:var(--surface);border:1px solid var(--line);border-radius:10px}.time-range small{display:block;margin-top:4px}.time-range .segments{flex-wrap:wrap}.time-range button{min-height:44px}dialog{background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:12px;padding:24px;width:min(440px,calc(100% - 32px))}dialog::backdrop{background:#0008}dialog form{display:grid;gap:18px}dialog label{display:grid;gap:6px}dialog input{width:100%}dialog .actions{justify-content:flex-end;margin-top:0}.date-error{color:var(--accent);font-size:13px}\n.utility-actions button{background:transparent;color:var(--muted);font-size:12px;padding:6px 10px}.utility-actions button:hover{color:var(--ink);background:var(--soft)}.data-scope{display:flex;gap:24px;flex-wrap:wrap;align-items:center;border:1px solid var(--line);border-radius:10px;background:var(--surface);padding:16px 20px;margin-bottom:22px}.scope-group{display:grid;gap:8px}.scope-group .eyebrow{font-weight:600}.scope-group button{min-height:44px}button:disabled{opacity:.6;cursor:not-allowed}.data-scope .time-range{flex:1;min-width:240px;border:0;border-radius:0;padding:0;margin:0}.data-scope .time-range small{font-size:12px}.breakdown{display:grid;gap:4px;margin-top:12px;padding-top:10px;border-top:1px solid var(--line);font-size:12px;color:var(--muted)}.breakdown-row{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}.breakdown .mono{color:var(--ink)}.history-table th,.history-table td{padding:10px 12px}.history-table th:first-child,.history-table td:first-child{padding-left:20px}.history-table small{display:block}.history-table .number{text-align:right;font-variant-numeric:tabular-nums}.history-table button{min-height:40px;padding:6px 10px}.history-table .badge{font-size:12px}.history-table-wrap:focus-visible{outline:3px solid var(--accent);outline-offset:-3px}@media(max-width:760px){.data-scope{padding:16px;gap:16px}.data-scope .time-range{flex-basis:100%;min-width:0;border-top:1px solid var(--line);padding-top:16px}.utility-actions{margin-top:12px}.chart{grid-template-columns:42px minmax(0,1fr);padding-left:16px;padding-right:16px}.chart-axis,.chart-dates{font-size:12px}}\n' +
    `\n</style></head><body>
<a class="skip" href="#main">Skip to report</a><div class="shell"><aside aria-label="${t.workspace}"><div class="brand"><span class="mark" aria-hidden="true">π</span><span>${t["report.title"]}<br><small>${t["brand.tagline"]}</small></span></div><p class="eyebrow">${t.workspace}</p><nav class="nav" id="navigation" aria-label="Report range"></nav><div class="rail-foot"><span class="dot"></span>${t["local.design"]}<p>Offline report. No tracking.<br>No prompts or outputs.</p><p class="mono">${t.offline}</p></div></aside><div class="workspace"><header class="topbar"><span class="trail">Inspector / <strong id="breadcrumb"></strong></span><span class="preview">${t["tag.local"]}</span></header><main id="main" class="content" tabindex="-1">
<div class="heading"><div><p class="eyebrow" id="kicker"></p><h1 id="title"></h1><p id="subtitle"></p></div><div class="actions utility-actions"><button id="theme" aria-pressed="false">${t["theme.dark"]}</button></div></div><div class="context"><div><span class="mono" id="session-label"></span> <span class="badge neutral">${t["tag.snapshot"]}</span><small id="scope-note"></small></div></div>
<div class="data-scope" role="group" aria-label="Data scope"><div class="scope-group"><p class="eyebrow">${t["scope.label"]}</p><div class="segments" id="scope" aria-label="${t["scope.label"]}"><button data-scope="active">${t["scope.active"]}</button><button data-scope="tree">${t["scope.tree"]}</button></div><small id="scope-fixed" hidden>${t["scope.fixed"]}</small></div><section class="time-range" id="time-range" aria-label="${t["range.label"]}" hidden><div><p class="eyebrow">${t["range.label"]}</p><strong id="range-name"></strong><div class="mono" id="range-dates" aria-live="polite"></div><small>${t["range.inclusive"]}</small></div><div class="segments"><button data-days="7">7D</button><button data-days="14">14D</button><button data-days="30">30D</button><button id="custom-range" aria-haspopup="dialog">${t["range.custom"]}</button></div></section></div>
<dialog id="date-dialog" aria-labelledby="date-title"><form id="date-form"><h2 id="date-title">${t["range.custom.title"]}</h2><p class="muted">${t["range.inclusive"]}</p><label>${t["range.from"]}<input id="date-from" type="date" required aria-describedby="date-error"></label><label>${t["range.to"]}<input id="date-to" type="date" required aria-describedby="date-error"></label><p id="date-error" class="date-error" role="alert"></p><div class="actions"><button type="button" id="date-cancel">${t["range.cancel"]}</button><button type="submit" class="primary">${t["range.apply"]}</button></div></form></dialog>
<nav class="tabs" id="tabs" aria-label="Report section"></nav><div id="view"></div><div class="notice"><span aria-hidden="true">ⓘ</span><div><strong>${t["notice.sensitive"]}</strong> ${t["notice.copy"]}</div></div><footer><span>${t["footer.authority"]}</span><span class="mono">${t.offline}</span></footer><p id="announcement" class="sr-only" role="status"></p></main></div></div><noscript>This report requires JavaScript. It is self-contained and makes no network requests.</noscript><script type="application/json" id="report-data">${data}</script><script type="application/json" id="catalog-data">${JSON.stringify(t)}</script><script>\n` +
    '"use strict";\nconst data=JSON.parse(document.getElementById("report-data").textContent), t=JSON.parse(document.getElementById("catalog-data").textContent);\nconst tabs=["overview","models","tools","commands","agents","skills","integrations","errors","ledger"];\nconst state={range:data.kind,tab:"overview",scope:data.scope||"tree",query:"",sort:"default",metric:"cost",period:initialPeriod()};\nconst q=id=>document.getElementById(id), text=value=>String(value??""), money=value=>"$"+Number(value||0).toFixed(2), number=value=>new Intl.NumberFormat("en").format(Number(value||0));\nconst tr=(key, values={})=>text(t[key]).replace(/\\{(\\w+)\\}/g,(_,key)=>text(values[key]));\nfunction initialPeriod(){const dates=days().map(row=>row.date).sort(),to=dates.at(-1)||"1970-01-01",fromDate=new Date(to+"T00:00:00Z");fromDate.setUTCDate(fromDate.getUTCDate()-13);return {preset:14,from:fromDate.toISOString().slice(0,10),to}}\nfunction days(){return data.kind==="global"?data.report.dates:[]}\nfunction selectedDays(){return days().filter(row=>row.date>=state.period.from&&row.date<=state.period.to)}\nfunction current(){return data.kind==="current"?data.report:undefined}\nfunction el(name, cls, value){const node=document.createElement(name);if(cls)node.className=cls;if(value!==undefined)node.textContent=value;return node}\nfunction badge(value,tone="neutral"){return el("span","badge "+tone,value)}\nfunction card(title, subtitle){const node=el("section","card"),head=el("div","panel-head"),copy=document.createElement("div");copy.append(el("h2","",title),el("p","",subtitle));head.append(copy);node.append(head);return node}\nfunction table(title, subtitle, headers, rows){const section=card(title,subtitle),toolbar=el("div","toolbar"),searchLabel=el("label","",tr("search")),search=document.createElement("input"),sortLabel=el("label","",tr("sort")),sort=document.createElement("select");search.id="search";search.type="search";search.value=state.query;search.placeholder=tr("search.placeholder");sort.id="sort";[["default","sort.default"],["name","sort.name"],["reverse","sort.reverse"]].forEach(([value,label])=>{const option=el("option","",tr(label));option.value=value;option.selected=state.sort===value;sort.append(option)});searchLabel.append(search);sortLabel.append(sort);toolbar.append(searchLabel,sortLabel);section.append(toolbar);const wrap=el("div","table-wrap"),node=document.createElement("table"),head=document.createElement("thead"),headRow=document.createElement("tr"),body=document.createElement("tbody");headers.forEach(value=>headRow.append(el("th","",value)));head.append(headRow);let shown=rows.filter(row=>row.map(text).join(" ").toLowerCase().includes(state.query.toLowerCase()));if(state.sort==="name")shown.sort((a,b)=>text(a[0]).localeCompare(text(b[0]),"en"));if(state.sort==="reverse")shown.reverse();shown.forEach(row=>{const rowNode=document.createElement("tr");row.forEach(value=>{const cell=document.createElement("td");value instanceof Node?cell.append(value):cell.textContent=text(value);rowNode.append(cell)});body.append(rowNode)});node.append(head,body);wrap.append(node);section.append(wrap);return section}\nfunction metric(title,value,note, details){const node=el("section","card metric");node.append(el("div","muted",title),el("div","value mono",value),el("small","",note));const block=el("div","breakdown");details.forEach(([name,item])=>{const row=el("div","breakdown-row");row.append(el("span","",name),el("span","mono",item));block.append(row)});node.append(block);return node}\nfunction bars(title,subtitle,rows){const section=card(title,subtitle), body=el("div","bars");rows.forEach(([name,value,width])=>{const row=el("div","bar"),label=el("div","bar-label");label.append(el("span","mono",name),el("span","mono",value));const track=el("div","track"),fill=el("div","fill");fill.style.width=width+"%";track.append(fill);row.append(label,track);body.append(row)});section.append(body);return section}\nfunction overview(){const report=current();if(!report){const usage=data.kind==="global"?selectedDays().reduce((sum,row)=>({totalTokens:sum.totalTokens+row.usage.totalTokens,cost:sum.cost+row.usage.cost}),{totalTokens:0,cost:0}):{totalTokens:0,cost:0};return table(data.kind==="global"?tr("nav.global"):tr("nav.history"),"Shared report DTO summary",["Metric","Value"],[[tr("metric.cost"),money(usage.cost)],[tr("metric.tokens"),number(usage.totalTokens)]]);}const grid=el("div","metrics"), tokenDetails=[[tr("metric.input"),number(report.usage.totalTokens)],[tr("metric.output"),tr("evidence.unavailable")],[tr("metric.cache"),tr("evidence.unavailable")]];grid.append(metric(tr("metric.cost"),money(report.usage.cost),tr("metric.native"),[[tr("evidence.native"),money(report.usage.cost)],[tr("metric.child"),tr("evidence.unavailable")]]),metric(tr("metric.tokens"),number(report.usage.totalTokens),"Input, output & cache",tokenDetails),metric(tr("metric.generations"),number(report.generations.length),"Recorded model responses",[["Records",number(report.generations.length)]]),metric(tr("metric.tools"),number(report.tools.length),"Observed native calls",[["Records",number(report.tools.length)]]));const grid2=el("div","grid");const modelRows=report.models.map(model=>[model.model,money(model.cost),report.usage.cost?Math.round(model.cost/report.usage.cost*100):0]);const toolCounts=new Map();report.tools.forEach(tool=>toolCounts.set(tool.name,(toolCounts.get(tool.name)||0)+1));const toolRows=[...toolCounts].map(([name,count])=>[name,count+" calls",report.tools.length?Math.round(count/report.tools.length*100):0]);grid2.append(bars(tr("panel.models"),"How native spend is distributed",modelRows),bars(tr("panel.tools"),"Call count by tool",toolRows));const evidence=table(tr("panel.evidence"),"Every metric keeps its source.",[tr("table.source"),"Observation","Confidence"],[["Pi persisted records","Usage, models, tools",tr("evidence.native")],["Public agent artifact","Child breakdown only",tr("evidence.cooperative")],["Provider retries","Not observed",tr("evidence.unavailable")]]);const all=el("div","");all.append(grid,grid2,evidence);return all}\nfunction chart(){const rows=selectedDays(), section=card(tr("panel.daily"),state.period.from+" → "+state.period.to),select=document.createElement("select");select.id="chart-metric";[["sessions","chart.sessions"],["cost","chart.cost"],["tokens","chart.tokens"]].forEach(([value,label])=>{const option=el("option","",tr(label));option.value=value;option.selected=state.metric===value;select.append(option)});section.querySelector(".panel-head").append(select);const chart=el("div","chart"),svg=document.createElement("svg");svg.setAttribute("class","line-chart");svg.setAttribute("viewBox","0 0 800 180");svg.setAttribute("role","img");svg.setAttribute("aria-label",tr("chart.metric"));const maximum=Math.max(...rows.map(row=>state.metric==="sessions"?row.sessions:state.metric==="cost"?row.usage.cost:state.metric==="tokens"?row.usage.totalTokens:0),1);const points=rows.map((row,index)=>(8+(rows.length<2?392:index/(rows.length-1)*784))+","+(172-((state.metric==="sessions"?row.sessions:state.metric==="cost"?row.usage.cost:state.metric==="tokens"?row.usage.totalTokens:0)/maximum*164))).join(" ");const line=document.createElement("polyline");line.setAttribute("class","activity-line");line.setAttribute("points",points);svg.append(line);chart.append(el("div","chart-axis",number(maximum)),svg,el("div","chart-dates",rows.map(row=>row.date).join(" → ")));section.append(chart);const details=document.createElement("details"),summary=el("summary","",tr("chart.data"));details.append(summary,table("","",["Date","Sessions","Tokens","Cost (USD)"],rows.map(row=>[row.date,number(row.sessions),number(row.usage.totalTokens),money(row.usage.cost)])));section.append(details);return section}\nfunction unavailable(){const section=el("section","card empty");section.append(el("p","eyebrow",tr("evidence.unavailable")),el("h2","",tr("unavailable.title")),el("p","",tr("unavailable.copy")));return section}\nfunction detail(){const report=current();if(!report)return unavailable();if(state.tab==="models")return table(tr("tab.models"),"Native usage only.",["Provider","Model","Generations","Tokens","Cost (USD)"],report.models.map(row=>[row.provider,row.model,number(row.generations),number(row.totalTokens),money(row.cost)]));if(state.tab==="tools")return table(tr("tab.tools"),"Native call counts.",["Tool","Status","Tokens","Cost (USD)"],report.tools.map(row=>[row.name,row.status,number(row.usage.totalTokens),money(row.usage.cost)]));if(state.tab==="agents")return table(tr("panel.agents"),"Child usage is never added to native totals.",["Run","Parent","Status","Tokens","Cost (USD)"],report.agents.map(row=>[row.id,row.parentId||tr("evidence.unavailable"),row.status,row.usage?number(row.usage.totalTokens):tr("evidence.unavailable"),row.usage?money(row.usage.cost):tr("evidence.unavailable")]));if(state.tab==="integrations")return table(tr("panel.integrations"),"Evidence availability is not installation status.",["Integration","Evidence","Version"],report.integrations.map(row=>[row.integration,row.state,row.version]));if(state.tab==="ledger")return ledger(report);return unavailable()}\nfunction ledger(report){return table(tr("panel.ledger"),tr("ledger.materialized"),["Time (UTC)","ID","Category","Action","Confidence"],[...report.generations.map(row=>[row.timestamp,row.id,"Generation","Completed",tr("evidence.native")]),...report.tools.map(row=>[row.timestamp,row.id,"Tool",row.status,tr("evidence.native")]),...report.compactions.map(row=>[row.timestamp,row.id,"Compaction","Recorded",tr("evidence.native")])].sort((a,b)=>text(a[0]).localeCompare(text(b[0]))||text(a[1]).localeCompare(text(b[1]))))}\nfunction history(){return table(tr("panel.history"),tr("history.scope"),["Session","Status","Tokens","Cost (USD)"],data.report.sessions.map(row=>[row.sessionId,row.availability,row.availability==="available"?number(row.report.usage.totalTokens):tr("evidence.unavailable"),row.availability==="available"?money(row.report.usage.cost):tr("evidence.unavailable")]))}\nfunction render(){q("time-range").hidden=state.range!=="global";q("scope-fixed").hidden=state.range==="current";q("range-name").textContent=state.period.preset?tr("range.last",{days:state.period.preset}):tr("range.custom");q("range-dates").textContent=state.period.from+" → "+state.period.to;[...document.querySelectorAll("[data-days]")].forEach(node=>node.setAttribute("aria-pressed",String(Number(node.dataset.days)===state.period.preset)));const titles={current:["kicker.current","heading.current","subtitle.current"],history:["kicker.history","heading.history","subtitle.history"],global:["kicker.global","heading.global","subtitle.global"]}[state.range];q("kicker").textContent=tr(titles[0]);q("title").textContent=tr(titles[1]);q("subtitle").textContent=tr(titles[2]);q("breadcrumb").textContent=tr("nav."+state.range);q("session-label").textContent=state.range==="current"?data.report.sessionId:state.range==="history"?number(data.report.sessions.length)+" tracked sessions":number(data.report.sessions.length)+" sessions";q("scope-note").textContent=state.range==="current"?(state.scope==="active"?tr("scope.active"):tr("scope.tree"))+" after tracking marker":tr("scope.fixed");const view=q("view");view.replaceChildren();if(state.range==="history")view.append(history());else if(state.tab==="overview"){view.append(overview());if(state.range==="global")view.append(chart())}else view.append(detail())}\nconst nav=q("navigation");["current","history","global"].forEach(kind=>{const button=el("button","",tr("nav."+kind));button.dataset.range=kind;button.disabled=kind!==data.kind;nav.append(button)});const tabsNode=q("tabs");tabsNode.hidden=state.range==="history";tabs.forEach(tab=>{const button=el("button","",tr("tab."+tab));button.dataset.tab=tab;button.setAttribute("aria-pressed",String(tab===state.tab));button.addEventListener("click",()=>{state.tab=tab;[...tabsNode.children].forEach(item=>item.setAttribute("aria-pressed",String(item===button)));render()});tabsNode.append(button)});q("scope").querySelectorAll("button").forEach(button=>{button.disabled=true;button.setAttribute("aria-pressed",String(button.dataset.scope===state.scope))});document.addEventListener("input",event=>{if(event.target.id!=="search")return;state.query=event.target.value;render()});document.addEventListener("change",event=>{if(event.target.id==="sort"){state.sort=event.target.value;render()}if(event.target.id==="chart-metric"){state.metric=event.target.value;render()}});document.querySelectorAll("[data-days]").forEach(button=>button.addEventListener("click",()=>{const days=Number(button.dataset.days),date=new Date(state.period.to+"T00:00:00Z");date.setUTCDate(date.getUTCDate()-days+1);state.period={preset:days,from:date.toISOString().slice(0,10),to:state.period.to};render()}));q("custom-range").addEventListener("click",()=>{q("date-from").value=state.period.from;q("date-to").value=state.period.to;q("date-dialog").showModal()});q("date-cancel").addEventListener("click",()=>q("date-dialog").close());q("date-form").addEventListener("submit",event=>{event.preventDefault();const from=q("date-from").value,to=q("date-to").value;if(!from||!to||from>to){q("date-error").textContent=tr("range.error");return}state.period={preset:null,from,to};q("date-dialog").close();render()});q("theme").addEventListener("click",event=>{const dark=document.body.classList.toggle("theme-dark");event.currentTarget.textContent=tr(dark?"theme.light":"theme.dark")});render();\n' +
    `\n</script></body></html>`
  );
}

type SafeCurrent = {
  kind: "current";
  scope: Scope;
  report: Pick<
    SessionReport,
    | "sessionId"
    | "usage"
    | "models"
    | "tools"
    | "compactions"
    | "generations"
    | "agents"
    | "integrations"
  >;
};
type SafeHistory = {
  kind: "history";
  report: {
    availability: HistoryReport["availability"];
    sessions: Array<
      | { availability: "unavailable"; sessionId: string }
      | {
          availability: "available";
          sessionId: string;
          report: Pick<SessionReport, "usage">;
        }
    >;
  };
};
type SafeGlobal = {
  kind: "global";
  report: Pick<GlobalReport, "availability" | "usage" | "dates"> & {
    sessions: Array<{
      availability: "available" | "unavailable";
      sessionId: string;
    }>;
  };
};
function safeUsage(usage: SessionReport["usage"]): SessionReport["usage"] {
  return { totalTokens: usage.totalTokens, cost: usage.cost };
}

function projectReport(
  input: HtmlReport,
): SafeCurrent | SafeHistory | SafeGlobal {
  if (input.kind === "current") {
    return {
      kind: input.kind,
      scope: input.scope,
      report: {
        sessionId: input.report.sessionId,
        usage: safeUsage(input.report.usage),
        models: input.report.models.map((model) => ({
          provider: model.provider,
          model: model.model,
          generations: model.generations,
          totalTokens: model.totalTokens,
          cost: model.cost,
        })),
        tools: input.report.tools.map((tool) => ({
          id: tool.id,
          timestamp: tool.timestamp,
          name: tool.name,
          status: tool.status,
          usage: safeUsage(tool.usage),
        })),
        compactions: input.report.compactions.map((compaction) => ({
          id: compaction.id,
          timestamp: compaction.timestamp,
          usage: safeUsage(compaction.usage),
        })),
        generations: input.report.generations.map((generation) => ({
          id: generation.id,
          timestamp: generation.timestamp,
          provider: generation.provider,
          model: generation.model,
          usage: safeUsage(generation.usage),
        })),
        agents: input.report.agents.map((agent) => ({
          id: agent.id,
          ...(agent.parentId === undefined ? {} : { parentId: agent.parentId }),
          status: agent.status,
          confidence: agent.confidence,
          ...(agent.usage === undefined
            ? {}
            : { usage: safeUsage(agent.usage) }),
        })),
        integrations: input.report.integrations.map((integration) => ({
          integration: integration.integration,
          version: integration.version,
          state: integration.state,
          ...(integration.counters === undefined
            ? {}
            : { counters: { ...integration.counters } }),
        })),
      },
    };
  }
  if (input.kind === "history")
    return {
      kind: input.kind,
      report: {
        availability: input.report.availability,
        sessions: input.report.sessions.map((session) =>
          session.availability === "available"
            ? {
                availability: session.availability,
                sessionId: session.sessionId,
                report: { usage: session.report.usage },
              }
            : {
                availability: session.availability,
                sessionId: session.sessionId,
              },
        ),
      },
    };
  return {
    kind: input.kind,
    report: {
      availability: input.report.availability,
      usage: input.report.usage,
      dates: input.report.dates,
      sessions: input.report.sessions.map(({ availability, sessionId }) => ({
        availability,
        sessionId,
      })),
    },
  };
}

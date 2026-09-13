import { createHash } from "node:crypto";

import type { EvidenceState } from "../core/events.ts";
import type { LedgerItem } from "../core/ledger.ts";
import type { DailyRow } from "./daily.ts";
import {
  ENGLISH_CATALOG,
  errorHeadline,
  errorMessage,
  toolDuration,
  type CompositionView,
  type CoverageProjection,
  type ErrorRow,
  type EvidenceRow,
  type IntegrationRow,
  type SessionReportView,
  type ToolRow,
} from "./report-projection.ts";
import type {
  UiAgentRow,
  UiChildUsage,
  UiGlobalProjection,
  UiHistoryProjection,
  UiHistorySession,
  UiInventoryAvailability,
  UiRangeProjection,
  UiSessionProjection,
  UiToolSummaryRow,
} from "./ui-projection.ts";

/**
 * The immutable snapshot renderer (ADR 0018): it turns exactly one
 * already-resolved L2 target projection into one static, self-contained
 * document with no executable JavaScript, no network permission and no embedded
 * DTO for later computation.
 *
 * It is presentation only. Range resolution, row filtering, aggregation,
 * history membership, truncation verdicts, evidence interpretation and
 * unavailable-versus-zero all stay L2's (`ui-projection.ts`), and the report
 * transforms stay `report-projection.ts`'s. This module reads no loader, no
 * filesystem, no clock and no route: a `SnapshotDto` is all it accepts, so
 * `renderSnapshot(dto)` is byte-identical for equal DTOs. Every dynamic value
 * passes an escape function for its exact context, and nothing here derives a
 * figure the DTO does not already carry.
 */

/** The theme a snapshot was rendered with; a snapshot never switches at runtime. */
export type SnapshotTheme = "light" | "dark";

/**
 * The projection's resolved range metadata, minus `requested`: the applied range
 * intent is route state a snapshot never acts on, so the DTO cannot carry one.
 */
export type SnapshotRange = Omit<UiRangeProjection, "requested">;

/** One session-shaped target: safe report rows plus its resolved range. */
export type SnapshotSessionProjection = Omit<UiSessionProjection, "range"> & {
  range?: SnapshotRange;
};

/** One history membership row; a snapshot renders no per-session detail view. */
export type SnapshotHistoryRow = Omit<UiHistorySession, "view">;

/** The history aggregate, with the applied range input and detail views dropped. */
export type SnapshotHistoryProjection = Omit<
  UiHistoryProjection,
  "requested" | "sessions"
> & { sessions: readonly SnapshotHistoryRow[] };

/** The global aggregate with the applied range input dropped. */
export type SnapshotGlobalProjection = Omit<UiGlobalProjection, "requested">;

/**
 * One target snapshot: the theme chosen before rendering plus exactly one
 * already-resolved L2 projection. No bundle input, loader, session file, path,
 * route or raw report reaches this DTO, and the renderer reads nothing else.
 */
export type SnapshotDto =
  | {
      kind: "current";
      schemaVersion: 1;
      theme: SnapshotTheme;
      projection: SnapshotSessionProjection;
    }
  | {
      kind: "session";
      schemaVersion: 1;
      theme: SnapshotTheme;
      projection: SnapshotSessionProjection;
    }
  | {
      kind: "history";
      schemaVersion: 1;
      theme: SnapshotTheme;
      projection: SnapshotHistoryProjection;
    }
  | {
      kind: "global";
      schemaVersion: 1;
      theme: SnapshotTheme;
      projection: SnapshotGlobalProjection;
    };

/**
 * The snapshot stylesheet, byte-identical to the legacy document CSS in
 * `html.ts` and owned here only until Task 5 relocates it to the ordinary asset
 * `src/ui/web/style.css`; the renderer then imports those exact bytes and this
 * constant disappears. The CSP hash below is computed from these bytes, so the
 * relocation must preserve them exactly.
 */
export const SNAPSHOT_STYLESHEET = `

:root{color-scheme:light;--bg:#f7f7f4;--surface:#fff;--soft:#f0f0eb;--ink:#252820;--muted:#535b4f;--line:#dddfd6;--accent:#aa3e13;--tint:#fff0e6;--green:#34624b;--green-bg:#edf5ee;--warning:#825719;--mono:ui-monospace,SFMono-Regular,Consolas,monospace}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input,select{font:inherit;color:inherit}button,select{cursor:pointer}button{background:var(--surface);border:1px solid var(--line);border-radius:7px;min-height:40px;padding:8px 14px}button:hover{border-color:var(--muted);background:var(--soft)}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid var(--accent);outline-offset:3px}button[aria-pressed=true]{background:var(--tint);color:var(--accent);border-color:var(--accent)}h1,h2,h3,p{margin:0}h1{font-size:30px;font-weight:620;letter-spacing:-1px;line-height:1.25}h2{font-size:16px;font-weight:620}h3{font-size:14px}small,.muted{color:var(--muted)}small{font-size:12px}.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}.skip{position:absolute;top:-60px;left:16px;z-index:10;background:var(--surface);padding:10px}.skip:focus{top:10px}.shell{display:grid;grid-template-columns:224px minmax(0,1fr);min-height:100vh}aside{padding:28px 18px;border-right:1px solid var(--line);display:flex;flex-direction:column;background:var(--surface)}.brand{display:flex;align-items:center;gap:10px;font-size:16px;font-weight:650;line-height:1.3;padding:0 10px 32px}.mark{display:grid;place-items:center;background:var(--ink);color:var(--surface);width:34px;height:34px;border-radius:9px;font:24px Georgia,serif}.brand small{font-weight:400}.eyebrow{font:11px var(--mono);text-transform:uppercase;letter-spacing:1.4px;color:var(--muted)}aside .eyebrow{padding:0 12px;margin:20px 0 8px}.nav{display:grid;gap:4px}nav.nav a{border-color:transparent;background:transparent;display:flex;align-items:center;gap:10px;text-align:left;padding:10px 12px;min-height:44px;color:inherit;text-decoration:none}nav.nav a[aria-current=page]{background:var(--tint);color:var(--accent)}.nav svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.5}.rail-foot{margin-top:auto;padding:40px 12px 0}.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--green);margin-right:7px}.rail-foot p{margin-top:8px;font-size:12px;color:var(--muted)}.workspace{min-width:0}.topbar{padding:16px 36px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:16px;background:var(--surface)}.topbar .trail{font-size:12px;color:var(--muted)}.topbar .trail strong{color:var(--ink);font-weight:500}.preview{font:11px var(--mono);color:var(--accent);border:1px solid var(--line);border-radius:5px;padding:5px 8px;white-space:nowrap}.content{max-width:1440px;margin:auto;padding:34px 36px}.heading{display:flex;justify-content:space-between;gap:24px;align-items:center}.heading p{color:var(--muted);margin-top:9px}.actions{display:flex;gap:8px;flex-wrap:wrap}.primary{background:var(--ink);color:var(--surface);border-color:var(--ink)}.primary:hover{background:var(--muted);color:var(--surface)}.context{display:flex;justify-content:space-between;gap:16px;align-items:center;margin:26px 0 22px}.context small{display:block;margin-top:5px}.segments{display:flex;gap:4px}.segments button{padding:6px 14px;min-height:36px}.badge{font-size:11px;display:inline-block;padding:3px 8px;border-radius:5px;background:var(--green-bg);color:var(--green);white-space:nowrap}.badge.neutral{background:var(--soft);color:var(--muted)}.badge.warn{background:var(--tint);color:var(--warning)}.tabs{display:flex;flex-wrap:wrap;gap:4px;border-bottom:1px solid var(--line);margin-bottom:24px;padding-bottom:8px}nav.tabs a{border:0;background:none;color:var(--muted);padding:8px 11px;text-decoration:none}nav.tabs a[aria-current=page]{color:var(--accent);background:var(--tint)}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(196px,1fr));gap:16px}.card{border:1px solid var(--line);background:var(--surface);border-radius:10px;overflow:hidden}.metric{padding:20px}.metric .value{font-size:30px;letter-spacing:-1px;margin:12px 0 8px;line-height:1.2}.metric:first-child{border-top:3px solid var(--accent);padding-top:18px}.metric .value small{font-size:14px;letter-spacing:0}.panel-head{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:20px 22px}.panel-head p{font-size:12px;color:var(--muted);margin-top:4px}.grid{display:grid;grid-template-columns:1.6fr 1fr;gap:20px;margin-top:20px}.bars{padding:6px 22px 22px;display:grid;gap:20px}.bar-label{display:flex;justify-content:space-between;gap:12px;margin-bottom:8px;font-size:13px}.track{height:8px;background:var(--soft);border-radius:3px;overflow:hidden}.fill{height:100%;background:var(--accent);border-radius:3px}.bar:nth-child(even) .fill{background:#747f67}.footnote{border-top:1px solid var(--line);padding:12px 22px;font-size:12px;color:var(--muted)}.notice{display:flex;gap:12px;border:1px solid var(--line);background:var(--soft);padding:14px 18px;border-radius:8px;margin-top:24px;font-size:12px;color:var(--muted)}.notice strong{color:var(--ink)}.toolbar{display:flex;gap:12px;flex-wrap:wrap;align-items:end;padding:0 22px 18px}.toolbar label{display:grid;gap:5px;font-size:12px;color:var(--muted)}input,select{background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:9px 12px;min-height:40px;max-width:100%}input{width:250px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;text-align:left}th{font-size:11px;text-transform:uppercase;letter-spacing:.7px;color:var(--muted);font-weight:500;background:var(--bg)}th,td{padding:13px 22px;border-top:1px solid var(--line);vertical-align:top}td{font-size:13px}.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.wrap{white-space:normal}.id-cell{max-width:18ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--mono)}.id-cell .id-value{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.id-cell .copy-id{display:block;min-height:32px;padding:4px 10px;font-size:12px}.status-cell{white-space:nowrap}tbody tr:hover{background:var(--bg)}.empty{text-align:center;padding:56px 24px}.empty h2{margin:12px 0 8px}.empty p{max-width:440px;margin:auto;color:var(--muted)}.empty .eyebrow{color:var(--accent)}.chart{display:grid;grid-template-columns:52px minmax(0,1fr);gap:10px;padding:8px 22px 0}.chart-axis{display:flex;flex-direction:column;justify-content:space-between;text-align:right;padding:4px 0;font:12px var(--mono);color:var(--muted)}.line-chart{display:block;width:100%;height:180px;overflow:visible}.chart-grid{stroke:var(--line);stroke-width:1;vector-effect:non-scaling-stroke}.activity-line{fill:none;stroke:var(--accent);stroke-width:2.5;stroke-linejoin:round;vector-effect:non-scaling-stroke}.line-point{fill:var(--surface);stroke:var(--accent);stroke-width:2;vector-effect:non-scaling-stroke}.chart-dates{grid-column:2;display:flex;justify-content:space-between;font:12px var(--mono);color:var(--muted)}.chart-note{padding:20px 22px;font-size:12px;color:var(--muted)}.section-gap{margin-top:20px}footer{display:flex;justify-content:space-between;gap:12px;margin-top:20px;font-size:11px;color:var(--muted)}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}details{padding:12px 22px}summary{cursor:pointer;min-height:32px}.theme-dark{color-scheme:dark;--bg:#181c19;--surface:#202521;--soft:#2b312b;--ink:#eef0e8;--muted:#bdc5b8;--line:#40493e;--accent:#ffad80;--tint:#392b22;--green:#b1d4b9;--green-bg:#29372d;--warning:#edc78f}noscript{display:block;padding:24px}.content a{color:var(--accent)}@media(max-width:1100px){.shell{grid-template-columns:188px minmax(0,1fr)}.content{padding:28px 24px}.topbar{padding:16px 24px}.grid{grid-template-columns:1fr}.metrics{gap:10px}.metric{padding:16px}.metric:first-child{padding-top:14px}.metric .value{font-size:26px}.heading{align-items:flex-start}}@media(max-width:760px){.shell{display:block}aside{padding:16px;border-right:0;border-bottom:1px solid var(--line)}.brand{padding:0 0 16px}.nav{display:flex;flex-wrap:wrap}nav.nav a{flex:1}.rail-foot,aside .eyebrow{display:none}.topbar{padding:12px 16px}.content{padding:24px 16px}.heading{display:block}.actions{margin-top:18px}.context{align-items:flex-start;flex-direction:column}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.tabs a{min-height:44px}.panel-head{padding:18px 16px;flex-wrap:wrap}.toolbar{padding-left:16px;padding-right:16px}input{width:100%}.toolbar label{flex:1;min-width:120px}footer{flex-wrap:wrap}.chart{gap:8px;padding-left:16px;padding-right:16px}.notice{align-items:flex-start}.trail{overflow-wrap:anywhere}}@media(prefers-reduced-motion:no-preference){button{transition:background .15s,border-color .15s}}@media print{aside,.topbar,.actions,.tabs,.toolbar,.segments{display:none}.shell{display:block}.content{padding:0}.card{break-inside:avoid}}
[hidden]{display:none!important}.time-range{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:16px 20px;margin-bottom:22px;background:var(--surface);border:1px solid var(--line);border-radius:10px}.time-range small{display:block;margin-top:4px}.time-range .segments{flex-wrap:wrap}.time-range button{min-height:44px}dialog{background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:12px;padding:24px;width:min(440px,calc(100% - 32px))}dialog::backdrop{background:#0008}dialog form{display:grid;gap:18px}dialog label{display:grid;gap:6px}dialog input{width:100%}dialog .actions{justify-content:flex-end;margin-top:0}.date-error{color:var(--accent);font-size:13px}
.utility-actions button{background:transparent;color:var(--muted);font-size:12px;padding:6px 10px}.utility-actions button:hover{color:var(--ink);background:var(--soft)}.data-scope{display:flex;gap:24px;flex-wrap:wrap;align-items:center;border:1px solid var(--line);border-radius:10px;background:var(--surface);padding:16px 20px;margin-bottom:22px}.scope-group{display:grid;gap:8px}.scope-group .eyebrow{font-weight:600}.scope-group button{min-height:44px}button:disabled{opacity:.6;cursor:not-allowed}.data-scope .time-range{flex:1;min-width:240px;border:0;border-radius:0;padding:0;margin:0}.data-scope .time-range small{font-size:12px}.breakdown{display:grid;gap:4px;margin-top:12px;padding-top:10px;border-top:1px solid var(--line);font-size:12px;color:var(--muted)}.breakdown-row{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}.breakdown .mono{color:var(--ink)}.history-table th,.history-table td{padding:10px 12px}.history-table th:first-child,.history-table td:first-child{padding-left:20px}.history-table small{display:block}.history-table button{min-height:40px;padding:6px 10px}.history-table .badge{font-size:12px}.history-table-wrap:focus-visible{outline:3px solid var(--accent);outline-offset:-3px}@media(max-width:760px){.data-scope{padding:16px;gap:16px}.data-scope .time-range{flex-basis:100%;min-width:0;border-top:1px solid var(--line);padding-top:16px}.utility-actions{margin-top:12px}.chart{grid-template-columns:42px minmax(0,1fr);padding-left:16px;padding-right:16px}.chart-axis,.chart-dates{font-size:12px}}.range-note{flex-basis:100%;font-size:12px;color:var(--muted);margin:8px 0 0}
.entity-focus{background:var(--tint);outline:3px solid var(--accent);outline-offset:2px;border-radius:5px}

`;

/**
 * The snapshot CSP: no script, no connect, no external resource, and one hash
 * for the exact inlined stylesheet. It is deterministic because the stylesheet
 * is.
 */
const SNAPSHOT_CSP = `default-src 'none'; style-src 'sha256-${createHash(
  "sha256",
)
  .update(SNAPSHOT_STYLESHEET, "utf8")
  .digest(
    "base64",
  )}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

/** One already-resolved range's render metadata; `null` resolved means unknown. */
type RangeMetadata = {
  resolved: NonNullable<SnapshotRange["resolved"]> | null;
  truncated: boolean;
};

/** A cell is either a value (escaped by the table) or composed, escaped markup. */
type Cell = string | { readonly html: string };

/** One target's fixed document frame: the title block and its section list. */
type SnapshotTarget = {
  kicker: string;
  title: string;
  subtitle: string;
  breadcrumb: string;
  identity: string;
  scopeNote: string;
  content: string;
};

export function renderSnapshot(dto: SnapshotDto): string {
  const target =
    dto.kind === "history"
      ? historyTarget(dto.projection)
      : dto.kind === "global"
        ? globalTarget(dto.projection)
        : sessionTarget(dto.kind, dto.projection);
  return frame(dto.theme, target);
}

// ---------------------------------------------------------------------------
// Context-specific escaping
// ---------------------------------------------------------------------------

/**
 * One replacement table for both contexts. Text and attributes each escape the
 * union of the characters that matter in *either* context (`& < > " '`) plus the
 * two JavaScript line terminators, so no call site depends on remembering which
 * characters its context needs; U+2028/U+2029 become numeric references, which
 * decode back to themselves.
 */
const ENTITIES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "\u2028": "&#8232;",
  "\u2029": "&#8233;",
};

/** Escapes one dynamic value for HTML text context. */
export function escapeSnapshotText(value: string): string {
  return value.replace(/[&<>"'\u2028\u2029]/g, (character) => {
    return ENTITIES[character] ?? character;
  });
}

/** Escapes one dynamic value for a quoted HTML attribute context. */
export function escapeSnapshotAttribute(value: string): string {
  return value.replace(/[&<>"'\u2028\u2029]/g, (character) => {
    return ENTITIES[character] ?? character;
  });
}

function text(value: string): string {
  return escapeSnapshotText(value);
}

function attr(value: string): string {
  return escapeSnapshotAttribute(value);
}

function raw(html: string): Cell {
  return { html };
}

// ---------------------------------------------------------------------------
// Document frame and primitive markup
// ---------------------------------------------------------------------------

function frame(theme: SnapshotTheme, target: SnapshotTarget): string {
  const dark = theme === "dark";
  const catalog = ENGLISH_CATALOG;
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta http-equiv="Content-Security-Policy" content="${SNAPSHOT_CSP}">` +
    `<meta name="referrer" content="no-referrer">` +
    `<title>${text(catalog["report.title"])} · ${text(target.title)}</title>` +
    `<style>${SNAPSHOT_STYLESHEET}</style></head>` +
    `<body${dark ? ' class="theme-dark"' : ""}>` +
    `<a class="skip" href="#main">Skip to report</a>` +
    `<div class="shell"><aside aria-label="${attr(catalog.workspace)}"><div class="brand"><span class="mark" aria-hidden="true">π</span><span>${text(catalog["report.title"])}<br><small>${text(catalog["brand.tagline"])}</small></span></div>` +
    `<p class="eyebrow">${text(catalog.workspace)}</p>` +
    `<div class="rail-foot"><span class="dot"></span>${text(catalog["local.design"])}<p>Offline report. No tracking.<br>No prompts or outputs.</p><p class="mono">${text(catalog.offline)}</p></div></aside>` +
    `<div class="workspace"><header class="topbar"><span class="trail">Inspector / <strong>${text(target.breadcrumb)}</strong></span><span class="preview">${text(catalog["tag.local"])}</span></header>` +
    `<main id="main" class="content" tabindex="-1">` +
    `<div class="heading"><div><p class="eyebrow">${text(target.kicker)}</p><h1>${text(target.title)}</h1><p>${text(target.subtitle)}</p></div></div>` +
    `<div class="context"><div><span class="mono">${text(target.identity)}</span> <span class="badge neutral">${text(catalog["tag.snapshot"])}</span><small>${text(target.scopeNote)}</small></div></div>` +
    target.content +
    `<div class="notice"><span aria-hidden="true">ⓘ</span><div><strong>${text(catalog["notice.sensitive"])}</strong> ${text(catalog["notice.copy"])}</div></div>` +
    `<footer><span>${text(catalog["footer.authority"])}</span><span class="mono">${text(catalog.offline)} · ${text(catalog["tag.snapshot"])}</span></footer>` +
    `</main></div></div></body></html>`
  );
}

function metric(
  label: string,
  value: string,
  note: string,
  details: readonly (readonly [string, string])[] = [],
): string {
  const breakdown = details
    .map(
      ([detailLabel, detailValue]) =>
        `<div class="breakdown-row"><span>${text(detailLabel)}</span><span class="mono">${text(detailValue)}</span></div>`,
    )
    .join("");
  return (
    `<section class="card metric"><div class="muted">${text(label)}</div>` +
    `<div class="value mono">${text(value)}</div><small>${text(note)}</small>` +
    (breakdown === "" ? "" : `<div class="breakdown">${breakdown}</div>`) +
    `</section>`
  );
}

function metrics(cards: readonly string[]): string {
  return `<div class="metrics">${cards.join("")}</div>`;
}

function card(
  title: string,
  note: string,
  content: string,
  right = "",
): string {
  return (
    `<section class="card"><div class="panel-head"><div><h2>${text(title)}</h2>` +
    `<p>${text(note)}</p></div>${right}</div>${content}</section>`
  );
}

function footnote(content: string): string {
  return content === "" ? "" : `<div class="footnote">${text(content)}</div>`;
}

/** The one empty/unavailable section: a bounded label, never a fabricated row. */
function emptyCard(title: string, note: string): string {
  return (
    `<section class="card empty"><p class="eyebrow">${text(ENGLISH_CATALOG["evidence.unavailable"])}</p>` +
    `<h2>${text(title)}</h2><p>${text(note)}</p></section>`
  );
}

function elapsedTable(
  headers: readonly string[],
  rows: readonly (readonly Cell[])[],
  classes: readonly string[],
): string {
  const head = headers
    .map(
      (header, index) => `<th${className(classes[index])}>${text(header)}</th>`,
    )
    .join("");
  const body = rows
    .map(
      (row) =>
        `<tr>${row
          .map(
            (cell, index) =>
              `<td${className(classes[index])}>${cellContent(cell)}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("");
  return (
    `<div class="table-wrap"><table><thead><tr>${head}</tr></thead>` +
    `<tbody>${body}</tbody></table></div>`
  );
}

function className(value: string | undefined): string {
  return value === undefined || value === "" ? "" : ` class="${attr(value)}"`;
}

function cellContent(cell: Cell): string {
  return typeof cell === "string" ? text(cell) : cell.html;
}

function badge(label: string, tone: "neutral" | "warn" | ""): string {
  return `<span class="badge${tone === "" ? "" : ` ${attr(tone)}`}">${text(label)}</span>`;
}

// ---------------------------------------------------------------------------
// Bounded formatting
// ---------------------------------------------------------------------------

function count(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function orUnavailable(value: string | null | undefined): string {
  return value ?? ENGLISH_CATALOG["evidence.unavailable"];
}

function numberOrUnavailable(value: number | null): string {
  return value === null
    ? ENGLISH_CATALOG["evidence.unavailable"]
    : count(value);
}

function fill(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    String(values[key] ?? match),
  );
}

/** One catalog entry by a value computed at render time (a status, a label key). */
function catalogEntry(key: string): string {
  const catalog: Readonly<Record<string, string>> = ENGLISH_CATALOG;
  return catalog[key] ?? key;
}

/** The shared confidence tone rule: known sources read plain, the rest state it. */
function confidenceTone(confidence: string): "neutral" | "warn" | "" {
  if (
    confidence === "native" ||
    confidence === "live" ||
    confidence === "cooperative" ||
    confidence === "supported"
  ) {
    return "";
  }
  return confidence === "inferred" ? "warn" : "neutral";
}

function confidenceBadge(confidence: string): string {
  return badge(
    catalogEntry(`evidence.${confidence}`),
    confidenceTone(confidence),
  );
}

function rangeMetadata(range: SnapshotRange | undefined): RangeMetadata {
  return range === undefined
    ? { resolved: null, truncated: false }
    : { resolved: range.resolved, truncated: range.truncated };
}

function rangeDates(resolved: RangeMetadata["resolved"]): string {
  return resolved === null
    ? ENGLISH_CATALOG["evidence.unavailable"]
    : `${resolved.from} → ${resolved.to}`;
}

const DAILY_NOTE = fill(ENGLISH_CATALOG["chart.note"], {
  metric: ENGLISH_CATALOG["chart.tokens"],
});

// ---------------------------------------------------------------------------
// Session-shaped targets (current and one selected history session)
// ---------------------------------------------------------------------------

function sessionTarget(
  kind: "current" | "session",
  view: SnapshotSessionProjection,
): SnapshotTarget {
  const catalog = ENGLISH_CATALOG;
  const report = view.report;
  const history = kind === "session";
  const span =
    report?.span === null || report?.span === undefined
      ? ""
      : `${report.span.from} → ${report.span.to} · `;
  const active = view.scope === "active";
  const base = {
    kicker: history ? catalog["kicker.history"] : catalog["kicker.current"],
    title: history ? catalog["heading.history"] : catalog["heading.current"],
    subtitle: history
      ? catalog["subtitle.history"]
      : catalog["subtitle.current"],
    breadcrumb: history ? catalog["nav.history"] : catalog["nav.current"],
    identity:
      report === undefined ? catalog["evidence.unavailable"] : report.sessionId,
    scopeNote: history
      ? `${span}${catalog["scope.tree"]}`
      : `${active ? catalog["scope.active"] : catalog["scope.tree"]} · ${catalog[active ? "scope.active.note" : "scope.tree.note"]}`,
  };
  if (view.availability !== "available" || report === undefined) {
    return {
      ...base,
      content:
        emptyCard(
          catalog["unavailable.title"],
          history
            ? catalog["unavailable.session"]
            : catalog["unavailable.current"],
        ) + footnote(view.diagnostic ?? ""),
    };
  }
  const range = rangeMetadata(view.range);
  return {
    ...base,
    content:
      (view.walDetail === "expired" ? walNotice() : "") +
      rangePanel(range, catalog["range.truncated"]) +
      sessionSections(view, report, range),
  };
}

function walNotice(): string {
  return (
    `<div class="notice"><span aria-hidden="true">ⓘ</span><div><strong>` +
    `${text(ENGLISH_CATALOG["walDetail.expired"])}</strong> ${text(ENGLISH_CATALOG["walDetail.copy"])}</div></div>`
  );
}

/** The fixed section order of a session target (spec §5.2, design §7-§9). */
function sessionSections(
  view: SnapshotSessionProjection,
  report: SessionReportView,
  range: RangeMetadata,
): string {
  const catalog = ENGLISH_CATALOG;
  if (report.usage === undefined) {
    return (
      emptyCard(catalog["usage.title"], catalog["unavailable.usage"]) +
      evidenceSection(view.evidence)
    );
  }
  // A resolved range with no in-range observation states that instead of
  // publishing a zero; an unresolved range labels every range figure. The
  // in-range day count is the DTO's own figure, never the rendered row count.
  if (range.resolved !== null && (view.range?.totals.days ?? 0) === 0) {
    return (
      emptyCard(catalog["usage.title"], catalog["chart.empty"]) +
      evidenceSection(view.evidence)
    );
  }
  const rangeProjection = view.range;
  return [
    metrics(overviewMetrics(report, rangeProjection)),
    compositionSection(rangeProjection?.composition ?? null),
    dailySection(rangeProjection?.daily ?? []),
    modelsSection(rangeProjection),
    toolsSections(rangeProjection, report.durationEvidence),
    environmentSections(report, view.inventoryAvailability),
    agentsSections(report, rangeProjection),
    integrationsSection(report),
    errorsSection(rangeProjection?.errors ?? []),
    ledgerSection(rangeProjection?.ledger ?? []),
    evidenceSection(view.evidence),
  ].join("");
}

function overviewMetrics(
  report: SessionReportView,
  range: SnapshotRange | undefined,
): string[] {
  const catalog = ENGLISH_CATALOG;
  const totals =
    range === undefined || range.resolved === null ? null : range.totals;
  const partial = range?.truncated === true;
  const usage = report.usage;
  const costValue =
    totals === null ? catalog["evidence.unavailable"] : money(totals.cost);
  const tokensValue =
    totals === null
      ? catalog["evidence.unavailable"]
      : count(totals.totalTokens);
  const unknown = catalog["evidence.unavailable"];
  const childCount =
    report.agentCount === null ? unknown : count(report.agentCount);
  return [
    metric(
      partial ? catalog["metric.knownCost"] : catalog["metric.cost"],
      costValue,
      catalog["metric.native"],
      [
        [catalog["table.date"], rangeDates(range?.resolved ?? null)],
        [catalog["metric.child"], childCount],
      ],
    ),
    metric(
      partial ? catalog["metric.knownTokens"] : catalog["metric.tokens"],
      tokensValue,
      catalog["metric.tokens.note"],
      [
        [
          catalog["metric.input"],
          numberOrUnavailable(usage?.inputTokens ?? null),
        ],
        [
          catalog["metric.output"],
          numberOrUnavailable(usage?.outputTokens ?? null),
        ],
        [
          catalog["metric.cacheRead"],
          numberOrUnavailable(usage?.cacheReadTokens ?? null),
        ],
        [
          catalog["metric.cacheWrite"],
          numberOrUnavailable(usage?.cacheWriteTokens ?? null),
        ],
        [
          catalog["metric.cacheHit"],
          report.cacheHitPercent === null
            ? unknown
            : `${report.cacheHitPercent.toFixed(1)}%`,
        ],
        [catalog["usage.total"], tokensValue],
      ],
    ),
    metric(
      catalog["metric.compactions"],
      count(report.compactionCount),
      catalog["metric.compactions.note"],
    ),
    metric(
      catalog["metric.generations"],
      totals === null ? unknown : count(totals.generations),
      catalog["metric.generations.note"],
    ),
    metric(
      catalog["metric.tools"],
      totals === null ? unknown : count(totals.tools),
      catalog["metric.tools.note"],
    ),
    metric(
      catalog["metric.days"],
      totals === null ? unknown : count(totals.days),
      catalog["metric.days.note"],
    ),
    metric(
      catalog["metric.duration"],
      orUnavailable(report.durationLabel),
      catalog["metric.duration.note"],
      [
        [
          catalog["evidence.native"],
          report.span === null
            ? catalog["evidence.unavailable"]
            : `${report.span.from} → ${report.span.to}`,
        ],
      ],
    ),
    metric(catalog["metric.child"], childCount, catalog["metric.child.note"]),
  ];
}

function compositionSection(composition: CompositionView | null): string {
  const catalog = ENGLISH_CATALOG;
  if (composition === null || !composition.available) {
    const total = composition?.total;
    const body =
      total === undefined
        ? ""
        : elapsedTable(
            [
              catalog["table.source"],
              catalog["table.tokens"],
              catalog["table.cost"],
              catalog["table.confidence"],
            ],
            [
              [
                catalog["usage.total"],
                count(total.totalTokens),
                money(total.cost),
                raw(confidenceBadge("native")),
              ],
            ],
            ["wrap", "num", "num", "status-cell"],
          );
    return card(
      catalog["usage.title"],
      catalog["unavailable.composition"],
      body,
    );
  }
  const total = composition.total;
  const rows: Cell[][] = composition.parts.map((part) => [
    catalogEntry(`metric.usage.${part.key}`),
    count(part.totalTokens),
    money(part.cost),
    raw(confidenceBadge(part.confidence)),
  ]);
  if (total !== undefined) {
    rows.push([
      catalog["usage.total"],
      count(total.totalTokens),
      money(total.cost),
      raw(confidenceBadge("native")),
    ]);
  }
  return card(
    catalog["usage.title"],
    catalog["usage.note"],
    elapsedTable(
      [
        catalog["table.source"],
        catalog["table.tokens"],
        catalog["table.cost"],
        catalog["table.confidence"],
      ],
      rows,
      ["wrap", "num", "num", "status-cell"],
    ),
    badge(
      composition.reconciles
        ? catalog["usage.reconciled"]
        : catalog["usage.unreconciled"],
      composition.reconciles ? "" : "warn",
    ),
  );
}

function dailySection(rows: readonly DailyRow[]): string {
  const catalog = ENGLISH_CATALOG;
  if (rows.length === 0) {
    return emptyCard(catalog["panel.daily"], catalog["bars.empty"]);
  }
  return card(
    catalog["panel.daily"],
    DAILY_NOTE,
    elapsedTable(
      [
        catalog["table.date"],
        catalog["table.sessions"],
        catalog["table.tokens"],
        catalog["table.cost"],
        catalog["table.generations"],
        catalog["table.tools"],
      ],
      rows.map((row) => [
        row.date,
        count(row.sessions),
        count(row.totalTokens),
        money(row.cost),
        count(row.generations),
        count(row.tools),
      ]),
      ["status-cell", "num", "num", "num", "num", "num"],
    ),
  );
}

function modelsSection(range: SnapshotRange | undefined): string {
  const catalog = ENGLISH_CATALOG;
  const rows = range?.models ?? [];
  if (rows.length === 0) {
    return emptyCard(catalog["panel.models"], catalog["models.none"]);
  }
  return card(
    catalog["panel.models"],
    catalog["models.note"],
    elapsedTable(
      [
        catalog["table.provider"],
        catalog["table.model"],
        catalog["table.generations"],
        catalog["table.tokens"],
        catalog["table.cost"],
      ],
      rows.map((row) => [
        row.provider,
        row.model,
        count(row.generations),
        count(row.totalTokens),
        money(row.cost),
      ]),
      ["status-cell", "status-cell", "num", "num", "num"],
    ) +
      (range?.modelsTruncated === true
        ? footnote(catalog["models.truncated"])
        : ""),
  );
}

function toolsSections(
  range: SnapshotRange | undefined,
  durationEvidence: EvidenceState,
): string {
  const catalog = ENGLISH_CATALOG;
  const summary = range?.toolSummary ?? [];
  const summarySection =
    summary.length === 0
      ? emptyCard(catalog["tools.summary"], catalog["tools.none"])
      : card(
          catalog["tools.summary"],
          catalog["tools.note"],
          elapsedTable(
            [
              catalog["table.tool"],
              catalog["table.calls"],
              catalog["tools.succeeded"],
              catalog["tools.failed"],
              catalog["tools.interrupted"],
              catalog["table.tokens"],
              catalog["table.cost"],
              catalog["tools.lastUsed"],
              catalog["table.source"],
            ],
            summary.map((row) => [
              row.name,
              count(row.calls),
              count(row.succeeded),
              count(row.failed),
              count(row.interrupted),
              toolUsageCell(count(row.tokens), "metric.knownTokens", row),
              toolUsageCell(money(row.cost), "metric.knownCost", row),
              row.lastUsed,
              orUnavailable(row.source ?? null),
            ]),
            [
              "status-cell",
              "num",
              "num",
              "num",
              "num",
              "num",
              "num",
              "status-cell",
              "status-cell",
            ],
          ),
        );
  const calls = range?.toolCalls ?? [];
  const callsSection =
    calls.length === 0
      ? emptyCard(catalog["tools.calls"], catalog["bars.empty"])
      : card(
          catalog["tools.calls"],
          catalog["tools.note"],
          elapsedTable(
            [
              catalog["table.timestamp"],
              catalog["table.tool"],
              catalog["table.source"],
              catalog["table.status"],
              catalog["table.tokens"],
              catalog["table.cost"],
              catalog["table.duration"],
            ],
            calls.map((row) => [
              timestampCell(row.timestamp),
              row.name,
              orUnavailable(row.source ?? null),
              raw(
                badge(
                  catalogEntry(`tools.${row.status}`),
                  row.status === "succeeded" ? "" : "warn",
                ),
              ),
              row.usage === null
                ? catalog["evidence.unavailable"]
                : count(row.usage.totalTokens),
              row.usage === null
                ? catalog["evidence.unavailable"]
                : money(row.usage.cost),
              durationCell(row, durationEvidence),
            ]),
            [
              "status-cell",
              "status-cell",
              "status-cell",
              "status-cell",
              "num",
              "num",
              "status-cell",
            ],
          ),
        );
  return summarySection + callsSection;
}

/**
 * Known usage only: a row whose calls reported no usage states Unavailable, and
 * a row L2 marks partial keeps its Known qualifier with the fraction over its
 * own calls.
 */
function toolUsageCell(
  value: string,
  labelKey: "metric.knownTokens" | "metric.knownCost",
  row: UiToolSummaryRow,
): Cell {
  if (row.withUsage === 0) return ENGLISH_CATALOG["evidence.unavailable"];
  if (row.partial) {
    return raw(
      `${text(value)} ${badge(ENGLISH_CATALOG[labelKey], "warn")}` +
        `<small>${text(fill(ENGLISH_CATALOG["tools.usageFraction"], { withUsage: row.withUsage, total: row.calls }))}</small>`,
    );
  }
  return value;
}

/** Duration is live-correlated evidence only, never estimated from a timestamp. */
function durationCell(row: ToolRow, durationEvidence: EvidenceState): string {
  const label = toolDuration(row, durationEvidence);
  return label === null
    ? ENGLISH_CATALOG["evidence.unavailable"]
    : `${label} · ${ENGLISH_CATALOG["evidence.live"]}`;
}

function timestampCell(timestamp: string): Cell {
  return raw(`<time datetime="${attr(timestamp)}">${text(timestamp)}</time>`);
}

function environmentSections(
  report: SessionReportView,
  inventoryAvailability: UiInventoryAvailability,
): string {
  const catalog = ENGLISH_CATALOG;
  const commands = report.commands;
  const skills = report.skills;
  const resources = report.resources;
  const observed =
    skills.invocationState === "supported" && skills.invocationCount !== null
      ? fill(catalog["env.invocationsObserved"], {
          count: count(skills.invocationCount),
        })
      : catalog["env.invocationsUnavailable"];
  const summary = card(
    catalog["tab.environment"],
    catalog["env.note"],
    metrics([
      metric(
        catalog["env.commands"],
        numberOrUnavailable(inventoryAvailability.commands),
        // Commands carry no counter evidence, so their observed side is
        // Unavailable: inventory availability is never activity.
        fill(catalog["env.observed"], {
          value: catalog["evidence.unavailable"],
        }),
      ),
      metric(
        catalog["env.skills"],
        numberOrUnavailable(inventoryAvailability.skills),
        observed,
      ),
      metric(
        catalog["env.resources"],
        numberOrUnavailable(inventoryAvailability.resources),
        catalog["resources.note"],
      ),
    ]),
  );
  const commandRows =
    commands.items.length === 0
      ? emptyCard(
          catalog["env.commands"],
          commands.count === null
            ? catalog["unavailable.commands"]
            : fill(catalog["commands.count"], { count: count(commands.count) }),
        )
      : card(
          catalog["env.commands"],
          catalog["commands.note"],
          elapsedTable(
            [
              catalog["table.name"],
              catalog["table.source"],
              catalog["table.scope"],
              catalog["table.origin"],
              catalog["table.description"],
            ],
            commands.items.map((row) => [
              row.name,
              orUnavailable(
                row.sourceLabel === "" ? row.source : row.sourceLabel,
              ),
              row.scope,
              row.origin,
              orUnavailable(row.description ?? null),
            ]),
            [
              "status-cell",
              "status-cell",
              "status-cell",
              "status-cell",
              "wrap",
            ],
          ),
        );
  const skillRows =
    skills.items.length === 0
      ? emptyCard(catalog["env.skills"], catalog["skills.empty"])
      : card(
          catalog["env.skills"],
          catalog["skills.note"],
          elapsedTable(
            [
              catalog["table.name"],
              catalog["table.source"],
              catalog["table.scope"],
              catalog["table.origin"],
              catalog["table.invocations"],
            ],
            skills.items.map((row) => [
              row.name,
              orUnavailable(row.sourceLabel ?? null),
              orUnavailable(row.scope ?? null),
              orUnavailable(row.origin ?? null),
              row.explicitInvocations === undefined
                ? catalog["evidence.unavailable"]
                : count(row.explicitInvocations),
            ]),
            ["status-cell", "status-cell", "status-cell", "status-cell", "num"],
          ) +
            footnote(
              skills.otherInvocations === null ||
                skills.otherInvocations === undefined ||
                skills.otherInvocations <= 0
                ? ""
                : fill(catalog["skills.otherInvocations"], {
                    count: count(skills.otherInvocations),
                  }),
            ),
        );
  const resourceRows =
    resources.state !== "supported" || resources.items.length === 0
      ? emptyCard(catalog["panel.resources"], catalog["resources.unavailable"])
      : card(
          catalog["panel.resources"],
          catalog["resources.note"],
          elapsedTable(
            [
              catalog["table.source"],
              catalog["table.scope"],
              catalog["table.origin"],
              catalog["table.commands"],
              catalog["table.skills"],
              catalog["table.prompts"],
              catalog["table.tools"],
            ],
            resources.items.map((row) => [
              row.sourceLabel,
              row.scope,
              row.origin,
              count(row.commands),
              count(row.skills),
              count(row.prompts),
              count(row.tools),
            ]),
            [
              "status-cell",
              "status-cell",
              "status-cell",
              "num",
              "num",
              "num",
              "num",
            ],
          ),
        );
  return summary + commandRows + skillRows + resourceRows;
}

function agentsSections(
  report: SessionReportView,
  range: SnapshotRange | undefined,
): string {
  const catalog = ENGLISH_CATALOG;
  const runs = range?.agents ?? [];
  const childUsage = range?.childUsage;
  const childSection =
    report.agentEvidence !== "supported"
      ? emptyCard(catalog["tab.agents"], catalog["agents.none"])
      : childUsage === undefined || childUsage.runsTotal === 0
        ? emptyCard(catalog["tab.agents"], catalog["bars.empty"])
        : card(
            catalog["tab.agents"],
            catalog["agents.note"],
            childUsageSummary(childUsage) +
              elapsedTable(
                [
                  catalog["table.role"],
                  catalog["table.status"],
                  catalog["table.model"],
                  catalog["table.tokens"],
                  catalog["table.cost"],
                  catalog["table.artifacts"],
                  catalog["table.parent"],
                ],
                runs.map((run) => [
                  orUnavailable(run.agent),
                  raw(
                    badge(
                      catalogEntry(`agents.${run.status}`),
                      run.status === "failed" || run.status === "interrupted"
                        ? "warn"
                        : "neutral",
                    ),
                  ),
                  orUnavailable(run.model),
                  run.usage === null
                    ? catalog["evidence.unavailable"]
                    : count(run.usage.totalTokens),
                  run.usage === null
                    ? catalog["evidence.unavailable"]
                    : money(run.usage.cost),
                  orUnavailable(run.artifacts),
                  parentLabel(run, runs),
                ]),
                [
                  "status-cell",
                  "status-cell",
                  "status-cell",
                  "num",
                  "num",
                  "status-cell",
                  "status-cell",
                ],
              ),
          );
  const activity = report.agentActivity;
  const activitySection =
    activity.state === "supported"
      ? card(
          catalog["panel.agentActivity"],
          catalog["agents.activity.note"],
          metrics([
            metric(
              catalog["table.calls"],
              count(activity.calls),
              catalog["metric.tools.note"],
              [
                [catalog["agents.succeeded"], count(activity.succeeded)],
                [catalog["agents.failed"], count(activity.failed)],
                [catalog["agents.interrupted"], count(activity.interrupted)],
              ],
            ),
          ]) +
            (activity.tools.length === 0
              ? ""
              : elapsedTable(
                  [catalog["table.tool"], catalog["table.calls"]],
                  activity.tools.map((row) => [row.name, count(row.calls)]),
                  ["status-cell", "num"],
                )),
        )
      : "";
  return childSection + activitySection;
}

/**
 * The child-run summary: every figure is L2's published breakdown over the
 * selected runs, so no renderer sums them and child usage stays a breakdown.
 */
function childUsageSummary(childUsage: UiChildUsage): string {
  const catalog = ENGLISH_CATALOG;
  const fraction = fill(catalog["agents.usageFraction"], {
    withUsage: childUsage.runsWithUsage,
    total: childUsage.runsTotal,
  });
  const cards = [
    metric(
      catalog["agents.childRuns"],
      count(childUsage.runsTotal),
      catalog["metric.child.note"],
    ),
    ...(
      ["succeeded", "failed", "interrupted", "running", "unknown"] as const
    ).flatMap((status) => {
      const total = childUsage.byStatus[status];
      return total === 0
        ? []
        : [
            metric(
              catalogEntry(`agents.${status}`),
              count(total),
              catalog["metric.child.note"],
            ),
          ];
    }),
    metric(
      catalog["agents.knownTokens"],
      childUsage.totalTokens === null
        ? catalog["evidence.unavailable"]
        : count(childUsage.totalTokens),
      fraction,
    ),
    metric(
      catalog["agents.knownCost"],
      childUsage.cost === null
        ? catalog["evidence.unavailable"]
        : money(childUsage.cost),
      fraction,
    ),
  ];
  if (childUsage.failedCost !== null) {
    cards.push(
      metric(
        catalog["agents.knownFailedCost"],
        money(childUsage.failedCost),
        fill(catalog["agents.usageFraction"], {
          withUsage: childUsage.failedRunsWithUsage,
          total: childUsage.byStatus.failed,
        }),
      ),
    );
  }
  return metrics(cards);
}

/**
 * The row's parent cell: the wording is chosen for L2's published verdict, and
 * an in-range parent is printed with its own rendered role label. The verdict is
 * never re-derived from the rows here.
 */
function parentLabel(run: UiAgentRow, runs: readonly UiAgentRow[]): string {
  if (run.parent === "none") return ENGLISH_CATALOG["evidence.unavailable"];
  if (run.parent === "outside-range") {
    return ENGLISH_CATALOG["agents.parentOutsideScope"];
  }
  if (run.parent === "unknown") {
    return ENGLISH_CATALOG["agents.parentUnknown"];
  }
  const parent = runs.find((candidate) => candidate.id === run.parentId);
  return orUnavailable(parent?.agent ?? null);
}

function integrationsSection(report: SessionReportView): string {
  const catalog = ENGLISH_CATALOG;
  const rows = report.integrations;
  if (rows.length === 0) {
    return emptyCard(
      catalog["panel.integrations"],
      catalog["unavailable.integrations"],
    );
  }
  return card(
    catalog["panel.integrations"],
    catalog["integrations.note"],
    elapsedTable(
      [
        catalog["table.integration"],
        catalog["integration.detected"],
        catalog["integration.telemetry"],
        catalog["integration.activity"],
        catalog["integration.version"],
      ],
      rows.map((row) => [
        row.integration,
        raw(
          badge(
            catalogEntry(`presence.${row.presence}`),
            row.presence === "absent" ? "warn" : "neutral",
          ),
        ),
        integrationTelemetry(row),
        row.counters.length === 0
          ? catalog["evidence.unavailable"]
          : `${catalog["integration.sessionTotal"]} · ${row.counters.join(" · ")}`,
        row.version === null
          ? catalog["evidence.unavailable"]
          : String(row.version),
      ]),
      ["status-cell", "status-cell", "wrap", "wrap", "status-cell"],
    ),
  );
}

/** Telemetry is this row's evidence verdict plus its closed-vocabulary reason. */
function integrationTelemetry(row: IntegrationRow): Cell {
  const catalog = ENGLISH_CATALOG;
  const reason =
    row.state === "unsupported"
      ? catalog["integration.reasonUnsupported"]
      : row.state === "unavailable"
        ? catalog["integration.reasonMissing"]
        : null;
  return raw(
    confidenceBadge(row.state) +
      (reason === null ? "" : `<small>${text(reason)}</small>`) +
      (row.presence === "absent"
        ? `<small>${text(catalog["integration.noteNotDetected"])}</small>`
        : ""),
  );
}

function errorsSection(errors: readonly ErrorRow[]): string {
  const catalog = ENGLISH_CATALOG;
  if (errors.length === 0) {
    return emptyCard(catalog["tab.errors"], catalog["errors.none"]);
  }
  return card(
    catalog["tab.errors"],
    catalog["errors.note"],
    elapsedTable(
      [
        catalog["table.error"],
        catalog["table.kind"],
        catalog["table.timestamp"],
        catalog["table.message"],
        catalog["errors.relatedChildren"],
        catalog["table.confidence"],
      ],
      errors.map((row) => [
        errorHeadlineText(row),
        row.kind,
        timestampCell(row.timestamp),
        errorMessageText(row),
        row.relatedChildIds.length === 0
          ? catalog["evidence.unavailable"]
          : `${count(row.relatedChildIds.length)} · ${row.relatedChildIds.join(" · ")}`,
        raw(confidenceBadge(row.confidence)),
      ]),
      ["wrap", "status-cell", "status-cell", "wrap", "wrap", "status-cell"],
    ),
  );
}

/** The row's headline is `report-projection`'s rule, filled here. */
function errorHeadlineText(row: ErrorRow): string {
  const headline = errorHeadline(row);
  return fill(ENGLISH_CATALOG[headline.key], headline.values ?? {});
}

function errorMessageText(row: ErrorRow): string {
  return orUnavailable(errorMessage(row));
}

function ledgerSection(ledger: readonly LedgerItem[]): string {
  const catalog = ENGLISH_CATALOG;
  if (ledger.length === 0) {
    return emptyCard(catalog["tab.ledger"], catalog["empty.ledger"]);
  }
  return card(
    catalog["tab.ledger"],
    catalog["ledger.materialized"],
    elapsedTable(
      [
        catalog["table.timestamp"],
        catalog["table.id"],
        catalog["table.category"],
        catalog["table.action"],
        catalog["table.confidence"],
      ],
      ledger.map((item) => [
        timestampCell(item.timestamp),
        item.id,
        item.kind,
        item.status,
        raw(confidenceBadge(item.confidence)),
      ]),
      ["status-cell", "id-cell", "status-cell", "status-cell", "status-cell"],
    ),
  );
}

function evidenceSection(evidence: readonly EvidenceRow[]): string {
  const catalog = ENGLISH_CATALOG;
  if (evidence.length === 0) {
    return emptyCard(catalog["panel.evidence"], catalog["evidence.note"]);
  }
  return card(
    catalog["panel.evidence"],
    catalog["evidence.note"],
    elapsedTable(
      [
        catalog["table.source"],
        catalog["table.observation"],
        catalog["table.confidence"],
      ],
      evidence.map((row) => [
        row.source,
        row.observation,
        raw(confidenceBadge(row.confidence)),
      ]),
      ["status-cell", "wrap", "status-cell"],
    ),
    badge(catalog["evidence.source"], "neutral"),
  );
}

// ---------------------------------------------------------------------------
// History and global aggregates
// ---------------------------------------------------------------------------

function historyTarget(projection: SnapshotHistoryProjection): SnapshotTarget {
  const catalog = ENGLISH_CATALOG;
  const base = {
    kicker: catalog["kicker.history"],
    title: catalog["heading.history"],
    subtitle: catalog["subtitle.history"],
    breadcrumb: catalog["nav.history"],
    identity: `${count(projection.sessions.length)} · ${catalog["metric.sessions"]}`,
    scopeNote: catalog["scope.fixed"],
  };
  if (projection.availability !== "available") {
    return {
      ...base,
      identity: catalog["evidence.unavailable"],
      content: emptyCard(
        catalog["unavailable.title"],
        catalog["unavailable.copy"],
      ),
    };
  }
  const range: RangeMetadata = {
    resolved: projection.resolved,
    truncated: projection.truncated,
  };
  const labels = projection.usageLabels;
  const datable = projection.totals.days > 0;
  const overview =
    projection.resolved !== null && projection.totals.days === 0
      ? emptyCard(catalog["usage.title"], catalog["chart.empty"])
      : metrics(
          aggregateMetrics({
            totals: projection.totals,
            labels,
            partial: projection.truncated,
            datable,
          }),
        );
  return {
    ...base,
    content:
      rangePanel(range, catalog["history.dailyTruncated"]) +
      overview +
      coverageSection(projection.coverage, catalogEntry(labels.sessions)) +
      dailySection(projection.daily) +
      historySessionsSection(projection.sessions) +
      evidenceSection(projection.evidence),
  };
}

/**
 * An aggregate's usage ladder (legacy parity): value availability and coverage
 * availability are independent, a partial aggregate states Known instead of an
 * exact label, and an aggregate with no datable row states Unavailable rather
 * than a fabricated zero.
 */
function aggregateMetrics(input: {
  totals: {
    totalTokens: number;
    cost: number;
    /** Absent for an aggregate that carries no generation figure at all. */
    generations?: number;
  };
  labels: { cost: string; tokens: string; usageUnavailable: boolean };
  partial: boolean;
  datable: boolean;
}): string[] {
  const catalog = ENGLISH_CATALOG;
  const { totals, labels, partial, datable } = input;
  const unknown = catalog["evidence.unavailable"];
  const costLabel =
    partial && labels.cost === "metric.cost" ? "metric.knownCost" : labels.cost;
  const tokensLabel =
    partial && labels.tokens === "metric.tokens"
      ? "metric.knownTokens"
      : labels.tokens;
  const costValue = labels.usageUnavailable
    ? catalog["metric.costUnavailable"]
    : datable
      ? money(totals.cost)
      : unknown;
  const tokensValue = labels.usageUnavailable
    ? catalog["metric.costUnavailable"]
    : datable
      ? count(totals.totalTokens)
      : unknown;
  return [
    metric(catalogEntry(costLabel), costValue, catalog["metric.native"]),
    metric(
      catalogEntry(tokensLabel),
      tokensValue,
      catalog["metric.tokens.note"],
    ),
    metric(
      catalog["metric.generations"],
      datable && totals.generations !== undefined
        ? count(totals.generations)
        : unknown,
      catalog["metric.generations.note"],
    ),
  ];
}

function globalTarget(projection: SnapshotGlobalProjection): SnapshotTarget {
  const catalog = ENGLISH_CATALOG;
  const base = {
    kicker: catalog["kicker.global"],
    title: catalog["heading.global"],
    subtitle: catalog["subtitle.global"],
    breadcrumb: catalog["nav.global"],
    identity: `${count(projection.trackedSessions)} · ${catalog["metric.sessions"]}`,
    scopeNote: catalog["scope.fixed"],
  };
  if (projection.availability !== "available") {
    return {
      ...base,
      identity: catalog["evidence.unavailable"],
      content: emptyCard(
        catalog["unavailable.title"],
        catalog["unavailable.copy"],
      ),
    };
  }
  const range: RangeMetadata = {
    resolved: projection.resolved,
    truncated: projection.truncated,
  };
  const labels = projection.usageLabels;
  const datable = projection.totals.days > 0;
  const overview =
    projection.resolved !== null && projection.totals.days === 0
      ? emptyCard(catalog["usage.title"], catalog["chart.empty"])
      : metrics([
          ...aggregateMetrics({
            totals: projection.totals,
            labels,
            partial: projection.truncated,
            datable,
          }),
          metric(
            catalog["metric.days"],
            datable
              ? count(projection.totals.days)
              : catalog["evidence.unavailable"],
            catalog["metric.days.note"],
          ),
          metric(
            catalog["metric.sessions"],
            count(projection.trackedSessions),
            catalog["metric.sessions.global.note"],
            [
              [
                catalog["evidence.unavailable"],
                count(projection.unavailableSessions),
              ],
            ],
          ),
        ]);
  return {
    ...base,
    content:
      rangePanel(range, catalog["range.truncated"]) +
      overview +
      coverageSection(projection.coverage, catalogEntry(labels.sessions)) +
      compositionSection(projection.composition) +
      globalDailySection(projection.daily) +
      inventorySection(projection) +
      evidenceSection(projection.evidence),
  };
}

function globalDailySection(rows: UiGlobalProjection["daily"]): string {
  const catalog = ENGLISH_CATALOG;
  if (rows.length === 0) {
    return emptyCard(catalog["panel.daily"], catalog["bars.empty"]);
  }
  return card(
    catalog["panel.daily"],
    DAILY_NOTE,
    elapsedTable(
      [
        catalog["table.date"],
        catalog["table.sessions"],
        catalog["table.tokens"],
        catalog["table.cost"],
      ],
      rows.map((row) => [
        row.date,
        count(row.sessions),
        count(row.totalTokens),
        money(row.cost),
      ]),
      ["status-cell", "num", "num", "num"],
    ),
  );
}

function inventorySection(projection: SnapshotGlobalProjection): string {
  const catalog = ENGLISH_CATALOG;
  const lines: readonly (readonly [string, number | null])[] = [
    [catalog["env.commands"], projection.inventory.commands],
    [catalog["env.skills"], projection.inventory.skills],
    [catalog["env.resources"], projection.inventory.resources],
  ];
  return card(
    catalog["tab.environment"],
    catalog["env.note"],
    elapsedTable(
      [catalog["table.source"], catalog["table.commands"]],
      lines.map(([label, value]) => [
        label,
        value === null ? catalog["evidence.unavailable"] : count(value),
      ]),
      ["status-cell", "num"],
    ),
  );
}

function coverageSection(
  coverage: CoverageProjection | null,
  fallbackLine: string,
): string {
  const catalog = ENGLISH_CATALOG;
  const reason =
    coverage === null || coverage.reasons === ""
      ? ""
      : footnote(
          fill(catalog["coverage.reasons"], { reasons: coverage.reasons }),
        );
  return card(
    catalog["coverage.title"],
    coverage === null ? fallbackLine : coverage.line,
    reason,
  );
}

/**
 * The membership table (legacy parity): the members in the aggregate's fixed
 * order, then one caption and the rows whose dates cannot be attributed at all.
 * A member publishes the verdict's own sum only when its report carried a usage
 * summary; a partial member keeps the Known qualifier.
 */
function historySessionsSection(rows: readonly SnapshotHistoryRow[]): string {
  const catalog = ENGLISH_CATALOG;
  const members = rows.filter((row) => row.membership === "member");
  const unknown = rows.filter((row) => row.membership === "unknown");
  if (members.length === 0 && unknown.length === 0) {
    return emptyCard(
      catalog["panel.history"],
      catalog["history.sessions.note"],
    );
  }
  const body: Cell[][] = members.map((row) => historyRow(row, "member"));
  if (unknown.length > 0) {
    body.push([
      raw(`<strong>${text(catalog["history.groupUnknown"])}</strong>`),
    ]);
    for (const row of unknown) body.push(historyRow(row, "unknown"));
  }
  return card(
    catalog["panel.history"],
    catalog["history.sessions.note"],
    elapsedTable(
      [
        catalog["table.session"],
        catalog["table.duration"],
        catalog["table.tokens"],
        catalog["table.generations"],
        catalog["table.agents"],
        catalog["table.status"],
        catalog["table.cost"],
      ],
      body,
      ["id-cell", "status-cell", "num", "num", "num", "status-cell", "num"],
    ) +
      footnote(
        `${catalog["table.duration"]}, ${catalog["table.generations"]}, ${catalog["table.agents"]}`,
      ),
  );
}

function historyRow(
  row: SnapshotHistoryRow,
  group: "member" | "unknown",
): Cell[] {
  const catalog = ENGLISH_CATALOG;
  const published = group === "member" && row.published;
  const unknown = catalog["evidence.unavailable"];
  const span =
    row.firstDate === null
      ? unknown
      : `${row.firstDate}${
          row.lastDate !== null && row.lastDate !== row.firstDate
            ? ` → ${row.lastDate}`
            : ""
        }`;
  return [
    raw(
      `<span class="mono">${text(row.sessionId)}</span>` +
        `<small class="wrap">${text(span)}</small>`,
    ),
    orUnavailable(row.durationLabel),
    published
      ? knownCell(
          numberOrUnavailable(row.totalTokens),
          row.partial,
          "metric.knownTokens",
        )
      : unknown,
    numberOrUnavailable(row.generationCount),
    numberOrUnavailable(row.agentCount),
    row.status === null
      ? unknown
      : raw(badge(catalog[row.status.key], row.status.tone)),
    published
      ? knownCell(
          row.cost === null ? unknown : money(row.cost),
          row.partial,
          "metric.knownCost",
        )
      : unknown,
  ];
}

function knownCell(
  value: string,
  partial: boolean,
  labelKey: "metric.knownTokens" | "metric.knownCost",
): Cell {
  return partial
    ? raw(`${text(value)} ${badge(ENGLISH_CATALOG[labelKey], "warn")}`)
    : value;
}

/** One target's resolved range and its partial or truncated verdict. */
function rangePanel(range: RangeMetadata, partialLabel: string): string {
  const catalog = ENGLISH_CATALOG;
  const resolved = range.resolved;
  const name =
    resolved === null
      ? catalog["evidence.unavailable"]
      : resolved.preset === null
        ? catalog["range.custom"]
        : fill(catalog["range.last"], { days: resolved.preset });
  return (
    `<section class="time-range" aria-label="${attr(catalog["range.label"])}"><div>` +
    `<p class="eyebrow">${text(catalog["range.label"])}</p><strong>${text(name)}</strong>` +
    `<div class="mono">${text(rangeDates(resolved))}</div>` +
    `<small>${text(catalog["range.inclusive"])}</small></div>` +
    (range.truncated ? `<p class="range-note">${text(partialLabel)}</p>` : "") +
    `</section>`
  );
}

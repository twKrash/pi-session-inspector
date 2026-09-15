import { createHash } from "node:crypto";

import { WEB_ASSETS } from "./web-assets.ts";

import type { EvidenceState } from "../core/events.ts";
import type { LedgerItem } from "../core/ledger.ts";
import type { DailyRow } from "./daily.ts";
import { createTranslator } from "./i18n.ts";
import { ENGLISH_CATALOG } from "./i18n/catalog.ts";
import {
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

const t = createTranslator();

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
 * The snapshot's one stylesheet: the ordinary browser asset the server
 * serves (`src/ui/web/style.css`), read by the known-asset loader. The
 * snapshot inlines exactly those bytes and derives its CSP hash from them,
 * so the served stylesheet and the archived one cannot drift apart.
 */
export const SNAPSHOT_STYLESHEET = WEB_ASSETS.style;

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
    `<section class="card empty"><p class="eyebrow">${text(t("evidence.unavailable"))}</p>` +
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
  return value ?? t("evidence.unavailable");
}

function numberOrUnavailable(value: number | null): string {
  return value === null ? t("evidence.unavailable") : count(value);
}

/** One catalog entry by a value computed at render time (a status, a label key). */
function catalogEntry(key: string): string {
  return t(key as Parameters<typeof t>[0]);
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
    ? t("evidence.unavailable")
    : `${resolved.from} → ${resolved.to}`;
}

const DAILY_NOTE = t("chart.note", {
  metric: t("chart.tokens"),
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
    `${text(t("walDetail.expired"))}</strong> ${text(t("walDetail.copy"))}</div></div>`
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
              catalog["table.duration"],
              catalog["table.average"],
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
              // The grouped duration carries its own coverage, exactly as the
              // interactive table renders it: an incomplete figure never reads
              // as complete, and an uncorrelated name is Unavailable.
              toolDurationCell(row.durationLabel, row, true),
              toolDurationCell(row.averageLabel, row, false),
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
  if (row.withUsage === 0) return t("evidence.unavailable");
  if (row.partial) {
    return raw(
      `${text(value)} ${badge(t(labelKey), "warn")}` +
        `<small>${text(t("tools.usageFraction", { withUsage: row.withUsage, total: row.calls }))}</small>`,
    );
  }
  return value;
}

/**
 * One grouped duration figure: Unavailable when nothing correlated, and the
 * coverage note on the total when only some calls did. The mean repeats no
 * coverage note — the total already states it.
 */
function toolDurationCell(
  label: string | null,
  row: UiToolSummaryRow,
  withCoverage: boolean,
): Cell {
  if (row.withDuration === 0 || label === null) {
    return t("evidence.unavailable");
  }
  if (!withCoverage || !row.durationPartial) return label;
  return raw(
    `${text(label)} ${badge(t("metric.correlated"), "warn")}` +
      `<small>${text(t("tools.durationFraction", { withDuration: row.withDuration, total: row.calls }))}</small>`,
  );
}

/** Duration is live-correlated evidence only, never estimated from a timestamp. */
function durationCell(row: ToolRow, durationEvidence: EvidenceState): string {
  const label = toolDuration(row, durationEvidence);
  return label === null
    ? t("evidence.unavailable")
    : `${label} · ${t("evidence.live")}`;
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
      ? t("env.invocationsObserved", {
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
        t("env.observed", {
          value: t("evidence.unavailable"),
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
            : t("commands.count", { count: count(commands.count) }),
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
                : t("skills.otherInvocations", {
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
              catalog["table.sourceTools"],
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
  const fraction = t("agents.usageFraction", {
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
        t("agents.usageFraction", {
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
  if (run.parent === "none") return t("agents.parentNone");
  if (run.parent === "outside-range") {
    return t("agents.parentOutsideScope");
  }
  if (run.parent === "orchestration-run") {
    return t("agents.parentOrchestrationRun");
  }
  if (run.parent === "unknown") {
    return t("agents.parentUnknown");
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

/** The row's headline is `report-projection`'s rule, translated here. */
function errorHeadlineText(row: ErrorRow): string {
  const headline = errorHeadline(row);
  return t(headline.key, headline.values ?? undefined);
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
      : footnote(t("coverage.reasons", { reasons: coverage.reasons }));
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
      : raw(
          badge(t(row.status.key as Parameters<typeof t>[0]), row.status.tone),
        ),
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
  return partial ? raw(`${text(value)} ${badge(t(labelKey), "warn")}`) : value;
}

/** One target's resolved range and its partial or truncated verdict. */
function rangePanel(range: RangeMetadata, partialLabel: string): string {
  const catalog = ENGLISH_CATALOG;
  const resolved = range.resolved;
  const name =
    resolved === null
      ? t("evidence.unavailable")
      : resolved.preset === null
        ? catalog["range.custom"]
        : t("range.last", { days: resolved.preset });
  return (
    `<section class="time-range" aria-label="${attr(catalog["range.label"])}"><div>` +
    `<p class="eyebrow">${text(catalog["range.label"])}</p><strong>${text(name)}</strong>` +
    `<div class="mono">${text(rangeDates(resolved))}</div>` +
    `<small>${text(catalog["range.inclusive"])}</small></div>` +
    (range.truncated ? `<p class="range-note">${text(partialLabel)}</p>` : "") +
    `</section>`
  );
}

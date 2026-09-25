import { createHash } from "node:crypto";
import type { EvidenceState } from "../core/events.ts";
import type { UsageEconomics } from "../core/reports.ts";
import type { LedgerItem } from "../core/ledger.ts";
import {
  buildAgentForest,
  filterAgentForest,
  type UiAgentTreeFilteredEntry,
  type UiAgentTreeFilteredRun,
} from "./agent-tree.ts";
import type { DailyRow } from "./daily.ts";
import { OPTIONAL_USAGE_FIELDS } from "./dated-usage.ts";
import { formatCost } from "./format.ts";
import { ENGLISH_CATALOG } from "./i18n/catalog.ts";
import { createTranslator } from "./i18n.ts";
import {
  type CompositionView,
  type CoverageProjection,
  type ErrorRow,
  type EvidenceRow,
  errorHeadline,
  errorMessage,
  type IntegrationRow,
  type SessionReportView,
  type ToolRow,
  toolDuration,
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
import { WEB_ASSETS } from "./web-assets.ts";

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

function sectionLink(section: "tools" | "skills", label: string): Cell {
  return raw(`<a href="#${attr(section)}">${text(label)}</a>`);
}

function sectionTarget(section: "tools" | "skills", content: string): string {
  return `<div id="${attr(section)}">${content}</div>`;
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
    `<div class="snapshot-stack">${target.content}</div>` +
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
  className = "card",
): string {
  return (
    `<section class="${className}"><div class="panel-head"><div><h2>${text(title)}</h2>` +
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

/**
 * The one cost rule, shared with the browser bundle: a known non-zero cost is
 * never printed as `$0.00`, and a value below the smallest shown precision is
 * stated as a bound (see `format.ts`).
 */
const money = formatCost;

function orUnavailable(value: string | null | undefined): string {
  return value ?? t("evidence.unavailable");
}

function numberOrUnavailable(value: number | null): string {
  return value === null ? t("evidence.unavailable") : count(value);
}

function detailRow(label: string, value: string): readonly [string, string] {
  return [label, value];
}

type DetailRows = readonly (readonly [string, string])[];

function usageEconomicsDetails(economics: UsageEconomics | undefined): {
  readonly tokens: readonly (readonly [string, string])[];
  readonly cache: readonly (readonly [string, string])[];
} {
  if (economics === undefined) return { tokens: [], cache: [] };
  const catalog = ENGLISH_CATALOG;
  const unknown = catalog["evidence.unavailable"];
  const withCoverage = (shown: string, state: string): string =>
    state === "complete" || (shown === unknown && state === "unavailable")
      ? shown
      : `${shown} · ${state}`;
  const numberValue = (value: number | undefined, state: string): string =>
    withCoverage(value === undefined ? unknown : count(value), state);
  const costValue = (value: number | undefined, state: string): string =>
    withCoverage(value === undefined ? unknown : money(value), state);
  return {
    tokens: [
      [
        catalog["metric.inputTokens"],
        numberValue(economics.input.tokens, economics.input.tokenCoverage),
      ],
      [
        catalog["metric.outputTokens"],
        numberValue(economics.output.tokens, economics.output.tokenCoverage),
      ],
      [
        catalog["metric.reasoningTokens"],
        numberValue(economics.reasoning.tokens, economics.reasoning.coverage),
      ],
      [
        catalog["metric.inputCost"],
        costValue(economics.input.cost, economics.input.costCoverage),
      ],
      [
        catalog["metric.outputCost"],
        costValue(economics.output.cost, economics.output.costCoverage),
      ],
    ],
    cache: [
      [
        catalog["metric.cacheReadTokens"],
        numberValue(
          economics.cacheRead.tokens,
          economics.cacheRead.tokenCoverage,
        ),
      ],
      [
        catalog["metric.cacheWriteTokens"],
        numberValue(
          economics.cacheWrite.tokens,
          economics.cacheWrite.tokenCoverage,
        ),
      ],
      [
        catalog["metric.cacheReadCost"],
        costValue(economics.cacheRead.cost, economics.cacheRead.costCoverage),
      ],
      [
        catalog["metric.cacheWriteCost"],
        costValue(economics.cacheWrite.cost, economics.cacheWrite.costCoverage),
      ],
      [
        catalog["metric.cacheDenominator"],
        numberValue(
          economics.cacheReuse.denominatorTokens,
          economics.cacheReuse.coverage,
        ),
      ],
      [catalog["metric.coverage"], economics.cacheReuse.coverage],
    ],
  };
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
  metrics: t("chart.tokens"),
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
    agentExecutionSection(agentsSections(report, rangeProjection)),
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
  const economics =
    range === undefined
      ? report.usageEconomics
      : range.resolved === null
        ? undefined
        : range.usageEconomics;
  const economicsDetails = usageEconomicsDetails(economics);
  const cachePercent = economics?.cacheReuse.percent ?? report.cacheHitPercent;
  const tokenDetails: DetailRows =
    economics === undefined
      ? [
          detailRow(
            catalog["metric.input"],
            numberOrUnavailable(usage?.inputTokens ?? null),
          ),
          detailRow(
            catalog["metric.output"],
            numberOrUnavailable(usage?.outputTokens ?? null),
          ),
          ...(usage?.reasoningTokens === undefined
            ? []
            : [
                detailRow(
                  catalog["metric.reasoningTokens"],
                  numberOrUnavailable(usage.reasoningTokens),
                ),
              ]),
        ]
      : economicsDetails.tokens;
  const cacheDetails: DetailRows =
    economics === undefined
      ? [
          detailRow(
            catalog["metric.cacheRead"],
            numberOrUnavailable(usage?.cacheReadTokens ?? null),
          ),
          detailRow(
            catalog["metric.cacheWrite"],
            numberOrUnavailable(usage?.cacheWriteTokens ?? null),
          ),
          detailRow(
            catalog["metric.cacheHit"],
            cachePercent === null || cachePercent === undefined
              ? unknown
              : `${cachePercent.toFixed(1)}%`,
          ),
        ]
      : economicsDetails.cache;
  const cacheValue =
    cachePercent === null || cachePercent === undefined
      ? unknown
      : `${cachePercent.toFixed(1)}%${economics === undefined || economics.cacheReuse.coverage === "complete" ? "" : ` · ${economics.cacheReuse.coverage}`}`;
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
      tokenDetails,
    ),
    metric(
      catalog["metric.cacheReuse"],
      cacheValue,
      catalog["metric.cache.note"],
      cacheDetails,
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
      "",
      "card section-gap",
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
    "card section-gap",
  );
}

type OptionalField = (typeof OPTIONAL_USAGE_FIELDS)[number];

function dailyFieldLabels(): Record<OptionalField, string> {
  const catalog = ENGLISH_CATALOG;
  return {
    inputTokens: catalog["metric.inputTokens"],
    outputTokens: catalog["metric.outputTokens"],
    cacheReadTokens: catalog["metric.cacheReadTokens"],
    cacheWriteTokens: catalog["metric.cacheWriteTokens"],
    reasoningTokens: catalog["metric.reasoningTokens"],
    inputCost: catalog["metric.inputCost"],
    outputCost: catalog["metric.outputCost"],
    cacheReadCost: catalog["metric.cacheReadCost"],
    cacheWriteCost: catalog["metric.cacheWriteCost"],
  };
}

function publishedDailyFields(
  rows: readonly { [field in OptionalField]?: number }[],
): OptionalField[] {
  return OPTIONAL_USAGE_FIELDS.filter((field) =>
    rows.some((row) => row[field] !== undefined),
  );
}

function dailyFieldValues(
  row: { [field in OptionalField]?: number },
  fields: readonly OptionalField[],
): string[] {
  return fields.map((field) => {
    const value = row[field];
    if (value === undefined) return ENGLISH_CATALOG["evidence.unavailable"];
    return field.endsWith("Cost") ? money(value) : count(value);
  });
}

function dailySection(rows: readonly DailyRow[]): string {
  const catalog = ENGLISH_CATALOG;
  if (rows.length === 0) {
    return emptyCard(catalog["panel.daily"], catalog["bars.empty"]);
  }
  const fields = publishedDailyFields(rows);
  const labels = dailyFieldLabels();
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
        ...fields.map((field) => labels[field]),
      ],
      rows.map((row) => [
        row.date,
        count(row.sessions),
        count(row.totalTokens),
        money(row.cost),
        count(row.generations),
        count(row.tools),
        ...dailyFieldValues(row, fields),
      ]),
      [
        "status-cell",
        "num",
        "num",
        "num",
        "num",
        "num",
        ...fields.map(() => "num"),
      ],
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
              sectionLink("tools", row.name),
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
              sectionLink("tools", row.name),
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
  return sectionTarget("tools", summarySection) + tabSection(callsSection);
}

/**
 * One section boundary, as static markup: a group of cards whose own headings
 * name them, separated from the group above it by the surface's own border
 * token. No heading is added here — the card below it already states its
 * subject — and the same class carries the spacing in both renderers.
 */
function tabSection(content: string): string {
  if (content === "") return "";
  return `<section class="tab-section">${content}</section>`;
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
              sectionLink("skills", row.name),
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
  const skillsSection = sectionTarget("skills", skillRows);
  return summary + commandRows + skillsSection + resourceRows;
}

/**
 * The boundary between model usage and agent execution, as static markup: one
 * heading labelling one section, using the surface's own border token. A
 * decorative rule would only say "space", and a screenshot cannot read it.
 */
function agentExecutionSection(content: string): string {
  if (content === "") return "";
  return (
    `<section class="tab-section" aria-labelledby="agent-execution-title">` +
    `<h2 class="section-title" id="agent-execution-title">${text(ENGLISH_CATALOG["section.agentExecution"])}</h2>` +
    content +
    `</section>`
  );
}

function agentEffortValue(
  value: string | number | null | undefined,
  coverage: UiAgentRow["effortCoverage"]["duration"],
): string {
  if (value === null || value === undefined || coverage === "unavailable") {
    return ENGLISH_CATALOG["evidence.unavailable"];
  }
  return coverage === "partial"
    ? `${ENGLISH_CATALOG["agents.effortKnown"]} ${value}`
    : String(value);
}

function agentEffortCoverage(coverage: UiAgentRow["effortCoverage"]): string {
  return [
    `duration ${coverage.duration}`,
    `generations ${coverage.generations}`,
    `tools ${coverage.tools}`,
    `errors ${coverage.errors}`,
    `usage ${coverage.usage}`,
    `cost ${coverage.cost}`,
  ].join(" · ");
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
              agentHierarchy(range, runs) +
              `<p class="tree-detail-label">${text(catalog["agents.tree.flat"])}</p>` +
              elapsedTable(
                [
                  catalog["table.role"],
                  catalog["table.status"],
                  catalog["table.model"],
                  catalog["table.duration"],
                  catalog["table.generations"],
                  catalog["table.tools"],
                  catalog["table.errorCount"],
                  catalog["table.tokens"],
                  catalog["table.cost"],
                  catalog["agents.effortCoverage"],
                  catalog["table.artifacts"],
                  catalog["table.parent"],
                ],
                runs.map((run) => [
                  orUnavailable(run.agent),
                  raw(
                    (run.executionDisposition === "detached"
                      ? badge(catalog["agents.detached"], "neutral")
                      : "") +
                      badge(
                        catalogEntry(`agents.${run.status}`),
                        run.status === "failed" || run.status === "interrupted"
                          ? "warn"
                          : "neutral",
                      ),
                  ),
                  orUnavailable(run.model),
                  agentEffortValue(
                    run.durationLabel,
                    run.effortCoverage.duration,
                  ),
                  agentEffortValue(
                    run.generations,
                    run.effortCoverage.generations,
                  ),
                  agentEffortValue(run.toolCalls, run.effortCoverage.tools),
                  agentEffortValue(run.errorCount, run.effortCoverage.errors),
                  agentEffortValue(
                    run.usage?.totalTokens === undefined
                      ? null
                      : count(run.usage.totalTokens),
                    run.effortCoverage.usage,
                  ),
                  agentEffortValue(
                    run.usage?.cost === undefined
                      ? null
                      : money(run.usage.cost),
                    run.effortCoverage.cost,
                  ),
                  agentEffortCoverage(run.effortCoverage),
                  orUnavailable(run.artifacts),
                  parentLabel(run, runs),
                ]),
                [
                  "status-cell",
                  "status-cell",
                  "status-cell",
                  "status-cell",
                  "num",
                  "num",
                  "num",
                  "num",
                  "num",
                  "status-cell",
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
 * The execution hierarchy of one selection, as static markup: the same forest
 * projection the browser renders, expanded in full.
 *
 * A snapshot has no JavaScript, so it has no disclosure to offer: the document
 * prints every level and imitates no control (ADR 0018). The distinction the
 * browser expresses with a toggle — what a collapsed node hides — is stated as
 * the child count instead, and a run container stays a group rather than being
 * worded or shaped like an agent run.
 */
function agentHierarchy(
  range: SnapshotRange | undefined,
  runs: readonly UiAgentRow[],
): string {
  if (range === undefined || runs.length === 0) return "";
  const catalog = ENGLISH_CATALOG;
  const view = filterAgentForest(buildAgentForest(runs), () => true);
  const meta = range;
  const datable = meta.resolved !== null && Number(meta.totals.days) > 0;
  return (
    `<ul class="tree" role="list">` +
    `<li class="tree-node is-session"><div class="tree-row">` +
    staticToggle(false) +
    `<div class="tree-main"><div class="tree-title">` +
    `<span class="tree-session">${text(catalog["agents.tree.session"])}</span>` +
    `</div><div class="tree-meta mono">${text(sessionFigures(range))}</div>` +
    `<p class="tree-count">${text(catalog["agents.tree.scope"])}</p>` +
    sessionModelCaveat(range) +
    sessionModels(range, datable) +
    `</div></div>` +
    entriesMarkup(view.entries, false, runs) +
    `</li></ul>`
  );
}

/** One static disclosure glyph: a marker, never a control. */
function staticToggle(leaf: boolean): string {
  const classes = leaf ? "tree-toggle is-leaf" : "tree-toggle is-static";
  return (
    `<span class="${classes}" aria-hidden="true">` +
    `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<path d="M6 9l6 6 6-6"></path></svg></span>`
  );
}

/** The child list of a static node: every level is printed. */
function entriesMarkup(
  entries: readonly UiAgentTreeFilteredEntry[],
  nested: boolean,
  runs: readonly UiAgentRow[],
): string {
  if (entries.length === 0) return "";
  const items = entries
    .map((entry) =>
      entry.kind === "container"
        ? treeContainerItem(entry, runs)
        : treeRunItem(entry, nested, runs),
    )
    .join("");
  return `<ul class="tree-children" role="list">${items}</ul>`;
}

/**
 * What a node states about what it holds. A static document has no collapsed
 * state, so the count that matters is the children it prints below it, plus any
 * failure those children contain.
 */
function treeCounts(node: {
  children: readonly unknown[];
  failed: number;
  interrupted: number;
  withoutUsage: number;
  durationPartial: number;
  durationUnavailable: number;
  toolCallsPartial: number;
  toolCallsUnavailable: number;
}): string {
  const parts: string[] = [];
  if (node.children.length > 0) {
    parts.push(t("agents.tree.children", { count: node.children.length }));
  }
  if (node.failed > 0) {
    parts.push(t("agents.tree.failed", { count: node.failed }));
  }
  if (node.interrupted > 0) {
    parts.push(t("agents.tree.interrupted", { count: node.interrupted }));
  }
  if (node.withoutUsage > 0) {
    parts.push(t("agents.tree.withoutUsage", { count: node.withoutUsage }));
  }
  if (node.durationPartial > 0) {
    parts.push(
      t("agents.tree.durationPartial", { count: node.durationPartial }),
    );
  }
  if (node.durationUnavailable > 0) {
    parts.push(
      t("agents.tree.durationUnavailable", { count: node.durationUnavailable }),
    );
  }
  if (node.toolCallsPartial > 0) {
    parts.push(
      t("agents.tree.toolCallsPartial", { count: node.toolCallsPartial }),
    );
  }
  if (node.toolCallsUnavailable > 0) {
    parts.push(
      t("agents.tree.toolCallsUnavailable", {
        count: node.toolCallsUnavailable,
      }),
    );
  }
  return parts.join(" · ");
}

/** One run of the hierarchy: its label, its verdict, and its own figures. */
function treeRunItem(
  node: UiAgentTreeFilteredRun,
  nested: boolean,
  runs: readonly UiAgentRow[],
): string {
  const catalog = ENGLISH_CATALOG;
  const run = node.run;
  const tone =
    run.status === "failed" || run.status === "interrupted"
      ? "warn"
      : "neutral";
  const title =
    `<span class="mono">${text(orUnavailable(run.agent))}</span>` +
    (run.executionDisposition === "detached"
      ? badge(catalog["agents.detached"], "neutral")
      : "") +
    badge(catalogEntry(`agents.${run.status}`), tone) +
    (node.state === "context"
      ? badge(catalog["agents.tree.context"], "neutral")
      : "") +
    countSpan(treeCounts(node));
  const parts = [orUnavailable(run.model)];
  if (run.thinking !== null && run.thinking !== undefined) {
    parts.push(run.thinking);
  }
  const tokenLabel =
    run.usage?.totalTokens === undefined
      ? null
      : t("agents.tree.tokens", { count: run.usage.totalTokens });
  const costLabel =
    run.usage?.cost === undefined ? null : money(run.usage.cost);
  parts.push(
    `${catalog["table.tokens"]}: ${agentEffortValue(tokenLabel, run.effortCoverage.usage)} · ${catalog["table.cost"]}: ${agentEffortValue(costLabel, run.effortCoverage.cost)}`,
  );
  parts.push(
    `${catalog["table.duration"]}: ${agentEffortValue(run.durationLabel, run.effortCoverage.duration)}`,
  );
  parts.push(
    `${catalog["table.generations"]}: ${agentEffortValue(run.generations, run.effortCoverage.generations)}`,
  );
  parts.push(
    `${catalog["table.tools"]}: ${agentEffortValue(run.toolCalls, run.effortCoverage.tools)}`,
  );
  parts.push(
    `${catalog["table.errorCount"]}: ${agentEffortValue(run.errorCount, run.effortCoverage.errors)}`,
  );
  parts.push(
    `${catalog["agents.effortCoverage"]}: ${agentEffortCoverage(run.effortCoverage)}`,
  );
  if (run.artifacts !== null) {
    parts.push(`${catalog["table.artifacts"]}: ${run.artifacts}`);
  }
  // A row the hierarchy does not nest states the verdict L2 published for it.
  const parent = nested
    ? ""
    : `<div class="tree-parent">${text(parentLabel(run, runs))}</div>`;
  return (
    `<li class="tree-node"><div class="tree-row">` +
    staticToggle(node.children.length === 0) +
    `<div class="tree-main"><div class="tree-title">${title}</div>` +
    `<div class="tree-meta mono">${text(parts.join(" · "))}</div>` +
    parent +
    `</div></div>` +
    entriesMarkup(node.children, true, runs) +
    `</li>`
  );
}

/** One run container: a group, worded as a group and never as an agent. */
function treeContainerItem(
  node: UiAgentTreeFilteredEntry,
  runs: readonly UiAgentRow[],
): string {
  if (node.kind !== "container") return "";
  const catalog = ENGLISH_CATALOG;
  return (
    `<li class="tree-node is-container"><div class="tree-row">` +
    staticToggle(node.children.length === 0) +
    `<div class="tree-main"><div class="tree-title">` +
    `<span class="tree-group">${text(catalog["agents.tree.container"])}</span>` +
    countSpan(treeCounts(node)) +
    `</div><div class="tree-meta">${text(catalog["agents.tree.container.note"])}</div>` +
    `</div></div>` +
    entriesMarkup(node.children, true, runs) +
    `</li>`
  );
}

function countSpan(value: string): string {
  return value === "" ? "" : `<span class="tree-count">${text(value)}</span>`;
}

/**
 * The session root's own figures, under the same rules the browser applies: a
 * range that resolves no day publishes no figure rather than a zero, a
 * truncated range qualifies the two figures it cannot complete exactly as the
 * Overview cards do, and more than one model is never reduced to one "primary"
 * model.
 */
function sessionFigures(range: SnapshotRange): string {
  const catalog = ENGLISH_CATALOG;
  if (range.resolved === null || Number(range.totals.days) === 0) {
    return catalog["evidence.unavailable"];
  }
  const models = range.models;
  const partial = range.truncated === true;
  const parts: string[] = [];
  const single = range.modelsTruncated !== true && models.length === 1;
  if (single) {
    parts.push(
      `${models[0]?.model ?? ""} · ${t("agents.tree.generations", { count: models[0]?.generations ?? 0 })}`,
    );
  } else {
    parts.push(
      t("agents.tree.generations", {
        count: range.totals.generations,
      }),
    );
    const listed = range.modelsTruncated === true;
    parts.push(
      models.length === 0
        ? catalog["evidence.unavailable"]
        : t(listed ? "agents.tree.modelsListed" : "agents.tree.modelsUsed", {
            count: models.length,
          }),
    );
  }
  const cost = money(range.totals.cost);
  parts.push(
    partial
      ? `${catalog["metric.knownTokens"]}: ${count(range.totals.totalTokens)}`
      : t("agents.tree.tokens", { count: range.totals.totalTokens }),
  );
  parts.push(partial ? `${catalog["metric.knownCost"]}: ${cost}` : cost);
  return parts.join(" · ");
}

/**
 * The statement a session row owes when its model list is not the whole
 * picture: the count above it is a count of listed models, and the caveat is
 * printed even though the model rows are always shown in a static artifact.
 */
function sessionModelCaveat(range: SnapshotRange): string {
  if (range.modelsTruncated !== true) return "";
  return `<p class="tree-count">${text(ENGLISH_CATALOG["models.truncated"])}</p>`;
}

/** The Models detail, printed rather than disclosed: a static document shows it. */
function sessionModels(range: SnapshotRange, datable: boolean): string {
  if (!datable || range.models.length === 0) return "";
  const catalog = ENGLISH_CATALOG;
  const rows = range.models
    .map(
      (model) =>
        `<li class="tree-model">${text(
          `${model.model} · ${t("agents.tree.generations", { count: model.generations })}`,
        )}</li>`,
    )
    .join("");
  return (
    `<p class="tree-detail-label">${text(catalog["agents.tree.models"])}</p>` +
    `<ul class="tree-models" role="list">${rows}</ul>`
  );
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
            usageEconomics: projection.usageEconomics,
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
  usageEconomics?: UsageEconomics;
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
  const economics = datable ? input.usageEconomics : undefined;
  const economicsDetails = usageEconomicsDetails(economics);
  const cachePercent = economics?.cacheReuse.percent;
  const cacheValue =
    cachePercent === undefined
      ? unknown
      : `${cachePercent.toFixed(1)}%${economics === undefined || economics.cacheReuse.coverage === "complete" ? "" : ` · ${economics.cacheReuse.coverage}`}`;
  return [
    metric(catalogEntry(costLabel), costValue, catalog["metric.native"]),
    metric(
      catalogEntry(tokensLabel),
      tokensValue,
      catalog["metric.tokens.note"],
      economicsDetails.tokens,
    ),
    metric(
      catalog["metric.cacheReuse"],
      cacheValue,
      catalog["metric.cache.note"],
      economicsDetails.cache,
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
            usageEconomics: projection.usageEconomics,
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
  const fields = publishedDailyFields(rows);
  const labels = dailyFieldLabels();
  return card(
    catalog["panel.daily"],
    DAILY_NOTE,
    elapsedTable(
      [
        catalog["table.date"],
        catalog["table.sessions"],
        catalog["table.tokens"],
        catalog["table.cost"],
        ...fields.map((field) => labels[field]),
      ],
      rows.map((row) => [
        row.date,
        count(row.sessions),
        count(row.totalTokens),
        money(row.cost),
        ...dailyFieldValues(row, fields),
      ]),
      ["status-cell", "num", "num", "num", ...fields.map(() => "num")],
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

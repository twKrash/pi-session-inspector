import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { reduceEntries } from "../../src/core/reduce.ts";
import { type SessionReport, toSessionReport } from "../../src/core/reports.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";
import { CAPABILITIES, type CurrentView } from "../../src/ui/bundle.ts";
import { buildDailyRows } from "../../src/ui/daily.ts";
import type { DatedModelRow, DateUsageRow } from "../../src/ui/dated-usage.ts";
import { ENGLISH_CATALOG } from "../../src/ui/i18n/catalog.ts";
import type {
  GlobalReport,
  HistoricalSession,
  HistoryReport,
} from "../../src/ui/load-history.ts";
import {
  escapeSnapshotAttribute,
  escapeSnapshotText,
  renderSnapshot,
  SNAPSHOT_STYLESHEET,
  type SnapshotDto,
  type SnapshotTheme,
} from "../../src/ui/snapshot.ts";
import {
  projectCurrentView,
  projectGlobalReport,
  projectHistoricalSession,
  projectHistoryReport,
  type UiAgentRow,
} from "../../src/ui/ui-projection.ts";
import { FORBIDDEN_PRODUCER_KEYS } from "../helpers/bundle-scenarios.ts";

/**
 * The one snapshot fixture: a session whose generation, two tool calls (one
 * failed), child run, inventory and integrations give every rendered section a
 * row, plus the dated rows the range resolves against. Every DTO below is built
 * from this single fixture through the L2 projections, so a renderer assertion
 * can never pass because a fixture was hand-shaped for it.
 */

const CATALOG = ENGLISH_CATALOG;
const SESSION_ID = "session-snapshot";
const GEN_AT = "2026-03-10T10:00:00.000Z";
const READ_AT = "2026-03-10T10:00:01.000Z";
const BASH_AT = "2026-03-10T10:00:02.000Z";
const PRESET_7 = { kind: "preset", preset: 7 } as const;

const ENTRIES = [
  {
    type: "message",
    id: "gen",
    parentId: null,
    timestamp: GEN_AT,
    message: {
      role: "assistant",
      provider: "acme",
      model: "alpha",
      usage: {
        totalTokens: 100,
        cost: { total: 0.02 },
        inputTokens: 60,
        outputTokens: 30,
        cacheReadTokens: 8,
        cacheWriteTokens: 2,
      },
      content: [
        { type: "toolCall", id: "call_read", name: "read" },
        { type: "toolCall", id: "call_bash", name: "bash" },
      ],
    },
  },
  {
    type: "message",
    id: "res-read",
    parentId: "gen",
    timestamp: READ_AT,
    message: {
      role: "toolResult",
      toolCallId: "call_read",
      toolName: "read",
      isError: false,
      usage: { totalTokens: 20, cost: { total: 0.004 } },
      content: [],
    },
  },
  {
    type: "message",
    id: "res-bash",
    parentId: "gen",
    timestamp: BASH_AT,
    message: {
      role: "toolResult",
      toolCallId: "call_bash",
      toolName: "bash",
      isError: true,
      content: [],
    },
  },
];

/** One bounded generation-only report, for the aggregate's second session. */
function generationReport(
  sessionId: string,
  totalTokens: number,
  cost: number,
): SessionReport {
  return toSessionReport(
    reduceEntries(sessionId, [
      {
        type: "message",
        id: `${sessionId}-gen`,
        parentId: null,
        timestamp: GEN_AT,
        message: {
          role: "assistant",
          provider: "acme",
          model: "alpha",
          usage: { totalTokens, cost: { total: cost } },
          content: [],
        },
      },
    ]),
  );
}

function report(): SessionReport {
  return toSessionReport(reduceEntries(SESSION_ID, ENTRIES), {
    agents: {
      state: "supported",
      runs: [
        {
          id: `subagent-${"a".repeat(64)}`,
          agent: "reviewer",
          status: "succeeded",
          confidence: "cooperative",
          observedAt: BASH_AT,
          evidenceToolId: "tool:call_bash",
          model: "alpha",
          thinking: "high",
          usage: { totalTokens: 5, cost: 0.01 },
        },
      ],
    },
    agentActivity: {
      state: "supported",
      calls: 1,
      succeeded: 1,
      failed: 0,
      interrupted: 0,
      tools: [{ name: "bash", calls: 1 }],
    },
    inventory: {
      schemaVersion: 1,
      commands: [
        {
          name: "cmd-one",
          source: "extension",
          sourceLabel: "local",
          scope: "user",
          origin: "package",
          description: "A command.",
        },
      ],
      skills: [
        {
          name: "skill-one",
          sourceLabel: "local",
          scope: "user",
          origin: "package",
          explicitInvocations: 2,
        },
      ],
      resources: [
        {
          sourceLabel: "local",
          scope: "user",
          origin: "package",
          commands: 1,
          skills: 1,
          prompts: 0,
          tools: 0,
        },
      ],
      toolSources: {},
    },
    counters: {
      counters: {},
      skillInvocations: {},
      otherInvocations: 0,
      presence: { permission: false },
    },
    integrations: [
      {
        integration: "context",
        presence: "present",
        version: 1,
        state: "supported",
        counters: { calls: 2 },
      },
      { integration: "ponytail", presence: "absent", state: "unavailable" },
    ],
  });
}

/** One dated row whose parts sum to its own totals, so the composition reconciles. */
function datedRow(
  date: string,
  totalTokens: number,
  cost: number,
  generations: number,
  tools: number,
): DateUsageRow {
  const zero = { totalTokens: 0, cost: 0 };
  return {
    date,
    totalTokens,
    cost,
    generations,
    tools,
    errors: 0,
    composition: {
      generations: { totalTokens, cost },
      toolResults: { ...zero },
      compactions: { ...zero },
      branchSummaries: { ...zero },
    },
  };
}

const DATED_ROWS: DateUsageRow[] = [
  datedRow("2026-03-09", 0, 0, 0, 0),
  datedRow("2026-03-10", 120, 0.024, 1, 2),
];

const DATED_MODELS: DatedModelRow[] = [
  {
    date: "2026-03-10",
    provider: "acme",
    model: "alpha",
    generations: 1,
    totalTokens: 100,
    cost: 0.02,
  },
];

/** One fold of the same dated window, the shape a view's `daily` carries. */
function foldedDaily(rows: readonly DateUsageRow[], sessionId: string) {
  return buildDailyRows([{ sessionId, rows, truncated: false }]).rows;
}

const DAILY_ROWS = foldedDaily(DATED_ROWS, SESSION_ID);

function currentView(overrides: Partial<CurrentView> = {}): CurrentView {
  return {
    availability: "available",
    report: report(),
    capabilities: CAPABILITIES.current,
    daily: DAILY_ROWS,
    dailyTruncated: false,
    datedModels: DATED_MODELS,
    modelsTruncated: false,
    ...overrides,
  };
}

function currentDto(theme: SnapshotTheme = "dark"): SnapshotDto {
  return {
    kind: "current",
    schemaVersion: 1,
    theme,
    projection: projectCurrentView(currentView(), "tree", PRESET_7),
  };
}

function memberSession(): HistoricalSession {
  return {
    availability: "available",
    sessionId: "session-member",
    usageByDate: DATED_ROWS,
    usageByDateTruncated: false,
    datedModels: DATED_MODELS,
    modelsTruncated: false,
    report: report(),
  };
}

const COVERAGE = {
  inspected: 3,
  available: 2,
  unavailable: 1,
  sessionRatio: 2 / 3,
  complete: false,
  discoveryLimited: false,
  reasons: { "marker-unavailable": 1 },
};

function historySource(): HistoryReport {
  return {
    availability: "available",
    sessions: [
      memberSession(),
      {
        availability: "available",
        sessionId: "session-partial",
        usageByDate: [datedRow("2026-03-10", 5, 0.001, 1, 0)],
        usageByDateTruncated: true,
        datedModels: [],
        modelsTruncated: false,
        report: generationReport("session-partial", 5, 0.001),
      },
      {
        availability: "unavailable",
        sessionId: "session-missing",
        reason: "marker-unavailable",
      },
    ],
    diagnostics: [],
    coverage: COVERAGE,
  };
}

function globalSource(): GlobalReport {
  return {
    availability: "available",
    sessions: [
      {
        availability: "available",
        sessionId: "session-member",
        usageByDateTruncated: false,
      },
      { availability: "unavailable", sessionId: "session-missing" },
    ],
    usage: { totalTokens: 120, cost: 0.024 },
    dates: [
      { date: "2026-03-09", sessions: 1, usage: { totalTokens: 0, cost: 0 } },
      {
        date: "2026-03-10",
        sessions: 1,
        usage: { totalTokens: 120, cost: 0.024 },
      },
    ],
    diagnostics: [],
    inventory: { commands: 3, skills: 2, resources: 1 },
    coverage: {
      inspected: 2,
      available: 1,
      unavailable: 1,
      sessionRatio: 0.5,
      complete: false,
      discoveryLimited: false,
      reasons: { "marker-unavailable": 1 },
    },
  };
}

function historyDto(theme: SnapshotTheme = "light"): SnapshotDto {
  return {
    kind: "history",
    schemaVersion: 1,
    theme,
    projection: projectHistoryReport(historySource()),
  };
}

function globalDto(theme: SnapshotTheme = "light"): SnapshotDto {
  return {
    kind: "global",
    schemaVersion: 1,
    theme,
    projection: projectGlobalReport(globalSource()),
  };
}

function sessionDto(theme: SnapshotTheme = "dark"): SnapshotDto {
  return {
    kind: "session",
    schemaVersion: 1,
    theme,
    projection: projectHistoricalSession(memberSession()),
  };
}

/** The one small HTML-context decoder the escape assertions round-trip through. */
function decodeHtml(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, decimal: string) =>
      String.fromCodePoint(Number(decimal)),
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

test("renders one resolved current snapshot with its title, range and rows", () => {
  const html = renderSnapshot(currentDto());

  assert.equal(html.includes(CATALOG["heading.current"]), true);
  assert.equal(html.includes(CATALOG["kicker.current"]), true);
  assert.equal(html.includes(SESSION_ID), true);
  assert.equal(html.includes(CATALOG["scope.tree"]), true);
  // The selected range: the 7-day preset anchored on the view's own latest date.
  assert.equal(html.includes(CATALOG["range.label"]), true);
  assert.equal(html.includes("Last 7 days"), true);
  assert.equal(html.includes("2026-03-04 → 2026-03-10"), true);
  // One row per bounded table: daily, models, tool summary, tool calls, tools
  // timeline, error, child run, ledger, and the environment inventory.
  assert.equal(html.includes("2026-03-10"), true);
  assert.equal(html.includes("acme"), true);
  assert.equal(html.includes("cmd-one"), true);
  assert.equal(html.includes("skill-one"), true);
  assert.equal(html.includes("context"), true);
  assert.equal(html.includes("read"), true);
  assert.equal(
    html.includes(CATALOG["errors.toolFailed"].replace("{tool}", "bash")),
    true,
  );
  assert.equal(html.includes("generation:gen"), true);
  assert.equal(html.includes("tool:call_read"), true);
  // The composition reconciles with the same resolved range.
  assert.equal(html.includes(CATALOG["usage.reconciled"]), true);
  assert.equal(html.includes(CATALOG["usage.total"]), true);
  // Fixed section order and coverage of every current/session section.
  const sections = [
    CATALOG["panel.daily"],
    CATALOG["panel.models"],
    CATALOG["tools.summary"],
    CATALOG["tools.calls"],
    CATALOG["tab.environment"],
    CATALOG["tab.agents"],
    CATALOG["panel.integrations"],
    CATALOG["tab.errors"],
    CATALOG["tab.ledger"],
    CATALOG["panel.evidence"],
  ];
  let cursor = -1;
  for (const section of sections) {
    const at = html.indexOf(section, cursor + 1);
    assert.equal(at > cursor, true, `missing or out of order: ${section}`);
    cursor = at;
  }
});

test("renders a history snapshot with coverage, daily and session rows", () => {
  const html = renderSnapshot(historyDto());

  assert.equal(html.includes(CATALOG["heading.history"]), true);
  assert.equal(html.includes(CATALOG["coverage.title"]), true);
  assert.equal(html.includes("2 / 3 sessions · 1 unavailable"), true);
  assert.equal(html.includes("marker-unavailable: 1"), true);
  // The aggregate's own resolved range and its in-range daily row.
  assert.equal(html.includes("2026-03-10"), true);
  assert.equal(html.includes("2026-02-25 → 2026-03-10"), true);
  // Membership rows: a published member, a partial member, and the unknown group.
  assert.equal(html.includes("session-member"), true);
  assert.equal(html.includes("session-partial"), true);
  assert.equal(html.includes("session-missing"), true);
  assert.equal(html.includes(CATALOG["history.groupUnknown"]), true);
  assert.equal(html.includes(CATALOG["metric.knownTokens"]), true);
  assert.equal(html.includes(CATALOG["metric.knownCost"]), true);
  // A contributing truncated window keeps the aggregate visibly partial.
  assert.equal(html.includes(CATALOG["history.dailyTruncated"]), true);
  assert.equal(html.includes(CATALOG["panel.evidence"]), true);
});

test("renders a global snapshot with coverage, usage, daily and inventory", () => {
  const html = renderSnapshot(globalDto());

  assert.equal(html.includes(CATALOG["heading.global"]), true);
  assert.equal(html.includes(CATALOG["coverage.title"]), true);
  // The global aggregate's all-date composition is unavailable by construction;
  // its total stays visible beside that verdict.
  assert.equal(html.includes(CATALOG["usage.title"]), true);
  assert.equal(html.includes(CATALOG["unavailable.composition"]), true);
  assert.equal(html.includes(CATALOG["usage.total"]), true);
  assert.equal(html.includes("$0.02"), true);
  assert.equal(html.includes(CATALOG["metric.days"]), true);
  assert.equal(html.includes(CATALOG["metric.sessions"]), true);
  assert.equal(html.includes(CATALOG["env.commands"]), true);
  assert.equal(html.includes(CATALOG["env.skills"]), true);
  assert.equal(html.includes(CATALOG["env.resources"]), true);
  assert.equal(html.includes("2026-02-25 → 2026-03-10"), true);
  assert.equal(html.includes("2026-03-09"), true);
  assert.equal(html.includes(CATALOG["panel.evidence"]), true);
});

test("renders a selected history session as its own full-tree target", () => {
  const html = renderSnapshot(sessionDto());

  assert.equal(html.includes(CATALOG["heading.history"]), true);
  assert.equal(html.includes(SESSION_ID), true);
  assert.equal(html.includes(CATALOG["scope.tree"]), true);
  assert.equal(html.includes(CATALOG["tools.summary"]), true);
  assert.equal(html.includes(CATALOG["tab.ledger"]), true);
  assert.equal(html.includes("2026-03-10"), true);
});

test("renders unavailable targets as bounded labels, never as zeros", () => {
  const unavailableCurrent: SnapshotDto = {
    kind: "current",
    schemaVersion: 1,
    theme: "light",
    projection: projectCurrentView(
      {
        availability: "unavailable",
        diagnostic: "current-unavailable",
        capabilities: [],
      },
      "active",
    ),
  };
  const html = renderSnapshot(unavailableCurrent);
  assert.equal(html.includes(CATALOG["unavailable.title"]), true);
  assert.equal(html.includes(CATALOG["unavailable.current"]), true);
  assert.equal(html.includes("current-unavailable"), true);
  assert.equal(html.includes(CATALOG["metric.cost"]), false);
  assert.equal(html.includes("$0.00"), false);

  const unavailableHistory: SnapshotDto = {
    kind: "history",
    schemaVersion: 1,
    theme: "light",
    projection: projectHistoryReport({
      availability: "unavailable",
      sessions: [],
      diagnostics: [],
    }),
  };
  const historyHtml = renderSnapshot(unavailableHistory);
  assert.equal(historyHtml.includes(CATALOG["unavailable.title"]), true);
  assert.equal(historyHtml.includes(CATALOG["unavailable.copy"]), true);
  assert.equal(historyHtml.includes("$0.00"), false);

  // An unresolved range (no observed date) is labelled, not rendered as zeros.
  const unresolved: SnapshotDto = {
    kind: "current",
    schemaVersion: 1,
    theme: "light",
    projection: projectCurrentView(
      {
        availability: "available",
        report: report(),
        capabilities: CAPABILITIES.current,
      },
      "tree",
    ),
  };
  const unresolvedHtml = renderSnapshot(unresolved);
  assert.equal(unresolvedHtml.includes(CATALOG["evidence.unavailable"]), true);
  assert.equal(unresolvedHtml.includes("$0.00"), false);
  assert.equal(unresolvedHtml.includes("2026-03-10"), true);
});

test("labels a range that cannot reach the retained window as partial", () => {
  const partial = renderSnapshot({
    kind: "current",
    schemaVersion: 1,
    theme: "dark",
    projection: projectCurrentView(
      currentView({ dailyTruncated: true }),
      "tree",
      PRESET_7,
    ),
  });

  assert.equal(partial.includes(CATALOG["range.truncated"]), true);
  assert.equal(partial.includes(CATALOG["metric.knownCost"]), true);
  assert.equal(partial.includes(CATALOG["metric.knownTokens"]), true);
});

test("renders a static, script-free and network-free document", () => {
  const html = renderSnapshot(currentDto());

  assert.equal(html.includes("<script"), false);
  assert.equal(html.includes("fetch("), false);
  assert.equal(html.includes("connect-src"), false);
  assert.match(html, /style-src 'sha256-[A-Za-z0-9+/=]+'/);
  assert.equal(renderSnapshot(currentDto()), html);

  // The CSP hash is computed from the exact inlined stylesheet bytes.
  const inlined = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1];
  assert.equal(inlined, SNAPSHOT_STYLESHEET);
  const hash = createHash("sha256")
    .update(inlined ?? "", "utf8")
    .digest("base64");
  assert.equal(html.includes(`style-src 'sha256-${hash}'`), true);

  assert.match(html, /default-src 'none'/);
  assert.match(html, /base-uri 'none'/);
  assert.match(html, /form-action 'none'/);
  assert.match(html, /frame-ancestors 'none'/);
  assert.equal(html.includes("script-src"), false);
  assert.equal(html.includes("unsafe-inline"), false);
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
  assert.equal(/https?:\/\//.test(html), false);
  assert.equal(/<link\b|<img\b|<iframe\b|<object\b|<embed\b/.test(html), false);
  assert.equal(
    /\son(?:click|error|load|submit|focus|blur|mouseover)\s*=/.test(html),
    false,
  );
  assert.equal(html.includes("innerHTML"), false);
  // No DTO JSON, no client data blob, and no executable bootstrap.
  assert.equal(html.includes('"sessionId"'), false);
  assert.equal(html.includes("application/json"), false);
  assert.equal(html.includes("JSON.parse"), false);
  // The skip link is the one permitted anchor: exactly one `href`, and it is
  // the same-document fragment `#main`. External, protocol-relative, `data:`,
  // `file:` and route links stay banned; the one inlined stylesheet is the only
  // <style> block the CSP hash covers.
  assert.equal((html.match(/<a[\s>]/g) ?? []).length, 1);
  assert.deepEqual(
    [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]),
    ["#main"],
  );
  assert.equal(/href="(?:\/\/|(?:data|file|javascript):)/i.test(html), false);
  assert.equal(/href="#\//.test(html), false);
  assert.equal((html.match(/<style>/g) ?? []).length, 1);
  assert.equal((html.match(/<\/style>/g) ?? []).length, 1);
  for (const tag of ["td", "th", "section"]) {
    assert.equal(
      (html.match(new RegExp(`<${tag}[\\s>]`, "g")) ?? []).length,
      (html.match(new RegExp(`</${tag}>`, "g")) ?? []).length,
      `${tag} tags must be balanced`,
    );
  }
});

test("escapes hostile values for their exact text and attribute context", () => {
  const hostile = `</td><script>alert('x')</script> & " ' < > \u2028\u2029`;
  const base = currentDto();
  if (base.kind !== "current") throw new Error("the fixture is current");
  const projection = base.projection;
  const view = projection.report;
  const range = projection.range;
  if (view === undefined || range === undefined) {
    throw new Error("the fixture must carry a report and a range");
  }

  const dto: SnapshotDto = {
    kind: "current",
    schemaVersion: 1,
    theme: "dark",
    projection: {
      ...projection,
      diagnostic: hostile,
      report: {
        ...view,
        sessionId: hostile,
        span: { from: hostile, to: hostile },
        models: view.models.map((row) => ({
          ...row,
          provider: hostile,
          model: hostile,
        })),
        tools: view.tools.map((row) => ({
          ...row,
          id: hostile,
          name: hostile,
          source: hostile,
        })),
        integrations: view.integrations.map((row) => ({
          ...row,
          integration: hostile,
          counters: [hostile],
        })),
        errors: view.errors.map((row) => ({
          ...row,
          kind: hostile,
          message: hostile,
          toolName: hostile,
          toolSource: hostile,
          relatedChildIds: [hostile],
        })),
        ledger: view.ledger.map((item) => ({
          ...item,
          id: hostile,
          timestamp: hostile,
        })),
        commands: {
          ...view.commands,
          items: view.commands.items.map((row) => ({
            ...row,
            name: hostile,
            sourceLabel: hostile,
            description: hostile,
          })),
        },
        skills: {
          ...view.skills,
          items: view.skills.items.map((row) => ({
            ...row,
            name: hostile,
            sourceLabel: hostile,
          })),
        },
        resources: {
          ...view.resources,
          items: view.resources.items.map((row) => ({
            ...row,
            sourceLabel: hostile,
          })),
        },
      },
      range: {
        ...range,
        toolSummary: range.toolSummary.map((row) => ({
          ...row,
          name: hostile,
          source: hostile,
        })),
        toolCalls: range.toolCalls.map((row) => ({
          ...row,
          id: hostile,
          name: hostile,
          source: hostile,
          timestamp: hostile,
        })),
        agents: range.agents.map((row) => ({
          ...row,
          agent: hostile,
          model: hostile,
          thinking: hostile,
          observedAt: hostile,
        })),
        daily: range.daily.map((row) => ({ ...row, date: hostile })),
      },
    },
  };

  const html = renderSnapshot(dto);

  // The raw dangerous sequences never appear, in any context.
  assert.equal(html.includes(hostile), false);
  assert.equal(html.includes("</td><script>"), false);
  assert.equal(html.includes("\u2028"), false);
  assert.equal(html.includes("\u2029"), false);
  assert.equal(html.includes("alert('x')"), false);

  // Every context uses its own escaper, and both round-trip through the decoder.
  const text = escapeSnapshotText(hostile);
  const attribute = escapeSnapshotAttribute(hostile);
  assert.equal(html.includes(text), true);
  assert.equal(html.includes(attribute), true);
  assert.equal(decodeHtml(text), hostile);
  assert.equal(decodeHtml(attribute), hostile);
  assert.equal(text.includes("<"), false);
  assert.equal(text.includes('"'), false);
  assert.equal(text.includes("'"), false);

  // The escaped forms themselves are pinned literally: a helper that stopped
  // escaping `&` or `>` fails here instead of only being read back through its
  // own output, and the rendered document carries the same escaped sequence.
  const markup = `& < > " '`;
  assert.equal(escapeSnapshotText(markup), "&amp; &lt; &gt; &quot; &#39;");
  assert.equal(escapeSnapshotAttribute(markup), "&amp; &lt; &gt; &quot; &#39;");
  assert.equal(html.includes("&amp; &quot; &#39; &lt; &gt;"), true);

  // A visible cell and a visible attribute decode back to the hostile value.
  const cell = /<td class="status-cell">([^<]*)<\/td>/.exec(html)?.[1];
  assert.equal(decodeHtml(cell ?? ""), hostile);
  const stamp = /<time datetime="([^"]*)">/.exec(html)?.[1];
  assert.equal(decodeHtml(stamp ?? ""), hostile);
});

test("escapes a hostile history row and exposes no DTO JSON", () => {
  const hostile = "</td><script> & \" ' < > \u2028";
  const base = historyDto();
  if (base.kind !== "history") throw new Error("the fixture is history");
  const dto: SnapshotDto = {
    kind: "history",
    schemaVersion: 1,
    theme: "light",
    projection: {
      ...base.projection,
      sessions: base.projection.sessions.map((row) => ({
        ...row,
        sessionId: hostile,
        firstDate: hostile,
        lastDate: hostile,
        durationLabel: hostile,
      })),
    },
  };

  const html = renderSnapshot(dto);
  assert.equal(html.includes(hostile), false);
  assert.equal(html.includes("</td><script>"), false);
  assert.equal(html.includes("\u2028"), false);
  const cell = /<td class="id-cell"><span class="mono">([^<]*)<\/span>/.exec(
    html,
  )?.[1];
  assert.equal(decodeHtml(cell ?? ""), hostile);
  assert.equal(html.includes('"sessionId"'), false);
});

test("carries no producer-only key and no prompt or output text", () => {
  const source = [
    {
      type: "session",
      version: 3,
      id: "privacy-snapshot",
      timestamp: GEN_AT,
      sessionName: "SECRET_SESSION_NAME",
      sessionFile: "/tmp/SECRET_SESSION_FILE.jsonl",
      transcriptPath: "/tmp/SECRET_TRANSCRIPT.jsonl",
    },
    {
      type: "message",
      id: "prompt",
      parentId: null,
      timestamp: GEN_AT,
      task: "TASK_TEXT_DO_NOT_RENDER",
      progressSummary: "PROGRESS_TEXT_DO_NOT_RENDER",
      finalOutput: "FINAL_OUTPUT_DO_NOT_RENDER",
      artifactPaths: ["SECRET_ARTIFACT_PATH"],
      message: {
        role: "user",
        content: [{ type: "text", text: "PROMPT_TEXT_DO_NOT_RENDER" }],
      },
    },
    {
      type: "message",
      id: "gen",
      parentId: "prompt",
      timestamp: GEN_AT,
      message: {
        role: "assistant",
        provider: "acme",
        model: "alpha",
        usage: { totalTokens: 10, cost: { total: 0.01 } },
        content: [
          {
            type: "toolCall",
            id: "call_read",
            name: "read",
            input: { command: "cat SECRET_ARGUMENT" },
          },
        ],
      },
    },
    {
      type: "message",
      id: "res",
      parentId: "gen",
      timestamp: READ_AT,
      message: {
        role: "toolResult",
        toolCallId: "call_read",
        toolName: "read",
        isError: false,
        content: [{ type: "text", text: "SECRET_RESULT_BODY" }],
        usage: { totalTokens: 4, cost: { total: 0.001 } },
      },
    },
  ]
    .map((record) => JSON.stringify(record))
    .join("\n")
    .concat("\n");

  const parsed = parseSessionJsonl(source);
  const privacyReport = toSessionReport(
    reduceEntries(parsed.id, parsed.entries),
  );
  const html = renderSnapshot({
    kind: "current",
    schemaVersion: 1,
    theme: "dark",
    projection: projectCurrentView(
      {
        availability: "available",
        report: privacyReport,
        capabilities: CAPABILITIES.current,
        daily: foldedDaily(
          [datedRow("2026-03-10", 14, 0.011, 1, 1)],
          parsed.id,
        ),
        datedModels: DATED_MODELS,
      },
      "tree",
    ),
  });

  for (const key of FORBIDDEN_PRODUCER_KEYS) {
    assert.equal(html.includes(key), false, key);
  }
  for (const secret of [
    "SECRET_SESSION_NAME",
    "SECRET_SESSION_FILE",
    "SECRET_TRANSCRIPT",
    "SECRET_ARGUMENT",
    "SECRET_RESULT_BODY",
    "SECRET_ARTIFACT_PATH",
    "PROMPT_TEXT_DO_NOT_RENDER",
    "PROGRESS_TEXT_DO_NOT_RENDER",
    "FINAL_OUTPUT_DO_NOT_RENDER",
    "TASK_TEXT_DO_NOT_RENDER",
  ]) {
    assert.equal(html.includes(secret), false, secret);
  }
  // The bounded row the same fixture does carry is still rendered.
  assert.equal(html.includes("read"), true);
  assert.equal(html.includes("2026-03-10"), true);
});

test("is byte-identical for equal DTOs and selected only by theme", () => {
  const dto = currentDto();
  const html = renderSnapshot(dto);

  assert.equal(renderSnapshot({ ...dto, theme: dto.theme }), html);
  assert.equal(renderSnapshot(historyDto()), renderSnapshot(historyDto()));
  assert.equal(renderSnapshot(globalDto()), renderSnapshot(globalDto()));
  assert.equal(renderSnapshot(sessionDto()), renderSnapshot(sessionDto()));

  const dark = renderSnapshot(currentDto("dark"));
  const light = renderSnapshot(currentDto("light"));
  assert.notEqual(dark, light);
  assert.equal(dark.includes('class="theme-dark"'), true);
  assert.equal(light.includes('class="theme-dark"'), false);
  assert.equal(
    renderSnapshot(historyDto("dark")).includes('class="theme-dark"'),
    true,
  );
});

test("the renderer resolves no range and reaches no loader or filesystem", () => {
  const source = readFileSync("src/ui/snapshot.ts", "utf8");
  for (const fragment of [
    "resolveRange",
    "filterView",
    "historyRowRange",
    "isInRange",
    "latestObservedDate",
    "projectInspectorUi",
    "loadInspectorBundle",
    "loadHistoryReports",
    "loadGlobalReport",
    "loadCurrentSessionReport",
    "node:fs",
    "readFile",
    "document.",
    "window.",
    "Date.now",
    "new Date(",
    "./route.ts",
    "./html.ts",
    "JSON.stringify(",
  ]) {
    assert.equal(
      source.includes(fragment),
      false,
      `snapshot.ts must not reference ${fragment}`,
    );
  }
});

test("prints the DTO's child breakdown instead of summing the rendered runs", () => {
  const base = currentDto();
  if (base.kind !== "current") throw new Error("the fixture is current");
  const range = base.projection.range;
  if (range === undefined) throw new Error("the fixture must carry a range");
  const run = range.agents[0];
  const html = renderSnapshot({
    ...base,
    projection: {
      ...base.projection,
      range: {
        ...range,
        // The two rendered runs carry $0.11 + $0.22 of usage; the published
        // breakdown deliberately disagrees with every figure a sum would give.
        agents: [
          {
            ...run,
            id: "run-one",
            status: "failed",
            usage: { totalTokens: 11, cost: 0.11 },
          },
          {
            ...run,
            id: "run-two",
            status: "running",
            usage: { totalTokens: 22, cost: 0.22 },
          },
        ],
        childUsage: {
          runsTotal: 40,
          runsWithUsage: 20,
          totalTokens: 9999,
          cost: 99.99,
          failedCost: 44.44,
          failedRunsWithUsage: 10,
          byStatus: {
            succeeded: 20,
            failed: 20,
            interrupted: 0,
            running: 0,
            unknown: 0,
          },
        },
      },
    },
  });

  // Every summary figure is the DTO's, including the failed-run card.
  assert.equal(html.includes("20 of 40 runs reported usage"), true);
  assert.equal(html.includes("10 of 20 runs reported usage"), true);
  assert.equal(html.includes("9,999"), true);
  assert.equal(html.includes("$99.99"), true);
  assert.equal(html.includes("$44.44"), true);
  // The rows still render their own bounded usage.
  assert.equal(html.includes("$0.11"), true);
  assert.equal(html.includes("$0.22"), true);
  // A renderer that summed the rows would print the naive figures instead.
  assert.equal(html.includes("$0.33"), false);
  assert.equal(html.includes("2 of 2 runs reported usage"), false);
});

test("prints a grouped duration with its coverage, and Unavailable without one", () => {
  const base = currentDto();
  if (base.kind !== "current") throw new Error("the fixture is current");
  const range = base.projection.range;
  if (range === undefined) throw new Error("the fixture must carry a range");
  const html = renderSnapshot({
    ...base,
    projection: {
      ...base.projection,
      range: {
        ...range,
        toolSummary: [
          // Every call correlated: the total and the mean stand alone, with no
          // coverage note claiming otherwise.
          {
            name: "read",
            calls: 2,
            succeeded: 2,
            failed: 0,
            interrupted: 0,
            tokens: 12,
            cost: 0.12,
            withUsage: 2,
            withDuration: 2,
            durationMs: 4000,
            durationLabel: "4.0 s",
            averageLabel: "2.0 s",
            lastUsed: READ_AT,
            partial: false,
            durationPartial: false,
          },
          // Some calls correlated: the total carries its own coverage note.
          {
            name: "bash",
            calls: 3,
            succeeded: 1,
            failed: 2,
            interrupted: 0,
            tokens: 7,
            cost: 0.07,
            withUsage: 3,
            withDuration: 1,
            durationMs: 1000,
            durationLabel: "1.0 s",
            averageLabel: "1.0 s",
            lastUsed: BASH_AT,
            partial: false,
            durationPartial: true,
          },
          // No call correlated: Unavailable, never `0 ms`.
          {
            name: "grep",
            calls: 1,
            succeeded: 1,
            failed: 0,
            interrupted: 0,
            tokens: 1,
            cost: 0.01,
            withUsage: 1,
            withDuration: 0,
            durationMs: 0,
            durationLabel: null,
            averageLabel: null,
            lastUsed: READ_AT,
            partial: false,
            durationPartial: false,
          },
        ],
      },
    },
  });

  const rowFor = (name: string): string => {
    const match = new RegExp(
      `<tr>(?:(?!</tr>)[\\s\\S])*${name}(?:(?!</tr>)[\\s\\S])*</tr>`,
    ).exec(html);
    assert.notEqual(match, null, `the ${name} row must render`);
    return match?.[0] ?? "";
  };
  const coverageNote = (withDuration: number, total: number): string =>
    CATALOG["tools.durationFraction"]
      .replace("{withDuration}", String(withDuration))
      .replace("{total}", String(total));

  const read = rowFor("read");
  assert.equal(read.includes("4.0 s"), true, read);
  assert.equal(read.includes("2.0 s"), true, read);
  // Complete coverage states no fraction: the figures stand alone.
  assert.equal(read.includes(coverageNote(2, 2)), false, read);

  const bash = rowFor("bash");
  assert.equal(bash.includes("1.0 s"), true, bash);
  // An incomplete total carries its own coverage note.
  assert.equal(bash.includes(coverageNote(1, 3)), true, bash);

  const grep = rowFor("grep");
  assert.equal(grep.includes(CATALOG["evidence.unavailable"]), true, grep);
  // Nothing estimates a duration: no fabricated `0 ms` anywhere in the table.
  assert.equal(html.includes("0 ms"), false);
});

test("prints the DTO's tool-usage partiality instead of comparing row counts", () => {
  const base = currentDto();
  if (base.kind !== "current") throw new Error("the fixture is current");
  const range = base.projection.range;
  if (range === undefined) throw new Error("the fixture must carry a range");
  const html = renderSnapshot({
    ...base,
    projection: {
      ...base.projection,
      range: {
        ...range,
        // `read` reported every call but the DTO marks the row partial, and
        // `bash` reported fewer than its calls but the DTO does not: a renderer
        // comparing withUsage to calls prints the opposite of both.
        toolSummary: [
          {
            name: "read",
            calls: 2,
            succeeded: 2,
            failed: 0,
            interrupted: 0,
            tokens: 12,
            cost: 0.12,
            withUsage: 2,
            withDuration: 2,
            durationMs: 2000,
            durationLabel: "2.0 s",
            averageLabel: "1.0 s",
            lastUsed: READ_AT,
            partial: true,
            durationPartial: false,
          },
          {
            name: "bash",
            calls: 3,
            succeeded: 1,
            failed: 2,
            interrupted: 0,
            tokens: 7,
            cost: 0.07,
            withUsage: 1,
            withDuration: 1,
            durationMs: 1000,
            durationLabel: "1.0 s",
            averageLabel: "1.0 s",
            lastUsed: BASH_AT,
            partial: false,
            durationPartial: true,
          },
        ],
      },
    },
  });

  assert.equal(html.includes("2 of 2 calls reported usage"), true);
  assert.equal(html.includes("1 of 3 calls reported usage"), false);
  assert.equal(
    html.includes(
      `12 <span class="badge warn">${CATALOG["metric.knownTokens"]}</span>`,
    ),
    true,
  );
  assert.equal(
    html.includes(
      `$0.07 <span class="badge warn">${CATALOG["metric.knownCost"]}</span>`,
    ),
    false,
  );
});

test("reads its range emptiness and day count from the DTO, never from rows", () => {
  // A DTO whose published day count disagrees with the rows it carries: a
  // renderer deciding from `daily.length` renders the range-empty card instead.
  const current = currentDto();
  if (current.kind !== "current") throw new Error("the fixture is current");
  const range = current.projection.range;
  if (range === undefined) throw new Error("the fixture must carry a range");
  const currentHtml = renderSnapshot({
    ...current,
    projection: {
      ...current.projection,
      range: {
        ...range,
        daily: [],
        totals: { ...range.totals, days: 4321 },
      },
    },
  });
  assert.equal(currentHtml.includes("4,321"), true);
  assert.equal(currentHtml.includes(CATALOG["chart.empty"]), false);

  const history = historyDto();
  if (history.kind !== "history") throw new Error("the fixture is history");
  const historyHtml = renderSnapshot({
    ...history,
    projection: {
      ...history.projection,
      daily: [],
      totals: {
        ...history.projection.totals,
        totalTokens: 987654,
        cost: 9.87,
        days: 4321,
      },
    },
  });
  assert.equal(historyHtml.includes("987,654"), true);
  assert.equal(historyHtml.includes("$9.87"), true);
  assert.equal(historyHtml.includes(CATALOG["chart.empty"]), false);

  const global = globalDto();
  if (global.kind !== "global") throw new Error("the fixture is global");
  const globalHtml = renderSnapshot({
    ...global,
    projection: {
      ...global.projection,
      daily: [],
      totals: { totalTokens: 987654, cost: 9.87, days: 4321 },
    },
  });
  assert.equal(globalHtml.includes("987,654"), true);
  assert.equal(globalHtml.includes("4,321"), true);
  assert.equal(globalHtml.includes(CATALOG["chart.empty"]), false);
});

test("prints each inventory's published availability, never a row count", () => {
  const base = currentDto();
  if (base.kind !== "current") throw new Error("the fixture is current");
  // The fixture's own inventory carries one command, one skill and one source,
  // so a renderer inferring the figure from those rows prints `1` instead.
  const html = renderSnapshot({
    ...base,
    projection: {
      ...base.projection,
      inventoryAvailability: { commands: 4711, skills: 4712, resources: 4713 },
    },
  });

  assert.equal(html.includes("4,711"), true);
  assert.equal(html.includes("4,712"), true);
  assert.equal(html.includes("4,713"), true);
});

test("prints the known-but-unmaterialized parent as the orchestration run", () => {
  const base = currentDto();
  if (base.kind !== "current") throw new Error("the fixture is current");
  const view = base.projection.report;
  const range = base.projection.range;
  if (view === undefined || range === undefined) {
    throw new Error("the fixture must carry a report and a range");
  }
  const run = range.agents[0];
  if (run === undefined) throw new Error("the fixture must carry an agent row");
  const containerId = `subagent-${"b".repeat(64)}`;
  const html = renderSnapshot({
    ...base,
    projection: {
      ...base.projection,
      // The report carries no run for the parent identity: the child's parent is
      // the publishing run container, so the cell states that fact instead of
      // claiming an unavailable agent row.
      report: { ...view, agents: [] },
      range: {
        ...range,
        agents: [
          {
            ...run,
            id: `subagent-${"c".repeat(64)}`,
            parentId: containerId,
            agent: "worker",
            parent: "orchestration-run",
          },
          {
            ...run,
            id: `subagent-${"d".repeat(64)}`,
            parentId: null,
            agent: "rootless",
            parent: "none",
          },
          {
            ...run,
            id: `subagent-${"e".repeat(64)}`,
            parentId: "not-an-opaque-id",
            agent: "malformed",
            parent: "unknown",
          },
        ],
      },
    },
  });

  assert.equal(
    (
      html.match(new RegExp(CATALOG["agents.parentOrchestrationRun"], "g")) ??
      []
    ).length,
    // The hierarchy row and the flat table cell each print the verdict L2
    // published for that row: twice, and never once for another row.
    2,
  );
  assert.equal(
    (html.match(new RegExp(CATALOG["agents.parentNone"], "g")) ?? []).length,
    2,
  );
  assert.equal(
    (html.match(new RegExp(CATALOG["agents.parentUnknown"], "g")) ?? []).length,
    2,
  );
});

test("restores the skip link as the one same-document anchor", () => {
  const html = renderSnapshot(currentDto());

  assert.equal(
    html.includes('<a class="skip" href="#main">Skip to report</a>'),
    true,
  );
  assert.match(html, /<main id="main"[^>]*>/);
  const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
  assert.deepEqual(hrefs, ["#main"]);
});

test("prints L2's parent verdict instead of looking a parent up in its rows", () => {
  const base = currentDto();
  if (base.kind !== "current") throw new Error("the fixture is current");
  const view = base.projection.report;
  const range = base.projection.range;
  if (view === undefined || range === undefined) {
    throw new Error("the fixture must carry a report and a range");
  }
  const run = range.agents[0];
  const parentId = `subagent-${"b".repeat(64)}`;
  const orphanId = `subagent-${"c".repeat(64)}`;
  const html = renderSnapshot({
    ...base,
    projection: {
      ...base.projection,
      report: {
        ...view,
        // Both ids are known to the full report, so a renderer recomputing the
        // verdict from its rows prints the parent's label for the row the DTO
        // calls outside-range, and "outside selected scope" for the orphan.
        agents: [
          { ...run, id: parentId, parentId: null, agent: "parent-role" },
          { ...run, id: orphanId, parentId: null, agent: "orphan-role" },
        ],
      },
      range: {
        ...range,
        agents: [
          {
            ...run,
            id: parentId,
            parentId: null,
            agent: "parent-role",
            parent: "none",
          },
          {
            ...run,
            id: `subagent-${"d".repeat(64)}`,
            parentId,
            agent: "outside-child",
            parent: "outside-range",
          },
          {
            ...run,
            id: `subagent-${"e".repeat(64)}`,
            parentId,
            agent: "in-range-child",
            parent: "in-range",
          },
          {
            ...run,
            id: `subagent-${"f".repeat(64)}`,
            parentId: orphanId,
            agent: "orphan-child",
            parent: "unknown",
          },
        ],
      },
    },
  });

  // Each verdict is printed for exactly its own row, once by the hierarchy and
  // once by the flat table.
  assert.equal(
    (html.match(new RegExp(CATALOG["agents.parentOutsideScope"], "g")) ?? [])
      .length,
    2,
  );
  assert.equal(
    (html.match(new RegExp(CATALOG["agents.parentUnknown"], "g")) ?? []).length,
    2,
  );
  // The in-range parent's own rendered label is printed for its child too, but
  // never for the row the DTO puts outside the range: three times (the parent's
  // hierarchy row and table row, and the child's table parent cell), not four.
  assert.equal((html.match(/parent-role/g) ?? []).length, 3);
});

test("renders a child whose parent exists only outside the selected range", () => {
  const parentId = `subagent-${"b".repeat(64)}`;
  const childId = `subagent-${"c".repeat(64)}`;
  const report = toSessionReport(reduceEntries(SESSION_ID, ENTRIES), {
    agents: {
      state: "supported",
      runs: [
        {
          id: parentId,
          agent: "parent-role",
          status: "succeeded",
          confidence: "cooperative",
          observedAt: "2026-03-01T10:00:00.000Z",
        },
        {
          id: childId,
          parentId,
          agent: "child-role",
          status: "succeeded",
          confidence: "cooperative",
          observedAt: "2026-03-10T10:00:00.000Z",
        },
      ],
    },
  });
  // The 7-day preset anchors on 2026-03-10, so only the child's own day is a
  // selected row while the full report still knows the parent: the verdict is
  // L2's range membership answer, rendered from the DTO.
  const dto: SnapshotDto = {
    kind: "current",
    schemaVersion: 1,
    theme: "light",
    projection: projectCurrentView(
      {
        availability: "available",
        report,
        daily: DAILY_ROWS,
        dailyTruncated: false,
        datedModels: DATED_MODELS,
        modelsTruncated: false,
      },
      "tree",
      PRESET_7,
    ),
  };
  const html = renderSnapshot(dto);

  assert.equal(html.includes(CATALOG["agents.parentOutsideScope"]), true);
  assert.equal(html.includes("child-role"), true);
  // The parent's own row is outside the selection, so it is never rendered.
  assert.equal(html.includes("parent-role"), false);
});

test("prints Unavailable, never a zero, for a row with no published usage", () => {
  const base = currentDto();
  if (base.kind !== "current") throw new Error("the fixture is current");
  const range = base.projection.range;
  if (range === undefined) throw new Error("the fixture must carry a range");
  // One tool call whose result persisted no usage at all: the DTO publishes the
  // zero-count verdict with no figure, and the row must state the catalog's
  // Unavailable rather than a fabricated `0`/`$0.00`.
  const html = renderSnapshot({
    ...base,
    projection: {
      ...base.projection,
      range: {
        ...range,
        toolSummary: [
          {
            name: "bash",
            calls: 1,
            succeeded: 0,
            failed: 1,
            interrupted: 0,
            tokens: 0,
            cost: 0,
            withUsage: 0,
            withDuration: 0,
            durationMs: 0,
            durationLabel: null,
            averageLabel: null,
            lastUsed: BASH_AT,
            partial: false,
            durationPartial: false,
          },
        ],
        toolCalls: [
          {
            id: "tool:call_bash",
            name: "bash",
            timestamp: BASH_AT,
            status: "failed",
            usage: null,
            durationMs: null,
            durationLabel: null,
          },
        ],
      },
    },
  });
  const summaryRow =
    /<tr>(?:(?!<\/tr>)[\s\S])*bash(?:(?!<\/tr>)[\s\S])*<\/tr>/.exec(html);
  assert.notEqual(summaryRow, null, "the tool row must render");
  const cells = summaryRow?.[0] ?? "";
  // Tokens, cost and the absent source label are all Unavailable rather than a
  // fabricated `0` / `$0.00` / empty cell.
  assert.equal(
    cells.split(CATALOG["evidence.unavailable"]).length - 1 >= 3,
    true,
    cells,
  );
  assert.equal(cells.includes("$0.00"), false, cells);
  // Duration is live-correlated evidence only: without it the cell is
  // Unavailable, never an estimated `0 ms`.
  assert.equal(html.includes("0 ms"), false);
});

// ---------------------------------------------------------------------------
// The static execution hierarchy (ADR 0018: no JavaScript, so no disclosure)
// ---------------------------------------------------------------------------

/**
 * The markup of one card, so a count is scoped to it: from the card's own title
 * to the next card's title, because a card holds nested `section` elements (its
 * metrics) and a `</section>` slice would stop inside one of them.
 */
function cardOf(html: string, title: string): string {
  const start = html.indexOf(`<h2>${title}</h2>`);
  if (start < 0) throw new Error(`no card titled ${title}`);
  const end = html.indexOf("<h2>", start + 1);
  return html.slice(start, end < 0 ? html.length : end);
}

/** One agent run row of the snapshot, with the fields a test varies. */
function runRow(input: {
  id: string;
  parentId?: string | null;
  parent?: UiAgentRow["parent"];
  agent?: string;
  status?: UiAgentRow["status"];
  model?: string | null;
  thinking?: string | null;
  artifacts?: UiAgentRow["artifacts"];
  tokens?: number | null;
  cost?: number | null;
}): UiAgentRow {
  const tokens = input.tokens === undefined ? null : input.tokens;
  const cost = input.cost === undefined ? null : input.cost;
  return {
    id: input.id,
    parentId: input.parentId ?? null,
    agent: input.agent ?? "worker",
    status: input.status ?? "succeeded",
    confidence: "cooperative",
    artifacts: input.artifacts ?? null,
    observedAt: null,
    evidenceToolId: null,
    model: input.model === undefined ? null : input.model,
    thinking: input.thinking === undefined ? null : input.thinking,
    failure: null,
    usage:
      tokens === null && cost === null
        ? null
        : { totalTokens: tokens ?? 0, cost: cost ?? 0 },
    parent: input.parent ?? "none",
  };
}

/** The current-session DTO whose agent rows are exactly these runs. */
function agentsDto(rows: readonly UiAgentRow[]): SnapshotDto {
  const base = currentDto();
  if (base.kind !== "current") throw new Error("the fixture is current");
  const range = base.projection.range;
  if (range === undefined) throw new Error("the fixture must carry a range");
  const byStatus = {
    succeeded: 0,
    failed: 0,
    interrupted: 0,
    running: 0,
    unknown: 0,
  };
  let withUsage = 0;
  for (const row of rows) {
    byStatus[row.status] += 1;
    if (row.usage !== null) withUsage += 1;
  }
  return {
    ...base,
    projection: {
      ...base.projection,
      range: {
        ...range,
        agents: [...rows],
        childUsage: {
          runsTotal: rows.length,
          runsWithUsage: withUsage,
          totalTokens: null,
          cost: null,
          failedCost: null,
          failedRunsWithUsage: 0,
          byStatus,
        },
      },
    },
  };
}

test("renders the execution hierarchy expanded, with no control to imitate disclosure", () => {
  const parentId = `subagent-${"1".repeat(64)}`;
  const childId = `subagent-${"2".repeat(64)}`;
  const html = renderSnapshot(
    agentsDto([
      runRow({ id: parentId, agent: "reviewer", model: "alpha" }),
      runRow({
        id: childId,
        agent: "scout",
        parentId,
        parent: "in-range",
        model: "alpha",
        thinking: "high",
        tokens: 34_477,
        cost: 0.004893924,
      }),
    ]),
  );
  const card = cardOf(html, CATALOG["tab.agents"]);
  // The session root, its own figures, and the one model the range published.
  assert.equal(card.includes(CATALOG["agents.tree.session"]), true);
  assert.equal(card.includes("alpha · 1 generation"), true);
  assert.equal(card.includes("$0.02"), true);
  // The child is nested inside its parent's own list, and both stay expanded:
  // a static document offers no button, no aria-expanded, and no collapse.
  const outer = card.indexOf(`>reviewer<`);
  const nested = card.indexOf(`>scout<`);
  assert.equal(outer >= 0 && nested > outer, true);
  assert.equal(card.includes("tree-children"), true);
  assert.equal(card.includes("aria-expanded"), false);
  assert.equal(card.includes("<button"), false);
  // A child states its own model evidence and honest small cost.
  assert.equal(card.includes("alpha · high · 34,477 tokens · $0.0049"), true);
  assert.equal(/\$0\.00(?!\d)/.test(card), false);
});

test("groups one container's children and never words the container as an agent", () => {
  const containerId = `subagent-${"3".repeat(64)}`;
  const html = renderSnapshot(
    agentsDto([
      runRow({
        id: `subagent-${"4".repeat(64)}`,
        agent: "reviewer",
        parentId: containerId,
        parent: "orchestration-run",
      }),
      runRow({
        id: `subagent-${"5".repeat(64)}`,
        agent: "worker",
        parentId: containerId,
        parent: "orchestration-run",
        status: "failed",
      }),
      runRow({
        id: `subagent-${"6".repeat(64)}`,
        agent: "scout",
        parentId: containerId,
        parent: "orchestration-run",
      }),
    ]),
  );
  const card = cardOf(html, CATALOG["tab.agents"]);
  assert.equal(card.includes(CATALOG["agents.tree.container"]), true);
  assert.equal(card.includes(CATALOG["agents.tree.container.note"]), true);
  assert.equal(card.includes("3 children · 1 failed"), true);
  // The container is a group: it carries no agent identity, no status, and the
  // producer's own container identity is never printed.
  assert.equal(
    card.includes(
      `<span class="tree-group">${CATALOG["agents.tree.container"]}</span>`,
    ),
    true,
  );
  assert.equal(
    (card.match(new RegExp(CATALOG["agents.tree.container"], "g")) ?? [])
      .length,
    1,
  );
  assert.equal(card.includes(containerId), false);
  assert.equal(
    (
      card.match(new RegExp(CATALOG["agents.parentOrchestrationRun"], "g")) ??
      []
    ).length,
    3,
  );
});

test("flattens a container around a single child and keeps its verdict wording", () => {
  const containerId = `subagent-${"7".repeat(64)}`;
  const html = renderSnapshot(
    agentsDto([
      runRow({
        id: `subagent-${"8".repeat(64)}`,
        agent: "worker",
        parentId: containerId,
        parent: "orchestration-run",
      }),
    ]),
  );
  const card = cardOf(html, CATALOG["tab.agents"]);
  assert.equal(card.includes(CATALOG["agents.tree.container"]), false);
  assert.equal(card.includes(CATALOG["agents.parentOrchestrationRun"]), true);
  assert.equal(card.includes(containerId), false);
});

test("keeps partial child usage and an unavailable model stated in the hierarchy", () => {
  const html = renderSnapshot(
    agentsDto([
      runRow({ id: `subagent-${"9".repeat(64)}`, agent: "reviewer" }),
      runRow({
        id: `subagent-${"a".repeat(64)}`,
        agent: "scout",
        tokens: 5,
        cost: 0.01,
        artifacts: "missing",
      }),
    ]),
  );
  const card = cardOf(html, CATALOG["tab.agents"]);
  assert.equal(card.includes(CATALOG["agents.tree.usageUnavailable"]), true);
  assert.equal(card.includes(CATALOG["evidence.unavailable"]), true);
  assert.equal(card.includes(`${CATALOG["table.artifacts"]}: missing`), true);
  // The coverage fraction is L2's own figure, and a known run's own figures are
  // printed without being added to anything.
  assert.equal(
    card.includes(
      CATALOG["agents.usageFraction"]
        .replace("{withUsage}", "1")
        .replace("{total}", "2"),
    ),
    true,
  );
});

test("a partial or capped session root states what it cannot complete", () => {
  const truncated = agentsDto([
    runRow({ id: `subagent-${"b".repeat(64)}`, agent: "worker" }),
  ]);
  if (truncated.kind !== "current") throw new Error("the fixture is current");
  const range = truncated.projection.range;
  if (range === undefined) throw new Error("the fixture must carry a range");
  const partialHtml = renderSnapshot({
    ...truncated,
    projection: {
      ...truncated.projection,
      range: { ...range, truncated: true, modelsTruncated: true },
    },
  });
  const partial = cardOf(partialHtml, CATALOG["tab.agents"]);
  // A partial range's figures are named as known, exactly as the Overview
  // cards name them, and a capped model list claims no model count.
  assert.equal(partial.includes(`${CATALOG["metric.knownTokens"]}: 120`), true);
  assert.equal(partial.includes(`${CATALOG["metric.knownCost"]}: $0.02`), true);
  // One model was listed and the list is capped, so no count of models that ran
  // is claimed, and the singular reads correctly.
  assert.equal(partial.includes("1 model used"), false);
  assert.equal(partial.includes("1 models listed"), false);
  assert.equal(partial.includes("1 model listed"), true);
  assert.equal(partial.includes("1 generations"), false);
  assert.equal(partial.includes("1 generation ·"), true);
  assert.equal(
    partial.includes(escapeSnapshotText(CATALOG["models.truncated"])),
    true,
  );

  // An unresolved range has no figures at all: no figure is a fabricated zero.
  const unresolved = renderSnapshot({
    ...truncated,
    projection: {
      ...truncated.projection,
      range: {
        ...range,
        resolved: null,
        totals: { totalTokens: 0, cost: 0, generations: 0, tools: 0, days: 0 },
      },
    },
  });
  const root = cardOf(unresolved, CATALOG["tab.agents"]);
  assert.equal(root.includes(CATALOG["agents.tree.session"]), true);
  assert.equal(/\$0\.00(?!\d)/.test(root), false);
  assert.equal(root.includes("0 generations"), false);
  assert.equal(
    root.includes(`alpha · ${CATALOG["evidence.unavailable"]}`),
    false,
  );
});

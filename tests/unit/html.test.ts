import assert from "node:assert/strict";
import { test } from "node:test";

import type { SessionReport } from "../../src/core/reports.ts";
import {
  ENGLISH_CATALOG,
  renderHtml,
  type HtmlReport,
} from "../../src/ui/html.ts";

const report: SessionReport = {
  sessionId: "session-safe",
  usage: { totalTokens: 42, cost: 0.01 },
  models: [
    {
      provider: "provider-safe",
      model: "model-safe",
      generations: 1,
      totalTokens: 42,
      cost: 0.01,
    },
  ],
  tools: [],
  compactions: [],
  generations: [],
  agents: [],
  agentEvidence: "unavailable",
  integrations: [],
};

const current: HtmlReport = { kind: "current", report, scope: "active" };

test("renders a self-contained offline current report with restrictive CSP", () => {
  const html = renderHtml(current);

  assert.match(
    html,
    /Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"/,
  );
  assert.match(html, /Local does not mean safe to share\./);
  assert.match(html, /Pi Session Inspector/);
  assert.equal(/https?:\/\//.test(html), false);
  assert.equal(/<link\b|<img\b|src=["']/.test(html), false);
  assert.match(html, /type="application\/json" id="report-data"/);
});

test("escapes hostile report strings before inline JSON and DOM rendering", () => {
  const hostile: HtmlReport = {
    kind: "current",
    scope: "tree",
    report: {
      ...report,
      sessionId: "</script><img src=x onerror=alert(1)>",
      models: [
        {
          ...report.models[0],
          provider: "line\u2028separator",
          model: "</script><b>hostile</b>",
        },
      ],
    },
  };

  const html = renderHtml(hostile);
  assert.equal(html.includes("</script><img"), false);
  assert.equal(html.includes("</script><b>"), false);
  assert.equal(html.includes("\\u003c/script\\u003e"), true);
  assert.equal(html.includes("\\u2028"), true);
});

test("does not render source locators or raw content from DTO-like extras", () => {
  const unsafe = {
    ...current,
    sourceFile: "/private/source/session.jsonl",
    prompt: "do not copy this prompt",
    report: { ...report, rawResult: "do not copy this result" },
  } as HtmlReport;

  const html = renderHtml(unsafe);
  assert.equal(html.includes("/private/source/session.jsonl"), false);
  assert.equal(html.includes("do not copy this prompt"), false);
  assert.equal(html.includes("do not copy this result"), false);
});

test("projects compaction and lazy ledger evidence without raw extras", () => {
  const withCompaction = {
    ...report,
    compactions: [
      {
        id: "compaction-safe",
        timestamp: "2026-09-07T00:00:00.000Z",
        usage: { totalTokens: 4, cost: 0.01 },
        rawResult: "do not render compaction body",
      },
    ],
  } as unknown as SessionReport;

  const html = renderHtml({
    kind: "current",
    scope: "active",
    report: withCompaction,
  });
  assert.match(html, /compaction-safe/);
  assert.match(html, /function ledger\(report\)/);
  assert.equal(html.includes("do not render compaction body"), false);
});

test("surfaces expired WAL detail in the safe projection and visible notice", () => {
  const expired: HtmlReport = {
    kind: "current",
    scope: "tree",
    report: { ...report, walDetail: "expired" },
  };
  const html = renderHtml(expired);

  assert.match(html, /id="wal-detail"/);
  assert.match(
    html,
    /data\.kind==="current"&&data\.report\.walDetail==="expired"/,
  );
  assert.match(html, /"walDetail":"expired"/);
});

test("omits the expired WAL detail field when detail is present", () => {
  const html = renderHtml(current);
  assert.equal(html.includes('"walDetail":"expired"'), false);
});

test("accepts history and global shared DTOs without loading storage", () => {
  const history: HtmlReport = {
    kind: "history",
    report: {
      availability: "available",
      sessions: [{ availability: "unavailable", sessionId: "session-history" }],
      diagnostics: [],
    },
  };
  const global: HtmlReport = {
    kind: "global",
    report: {
      availability: "available",
      sessions: [{ availability: "available", sessionId: "session-global" }],
      usage: { totalTokens: 42, cost: 0.01 },
      dates: [
        {
          date: "2026-09-07",
          sessions: 1,
          usage: { totalTokens: 42, cost: 0.01 },
        },
      ],
      diagnostics: [],
    },
  };

  assert.match(renderHtml(history), /session-history/);
  assert.match(renderHtml(global), /2026-09-07/);
});

test("preserves the approved overview and interactive report structure", () => {
  const html = renderHtml(current);

  for (const fragment of [
    'id="time-range"',
    'id="date-dialog"',
    'id="search"',
    'id="sort"',
    'id="chart-metric"',
    '"breakdown"',
    "Model cost",
    "Tool activity",
    "Evidence, not estimates.",
    'id="announcement"',
    'data-days="7"',
    'data-days="14"',
    'data-days="30"',
  ]) {
    assert.equal(html.includes(fragment), true, fragment);
  }
});

test("embeds deterministic current, history, and global view contracts", () => {
  const second = renderHtml(current);
  assert.equal(renderHtml(current), second);

  const history: HtmlReport = {
    kind: "history",
    report: {
      availability: "available",
      sessions: [{ availability: "available", sessionId: "history-a", report }],
      diagnostics: [],
    },
  };
  const global: HtmlReport = {
    kind: "global",
    report: {
      availability: "available",
      sessions: [{ availability: "available", sessionId: "history-a" }],
      usage: report.usage,
      dates: [{ date: "2026-09-07", sessions: 1, usage: report.usage }],
      diagnostics: [],
    },
  };

  assert.match(renderHtml(history), /"kind":"history"/);
  assert.match(renderHtml(global), /"kind":"global"/);
  assert.match(renderHtml(global), /selectedDays\(\)/);
  assert.match(renderHtml(current), /state\.query/);
  assert.match(renderHtml(current), /state\.sort/);
  assert.match(renderHtml(current), /state\.metric/);
});

test("defaults global HTML to fourteen calendar days ending at the latest UTC activity", () => {
  const global: Extract<HtmlReport, { kind: "global" }> = {
    kind: "global",
    report: {
      availability: "available",
      sessions: [],
      usage: { totalTokens: 2, cost: 0.02 },
      dates: [
        {
          date: "2026-01-01",
          sessions: 1,
          usage: { totalTokens: 1, cost: 0.01 },
        },
        {
          date: "2026-01-20",
          sessions: 1,
          usage: { totalTokens: 1, cost: 0.01 },
        },
      ],
      diagnostics: [],
    },
  };
  const source = renderHtml(global).match(
    /function initialPeriod\(\)\{[\s\S]*?\nfunction days/,
  );
  assert.notEqual(source, null);
  const initialPeriod = new Function(
    "days",
    `${source?.[0].replace("\nfunction days", "")};return initialPeriod();`,
  ) as (days: () => typeof global.report.dates) => {
    preset: number;
    from: string;
    to: string;
  };

  assert.deepEqual(
    initialPeriod(() => global.report.dates),
    {
      preset: 14,
      from: "2026-01-07",
      to: "2026-01-20",
    },
  );
});

test("offers daily sessions, cost, and token chart metrics for global reports", () => {
  const global: HtmlReport = {
    kind: "global",
    report: {
      availability: "available",
      sessions: [],
      usage: { totalTokens: 42, cost: 0.01 },
      dates: [
        {
          date: "2026-09-07",
          sessions: 1,
          usage: { totalTokens: 42, cost: 0.01 },
        },
      ],
      diagnostics: [],
    },
  };
  const html = renderHtml(global);

  assert.match(
    html,
    /\[\["sessions","chart\.sessions"\],\["cost","chart\.cost"\],\["tokens","chart\.tokens"\]\]/,
  );
  assert.match(html, /state\.metric==="sessions"\?row\.sessions/);
  assert.match(html, /\["Date","Sessions","Tokens","Cost \(USD\)"\]/);
});

test("does not offer unsupported daily generation or tool-call chart metrics", () => {
  const global: HtmlReport = {
    kind: "global",
    report: {
      availability: "available",
      sessions: [],
      usage: { totalTokens: 42, cost: 0.01 },
      dates: [
        {
          date: "2026-09-07",
          sessions: 1,
          usage: { totalTokens: 42, cost: 0.01 },
        },
      ],
      diagnostics: [],
    },
  };
  const html = renderHtml(global);

  assert.equal(html.includes('["generations","metric.generations"]'), false);
  assert.equal(html.includes('["tools","metric.tools"]'), false);
});

test("hides unsupported history controls and preserves canonical ledger ordering", () => {
  const history: HtmlReport = {
    kind: "history",
    report: {
      availability: "available",
      sessions: [],
      diagnostics: [],
    },
  };
  const html = renderHtml(history);

  assert.match(html, /q\("time-range"\)\.hidden=state\.range!=="global"/);
  assert.match(html, /tabsNode\.hidden=state\.range==="history"/);
  assert.match(
    html,
    /sort\(\(a,b\)=>text\(a\[0\]\)\.localeCompare\(text\(b\[0\]\)\)\|\|text\(a\[1\]\)\.localeCompare\(text\(b\[1\]\)\)\)/,
  );
});

test("catalog contains visible report vocabulary", () => {
  for (const key of [
    "brand.tagline",
    "local.design",
    "metric.child",
    "table.source",
    "ledger.materialized",
    "chart.data",
    "walDetail.expired",
    "walDetail.copy",
  ]) {
    assert.equal(
      typeof ENGLISH_CATALOG[key as keyof typeof ENGLISH_CATALOG],
      "string",
    );
  }
});

test("ships the English catalog used by report labels", () => {
  assert.equal(ENGLISH_CATALOG["report.title"], "Pi Session Inspector");
  assert.equal(ENGLISH_CATALOG["nav.current"], "Current session");
  assert.equal(
    ENGLISH_CATALOG["notice.sensitive"],
    "Local does not mean safe to share.",
  );
  assert.equal(ENGLISH_CATALOG["evidence.unavailable"], "Unavailable");
});

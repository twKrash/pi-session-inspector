import assert from "node:assert/strict";
import { test } from "node:test";

import { buildLedger } from "../../src/core/ledger.ts";
import { reduceEntries } from "../../src/core/reduce.ts";
import { type SessionReport, toSessionReport } from "../../src/core/reports.ts";
import {
  buildDailyActivityRows,
  type DailyActivityRow,
  defaultReportPeriod,
  ENGLISH_CATALOG,
  formatDuration,
  type HtmlReport,
  renderHtml,
  sessionSpanMs,
} from "../../src/ui/html.ts";

const zeroUsage = { totalTokens: 0, cost: 0 };

const report: SessionReport = {
  sessionId: "session-safe",
  usage: {
    totalTokens: 42,
    cost: 0.01,
    inputTokens: 30,
    outputTokens: 12,
    cacheReadTokens: 5,
    cacheWriteTokens: 2,
  },
  usageComposition: {
    generations: {
      totalTokens: 30,
      cost: 0.01,
      inputTokens: 20,
      outputTokens: 8,
      cacheReadTokens: 5,
      cacheWriteTokens: 2,
    },
    toolResults: {
      totalTokens: 10,
      cost: 0,
      inputTokens: 8,
      outputTokens: 2,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    compactions: { totalTokens: 2, cost: 0 },
    branchSummaries: { ...zeroUsage },
  },
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
  agentActivity: {
    state: "unavailable",
    calls: 0,
    succeeded: 0,
    failed: 0,
    interrupted: 0,
    tools: [],
  },
  integrations: [],
  durationEvidence: "unavailable",
  commands: { state: "unavailable", items: [], count: null },
  skills: {
    state: "unavailable",
    items: [],
    invocationState: "unavailable",
    invocationCount: null,
    otherInvocations: null,
  },
  resources: { state: "unavailable", items: [] },
  errors: [],
};

/** Cross-day session with tokens, tools, errors, child runs, and live timing. */
const richReport: SessionReport = {
  sessionId: "session-rich",
  usage: {
    totalTokens: 42,
    cost: 0.01,
    inputTokens: 30,
    outputTokens: 12,
    cacheReadTokens: 5,
    cacheWriteTokens: 2,
  },
  usageComposition: {
    generations: {
      totalTokens: 30,
      cost: 0.01,
      inputTokens: 20,
      outputTokens: 8,
      cacheReadTokens: 5,
      cacheWriteTokens: 2,
    },
    toolResults: {
      totalTokens: 10,
      cost: 0,
      inputTokens: 8,
      outputTokens: 2,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    compactions: { totalTokens: 2, cost: 0 },
    branchSummaries: { ...zeroUsage },
  },
  models: [
    {
      provider: "acme",
      model: "alpha",
      generations: 2,
      totalTokens: 30,
      cost: 0.01,
    },
  ],
  tools: [
    {
      id: "tool:call-a",
      timestamp: "2026-09-07T00:00:01.000Z",
      name: "read",
      status: "succeeded",
      usage: { totalTokens: 10, cost: 0 },
      durationMs: 42,
    },
    {
      id: "tool:call-b",
      timestamp: "2026-09-06T23:59:57.000Z",
      name: "bash",
      status: "failed",
    },
  ],
  compactions: [
    {
      id: "compaction:c1",
      timestamp: "2026-09-07T00:00:04.000Z",
      kind: "compaction",
      usage: { totalTokens: 2, cost: 0 },
    },
    {
      id: "compaction:b1",
      timestamp: "2026-09-06T23:59:56.000Z",
      kind: "branch_summary",
      usage: { ...zeroUsage },
    },
  ],
  generations: [
    {
      id: "generation:g1",
      timestamp: "2026-09-06T23:59:55.000Z",
      provider: "acme",
      model: "alpha",
      usage: {
        totalTokens: 10,
        cost: 0.005,
        inputTokens: 8,
        outputTokens: 2,
        cacheReadTokens: 1,
        cacheWriteTokens: 1,
      },
    },
    {
      id: "generation:g2",
      timestamp: "2026-09-07T00:00:00.000Z",
      provider: "acme",
      model: "alpha",
      usage: {
        totalTokens: 20,
        cost: 0.005,
        inputTokens: 12,
        outputTokens: 6,
        cacheReadTokens: 4,
        cacheWriteTokens: 1,
      },
    },
  ],
  agents: [
    {
      id: "subagent-0123456789abcdef",
      status: "succeeded",
      confidence: "cooperative",
      usage: { totalTokens: 7, cost: 0.02 },
    },
  ],
  agentEvidence: "supported",
  agentActivity: {
    state: "unavailable",
    calls: 0,
    succeeded: 0,
    failed: 0,
    interrupted: 0,
    tools: [],
  },
  integrations: [
    {
      integration: "context",
      presence: "unknown",
      version: 1,
      state: "supported",
      counters: { calls: 2 },
    },
  ],
  durationEvidence: "supported",
  commands: { state: "unavailable", items: [], count: null },
  skills: {
    state: "unavailable",
    items: [],
    invocationState: "unavailable",
    invocationCount: null,
    otherInvocations: null,
  },
  resources: { state: "unavailable", items: [] },
  errors: [
    {
      id: "tool:call-b",
      timestamp: "2026-09-06T23:59:57.000Z",
      kind: "tool-error",
      confidence: "native",
    },
  ],
};

const current: HtmlReport = { kind: "current", report, scope: "active" };

const richCurrent: HtmlReport = {
  kind: "current",
  report: richReport,
  scope: "tree",
};

function historyReport(session: SessionReport = richReport): HtmlReport {
  return {
    kind: "history",
    report: {
      availability: "available",
      sessions: [
        {
          availability: "available",
          sessionId: session.sessionId,
          report: session,
        },
        { availability: "unavailable", sessionId: "session-missing" },
      ],
      diagnostics: [],
    },
  };
}

function globalReport(): HtmlReport {
  return {
    kind: "global",
    report: {
      availability: "available",
      sessions: [
        { availability: "available", sessionId: "session-rich" },
        { availability: "unavailable", sessionId: "session-missing" },
      ],
      usage: { totalTokens: 84, cost: 0.02 },
      dates: [
        {
          date: "2026-09-06",
          sessions: 1,
          usage: { totalTokens: 42, cost: 0.01 },
        },
        {
          date: "2026-09-07",
          sessions: 1,
          usage: { totalTokens: 42, cost: 0.01 },
        },
      ],
      diagnostics: [],
      inventory: { commands: null, skills: null, resources: null },
    },
  };
}

// biome-ignore lint/suspicious/noExplicitAny: decoding the report's embedded JSON in tests
function embedded(html: string): Record<string, any> {
  const match =
    /<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/.exec(
      html,
    );
  assert.notEqual(match, null);
  return JSON.parse(match?.[1] ?? "{}");
}

function scriptOf(html: string): string {
  const match = /<script>\n([\s\S]*?)\n<\/script><\/body>/.exec(html);
  assert.notEqual(match, null);
  return match?.[1] ?? "";
}

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

test("projects compaction and shared ledger evidence without raw extras", () => {
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
  const data = embedded(html);
  assert.match(html, /compaction-safe/);
  assert.deepEqual(
    data.current.active.report.ledger,
    buildLedger(withCompaction),
  );
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
  assert.match(html, /data\.walDetail==="expired"/);
  assert.match(html, /"walDetail":"expired"/);
});

test("omits the expired WAL detail field when detail is present", () => {
  const html = renderHtml(current);
  assert.equal(html.includes('"walDetail":"expired"'), false);
});

test("accepts history and global shared DTOs without loading storage", () => {
  assert.match(renderHtml(historyReport()), /session-rich/);
  assert.match(renderHtml(globalReport()), /2026-09-07/);
});

test("preserves the approved overview and interactive report structure", () => {
  const html = renderHtml(richCurrent);

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
  assert.equal(renderHtml(richCurrent), renderHtml(richCurrent));

  const history = renderHtml(historyReport());
  const global = renderHtml(globalReport());

  // One shared bundle payload now backs every kind; the requested section is
  // populated and the others are explicit unavailable sections.
  assert.match(renderHtml(current), /"kind":"bundle"/);
  assert.match(history, /"history":\{/);
  assert.match(global, /"global":\{/);
  for (const html of [renderHtml(current), history, global]) {
    const script = scriptOf(html);
    assert.match(script, /selectedDays\(\)/);
    assert.match(script, /state\.query/);
    assert.match(script, /state\.sort/);
    assert.match(script, /state\.metric/);
  }
});

test("defaults report ranges to inclusive UTC dates without a machine clock", () => {
  const daily: DailyActivityRow[] = [
    { date: "2026-01-01", sessions: 1, totalTokens: 1, cost: 0.01 },
    { date: "2026-01-20", sessions: 1, totalTokens: 1, cost: 0.01 },
  ];

  assert.deepEqual(defaultReportPeriod("global", daily), {
    preset: 14,
    from: "2026-01-07",
    to: "2026-01-20",
  });
  assert.deepEqual(defaultReportPeriod("history", daily), {
    preset: 14,
    from: "2026-01-07",
    to: "2026-01-20",
  });
  assert.deepEqual(defaultReportPeriod("current", daily), {
    preset: null,
    from: "2026-01-01",
    to: "2026-01-20",
  });
  assert.deepEqual(defaultReportPeriod("global", []), {
    preset: 14,
    from: "1970-01-01",
    to: "1970-01-01",
  });

  const data = embedded(renderHtml(globalReport()));
  assert.deepEqual(data.global.period, {
    preset: 14,
    from: "2026-08-25",
    to: "2026-09-07",
  });
  assert.equal(data.global.latestDate, "2026-09-07");

  const script = scriptOf(renderHtml(globalReport()));
  assert.equal(/Date\.now|Math\.random|new Date\(\)/.test(script), false);
});

test("computes daily activity rows in TypeScript for every report kind", () => {
  assert.deepEqual(buildDailyActivityRows([richReport]), [
    {
      date: "2026-09-06",
      sessions: 1,
      totalTokens: 10,
      cost: 0.005,
      generations: 1,
      tools: 1,
    },
    {
      date: "2026-09-07",
      sessions: 1,
      totalTokens: 32,
      cost: 0.005,
      generations: 1,
      tools: 1,
    },
  ]);

  const currentData = embedded(renderHtml(richCurrent));
  assert.deepEqual(
    currentData.current.tree.daily,
    buildDailyActivityRows([richReport]),
  );

  const historyData = embedded(renderHtml(historyReport()));
  assert.deepEqual(
    historyData.history.daily,
    buildDailyActivityRows([richReport]),
  );

  const globalData = embedded(renderHtml(globalReport()));
  assert.deepEqual(globalData.global.daily, [
    { date: "2026-09-06", sessions: 1, totalTokens: 42, cost: 0.01 },
    { date: "2026-09-07", sessions: 1, totalTokens: 42, cost: 0.01 },
  ]);

  // The browser filters pre-built daily rows; it never walks report records.
  const script = scriptOf(renderHtml(richCurrent));
  assert.match(
    script,
    /function selectedDays\(\)\{return activeDaily\(\)\.filter\(row=>row\.date>=period\(\)\.from&&row\.date<=period\(\)\.to\);\}/,
  );
  assert.equal(
    /data\.(report\.)?(generations|tools|compactions)\b/.test(script),
    false,
  );
});

test("renders the daily activity line chart for every report kind", () => {
  const currentHtml = renderHtml(richCurrent);
  const historyHtml = renderHtml(historyReport());
  const globalHtml = renderHtml(globalReport());

  for (const html of [currentHtml, historyHtml, globalHtml]) {
    const script = scriptOf(html);
    assert.match(script, /function chart\(\)\{/);
    assert.equal(script.includes("nodes.push(chart())"), true);
    // One call site per report path: global, history list, history detail, current.
    assert.equal((script.match(/nodes\.push\(chart\(\)\)/g) ?? []).length, 4);
    assert.match(script, /id="chart-metric"/);
    assert.match(script, /tr\("chart\.data"\)/);
  }

  const data = embedded(currentHtml);
  assert.equal(data.current.tree.daily.length, 2);
  // Current metrics are the fixed session metric set the client runtime ships.
  const script = scriptOf(currentHtml);
  assert.match(
    script,
    /const CURRENT_METRICS=\["sessions","cost","tokens","generations","tools"\]/,
  );
  // History and global carry their metric choices in the payload itself.
  assert.deepEqual(embedded(historyHtml).history.chartMetrics, [
    "sessions",
    "cost",
    "tokens",
    "generations",
    "tools",
  ]);
  assert.deepEqual(embedded(globalHtml).global.chartMetrics, [
    "sessions",
    "cost",
    "tokens",
  ]);
  const globalScript = scriptOf(globalHtml);
  assert.equal(
    globalScript.includes('["generations","metric.generations"]'),
    false,
  );
});

test("precomputes per-tab rows instead of re-deriving them in the browser", () => {
  const data = embedded(renderHtml(richCurrent));
  const view = data.current.tree.report;

  assert.deepEqual(view.models, [
    {
      provider: "acme",
      model: "alpha",
      generations: 2,
      totalTokens: 30,
      cost: 0.01,
      inputTokens: 20,
      outputTokens: 8,
      cacheReadTokens: 5,
      cacheWriteTokens: 2,
    },
  ]);
  assert.deepEqual(view.modelBars, [
    { label: "acme/alpha", value: "$0.01", percent: 100 },
  ]);
  assert.deepEqual(view.tools, [
    {
      id: "tool:call-a",
      name: "read",
      status: "succeeded",
      usage: { totalTokens: 10, cost: 0 },
      durationMs: 42,
      durationLabel: "42 ms",
    },
    {
      id: "tool:call-b",
      name: "bash",
      status: "failed",
      usage: null,
      durationMs: null,
      durationLabel: null,
    },
  ]);
  assert.deepEqual(view.toolBars, [
    { label: "bash", value: "1 calls", percent: 50 },
    { label: "read", value: "1 calls", percent: 50 },
  ]);
  assert.deepEqual(view.errors, richReport.errors);
  assert.deepEqual(view.ledger, buildLedger(richReport));
  assert.deepEqual(view.agents, [
    {
      id: "subagent-0123456789abcdef",
      parentId: null,
      status: "succeeded",
      confidence: "cooperative",
      usage: { totalTokens: 7, cost: 0.02 },
    },
  ]);
  assert.deepEqual(view.integrations, [
    {
      integration: "context",
      presence: "unknown",
      version: 1,
      state: "supported",
      counters: ["calls: 2"],
    },
  ]);

  const script = scriptOf(renderHtml(richCurrent));
  for (const tab of [
    "models",
    "tools",
    "commands",
    "agents",
    "skills",
    "integrations",
    "errors",
    "ledger",
  ]) {
    assert.equal(
      script.includes(`state.tab==="${tab}"`),
      true,
      `missing tab branch: ${tab}`,
    );
  }
  assert.equal(script.includes('tr("unavailable.commands")'), true);
  assert.equal(script.includes('tr("unavailable.skills")'), true);
  assert.equal(script.includes('tr("unavailable.global")'), true);
  assert.match(
    script,
    /view\.ledger\.map\(item=>\[item\.timestamp,item\.id,item\.kind,item\.status,item\.confidence\]\)/,
  );
  assert.equal(script.includes("buildLedger"), false);
});

test("renders a tool result without usage as Unavailable instead of zero", () => {
  const report = toSessionReport(
    reduceEntries("session-no-tool-usage", [
      {
        type: "message",
        id: "generation",
        parentId: null,
        timestamp: "2026-09-07T00:00:00.000Z",
        message: {
          role: "assistant",
          provider: "provider",
          model: "model",
          content: [{ type: "toolCall", id: "call-a", name: "read" }],
          usage: { totalTokens: 4, cost: { total: 0.004 } },
        },
      },
      {
        type: "message",
        id: "result",
        parentId: null,
        timestamp: "2026-09-07T00:00:01.000Z",
        message: { role: "toolResult", toolCallId: "call-a", isError: false },
      },
    ]),
  );
  const data = embedded(renderHtml({ kind: "current", report, scope: "tree" }));

  assert.deepEqual(data.current.tree.report.tools, [
    {
      id: "tool:call-a",
      name: "read",
      status: "succeeded",
      usage: null,
      durationMs: null,
      durationLabel: null,
    },
  ]);
});

test("shows every token field with an independent Unavailable state", () => {
  const data = embedded(renderHtml(richCurrent));
  assert.deepEqual(data.current.tree.report.usage, {
    totalTokens: 42,
    cost: 0.01,
    inputTokens: 30,
    outputTokens: 12,
    cacheReadTokens: 5,
    cacheWriteTokens: 2,
  });

  const withoutSplit: SessionReport = {
    ...report,
    usage: { totalTokens: 42, cost: 0.01 },
  };
  const partial = embedded(
    renderHtml({ kind: "current", report: withoutSplit, scope: "active" }),
  );
  assert.deepEqual(partial.current.active.report.usage, {
    totalTokens: 42,
    cost: 0.01,
  });

  const script = scriptOf(renderHtml(richCurrent));
  for (const key of [
    "metric.input",
    "metric.output",
    "metric.cacheRead",
    "metric.cacheWrite",
    "usage.total",
  ]) {
    assert.equal(script.includes(`tr("${key}")`), true, key);
  }
  assert.match(script, /function tokenCell\(/);
});

test("presents usage composition that reconciles to the session total", () => {
  const data = embedded(renderHtml(richCurrent));
  assert.deepEqual(data.current.tree.report.composition, {
    available: true,
    parts: [
      { key: "generations", totalTokens: 30, cost: 0.01, confidence: "native" },
      { key: "toolResults", totalTokens: 10, cost: 0, confidence: "native" },
      { key: "compactions", totalTokens: 2, cost: 0, confidence: "native" },
      {
        key: "branchSummaries",
        totalTokens: 0,
        cost: 0,
        confidence: "native",
      },
    ],
    total: { totalTokens: 42, cost: 0.01 },
    reconciles: true,
  });

  const mismatched = embedded(
    renderHtml({
      kind: "current",
      scope: "active",
      report: {
        ...richReport,
        usage: { totalTokens: 99, cost: 0.99 },
      },
    }),
  );
  assert.equal(mismatched.current.active.report.composition.reconciles, false);

  const script = scriptOf(renderHtml(richCurrent));
  assert.equal(script.includes('tr("usage.reconciled")'), true);
  assert.equal(script.includes('tr("usage.unreconciled")'), true);
  assert.equal(script.includes('tr("unavailable.composition")'), true);
});

test("drives the evidence panel from real evidence state for every report kind", () => {
  const data = embedded(renderHtml(richCurrent));
  const confidences = data.current.tree.evidence.map(
    (row: { confidence: string }) => row.confidence,
  );
  assert.equal(confidences.includes("native"), true);
  assert.equal(confidences.includes("live"), true);
  assert.equal(confidences.includes("cooperative"), true);
  assert.equal(confidences.includes("unavailable"), true);
  for (const row of data.current.tree.evidence) {
    assert.equal(typeof row.source, "string");
    assert.equal(typeof row.observation, "string");
    assert.equal(typeof row.confidence, "string");
  }

  // A bare current view still carries its rows with an explicit Unavailable
  // confidence instead of zeros.
  const bare = embedded(renderHtml(current));
  assert.equal(bare.current.active.evidence.length > 0, true);
  assert.equal(
    bare.current.active.evidence.some(
      (row: { confidence: string }) => row.confidence === "unavailable",
    ),
    true,
  );

  const historyData = embedded(renderHtml(historyReport()));
  const globalData = embedded(renderHtml(globalReport()));
  for (const rows of [
    historyData.history.evidence,
    globalData.global.evidence,
  ]) {
    assert.equal(rows.length > 0, true);
    for (const row of rows) {
      assert.equal(typeof row.source, "string");
      assert.equal(typeof row.observation, "string");
      assert.equal(typeof row.confidence, "string");
    }
  }
  assert.equal(
    historyData.history.evidence.some(
      (row: { confidence: string }) => row.confidence === "native",
    ),
    true,
  );
  assert.equal(
    historyData.history.evidence.some(
      (row: { confidence: string }) => row.confidence === "unavailable",
    ),
    true,
  );

  // The panel reads the precomputed rows from the shared payload for the
  // selected scope; it never re-derives them in the browser.
  const script = scriptOf(renderHtml(richCurrent));
  assert.match(
    script,
    /function currentEvidence\(\)\{const view=data\.current\[state\.scope\];/,
  );
  assert.match(script, /evidence\.map\(row=>\[row\.source,row\.observation/);
});

test("computes durations from evidence and never guesses", () => {
  assert.equal(sessionSpanMs(richReport), 9_000);
  assert.equal(sessionSpanMs(report), undefined);
  assert.equal(formatDuration(0), "0 ms");
  assert.equal(formatDuration(42), "42 ms");
  assert.equal(formatDuration(65_000), "1m 05s");
  assert.equal(formatDuration(3_723_000), "1h 02m");

  const data = embedded(renderHtml(richCurrent));
  assert.equal(data.current.tree.report.durationMs, 9_000);
  assert.equal(data.current.tree.report.durationLabel, "9.0 s");
  assert.equal(data.current.tree.report.span.from, "2026-09-06");
  assert.equal(data.current.tree.report.span.to, "2026-09-07");

  const bare = embedded(renderHtml(current));
  assert.equal(bare.current.active.report.durationMs, null);
  assert.equal(bare.current.active.report.durationLabel, null);
  assert.equal(bare.current.active.report.span, null);
});

test("renders a history session table with the approved columns and drill-down", () => {
  const data = embedded(renderHtml(historyReport()));
  assert.equal(data.history.sessions.length, 2);
  const [rich, missing] = data.history.sessions;
  assert.equal(rich.availability, "available");
  assert.equal(rich.sessionId, "session-rich");
  assert.equal(rich.firstDate, "2026-09-06");
  assert.equal(rich.lastDate, "2026-09-07");
  assert.equal(rich.durationLabel, "9.0 s");
  assert.equal(rich.totalTokens, 42);
  assert.equal(rich.cost, 0.01);
  assert.equal(rich.generationCount, 2);
  assert.equal(rich.agentCount, 1);
  assert.deepEqual(rich.status, { key: "status.errors", tone: "warn" });
  assert.equal(typeof rich.view, "object");

  assert.equal(missing.availability, "unavailable");
  assert.equal(missing.sessionId, "session-missing");
  assert.equal(missing.totalTokens, null);
  assert.equal(missing.agentCount, null);
  assert.equal(missing.view, undefined);

  const script = scriptOf(renderHtml(historyReport()));
  assert.match(
    script,
    /\[tr\("table\.session"\),tr\("table\.duration"\),tr\("table\.tokens"\),tr\("table\.generations"\),tr\("table\.agents"\),tr\("table\.status"\),tr\("table\.cost"\)\]/,
  );
  assert.match(script, /historySessions\(\)\[state\.session\]/);
  assert.match(script, /dataset\.session/);
  assert.match(script, /state\.session=null/);
  // History keeps the shared tab renderer instead of hiding it.
  assert.equal(
    script.includes('tabsNode.hidden=state.range==="history"'),
    false,
  );
  assert.equal(script.includes("tabsNode.hidden"), false);
  assert.match(script, /q\("time-range"\)\.hidden=false/);
  assert.match(script, /detail\(/);
});

test("preserves scroll position and search focus across re-renders", () => {
  const script = scriptOf(renderHtml(richCurrent));
  assert.match(script, /window\.scrollY/);
  assert.match(script, /window\.scrollTo\(0,scrollY\)/);
  assert.match(script, /state\.query=event\.target\.value/);
  assert.match(script, /setSelectionRange/);
});

test("filters presets and custom ranges with inclusive UTC validation", () => {
  const script = scriptOf(renderHtml(historyReport()));
  assert.match(script, /latestDate\(\)/);
  assert.match(script, /from>to/);
  assert.match(script, /tr\("range\.error"\)/);
  assert.match(script, /data-days/);
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
    "metric.input",
    "metric.output",
    "metric.cacheRead",
    "metric.cacheWrite",
    "usage.total",
    "usage.reconciled",
    "usage.unreconciled",
    "unavailable.commands",
    "unavailable.skills",
    "unavailable.global",
    "unavailable.session",
    "unavailable.composition",
    "table.session",
    "table.duration",
    "table.agents",
    "table.status",
    "agents.note",
    "tools.note",
    "history.note",
    "chart.empty",
  ]) {
    assert.equal(
      typeof ENGLISH_CATALOG[key as keyof typeof ENGLISH_CATALOG],
      "string",
      key,
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

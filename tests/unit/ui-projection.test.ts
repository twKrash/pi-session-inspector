import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  attachSubagentEvidence,
  buildCanonicalSession,
  type CanonicalSessionBuildResult,
} from "../../src/core/canonical.ts";
import { reduceEntries } from "../../src/core/reduce.ts";
import { toSessionReport, type SessionReport } from "../../src/core/reports.ts";
import type { SessionCoverage } from "../../src/core/session-coverage.ts";
import type { AgentRun, SessionEntry } from "../../src/core/events.ts";
import { readSubagentEvidence } from "../../src/integrations/subagents.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";
import {
  loadInspectorBundle,
  type InspectorBundle,
} from "../../src/ui/bundle.ts";
import {
  createCurrentTuiModel,
  type CurrentTuiModel,
} from "../../src/ui/current.ts";
import {
  sessionDatedUsage,
  type DateUsageRow,
} from "../../src/ui/dated-usage.ts";
import { buildDailyRows } from "../../src/ui/daily.ts";
import type { GlobalReport, HistoryReport } from "../../src/ui/load-history.ts";
import {
  agentParentVerdicts,
  projectCurrentView,
  projectGlobalReport,
  projectHistoricalSession,
  projectHistoryReport,
  projectInspectorUi,
  type GlobalReportProjection,
} from "../../src/ui/ui-projection.ts";
import { renderJson } from "../../src/ui/json.ts";
import {
  aggregateUsageLabels,
  errorHeadline,
  errorMessage,
  historyEntry,
  sessionView,
  toolCalls,
  toolDuration,
  toolSummary,
  type AgentRow,
} from "../../src/ui/report-projection.ts";
import { ENGLISH_CATALOG } from "../../src/ui/i18n/catalog.ts";
import {
  bundleInput,
  currentModelWithOutOfOrderToolCalls,
  currentModelWithTools,
  FORBIDDEN_PRODUCER_KEYS,
  modelWithToolError,
} from "../helpers/bundle-scenarios.ts";

/**
 * The Task 3 ownership fixture: one real canonical session whose active path
 * ends on 2026-02-02 and whose tree carries a sibling branch on 2026-02-03, so
 * every projection's own range anchor is observable. The header also plants the
 * producer-only fields and the read call a hostile argument payload, so the
 * privacy assertion proves the projection, not the fixture, is what drops them.
 */
const SESSION_PROJECTION = "session-projection";

const HEADER = {
  type: "session",
  version: 3,
  id: SESSION_PROJECTION,
  timestamp: "2026-02-02T09:00:00.000Z",
  sessionName: "SECRET_SESSION_NAME",
  sessionFile: "/tmp/SECRET_SESSION_FILE.jsonl",
  transcriptPath: "/tmp/SECRET_TRANSCRIPT.jsonl",
};
const MARKER = {
  type: "custom",
  id: "marker",
  parentId: null,
  timestamp: "2026-02-02T09:00:01.000Z",
  customType: "session-inspector:tracking-start",
  data: { schemaVersion: 1 },
};
const GEN_ACTIVE = {
  type: "message",
  id: "gen-active",
  parentId: "marker",
  timestamp: "2026-02-02T10:00:00.000Z",
  message: {
    role: "assistant",
    provider: "acme",
    model: "alpha",
    usage: { totalTokens: 600, cost: { total: 0.12 } },
    content: [
      {
        type: "toolCall",
        id: "call_read",
        name: "read",
        input: {
          path: "/home/dev/SECRET_ARGUMENT/notes.md",
          command: "cat SECRET_ARGUMENT",
        },
      },
    ],
  },
};
const READ_RESULT = {
  type: "message",
  id: "res-read",
  parentId: "gen-active",
  timestamp: "2026-02-02T10:00:05.000Z",
  message: {
    role: "toolResult",
    toolCallId: "call_read",
    toolName: "read",
    isError: false,
    usage: { totalTokens: 180, cost: { total: 0.04 } },
    content: [{ type: "text", text: "SECRET_RESULT_BODY" }],
  },
};
const GEN_BASH = {
  type: "message",
  id: "gen-bash",
  parentId: "marker",
  timestamp: "2026-02-02T23:59:00.000Z",
  message: {
    role: "assistant",
    provider: "acme",
    model: "alpha",
    usage: { totalTokens: 5, cost: { total: 0.001 } },
    content: [{ type: "toolCall", id: "call_bash", name: "bash" }],
  },
};
const BASH_RESULT = {
  type: "message",
  id: "res-bash",
  parentId: "gen-bash",
  timestamp: "2026-02-03T00:00:05.000Z",
  message: {
    role: "toolResult",
    toolCallId: "call_bash",
    toolName: "bash",
    isError: true,
    content: [],
  },
};
const GEN_BRANCH = {
  type: "message",
  id: "gen-branch",
  parentId: "marker",
  timestamp: "2026-02-03T09:00:00.000Z",
  message: {
    role: "assistant",
    provider: "acme",
    model: "beta",
    usage: { totalTokens: 15, cost: { total: 0.003 } },
    content: [],
  },
};

const RECORDS = [
  HEADER,
  MARKER,
  GEN_ACTIVE,
  READ_RESULT,
  GEN_BASH,
  BASH_RESULT,
  GEN_BRANCH,
];

const CHILD_RUN: AgentRun = {
  id: `subagent-${"a".repeat(64)}`,
  status: "succeeded",
  confidence: "cooperative",
  observedAt: "2026-02-03T00:00:05.000Z",
  evidenceToolId: "tool:call_bash",
  model: "alpha",
  usage: { totalTokens: 50, cost: 0.01 },
};

function parseFixture(): ReturnType<typeof parseSessionJsonl> {
  return parseSessionJsonl(
    `${RECORDS.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );
}

/** The one canonical build both current views read; the builder owns scope. */
function builtFixture(
  scope: "active" | "tree",
  leafId: string | null,
): CanonicalSessionBuildResult {
  const built = buildCanonicalSession({
    parsed: parseFixture(),
    scope,
    leafId,
    evidence: { atomic: [], folded: [] },
  });
  if (built.state !== "ready") {
    throw new Error(`the fixture session must build for scope ${scope}`);
  }
  return built;
}

/**
 * The active view: the leaf is the read result, so the sibling bash branch and
 * its child run stay out of this report. Its own dated window ends 2026-02-02.
 */
function activeModel(): CurrentTuiModel {
  const built = builtFixture("active", "res-read");
  if (built.state !== "ready") throw new Error("active build failed");
  return createCurrentTuiModel(
    toSessionReport(built.session),
    "active",
    sessionDatedUsage(built.session),
  );
}

/**
 * The tree view: every branch, its window ends 2026-02-03, and the failed bash
 * call publishes one error plus one child run dated 2026-02-03.
 */
function treeModel(): CurrentTuiModel {
  const built = builtFixture("tree", null);
  if (built.state !== "ready") throw new Error("tree build failed");
  const session = attachSubagentEvidence(built.session, {
    state: "supported",
    runs: [CHILD_RUN],
    activity: {
      state: "unavailable",
      calls: 0,
      succeeded: 0,
      failed: 0,
      interrupted: 0,
      tools: [],
    },
    diagnostics: [],
  });
  return createCurrentTuiModel(
    toSessionReport(session),
    "tree",
    sessionDatedUsage(session),
  );
}

/** One synthetic dated window row, so a history verdict is pinned exactly. */
function dateRow(input: {
  date: string;
  totalTokens: number;
  cost: number;
  generations: number;
}): DateUsageRow {
  return {
    date: input.date,
    totalTokens: input.totalTokens,
    cost: input.cost,
    generations: input.generations,
    tools: 0,
    errors: 0,
    composition: {
      generations: { totalTokens: input.totalTokens, cost: input.cost },
      toolResults: { totalTokens: 0, cost: 0 },
      compactions: { totalTokens: 0, cost: 0 },
      branchSummaries: { totalTokens: 0, cost: 0 },
    },
  };
}

/** One view-level daily fold, the shape `CurrentView.daily` carries. */
function foldedDaily(
  rows: readonly DateUsageRow[],
  sessionId: string,
): ReturnType<typeof buildDailyRows>["rows"] {
  return buildDailyRows([{ sessionId, rows, truncated: false }]).rows;
}

/** One generation-only session, the minimum a history row's report needs. */
function economicsReport(): SessionReport {
  return toSessionReport(
    reduceEntries("economics-report", [
      {
        type: "message",
        id: "economics-generation",
        parentId: null,
        timestamp: "2026-02-02T10:00:00.000Z",
        message: {
          role: "assistant",
          provider: "acme",
          model: "alpha",
          usage: {
            input: 27,
            output: 12,
            cacheRead: 1,
            cacheWrite: 1,
            reasoning: 3,
            totalTokens: 41,
            cost: {
              input: 0.065,
              output: 0.094,
              cacheRead: 0.01,
              cacheWrite: 0.013,
              total: 0.182,
            },
          },
          content: [],
        },
      },
    ]),
  );
}

function historicalReport(input: {
  sessionId: string;
  timestamp: string;
  totalTokens: number;
  cost: number;
}): SessionReport {
  return toSessionReport(
    reduceEntries(input.sessionId, [
      {
        type: "message",
        id: `${input.sessionId}-gen`,
        parentId: null,
        timestamp: input.timestamp,
        message: {
          role: "assistant",
          provider: "acme",
          model: "alpha",
          usage: {
            totalTokens: input.totalTokens,
            cost: { total: input.cost },
          },
          content: [],
        },
      },
    ]),
  );
}

const COVERAGE: SessionCoverage = {
  inspected: 4,
  available: 3,
  unavailable: 1,
  sessionRatio: 0.75,
  complete: true,
  discoveryLimited: false,
  reasons: { "marker-unavailable": 1 },
};

/**
 * The history aggregate: one real member session, one truncated window whose
 * retained rows all lie after a range (omitted history), one truncated window
 * with an in-range retained row (partial), and one unavailable session.
 */
function historyReport(tree: CurrentTuiModel): HistoryReport {
  const treeView = tree.datedUsage;
  if (treeView === undefined) throw new Error("the tree fixture needs dates");
  const omittedReport = historicalReport({
    sessionId: "session-omitted",
    timestamp: "2026-03-10T10:00:00.000Z",
    totalTokens: 300,
    cost: 0.06,
  });
  const partialReport = historicalReport({
    sessionId: "session-partial",
    timestamp: "2026-02-10T10:00:00.000Z",
    totalTokens: 250,
    cost: 0.05,
  });
  return {
    availability: "available",
    sessions: [
      {
        availability: "available",
        sessionId: SESSION_PROJECTION,
        usageByDate: treeView.dates,
        usageByDateTruncated: treeView.truncated,
        datedModels: treeView.models,
        modelsTruncated: treeView.modelsTruncated,
        report: tree.report,
      },
      {
        availability: "available",
        sessionId: "session-omitted",
        usageByDate: [
          dateRow({
            date: "2026-03-10",
            totalTokens: 300,
            cost: 0.06,
            generations: 1,
          }),
        ],
        usageByDateTruncated: true,
        datedModels: [],
        modelsTruncated: false,
        report: omittedReport,
      },
      {
        availability: "available",
        sessionId: "session-partial",
        usageByDate: [
          dateRow({
            date: "2026-02-10",
            totalTokens: 250,
            cost: 0.05,
            generations: 1,
          }),
          dateRow({
            date: "2026-03-10",
            totalTokens: 50,
            cost: 0.01,
            generations: 1,
          }),
        ],
        usageByDateTruncated: true,
        datedModels: [],
        modelsTruncated: false,
        report: partialReport,
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

/** The global aggregate over the same two dated rows, hand-built at DTO level. */
function globalReportOf(tree: CurrentTuiModel): GlobalReport {
  void tree;
  return {
    availability: "available",
    sessions: [
      {
        availability: "available",
        sessionId: SESSION_PROJECTION,
        usageByDateTruncated: false,
      },
      { availability: "unavailable", sessionId: "session-missing" },
    ],
    usage: { totalTokens: 800, cost: 0.164 },
    dates: [
      {
        date: "2026-02-02",
        sessions: 1,
        usage: { totalTokens: 780, cost: 0.16 },
      },
      {
        date: "2026-02-03",
        sessions: 1,
        usage: { totalTokens: 20, cost: 0.004 },
      },
    ],
    diagnostics: [],
    inventory: { commands: 3, skills: 2, resources: null },
    coverage: COVERAGE,
  };
}

/** The one bundle every semantic assertion reads; its two anchors differ. */
async function bundleWithDifferentObservedDates(): Promise<InspectorBundle> {
  const tree = treeModel();
  const history = historyReport(tree);
  const global = globalReportOf(tree);
  return loadInspectorBundle({
    ...bundleInput,
    loadCurrent: async (scope) => (scope === "active" ? activeModel() : tree),
    loadHistory: async () => history,
    loadGlobal: async () => global,
  });
}

/** Both current views failed to replay and history is unavailable. */
async function unavailableBundle(): Promise<InspectorBundle> {
  return loadInspectorBundle({
    ...bundleInput,
    loadCurrent: async () => undefined,
    loadHistory: async () => ({
      availability: "unavailable",
      sessions: [],
      diagnostics: [],
    }),
    loadGlobal: async () => ({
      availability: "unavailable",
      sessions: [],
      usage: { totalTokens: 0, cost: 0 },
      dates: [],
      diagnostics: [],
      inventory: { commands: null, skills: null, resources: null },
    }),
  });
}

/** A bundle whose current view carries no dated projection at all. */
async function bundleWithoutObservedDates(): Promise<InspectorBundle> {
  return loadInspectorBundle({
    ...bundleInput,
    loadCurrent: async () => currentModelWithTools(),
  });
}

const PRESET_7 = { kind: "preset", preset: 7 } as const;
const FIRST_DAY = {
  kind: "custom",
  from: "2026-02-02",
  to: "2026-02-02",
} as const;

test("projects shared token economics into session, range, history and global views", () => {
  const report = economicsReport();
  const view = sessionView(report);
  assert.equal(view.usageEconomics?.input.tokens, 27);
  assert.equal(view.usageEconomics?.input.cost, 0.065);
  assert.equal(view.usageEconomics?.reasoning.tokens, 3);
  assert.equal(view.usageEconomics?.cacheReuse.denominatorTokens, 29);
  assert.equal(view.usageEconomics?.cacheReuse.percent, 3.4);
  const jsonView = JSON.parse(renderJson(view)) as typeof view;
  assert.equal(jsonView.usageEconomics?.cacheRead.tokens, 1);

  const dated = {
    ...dateRow({
      date: "2026-02-02",
      totalTokens: 41,
      cost: 0.182,
      generations: 1,
    }),
    inputTokens: 27,
    outputTokens: 12,
    cacheReadTokens: 1,
    cacheWriteTokens: 1,
    reasoningTokens: 3,
    inputCost: 0.065,
    outputCost: 0.094,
    cacheReadCost: 0.01,
    cacheWriteCost: 0.013,
  };
  const history: HistoryReport = {
    availability: "available",
    sessions: [
      {
        availability: "available",
        sessionId: report.sessionId,
        usageByDate: [dated],
        usageByDateTruncated: false,
        datedModels: [],
        modelsTruncated: false,
        report,
      },
    ],
    diagnostics: [],
  };
  const historyView = projectHistoryReport(history);
  assert.equal(historyView.totals.inputTokens, 27);
  assert.equal(historyView.usageEconomics?.cacheReuse.percent, 3.4);

  const global: GlobalReport = {
    availability: "available",
    sessions: [
      {
        availability: "available",
        sessionId: report.sessionId,
        usageByDateTruncated: false,
      },
    ],
    usage: report.usage ?? { totalTokens: 0, cost: 0 },
    dates: [{ date: dated.date, sessions: 1, usage: dated }],
    diagnostics: [],
    inventory: { commands: null, skills: null, resources: null },
  };
  const globalView = projectGlobalReport(global);
  assert.equal(globalView.totals.outputCost, 0.094);
  assert.equal(globalView.usageEconomics?.cacheReuse.percent, 3.4);
});

test("each current view resolves a preset against its own observed dates", async () => {
  const bundle = await bundleWithDifferentObservedDates();
  const projected = projectInspectorUi({ bundle, intent: PRESET_7 });

  assert.equal(projected.kind, "ui");
  assert.equal(projected.schemaVersion, 1);
  assert.equal(projected.theme, bundle.theme);
  assert.equal(projected.initialScope, bundle.initialScope);
  assert.equal(
    projected.current.sameReportProjection,
    bundle.current.sameReportProjection,
  );

  // One shared preset, two independent anchors: no global {from,to} pair.
  assert.deepEqual(projected.current.active.range?.resolved, {
    preset: 7,
    from: "2026-01-27",
    to: "2026-02-02",
  });
  assert.deepEqual(projected.current.tree.range?.resolved, {
    preset: 7,
    from: "2026-01-28",
    to: "2026-02-03",
  });
  assert.deepEqual(projected.current.active.range?.requested, PRESET_7);
  assert.deepEqual(projected.current.tree.range?.requested, PRESET_7);

  const tree = projected.current.tree.range;
  assert.equal(tree?.totals.totalTokens, 800);
  assert.equal(tree?.totals.days, 2);
  assert.deepEqual(
    tree?.daily.map((row) => row.date),
    ["2026-02-02", "2026-02-03"],
  );
  assert.equal(
    tree?.toolCalls.every((row) => row.timestamp.startsWith("2026-02-02")),
    true,
  );
  // The sibling branch is in the tree range and out of the active one.
  assert.equal(tree?.errors.length, 1);
  assert.equal(tree?.toolSummary.length, 2);
  assert.equal(projected.current.active.range?.errors.length, 0);
  assert.equal(projected.current.active.range?.totals.totalTokens, 780);
  assert.equal(projected.current.active.range?.totals.days, 1);

  // All-date evidence stays off range accounting and outside the totals.
  assert.equal(projected.current.tree.evidence.length > 0, true);
  assert.equal(projected.current.tree.report?.usage?.totalTokens, 800);
});

test("a custom range changes daily, model, tool, agent, error and ledger rows", async () => {
  const bundle = await bundleWithDifferentObservedDates();
  const projected = projectInspectorUi({ bundle, intent: FIRST_DAY });
  const range = projected.current.tree.range;
  if (range === undefined) throw new Error("the tree view must carry a range");

  assert.deepEqual(range.resolved, {
    preset: null,
    from: "2026-02-02",
    to: "2026-02-02",
  });
  assert.deepEqual(
    range.daily.map((row) => row.date),
    ["2026-02-02"],
  );
  assert.equal(range.totals.totalTokens, 785);
  assert.equal(range.totals.cost, 0.161);
  assert.equal(range.totals.generations, 2);
  assert.equal(range.totals.tools, 2);
  assert.equal(range.totals.days, 1);
  // The period composition reconciles with the same filtered rows.
  assert.equal(range.composition?.reconciles, true);
  assert.equal(range.composition?.total?.totalTokens, 785);
  assert.deepEqual(
    range.models.map((row) => [
      row.provider,
      row.model,
      row.generations,
      row.totalTokens,
    ]),
    [["acme", "alpha", 2, 605]],
  );
  assert.deepEqual(
    range.toolSummary.map((row) => [row.name, row.calls, row.withUsage]),
    [
      ["bash", 1, 0],
      ["read", 1, 1],
    ],
  );
  assert.deepEqual(
    range.toolCalls.map((row) => [row.name, row.status]),
    [
      ["bash", "failed"],
      ["read", "succeeded"],
    ],
  );
  // Agents, errors and ledger rows are dated by their own persisted fields.
  assert.deepEqual(range.agents, []);
  assert.deepEqual(range.errors, []);
  assert.deepEqual(
    range.ledger.map((item) => [item.kind, item.timestamp.slice(0, 10)]),
    [
      ["generation", "2026-02-02"],
      ["tool", "2026-02-02"],
      ["generation", "2026-02-02"],
      ["tool", "2026-02-02"],
    ],
  );

  // The wider preset keeps the sibling day's rows in the same projections.
  const wider = projectInspectorUi({ bundle, intent: PRESET_7 });
  const widerRange = wider.current.tree.range;
  assert.equal(widerRange?.agents.length, 1);
  assert.equal(widerRange?.errors.length, 1);
  assert.equal(widerRange?.ledger.length, 6);
  assert.deepEqual(
    widerRange?.models.map((row) => [row.model, row.totalTokens]),
    [
      ["alpha", 605],
      ["beta", 15],
    ],
  );
});

test("child usage stays a breakdown and never enters the native range total", async () => {
  const bundle = await bundleWithDifferentObservedDates();
  const projected = projectInspectorUi({ bundle, intent: PRESET_7 });
  const range = projected.current.tree.range;
  if (range === undefined) throw new Error("the tree view must carry a range");

  assert.equal(range.totals.totalTokens, 800);
  assert.deepEqual(
    range.agents.map((row) => [row.id, row.usage?.totalTokens]),
    [[CHILD_RUN.id, 50]],
  );
  assert.equal(
    range.agents.reduce((sum, row) => sum + (row.usage?.totalTokens ?? 0), 0),
    50,
  );
  assert.equal(
    range.totals.totalTokens,
    projected.current.tree.report?.usage?.totalTokens,
  );
  assert.equal(projected.current.tree.report?.agentCount, 1);
  assert.equal(projected.current.active.report?.agentCount, null);

  // The bounded breakdown is published beside the rows, so no renderer sums
  // them: one succeeded run with 50 tokens and $0.01 of known usage.
  assert.deepEqual(range.childUsage, {
    runsTotal: 1,
    runsWithUsage: 1,
    totalTokens: 50,
    cost: 0.01,
    failedCost: null,
    failedRunsWithUsage: 0,
    byStatus: {
      succeeded: 1,
      failed: 0,
      interrupted: 0,
      running: 0,
      unknown: 0,
    },
  });
  // A selection with no run reports nothing, never a fabricated zero.
  assert.deepEqual(projected.current.active.range?.childUsage, {
    runsTotal: 0,
    runsWithUsage: 0,
    totalTokens: null,
    cost: null,
    failedCost: null,
    failedRunsWithUsage: 0,
    byStatus: {
      succeeded: 0,
      failed: 0,
      interrupted: 0,
      running: 0,
      unknown: 0,
    },
  });
});

test("a tool summary row carries L2's partial-usage verdict", () => {
  const report = toSessionReport(
    reduceEntries("session-partial-tools", [
      {
        type: "message",
        id: "gen-tools",
        parentId: null,
        timestamp: "2026-02-02T10:00:00.000Z",
        message: {
          role: "assistant",
          provider: "acme",
          model: "alpha",
          usage: { totalTokens: 10, cost: { total: 0.001 } },
          content: [
            { type: "toolCall", id: "call_read_1", name: "read" },
            { type: "toolCall", id: "call_read_2", name: "read" },
          ],
        },
      },
      {
        type: "message",
        id: "res-read-1",
        parentId: "gen-tools",
        timestamp: "2026-02-02T10:00:01.000Z",
        message: {
          role: "toolResult",
          toolCallId: "call_read_1",
          toolName: "read",
          isError: false,
          usage: { totalTokens: 4, cost: { total: 0.001 } },
          content: [],
        },
      },
      {
        type: "message",
        id: "res-read-2",
        parentId: "gen-tools",
        timestamp: "2026-02-02T10:00:02.000Z",
        message: {
          role: "toolResult",
          toolCallId: "call_read_2",
          toolName: "read",
          isError: false,
          content: [],
        },
      },
    ]),
  );
  const view = projectCurrentView(
    {
      availability: "available",
      report,
      daily: foldedDaily(
        [
          dateRow({
            date: "2026-02-02",
            totalTokens: 14,
            cost: 0.002,
            generations: 1,
          }),
        ],
        "session-partial-tools",
      ),
    },
    "tree",
  );

  // One of two calls reported usage: the row is partial. A row whose calls
  // reported none at all is Unavailable, which is not the same verdict.
  assert.deepEqual(
    view.range?.toolSummary.map((row) => [
      row.name,
      row.calls,
      row.withUsage,
      row.partial,
    ]),
    [["read", 2, 1, true]],
  );
});

test("each inventory publishes its availability figure, never its rows", () => {
  const report = toSessionReport(
    reduceEntries("session-inventory", [
      {
        type: "message",
        id: "gen-inventory",
        parentId: null,
        timestamp: "2026-02-02T10:00:00.000Z",
        message: {
          role: "assistant",
          provider: "acme",
          model: "alpha",
          usage: { totalTokens: 10, cost: { total: 0.001 } },
          content: [],
        },
      },
    ]),
    {
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
          },
          {
            name: "skill-two",
            sourceLabel: "local",
            scope: "user",
            origin: "package",
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
          {
            sourceLabel: "local",
            scope: "user",
            origin: "package",
            commands: 0,
            skills: 0,
            prompts: 1,
            tools: 0,
          },
          {
            sourceLabel: "local",
            scope: "user",
            origin: "package",
            commands: 0,
            skills: 0,
            prompts: 0,
            tools: 1,
          },
        ],
        toolSources: {},
      },
      counters: {
        counters: {},
        // A counted name the inventory does not list is activity, so it must
        // not raise the skills figure above the two inventory rows.
        skillInvocations: { unlisted: 4 },
        otherInvocations: 0,
        presence: { permission: false },
      },
    },
  );
  const view = projectCurrentView(
    {
      availability: "available",
      report,
      daily: foldedDaily(
        [
          dateRow({
            date: "2026-02-02",
            totalTokens: 10,
            cost: 0.001,
            generations: 1,
          }),
        ],
        "session-inventory",
      ),
    },
    "tree",
  );
  assert.deepEqual(view.inventoryAvailability, {
    commands: 1,
    skills: 2,
    resources: 3,
  });

  // No inventory snapshot: every figure is Unavailable, never a fabricated zero.
  const withoutInventory = projectCurrentView(
    {
      availability: "available",
      report: historicalReport({
        sessionId: "session-no-inventory",
        timestamp: "2026-02-02T10:00:00.000Z",
        totalTokens: 10,
        cost: 0.001,
      }),
    },
    "tree",
  );
  assert.deepEqual(withoutInventory.inventoryAvailability, {
    commands: null,
    skills: null,
    resources: null,
  });
});

test("each named entry point projects one section on its own", async () => {
  const bundle = await bundleWithDifferentObservedDates();
  const whole = projectInspectorUi({ bundle, intent: PRESET_7 });
  const partial = bundle.history.sessions.find(
    (session) => session.sessionId === "session-partial",
  );
  if (partial === undefined) throw new Error("fixture session missing");

  const active = projectCurrentView(bundle.current.active, "active", PRESET_7);
  assert.deepEqual(
    active.range?.resolved,
    whole.current.active.range?.resolved,
  );
  assert.equal(active.scope, "active");

  const history = projectHistoryReport(bundle.history, PRESET_7);
  assert.deepEqual(history.resolved, whole.history.resolved);
  assert.equal(history.sessions.length, bundle.history.sessions.length);
  // The legacy per-section row keeps the same bounded shape and dated window.
  const row = historyEntry(partial);
  assert.equal(row.sessionId, "session-partial");
  assert.equal(row.firstDate, "2026-02-10");
  assert.deepEqual(
    row.usageByDate?.map((dated) => dated.date),
    ["2026-02-10", "2026-03-10"],
  );

  // The supplied history windows are the aggregate's partiality input: the same
  // report without them cannot see the partial contribution.
  const withWindows: GlobalReportProjection = projectGlobalReport(
    bundle.global,
    PRESET_7,
    bundle.history.sessions,
  );
  const withoutWindows = projectGlobalReport(bundle.global, PRESET_7);
  assert.deepEqual(withWindows.daily, withoutWindows.daily);
  assert.equal(withoutWindows.truncated, false);
  assert.equal(withWindows.truncated, true);

  const view = projectHistoricalSession(partial, PRESET_7);
  assert.deepEqual(view.range?.resolved, {
    preset: 7,
    from: "2026-03-04",
    to: "2026-03-10",
  });
  assert.equal(view.scope, undefined);
  assert.equal(view.report?.sessionId, "session-partial");
});

test("a truncated row inside omitted history reports unknown, never zero", async () => {
  const bundle = await bundleWithDifferentObservedDates();
  const projected = projectInspectorUi({
    bundle,
    intent: { kind: "custom", from: "2026-01-01", to: "2026-02-03" },
  });

  const row = projected.history.sessions.find(
    (session) => session.sessionId === "session-omitted",
  );
  assert.equal(row?.membership, "unknown");
  assert.equal(row?.totalTokens, null);
  assert.equal(row?.cost, null);
  assert.equal(row?.partial, true);
  assert.equal(row?.availability, "available");
  // The aggregate is partial because a contributing window cannot represent it.
  assert.equal(projected.history.truncated, true);
  // The member session carries a known retained sum, so it is a member.
  const member = projected.history.sessions.find(
    (session) => session.sessionId === SESSION_PROJECTION,
  );
  assert.equal(member?.membership, "member");
  assert.equal(member?.totalTokens, 800);
  assert.equal(member?.partial, false);
  // An unavailable session is unknown, never a fabricated zero row.
  const missing = projected.history.sessions.find(
    (session) => session.sessionId === "session-missing",
  );
  assert.equal(missing?.membership, "unknown");
  assert.equal(missing?.totalTokens, null);
  assert.equal(missing?.partial, false);
  assert.equal(missing?.view, undefined);
  assert.equal(missing?.agentCount, null);
});

test("a truncated entry with an empty retained window is partial, not complete", () => {
  const report: HistoryReport = {
    availability: "available",
    sessions: [
      {
        availability: "available",
        sessionId: "session-dated",
        usageByDate: [
          dateRow({
            date: "2026-03-10",
            totalTokens: 300,
            cost: 0.06,
            generations: 1,
          }),
        ],
        usageByDateTruncated: false,
        datedModels: [],
        modelsTruncated: false,
        report: historicalReport({
          sessionId: "session-dated",
          timestamp: "2026-03-10T10:00:00.000Z",
          totalTokens: 300,
          cost: 0.06,
        }),
      },
      {
        availability: "available",
        sessionId: "session-truncated-empty",
        usageByDate: [],
        usageByDateTruncated: true,
        datedModels: [],
        modelsTruncated: false,
        report: historicalReport({
          sessionId: "session-truncated-empty",
          timestamp: "2026-02-01T10:00:00.000Z",
          totalTokens: 100,
          cost: 0.02,
        }),
      },
      {
        availability: "available",
        sessionId: "session-empty-complete",
        usageByDate: [],
        usageByDateTruncated: false,
        datedModels: [],
        modelsTruncated: false,
        report: historicalReport({
          sessionId: "session-empty-complete",
          timestamp: "2026-02-01T10:00:00.000Z",
          totalTokens: 100,
          cost: 0.02,
        }),
      },
    ],
    diagnostics: [],
    coverage: COVERAGE,
  };
  const projected = projectHistoryReport(report, {
    kind: "custom",
    from: "2026-03-01",
    to: "2026-03-31",
  });

  // An empty retained window is complete only when it is untruncated. A
  // truncated one cannot represent the range, so its usage is unknown and the
  // row stays partial — no fabricated zero and no "complete" label.
  const truncated = projected.sessions.find(
    (session) => session.sessionId === "session-truncated-empty",
  );
  assert.equal(truncated?.membership, "unknown");
  assert.equal(truncated?.totalTokens, null);
  assert.equal(truncated?.cost, null);
  assert.equal(truncated?.partial, true);
  // The same row's own selected view already flags the range as truncated.
  assert.equal(truncated?.view?.range?.truncated, true);
  assert.equal(projected.truncated, true);

  // An untruncated empty window keeps its current non-partial verdict.
  const complete = projected.sessions.find(
    (session) => session.sessionId === "session-empty-complete",
  );
  assert.equal(complete?.membership, "unknown");
  assert.equal(complete?.totalTokens, null);
  assert.equal(complete?.partial, false);
});

test("an in-range retained row stays partial with its known sum", async () => {
  const bundle = await bundleWithDifferentObservedDates();
  const projected = projectInspectorUi({
    bundle,
    intent: { kind: "custom", from: "2026-01-01", to: "2026-02-20" },
  });

  const row = projected.history.sessions.find(
    (session) => session.sessionId === "session-partial",
  );
  assert.equal(row?.membership, "member");
  assert.equal(row?.totalTokens, 250);
  assert.equal(row?.cost, 0.05);
  assert.equal(row?.partial, true);
  assert.equal(row?.published, true);
});

test("history carries the coverage ladder, membership order and per-session views", async () => {
  const bundle = await bundleWithDifferentObservedDates();
  const projected = projectInspectorUi({ bundle, intent: PRESET_7 });

  assert.equal(projected.history.availability, "available");
  assert.deepEqual(projected.history.usageLabels, {
    cost: "metric.cost",
    tokens: "metric.tokens",
    usageUnavailable: false,
    sessions: "coverage.complete",
  });
  assert.equal(projected.history.coverage?.line, "3 / 4 sessions");
  assert.equal(projected.history.evidence.length > 0, true);
  // Fixed order: newest last date first, the usable rows ahead of the unknown.
  assert.deepEqual(
    projected.history.sessions.map((session) => session.sessionId),
    [
      "session-omitted",
      "session-partial",
      SESSION_PROJECTION,
      "session-missing",
    ],
  );
  // Three projections, three anchors for the same preset: current active,
  // current tree, and a selected session all resolve independently.
  const selected = projected.history.sessions.find(
    (session) => session.sessionId === "session-partial",
  );
  assert.deepEqual(selected?.view?.range?.resolved, {
    preset: 7,
    from: "2026-03-04",
    to: "2026-03-10",
  });
  assert.deepEqual(projected.history.resolved, {
    preset: 7,
    from: "2026-03-04",
    to: "2026-03-10",
  });
  assert.notDeepEqual(
    selected?.view?.range?.resolved,
    projected.current.tree.range?.resolved,
  );
  assert.equal(selected?.view?.report?.sessionId, "session-partial");
  assert.deepEqual(selected?.view?.capabilities, [
    "overview",
    "llm",
    "tools",
    "skills",
    "integrations",
    "environment",
    "errors",
    "ledger",
  ]);
});

test("an unavailable current view and history section degrade without zeros", async () => {
  const bundle = await unavailableBundle();
  const projected = projectInspectorUi({ bundle, intent: PRESET_7 });

  for (const view of [projected.current.active, projected.current.tree]) {
    assert.equal(view.availability, "unavailable");
    assert.equal(view.diagnostic, "current-unavailable");
    assert.equal(view.report, undefined);
    assert.equal(view.range, undefined);
    assert.deepEqual(view.capabilities, []);
    assert.deepEqual(view.evidence, []);
  }
  assert.equal(projected.history.availability, "unavailable");
  assert.equal(projected.history.resolved, null);
  assert.deepEqual(projected.history.sessions, []);
  assert.deepEqual(projected.history.daily, []);
  assert.equal(projected.history.totals.totalTokens, 0);
  assert.equal(projected.history.coverage, null);
  assert.equal(projected.history.usageLabels.usageUnavailable, true);
  assert.equal(projected.global.availability, "unavailable");
  assert.equal(projected.global.resolved, null);
  assert.deepEqual(projected.global.daily, []);
  assert.equal(projected.global.coverage, null);
  assert.equal(projected.global.usageLabels.usageUnavailable, true);
});

test("a view with no observed dates resolves no range instead of inventing one", async () => {
  const bundle = await bundleWithoutObservedDates();
  const projected = projectInspectorUi({ bundle, intent: PRESET_7 });

  assert.equal(projected.current.active.availability, "available");
  assert.equal(projected.current.active.range?.resolved, null);
  assert.deepEqual(projected.current.active.range?.requested, PRESET_7);
  assert.equal(projected.current.active.range?.truncated, false);
  assert.deepEqual(projected.current.active.range?.daily, []);
  assert.equal(projected.current.active.range?.totals.days, 0);
  assert.equal(projected.current.active.range?.composition, null);
  assert.deepEqual(projected.current.active.range?.ledger, []);
  // A view without a dated projection carries no dated model rows either.
  assert.deepEqual(projected.current.active.range?.models, []);
});

test("global folds its own dates and counts tracked and unavailable sessions", async () => {
  const bundle = await bundleWithDifferentObservedDates();
  const projected = projectInspectorUi({ bundle, intent: PRESET_7 });
  const global = projected.global;

  assert.equal(global.availability, "available");
  assert.deepEqual(global.resolved, {
    preset: 7,
    from: "2026-01-28",
    to: "2026-02-03",
  });
  assert.deepEqual(
    global.daily.map((row) => [row.date, row.sessions, row.totalTokens]),
    [
      ["2026-02-02", 1, 780],
      ["2026-02-03", 1, 20],
    ],
  );
  assert.equal(global.totals.totalTokens, 800);
  assert.equal(global.totals.days, 2);
  assert.equal(global.trackedSessions, 2);
  assert.equal(global.unavailableSessions, 1);
  assert.equal(global.inventory.commands, 3);
  assert.equal(global.inventory.resources, null);
  assert.equal(global.coverage?.line, "3 / 4 sessions");
  assert.equal(global.evidence.length > 0, true);
  assert.equal(global.composition.available, false);

  const narrowed = projectInspectorUi({
    bundle,
    intent: { kind: "custom", from: "2026-02-02", to: "2026-02-02" },
  });
  assert.deepEqual(
    narrowed.global.daily.map((row) => row.date),
    ["2026-02-02"],
  );
  assert.equal(narrowed.global.totals.totalTokens, 780);
});

test("the projection is pure and deterministic for identical bounded inputs", async () => {
  const bundle = await bundleWithDifferentObservedDates();
  const before = JSON.stringify(bundle);
  const first = projectInspectorUi({ bundle, intent: PRESET_7 });
  const second = projectInspectorUi({ bundle, intent: PRESET_7 });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(JSON.stringify(bundle), before);

  // An independently loaded bundle with the same data projects identically.
  const other = await bundleWithDifferentObservedDates();
  assert.equal(
    JSON.stringify(projectInspectorUi({ bundle: other, intent: PRESET_7 })),
    JSON.stringify(first),
  );
});

test("no producer-only field or planted secret reaches the projection", async () => {
  const bundle = await bundleWithDifferentObservedDates();
  const serialized = JSON.stringify(
    projectInspectorUi({ bundle, intent: PRESET_7 }),
  );
  for (const key of FORBIDDEN_PRODUCER_KEYS) {
    assert.equal(serialized.includes(`"${key}"`), false, key);
  }
  for (const secret of [
    "SECRET_SESSION_NAME",
    "SECRET_SESSION_FILE",
    "SECRET_TRANSCRIPT",
    "SECRET_ARGUMENT",
    "SECRET_RESULT_BODY",
  ]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
  // The bounded fields the tools/errors views may render are still there.
  assert.equal(serialized.includes('"tool:call_bash"'), true);
});

test("the projection modules reach no loader, filesystem, or browser state", () => {
  const shared = [
    "node:",
    "./route.ts",
    "./load-current.ts",
    "./html.ts",
    "document.",
    "window.",
    "Date.now",
    "new Date(",
    "readFile",
    "loadInspectorBundle",
    "loadHistoryReports",
    "loadGlobalReport",
    "loadCurrentSessionReport",
  ];
  const files = [
    // The report projection is even narrower: it never names the bundle DTO it
    // was extracted from.
    {
      path: "src/ui/report-projection.ts",
      forbidden: [...shared, "./bundle.ts"],
    },
    { path: "src/ui/ui-projection.ts", forbidden: shared },
  ];
  for (const file of files) {
    const source = readFileSync(file.path, "utf8");
    for (const fragment of file.forbidden) {
      assert.equal(
        source.includes(fragment),
        false,
        `${file.path} must not reference ${fragment}`,
      );
    }
    // The loader's own report types are the one thing borrowed across the
    // loader seam, and only as a type: with every `import type { ... }` edge
    // removed, no loader module is named at all.
    assert.equal(
      source
        .replace(/import type \{[\s\S]*?\} from "[^"]*";/g, "")
        .includes("./load-history.ts"),
      false,
      `${file.path} must value-import nothing from the loader`,
    );
    assert.equal(
      /import type \{[\s\S]*?\} from "\.\/load-history\.ts";/.test(source),
      true,
      `${file.path} must type-import the loader's report shapes`,
    );
  }
});

test("each rendered run carries L2's own parent verdict", () => {
  const parentId = `subagent-${"b".repeat(64)}`;
  const containerId = `subagent-${"c".repeat(64)}`;
  const childId = `subagent-${"d".repeat(64)}`;
  const containerChildId = `subagent-${"e".repeat(64)}`;
  const rootlessId = `subagent-${"f".repeat(64)}`;
  const report = toSessionReport(
    reduceEntries("session-parent-verdict", [
      {
        type: "message",
        id: "gen-parent-verdict",
        parentId: null,
        timestamp: "2026-03-10T10:00:00.000Z",
        message: {
          role: "assistant",
          provider: "acme",
          model: "alpha",
          usage: { totalTokens: 10, cost: { total: 0.001 } },
          content: [],
        },
      },
    ]),
    {
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
          {
            id: containerChildId,
            parentId: containerId,
            agent: "container-child",
            status: "succeeded",
            confidence: "cooperative",
            observedAt: "2026-03-10T10:00:00.000Z",
          },
          {
            id: rootlessId,
            agent: "rootless-child",
            status: "succeeded",
            confidence: "cooperative",
            observedAt: "2026-03-10T10:00:00.000Z",
          },
        ],
      },
    },
  );
  const view = {
    availability: "available" as const,
    report,
    daily: foldedDaily(
      [
        dateRow({
          date: "2026-03-10",
          totalTokens: 10,
          cost: 0.001,
          generations: 1,
        }),
      ],
      "session-parent-verdict",
    ),
  };

  // The parent's own day is outside the 7-day preset, so its child's verdict is
  // the selection's membership answer, not the full report's knowledge.
  const selected = projectCurrentView(view, "tree", PRESET_7);
  assert.deepEqual(
    selected.range?.agents.map((row) => [row.id, row.parent]),
    [
      [childId, "outside-range"],
      // A valid parent identity nothing materialized is the publisher's own run
      // container, never the same fact as a missing identity.
      [containerChildId, "orchestration-run"],
      [rootlessId, "none"],
    ],
  );

  // The whole window: the parent is among the selected rows.
  const all = projectCurrentView(view, "tree", {
    kind: "custom",
    from: "2026-03-01",
    to: "2026-03-10",
  });
  assert.deepEqual(
    all.range?.agents.map((row) => [row.id, row.parent]),
    [
      [parentId, "none"],
      [childId, "in-range"],
      [containerChildId, "orchestration-run"],
      [rootlessId, "none"],
    ],
  );
});

/**
 * The parent ladder, read directly so every rung is observable: no identity,
 * an identity the selection carries, one only the report carries, one that is
 * the producer's run container, and one that is not an opaque identity at all.
 */
test("the parent verdict ladder keeps every identity state distinct", () => {
  const materializedId = `subagent-${"b".repeat(64)}`;
  const containerId = `subagent-${"c".repeat(64)}`;
  const row = (id: string, parentId: string | null): AgentRow => ({
    id,
    parentId,
    agent: null,
    status: "succeeded",
    confidence: "cooperative",
    artifacts: null,
    observedAt: null,
    evidenceToolId: null,
    model: null,
    thinking: null,
    failure: null,
    usage: null,
  });
  const parent = row(materializedId, null);
  const inRange = row(`subagent-${"d".repeat(64)}`, materializedId);
  const sibling = row(`subagent-${"e".repeat(64)}`, materializedId);
  const containerChild = row(`subagent-${"f".repeat(64)}`, containerId);
  const rootless = row(`subagent-${"1".repeat(64)}`, null);
  const malformed = row(`subagent-${"2".repeat(64)}`, "not-an-opaque-id");

  const all = [parent, inRange, sibling, containerChild, rootless];
  assert.deepEqual(
    agentParentVerdicts(all, all).map((run) => [run.id, run.parent]),
    [
      [parent.id, "none"],
      [inRange.id, "in-range"],
      [sibling.id, "in-range"],
      [containerChild.id, "orchestration-run"],
      [rootless.id, "none"],
    ],
  );
  // The selection answer for a parent the full report carries, and the
  // defensive answer for a value that is not an Inspector-owned identity.
  assert.equal(agentParentVerdicts(all, [sibling])[0]?.parent, "outside-range");
  assert.equal(agentParentVerdicts(all, [malformed])[0]?.parent, "unknown");
});

/**
 * The production UAT shape: pi-subagents publishes one run id for a subagent
 * invocation (`details.runId`) and identifies each foreground child only by
 * `results[].index`. The child therefore carries a real Inspector-owned parent
 * id that no AgentRun carries: the parent is the run container itself, not an
 * agent row whose details went missing.
 */
test("the UAT aggregate shape keeps a known parent distinct from unknown", () => {
  const sessionId = "session-uat-aggregate";
  const entries: SessionEntry[] = [
    {
      id: "gen-subagent",
      parentId: null,
      timestamp: "2026-03-10T10:00:00.000Z",
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id: "call-subagent", name: "subagent" }],
      },
    },
    {
      id: "res-subagent",
      parentId: "gen-subagent",
      timestamp: "2026-03-10T10:00:05.000Z",
      type: "message",
      message: {
        role: "toolResult",
        toolCallId: "call-subagent",
        toolName: "subagent",
        details: {
          mode: "parallel",
          runId: "PRIVATE_UAT_RUN",
          results: [
            {
              index: 0,
              agent: "worker",
              exitCode: 0,
              model: "deepseek/deepseek-flash",
              thinking: "medium",
            },
          ],
        },
      },
    },
  ];
  const evidence = readSubagentEvidence(entries, sessionId);
  assert.equal(evidence.runs.length, 1);
  const child = evidence.runs[0];
  const parentId = child?.parentId;
  if (child === undefined || parentId === undefined) {
    throw new Error("the aggregate child must carry a parent identity");
  }
  // No synthetic parent AgentRun is materialized for the run container.
  assert.equal(
    evidence.runs.some((run) => run.id === parentId),
    false,
  );
  assert.equal(child.agent, "worker");
  assert.equal(child.status, "succeeded");

  const report = toSessionReport(reduceEntries(sessionId, entries), {
    agents: { state: evidence.state, runs: evidence.runs },
  });
  const view = {
    availability: "available" as const,
    report,
    daily: foldedDaily(
      [
        dateRow({
          date: "2026-03-10",
          totalTokens: 0,
          cost: 0,
          generations: 1,
        }),
      ],
      sessionId,
    ),
  };
  const projected = projectCurrentView(view, "tree", {
    kind: "custom",
    from: "2026-03-10",
    to: "2026-03-10",
  });
  assert.deepEqual(
    projected.range?.agents.map((run) => run.parent),
    ["orchestration-run"],
  );
  // Neither the raw producer run id nor a fabricated parent row reaches the
  // projection.
  assert.equal(JSON.stringify(projected).includes("PRIVATE_UAT_RUN"), false);
  assert.equal(
    projected.range?.agents.some((run) => run.id === parentId),
    false,
  );
});

/**
 * The same report projected as a current view and as a historical session: the
 * parent verdict is a property of the relationship, so a different projection
 * path (or range) can never change it.
 */
test("current and historical projections publish the same parent verdict", () => {
  const sessionId = "session-parent-parity";
  const containerId = `subagent-${"c".repeat(64)}`;
  const childId = `subagent-${"d".repeat(64)}`;
  const report = toSessionReport(
    reduceEntries(sessionId, [
      {
        type: "message",
        id: "gen-parity",
        parentId: null,
        timestamp: "2026-03-10T10:00:00.000Z",
        message: {
          role: "assistant",
          provider: "acme",
          model: "alpha",
          usage: { totalTokens: 10, cost: { total: 0.001 } },
          content: [],
        },
      },
    ]),
    {
      agents: {
        state: "supported",
        runs: [
          {
            id: childId,
            parentId: containerId,
            agent: "worker",
            status: "succeeded",
            confidence: "cooperative",
            observedAt: "2026-03-10T10:00:05.000Z",
          },
        ],
      },
    },
  );
  const rows = [
    dateRow({
      date: "2026-03-10",
      totalTokens: 10,
      cost: 0.001,
      generations: 1,
    }),
  ];
  const intent = {
    kind: "custom",
    from: "2026-03-10",
    to: "2026-03-10",
  } as const;
  const current = projectCurrentView(
    {
      availability: "available",
      report,
      daily: foldedDaily(rows, sessionId),
    },
    "tree",
    intent,
  );
  const historical = projectHistoricalSession(
    {
      availability: "available",
      sessionId,
      usageByDate: rows,
      usageByDateTruncated: false,
      datedModels: [],
      modelsTruncated: false,
      report,
    },
    intent,
  );
  assert.deepEqual(
    historical.range?.agents.map((run) => [run.id, run.parent]),
    current.range?.agents.map((run) => [run.id, run.parent]),
  );
  assert.deepEqual(
    current.range?.agents.map((run) => run.parent),
    ["orchestration-run"],
  );
});

test("the tools summary reads the newest call of a name, never its last row", () => {
  const rows = sessionView(currentModelWithOutOfOrderToolCalls().report).tools;
  // The session persisted the name's older call after its newer one, so "the
  // last row wins" would report the older instant as Last used.
  assert.deepEqual(
    rows.map((row) => row.timestamp),
    ["2026-02-01T10:00:09.000Z", "2026-02-01T10:00:00.000Z"],
  );
  assert.deepEqual(
    toolSummary({ tools: rows }).map((row) => [
      row.name,
      row.calls,
      row.lastUsed,
    ]),
    [["read", 2, "2026-02-01T10:00:09.000Z"]],
  );
});

test("one summary row groups the calls the timeline lists, with availability", () => {
  const rows = sessionView(currentModelWithTools().report).tools;

  // One row per tool name, sorted by name, each status counted separately and
  // the maximum persisted call timestamp as Last used.
  assert.deepEqual(
    toolSummary({ tools: rows }).map((row) => [
      row.name,
      row.calls,
      row.succeeded,
      row.failed,
      row.interrupted,
      row.lastUsed,
    ]),
    [
      ["bash", 1, 0, 1, 0, "2026-02-01T23:59:00.000Z"],
      ["read", 1, 1, 0, 0, "2026-03-01T10:00:00.000Z"],
    ],
  );
  // The first known source label of a name survives, even when only a later
  // call of that name attributed one.
  assert.equal(
    toolSummary({
      tools: [
        {
          name: "read",
          status: "succeeded",
          timestamp: "2026-02-01T10:00:00.000Z",
          usage: null,
        },
        {
          name: "read",
          source: "extension",
          status: "succeeded",
          timestamp: "2026-02-01T10:00:01.000Z",
          usage: null,
        },
      ],
    })[0].source,
    "extension",
  );
  // The drawn calls stay one row per call, newest first, and a selected summary
  // row narrows them to its own name (`null` is the cleared state).
  assert.deepEqual(
    toolCalls({ tools: rows }, null).map((row) => [row.name, row.timestamp]),
    [
      ["read", "2026-03-01T10:00:00.000Z"],
      ["bash", "2026-02-01T23:59:00.000Z"],
    ],
  );
  assert.deepEqual(
    toolCalls({ tools: rows }, "bash").map((row) => row.name),
    ["bash"],
  );
  // Duration is live-correlated evidence only: without supported timing the row
  // is unavailable, and no value is estimated from the call timestamps.
  assert.equal(toolDuration({ durationLabel: "42 ms" }, "unavailable"), null);
  assert.equal(toolDuration({ durationLabel: "42 ms" }, "supported"), "42 ms");
  assert.equal(toolDuration({ durationLabel: null }, "supported"), null);
});

test("an error row leads with its joined tool and states only its bounded message", () => {
  const [error] = sessionView(modelWithToolError().report).errors;
  if (error === undefined) throw new Error("the view must carry its error row");

  // The join L2 resolved is what the headline reads: the raw id stays a detail
  // of the row, and the tool's own status travels with it.
  assert.deepEqual(
    [error.id, error.toolName, error.toolSource, error.toolStatus],
    ["tool:call_bash", "bash", null, "failed"],
  );
  assert.deepEqual(errorHeadline(error), {
    key: "errors.toolFailed",
    values: { tool: "bash" },
  });
  // A tool error with no joined tool has no name to lead with, so the bounded
  // classification label takes the headline instead of a fabricated name, and a
  // generation error never joins a tool at all.
  assert.deepEqual(errorHeadline({ kind: "tool-error", toolName: null }), {
    key: "errors.failed",
    values: null,
  });
  assert.deepEqual(
    errorHeadline({ kind: "generation-error", toolName: null }),
    {
      key: "errors.generation",
      values: null,
    },
  );
  assert.equal(
    ENGLISH_CATALOG["errors.toolFailed"].replace("{tool}", "bash"),
    "bash failed",
  );

  // Only the bounded redacted DTO message is ever stated; an absent message is
  // Unavailable, never an empty string or a guess.
  assert.equal(
    errorMessage({
      kind: "tool-error",
      message: "permission denied for [PATH]",
    }),
    "permission denied for [PATH]",
  );
  assert.equal(errorMessage({ kind: "generation-error" }), null);
  assert.equal(ENGLISH_CATALOG["errors.messageUnavailable"], "Unavailable");
});

test("the label resolver separates value availability from coverage availability", () => {
  assert.deepEqual(
    aggregateUsageLabels({ availability: "available", coverage: undefined }),
    {
      cost: "coverage.unknownCompletenessCost",
      tokens: "coverage.unknownCompletenessTokens",
      usageUnavailable: false,
      sessions: "coverage.unknown",
    },
  );
  assert.equal(
    aggregateUsageLabels({ availability: "unavailable", coverage: undefined })
      .usageUnavailable,
    true,
  );
  const empty = aggregateUsageLabels({
    availability: "available",
    coverage: {
      inspected: 0,
      available: 0,
      unavailable: 0,
      sessionRatio: null,
      complete: false,
      discoveryLimited: false,
      reasons: {},
    },
  });
  assert.deepEqual(
    [empty.usageUnavailable, empty.sessions],
    [true, "coverage.none"],
  );
});

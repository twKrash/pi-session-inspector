import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type { SessionEntry } from "../../src/core/events.ts";
import { addUsage, reduceEntries } from "../../src/core/reduce.ts";
import { toSessionReport } from "../../src/core/reports.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";
import { renderJson } from "../../src/ui/json.ts";
import { selectScope } from "../../src/pi/sessions.ts";

const fixture = readFileSync(
  "tests/fixtures/pi/0.85.1/branching.jsonl",
  "utf8",
);
const compositionFixture = readFileSync(
  "tests/fixtures/pi/0.85.1/usage-composition.jsonl",
  "utf8",
);

function fixtureReport() {
  const session = parseSessionJsonl(fixture);
  return toSessionReport(
    reduceEntries(session.id, selectScope(session.entries, "e7", "tree")),
  );
}

test("retains Pi 0.85.1 input/output/cacheRead/cacheWrite token breakdown", () => {
  const report = fixtureReport();

  assert.deepEqual(report.generations[0]?.usage, {
    totalTokens: 15,
    cost: 0.03,
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  assert.deepEqual(report.usage, {
    totalTokens: 72,
    cost: 0.086,
    inputTokens: 45,
    outputTokens: 27,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
});

test("keeps absent or invalid optional token fields absent instead of zero", () => {
  const report = toSessionReport(
    reduceEntries("tokens", [
      {
        type: "message",
        id: "generation",
        parentId: null,
        timestamp: "2026-09-07T00:00:00.000Z",
        message: {
          role: "assistant",
          provider: "provider",
          model: "model",
          usage: {
            totalTokens: 5,
            cost: { total: 0.05 },
            input: -1,
            output: "many",
            cacheRead: Number.POSITIVE_INFINITY,
          },
        },
      },
    ]),
  );

  assert.equal(report.usage.totalTokens, 5);
  assert.equal(report.usage.cost, 0.05);
  assert.equal(Object.hasOwn(report.usage, "inputTokens"), false);
  assert.equal(Object.hasOwn(report.usage, "outputTokens"), false);
  assert.equal(Object.hasOwn(report.usage, "cacheReadTokens"), false);
  assert.equal(Object.hasOwn(report.usage, "cacheWriteTokens"), false);
});

test("usage composition reconciles to the session total exactly", () => {
  const report = fixtureReport();
  const { generations, toolResults, compactions, branchSummaries } =
    report.usageComposition;

  assert.deepEqual(generations, {
    totalTokens: 65,
    cost: 0.08,
    inputTokens: 42,
    outputTokens: 23,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  assert.deepEqual(toolResults, {
    totalTokens: 4,
    cost: 0.003,
    inputTokens: 2,
    outputTokens: 2,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  assert.deepEqual(compactions, {
    totalTokens: 3,
    cost: 0.003,
    inputTokens: 1,
    outputTokens: 2,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  assert.deepEqual(branchSummaries, { totalTokens: 0, cost: 0 });
  assert.deepEqual(
    addUsage(
      addUsage(addUsage(generations, toolResults), compactions),
      branchSummaries,
    ),
    report.usage,
  );
});

test("four-way composition splits compaction from branch-summary usage", () => {
  const session = parseSessionJsonl(compositionFixture);
  const report = toSessionReport(
    reduceEntries(session.id, selectScope(session.entries, "b1", "tree")),
  );
  const { generations, toolResults, compactions, branchSummaries } =
    report.usageComposition;

  assert.deepEqual(generations, {
    totalTokens: 18,
    cost: 0.03,
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 2,
    cacheWriteTokens: 1,
  });
  assert.deepEqual(toolResults, {
    totalTokens: 2,
    cost: 0.001,
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  assert.deepEqual(compactions, {
    totalTokens: 150,
    cost: 0.15,
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  assert.deepEqual(branchSummaries, {
    totalTokens: 10,
    cost: 0.01,
    inputTokens: 7,
    outputTokens: 3,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  assert.deepEqual(report.usage, {
    totalTokens: 180,
    cost: 0.191,
    inputTokens: 118,
    outputTokens: 59,
    cacheReadTokens: 2,
    cacheWriteTokens: 1,
  });
  assert.deepEqual(
    addUsage(
      addUsage(addUsage(generations, toolResults), compactions),
      branchSummaries,
    ),
    report.usage,
  );
  // Branch summaries stay in the compactions array for ledger/count consumers.
  assert.deepEqual(
    report.compactions.map((item) => item.id),
    ["compaction:c1", "compaction:b1"],
  );
});

test("tool usage is absent without result evidence and observed zero stays zero", () => {
  const entries: SessionEntry[] = [
    {
      type: "message",
      id: "generation-a",
      parentId: null,
      timestamp: "2026-09-07T00:00:00.000Z",
      message: {
        role: "assistant",
        provider: "provider",
        model: "model",
        content: [{ type: "toolCall", id: "call-a", name: "read" }],
        usage: { totalTokens: 5, cost: { total: 0.01 } },
      },
    },
    {
      type: "message",
      id: "generation-b",
      parentId: null,
      timestamp: "2026-09-07T00:00:01.000Z",
      message: {
        role: "assistant",
        provider: "provider",
        model: "model",
        content: [{ type: "toolCall", id: "call-b", name: "read" }],
        usage: { totalTokens: 5, cost: { total: 0.01 } },
      },
    },
    {
      type: "message",
      id: "result-b",
      parentId: null,
      timestamp: "2026-09-07T00:00:02.000Z",
      message: {
        role: "toolResult",
        toolCallId: "call-b",
        isError: false,
        usage: { totalTokens: 0, cost: { total: 0 } },
      },
    },
  ];
  const report = toSessionReport(reduceEntries("tools", entries));
  const callA = report.tools.find((tool) => tool.id === "tool:call-a");
  const callB = report.tools.find((tool) => tool.id === "tool:call-b");

  assert.equal(callA?.status, "interrupted");
  assert.equal(callA?.usage, undefined);
  assert.equal(Object.hasOwn(callA ?? {}, "usage"), false);
  assert.deepEqual(callB?.usage, { totalTokens: 0, cost: 0 });
});

function toolSession(resultUsage: unknown): SessionEntry[] {
  return [
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
      message: {
        role: "toolResult",
        toolCallId: "call-a",
        isError: false,
        ...(resultUsage === undefined ? {} : { usage: resultUsage }),
      },
    },
  ];
}

test("tool usage stays absent when a result carries no valid usage record", () => {
  for (const resultUsage of [
    undefined,
    { totalTokens: 7 },
    { cost: { total: 0.007 } },
  ]) {
    const report = toSessionReport(
      reduceEntries("missing-result-usage", toolSession(resultUsage)),
    );
    const tool = report.tools.find((item) => item.id === "tool:call-a");
    const json = JSON.parse(renderJson(report)) as {
      tools: Array<Record<string, unknown>>;
    };

    assert.equal(tool?.status, "succeeded");
    assert.equal(Object.hasOwn(tool ?? {}, "usage"), false);
    assert.equal(Object.hasOwn(json.tools[0] ?? {}, "usage"), false);
    assert.deepEqual(report.usage, { totalTokens: 4, cost: 0.004 });
    assert.deepEqual(report.usageComposition.toolResults, {
      totalTokens: 0,
      cost: 0,
    });
  }
});

test("a duplicate tool result for one call id accumulates usage once", () => {
  const entries = toolSession({ totalTokens: 4, cost: { total: 0.004 } });
  entries.push({
    type: "message",
    id: "result-duplicate",
    parentId: null,
    timestamp: "2026-09-07T00:00:02.000Z",
    message: {
      role: "toolResult",
      toolCallId: "call-a",
      isError: false,
      usage: { totalTokens: 9, cost: { total: 0.009 } },
    },
  });
  const report = toSessionReport(reduceEntries("duplicate-result", entries));

  assert.equal(report.tools.length, 1);
  assert.deepEqual(report.tools[0]?.usage, { totalTokens: 4, cost: 0.004 });
  assert.deepEqual(report.usage, { totalTokens: 8, cost: 0.008 });
  assert.deepEqual(report.usageComposition.toolResults, {
    totalTokens: 4,
    cost: 0.004,
  });
});

test("a later duplicate result supplies usage the first result omitted", () => {
  const entries = toolSession(undefined);
  entries.push({
    type: "message",
    id: "result-duplicate",
    parentId: null,
    timestamp: "2026-09-07T00:00:02.000Z",
    message: {
      role: "toolResult",
      toolCallId: "call-a",
      isError: false,
      usage: { totalTokens: 7, cost: { total: 0.007 } },
    },
  });
  const report = toSessionReport(reduceEntries("late-result-usage", entries));

  assert.equal(report.tools.length, 1);
  assert.equal(report.tools[0]?.status, "succeeded");
  assert.deepEqual(report.tools[0]?.usage, { totalTokens: 7, cost: 0.007 });
  assert.deepEqual(report.usage, { totalTokens: 11, cost: 0.011 });
  assert.deepEqual(report.usageComposition.toolResults, {
    totalTokens: 7,
    cost: 0.007,
  });
});

test("the first result still decides status when a later duplicate adds usage", () => {
  const entries: SessionEntry[] = [
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
      message: {
        role: "toolResult",
        toolCallId: "call-a",
        isError: true,
      },
    },
    {
      type: "message",
      id: "result-duplicate",
      parentId: null,
      timestamp: "2026-09-07T00:00:02.000Z",
      message: {
        role: "toolResult",
        toolCallId: "call-a",
        isError: false,
        usage: { totalTokens: 7, cost: { total: 0.007 } },
      },
    },
  ];
  const report = toSessionReport(reduceEntries("late-result-status", entries));

  assert.equal(report.tools[0]?.status, "failed");
  assert.deepEqual(report.tools[0]?.usage, { totalTokens: 7, cost: 0.007 });
  assert.deepEqual(report.usage, { totalTokens: 11, cost: 0.011 });
  assert.deepEqual(report.usageComposition.toolResults, {
    totalTokens: 7,
    cost: 0.007,
  });
  assert.deepEqual(
    report.errors.filter((error) => error.kind === "tool-error"),
    [
      {
        id: "tool:call-a",
        timestamp: "2026-09-07T00:00:01.000Z",
        kind: "tool-error",
        confidence: "native",
      },
    ],
  );
});

test("bounds out-of-range usage instead of propagating it", () => {
  const entries = toolSession({ totalTokens: 1e308, cost: { total: 1e308 } });
  entries.push({
    type: "compaction",
    id: "compaction",
    parentId: null,
    timestamp: "2026-09-07T00:00:02.000Z",
    usage: { totalTokens: 5, cost: { total: 0.05 } },
  });
  const report = toSessionReport(reduceEntries("bounded", entries));

  assert.equal(Object.hasOwn(report.tools[0] ?? {}, "usage"), false);
  assert.deepEqual(report.usage, { totalTokens: 9, cost: 0.054 });
  assert.deepEqual(report.usageComposition.toolResults, {
    totalTokens: 0,
    cost: 0,
  });
  assert.equal(Number.isFinite(report.usage.cost), true);
});

test("addUsage keeps totals finite and safe when a part is out of range", () => {
  const safe = { totalTokens: Number.MAX_SAFE_INTEGER, cost: 0 };

  assert.deepEqual(addUsage(safe, { totalTokens: 1, cost: 0 }), safe);
  assert.deepEqual(
    addUsage({ totalTokens: 1, cost: 1 }, { totalTokens: 1e308, cost: 0 }),
    { totalTokens: 1, cost: 1 },
  );
  assert.equal(
    Number.isSafeInteger(
      addUsage(safe, { totalTokens: 1, cost: 0 }).totalTokens,
    ),
    true,
  );
});

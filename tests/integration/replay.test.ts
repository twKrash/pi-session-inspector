import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildLedger } from "../../src/core/ledger.ts";
import { reduceEntries } from "../../src/core/reduce.ts";
import { toSessionReport } from "../../src/core/reports.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";
import { selectScope } from "../../src/pi/sessions.ts";
import { renderHtml } from "../../src/ui/html.ts";
import { renderJson } from "../../src/ui/json.ts";

const fixture = readFileSync(
  "tests/fixtures/pi/0.85.1/branching.jsonl",
  "utf8",
);
const trackingBoundaryFixture = readFileSync(
  "tests/fixtures/pi/0.85.1/tracking-boundary.jsonl",
  "utf8",
);

test("replays active branch without counting sibling usage", () => {
  const session = parseSessionJsonl(fixture);
  const entries = selectScope(session.entries, "e7", "active");
  const report = toSessionReport(reduceEntries(session.id, entries));

  assert.equal(session.unknownEntryCount, 1);
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["e1", "e2", "e7"],
  );
  assert.equal(report.usage.totalTokens, 30);
  assert.equal(report.usage.cost, 0.03);
  assert.equal(report.tools[0]?.id, "tool:call-2");
  assert.equal(report.tools[0]?.status, "interrupted");
});

test("uses the earliest valid tracking marker as the active scope boundary", () => {
  const session = parseSessionJsonl(trackingBoundaryFixture);
  const entries = selectScope(session.entries, "active-leaf", "active");

  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["active-parent", "active-leaf"],
  );
  assert.equal(reduceEntries(session.id, entries).usage.totalTokens, 100);
});

test("counts persisted branch-summary usage exactly once", () => {
  const report = toSessionReport(
    reduceEntries("branch-summary", [
      {
        type: "branch_summary",
        id: "summary",
        parentId: null,
        timestamp: "2026-09-07T00:00:00.000Z",
        usage: { totalTokens: 17, cost: { total: 0.17 } },
      },
    ]),
  );

  assert.deepEqual(report.usage, { totalTokens: 17, cost: 0.17 });
  assert.deepEqual(report.compactions, [
    {
      id: "compaction:summary",
      timestamp: "2026-09-07T00:00:00.000Z",
      usage: { totalTokens: 17, cost: 0.17 },
    },
  ]);
});

test("redacts and bounds producer provider, model, and tool names in JSON and HTML", () => {
  const secret = "provider-secret-token-should-not-appear";
  const unbounded = "x".repeat(1024);
  const report = toSessionReport(
    reduceEntries("privacy-session", [
      {
        type: "message",
        id: "assistant",
        parentId: null,
        timestamp: "2026-09-07T00:00:00.000Z",
        message: {
          role: "assistant",
          provider: secret,
          model: unbounded,
          usage: { totalTokens: 1, cost: { total: 0.01 } },
          content: [{ type: "toolCall", id: "call", name: secret }],
        },
      },
    ]),
  );
  const json = renderJson(report);
  const html = renderHtml({ kind: "current", report, scope: "tree" });

  assert.equal(json.includes(secret), false);
  assert.equal(json.includes(unbounded), false);
  assert.equal(html.includes(secret), false);
  assert.equal(html.includes(unbounded), false);
});

test("returns no active selection when Pi has no active leaf", () => {
  const session = parseSessionJsonl(trackingBoundaryFixture);

  assert.deepEqual(selectScope(session.entries, null, "active"), []);
  assert.deepEqual(
    selectScope(session.entries, null, "tree").map((entry) => entry.id),
    ["active-parent", "abandoned-sibling", "duplicate-marker", "active-leaf"],
  );
});

test("uses the earliest marker for tree scope despite later duplicates", () => {
  const session = parseSessionJsonl(trackingBoundaryFixture);
  const entries = selectScope(session.entries, "active-leaf", "tree");

  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["active-parent", "abandoned-sibling", "duplicate-marker", "active-leaf"],
  );
  assert.equal(reduceEntries(session.id, entries).usage.totalTokens, 150);
});

test("ignores malformed tracking markers", () => {
  const session = parseSessionJsonl(trackingBoundaryFixture);
  const malformedOnlyEntries = session.entries.slice(0, 4);

  assert.deepEqual(
    selectScope(malformedOnlyEntries, "pre-boundary", "tree").map(
      (entry) => entry.id,
    ),
    ["old-root", "old-parent", "malformed-marker", "pre-boundary"],
  );
});

test("replays full tree exactly once and emits stable JSON and ledger", () => {
  const session = parseSessionJsonl(fixture);
  const report = toSessionReport(
    reduceEntries(session.id, selectScope(session.entries, "e7", "tree")),
  );

  assert.equal(report.usage.totalTokens, 72);
  assert.equal(report.usage.cost, 0.086);
  assert.deepEqual(report.models, [
    {
      provider: "acme",
      model: "alpha",
      generations: 3,
      totalTokens: 65,
      cost: 0.08,
    },
  ]);
  assert.deepEqual(
    report.tools.map((tool) => [tool.id, tool.status]),
    [
      ["tool:call-1", "succeeded"],
      ["tool:call-2", "interrupted"],
    ],
  );
  assert.deepEqual(
    buildLedger(report).map((item) => item.id),
    [
      "generation:e3",
      "tool:call-1",
      "compaction:e5",
      "generation:e6",
      "generation:e7",
      "tool:call-2",
    ],
  );
  assert.equal(renderJson(report), renderJson(report));
  assert.equal(
    renderJson(report),
    readFileSync("tests/fixtures/reports/tree.json", "utf8"),
  );
});

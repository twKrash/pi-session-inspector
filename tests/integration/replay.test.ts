import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildLedger } from "../../src/core/ledger.ts";
import { reduceEntries } from "../../src/core/reduce.ts";
import { toSessionReport } from "../../src/core/reports.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";
import { selectScope } from "../../src/pi/sessions.ts";
import { renderJson } from "../../src/ui/json.ts";

const fixture = readFileSync(
  "tests/fixtures/pi/0.85.1/branching.jsonl",
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

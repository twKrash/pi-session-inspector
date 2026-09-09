import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { readSubagentRuns } from "../../src/integrations/subagents.ts";

type Fixture = Record<string, unknown>;

const fixturePath = new URL(
  "../fixtures/integrations/subagents.json",
  import.meta.url,
);

async function fixture(): Promise<Fixture> {
  return JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
}

test("rolls up explicit foreground and nested public artifacts non-additively", async () => {
  const values = await fixture();
  const result = readSubagentRuns(values.foreground);
  const parentUsage = { totalTokens: 100, cost: 10 };

  assert.equal(result.state, "supported");
  assert.match(result.runs[0]?.id ?? "", /^subagent-[a-f0-9]{64}$/);
  assert.match(result.runs[0]?.parentId ?? "", /^subagent-[a-f0-9]{64}$/);
  assert.equal(result.runs[1]?.parentId, result.runs[0]?.id);
  assert.equal(
    result.runs.reduce((sum, run) => sum + (run.usage?.cost ?? 0), 0),
    3,
  );
  assert.equal(parentUsage.cost, 10);
  assert.deepEqual(
    result.runs.map((run) => run.confidence),
    ["cooperative", "cooperative"],
  );
});

test("maps public async, status, and tool-result variants", async () => {
  const values = await fixture();

  const asyncRuns = readSubagentRuns(values.async).runs;
  assert.equal(asyncRuns.length, 1);
  assert.match(asyncRuns[0]?.id ?? "", /^subagent-[a-f0-9]{64}$/);
  assert.match(asyncRuns[0]?.parentId ?? "", /^subagent-[a-f0-9]{64}$/);
  assert.equal(asyncRuns[0]?.status, "running");
  assert.equal(asyncRuns[0]?.confidence, "cooperative");
  assert.deepEqual(
    readSubagentRuns(values.status).runs.map((run) => run.status),
    ["running", "interrupted", "unknown", "unknown"],
  );
  assert.deepEqual(readSubagentRuns(values.toolResult).runs[0]?.usage, {
    totalTokens: 12,
    cost: 0.5,
  });
});

test("returns unavailable or unsupported without guessed runs", async () => {
  const values = await fixture();

  assert.deepEqual(readSubagentRuns(undefined), {
    state: "unavailable",
    runs: [],
  });
  for (const value of [
    values.malformed,
    values.missingLink,
    values.unknownVersion,
    {
      version: 1,
      runs: Array.from({ length: 257 }, (_, index) => ({
        id: `child-${index}`,
        parentId: "parent-run",
        status: "complete",
      })),
    },
  ]) {
    assert.deepEqual(readSubagentRuns(value), {
      state: "unsupported",
      runs: [],
    });
  }
});

test("omits invalid usage and never retains producer-only fields", () => {
  const invalidUsage = readSubagentRuns({
    version: 1,
    runs: [
      {
        id: "child",
        parentId: "parent-run",
        status: "complete",
        usage: { totalTokens: -1, cost: 1 },
      },
    ],
  });
  const privateArtifact = readSubagentRuns({
    version: 1,
    runs: [
      {
        id: "child",
        parentId: "parent-run",
        status: "complete",
        result: "raw-tool-result-sentinel",
      },
    ],
  });

  assert.equal(invalidUsage.state, "supported");
  assert.equal(invalidUsage.runs[0]?.usage, undefined);
  assert.equal(
    JSON.stringify(privateArtifact).includes("raw-tool-result-sentinel"),
    false,
  );
  assert.deepEqual(privateArtifact, { state: "unsupported", runs: [] });
});

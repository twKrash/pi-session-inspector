import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { join } from "node:path";
import { test } from "node:test";
import {
  readPublicSubagentArtifact,
  readSubagentRuns,
} from "../../src/integrations/subagents.ts";

type Fixture = Record<string, unknown>;

const fixturePath = new URL(
  "../fixtures/integrations/subagents.json",
  import.meta.url,
);
const execFile = promisify(execFileCallback);

async function fixture(): Promise<Fixture> {
  return JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
}

test("reads only bounded valid local public artifacts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const valid = join(directory, "artifact.json");
  const invalid = join(directory, "invalid.json");
  const oversized = join(directory, "oversized.json");
  await writeFile(valid, '{"version":1,"runs":[]}');
  await writeFile(invalid, "not JSON");
  await writeFile(oversized, " ".repeat(128 * 1024 + 1));

  assert.deepEqual(await readPublicSubagentArtifact(valid), {
    version: 1,
    runs: [],
  });
  assert.equal(await readPublicSubagentArtifact(invalid), undefined);
  assert.equal(await readPublicSubagentArtifact(oversized), undefined);
  assert.equal(
    await readPublicSubagentArtifact(join(directory, "missing")),
    undefined,
  );
});

test(
  "returns unavailable promptly for a Linux FIFO artifact path",
  { skip: process.platform !== "linux" },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
    const fifo = join(directory, "artifact.fifo");
    await execFile("mkfifo", [fifo]);

    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        readPublicSubagentArtifact(fifo),
        new Promise<"timed out">((resolve) => {
          timer = setTimeout(() => resolve("timed out"), 250);
        }),
      ]);
      if (timer !== undefined) clearTimeout(timer);
      assert.equal(result, undefined);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  },
);

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

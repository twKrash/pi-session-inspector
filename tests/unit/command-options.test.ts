import assert from "node:assert/strict";
import { test } from "node:test";

import { openReport, parseReportCommand } from "../../src/index.ts";

test("parses documented report commands independently from renderer and scope", () => {
  assert.deepEqual(parseReportCommand(""), {
    kind: "current",
    scope: "active",
    format: "tui",
    noOpen: false,
  });
  assert.deepEqual(
    parseReportCommand(
      "history --scope tree --format json --output 'report file.json'",
    ),
    {
      kind: "history",
      scope: "tree",
      format: "json",
      output: "report file.json",
      noOpen: false,
    },
  );
  assert.deepEqual(parseReportCommand("global --no-open"), {
    kind: "global",
    scope: "tree",
    format: "html",
    noOpen: true,
  });
});

test("uses argv-safe platform opening and exposes opener failure to the command boundary", async () => {
  const calls: Array<[string, string[]]> = [];
  const opener = {
    exec: async (command: string, args: string[]) => {
      calls.push([command, args]);
      throw new Error("no browser");
    },
  };
  await assert.rejects(openReport(opener, "/tmp/report with spaces.html"));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.[1].at(-1), "/tmp/report with spaces.html");
});

test("rejects malformed, unsupported durable scopes, and unknown report options safely", () => {
  for (const input of [
    "unknown",
    "history --scope active",
    "global --scope active",
    "current --scope branch",
    "--format pdf",
    "global --output",
    "current 'unterminated",
  ]) {
    assert.equal(parseReportCommand(input), undefined, input);
  }
});

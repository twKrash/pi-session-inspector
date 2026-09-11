import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import type { SessionEntry } from "../../src/core/events.ts";
import { buildLedger } from "../../src/core/ledger.ts";
import { reduceEntries } from "../../src/core/reduce.ts";
import { toSessionReport } from "../../src/core/reports.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";
import { renderJson } from "../../src/ui/json.ts";

const errorMessageFixture = new URL(
  "../fixtures/pi/0.85.1/error-message.jsonl",
  import.meta.url,
);

function assistant(
  id: string,
  timestamp: string,
  stopReason: string,
  content: unknown[] = [],
): SessionEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp,
    message: {
      role: "assistant",
      provider: "acme",
      model: "alpha",
      content,
      stopReason,
      usage: { totalTokens: 1, cost: { total: 0.01 } },
    },
  };
}

test("classifies persisted generation stop state into bounded error kinds", () => {
  const report = toSessionReport(
    reduceEntries("errors", [
      assistant("g-error", "2026-01-01T00:00:01.000Z", "error"),
      assistant("g-aborted", "2026-01-01T00:00:02.000Z", "aborted"),
      assistant("g-length", "2026-01-01T00:00:03.000Z", "length"),
      assistant("g-stop", "2026-01-01T00:00:05.000Z", "stop"),
      assistant("g-tool", "2026-01-01T00:00:06.000Z", "toolUse"),
    ]),
  );

  assert.deepEqual(report.errors, [
    {
      id: "generation:g-error",
      timestamp: "2026-01-01T00:00:01.000Z",
      kind: "generation-error",
      confidence: "native",
    },
    {
      id: "generation:g-aborted",
      timestamp: "2026-01-01T00:00:02.000Z",
      kind: "generation-aborted",
      confidence: "native",
    },
    {
      id: "generation:g-length",
      timestamp: "2026-01-01T00:00:03.000Z",
      kind: "generation-length",
      confidence: "native",
    },
  ]);
});

test("emits no error record for an unrecognised stop reason and never leaks it", () => {
  const report = toSessionReport(
    reduceEntries("unlisted", [
      assistant("g-end-turn", "2026-01-01T00:00:04.000Z", "end_turn"),
      assistant("g-weird", "2026-01-01T00:00:05.000Z", "kaboom-secret-reason"),
    ]),
  );

  // An unlisted term degrades to absent rather than being guessed as an error.
  assert.deepEqual(report.errors, []);
  // Only bounded classifications reach the DTO; the raw stop reason never does.
  assert.equal(renderJson(report).includes("kaboom-secret-reason"), false);
  assert.equal(renderJson(report).includes("end_turn"), false);
});

test("records tool-result errors without copying result content", () => {
  const report = toSessionReport(
    reduceEntries("tool-errors", [
      assistant("g1", "2026-01-01T00:00:01.000Z", "toolUse", [
        { type: "toolCall", id: "call-x", name: "read" },
      ]),
      {
        type: "message",
        id: "r1",
        parentId: null,
        timestamp: "2026-01-01T00:00:02.000Z",
        message: {
          role: "toolResult",
          toolCallId: "call-x",
          isError: true,
          content: "raw-error-sentinel",
          usage: { totalTokens: 1, cost: { total: 0.01 } },
        },
      },
    ]),
  );

  assert.deepEqual(report.errors, [
    {
      id: "tool:call-x",
      timestamp: "2026-01-01T00:00:02.000Z",
      kind: "tool-error",
      confidence: "native",
    },
  ]);
  assert.equal(renderJson(report).includes("raw-error-sentinel"), false);
});

test("exposes only the bounded redacted persisted error message", async () => {
  const { entries } = parseSessionJsonl(
    await readFile(errorMessageFixture, "utf8"),
  );
  const reduced = reduceEntries("error-session", entries);
  const message = reduced.errors.find(
    (error) => error.kind === "generation-error",
  )?.message;

  assert.equal(message?.includes("429 rate limit"), true);
  assert.equal(message?.includes("PRIVATE"), false);
  assert.equal(message?.includes("http"), false);
  assert.equal(message?.includes("/home/dev"), false);
  assert.equal(
    JSON.stringify(reduced.errors).includes("PRIVATE_TOOL_BODY"),
    false,
  );
});

test("omits the message field when no usable persisted error message exists", () => {
  const report = toSessionReport(
    reduceEntries("no-message", [
      assistant("g-error", "2026-01-01T00:00:01.000Z", "error"),
      assistant("g-redacted", "2026-01-01T00:00:02.000Z", "error", []),
    ]),
  );

  assert.deepEqual(
    report.errors.map((error) => "message" in error),
    [false, false],
  );
});

test("reports no error records when persisted state is a normal completion", () => {
  const report = toSessionReport(
    reduceEntries("clean", [
      assistant("g1", "2026-01-01T00:00:01.000Z", "stop"),
    ]),
  );

  assert.deepEqual(report.errors, []);
});

test("shared ledger projection covers every record kind and stays sorted", () => {
  const report = toSessionReport(
    reduceEntries("ledger", [
      assistant("g1", "2026-01-01T00:00:01.000Z", "error", [
        { type: "toolCall", id: "call-a", name: "read" },
      ]),
      {
        type: "message",
        id: "r1",
        parentId: null,
        timestamp: "2026-01-01T00:00:02.000Z",
        message: {
          role: "toolResult",
          toolCallId: "call-a",
          isError: true,
          usage: { totalTokens: 1, cost: { total: 0.01 } },
        },
      },
      {
        type: "compaction",
        id: "c1",
        parentId: null,
        timestamp: "2026-01-01T00:00:03.000Z",
        usage: { totalTokens: 2, cost: { total: 0.02 } },
      },
      {
        type: "branch_summary",
        id: "b1",
        parentId: null,
        timestamp: "2026-01-01T00:00:04.000Z",
        usage: { totalTokens: 3, cost: { total: 0.03 } },
      },
    ]),
  );

  const ledger = buildLedger(report);

  assert.deepEqual(
    ledger.map((item) => item.kind),
    ["generation", "error", "tool", "error", "compaction", "branchSummary"],
  );
  assert.deepEqual(Object.keys(ledger[0] ?? {}).sort(), [
    "confidence",
    "id",
    "kind",
    "status",
    "timestamp",
  ]);
  assert.deepEqual(ledger[0], {
    id: "generation:g1",
    timestamp: "2026-01-01T00:00:01.000Z",
    kind: "generation",
    status: "completed",
    confidence: "native",
  });
  assert.equal(
    ledger.find((item) => item.kind === "branchSummary")?.status,
    "recorded",
  );
  assert.deepEqual(
    ledger,
    [...ledger].sort(
      (a, b) =>
        a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id),
    ),
  );
});

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { buildCanonicalSession } from "../../src/core/canonical.ts";
import type { LiveTimingObservation } from "../../src/core/evidence.ts";
import { canonicalOpaqueDigest } from "../../src/core/opaque-id.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";
import { configureDebugLog, resetDebugLog } from "../../src/debug/log.ts";
import { recoverSession } from "../../src/storage/recovery.ts";

/**
 * Debug volume regression from the production UAT: one report read over a
 * healthy session wrote thousands of `wal-replayed` / `canonical-correlated`
 * lines, because every projection replayed the same immutable evidence one
 * record at a time. A healthy replay or correlation must report itself once;
 * the per-record events stay reserved for the anomalies an operator acts on.
 */

/** Every captured debug line, in emission order. */
function capture(): string[] {
  const lines: string[] = [];
  configureDebugLog({ enabled: true, sink: (line) => lines.push(line) });
  return lines;
}

function events(lines: readonly string[]): string[] {
  return lines.map((line) => (JSON.parse(line) as { event: string }).event);
}

function only(lines: readonly string[], event: string): Record<string, unknown> {
  const matching = lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((entry) => entry.event === event);
  assert.equal(matching.length, 1, `expected exactly one ${event} event`);
  return matching[0] ?? {};
}

const WAL_WRITER = "writer-debug";
const HEALTHY_RECORDS = 40;
const TELEMETRY_RECORDS = 3;

function telemetryRecord(sequence: number): Record<string, unknown> {
  return {
    eventId: `event-${sequence}`,
    timestamp: "2026-09-15T10:00:00.000Z",
    writerId: WAL_WRITER,
    writerSequence: sequence,
    kind: "telemetry",
    telemetry: {
      schemaVersion: 1,
      source: "example",
      metric: "example.metric",
      kind: "counter",
      value: 1,
      timestamp: Math.round(Date.parse("2026-09-15T10:00:00.000Z")),
    },
  };
}

function timingRecord(sequence: number, subjectId: string): Record<string, unknown> {
  return {
    eventId: `event-${sequence}`,
    timestamp: "2026-09-15T10:00:00.000Z",
    writerId: WAL_WRITER,
    writerSequence: sequence,
    kind: "live_timing",
    timing: {
      category: "tool",
      status: "unknown",
      confidence: "live",
      subjectId,
      startedAt: "2026-09-15T10:00:00.000Z",
      endedAt: "2026-09-15T10:00:01.000Z",
      durationMs: 1000,
    },
  };
}

async function writeSessionDirectory(
  sessionId: string,
  records: readonly Record<string, unknown>[],
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "inspector-debug-volume-"));
  const shard = join(root, "sessions", sessionId, "wal", WAL_WRITER);
  await mkdir(shard, { recursive: true });
  await writeFile(
    join(shard, "2026-09-15.jsonl"),
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );
  return root;
}

test("a healthy replay reports one summary instead of one event per record", async () => {
  const sessionId = "debug-replay";
  const records = [
    ...Array.from({ length: HEALTHY_RECORDS }, (_, index) =>
      timingRecord(index + 1, `live-tool-${"a".repeat(64)}`),
    ),
    ...Array.from({ length: TELEMETRY_RECORDS }, (_, index) =>
      telemetryRecord(HEALTHY_RECORDS + index + 1),
    ),
  ];
  const root = await writeSessionDirectory(sessionId, records);
  const lines = capture();
  try {
    await recoverSession({
      directory: join(root, "sessions", sessionId),
      piCursor: { lineCount: 0, revision: "0".repeat(64) },
    });
  } finally {
    resetDebugLog();
    await rm(root, { recursive: true, force: true });
  }

  assert.deepEqual(events(lines), ["replay-summary"]);
  assert.deepEqual(only(lines, "replay-summary"), {
    schemaVersion: 1,
    component: "tool-timing",
    event: "replay-summary",
    records: HEALTHY_RECORDS + TELEMETRY_RECORDS,
    timingRecords: HEALTHY_RECORDS,
    telemetryRecords: TELEMETRY_RECORDS,
    timedRecords: HEALTHY_RECORDS,
    running: 0,
    zeroDuration: 0,
    found: true,
  });
});

test("an unavailable replay keeps its own anomaly event", async () => {
  const sessionId = "debug-unavailable";
  const root = await writeSessionDirectory(sessionId, []);
  const shard = join(
    root,
    "sessions",
    sessionId,
    "wal",
    WAL_WRITER,
    "2026-09-15.jsonl",
  );
  await writeFile(shard, '{"not":"a record"}\n');
  const lines = capture();
  try {
    await recoverSession({
      directory: join(root, "sessions", sessionId),
      piCursor: { lineCount: 0, revision: "0".repeat(64) },
    });
  } finally {
    resetDebugLog();
    await rm(root, { recursive: true, force: true });
  }

  assert.deepEqual(events(lines), ["replay-unavailable"]);
});

const HEADER = { type: "session", version: 3, id: "debug-correlation" };
const MARKER = {
  type: "custom",
  id: "marker",
  parentId: null,
  timestamp: "2026-09-15T10:00:00.000Z",
  customType: "session-inspector:tracking-start",
  data: { schemaVersion: 1 },
};

/** One generation carrying `count` tool calls, in persisted order. */
function generations(count: number): object[] {
  return [
    {
      type: "message",
      id: "gen-1",
      parentId: "marker",
      timestamp: "2026-09-15T10:00:01.000Z",
      message: {
        role: "assistant",
        provider: "example",
        model: "example",
        usage: { totalTokens: 10, cost: { total: 0.01 } },
        content: Array.from({ length: count }, (_, index) => ({
          type: "toolCall",
          id: `call-${index}`,
          name: "bash",
        })),
      },
    },
  ];
}

function liveFact(
  sessionId: string,
  callId: string,
  durationMs = 1000,
): LiveTimingObservation {
  return {
    factId: `live-timing:${callId}`,
    sessionId,
    kind: "live-timing",
    category: "tool",
    status: "complete",
    subjectId: `live-tool-${canonicalOpaqueDigest("live-tool", sessionId, callId)}`,
    startedAt: "2026-09-15T10:00:01.000Z",
    endedAt: "2026-09-15T10:00:02.000Z",
    durationMs,
    provenance: { source: "inspector-wal", authority: "live", schemaVersion: 1 },
    time: { state: "known", at: "2026-09-15T10:00:02.000Z", basis: "wal-observer" },
  };
}

function buildCorrelated(
  sessionId: string,
  toolCalls: number,
  facts: readonly LiveTimingObservation[],
) {
  return buildCanonicalSession({
    parsed: parseSessionJsonl(
      [
        { ...HEADER, id: sessionId },
        MARKER,
        ...generations(toolCalls),
      ]
        .map((record) => JSON.stringify(record))
        .join("\n") + "\n",
    ),
    scope: "tree",
    leafId: null,
    evidence: { atomic: [...facts], folded: [] },
  });
}

test("a healthy correlation reports one summary and no per-call event", () => {
  const sessionId = "debug-correlated";
  const callCount = 30;
  const facts = Array.from({ length: callCount }, (_, index) =>
    liveFact(sessionId, `call-${index}`),
  );
  const lines = capture();
  try {
    const result = buildCorrelated(sessionId, callCount, facts);
    assert.equal(result.state, "ready");
  } finally {
    resetDebugLog();
  }

  const timing = lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((entry) => entry.component === "tool-timing");
  assert.deepEqual(
    timing.map((entry) => entry.event),
    ["correlation-summary"],
  );
  assert.deepEqual(only(lines, "correlation-summary"), {
    schemaVersion: 1,
    component: "tool-timing",
    event: "correlation-summary",
    tools: callCount,
    correlated: callCount,
    uncorrelated: 0,
    records: callCount,
    found: true,
  });
});

test("an uncorrelated call keeps one bounded anomaly event per operation", () => {
  const sessionId = "debug-uncorrelated";
  const callCount = 12;
  // Exactly one call has a live boundary, so eleven rows stay uncorrelated and
  // the capped anomaly events must not scale past the cap.
  const facts = [liveFact(sessionId, "call-0")];
  const lines = capture();
  try {
    const result = buildCorrelated(sessionId, callCount, facts);
    assert.equal(result.state, "ready");
  } finally {
    resetDebugLog();
  }

  const summary = only(lines, "correlation-summary");
  assert.equal(summary.correlated, 1);
  assert.equal(summary.uncorrelated, callCount - 1);
  const uncorrelated = events(lines).filter(
    (event) => event === "canonical-uncorrelated",
  );
  assert.equal(uncorrelated.length, 8);
  assert.equal(
    events(lines).includes("canonical-correlated"),
    false,
    "a correlated call must never publish a per-call event",
  );
});

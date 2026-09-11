import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { reduceEntries } from "../../src/core/reduce.ts";
import { toSessionReport } from "../../src/core/reports.ts";
import {
  durationEvidenceFromRecoveredRuns,
  maintainSession,
} from "../../src/storage/maintenance.ts";

test("report duration evidence defaults to unavailable without correlation", () => {
  const report = toSessionReport(reduceEntries("duration", []));

  assert.equal(report.durationEvidence, "unavailable");
});

test("projects only correlated tool durations and drops forged rows", () => {
  const reduced = reduceEntries("duration", [
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
        usage: { totalTokens: 5, cost: { total: 0.01 } },
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
        usage: { totalTokens: 5, cost: { total: 0.01 } },
      },
    },
  ]);

  const report = toSessionReport(reduced, {
    duration: {
      state: "supported",
      tools: [
        { id: "tool:call-a", durationMs: 42 },
        { id: "tool:missing", durationMs: 7 },
        { id: "tool:call-a", durationMs: -3 },
        { id: "raw-secret-tool-id", durationMs: 9 },
      ],
    },
  });

  assert.equal(report.durationEvidence, "supported");
  assert.equal(report.tools[0]?.durationMs, 42);
  assert.equal(JSON.stringify(report).includes("raw-secret-tool-id"), false);
});

test("anonymous live WAL timing cannot be correlated to a Pi tool", () => {
  assert.equal(
    durationEvidenceFromRecoveredRuns([
      {
        eventId: "start-1",
        category: "tool",
        startedAt: "2026-09-07T00:00:00.000Z",
        status: "running",
      },
    ]),
    "unavailable",
  );
  assert.equal(durationEvidenceFromRecoveredRuns([]), "unavailable");
});

test("maintenance threads anonymous timing evidence through as unavailable", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-duration-"));
  try {
    const sessionId = "session-1";
    const source = join(root, "session.jsonl");
    const directory = join(root, "sessions", sessionId);
    await mkdir(join(directory, "wal", "writer-1"), { recursive: true });
    await writeFile(
      source,
      `${[
        '{"id":"marker","parentId":null,"timestamp":"2026-09-07T12:00:00.000Z","type":"custom","customType":"session-inspector:tracking-start","data":{"schemaVersion":1}}',
        '{"id":"assistant","parentId":"marker","timestamp":"2026-09-07T12:00:01.000Z","type":"message","message":{"role":"assistant","provider":"provider","model":"model","usage":{"totalTokens":9,"cost":{"total":0.02}}}}',
      ].join("\n")}\n`,
    );
    await writeFile(
      join(directory, "wal", "writer-1", "2026-09-07.jsonl"),
      '{"eventId":"start-1","timestamp":"2026-09-07T12:00:01.000Z","kind":"live_timing","timing":{"category":"tool","status":"running","confidence":"live","startedAt":"2026-09-07T12:00:01.000Z"},"writerId":"writer-1","writerSequence":1}\n',
    );

    const result = await maintainSession({
      root,
      sessionId,
      sessionFile: source,
      writerId: "maintenance-1",
    });

    assert.equal(result.status, "available");
    assert.equal(result.durationEvidence, "unavailable");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

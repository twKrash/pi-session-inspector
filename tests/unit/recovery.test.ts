import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { recoverSession } from "../../src/storage/recovery.ts";

const sourceCursor = (lineCount: number) => ({
  lineCount,
  revision: lineCount.toString(16).padStart(64, "0"),
});

const aggregates = {
  totalTokens: 42,
  totalCost: 0.0125,
  generations: 2,
  tools: 3,
  compactions: 1,
};

async function writeWal(
  directory: string,
  writerId: string,
  contents: string,
): Promise<void> {
  const shard = join(directory, "wal", writerId);
  await mkdir(shard, { recursive: true });
  await writeFile(join(shard, "2026-09-07.jsonl"), contents);
}

async function writeCheckpoint(
  directory: string,
  cursors: { pi: number; wal: Record<string, number> },
): Promise<void> {
  await writeFile(
    join(directory, "checkpoint.json"),
    JSON.stringify({
      schemaVersion: 1,
      cursors: { ...cursors, pi: sourceCursor(cursors.pi) },
      aggregates,
    }),
  );
}

async function writeCheckpointFixture(
  directory: string,
  walCursors: Record<string, number>,
): Promise<void> {
  await writeCheckpoint(directory, { pi: 1, wal: walCursors });
}

const permissionEnvelope = (resolution: string, result: "allow" | "deny") => ({
  schemaVersion: 1,
  source: "permission-system",
  metric: "permission.decision",
  kind: "counter",
  value: 1,
  dimensions: { result, resolution },
});

test("uses valid checkpoint aggregates while replaying WAL timing state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-recovery-"));
  try {
    await writeCheckpoint(directory, { pi: 3, wal: { "writer-1": 1 } });
    await writeWal(
      directory,
      "writer-1",
      '{"eventId":"start-1","timestamp":"2026-09-07T12:00:00.000Z","kind":"live_timing","timing":{"category":"tool","status":"running","confidence":"live","startedAt":"2026-09-07T12:00:00.000Z"},"writerId":"writer-1","writerSequence":1}\n' +
        '{"eventId":"end-1","timestamp":"2026-09-07T12:00:01.000Z","kind":"live_timing","timing":{"category":"tool","status":"unknown","confidence":"live","startedAt":"2026-09-07T12:00:00.000Z","endedAt":"2026-09-07T12:00:01.000Z","durationMs":1},"writerId":"writer-1","writerSequence":2}\n',
    );

    const recovered = await recoverSession({
      directory,
      piCursor: sourceCursor(3),
    });

    assert.equal(recovered.availability, "available");
    assert.deepEqual(recovered.aggregates, aggregates);
    assert.deepEqual(recovered.cursors, {
      pi: sourceCursor(3),
      wal: { "writer-1": 2 },
    });
    assert.deepEqual(recovered.running, []);
    // R46: the retained records are exposed exactly in the shape L1 consumes,
    // validated timing payload included, without a second parse.
    assert.deepEqual(recovered.records, [
      {
        eventId: "start-1",
        timestamp: "2026-09-07T12:00:00.000Z",
        writerId: "writer-1",
        writerSequence: 1,
        kind: "live_timing",
        timing: {
          category: "tool",
          status: "running",
          confidence: "live",
          startedAt: "2026-09-07T12:00:00.000Z",
        },
      },
      {
        eventId: "end-1",
        timestamp: "2026-09-07T12:00:01.000Z",
        writerId: "writer-1",
        writerSequence: 2,
        kind: "live_timing",
        timing: {
          category: "tool",
          status: "unknown",
          confidence: "live",
          startedAt: "2026-09-07T12:00:00.000Z",
          endedAt: "2026-09-07T12:00:01.000Z",
          durationMs: 1,
        },
      },
    ]);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("reopens durable WAL rather than trusting a sealed checkpoint after Pi source changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-recovery-"));
  try {
    await writeFile(
      join(directory, "checkpoint.json"),
      JSON.stringify({
        schemaVersion: 1,
        cursors: { pi: sourceCursor(1), wal: { "writer-1": 1 } },
        aggregates,
        sealedWal: { "writer-1": 1 },
      }),
    );
    await writeWal(
      directory,
      "writer-1",
      '{"eventId":"start-1","timestamp":"2026-09-07T12:00:00.000Z","kind":"live_timing","timing":{"category":"tool","status":"running","confidence":"live","startedAt":"2026-09-07T12:00:00.000Z"},"writerId":"writer-1","writerSequence":1}\n',
    );

    const recovered = await recoverSession({
      directory,
      piCursor: sourceCursor(2),
    });
    assert.deepEqual(recovered.aggregates, {
      totalTokens: 0,
      totalCost: 0,
      generations: 0,
      tools: 0,
      compactions: 0,
    });
    assert.deepEqual(
      recovered.running.map((record) => record.eventId),
      ["start-1"],
    );
    assert.ok(recovered.diagnostics.includes("checkpoint-unavailable"));
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("replays dated fragments by writer sequence when creation dates move backward", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-recovery-"));
  try {
    const shard = join(directory, "wal", "writer-1");
    await mkdir(shard, { recursive: true });
    await writeFile(
      join(shard, "2026-09-08.jsonl"),
      '{"eventId":"start-1","timestamp":"2026-09-08T00:00:00.000Z","kind":"live_timing","timing":{"category":"tool","status":"running","confidence":"live","startedAt":"2026-09-08T00:00:00.000Z"},"writerId":"writer-1","writerSequence":1}\n',
    );
    await writeFile(
      join(shard, "2026-09-07.0001.jsonl"),
      '{"eventId":"end-1","timestamp":"2026-09-07T23:59:59.000Z","kind":"live_timing","timing":{"category":"tool","status":"unknown","confidence":"live","startedAt":"2026-09-08T00:00:00.000Z","endedAt":"2026-09-07T23:59:59.000Z","durationMs":0},"writerId":"writer-1","writerSequence":2}\n',
    );

    const recovered = await recoverSession({
      directory,
      piCursor: sourceCursor(0),
    });
    assert.equal(recovered.availability, "available");
    assert.deepEqual(recovered.cursors.wal, { "writer-1": 2 });
    assert.deepEqual(recovered.running, []);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("reconstructs checkpointed unmatched starts because checkpoints do not retain open timing state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-recovery-"));
  try {
    await writeCheckpoint(directory, { pi: 0, wal: { "writer-1": 1 } });
    await writeWal(
      directory,
      "writer-1",
      '{"eventId":"start-1","timestamp":"2026-09-07T12:00:00.000Z","kind":"live_timing","timing":{"category":"tool","status":"running","confidence":"live","startedAt":"2026-09-07T12:00:00.000Z"},"writerId":"writer-1","writerSequence":1}\n',
    );

    const recovered = await recoverSession({
      directory,
      piCursor: sourceCursor(0),
    });

    assert.equal(recovered.availability, "available");
    assert.deepEqual(
      recovered.running.map((record) => record.eventId),
      ["start-1"],
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("matches lifecycle boundaries by writer sequence when the clock rolls back", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-recovery-"));
  try {
    await writeWal(
      directory,
      "writer-1",
      '{"eventId":"start-1","timestamp":"2026-09-07T12:01:00.000Z","kind":"live_timing","timing":{"category":"tool","status":"running","confidence":"live","startedAt":"2026-09-07T12:01:00.000Z"},"writerId":"writer-1","writerSequence":1}\n' +
        '{"eventId":"end-2","timestamp":"2026-09-07T12:00:00.000Z","kind":"live_timing","timing":{"category":"tool","status":"unknown","confidence":"live","startedAt":"2026-09-07T12:01:00.000Z","endedAt":"2026-09-07T12:00:00.000Z","durationMs":0},"writerId":"writer-1","writerSequence":2}\n',
    );

    const recovered = await recoverSession({
      directory,
      piCursor: sourceCursor(0),
    });

    assert.equal(recovered.availability, "available");
    assert.deepEqual(recovered.running, []);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("ignores a partial final WAL line without treating its content as a record", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-recovery-"));
  try {
    await writeWal(
      directory,
      "writer-1",
      '{"eventId":"start-1","timestamp":"2026-09-07T12:00:00.000Z","kind":"live_timing","timing":{"category":"tool","status":"running","confidence":"live","startedAt":"2026-09-07T12:00:00.000Z"},"writerId":"writer-1","writerSequence":1}\n' +
        '{"eventId":"secret',
    );

    const recovered = await recoverSession({
      directory,
      piCursor: sourceCursor(0),
    });

    assert.equal(recovered.availability, "available");
    assert.deepEqual(recovered.running, [
      {
        eventId: "start-1",
        category: "tool",
        startedAt: "2026-09-07T12:00:00.000Z",
        status: "running",
      },
    ]);
    assert.deepEqual(recovered.diagnostics, [
      "checkpoint-unavailable",
      "wal-partial-line",
    ]);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("rejects an oversized WAL segment from its metadata before reading its contents", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-recovery-"));
  try {
    const shard = join(directory, "wal", "writer-1");
    await mkdir(shard, { recursive: true });
    await writeFile(
      join(shard, "2026-09-07.jsonl"),
      "x".repeat(16 * 1024 * 1024 + 1),
    );

    const recovered = await recoverSession({
      directory,
      piCursor: sourceCursor(0),
    });

    assert.equal(recovered.availability, "unavailable");
    assert.deepEqual(recovered.running, []);
    assert.deepEqual(recovered.diagnostics, [
      "checkpoint-unavailable",
      "wal-unavailable",
    ]);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("falls back to valid WAL input when the checkpoint is missing, corrupt, stale, or cursor-mismatched", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-recovery-"));
  try {
    await writeWal(
      directory,
      "writer-1",
      '{"eventId":"start-1","timestamp":"2026-09-07T12:00:00.000Z","kind":"live_timing","timing":{"category":"tool","status":"running","confidence":"live","startedAt":"2026-09-07T12:00:00.000Z"},"writerId":"writer-1","writerSequence":1}\n',
    );

    const missing = await recoverSession({
      directory,
      piCursor: sourceCursor(0),
    });
    assert.deepEqual(missing.aggregates, {
      totalTokens: 0,
      totalCost: 0,
      generations: 0,
      tools: 0,
      compactions: 0,
    });
    assert.deepEqual(
      missing.running.map((record) => record.eventId),
      ["start-1"],
    );
    assert.ok(missing.diagnostics.includes("checkpoint-unavailable"));

    for (const checkpoint of [
      "not json",
      JSON.stringify({
        schemaVersion: 1,
        cursors: { pi: 1, wal: { "writer-1": 1 } },
        aggregates,
      }),
      JSON.stringify({
        schemaVersion: 1,
        cursors: { pi: 0, wal: { "writer-1": 2 } },
        aggregates,
      }),
    ]) {
      await writeFile(join(directory, "checkpoint.json"), checkpoint);
      const recovered = await recoverSession({
        directory,
        piCursor: sourceCursor(0),
      });
      assert.equal(recovered.availability, "available");
      assert.deepEqual(recovered.aggregates, {
        totalTokens: 0,
        totalCost: 0,
        generations: 0,
        tools: 0,
        compactions: 0,
      });
      assert.deepEqual(
        recovered.running.map((record) => record.eventId),
        ["start-1"],
      );
      assert.ok(recovered.diagnostics.includes("checkpoint-unavailable"));
    }
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("rejects contradictory timing state without allowing it to close a live start", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-recovery-"));
  try {
    await writeWal(
      directory,
      "writer-1",
      '{"eventId":"start-1","timestamp":"2026-09-07T12:00:00.000Z","kind":"live_timing","timing":{"category":"tool","status":"running","confidence":"live","startedAt":"2026-09-07T12:00:00.000Z"},"writerId":"writer-1","writerSequence":1}\n' +
        '{"eventId":"contradiction-2","timestamp":"2026-09-07T12:00:01.000Z","kind":"live_timing","timing":{"category":"tool","status":"unknown","confidence":"unsupported","startedAt":"2026-09-07T12:00:00.000Z","endedAt":"2026-09-07T12:00:01.000Z","durationMs":1},"writerId":"writer-1","writerSequence":2}\n' +
        '{"eventId":"unsupported-3","timestamp":"2026-09-07T12:00:02.000Z","kind":"live_timing","timing":{"category":"provider","status":"unsupported","confidence":"unsupported"},"writerId":"writer-1","writerSequence":3}\n',
    );

    const recovered = await recoverSession({
      directory,
      piCursor: sourceCursor(0),
    });

    assert.equal(recovered.availability, "unavailable");
    assert.deepEqual(
      recovered.running.map((record) => record.eventId),
      ["start-1"],
    );
    // A partial replay exposes no records, exactly like its empty delta
    // counters, so an incomplete suffix can never be folded downstream.
    assert.deepEqual(recovered.records, []);
    assert.ok(recovered.diagnostics.includes("wal-unavailable"));
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("invalidates recovery and checkpoint compatibility for a WAL sequence gap or duplicate", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-recovery-"));
  try {
    await writeCheckpoint(directory, { pi: 0, wal: { "writer-1": 1 } });
    for (const sequences of [
      [1, 3],
      [1, 1],
    ]) {
      await writeWal(
        directory,
        "writer-1",
        sequences
          .map(
            (writerSequence) =>
              `{"eventId":"event-${writerSequence}","timestamp":"2026-09-07T12:00:00.000Z","kind":"live_timing","timing":{"category":"tool","status":"running","confidence":"live","startedAt":"2026-09-07T12:00:00.000Z"},"writerId":"writer-1","writerSequence":${writerSequence}}\n`,
          )
          .join(""),
      );
      const recovered = await recoverSession({
        directory,
        piCursor: sourceCursor(0),
      });
      assert.equal(recovered.availability, "unavailable");
      assert.deepEqual(recovered.aggregates, {
        totalTokens: 0,
        totalCost: 0,
        generations: 0,
        tools: 0,
        compactions: 0,
      });
      assert.ok(recovered.diagnostics.includes("checkpoint-unavailable"));
      assert.ok(recovered.diagnostics.includes("wal-unavailable"));
    }
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("declares recovery unavailable when aggregate segment budget is exceeded", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-recovery-"));
  try {
    await Promise.all(
      Array.from({ length: 4 }, async (_, writer) => {
        const writerShard = join(directory, "wal", `writer-${writer}`);
        await mkdir(writerShard, { recursive: true });
        await Promise.all(
          Array.from({ length: 257 }, (_, segment) =>
            writeFile(
              join(
                writerShard,
                `2026-${String(Math.floor(segment / 100)).padStart(2, "0")}-${String(segment % 100).padStart(2, "0")}.jsonl`,
              ),
              "",
            ),
          ),
        );
      }),
    );
    const recovered = await recoverSession({
      directory,
      piCursor: sourceCursor(0),
    });
    assert.equal(recovered.availability, "unavailable");
    assert.ok(recovered.diagnostics.includes("wal-unavailable"));
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("folds validated telemetry counters from every writer shard", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-recovery-"));
  try {
    const wal = join(directory, "wal", "writer-a");
    await mkdir(wal, { recursive: true });
    const lines = [
      {
        eventId: "e1",
        timestamp: "2026-09-11T10:00:00Z",
        writerId: "writer-a",
        writerSequence: 1,
        kind: "telemetry",
        telemetry: permissionEnvelope("policy_allow", "allow"),
      },
      {
        eventId: "e2",
        timestamp: "2026-09-11T10:00:01Z",
        writerId: "writer-a",
        writerSequence: 2,
        kind: "telemetry",
        telemetry: permissionEnvelope("user_denied", "deny"),
      },
      {
        eventId: "e3",
        timestamp: "2026-09-11T10:00:02Z",
        writerId: "writer-a",
        writerSequence: 3,
        kind: "telemetry",
        telemetry: {
          schemaVersion: 1,
          source: "pi-input",
          metric: "skill.invocation",
          kind: "counter",
          value: 1,
          dimensions: { skill: "council-mode" },
        },
      },
      {
        eventId: "e4",
        timestamp: "2026-09-11T10:00:03Z",
        writerId: "writer-a",
        writerSequence: 4,
        kind: "telemetry",
        telemetry: {
          schemaVersion: 1,
          source: "pi-input",
          metric: "skill.invocation",
          kind: "counter",
          value: 1,
          dimensions: { skill: "../escape" },
        },
      },
    ];
    await writeFile(
      join(wal, "2026-09-11.jsonl"),
      `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
    );

    const recovered = await recoverSession({
      directory,
      piCursor: sourceCursor(1),
    });

    assert.equal(recovered.availability, "available");
    assert.deepEqual(recovered.deltaCounters.counters.permission, {
      decisions: 2,
      allowed: 1,
      denied: 1,
    });
    assert.deepEqual(recovered.deltaCounters.skillInvocations, {
      "council-mode": 1,
    });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("folds only telemetry strictly after the checkpoint cursors", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-recovery-delta-"));
  try {
    await writeWal(
      directory,
      "writer-a",
      `${[
        permissionEnvelope("policy_allow", "allow"),
        permissionEnvelope("policy_allow", "allow"),
        permissionEnvelope("user_denied", "deny"),
      ]
        .map((telemetry, index) =>
          JSON.stringify({
            eventId: `e${index + 1}`,
            timestamp: `2026-09-11T10:00:0${index}Z`,
            writerId: "writer-a",
            writerSequence: index + 1,
            kind: "telemetry",
            telemetry,
          }),
        )
        .join("\n")}\n`,
    );
    await writeCheckpointFixture(directory, { "writer-a": 2 });

    const recovered = await recoverSession({
      directory,
      piCursor: sourceCursor(1),
    });

    // Records 1 and 2 are already folded into the checkpoint; only record 3 is delta.
    const allowed = recovered.deltaCounters.counters.permission?.allowed;
    assert.equal(allowed, undefined);
    assert.deepEqual(recovered.deltaCounters.counters.permission, {
      decisions: 1,
      denied: 1,
    });
    assert.deepEqual(recovered.cursors.wal, { "writer-a": 3 });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("treats a never-initialized store as healthy empty storage without a WAL diagnostic", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-recovery-empty-"));
  try {
    const recovered = await recoverSession({
      directory,
      piCursor: sourceCursor(0),
    });

    assert.equal(recovered.availability, "available");
    // A never-initialized store has no checkpoint to match and no WAL
    // diagnostic: absence alone is never reported as lost storage.
    assert.deepEqual(recovered.diagnostics, ["checkpoint-unavailable"]);
    assert.deepEqual(recovered.cursors.wal, {});
    assert.deepEqual(recovered.records, []);
    // Recovery only observes: an absent store is never created or repaired.
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("diagnoses a missing WAL directory the checkpoint declares sealed cursors for", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-recovery-nodir-"));
  try {
    await writeFile(
      join(directory, "checkpoint.json"),
      JSON.stringify({
        schemaVersion: 1,
        cursors: { pi: sourceCursor(1), wal: { "writer-1": 3 } },
        aggregates,
        sealingVersion: 1,
        sealedWal: { "writer-1": 3 },
      }),
    );

    const recovered = await recoverSession({
      directory,
      piCursor: sourceCursor(1),
    });

    assert.equal(recovered.availability, "available");
    assert.ok(recovered.diagnostics.includes("wal-directory-missing"));
    // The sealed cursors stay authoritative: no backwards movement, no
    // fabricated zero, and no invented record or repair.
    assert.deepEqual(recovered.aggregates, aggregates);
    assert.deepEqual(recovered.cursors.wal, { "writer-1": 3 });
    assert.deepEqual(recovered.deltaCounters.counters, {});
    assert.deepEqual(recovered.records, []);
    assert.deepEqual(await readdir(directory), ["checkpoint.json"]);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("diagnoses a missing WAL directory instead of reporting a healthy empty replay", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-recovery-nodir-"));
  try {
    await writeCheckpoint(directory, { pi: 1, wal: { "writer-1": 3 } });

    const recovered = await recoverSession({
      directory,
      piCursor: sourceCursor(1),
    });

    // An unsealed cursor whose retained detail is gone stays unavailable, but
    // the reason is now distinguishable from a genuinely empty replay.
    assert.equal(recovered.availability, "unavailable");
    assert.ok(recovered.diagnostics.includes("wal-unavailable"));
    assert.ok(recovered.diagnostics.includes("wal-directory-missing"));
    assert.deepEqual(recovered.aggregates, {
      totalTokens: 0,
      totalCost: 0,
      generations: 0,
      tools: 0,
      compactions: 0,
    });
    assert.deepEqual(recovered.deltaCounters.counters, {});
    assert.deepEqual(await readdir(directory), ["checkpoint.json"]);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("does not diagnose a missing WAL directory when no cursor was ever declared", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "inspector-recovery-nocursor-"),
  );
  try {
    await writeCheckpoint(directory, { pi: 1, wal: {} });

    const recovered = await recoverSession({
      directory,
      piCursor: sourceCursor(1),
    });

    assert.equal(recovered.availability, "available");
    assert.deepEqual(recovered.diagnostics, []);
    assert.deepEqual(recovered.cursors.wal, {});
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("replays a crash-interrupted recovery identically without consuming or double-folding WAL input", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-recovery-crash-"));
  try {
    await writeWal(
      directory,
      "writer-1",
      `${[1, 2, 3]
        .map((index) =>
          JSON.stringify({
            eventId: `e${index}`,
            timestamp: `2026-09-11T10:00:0${index}Z`,
            writerId: "writer-1",
            writerSequence: index,
            kind: "telemetry",
            telemetry: permissionEnvelope("policy_allow", "allow"),
          }),
        )
        .join("\n")}\n`,
    );
    await writeCheckpoint(directory, { pi: 1, wal: { "writer-1": 1 } });
    const checkpointPath = join(directory, "checkpoint.json");
    const segmentPath = join(directory, "wal", "writer-1", "2026-09-07.jsonl");
    const checkpointBytes = await readFile(checkpointPath, "utf8");
    const segmentBytes = await readFile(segmentPath, "utf8");

    // The pass that produced valid state but crashed before its checkpoint
    // committed left nothing behind: recovery itself is a pure read.
    const first = await recoverSession({
      directory,
      piCursor: sourceCursor(1),
    });
    assert.equal(first.availability, "available");
    assert.deepEqual(first.deltaCounters.counters.permission, {
      decisions: 2,
      allowed: 2,
    });
    assert.deepEqual(first.cursors.wal, { "writer-1": 3 });
    assert.equal(await readFile(checkpointPath, "utf8"), checkpointBytes);
    assert.equal(await readFile(segmentPath, "utf8"), segmentBytes);
    assert.deepEqual(await readdir(join(directory, "wal", "writer-1")), [
      "2026-09-07.jsonl",
    ]);

    // Restarting replays the same input to the same canonical result: the
    // already-folded record stays excluded, never duplicated or consumed.
    const second = await recoverSession({
      directory,
      piCursor: sourceCursor(1),
    });
    assert.deepEqual(second, first);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("keeps a sealed cursor ahead of the retained WAL without re-folding or rewinding it", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "inspector-recovery-shortwal-"),
  );
  try {
    await writeFile(
      join(directory, "checkpoint.json"),
      JSON.stringify({
        schemaVersion: 1,
        cursors: { pi: sourceCursor(1), wal: { "writer-1": 3 } },
        aggregates,
        sealingVersion: 1,
        sealedWal: { "writer-1": 3 },
      }),
    );
    const shard = join(directory, "wal", "writer-1");
    await mkdir(shard, { recursive: true });
    await writeFile(
      join(shard, "2026-09-11.jsonl"),
      `${[1, 2]
        .map((index) =>
          JSON.stringify({
            eventId: `e${index}`,
            timestamp: `2026-09-11T10:00:0${index}Z`,
            writerId: "writer-1",
            writerSequence: index,
            kind: "telemetry",
            telemetry: permissionEnvelope("policy_allow", "allow"),
          }),
        )
        .join("\n")}\n`,
    );

    const recovered = await recoverSession({
      directory,
      piCursor: sourceCursor(1),
    });

    assert.equal(recovered.availability, "available");
    assert.deepEqual(recovered.aggregates, aggregates);
    // The sealed cursor is not moved backwards to the retained tail, and the
    // sealed prefix is not folded a second time.
    assert.deepEqual(recovered.cursors.wal, { "writer-1": 3 });
    assert.deepEqual(recovered.deltaCounters.counters, {});
    assert.deepEqual(
      recovered.records.map((record) => record.writerSequence),
      [1, 2],
    );
    assert.ok(recovered.diagnostics.includes("wal-sealed"));
    assert.equal(recovered.diagnostics.includes("wal-unavailable"), false);
    // Nothing was repaired, appended, or deleted.
    assert.deepEqual(await readdir(shard), ["2026-09-11.jsonl"]);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("accepts a sealed shard whose retained WAL was fully pruned without inventing records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-recovery-pruned-"));
  try {
    await writeFile(
      join(directory, "checkpoint.json"),
      JSON.stringify({
        schemaVersion: 1,
        cursors: { pi: sourceCursor(1), wal: { "writer-1": 3 } },
        aggregates,
        sealingVersion: 1,
        sealedWal: { "writer-1": 3 },
      }),
    );
    await mkdir(join(directory, "wal"), { recursive: true });

    const recovered = await recoverSession({
      directory,
      piCursor: sourceCursor(1),
    });

    assert.equal(recovered.availability, "available");
    assert.deepEqual(recovered.aggregates, aggregates);
    assert.deepEqual(recovered.cursors.wal, { "writer-1": 3 });
    assert.deepEqual(recovered.records, []);
    assert.deepEqual(recovered.deltaCounters.counters, {});
    assert.equal(recovered.diagnostics.includes("wal-unavailable"), false);
    assert.equal(
      recovered.diagnostics.includes("wal-directory-missing"),
      false,
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("reports a sealed sequence gap beyond the cursor as unavailable instead of repairing it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-recovery-gap-"));
  try {
    await writeFile(
      join(directory, "checkpoint.json"),
      JSON.stringify({
        schemaVersion: 1,
        cursors: { pi: sourceCursor(1), wal: { "writer-1": 3 } },
        aggregates,
        sealingVersion: 1,
        sealedWal: { "writer-1": 3 },
      }),
    );
    const shard = join(directory, "wal", "writer-1");
    await mkdir(shard, { recursive: true });
    const segmentPath = join(shard, "2026-09-11.jsonl");
    await writeFile(
      segmentPath,
      `${JSON.stringify({
        eventId: "e5",
        timestamp: "2026-09-11T10:00:05Z",
        writerId: "writer-1",
        writerSequence: 5,
        kind: "telemetry",
        telemetry: permissionEnvelope("policy_allow", "allow"),
      })}\n`,
    );

    const recovered = await recoverSession({
      directory,
      piCursor: sourceCursor(1),
    });

    // Record 4 is missing and is never invented to bridge the gap.
    assert.equal(recovered.availability, "unavailable");
    assert.ok(recovered.diagnostics.includes("wal-unavailable"));
    assert.deepEqual(recovered.records, []);
    assert.deepEqual(recovered.deltaCounters.counters, {});
    assert.equal(
      await readFile(segmentPath, "utf8").then((text) =>
        text.includes('"writerSequence":5'),
      ),
      true,
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("does not guess unknown WAL records and keeps unmatched supported starts running", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-recovery-"));
  try {
    await writeWal(
      directory,
      "writer-1",
      '{"eventId":"start-1","timestamp":"2026-09-07T12:00:00.000Z","kind":"live_timing","timing":{"category":"tool","status":"running","confidence":"live","startedAt":"2026-09-07T12:00:00.000Z"},"writerId":"writer-1","writerSequence":1}\n' +
        '{"eventId":"unknown-2","timestamp":"2026-09-07T12:00:01.000Z","kind":"new-format","writerId":"writer-1","writerSequence":2}\n',
    );

    const recovered = await recoverSession({
      directory,
      piCursor: sourceCursor(0),
    });

    assert.equal(recovered.availability, "unavailable");
    assert.deepEqual(
      recovered.running.map((record) => record.eventId),
      ["start-1"],
    );
    assert.deepEqual(recovered.diagnostics, [
      "checkpoint-unavailable",
      "wal-unavailable",
    ]);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

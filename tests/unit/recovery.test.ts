import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

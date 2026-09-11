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

import {
  readCheckpoint,
  writeCheckpoint,
  type Checkpoint,
} from "../../src/storage/checkpoint.ts";
import { acquireMaintenanceLease } from "../../src/storage/lease.ts";
import { pruneExpiredWalSegments } from "../../src/storage/retention.ts";
import { recoverSession } from "../../src/storage/recovery.ts";

const directoryNow = new Date("2026-09-21T12:00:00.000Z");
const sourceCursor = { lineCount: 0, revision: "0".repeat(64) };

function checkpoint(cursor: number): Checkpoint {
  return {
    schemaVersion: 1,
    cursors: { pi: sourceCursor, wal: { "writer-1": cursor } },
    aggregates: {
      totalTokens: 0,
      totalCost: 0,
      generations: 0,
      tools: 0,
      compactions: 0,
    },
  };
}

async function acquireLease(directory: string) {
  const lease = await acquireMaintenanceLease({
    directory,
    writerId: "maintenance-1",
    now: () => directoryNow,
    isPidAlive: () => true,
  });
  assert.ok(lease);
  return lease;
}

function record(sequence: number, timestamp: string): string {
  return `${JSON.stringify({
    eventId: `event-${sequence}`,
    timestamp,
    kind: "live_timing",
    timing: {
      category: "tool",
      status: "running",
      confidence: "live",
      startedAt: timestamp,
    },
    writerId: "writer-1",
    writerSequence: sequence,
  })}\n`;
}

test("prunes only WAL segments whose newest record is outside the strict 14-calendar-day window", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  try {
    const shard = join(directory, "wal", "writer-1");
    await mkdir(shard, { recursive: true });
    await writeFile(
      join(shard, "2026-09-07.0001.jsonl"),
      record(1, "2026-09-07T23:59:59.999Z"),
    );
    await writeFile(
      join(shard, "2026-09-08.jsonl"),
      record(2, "2026-09-08T00:00:00.000Z"),
    );
    for (const name of (await readdir(shard)).filter(
      (name) => !name.endsWith(".closed"),
    ))
      if (name.endsWith(".jsonl"))
        await writeFile(join(shard, `${name}.closed`), "1\n");
    const lease = await acquireLease(directory);
    assert.equal(
      await writeCheckpoint({ directory, checkpoint: checkpoint(2), lease }),
      true,
    );

    assert.equal(
      await pruneExpiredWalSegments({
        directory,
        lease,
        now: () => directoryNow,
        validate: async () => true,
      }),
      1,
    );
    assert.deepEqual(
      (await readdir(shard)).filter((name) => !name.endsWith(".closed")),
      ["2026-09-08.jsonl"],
    );
    await lease.release();

    // A crash after unlink leaves a checkpoint-backed prefix, not an invalid
    // sequence gap that would prevent later reconciliation.
    assert.equal(
      (await recoverSession({ directory, piCursor: sourceCursor }))
        .availability,
      "available",
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("does not delete an expired segment until a validated checkpoint includes its writer sequence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  try {
    const shard = join(directory, "wal", "writer-1");
    await mkdir(shard, { recursive: true });
    const segment = join(shard, "2026-09-01.jsonl");
    await writeFile(segment, record(3, "2026-09-01T12:00:00.000Z"));
    for (const name of (await readdir(shard)).filter(
      (name) => !name.endsWith(".closed"),
    ))
      if (name.endsWith(".jsonl"))
        await writeFile(join(shard, `${name}.closed`), "1\n");
    const lease = await acquireLease(directory);

    assert.equal(
      await pruneExpiredWalSegments({
        directory,
        lease,
        now: () => directoryNow,
        validate: async () => true,
      }),
      0,
    );
    await writeFile(join(directory, "checkpoint.json"), "not a checkpoint");
    assert.equal(
      await pruneExpiredWalSegments({
        directory,
        lease,
        now: () => directoryNow,
        validate: async () => true,
      }),
      0,
    );
    assert.equal(
      await writeCheckpoint({ directory, checkpoint: checkpoint(2), lease }),
      true,
    );
    assert.equal(
      await pruneExpiredWalSegments({
        directory,
        lease,
        now: () => directoryNow,
        validate: async () => true,
      }),
      0,
    );
    assert.equal(
      await writeCheckpoint({ directory, checkpoint: checkpoint(3), lease }),
      true,
    );
    assert.equal(
      await pruneExpiredWalSegments({
        directory,
        lease,
        now: () => directoryNow,
        validate: async () => true,
      }),
      0,
    );
    await lease.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("does not seal or delete when Pi source changes during the final validation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  try {
    const shard = join(directory, "wal", "writer-1");
    const segment = join(shard, "2026-09-01.jsonl");
    await mkdir(shard, { recursive: true });
    await writeFile(segment, record(1, "2026-09-01T12:00:00.000Z"));
    for (const name of (await readdir(shard)).filter(
      (name) => !name.endsWith(".closed"),
    ))
      if (name.endsWith(".jsonl"))
        await writeFile(join(shard, `${name}.closed`), "1\n");
    const lease = await acquireLease(directory);
    assert.equal(
      await writeCheckpoint({ directory, checkpoint: checkpoint(1), lease }),
      true,
    );
    let checks = 0;
    assert.equal(
      await pruneExpiredWalSegments({
        directory,
        lease,
        now: () => directoryNow,
        validate: async () => ++checks === 1,
      }),
      0,
    );
    assert.equal(
      await readFile(segment, "utf8"),
      record(1, "2026-09-01T12:00:00.000Z"),
    );
    assert.equal(
      (await readCheckpoint({ directory }))?.sealedWal?.["writer-1"],
      1,
    );
    await lease.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("retains a sealed checkpoint for cold recovery after deletion", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  try {
    const shard = join(directory, "wal", "writer-1");
    await mkdir(shard, { recursive: true });
    await writeFile(
      join(shard, "2026-09-01.jsonl"),
      record(1, "2026-09-01T12:00:00.000Z"),
    );
    for (const name of (await readdir(shard)).filter(
      (name) => !name.endsWith(".closed"),
    ))
      if (name.endsWith(".jsonl"))
        await writeFile(join(shard, `${name}.closed`), "1\n");
    const lease = await acquireLease(directory);
    assert.equal(
      await writeCheckpoint({ directory, checkpoint: checkpoint(1), lease }),
      true,
    );
    assert.equal(
      await pruneExpiredWalSegments({
        directory,
        lease,
        now: () => directoryNow,
        validate: async () => true,
      }),
      1,
    );
    await lease.release();
    const recovered = await recoverSession({
      directory,
      piCursor: sourceCursor,
    });
    assert.equal(recovered.availability, "available");
    assert.equal(recovered.aggregates.totalTokens, 0);
    assert.ok(recovered.diagnostics.includes("wal-sealed"));
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("leaves WAL intact when deletion fails and never touches Pi source or explicit exports", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  const piSource = join(directory, "session.jsonl");
  const explicitExport = join(directory, "user-report.html");
  try {
    const shard = join(directory, "wal", "writer-1");
    await mkdir(shard, { recursive: true });
    const segment = join(shard, "2026-09-01.jsonl");
    await writeFile(segment, record(1, "2026-09-01T12:00:00.000Z"));
    await writeFile(piSource, "pi-owned-source\n");
    await writeFile(explicitExport, "user-owned-export\n");
    for (const name of (await readdir(shard)).filter(
      (name) => !name.endsWith(".closed"),
    ))
      if (name.endsWith(".jsonl"))
        await writeFile(join(shard, `${name}.closed`), "1\n");
    const lease = await acquireLease(directory);
    assert.equal(
      await writeCheckpoint({ directory, checkpoint: checkpoint(1), lease }),
      true,
    );

    assert.equal(
      await pruneExpiredWalSegments({
        directory,
        lease,
        now: () => directoryNow,
        validate: async () => true,
        remove: async () => {
          throw new Error("simulated interruption");
        },
      }),
      0,
    );
    assert.deepEqual(
      (await readdir(shard)).filter((name) => !name.endsWith(".closed")),
      ["2026-09-01.jsonl"],
    );
    assert.equal(await readFile(piSource, "utf8"), "pi-owned-source\n");
    assert.equal(await readFile(explicitExport, "utf8"), "user-owned-export\n");
    await lease.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("ordinary checkpoint never authorizes a missing WAL prefix", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  try {
    const shard = join(directory, "wal", "writer-1");
    await mkdir(shard, { recursive: true });
    await writeFile(
      join(shard, "2026-09-08.jsonl"),
      record(2, "2026-09-08T00:00:00Z"),
    );
    await writeFile(
      join(directory, "checkpoint.json"),
      JSON.stringify(checkpoint(2)),
    );
    assert.equal(
      (await recoverSession({ directory, piCursor: sourceCursor }))
        .availability,
      "unavailable",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("retention cannot prune mutable segments or create interior gaps after clock rollback", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  try {
    const shard = join(directory, "wal", "writer-1");
    await mkdir(shard, { recursive: true });
    await writeFile(
      join(shard, "2026-09-09.jsonl"),
      record(1, "2026-09-09T00:00:00Z"),
    );
    await writeFile(
      join(shard, "2026-09-01.jsonl"),
      record(2, "2026-09-01T00:00:00Z"),
    );
    const lease = await acquireLease(directory);
    await writeCheckpoint({ directory, lease, checkpoint: checkpoint(2) });
    assert.equal(
      await pruneExpiredWalSegments({
        directory,
        lease,
        now: () => directoryNow,
        validate: async () => true,
      }),
      0,
    );
    await writeFile(join(shard, "2026-09-01.jsonl.closed"), "1\n");
    assert.equal(
      await pruneExpiredWalSegments({
        directory,
        lease,
        now: () => directoryNow,
        validate: async () => true,
      }),
      0,
    );
    await lease.release();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("unlink-then-error preserves irreversible sealing evidence across reopen and Pi rewrite", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  try {
    const shard = join(directory, "wal", "writer-1");
    await mkdir(shard, { recursive: true });
    const path = join(shard, "2026-09-01.jsonl");
    await writeFile(path, record(1, "2026-09-01T00:00:00Z"));
    await writeFile(`${path}.closed`, "1\n");
    const lease = await acquireLease(directory);
    await writeCheckpoint({ directory, lease, checkpoint: checkpoint(1) });
    await pruneExpiredWalSegments({
      directory,
      lease,
      now: () => directoryNow,
      validate: async () => true,
      remove: async (path) => {
        await rm(path);
        throw Error("interrupted after unlink");
      },
    });
    assert.equal(
      (await readCheckpoint({ directory }))?.sealedWal?.["writer-1"],
      1,
    );
    const reopened = await recoverSession({
      directory,
      piCursor: { ...sourceCursor, revision: "1".repeat(64) },
    });
    assert.equal(reopened.availability, "available");
    assert.ok(reopened.diagnostics.includes("wal-sealed"));
    await lease.release();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("above replay-record budget maintenance incrementally prunes and carries cold evidence to shared DTO", async () => {
  const { maintainSession } = await import("../../src/storage/maintenance.ts");
  const { loadCurrentSessionReport } = await import(
    "../../src/ui/load-current.ts"
  );
  const root = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  const directory = join(root, "sessions", "session-1");
  const shard = join(directory, "wal", "writer-1");
  const source = join(root, "pi.jsonl");
  try {
    await mkdir(shard, { recursive: true });
    await writeFile(
      source,
      '{"type":"session","version":3,"id":"session-1","timestamp":"2026-01-01T00:00:00Z"}\n{"id":"marker","parentId":null,"timestamp":"2026-01-01T00:00:00Z","type":"custom","customType":"session-inspector:tracking-start","data":{"schemaVersion":1}}\n',
    );
    for (let part = 0; part < 9; part++) {
      const path = join(shard, `2026-01-0${part + 1}.jsonl`);
      await writeFile(
        path,
        Array.from({ length: 34000 }, (_, i) =>
          record(part * 34000 + i + 1, "2026-01-01T00:00:00Z"),
        ).join(""),
      );
      await writeFile(`${path}.closed`, "1\n");
    }
    assert.equal(
      (await recoverSession({ directory, piCursor: sourceCursor }))
        .availability,
      "unavailable",
    );
    for (let i = 0; i < 3; i++) {
      assert.equal(
        await maintainSession({
          root,
          sessionId: "session-1",
          sessionFile: source,
          writerId: `maintenance-${i}`,
        }),
        "available",
      );
      if (i === 0)
        assert.ok(
          (await readdir(shard)).some((name) => name.endsWith(".jsonl")),
        );
    }
    assert.equal(
      (await readCheckpoint({ directory }))?.sealedWal?.["writer-1"],
      306000,
    );
    const model = await loadCurrentSessionReport(
      source,
      "tree",
      null,
      undefined,
      root,
    );
    assert.equal(model?.report.walDetail, "expired");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("delayed concurrent append cannot be unlinked while its segment remains mutable", async () => {
  const { appendFile } = await import("node:fs/promises");
  const { createWalWriter } = await import("../../src/storage/wal.ts");
  const directory = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  let release: (() => void) | undefined;
  try {
    let writes = 0;
    const writer = await createWalWriter({
      root: directory,
      writerId: "writer-1",
      // Keep the writer clock on the segment date so the idle-rotation close
      // does not pre-close this still-mutable segment under test.
      now: () => new Date("2026-09-01T12:00:00.000Z"),
      write: async (path, data) => {
        if (++writes === 2)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        await appendFile(path, data);
      },
    });
    const append = (id: string) =>
      writer.append({
        eventId: id,
        timestamp: "2026-09-01T00:00:00Z",
        kind: "live_timing",
        timing: {
          category: "tool",
          status: "running",
          confidence: "live",
          startedAt: "2026-09-01T00:00:00Z",
        },
      });
    append("one");
    await writer.flush();
    append("two");
    const flushing = writer.flush();
    while (!release)
      await new Promise<void>((resolve) => setImmediate(resolve));
    const lease = await acquireLease(directory);
    await writeCheckpoint({ directory, lease, checkpoint: checkpoint(1) });
    assert.equal(
      await pruneExpiredWalSegments({
        directory,
        lease,
        now: () => directoryNow,
        validate: async () => true,
      }),
      0,
    );
    release();
    await flushing;
    await lease.release();
    assert.equal(
      (await recoverSession({ directory, piCursor: sourceCursor })).cursors.wal[
        "writer-1"
      ],
      2,
    );
  } finally {
    release?.();
    await rm(directory, { recursive: true, force: true });
  }
});

test("unversioned pre-fix seals cannot authorize missing detail", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  try {
    await writeFile(
      join(directory, "checkpoint.json"),
      JSON.stringify({ ...checkpoint(1), sealedWal: { "writer-1": 1 } }),
    );
    assert.equal(
      (await recoverSession({ directory, piCursor: sourceCursor }))
        .availability,
      "unavailable",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("oversized immutable legacy segment streams validation before checkpoint and unlink", async () => {
  const { appendFile } = await import("node:fs/promises");
  const directory = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  try {
    const shard = join(directory, "wal", "writer-1");
    await mkdir(shard, { recursive: true });
    const path = join(shard, "2026-09-01.jsonl");
    for (let batch = 0; batch < 8; batch++)
      await appendFile(
        path,
        Array.from({ length: 10000 }, (_, i) =>
          record(batch * 10000 + i + 1, "2026-09-01T00:00:00Z"),
        ).join(""),
      );
    await writeFile(`${path}.closed`, "1\n");
    const lease = await acquireLease(directory);
    await writeCheckpoint({ directory, lease, checkpoint: checkpoint(0) });
    assert.equal(
      await pruneExpiredWalSegments({
        directory,
        lease,
        now: () => directoryNow,
        validate: async () => true,
      }),
      1,
    );
    assert.equal(
      (await recoverSession({ directory, piCursor: sourceCursor })).cursors.wal[
        "writer-1"
      ],
      80000,
    );
    await lease.release();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("checkpoint publication failure leaves durable detail reopenable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  try {
    const shard = join(directory, "wal", "writer-1");
    await mkdir(shard, { recursive: true });
    const path = join(shard, "2026-09-01.jsonl");
    await writeFile(path, record(1, "2026-09-01T00:00:00Z"));
    await writeFile(`${path}.closed`, "1\n");
    const lease = await acquireLease(directory);
    await writeCheckpoint({ directory, lease, checkpoint: checkpoint(1) });
    assert.equal(
      await pruneExpiredWalSegments({
        directory,
        lease,
        now: () => directoryNow,
        validate: async () => {
          await rm(join(directory, "checkpoint.json"));
          await mkdir(join(directory, "checkpoint.json"));
          return true;
        },
      }),
      0,
    );
    assert.ok((await readFile(path, "utf8")).includes('"writerSequence":1'));
    const reopened = await recoverSession({
      directory,
      piCursor: sourceCursor,
    });
    assert.equal(reopened.availability, "available");
    assert.deepEqual(
      reopened.running.map((row) => row.eventId),
      ["event-1"],
    );
    await lease.release();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

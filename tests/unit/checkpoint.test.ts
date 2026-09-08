import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  readCheckpoint,
  writeCheckpoint,
  type Checkpoint,
} from "../../src/storage/checkpoint.ts";
import {
  acquireMaintenanceLease,
  type MaintenanceLease,
} from "../../src/storage/lease.ts";

async function acquireLease(
  directory: string,
  writerId = "maintenance-writer",
): Promise<MaintenanceLease> {
  const lease = await acquireMaintenanceLease({
    directory,
    writerId,
    now: () => new Date("2026-09-07T12:00:00.000Z"),
    isPidAlive: () => true,
  });
  assert.ok(lease);
  return lease;
}

function comparableCheckpoint(
  value: Checkpoint | undefined,
): Checkpoint | undefined {
  if (value === undefined) return undefined;
  return {
    ...value,
    cursors: {
      ...value.cursors,
      wal: Object.fromEntries(Object.entries(value.cursors.wal)),
    },
  };
}

const sourceCursor = (lineCount: number) => ({
  lineCount,
  revision: "a".repeat(64),
});

const checkpoint: Checkpoint = {
  schemaVersion: 1,
  cursors: {
    pi: sourceCursor(12),
    wal: { "writer-1": 5 },
  },
  aggregates: {
    totalTokens: 42,
    totalCost: 0.0125,
    generations: 2,
    tools: 3,
    compactions: 1,
  },
};

test("writes a validated versioned checkpoint atomically", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-checkpoint-"));
  try {
    const lease = await acquireLease(directory);
    assert.equal(await writeCheckpoint({ directory, checkpoint, lease }), true);

    assert.deepEqual(
      comparableCheckpoint(await readCheckpoint({ directory })),
      checkpoint,
    );
    assert.equal(
      await readFile(join(directory, "checkpoint.json"), "utf8"),
      `${JSON.stringify(checkpoint)}\n`,
    );
    assert.deepEqual(await readdir(directory), [
      "checkpoint.json",
      "maintenance.lease",
    ]);
    await lease.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("treats missing and malformed checkpoints as unavailable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-checkpoint-"));
  try {
    assert.equal(await readCheckpoint({ directory }), undefined);

    await writeFile(
      join(directory, "checkpoint.json"),
      '{"schemaVersion":1,"cursors":{"pi":1,"wal":{}},"aggregates":{"totalTokens":0,"totalCost":0,"generations":0,"tools":0,"compactions":0}}',
    );
    // Legacy count-only cursors replay rather than risking a stale aggregate.
    assert.equal(await readCheckpoint({ directory }), undefined);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("ignores additive unknown fields without retaining their values", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-checkpoint-"));
  try {
    const additive = {
      ...checkpoint,
      futureRoot: "untrusted-value",
      cursors: { ...checkpoint.cursors, futureCursor: "untrusted-value" },
      aggregates: {
        ...checkpoint.aggregates,
        futureAggregate: "untrusted-value",
      },
    };
    await writeFile(
      join(directory, "checkpoint.json"),
      JSON.stringify(additive),
    );
    assert.deepEqual(
      comparableCheckpoint(await readCheckpoint({ directory })),
      checkpoint,
    );

    const lease = await acquireLease(directory);
    assert.equal(
      await writeCheckpoint({ directory, checkpoint: additive, lease }),
      true,
    );
    assert.equal(
      (await readFile(join(directory, "checkpoint.json"), "utf8")).includes(
        "untrusted-value",
      ),
      false,
    );
    await lease.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("accepts only finite bounded totals and safe integer aggregate counts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-checkpoint-"));
  try {
    const lease = await acquireLease(directory);
    const atMaximum: Checkpoint = {
      ...checkpoint,
      aggregates: {
        totalTokens: Number.MAX_SAFE_INTEGER,
        totalCost: Number.MAX_SAFE_INTEGER,
        generations: Number.MAX_SAFE_INTEGER,
        tools: Number.MAX_SAFE_INTEGER,
        compactions: Number.MAX_SAFE_INTEGER,
      },
    };
    assert.equal(
      await writeCheckpoint({ directory, checkpoint: atMaximum, lease }),
      true,
    );

    for (const aggregates of [
      { ...atMaximum.aggregates, totalTokens: Number.MAX_SAFE_INTEGER + 1 },
      { ...atMaximum.aggregates, totalCost: Number.MAX_SAFE_INTEGER + 1 },
      { ...atMaximum.aggregates, generations: 1.5 },
      { ...atMaximum.aggregates, tools: Number.POSITIVE_INFINITY },
    ]) {
      assert.equal(
        await writeCheckpoint({
          directory,
          checkpoint: { ...checkpoint, aggregates },
          lease,
        }),
        false,
      );
    }
    await lease.release();
    await writeFile(
      join(directory, "checkpoint.json"),
      JSON.stringify({
        ...checkpoint,
        aggregates: { ...checkpoint.aggregates, compactions: 1.5 },
      }),
    );
    assert.equal(await readCheckpoint({ directory }), undefined);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("requires a held session maintenance lease at the write boundary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-checkpoint-"));
  try {
    assert.equal(
      await writeCheckpoint({ directory, checkpoint } as unknown as Parameters<
        typeof writeCheckpoint
      >[0]),
      false,
    );

    const otherDirectory = await mkdtemp(
      join(tmpdir(), "inspector-checkpoint-"),
    );
    try {
      const wrongLease = await acquireLease(otherDirectory);
      assert.equal(
        await writeCheckpoint({ directory, checkpoint, lease: wrongLease }),
        false,
      );
      await wrongLease.release();
    } finally {
      await rm(otherDirectory, { force: true, recursive: true });
    }

    const releasedLease = await acquireLease(directory);
    await releasedLease.release();
    assert.equal(
      await writeCheckpoint({
        directory,
        checkpoint,
        lease: releasedLease,
      }),
      false,
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("serializes interleaved maintainers and rejects an older cursor after handoff", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-checkpoint-"));
  try {
    const first = await acquireLease(directory, "first-maintainer");
    const blocked = await acquireMaintenanceLease({
      directory,
      writerId: "second-maintainer",
      now: () => new Date("2026-09-07T12:00:00.000Z"),
      isPidAlive: () => true,
    });
    assert.equal(blocked, undefined);

    const newer: Checkpoint = {
      ...checkpoint,
      cursors: {
        pi: sourceCursor(20),
        wal: { "writer-1": 9, "writer-2": 4 },
      },
    };
    assert.equal(
      await writeCheckpoint({ directory, checkpoint: newer, lease: first }),
      true,
    );
    await first.release();

    const second = await acquireLease(directory, "second-maintainer");
    assert.equal(
      await writeCheckpoint({ directory, checkpoint, lease: second }),
      false,
    );
    assert.deepEqual(
      comparableCheckpoint(await readCheckpoint({ directory })),
      newer,
    );
    await second.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("preserves a __proto__ WAL cursor and rejects a checkpoint that drops it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-checkpoint-"));
  try {
    const lease = await acquireLease(directory);
    const wal: Record<string, number> = Object.create(null);
    Object.defineProperty(wal, "__proto__", {
      value: 9,
      enumerable: true,
    });
    const newer: Checkpoint = {
      ...checkpoint,
      cursors: { pi: sourceCursor(12), wal },
    };
    assert.equal(
      await writeCheckpoint({ directory, checkpoint: newer, lease }),
      true,
    );
    const stored = await readCheckpoint({ directory });
    assert.equal(stored?.cursors.wal.__proto__, 9);
    assert.equal(Object.hasOwn(stored?.cursors.wal ?? {}, "__proto__"), true);

    assert.equal(
      await writeCheckpoint({
        directory,
        checkpoint: {
          ...checkpoint,
          cursors: { pi: sourceCursor(12), wal: {} },
        },
        lease,
      }),
      false,
    );
    assert.equal(
      (await readCheckpoint({ directory }))?.cursors.wal.__proto__,
      9,
    );
    await lease.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("rejects oversized checkpoint state before persistence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-checkpoint-"));
  try {
    const lease = await acquireLease(directory);
    const wal = Object.fromEntries(
      Array.from({ length: 257 }, (_, index) => [`writer-${index}`, index]),
    );
    assert.equal(
      await writeCheckpoint({
        directory,
        checkpoint: { ...checkpoint, cursors: { pi: sourceCursor(12), wal } },
        lease,
      }),
      false,
    );
    assert.equal(await readCheckpoint({ directory }), undefined);
    await lease.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

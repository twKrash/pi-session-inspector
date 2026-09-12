import assert from "node:assert/strict";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  utimes,
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
import type { FoldedAggregateEvidence } from "../../src/core/evidence.ts";
import { acquireMaintenanceLease } from "../../src/storage/lease.ts";
import { pruneExpiredWalSegments } from "../../src/storage/retention.ts";
import { recoverSession } from "../../src/storage/recovery.ts";

const directoryNow = new Date("2026-09-21T12:00:00.000Z");
const sourceCursor = { lineCount: 0, revision: "0".repeat(64) };
/** Beyond Linux/macOS pid ranges, so `kill(pid, 0)` always proves ESRCH. */
const UNREACHABLE_PID = 2_147_483_647;

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

function recordFor(
  writerId: string,
  sequence: number,
  timestamp: string,
): string {
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
    writerId,
    writerSequence: sequence,
  })}\n`;
}

function record(sequence: number, timestamp: string): string {
  return recordFor("writer-1", sequence, timestamp);
}

/**
 * The checkpoint's folded L0 evidence as the composition root builds it: the
 * aggregates plus their exact cursor/seal boundary and observation times.
 */
function foldedEvidence(
  sessionId: string,
  checkpoint: Checkpoint,
): FoldedAggregateEvidence[] {
  const checkpointedAt = checkpoint.evidence?.checkpointedAt;
  const expiredBefore =
    checkpoint.evidence?.detailCoverage?.walDetailExpiredBefore;
  const time: FoldedAggregateEvidence["checkpointedAt"] =
    checkpointedAt === undefined
      ? { state: "unavailable" }
      : { state: "known", at: checkpointedAt, basis: "checkpoint-observer" };
  const provenance = {
    source: "checkpoint",
    authority: "derived",
    schemaVersion: 1,
  } as const;
  const evidence: FoldedAggregateEvidence[] = [
    {
      kind: "checkpoint-wal-aggregates",
      sessionId,
      foldedThrough: { ...checkpoint.cursors.wal },
      sealedThrough:
        checkpoint.sealingVersion === 1
          ? { ...(checkpoint.sealedWal ?? {}) }
          : {},
      ...(checkpoint.aggregates.integrationCounters === undefined
        ? {}
        : { integrationCounters: checkpoint.aggregates.integrationCounters }),
      ...(checkpoint.aggregates.skillInvocations === undefined
        ? {}
        : { skillInvocations: checkpoint.aggregates.skillInvocations }),
      ...(checkpoint.aggregates.presence?.permission === true
        ? { presence: { permission: true } }
        : {}),
      ...(expiredBefore === undefined
        ? {}
        : { detailExpiredBefore: expiredBefore }),
      checkpointedAt: time,
      provenance,
    },
  ];
  const counts = checkpoint.aggregates.resourceCounts;
  if (counts === undefined) return evidence;
  const observedAt = counts.observedAt;
  evidence.push({
    kind: "checkpoint-resource-aggregates",
    sessionId,
    resourceCounts: {
      commands: counts.commands,
      skills: counts.skills,
      ...(counts.resources === undefined
        ? {}
        : { resources: counts.resources }),
      ...(counts.toolSources === undefined
        ? {}
        : { toolSources: counts.toolSources }),
    },
    observedAt:
      observedAt === undefined
        ? { state: "unavailable" }
        : { state: "known", at: observedAt, basis: "inventory-observer" },
    checkpointedAt: time,
    provenance,
  });
  return evidence;
}

async function setModifiedTime(path: string, iso: string): Promise<void> {
  const time = new Date(iso);
  await utimes(path, time, time);
}

function sealedCheckpoint(cursor: number): Checkpoint {
  return {
    ...checkpoint(cursor),
    sealingVersion: 1,
    sealedWal: { "writer-1": cursor },
  };
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
        (
          await maintainSession({
            root,
            sessionId: "session-1",
            sessionFile: source,
            writerId: `maintenance-${i}`,
          })
        ).status,
        "available",
      );
      if (i === 0)
        assert.ok(
          (await readdir(shard)).some((name) => name.endsWith(".jsonl")),
        );
    }
    const checkpoint = await readCheckpoint({ directory });
    assert.equal(checkpoint?.sealedWal?.["writer-1"], 306000);
    assert.ok(checkpoint);
    const model = await loadCurrentSessionReport(source, "tree", {
      leafId: null,
      // The folded evidence a converged caller builds from the checkpoint; the
      // loader itself never reads storage.
      evidence: {
        atomic: [],
        folded: foldedEvidence("session-1", checkpoint),
      },
    });
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

// --- M7 item 1: bounded, evidence-based eligibility for legacy shards ---

test("prunes a legacy ownerless segment only when its mtime precedes the cutoff day", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  try {
    const shard = join(directory, "wal", "writer-1");
    await mkdir(shard, { recursive: true });
    const path = join(shard, "2026-09-01.jsonl");
    await writeFile(path, record(1, "2026-09-01T12:00:00.000Z"));
    // Pre-M7 legacy shard: no `.closed` marker and no `.owner` record.
    await setModifiedTime(path, "2026-09-07T12:00:00.000Z");
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
    assert.deepEqual(await readdir(shard), []);
    assert.equal(
      (await readCheckpoint({ directory }))?.sealedWal?.["writer-1"],
      1,
    );
    await lease.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("retains a legacy ownerless segment whose mtime is not strictly before the cutoff day", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  try {
    const shard = join(directory, "wal", "writer-1");
    await mkdir(shard, { recursive: true });
    const path = join(shard, "2026-09-01.jsonl");
    await writeFile(path, record(1, "2026-09-01T12:00:00.000Z"));
    await setModifiedTime(path, "2026-09-08T00:00:00.000Z");
    const lease = await acquireLease(directory);
    assert.equal(
      await writeCheckpoint({ directory, checkpoint: checkpoint(1), lease }),
      true,
    );

    // The cutoff day itself is not strictly before the cutoff.
    assert.equal(
      await pruneExpiredWalSegments({
        directory,
        lease,
        now: () => directoryNow,
        validate: async () => true,
      }),
      0,
    );
    await setModifiedTime(path, "2026-09-20T12:00:00.000Z");
    assert.equal(
      await pruneExpiredWalSegments({
        directory,
        lease,
        now: () => directoryNow,
        validate: async () => true,
      }),
      0,
    );
    assert.equal((await readdir(shard)).includes("2026-09-01.jsonl"), true);
    assert.equal(
      (await readCheckpoint({ directory }))?.sealedWal?.["writer-1"],
      undefined,
    );
    await lease.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("aborts a legacy unlink when a delayed append changes the segment before remove", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  try {
    const shard = join(directory, "wal", "writer-1");
    await mkdir(shard, { recursive: true });
    const path = join(shard, "2026-09-01.jsonl");
    await writeFile(path, record(1, "2026-09-01T12:00:00.000Z"));
    await setModifiedTime(path, "2026-09-07T12:00:00.000Z");
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
        validate: async () => {
          checks += 1;
          // An append lands after validation but before unlink.
          if (checks === 2)
            await appendFile(path, record(2, "2026-09-01T12:00:01.000Z"));
          return true;
        },
      }),
      0,
    );

    const text = await readFile(path, "utf8");
    assert.equal(text.includes('"writerSequence":1'), true);
    assert.equal(text.includes('"writerSequence":2'), true);
    // The seal was published before the mtime recheck aborted the unlink.
    assert.equal(
      (await readCheckpoint({ directory }))?.sealedWal?.["writer-1"],
      1,
    );
    // The published seal covers only the validated prefix, so the delayed
    // append still replays contiguously instead of being lost.
    const recovered = await recoverSession({
      directory,
      piCursor: sourceCursor,
    });
    assert.equal(recovered.availability, "available");
    assert.deepEqual(
      recovered.running.map((row) => row.eventId),
      ["event-1", "event-2"],
    );
    await lease.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("treats empty and malformed legacy owners as ownerless and decides by mtime", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  try {
    const agedShard = join(directory, "wal", "writer-1");
    await mkdir(agedShard, { recursive: true });
    const agedPath = join(agedShard, "2026-09-01.jsonl");
    await writeFile(agedPath, record(1, "2026-09-01T12:00:00.000Z"));
    await writeFile(join(agedShard, ".owner"), "");
    await setModifiedTime(agedPath, "2026-09-07T12:00:00.000Z");

    const recentShard = join(directory, "wal", "writer-2");
    await mkdir(recentShard, { recursive: true });
    const recentPath = join(recentShard, "2026-09-01.jsonl");
    await writeFile(
      recentPath,
      recordFor("writer-2", 1, "2026-09-01T12:00:00.000Z"),
    );
    await writeFile(join(recentShard, ".owner"), "not-a-pid\n");
    await setModifiedTime(recentPath, "2026-09-20T12:00:00.000Z");

    const lease = await acquireLease(directory);
    assert.equal(
      await writeCheckpoint({
        directory,
        lease,
        checkpoint: {
          ...checkpoint(1),
          cursors: {
            pi: sourceCursor,
            wal: { "writer-1": 1, "writer-2": 1 },
          },
        },
      }),
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
    assert.equal(
      (await readdir(agedShard)).includes("2026-09-01.jsonl"),
      false,
    );
    assert.equal(
      (await readdir(recentShard)).includes("2026-09-01.jsonl"),
      true,
    );
    await lease.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("keeps pruning closed and proven-dead-owner segments regardless of recent mtime", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  try {
    const closedShard = join(directory, "wal", "writer-1");
    await mkdir(closedShard, { recursive: true });
    const closedPath = join(closedShard, "2026-09-01.jsonl");
    await writeFile(closedPath, record(1, "2026-09-01T12:00:00.000Z"));
    await writeFile(`${closedPath}.closed`, "1\n");
    await setModifiedTime(closedPath, "2026-09-20T12:00:00.000Z");

    const deadShard = join(directory, "wal", "writer-2");
    await mkdir(deadShard, { recursive: true });
    const deadPath = join(deadShard, "2026-09-01.jsonl");
    await writeFile(
      deadPath,
      recordFor("writer-2", 1, "2026-09-01T12:00:00.000Z"),
    );
    await writeFile(join(deadShard, ".owner"), `${UNREACHABLE_PID}\n`);
    await setModifiedTime(deadPath, "2026-09-20T12:00:00.000Z");

    const lease = await acquireLease(directory);
    assert.equal(
      await writeCheckpoint({
        directory,
        lease,
        checkpoint: {
          ...checkpoint(1),
          cursors: {
            pi: sourceCursor,
            wal: { "writer-1": 1, "writer-2": 1 },
          },
        },
      }),
      true,
    );

    assert.equal(
      await pruneExpiredWalSegments({
        directory,
        lease,
        now: () => directoryNow,
        validate: async () => true,
      }),
      2,
    );
    assert.equal(
      (await readdir(closedShard)).includes("2026-09-01.jsonl"),
      false,
    );
    assert.equal(
      (await readdir(deadShard)).includes("2026-09-01.jsonl"),
      false,
    );
    const sealed = (await readCheckpoint({ directory }))?.sealedWal;
    assert.equal(sealed?.["writer-1"], 1);
    assert.equal(sealed?.["writer-2"], 1);
    await lease.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("refuses to delete a non-closed segment whose owner PID is provably alive", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  try {
    const shard = join(directory, "wal", "writer-1");
    await mkdir(shard, { recursive: true });
    const path = join(shard, "2026-09-01.jsonl");
    await writeFile(path, record(1, "2026-09-01T12:00:00.000Z"));
    // The test runner's own PID is provably alive and there is no `.closed`
    // marker, so the segment must never be treated as quiescent.
    await writeFile(join(shard, ".owner"), `${process.pid}\n`);
    await setModifiedTime(path, "2026-09-07T12:00:00.000Z");
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
      0,
    );
    assert.equal((await readdir(shard)).includes("2026-09-01.jsonl"), true);
    await lease.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("treats a non-ESRCH kill failure (EPERM) as a live owner and refuses deletion", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  try {
    const shard = join(directory, "wal", "writer-1");
    await mkdir(shard, { recursive: true });
    const path = join(shard, "2026-09-01.jsonl");
    await writeFile(path, record(1, "2026-09-01T12:00:00.000Z"));
    await writeFile(join(shard, ".owner"), "4242\n");
    await setModifiedTime(path, "2026-09-07T12:00:00.000Z");
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
        killProcess: () => {
          const error = new Error("operation not permitted");
          Object.assign(error, { code: "EPERM" });
          throw error;
        },
      }),
      0,
    );
    assert.equal((await readdir(shard)).includes("2026-09-01.jsonl"), true);
    await lease.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("aborts a legacy unlink when the path is swapped for an identical-size, identical-mtime copy", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  try {
    const shard = join(directory, "wal", "writer-1");
    await mkdir(shard, { recursive: true });
    const path = join(shard, "2026-09-01.jsonl");
    const displaced = join(shard, "displaced.jsonl");
    const body = record(1, "2026-09-01T12:00:00.000Z");
    await writeFile(path, body);
    await setModifiedTime(path, "2026-09-07T12:00:00.000Z");
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
        validate: async () => {
          checks += 1;
          // A replacement inode with the same size and mtime lands after
          // validation but before unlink.
          if (checks === 2) {
            await rename(path, displaced);
            await writeFile(path, body);
            await setModifiedTime(path, "2026-09-07T12:00:00.000Z");
          }
          return true;
        },
      }),
      0,
    );

    assert.equal((await readdir(shard)).includes("2026-09-01.jsonl"), true);
    await lease.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

// --- M7 item 2: seal-phase crash injection and the cold-detail notice ---
test("P1: an interrupted validation publishes nothing and a later pass retries cleanly", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  try {
    const shard = join(directory, "wal", "writer-1");
    await mkdir(shard, { recursive: true });
    const path = join(shard, "2026-09-01.jsonl");
    await writeFile(path, record(1, "2026-09-01T12:00:00.000Z"));
    await writeFile(`${path}.closed`, "1\n");
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
        validate: async () => {
          throw new Error("interrupted before seal publication");
        },
      }),
      0,
    );
    assert.equal(
      (await readFile(path, "utf8")).includes('"writerSequence":1'),
      true,
    );
    assert.equal(
      (await readCheckpoint({ directory }))?.sealedWal?.["writer-1"],
      undefined,
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
    assert.equal((await readdir(shard)).includes("2026-09-01.jsonl"), false);
    await lease.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("P3: an interruption between seal publication and unlink converges on a later pass", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  try {
    const shard = join(directory, "wal", "writer-1");
    await mkdir(shard, { recursive: true });
    const path = join(shard, "2026-09-01.jsonl");
    await writeFile(path, record(1, "2026-09-01T12:00:00.000Z"));
    await writeFile(`${path}.closed`, "1\n");
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
          throw new Error("interrupted before unlink");
        },
      }),
      0,
    );
    assert.equal(
      (await readFile(path, "utf8")).includes('"writerSequence":1'),
      true,
    );
    assert.equal(
      (await readCheckpoint({ directory }))?.sealedWal?.["writer-1"],
      1,
    );
    const reopened = await recoverSession({
      directory,
      piCursor: sourceCursor,
    });
    assert.equal(reopened.availability, "available");
    assert.ok(reopened.diagnostics.includes("wal-sealed"));

    assert.equal(
      await pruneExpiredWalSegments({
        directory,
        lease,
        now: () => directoryNow,
        validate: async () => true,
      }),
      1,
    );
    assert.equal((await readdir(shard)).includes("2026-09-01.jsonl"), false);
    assert.equal(
      (await readCheckpoint({ directory }))?.sealedWal?.["writer-1"],
      1,
    );
    await lease.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("P4: streaming validation aborted mid-segment preserves the segment and publishes no seal", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  try {
    const shard = join(directory, "wal", "writer-1");
    await mkdir(shard, { recursive: true });
    const path = join(shard, "2026-09-01.jsonl");
    // A valid first record followed by an unparseable line interrupts the
    // streamed validation after the prefix was already read.
    await writeFile(
      path,
      `${record(1, "2026-09-01T12:00:00.000Z")}not-a-record\n`,
    );
    await writeFile(`${path}.closed`, "1\n");
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
      0,
    );
    assert.equal((await readdir(shard)).includes("2026-09-01.jsonl"), true);
    assert.equal(
      (await readCheckpoint({ directory }))?.sealedWal?.["writer-1"],
      undefined,
    );
    await lease.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("P5: tolerates an orphaned closed marker left by a crash after unlink", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  try {
    const shard = join(directory, "wal", "writer-1");
    await mkdir(shard, { recursive: true });
    // The segment was unlinked but the marker removal never ran.
    await writeFile(join(shard, "2026-09-07.jsonl.closed"), "1\n");
    const lease = await acquireLease(directory);
    assert.equal(
      await writeCheckpoint({
        directory,
        lease,
        checkpoint: sealedCheckpoint(1),
      }),
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
    assert.deepEqual(await readdir(shard), ["2026-09-07.jsonl.closed"]);
    await lease.release();

    const recovered = await recoverSession({
      directory,
      piCursor: sourceCursor,
    });
    assert.equal(recovered.availability, "available");
    assert.ok(recovered.diagnostics.includes("wal-sealed"));
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("P6: repeated maintenance passes are idempotent and never regress the seal", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  try {
    const shard = join(directory, "wal", "writer-1");
    await mkdir(shard, { recursive: true });
    for (const [name, sequence] of [
      ["2026-09-01.jsonl", 1],
      ["2026-09-02.jsonl", 2],
    ] as const) {
      const path = join(shard, name);
      await writeFile(path, record(sequence, "2026-09-01T12:00:00.000Z"));
      await writeFile(`${path}.closed`, "1\n");
    }
    const lease = await acquireLease(directory);
    assert.equal(
      await writeCheckpoint({ directory, checkpoint: checkpoint(0), lease }),
      true,
    );

    const seals: number[] = [];
    const deleted: number[] = [];
    for (let pass = 0; pass < 3; pass += 1) {
      deleted.push(
        await pruneExpiredWalSegments({
          directory,
          lease,
          now: () => directoryNow,
          validate: async () => true,
        }),
      );
      seals.push(
        (await readCheckpoint({ directory }))?.sealedWal?.["writer-1"] ?? 0,
      );
    }
    assert.deepEqual(deleted, [2, 0, 0]);
    assert.deepEqual(seals, [2, 2, 2]);
    assert.deepEqual(await readdir(shard), []);
    await lease.release();

    const recovered = await recoverSession({
      directory,
      piCursor: sourceCursor,
    });
    assert.equal(recovered.availability, "available");
    assert.equal(recovered.cursors.wal["writer-1"], 2);
    assert.ok(recovered.diagnostics.includes("wal-sealed"));
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("cold-detail notice reaches JSON and HTML while native data stays available", async () => {
  const { maintainSession } = await import("../../src/storage/maintenance.ts");
  const { loadCurrentSessionReport } = await import(
    "../../src/ui/load-current.ts"
  );
  const { renderJson } = await import("../../src/ui/json.ts");
  const { renderHtml } = await import("../../src/ui/html.ts");
  const root = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  const directory = join(root, "sessions", "session-1");
  const shard = join(directory, "wal", "writer-1");
  const source = join(root, "pi.jsonl");
  try {
    await mkdir(shard, { recursive: true });
    await writeFile(
      source,
      [
        '{"type":"session","version":3,"id":"session-1","timestamp":"2026-01-01T00:00:00Z"}',
        '{"id":"marker","parentId":null,"timestamp":"2026-01-01T00:00:00Z","type":"custom","customType":"session-inspector:tracking-start","data":{"schemaVersion":1}}',
        '{"id":"assistant","parentId":"marker","timestamp":"2026-01-01T00:00:01Z","type":"message","message":{"role":"assistant","provider":"acme","model":"alpha","content":[{"type":"toolCall","id":"call-1","name":"read","arguments":{}}],"usage":{"totalTokens":9,"cost":{"total":0.02}}}}',
        "",
      ].join("\n"),
    );
    const path = join(shard, "2026-01-01.jsonl");
    await writeFile(path, record(1, "2026-01-01T00:00:00Z"));
    await writeFile(`${path}.closed`, "1\n");

    const result = await maintainSession({
      root,
      sessionId: "session-1",
      sessionFile: source,
      writerId: "maintenance-0",
      now: () => new Date("2026-01-20T00:00:00Z"),
    });
    assert.equal(result.status, "available");
    assert.equal(
      (await readdir(shard)).some((name) => name.endsWith(".jsonl")),
      false,
    );

    const checkpoint = await readCheckpoint({ directory });
    assert.ok(checkpoint);
    const model = await loadCurrentSessionReport(source, "tree", {
      leafId: null,
      evidence: {
        atomic: [],
        folded: foldedEvidence("session-1", checkpoint),
      },
    });
    assert.ok(model);
    const report = model.report;
    assert.equal(report.walDetail, "expired");
    // Native Pi aggregates survive; live WAL-derived detail does not guess.
    assert.equal(report.usage.totalTokens, 9);
    assert.deepEqual(
      report.tools.map((tool) => tool.name),
      ["read"],
    );
    assert.equal(
      report.tools.every((tool) => tool.durationMs === undefined),
      true,
    );
    assert.equal(report.durationEvidence, "unavailable");
    assert.equal(report.agentEvidence, "unavailable");
    assert.deepEqual(report.integrations, []);

    const json = renderJson(report);
    assert.match(json, /"walDetail":"expired"/);
    assert.match(json, /"totalTokens":9/);
    assert.match(json, /"name":"read"/);

    const html = renderHtml({
      kind: "current",
      report,
      scope: "tree",
    });
    // The notice markup and its catalog copy are static template text that is
    // emitted regardless of state, so assert the dynamic embedded report data
    // itself carries the cold state.
    const embedded =
      /<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/.exec(
        html,
      );
    assert.notEqual(embedded, null);
    assert.equal(JSON.parse(embedded?.[1] ?? "{}").walDetail, "expired");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

function inventorySnapshot(observedAt?: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    ...(observedAt === undefined ? {} : { observedAt }),
    commands: [],
    skills: [],
    resources: [],
    toolSources: {},
  });
}

test("expires an aged inventory snapshot while keeping a current one and persists its counts", async () => {
  const { maintainSession } = await import("../../src/storage/maintenance.ts");
  const root = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  const directory = join(root, "sessions", "session-1");
  const source = join(root, "pi.jsonl");
  // `directoryNow` is 2026-09-21, so the cutoff day is 2026-09-08.
  const agedSnapshot = inventorySnapshot("2026-09-07T12:00:00.000Z");
  const currentSnapshot = inventorySnapshot("2026-09-20T12:00:00.000Z");
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(
      source,
      [
        '{"type":"session","version":3,"id":"session-1","timestamp":"2026-09-01T00:00:00Z"}',
        '{"id":"marker","parentId":null,"timestamp":"2026-09-01T00:00:00Z","type":"custom","customType":"session-inspector:tracking-start","data":{"schemaVersion":1}}',
        "",
      ].join("\n"),
    );
    const inventory = join(directory, "inventory.json");
    // The observation is aged but the mtime is deliberately recent: only
    // `observedAt` may authorize expiry.
    await writeFile(inventory, agedSnapshot);
    await setModifiedTime(inventory, "2026-09-20T12:00:00.000Z");

    assert.equal(
      (
        await maintainSession({
          root,
          sessionId: "session-1",
          sessionFile: source,
          writerId: "maintenance-inventory",
          now: () => directoryNow,
          inventoryCounts: { commands: 3, skills: 1 },
        })
      ).status,
      "available",
    );
    assert.equal((await readdir(directory)).includes("inventory.json"), false);
    assert.deepEqual(
      (await readCheckpoint({ directory }))?.aggregates.resourceCounts,
      { commands: 3, skills: 1 },
    );

    // A snapshot whose observation is inside the retention window survives the
    // identical pass even with an aged mtime.
    await writeFile(inventory, currentSnapshot);
    await setModifiedTime(inventory, "2026-09-01T12:00:00.000Z");
    assert.equal(
      (
        await maintainSession({
          root,
          sessionId: "session-1",
          sessionFile: source,
          writerId: "maintenance-inventory-2",
          now: () => directoryNow,
          inventoryCounts: { commands: 3, skills: 1 },
        })
      ).status,
      "available",
    );
    assert.equal((await readdir(directory)).includes("inventory.json"), true);

    // The deletion is returned in the existing maintenance count.
    await writeFile(inventory, agedSnapshot);
    await setModifiedTime(inventory, "2026-09-20T12:00:00.000Z");
    const lease = await acquireLease(directory);
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
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("keeps an aged inventory snapshot when no checkpoint can record its expiry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  try {
    const inventory = join(directory, "inventory.json");
    const lease = await acquireLease(directory);

    // Without a checkpoint there is nowhere to record the durable expiry
    // boundary, so physical deletion is forbidden. The recent mtime proves
    // this still reasons from `observedAt`, not mtime.
    await writeFile(inventory, inventorySnapshot("2026-09-07T12:00:00.000Z"));
    await setModifiedTime(inventory, "2026-09-20T12:00:00.000Z");
    assert.equal(
      await pruneExpiredWalSegments({
        directory,
        lease,
        now: () => directoryNow,
        validate: async () => true,
      }),
      0,
    );
    assert.equal((await readdir(directory)).includes("inventory.json"), true);

    // A snapshot inside the retention window also survives the identical pass even
    // with an aged mtime.
    await writeFile(inventory, inventorySnapshot("2026-09-20T12:00:00.000Z"));
    await setModifiedTime(inventory, "2026-09-01T12:00:00.000Z");
    assert.equal(
      await pruneExpiredWalSegments({
        directory,
        lease,
        now: () => directoryNow,
        validate: async () => true,
      }),
      0,
    );
    assert.equal((await readdir(directory)).includes("inventory.json"), true);
    await lease.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("keeps an inventory snapshot with no observedAt regardless of mtime", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  try {
    const inventory = join(directory, "inventory.json");
    // A legacy snapshot carries no freshness evidence; retention keeps it
    // rather than guessing from mtime.
    await writeFile(inventory, inventorySnapshot());
    await setModifiedTime(inventory, "2026-09-01T12:00:00.000Z");
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
    assert.equal((await readdir(directory)).includes("inventory.json"), true);
    await lease.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("keeps an inventory snapshot whose observedAt is invalid", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  try {
    const inventory = join(directory, "inventory.json");
    await writeFile(inventory, inventorySnapshot("not-a-time"));
    await setModifiedTime(inventory, "2026-09-01T12:00:00.000Z");
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
    assert.equal((await readdir(directory)).includes("inventory.json"), true);
    await lease.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

// --- Task 17: retention records the exact expiration boundary ---

test("pruning records the exact WAL expiration boundary once detail is gone", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  try {
    const shard = join(directory, "wal", "writer-1");
    await mkdir(shard, { recursive: true });
    const path = join(shard, "2026-09-01.jsonl");
    await writeFile(path, record(1, "2026-09-01T12:34:56.789Z"));
    await writeFile(`${path}.closed`, "1\n");
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
    // The boundary is the newest pruned record's own instant, never the
    // retention cutoff day (2026-09-08 here) and never the file mtime.
    assert.equal(
      (await readCheckpoint({ directory }))?.evidence?.detailCoverage
        ?.walDetailExpiredBefore,
      "2026-09-01T12:34:56.789Z",
    );
    await lease.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("kept WAL detail leaves the expiration boundary unset", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  try {
    const shard = join(directory, "wal", "writer-1");
    await mkdir(shard, { recursive: true });
    const path = join(shard, "2026-09-20.jsonl");
    await writeFile(path, record(1, "2026-09-20T12:00:00.000Z"));
    await writeFile(`${path}.closed`, "1\n");
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
      0,
    );
    assert.equal(
      (await readCheckpoint({ directory }))?.evidence?.detailCoverage,
      undefined,
    );
    await lease.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("a session with no pruning keeps the detail-coverage boundary absent", async () => {
  const fresh = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  try {
    assert.equal(
      (await readCheckpoint({ directory: fresh }))?.evidence?.detailCoverage,
      undefined,
    );
  } finally {
    await rm(fresh, { force: true, recursive: true });
  }
});

test("the WAL expiration boundary is monotonic across passes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  try {
    const shard = join(directory, "wal", "writer-1");
    await mkdir(shard, { recursive: true });
    const first = join(shard, "2026-09-01.jsonl");
    await writeFile(first, record(1, "2026-09-01T12:00:00.000Z"));
    await writeFile(`${first}.closed`, "1\n");
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
    assert.equal(
      (await readCheckpoint({ directory }))?.evidence?.detailCoverage
        ?.walDetailExpiredBefore,
      "2026-09-01T12:00:00.000Z",
    );

    // A later pass prunes an *older* record (a writer clock rollback): the
    // boundary must stay at the maximum instant already published.
    const second = join(shard, "2026-09-02.jsonl");
    await writeFile(second, record(2, "2026-09-01T09:00:00.000Z"));
    await writeFile(`${second}.closed`, "1\n");
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
      (await readCheckpoint({ directory }))?.evidence?.detailCoverage
        ?.walDetailExpiredBefore,
      "2026-09-01T12:00:00.000Z",
    );
    await lease.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("an aborted prune leaves the WAL expiration boundary unset", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  try {
    const shard = join(directory, "wal", "writer-1");
    await mkdir(shard, { recursive: true });
    const path = join(shard, "2026-09-01.jsonl");
    await writeFile(path, record(1, "2026-09-01T12:00:00.000Z"));
    await writeFile(`${path}.closed`, "1\n");
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
        validate: async () => false,
      }),
      0,
    );
    assert.equal(
      (await readCheckpoint({ directory }))?.evidence?.detailCoverage,
      undefined,
    );
    await lease.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("inventory pruning records the pruned snapshot's own observation instant", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  try {
    const inventory = join(directory, "inventory.json");
    await writeFile(inventory, inventorySnapshot("2026-09-07T12:00:00.000Z"));
    await setModifiedTime(inventory, "2026-09-20T12:00:00.000Z");
    const lease = await acquireLease(directory);
    assert.equal(
      await writeCheckpoint({ directory, checkpoint: checkpoint(0), lease }),
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
    assert.equal((await readdir(directory)).includes("inventory.json"), false);
    const coverage = (await readCheckpoint({ directory }))?.evidence
      ?.detailCoverage;
    assert.equal(
      coverage?.inventoryDetailExpiredAt,
      "2026-09-07T12:00:00.000Z",
    );
    assert.equal(coverage?.walDetailExpiredBefore, undefined);
    await lease.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("a kept inventory snapshot leaves its expiration boundary unset", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  try {
    const inventory = join(directory, "inventory.json");
    await writeFile(inventory, inventorySnapshot("2026-09-20T12:00:00.000Z"));
    const lease = await acquireLease(directory);
    assert.equal(
      await writeCheckpoint({ directory, checkpoint: checkpoint(0), lease }),
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
      (await readCheckpoint({ directory }))?.evidence?.detailCoverage,
      undefined,
    );
    await lease.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("re-running retention with no new pruning never rewrites the checkpoint", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  try {
    const shard = join(directory, "wal", "writer-1");
    await mkdir(shard, { recursive: true });
    const path = join(shard, "2026-09-01.jsonl");
    await writeFile(path, record(1, "2026-09-01T12:00:00.000Z"));
    await writeFile(`${path}.closed`, "1\n");
    const inventory = join(directory, "inventory.json");
    await writeFile(inventory, inventorySnapshot("2026-09-07T12:00:00.000Z"));
    const lease = await acquireLease(directory);
    assert.equal(
      await writeCheckpoint({ directory, checkpoint: checkpoint(1), lease }),
      true,
    );

    // One WAL segment plus one inventory snapshot are pruned in this pass.
    assert.equal(
      await pruneExpiredWalSegments({
        directory,
        lease,
        now: () => directoryNow,
        validate: async () => true,
      }),
      2,
    );
    const checkpointPath = join(directory, "checkpoint.json");
    const bytes = await readFile(checkpointPath, "utf8");
    const written = await stat(checkpointPath);
    assert.equal(
      bytes.includes('"walDetailExpiredBefore":"2026-09-01T12:00:00.000Z"'),
      true,
    );
    assert.equal(
      bytes.includes('"inventoryDetailExpiredAt":"2026-09-07T12:00:00.000Z"'),
      true,
    );

    // Nothing new is prunable: the checkpoint must keep both its bytes and its
    // inode (a rewrite publishes a new temp file, so `ino` catches a same-ms
    // rewrite that `mtimeMs` alone would miss).
    assert.equal(
      await pruneExpiredWalSegments({
        directory,
        lease,
        now: () => directoryNow,
        validate: async () => true,
      }),
      0,
    );
    assert.equal(await readFile(checkpointPath, "utf8"), bytes);
    const after = await stat(checkpointPath);
    assert.equal(after.ino, written.ino);
    assert.equal(after.mtimeMs, written.mtimeMs);
    await lease.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

/**
 * Task 17 carry: the "skip the rewrite" guard. The pass recomputes the same
 * seal, cursor and boundary for a still-present, already-sealed segment, so it
 * must publish nothing. A rewrite would replace `checkpoint.json` with a new
 * temp file (new inode) even when the bytes are unchanged.
 */
test("a still-present already-sealed segment never rewrites the checkpoint", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  try {
    const shard = join(directory, "wal", "writer-1");
    await mkdir(shard, { recursive: true });
    const segment = join(shard, "2026-09-01.jsonl");
    await writeFile(segment, record(1, "2026-09-01T12:00:00.000Z"));
    await writeFile(`${segment}.closed`, "1\n");
    const lease = await acquireLease(directory);
    // Sealed at the same sequence AND already carrying the exact boundary this
    // pass recomputes: only the unlink is outstanding (for example because an
    // earlier `remove` failed after the seal was published).
    const alreadySealed: Checkpoint = {
      ...sealedCheckpoint(1),
      evidence: {
        detailCoverage: { walDetailExpiredBefore: "2026-09-01T12:00:00.000Z" },
      },
    };
    assert.equal(
      await writeCheckpoint({ directory, checkpoint: alreadySealed, lease }),
      true,
    );
    const checkpointPath = join(directory, "checkpoint.json");
    const bytesBefore = await readFile(checkpointPath, "utf8");
    const inodeBefore = (await stat(checkpointPath)).ino;

    // The unlink keeps failing, so the segment stays present and every pass
    // revisits it with nothing new to seal.
    const failingRemove = async () => {
      throw new Error("simulated unlink failure");
    };
    const prune = () =>
      pruneExpiredWalSegments({
        directory,
        lease,
        now: () => directoryNow,
        validate: async () => true,
        remove: failingRemove,
      });
    assert.equal(await prune(), 0);
    assert.equal(await prune(), 0);

    assert.equal(await readFile(checkpointPath, "utf8"), bytesBefore);
    assert.equal((await stat(checkpointPath)).ino, inodeBefore);
    assert.equal(
      (await readCheckpoint({ directory }))?.evidence?.detailCoverage
        ?.walDetailExpiredBefore,
      "2026-09-01T12:00:00.000Z",
    );
    assert.equal((await readdir(shard)).includes("2026-09-01.jsonl"), true);
    await lease.release();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a retention cutoff between two observations keeps the snapshot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-retention-"));
  try {
    const inventory = join(directory, "inventory.json");
    // Cutoff day 2026-09-12; the latest successful observation (T2) is that
    // same day, so it is not strictly before the cutoff and must be kept even
    // though the file mtime is aged.
    const now = () => new Date("2026-09-25T12:00:00.000Z");
    await writeFile(inventory, inventorySnapshot("2026-09-12T11:00:00.000Z"));
    await setModifiedTime(inventory, "2026-09-01T12:00:00.000Z");
    const lease = await acquireLease(directory);
    assert.equal(
      await pruneExpiredWalSegments({
        directory,
        lease,
        now,
        validate: async () => true,
      }),
      0,
    );
    assert.equal((await readdir(directory)).includes("inventory.json"), true);

    // The day before the cutoff is eligible, but no checkpoint means no
    // durable expiration record, so it remains present.
    await writeFile(inventory, inventorySnapshot("2026-09-11T11:00:00.000Z"));
    await setModifiedTime(inventory, "2026-09-20T12:00:00.000Z");
    assert.equal(
      await pruneExpiredWalSegments({
        directory,
        lease,
        now,
        validate: async () => true,
      }),
      0,
    );
    assert.equal((await readdir(directory)).includes("inventory.json"), true);
    await lease.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

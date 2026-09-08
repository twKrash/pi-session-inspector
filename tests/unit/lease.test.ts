import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

type MaintenanceLease = {
  release(): Promise<void>;
};

type AcquireMaintenanceLease = (options: {
  directory: string;
  writerId: string;
  now: () => Date;
  isPidAlive: (pid: number) => boolean;
}) => Promise<MaintenanceLease | undefined>;

async function loadLease(): Promise<AcquireMaintenanceLease | undefined> {
  try {
    return (
      await import(new URL("../../src/storage/lease.ts", import.meta.url).href)
    ).acquireMaintenanceLease;
  } catch {
    return undefined;
  }
}

const start = new Date("2026-09-07T12:00:00.000Z");

function at(milliseconds: number): () => Date {
  return () => new Date(start.getTime() + milliseconds);
}

test("acquires one atomic per-session lease with bounded control metadata", async () => {
  const acquireMaintenanceLease = await loadLease();
  assert.ok(acquireMaintenanceLease);

  const directory = await mkdtemp(join(tmpdir(), "inspector-lease-"));
  try {
    const lease = await acquireMaintenanceLease({
      directory,
      writerId: "writer-1",
      now: at(0),
      isPidAlive: () => true,
    });

    assert.ok(lease);
    const metadata = JSON.parse(
      await readFile(
        join(directory, "maintenance.lease", "owner.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    assert.deepEqual(Object.keys(metadata).sort(), [
      "acquiredAt",
      "expiresAt",
      "pid",
      "schemaVersion",
      "writerId",
    ]);
    assert.equal(metadata.schemaVersion, 1);
    assert.equal(metadata.writerId, "writer-1");
    assert.equal(metadata.acquiredAt, start.getTime());
    assert.equal(typeof metadata.pid, "number");
    assert.equal(typeof metadata.expiresAt, "number");

    await lease.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("returns undefined to a maintenance contender", async () => {
  const acquireMaintenanceLease = await loadLease();
  assert.ok(acquireMaintenanceLease);

  const directory = await mkdtemp(join(tmpdir(), "inspector-lease-"));
  try {
    const first = await acquireMaintenanceLease({
      directory,
      writerId: "writer-1",
      now: at(0),
      isPidAlive: () => true,
    });
    assert.ok(first);

    assert.equal(
      await acquireMaintenanceLease({
        directory,
        writerId: "writer-2",
        now: at(1),
        isPidAlive: () => true,
      }),
      undefined,
    );
    await first.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("recovers only an expired lease whose owner PID is dead", async () => {
  const acquireMaintenanceLease = await loadLease();
  assert.ok(acquireMaintenanceLease);

  const directory = await mkdtemp(join(tmpdir(), "inspector-lease-"));
  try {
    const first = await acquireMaintenanceLease({
      directory,
      writerId: "writer-1",
      now: at(0),
      isPidAlive: () => true,
    });
    assert.ok(first);

    const expiredButAlive = await acquireMaintenanceLease({
      directory,
      writerId: "writer-2",
      now: at(30_001),
      isPidAlive: () => true,
    });
    assert.equal(expiredButAlive, undefined);

    const recovered = await acquireMaintenanceLease({
      directory,
      writerId: "writer-2",
      now: at(30_001),
      isPidAlive: () => false,
    });
    assert.ok(recovered);
    await recovered.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("only one concurrent stale reclaimer can replace the observed owner", async () => {
  const acquireMaintenanceLease = await loadLease();
  assert.ok(acquireMaintenanceLease);

  const directory = await mkdtemp(join(tmpdir(), "inspector-lease-"));
  try {
    const original = await acquireMaintenanceLease({
      directory,
      writerId: "writer-1",
      now: at(0),
      isPidAlive: () => true,
    });
    assert.ok(original);

    const reclaimers = await Promise.all(
      Array.from({ length: 16 }, (_, index) =>
        acquireMaintenanceLease({
          directory,
          writerId: `writer-${index + 2}`,
          now: at(30_001),
          isPidAlive: () => false,
        }),
      ),
    );
    const winners = reclaimers.filter(
      (lease): lease is MaintenanceLease => lease !== undefined,
    );
    assert.equal(winners.length, 1);

    await original.release();
    assert.equal(
      await acquireMaintenanceLease({
        directory,
        writerId: "late-reclaimer",
        now: at(30_002),
        isPidAlive: () => false,
      }),
      undefined,
    );
    await winners[0]?.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("release cleanup is idempotent when called from finally", async () => {
  const acquireMaintenanceLease = await loadLease();
  assert.ok(acquireMaintenanceLease);

  const directory = await mkdtemp(join(tmpdir(), "inspector-lease-"));
  try {
    const lease = await acquireMaintenanceLease({
      directory,
      writerId: "writer-1",
      now: at(0),
      isPidAlive: () => true,
    });
    assert.ok(lease);

    try {
      throw new Error("maintenance failed");
    } catch {
      // Simulate a maintenance failure while preserving finally cleanup.
    } finally {
      await lease.release();
    }
    await lease.release();
    await assert.rejects(stat(join(directory, "maintenance.lease")), {
      code: "ENOENT",
    });

    const next = await acquireMaintenanceLease({
      directory,
      writerId: "writer-2",
      now: at(1),
      isPidAlive: () => true,
    });
    assert.ok(next);
    await next.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("only one contender can reclaim an ownerless incomplete final directory", async () => {
  const acquireMaintenanceLease = await loadLease();
  assert.ok(acquireMaintenanceLease);

  const directory = await mkdtemp(join(tmpdir(), "inspector-lease-"));
  try {
    await mkdir(join(directory, "maintenance.lease"));
    const contenders = await Promise.all(
      Array.from({ length: 16 }, (_, index) =>
        acquireMaintenanceLease({
          directory,
          writerId: `writer-${index + 1}`,
          now: at(0),
          isPidAlive: () => true,
        }),
      ),
    );
    const winners = contenders.filter(
      (lease): lease is MaintenanceLease => lease !== undefined,
    );
    assert.equal(winners.length, 1);
    assert.equal(
      await acquireMaintenanceLease({
        directory,
        writerId: "late-contender",
        now: at(1),
        isPidAlive: () => true,
      }),
      undefined,
    );
    await winners[0]?.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("recovers ownerless incomplete acquisition while malformed leases fail safe", async () => {
  const acquireMaintenanceLease = await loadLease();
  assert.ok(acquireMaintenanceLease);

  const directory = await mkdtemp(join(tmpdir(), "inspector-lease-"));
  try {
    await mkdir(join(directory, "maintenance.lease"));
    const recovered = await acquireMaintenanceLease({
      directory,
      writerId: "writer-1",
      now: at(30_001),
      isPidAlive: () => false,
    });
    assert.ok(recovered);
    await recovered.release();

    await mkdir(join(directory, "maintenance.lease"));
    await writeFile(
      join(directory, "maintenance.lease", "owner.json"),
      '{"unexpectedField":"malformed"}',
    );
    assert.equal(
      await acquireMaintenanceLease({
        directory,
        writerId: "writer-1",
        now: at(30_001),
        isPidAlive: () => false,
      }),
      undefined,
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("recovers an abandoned expired dead stale-takeover claim", async () => {
  const acquireMaintenanceLease = await loadLease();
  assert.ok(acquireMaintenanceLease);

  const directory = await mkdtemp(join(tmpdir(), "inspector-lease-"));
  try {
    const leaseDirectory = join(directory, "maintenance.lease");
    const owner = {
      schemaVersion: 1,
      writerId: "writer-1",
      pid: process.pid,
      acquiredAt: start.getTime(),
      expiresAt: start.getTime() + 30_000,
    };
    const ownerText = JSON.stringify(owner);
    const { createHash } = await import("node:crypto");
    const claimDirectory = join(
      leaseDirectory,
      `.reclaim-${createHash("sha256").update(ownerText).digest("hex")}`,
    );
    await mkdir(claimDirectory, { recursive: true });
    await writeFile(join(leaseDirectory, "owner.json"), ownerText);
    await writeFile(
      join(claimDirectory, "claim.json"),
      JSON.stringify({
        ...owner,
        writerId: "abandoned-claimer",
      }),
    );

    const recovered = await acquireMaintenanceLease({
      directory,
      writerId: "writer-2",
      now: at(60_001),
      isPidAlive: () => false,
    });
    assert.ok(recovered);
    await recovered.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("storage failures skip maintenance without persisting input", async () => {
  const acquireMaintenanceLease = await loadLease();
  assert.ok(acquireMaintenanceLease);

  const directory = await mkdtemp(join(tmpdir(), "inspector-lease-"));
  try {
    await rm(directory, { force: true, recursive: true });
    assert.equal(
      await acquireMaintenanceLease({
        directory: join(directory, "missing", "session"),
        writerId: "writer-1",
        now: at(0),
        isPidAlive: () => true,
      }),
      undefined,
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

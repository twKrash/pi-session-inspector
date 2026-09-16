import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { foldedFromCheckpointAggregates } from "../../src/core/live-counter-fold.ts";
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
    ...(value.sealedWal === undefined
      ? {}
      : { sealedWal: Object.fromEntries(Object.entries(value.sealedWal)) }),
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

test("accepts validated folded aggregates and rejects unsafe ones", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-checkpoint-"));
  try {
    const lease = await acquireLease(directory);
    const written = await writeCheckpoint({
      directory,
      lease,
      checkpoint: {
        schemaVersion: 1,
        cursors: { pi: sourceCursor(1), wal: { "writer-a": 2 } },
        aggregates: {
          totalTokens: 1,
          totalCost: 0,
          generations: 1,
          tools: 0,
          compactions: 0,
          integrationCounters: {
            permission: { decisions: 2, allowed: 1, denied: 1 },
          },
          skillInvocations: { "council-mode": 3 },
          skillOverflowInvocations: 4,
          presence: { permission: true },
          resourceCounts: { commands: 12, skills: 4 },
        },
      },
    });
    assert.equal(written, true);

    const read = await readCheckpoint({ directory });
    assert.deepEqual(read?.aggregates.integrationCounters, {
      permission: { decisions: 2, allowed: 1, denied: 1 },
    });
    assert.deepEqual(read?.aggregates.skillInvocations, { "council-mode": 3 });
    assert.equal(read?.aggregates.skillOverflowInvocations, 4);
    assert.equal(read?.aggregates.presence?.permission, true);
    assert.deepEqual(read?.aggregates.resourceCounts, {
      commands: 12,
      skills: 4,
    });
    await lease.release();

    for (const bad of [
      { skillInvocations: { "../escape": 1 } },
      { skillInvocations: { ok: -1 } },
      { skillInvocations: { ok: 1.5 } },
      {
        skillInvocations: Object.fromEntries(
          Array.from({ length: 65 }, (_, i) => [`s${i}`, 1]),
        ),
      },
      { skillOverflowInvocations: -1 },
      { skillOverflowInvocations: 1.5 },
      { presence: { permission: "yes" } },
      { presence: { context: true } },
      { resourceCounts: { commands: 1 } },
      { integrationCounters: { permission: { decisions: "2" } } },
    ]) {
      const candidate = {
        schemaVersion: 1,
        cursors: { pi: sourceCursor(1), wal: {} },
        aggregates: {
          totalTokens: 0,
          totalCost: 0,
          generations: 0,
          tools: 0,
          compactions: 0,
          ...bad,
        },
      };
      const isolated = await mkdtemp(
        join(tmpdir(), "inspector-checkpoint-bad-"),
      );
      const isolatedLease = await acquireLease(isolated);
      try {
        assert.equal(
          await writeCheckpoint({
            directory: isolated,
            lease: isolatedLease,
            checkpoint: candidate,
          }),
          false,
          `expected rejection for ${JSON.stringify(bad)}`,
        );
      } finally {
        await isolatedLease.release();
        await rm(isolated, { force: true, recursive: true });
      }
    }
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("resource counts extend in place and evidence is a single sibling", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-checkpoint-"));
  try {
    const lease = await acquireLease(directory);
    const withEvidence: Checkpoint = {
      schemaVersion: 1,
      cursors: { pi: sourceCursor(0), wal: {} },
      aggregates: {
        totalTokens: 0,
        totalCost: 0,
        generations: 0,
        tools: 0,
        compactions: 0,
        resourceCounts: {
          commands: 3,
          skills: 2,
          resources: 1,
          toolSources: 4,
          observedAt: "2026-09-12T10:00:00.000Z",
        },
      },
      evidence: {
        checkpointedAt: "2026-09-12T10:00:01.000Z",
        detailCoverage: {
          walDetailExpiredBefore: "2026-09-01T00:00:00.000Z",
          inventoryDetailExpiredAt: "2026-09-02T00:00:00.000Z",
        },
        usageCoverage: {
          generations: "complete",
          toolResults: "partial",
          compactions: "unavailable",
          branchSummaries: "partial",
        },
      },
    };
    assert.equal(
      await writeCheckpoint({ directory, checkpoint: withEvidence, lease }),
      true,
    );

    const read = await readCheckpoint({ directory });
    assert.deepEqual(
      read?.aggregates.resourceCounts,
      withEvidence.aggregates.resourceCounts,
    );
    assert.equal(read?.evidence?.checkpointedAt, "2026-09-12T10:00:01.000Z");
    assert.deepEqual(
      read?.evidence?.detailCoverage,
      withEvidence.evidence?.detailCoverage,
    );
    assert.deepEqual(
      read?.evidence?.usageCoverage,
      withEvidence.evidence?.usageCoverage,
    );
    // The raw persisted bytes, not the reconstructed read, must pin exactly one
    // physical resource-count location and one metadata object.
    const raw = JSON.parse(
      await readFile(join(directory, "checkpoint.json"), "utf8"),
    ) as {
      aggregates: Record<string, unknown>;
      evidence: Record<string, unknown>;
    };
    assert.deepEqual(
      Object.keys(raw.evidence).filter(
        (key) =>
          !["checkpointedAt", "detailCoverage", "usageCoverage"].includes(key),
      ),
      [],
    );
    assert.equal(Object.hasOwn(raw.aggregates, "resourceCounts"), true);
    assert.deepEqual(
      raw.aggregates.resourceCounts,
      withEvidence.aggregates.resourceCounts,
    );
    // `resourceCounts` appears exactly once in the serialized state, i.e. only
    // under `aggregates` and never mirrored into `evidence`.
    assert.equal(JSON.stringify(raw).match(/"resourceCounts"/g)?.length, 1);
    await lease.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("legacy checkpoint without evidence still parses", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-checkpoint-"));
  try {
    const legacy = {
      schemaVersion: 1,
      cursors: { pi: sourceCursor(1), wal: {} },
      aggregates: {
        totalTokens: 0,
        totalCost: 0,
        generations: 0,
        tools: 0,
        compactions: 0,
        resourceCounts: { commands: 1, skills: 1 },
      },
    };
    await writeFile(join(directory, "checkpoint.json"), JSON.stringify(legacy));
    const read = await readCheckpoint({ directory });
    assert.equal(read?.evidence, undefined);
    assert.deepEqual(read?.aggregates.resourceCounts, {
      commands: 1,
      skills: 1,
    });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("rejects present-but-invalid evidence and extended resource counts", async () => {
  for (const aggregates of [
    { resourceCounts: { commands: 1, skills: 1, resources: -1 } },
    { resourceCounts: { commands: 1, skills: 1, resources: 1_000_000_001 } },
    { resourceCounts: { commands: 1, skills: 1, toolSources: 1.5 } },
    { resourceCounts: { commands: 1, skills: 1, toolSources: 1_000_000_001 } },
    { resourceCounts: { commands: 1, skills: 1, observedAt: "whenever" } },
    { resourceCounts: { commands: 1, skills: 1, observedAt: 42 } },
  ]) {
    await assertCheckpointRejected({ aggregates });
  }

  for (const evidence of [
    { checkpointedAt: "not-a-time" },
    { checkpointedAt: 42 },
    { detailCoverage: { walDetailExpiredBefore: 42 } },
    { detailCoverage: { inventoryDetailExpiredAt: "whenever" } },
    {
      usageCoverage: {
        generations: "guessed",
        toolResults: "complete",
        compactions: "complete",
        branchSummaries: "complete",
      },
    },
    { usageCoverage: { generations: "complete" } },
  ]) {
    await assertCheckpointRejected({ evidence });
  }
});

async function assertCheckpointRejected({
  aggregates,
  evidence,
}: {
  aggregates?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
}): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "inspector-checkpoint-bad-"));
  const lease = await acquireLease(directory);
  try {
    const candidate = {
      schemaVersion: 1,
      cursors: { pi: sourceCursor(1), wal: {} },
      aggregates: {
        totalTokens: 0,
        totalCost: 0,
        generations: 0,
        tools: 0,
        compactions: 0,
        ...aggregates,
      },
      ...(evidence === undefined ? {} : { evidence }),
    };
    assert.equal(
      await writeCheckpoint({ directory, lease, checkpoint: candidate }),
      false,
      `expected rejection for ${JSON.stringify({ aggregates, evidence })}`,
    );
  } finally {
    await lease.release();
    await rm(directory, { force: true, recursive: true });
  }
}

test("reads legacy and folded checkpoint fixtures", async () => {
  const cases = [
    {
      name: "legacy-v1.json",
      skillInvocations: undefined,
      resourceCounts: undefined,
      presence: undefined,
    },
    {
      name: "folded-v1.json",
      skillInvocations: { "council-mode": 2, "caveman-mode": 1 },
      resourceCounts: { commands: 12, skills: 4 },
      presence: { permission: true },
    },
  ];
  for (const fixture of cases) {
    const directory = await mkdtemp(join(tmpdir(), "inspector-checkpoint-"));
    try {
      const contents = await readFile(
        new URL(`../fixtures/checkpoints/${fixture.name}`, import.meta.url),
        "utf8",
      );
      await writeFile(join(directory, "checkpoint.json"), contents);
      const read = await readCheckpoint({ directory });
      assert.notEqual(read, undefined);
      assert.deepEqual(
        read?.aggregates.skillInvocations,
        fixture.skillInvocations,
      );
      assert.deepEqual(read?.aggregates.resourceCounts, fixture.resourceCounts);
      assert.deepEqual(read?.aggregates.presence, fixture.presence);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }
});

test("reads folded aggregates through the counter-fold reader without coercion", () => {
  const folded = foldedFromCheckpointAggregates({
    integrationCounters: {
      permission: { decisions: 2, impossible: -1 },
      "../escape": { decisions: 1 },
    },
    skillInvocations: { "council-mode": 3, "../escape": 1 },
    skillOverflowInvocations: 2,
    presence: { permission: true },
  });

  assert.deepEqual(folded.counters, { permission: { decisions: 2 } });
  assert.deepEqual(folded.skillInvocations, { "council-mode": 3 });
  assert.equal(folded.otherInvocations, 2);
  assert.equal(folded.presence.permission, true);
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

test("rejects a stale or seal-regressing checkpoint without disturbing newer retained state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-checkpoint-seal-"));
  try {
    const lease = await acquireLease(directory);
    const sealed: Checkpoint = {
      ...checkpoint,
      cursors: {
        pi: sourceCursor(12),
        wal: { "writer-1": 7, "writer-2": 2 },
      },
      sealingVersion: 1,
      sealedWal: { "writer-1": 5, "writer-2": 2 },
    };
    assert.equal(
      await writeCheckpoint({ directory, lease, checkpoint: sealed }),
      true,
    );
    const stored = comparableCheckpoint(await readCheckpoint({ directory }));

    const regressions: [string, unknown][] = [
      [
        "an older Pi cursor",
        { ...sealed, cursors: { ...sealed.cursors, pi: sourceCursor(11) } },
      ],
      ["a dropped sealing version", { ...sealed, sealingVersion: undefined }],
      ["a dropped seal map", { ...sealed, sealedWal: undefined }],
      ["an emptied seal map", { ...sealed, sealedWal: {} }],
      [
        "a seal cursor regression",
        { ...sealed, sealedWal: { "writer-1": 4, "writer-2": 2 } },
      ],
      ["a dropped sealed writer", { ...sealed, sealedWal: { "writer-2": 2 } }],
      [
        "a WAL cursor regression",
        {
          ...sealed,
          cursors: {
            pi: sourceCursor(12),
            wal: { "writer-1": 6, "writer-2": 2 },
          },
        },
      ],
      [
        "a dropped WAL writer",
        {
          ...sealed,
          cursors: { pi: sourceCursor(12), wal: { "writer-1": 7 } },
        },
      ],
    ];
    for (const [name, candidate] of regressions) {
      assert.equal(
        await writeCheckpoint({ directory, lease, checkpoint: candidate }),
        false,
        name,
      );
      assert.deepEqual(
        comparableCheckpoint(await readCheckpoint({ directory })),
        stored,
        name,
      );
    }

    // The guard blocks regressions only: a genuinely advancing seal and cursor
    // still publishes, so a later maintainer can extend retained state.
    const advanced: Checkpoint = {
      ...sealed,
      cursors: { pi: sourceCursor(12), wal: { "writer-1": 8, "writer-2": 5 } },
      sealedWal: { "writer-1": 6, "writer-2": 5 },
    };
    assert.equal(
      await writeCheckpoint({ directory, lease, checkpoint: advanced }),
      true,
    );
    assert.deepEqual(
      comparableCheckpoint(await readCheckpoint({ directory })),
      advanced,
    );
    await lease.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("rejects a checkpoint whose seal is ahead of its own WAL cursor", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-checkpoint-seal-"));
  try {
    await writeFile(
      join(directory, "checkpoint.json"),
      JSON.stringify({
        schemaVersion: 1,
        cursors: { pi: sourceCursor(12), wal: { "writer-1": 4 } },
        aggregates: checkpoint.aggregates,
        sealingVersion: 1,
        sealedWal: { "writer-1": 5 },
      }),
    );
    // A corrupt seal can never become authoritative state.
    assert.equal(await readCheckpoint({ directory }), undefined);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("readers observe a complete previous or new checkpoint while a replacement is published", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-checkpoint-swap-"));
  try {
    const lease = await acquireLease(directory);
    const candidates = Array.from(
      { length: 24 },
      (_, index): Checkpoint => ({
        schemaVersion: 1,
        cursors: {
          pi: sourceCursor(index + 1),
          wal: { "writer-1": index + 1 },
        },
        aggregates: {
          totalTokens: (index + 1) * 10,
          totalCost: 0,
          generations: 1,
          tools: 0,
          compactions: 0,
        },
      }),
    );
    const key = (value: Checkpoint): string =>
      `${value.cursors.pi.lineCount}:${value.cursors.wal["writer-1"]}:${value.aggregates.totalTokens}`;
    const allowed = new Set(candidates.map(key));
    assert.equal(
      await writeCheckpoint({ directory, lease, checkpoint: candidates[0] }),
      true,
    );

    const observed: string[] = [];
    let finished = false;
    const readers = Array.from({ length: 3 }, async () => {
      while (!finished || observed.length < 96) {
        const read = await readCheckpoint({ directory });
        observed.push(read === undefined ? "undefined" : key(read));
      }
    });

    try {
      for (const next of candidates.slice(1)) {
        // Race a read against every replacement: the atomic rename must expose
        // either the previous or the new complete checkpoint, never a partial
        // or mixed one.
        const write = writeCheckpoint({ directory, lease, checkpoint: next });
        const raced = await readCheckpoint({ directory });
        observed.push(raced === undefined ? "undefined" : key(raced));
        assert.equal(await write, true);
      }
    } finally {
      // A failing assertion must fail the test, not leave the reader loops
      // spinning on a directory the cleanup is about to remove.
      finished = true;
      await Promise.all(readers);
    }

    assert.ok(observed.length > 0);
    assert.equal(observed.includes("undefined"), false);
    assert.deepEqual(
      observed.filter((value) => !allowed.has(value)),
      [],
    );
    assert.deepEqual(
      comparableCheckpoint(await readCheckpoint({ directory })),
      candidates.at(-1),
    );
    await lease.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("publishes a replacement checkpoint atomically instead of overwriting it in place", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "inspector-checkpoint-inode-"),
  );
  try {
    const lease = await acquireLease(directory);
    const checkpointPath = join(directory, "checkpoint.json");
    assert.equal(await writeCheckpoint({ directory, lease, checkpoint }), true);
    const first = await stat(checkpointPath);

    const newer: Checkpoint = {
      ...checkpoint,
      cursors: { pi: sourceCursor(13), wal: { "writer-1": 6 } },
    };
    assert.equal(
      await writeCheckpoint({ directory, lease, checkpoint: newer }),
      true,
    );
    const second = await stat(checkpointPath);

    // An in-place overwrite (truncate then write) keeps the inode and is
    // exactly the mode in which a concurrent reader can observe a truncated
    // file; an atomic rename always binds the separately written file, so the
    // published inode changes. Together with the reader race above this pins
    // "previous or new complete state, never partial".
    assert.notEqual(second.ino, first.ino);
    assert.deepEqual(
      comparableCheckpoint(await readCheckpoint({ directory })),
      newer,
    );
    await lease.release();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("a temp checkpoint left by a crashed publisher is never authoritative", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-checkpoint-tmp-"));
  try {
    const lease = await acquireLease(directory);
    assert.equal(await writeCheckpoint({ directory, lease, checkpoint }), true);

    const leftover = join(directory, `.checkpoint.json.${randomUUID()}.tmp`);
    await writeFile(
      leftover,
      `${JSON.stringify({
        ...checkpoint,
        aggregates: { ...checkpoint.aggregates, totalTokens: 9999 },
      })}\n`,
    );
    assert.deepEqual(
      comparableCheckpoint(await readCheckpoint({ directory })),
      checkpoint,
    );

    // The next publish still reads and replaces the real checkpoint path.
    const newer: Checkpoint = {
      ...checkpoint,
      cursors: { pi: sourceCursor(13), wal: { "writer-1": 6 } },
    };
    assert.equal(
      await writeCheckpoint({ directory, lease, checkpoint: newer }),
      true,
    );
    assert.deepEqual(
      comparableCheckpoint(await readCheckpoint({ directory })),
      newer,
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

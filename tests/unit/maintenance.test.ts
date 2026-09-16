import assert from "node:assert/strict";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { readCheckpoint } from "../../src/storage/checkpoint.ts";
import { maintainSession } from "../../src/storage/maintenance.ts";

const trackingMarkerLine =
  '{"id":"marker","parentId":null,"timestamp":"2026-09-07T12:00:00.000Z","type":"custom","customType":"session-inspector:tracking-start","data":{"schemaVersion":1}}';

type PermissionDecision = "allow" | "deny";

function permissionEnvelope(
  resolution: string,
  result: PermissionDecision,
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    source: "permission-system",
    metric: "permission.decision",
    value: 1,
    kind: "counter",
    dimensions: { result, resolution },
  };
}

async function appendTelemetry(
  path: string,
  writerId: string,
  writerSequence: number,
  eventId: string,
  telemetry: Record<string, unknown>,
): Promise<void> {
  await appendFile(
    path,
    `${JSON.stringify({
      eventId,
      timestamp: "2026-09-07T12:00:01.000Z",
      writerId,
      writerSequence,
      kind: "telemetry",
      telemetry,
    })}\n`,
  );
}

test("folds recovered telemetry into checkpoint aggregates exactly once across repeated passes", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-maintenance-"));
  try {
    const sessionId = "session-1";
    const sessionFile = join(root, "session.jsonl");
    const directory = join(root, "sessions", sessionId);
    const writerId = "writer-a";
    const walSegment = join(directory, "wal", writerId, "2026-09-07.jsonl");
    await mkdir(join(directory, "wal", writerId), { recursive: true });
    await writeFile(sessionFile, `${trackingMarkerLine}\n`);

    // sequence 1 = permission allow, sequence 2 = skill invocation,
    // sequence 3 = permission.ready (presence only).
    await appendTelemetry(
      walSegment,
      writerId,
      1,
      "permission-1",
      permissionEnvelope("user_approved", "allow"),
    );
    await appendTelemetry(walSegment, writerId, 2, "skill-1", {
      schemaVersion: 1,
      source: "pi-input",
      metric: "skill.invocation",
      value: 1,
      kind: "counter",
      dimensions: { skill: "council-mode" },
    });
    await appendTelemetry(walSegment, writerId, 3, "presence-1", {
      schemaVersion: 1,
      source: "permission-system",
      metric: "permission.ready",
      value: 1,
      kind: "counter",
    });

    // Deliberately no pinned clock: the no-new-telemetry passes must be
    // byte-identical because nothing materialized changed, not because time
    // was frozen.
    const maintain = (maintenanceWriterId: string) =>
      maintainSession({
        root,
        sessionId,
        sessionFile,
        writerId: maintenanceWriterId,
      });

    assert.equal((await maintain("m1")).status, "available");
    const afterFirst = await readCheckpoint({ directory });
    assert.deepEqual(afterFirst?.aggregates.integrationCounters?.permission, {
      decisions: 1,
      allowed: 1,
    });
    assert.deepEqual(afterFirst?.aggregates.skillInvocations, {
      "council-mode": 1,
    });
    assert.equal(afterFirst?.aggregates.presence?.permission, true);
    const firstBytes = await readFile(
      join(directory, "checkpoint.json"),
      "utf8",
    );

    // Second and third passes see the same WAL but the cursors already cover
    // it: nothing is re-added and the checkpoint stays byte-identical.
    await maintain("m2");
    await maintain("m3");
    const afterThird = await readCheckpoint({ directory });
    assert.deepEqual(afterThird?.aggregates.integrationCounters?.permission, {
      decisions: 1,
      allowed: 1,
    });
    assert.deepEqual(afterThird?.aggregates.skillInvocations, {
      "council-mode": 1,
    });
    assert.equal(afterThird?.aggregates.skillOverflowInvocations, undefined);
    assert.equal(
      await readFile(join(directory, "checkpoint.json"), "utf8"),
      firstBytes,
    );

    // A genuinely new post-cursor event is folded exactly once.
    await appendTelemetry(
      walSegment,
      writerId,
      4,
      "permission-2",
      permissionEnvelope("user_denied", "deny"),
    );
    await maintain("m4");
    const afterNew = await readCheckpoint({ directory });
    assert.deepEqual(afterNew?.aggregates.integrationCounters?.permission, {
      decisions: 2,
      allowed: 1,
      denied: 1,
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("canonicalizes folded aggregate key order so no-new-telemetry passes stay byte-identical", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-maintenance-"));
  try {
    const sessionId = "session-1";
    const sessionFile = join(root, "session.jsonl");
    const directory = join(root, "sessions", sessionId);
    const writerId = "writer-a";
    const walSegment = join(directory, "wal", writerId, "2026-09-07.jsonl");
    await mkdir(join(directory, "wal", writerId), { recursive: true });
    await writeFile(sessionFile, `${trackingMarkerLine}\n`);

    const maintain = (maintenanceWriterId: string) =>
      maintainSession({
        root,
        sessionId,
        sessionFile,
        writerId: maintenanceWriterId,
        now: () => new Date("2026-09-07T12:00:00.000Z"),
      });

    // Pass 1 folds only the deny decision (`decisions` + `denied`).
    await appendTelemetry(
      walSegment,
      writerId,
      1,
      "permission-1",
      permissionEnvelope("user_denied", "deny"),
    );
    assert.equal((await maintain("m1")).status, "available");
    assert.deepEqual(
      (await readCheckpoint({ directory }))?.aggregates.integrationCounters
        ?.permission,
      { decisions: 1, denied: 1 },
    );

    // Pass 2 folds `allowed`, which sorts BEFORE the already-stored keys. The
    // merge keeps stored keys first, so without write-boundary canonicalization
    // this writes `{decisions, denied, allowed}` and the next no-new-telemetry
    // pass (rebuilding the base in sorted order) would rewrite the bytes.
    await appendTelemetry(
      walSegment,
      writerId,
      2,
      "permission-2",
      permissionEnvelope("user_approved", "allow"),
    );
    assert.equal((await maintain("m2")).status, "available");
    assert.deepEqual(
      (await readCheckpoint({ directory }))?.aggregates.integrationCounters
        ?.permission,
      { decisions: 2, allowed: 1, denied: 1 },
    );
    const secondBytes = await readFile(
      join(directory, "checkpoint.json"),
      "utf8",
    );

    // Two additional passes with no new telemetry must not rewrite the bytes.
    await maintain("m3");
    await maintain("m4");
    assert.deepEqual(
      (await readCheckpoint({ directory }))?.aggregates.integrationCounters
        ?.permission,
      { decisions: 2, allowed: 1, denied: 1 },
    );
    assert.equal(
      await readFile(join(directory, "checkpoint.json"), "utf8"),
      secondBytes,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("invalidates a same-line-count Pi rewrite with a bounded source revision", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-maintenance-"));
  try {
    const sessionId = "session-1";
    const source = join(root, "session.jsonl");
    const directory = join(root, "sessions", sessionId);
    const contents = (tokens: number) =>
      `${[
        '{"id":"marker","parentId":null,"timestamp":"2026-09-07T12:00:00.000Z","type":"custom","customType":"session-inspector:tracking-start","data":{"schemaVersion":1}}',
        `{"id":"assistant","parentId":"marker","timestamp":"2026-09-07T12:00:01.000Z","type":"message","message":{"role":"assistant","provider":"provider","model":"model","usage":{"totalTokens":${tokens},"cost":{"total":0.02}}}}`,
      ].join("\n")}\n`;
    await mkdir(directory, { recursive: true });
    await writeFile(source, contents(9));

    assert.equal(
      (
        await maintainSession({
          root,
          sessionId,
          sessionFile: source,
          writerId: "maintenance-1",
        })
      ).status,
      "available",
    );
    const first = await readCheckpoint({ directory });

    await writeFile(source, contents(8));
    assert.equal(
      (
        await maintainSession({
          root,
          sessionId,
          sessionFile: source,
          writerId: "maintenance-2",
        })
      ).status,
      "available",
    );
    const rewritten = await readCheckpoint({ directory });

    assert.equal(first?.cursors.pi.lineCount, rewritten?.cursors.pi.lineCount);
    assert.notEqual(first?.cursors.pi.revision, rewritten?.cursors.pi.revision);
    assert.equal(rewritten?.cursors.pi.revision.length, 64);
    assert.equal(rewritten?.aggregates.totalTokens, 8);
    assert.equal(
      (await readFile(join(directory, "checkpoint.json"), "utf8")).includes(
        '"totalTokens":8',
      ),
      true,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("requires active tracking marker evidence before sealing or pruning", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-maintenance-"));
  try {
    const sessionId = "session-1";
    const source = join(root, "session.jsonl");
    const directory = join(root, "sessions", sessionId);
    await mkdir(join(directory, "wal", "writer-1"), { recursive: true });
    const expired = join(directory, "wal", "writer-1", "2026-09-01.jsonl");
    await writeFile(
      expired,
      '{"eventId":"start-1","timestamp":"2026-09-01T12:00:00.000Z","kind":"live_timing","timing":{"category":"tool","status":"running","confidence":"live","startedAt":"2026-09-01T12:00:00.000Z"},"writerId":"writer-1","writerSequence":1}\n',
    );
    await writeFile(
      source,
      '{"id":"untracked","parentId":null,"timestamp":"2026-09-01T00:00:00.000Z","type":"custom"}\n',
    );

    assert.equal(
      (
        await maintainSession({
          root,
          sessionId,
          sessionFile: source,
          writerId: "maintenance-1",
        })
      ).status,
      "unavailable",
    );
    await assert.doesNotReject(readFile(expired));
    assert.equal(await readCheckpoint({ directory }), undefined);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("stamps checkpoint materialization and resource observation times without fabricating usage coverage", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-maintenance-"));
  try {
    const sessionId = "session-1";
    const sessionFile = join(root, "session.jsonl");
    const directory = join(root, "sessions", sessionId);
    await mkdir(directory, { recursive: true });
    await writeFile(sessionFile, `${trackingMarkerLine}\n`);

    assert.equal(
      (
        await maintainSession({
          root,
          sessionId,
          sessionFile,
          writerId: "m1",
          inventoryCounts: {
            commands: 3,
            skills: 1,
            resources: 2,
            toolSources: 4,
            observedAt: "2026-09-12T10:00:00.000Z",
          },
          now: () => new Date("2026-09-12T10:00:05.000Z"),
        })
      ).status,
      "available",
    );

    const checkpoint = await readCheckpoint({ directory });
    assert.equal(
      checkpoint?.evidence?.checkpointedAt,
      "2026-09-12T10:00:05.000Z",
    );
    // Coverage is owned by the canonical usage ledger (Task 13), so
    // maintenance must not fabricate a constant all-`complete` claim.
    assert.equal(checkpoint?.evidence?.usageCoverage, undefined);
    assert.deepEqual(checkpoint?.aggregates.resourceCounts, {
      commands: 3,
      skills: 1,
      resources: 2,
      toolSources: 4,
      observedAt: "2026-09-12T10:00:00.000Z",
    });
    // The inventory observation time is never the checkpoint write time.
    assert.notEqual(
      checkpoint?.aggregates.resourceCounts?.observedAt,
      checkpoint?.evidence?.checkpointedAt,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("keeps checkpoint bytes and checkpointedAt stable until materialized content changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-maintenance-"));
  try {
    const sessionId = "session-1";
    const sessionFile = join(root, "session.jsonl");
    const directory = join(root, "sessions", sessionId);
    const writerId = "writer-a";
    const walSegment = join(directory, "wal", writerId, "2026-09-07.jsonl");
    await mkdir(join(directory, "wal", writerId), { recursive: true });
    await writeFile(sessionFile, `${trackingMarkerLine}\n`);
    await appendTelemetry(
      walSegment,
      writerId,
      1,
      "permission-1",
      permissionEnvelope("user_denied", "deny"),
    );

    let clock = new Date("2026-09-07T12:00:00.000Z");
    const maintain = (maintenanceWriterId: string) =>
      maintainSession({
        root,
        sessionId,
        sessionFile,
        writerId: maintenanceWriterId,
        now: () => clock,
      });

    assert.equal((await maintain("m1")).status, "available");
    const firstBytes = await readFile(
      join(directory, "checkpoint.json"),
      "utf8",
    );
    assert.equal(
      (await readCheckpoint({ directory }))?.evidence?.checkpointedAt,
      "2026-09-07T12:00:00.000Z",
    );

    // The clock advanced but nothing else materialized: the file must not be
    // rewritten and `checkpointedAt` must not advance.
    clock = new Date("2026-09-07T12:05:00.000Z");
    assert.equal((await maintain("m2")).status, "available");
    assert.equal(
      await readFile(join(directory, "checkpoint.json"), "utf8"),
      firstBytes,
    );
    assert.equal(
      (await readCheckpoint({ directory }))?.evidence?.checkpointedAt,
      "2026-09-07T12:00:00.000Z",
    );

    // A genuine change advances `checkpointedAt` to the new write time.
    await appendTelemetry(
      walSegment,
      writerId,
      2,
      "permission-2",
      permissionEnvelope("user_approved", "allow"),
    );
    clock = new Date("2026-09-07T12:10:00.000Z");
    assert.equal((await maintain("m3")).status, "available");
    assert.equal(
      (await readCheckpoint({ directory }))?.evidence?.checkpointedAt,
      "2026-09-07T12:10:00.000Z",
    );
    assert.notEqual(
      await readFile(join(directory, "checkpoint.json"), "utf8"),
      firstBytes,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("preserves stored resource counts and observedAt across a caller that omits them", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-maintenance-"));
  try {
    const sessionId = "session-1";
    const sessionFile = join(root, "session.jsonl");
    const directory = join(root, "sessions", sessionId);
    await mkdir(directory, { recursive: true });
    await writeFile(sessionFile, `${trackingMarkerLine}\n`);

    assert.equal(
      (
        await maintainSession({
          root,
          sessionId,
          sessionFile,
          writerId: "m1",
          inventoryCounts: {
            commands: 3,
            skills: 1,
            observedAt: "2026-09-12T10:00:00.000Z",
          },
        })
      ).status,
      "available",
    );
    assert.deepEqual(
      (await readCheckpoint({ directory }))?.aggregates.resourceCounts,
      { commands: 3, skills: 1, observedAt: "2026-09-12T10:00:00.000Z" },
    );

    // A caller that only knows about commands/skills must not erase the
    // previously known observation time or other stored keys.
    assert.equal(
      (
        await maintainSession({
          root,
          sessionId,
          sessionFile,
          writerId: "m2",
          inventoryCounts: { commands: 4, skills: 2 },
        })
      ).status,
      "available",
    );
    assert.deepEqual(
      (await readCheckpoint({ directory }))?.aggregates.resourceCounts,
      { commands: 4, skills: 2, observedAt: "2026-09-12T10:00:00.000Z" },
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("maintenance rereads Pi source and WAL under its lease before publishing a checkpoint", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-maintenance-"));
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

    assert.equal(
      (
        await maintainSession({
          root,
          sessionId,
          sessionFile: source,
          writerId: "maintenance-1",
          now: () => new Date("2026-09-07T12:00:00.000Z"),
        })
      ).status,
      "available",
    );
    const checkpoint = await readCheckpoint({ directory });
    assert.deepEqual(
      checkpoint === undefined
        ? undefined
        : {
            ...checkpoint,
            cursors: {
              ...checkpoint.cursors,
              wal: { ...checkpoint.cursors.wal },
            },
          },
      {
        schemaVersion: 1,
        cursors: {
          pi: {
            lineCount: 2,
            revision:
              "b38618c9a8880ac97b98cc3bc3fd042e88a11c31c5483017bdf579186a620dde",
          },
          wal: { "writer-1": 1 },
        },
        aggregates: {
          totalTokens: 9,
          totalCost: 0.02,
          generations: 1,
          tools: 0,
          compactions: 0,
        },
        evidence: { checkpointedAt: "2026-09-07T12:00:00.000Z" },
      },
    );
    assert.equal(
      (await readFile(join(directory, "checkpoint.json"), "utf8")).includes(
        "provider",
      ),
      false,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("malformed durable WAL is not reported maintained when no validated prefix can progress", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-maintenance-"));
  try {
    const directory = join(root, "sessions", "session-1");
    const source = join(root, "pi.jsonl");
    await mkdir(join(directory, "wal", "writer-1"), { recursive: true });
    await writeFile(
      join(directory, "wal", "writer-1", "2026-01-01.jsonl"),
      "not-json\n",
    );
    await writeFile(
      source,
      '{"id":"marker","parentId":null,"timestamp":"2026-01-01T00:00:00Z","type":"custom","customType":"session-inspector:tracking-start","data":{"schemaVersion":1}}\n',
    );
    assert.equal(
      (
        await maintainSession({
          root,
          sessionId: "session-1",
          sessionFile: source,
          writerId: "maintenance-1",
        })
      ).status,
      "unavailable",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("production session start stamps resource counts with the inventory observation time", async () => {
  const { registerTracking } = await import("../../src/index.ts");
  const directory = await mkdtemp(join(tmpdir(), "inspector-maintenance-"));
  const sessionId = "session-r52";
  const nativeDirectory = join(directory, "native");
  const sessionFile = join(nativeDirectory, "session.jsonl");
  const root = join(directory, "session-inspector", "v1");
  const inspectorDirectory = join(root, "sessions", sessionId);
  try {
    await mkdir(nativeDirectory, { recursive: true });
    await mkdir(inspectorDirectory, { recursive: true });
    await writeFile(sessionFile, `${trackingMarkerLine}\n`);

    let handler:
      | ((event: unknown, context: unknown) => Promise<void>)
      | undefined;
    registerTracking(
      {
        on: (
          event: string,
          registered: (event: unknown, context: unknown) => Promise<void>,
        ) => {
          // Pi registers several lifecycle handlers, so the stub keys by event.
          if (event === "session_start") handler = registered;
        },
        appendEntry: () => {},
        getCommands: () => [
          {
            name: "ponytail",
            source: "extension",
            sourceInfo: {
              source: "local",
              scope: "user",
              origin: "top-level",
            },
          },
        ],
        getAllTools: () => [],
      } as unknown as Parameters<typeof registerTracking>[0],
      {
        agentDir: directory,
        track: async () => true,
        setupSessionWal: async () => {},
      },
    );
    assert.ok(handler);
    const startedAt = Date.now();
    await handler(
      {},
      {
        sessionManager: {
          getSessionId: () => sessionId,
          getSessionFile: () => sessionFile,
          getSessionDir: () => nativeDirectory,
        },
      },
    );

    // Production scheduling is detached; poll for the persisted observation
    // and the checkpoint write it feeds.
    const snapshotPath = join(inspectorDirectory, "inventory.json");
    let snapshot: { observedAt?: unknown } | undefined;
    let checkpoint = await readCheckpoint({ directory: inspectorDirectory });
    for (let attempt = 0; attempt < 200; attempt++) {
      try {
        snapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as {
          observedAt?: unknown;
        };
      } catch {
        snapshot = undefined;
      }
      checkpoint = await readCheckpoint({ directory: inspectorDirectory });
      if (
        typeof snapshot?.observedAt === "string" &&
        typeof checkpoint?.aggregates.resourceCounts?.observedAt === "string"
      )
        break;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(snapshot, "the session-start capture must persist its snapshot");
    assert.ok(checkpoint, "production maintenance must publish a checkpoint");
    const observedAt = checkpoint.aggregates.resourceCounts?.observedAt;
    // R52: the checkpoint carries the snapshot's own observation instant, not
    // the later maintenance/checkpoint write clock and never mtime.
    assert.equal(observedAt, snapshot.observedAt);
    const at = Date.parse(observedAt as string);
    assert.equal(Number.isNaN(at), false);
    assert.ok(at >= startedAt && at <= Date.now());
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

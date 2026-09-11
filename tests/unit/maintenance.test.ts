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

    const maintain = (maintenanceWriterId: string) =>
      maintainSession({
        root,
        sessionId,
        sessionFile,
        writerId: maintenanceWriterId,
        now: () => new Date("2026-09-07T12:00:00.000Z"),
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

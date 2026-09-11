import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { readCheckpoint } from "../../src/storage/checkpoint.ts";
import { maintainSession } from "../../src/storage/maintenance.ts";

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
      await maintainSession({
        root,
        sessionId,
        sessionFile: source,
        writerId: "maintenance-1",
      }),
      "available",
    );
    const first = await readCheckpoint({ directory });

    await writeFile(source, contents(8));
    assert.equal(
      await maintainSession({
        root,
        sessionId,
        sessionFile: source,
        writerId: "maintenance-2",
      }),
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
      await maintainSession({
        root,
        sessionId,
        sessionFile: source,
        writerId: "maintenance-1",
      }),
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
      await maintainSession({
        root,
        sessionId,
        sessionFile: source,
        writerId: "maintenance-1",
      }),
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
      await maintainSession({
        root,
        sessionId: "session-1",
        sessionFile: source,
        writerId: "maintenance-1",
      }),
      "unavailable",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

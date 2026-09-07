import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

type CreateWriter = (options: {
  root: string;
  writerId: string;
  now: () => Date;
}) => Promise<{
  append(event: { eventId: string; timestamp: string; kind: string }): void;
  flush(): Promise<void>;
}>;

async function loadWriter(): Promise<CreateWriter | undefined> {
  try {
    return (
      await import(new URL("../../src/storage/wal.ts", import.meta.url).href)
    ).createWalWriter;
  } catch {
    return undefined;
  }
}

test("rejects a second writer claim for the same writer ID", async () => {
  const createWalWriter = await loadWriter();
  assert.ok(createWalWriter);

  const root = await mkdtemp(join(tmpdir(), "inspector-wal-"));
  try {
    await createWalWriter({
      root,
      writerId: "writer-1",
      now: () => new Date("2026-09-07T12:00:00.000Z"),
    });

    await assert.rejects(
      createWalWriter({
        root,
        writerId: "writer-1",
        now: () => new Date("2026-09-07T12:00:00.000Z"),
      }),
      { code: "EEXIST" },
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("disables future writes after a flush failure", async () => {
  const createWalWriter = await loadWriter();
  assert.ok(createWalWriter);

  const root = await mkdtemp(join(tmpdir(), "inspector-wal-"));
  const shard = join(root, "wal", "writer-1");
  const segment = join(shard, "2026-09-07.jsonl");
  try {
    const writer = await createWalWriter({
      root,
      writerId: "writer-1",
      now: () => new Date("2026-09-07T12:00:00.000Z"),
    });
    await rm(shard, { force: true, recursive: true });
    await writeFile(shard, "not a directory");

    writer.append({
      eventId: "event-1",
      timestamp: "2026-09-07T12:00:00.000Z",
      kind: "tool-start",
    });
    await writer.flush();

    await rm(shard, { force: true });
    await mkdir(shard);
    writer.append({
      eventId: "event-2",
      timestamp: "2026-09-07T12:00:01.000Z",
      kind: "tool-end",
    });
    await writer.flush();

    await assert.rejects(readFile(segment, "utf8"), { code: "ENOENT" });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("drops non-string event fields before WAL persistence", async () => {
  const createWalWriter = await loadWriter();
  assert.ok(createWalWriter);

  const root = await mkdtemp(join(tmpdir(), "inspector-wal-"));
  try {
    const writer = await createWalWriter({
      root,
      writerId: "writer-1",
      now: () => new Date("2026-09-07T12:00:00.000Z"),
    });
    writer.append({
      eventId: {
        length: 2,
        secret: "prompt-content",
        toString: () => "event-1",
      },
      timestamp: "2026-09-07T12:00:00.000Z",
      kind: "tool-start",
    } as unknown as { eventId: string; timestamp: string; kind: string });
    await writer.flush();

    await assert.rejects(
      readFile(join(root, "wal", "writer-1", "2026-09-07.jsonl"), "utf8"),
      { code: "ENOENT" },
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("drains events appended during an in-flight flush", async () => {
  const createWalWriter = await loadWriter();
  assert.ok(createWalWriter);

  const root = await mkdtemp(join(tmpdir(), "inspector-wal-"));
  try {
    const writer = await createWalWriter({
      root,
      writerId: "writer-1",
      now: () => new Date("2026-09-07T12:00:00.000Z"),
    });
    writer.append({
      eventId: "event-1",
      timestamp: "2026-09-07T12:00:00.000Z",
      kind: "tool-start",
    });
    const firstFlush = writer.flush();
    writer.append({
      eventId: "event-2",
      timestamp: "2026-09-07T12:00:01.000Z",
      kind: "tool-end",
    });
    await Promise.all([firstFlush, writer.flush()]);

    assert.match(
      await readFile(join(root, "wal", "writer-1", "2026-09-07.jsonl"), "utf8"),
      /"eventId":"event-2"/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("writes an ordered dated writer shard on flush", async () => {
  const createWalWriter = await loadWriter();
  assert.ok(createWalWriter);

  const root = await mkdtemp(join(tmpdir(), "inspector-wal-"));
  try {
    const writer = await createWalWriter({
      root,
      writerId: "writer-1",
      now: () => new Date("2026-09-07T12:00:00.000Z"),
    });
    writer.append({
      eventId: "event-1",
      timestamp: "2026-09-07T12:00:00.000Z",
      kind: "tool-start",
    });
    writer.append({
      eventId: "event-2",
      timestamp: "2026-09-07T12:00:01.000Z",
      kind: "tool-end",
    });
    await writer.flush();

    assert.equal(
      await readFile(join(root, "wal", "writer-1", "2026-09-07.jsonl"), "utf8"),
      '{"eventId":"event-1","timestamp":"2026-09-07T12:00:00.000Z","kind":"tool-start","writerId":"writer-1","writerSequence":1}\n' +
        '{"eventId":"event-2","timestamp":"2026-09-07T12:00:01.000Z","kind":"tool-end","writerId":"writer-1","writerSequence":2}\n',
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

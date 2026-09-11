import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
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
import { promisify } from "node:util";

import { recoverSession } from "../../src/storage/recovery.ts";

const execFile = promisify(execFileCallback);

type CreateWriter = (options: {
  root: string;
  writerId?: string;
  now: () => Date;
  write?: (path: string, data: string) => Promise<void>;
}) => Promise<{
  append(event: {
    eventId: string;
    timestamp: string;
    kind: string;
    timing?: {
      category: "agent" | "turn" | "tool" | "provider" | "model";
      status: "running" | "unknown" | "unsupported";
      confidence: "live" | "unsupported";
      startedAt?: string;
      endedAt?: string;
      durationMs?: number;
    };
  }): void;
  appendTelemetry(envelope: unknown): void;
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

test("generates an immutable UUID writer shard when no ID is supplied", async () => {
  const createWalWriter = await loadWriter();
  assert.ok(createWalWriter);

  const root = await mkdtemp(join(tmpdir(), "inspector-wal-"));
  try {
    await createWalWriter({
      root,
      now: () => new Date("2026-09-07T12:00:00.000Z"),
    });

    assert.match(
      (await readdir(join(root, "wal")))[0] ?? "",
      /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("accepts __proto__ as a path-safe WAL writer ID", async () => {
  const createWalWriter = await loadWriter();
  assert.ok(createWalWriter);

  const root = await mkdtemp(join(tmpdir(), "inspector-wal-"));
  try {
    const writer = await createWalWriter({
      root,
      writerId: "__proto__",
      now: () => new Date("2026-09-07T12:00:00.000Z"),
    });
    writer.append({
      eventId: "event-1",
      timestamp: "2026-09-07T12:00:00.000Z",
      kind: "tool-end",
    });
    await writer.flush();

    assert.match(
      await readFile(
        join(root, "wal", "__proto__", "2026-09-07.jsonl"),
        "utf8",
      ),
      /"writerId":"__proto__"/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

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

test("snapshots hostile producer fields before validation and persistence", async () => {
  const createWalWriter = await loadWriter();
  assert.ok(createWalWriter);

  const root = await mkdtemp(join(tmpdir(), "inspector-wal-"));
  try {
    const writer = await createWalWriter({
      root,
      writerId: "writer-1",
      now: () => new Date("2026-09-07T12:00:00.000Z"),
    });
    let reads = 0;
    const event = {
      get eventId() {
        reads += 1;
        return reads === 1 ? "event-1" : "secret-after-validation";
      },
      kind: "tool-end",
      timestamp: "2026-09-07T12:00:00.000Z",
    };

    assert.doesNotThrow(() => writer.append(event));
    await writer.flush();

    const contents = await readFile(
      join(root, "wal", "writer-1", "2026-09-07.jsonl"),
      "utf8",
    );
    assert.match(contents, /"eventId":"event-1"/);
    assert.equal(contents.includes("secret-after-validation"), false);
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

test("flushes records appended at the end of an in-flight flush", async () => {
  const createWalWriter = await loadWriter();
  assert.ok(createWalWriter);

  const root = await mkdtemp(join(tmpdir(), "inspector-wal-"));
  try {
    let releaseFirstWrite: (() => void) | undefined;
    const firstWriteReleased = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    const writes: string[] = [];
    const writer = await createWalWriter({
      root,
      writerId: "writer-1",
      now: () => new Date("2026-09-07T12:00:00.000Z"),
      write: (_path, data) => {
        writes.push(data);
        return writes.length === 1 ? firstWriteReleased : Promise.resolve();
      },
    });
    writer.append({
      eventId: "event-1",
      timestamp: "2026-09-07T12:00:00.000Z",
      kind: "tool-start",
    });
    const firstFlush = writer.flush();
    releaseFirstWrite?.();
    queueMicrotask(() => {
      writer.append({
        eventId: "event-2",
        timestamp: "2026-09-07T12:00:01.000Z",
        kind: "tool-end",
      });
    });
    await firstFlush;

    assert.equal(writes.length, 2);
    assert.match(writes[1] ?? "", /"eventId":"event-2"/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("flushes after 200 ms without keeping the process alive", async () => {
  const createWalWriter = await loadWriter();
  assert.ok(createWalWriter);

  const root = await mkdtemp(join(tmpdir(), "inspector-wal-"));
  const segment = join(root, "wal", "writer-1", "2026-09-07.jsonl");
  try {
    const writer = await createWalWriter({
      root,
      writerId: "writer-1",
      now: () => new Date("2026-09-07T12:00:00.000Z"),
    });
    writer.append({
      eventId: "event-1",
      timestamp: "2026-09-07T12:00:00.000Z",
      kind: "tool-end",
    });

    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.match(await readFile(segment, "utf8"), /"eventId":"event-1"/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("flushes asynchronously after 64 queued records", async () => {
  const createWalWriter = await loadWriter();
  assert.ok(createWalWriter);

  const root = await mkdtemp(join(tmpdir(), "inspector-wal-"));
  try {
    let writes = 0;
    const writer = await createWalWriter({
      root,
      writerId: "writer-1",
      now: () => new Date("2026-09-07T12:00:00.000Z"),
      write: async () => {
        writes += 1;
      },
    });
    for (let index = 0; index < 64; index += 1) {
      writer.append({
        eventId: `event-${index}`,
        timestamp: "2026-09-07T12:00:00.000Z",
        kind: "tool-end",
      });
    }

    await Promise.resolve();
    assert.equal(writes, 1);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("flushes asynchronously when pending WAL bytes reach 256 KiB", async () => {
  const createWalWriter = await loadWriter();
  assert.ok(createWalWriter);

  const root = await mkdtemp(join(tmpdir(), "inspector-wal-"));
  try {
    let writes = 0;
    const writer = await createWalWriter({
      root,
      writerId: "writer-1",
      now: () => new Date("2026-09-07T12:00:00.000Z"),
      write: async () => {
        writes += 1;
      },
    });
    const dimensions = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [
        `dimension-${String(index).padStart(2, "0")}-${"k".repeat(35)}`,
        "d".repeat(128),
      ]),
    );
    const attribution = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [
        `attribution-${String(index).padStart(2, "0")}-${"k".repeat(33)}`,
        "a".repeat(128),
      ]),
    );

    let appended = 0;
    for (let index = 0; index < 64; index += 1) {
      writer.appendTelemetry({
        schemaVersion: 1,
        source: "source",
        metric: "metric",
        value: index,
        kind: "counter",
        dimensions,
        attribution,
      });
      appended += 1;
      await Promise.resolve();
      if (writes > 0) break;
    }

    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.ok(appended < 64);
    assert.equal(writes, 1);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("disables and sheds pending records after the 1 MiB queue cap", async () => {
  const createWalWriter = await loadWriter();
  assert.ok(createWalWriter);

  const root = await mkdtemp(join(tmpdir(), "inspector-wal-"));
  const segment = join(root, "wal", "writer-1", "2026-09-07.jsonl");
  try {
    const writer = await createWalWriter({
      root,
      writerId: "writer-1",
      now: () => new Date("2026-09-07T12:00:00.000Z"),
    });
    for (let index = 0; index < 4_300; index += 1) {
      writer.append({
        eventId: `event-${index}`,
        timestamp: "2026-09-07T12:00:00.000Z",
        kind: "x".repeat(128),
      });
    }

    await writer.flush();
    writer.append({
      eventId: "after-cap",
      timestamp: "2026-09-07T12:00:00.000Z",
      kind: "tool-end",
    });
    await writer.flush();

    await assert.rejects(readFile(segment, "utf8"), { code: "ENOENT" });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("partitions delayed flush records by their immutable creation UTC date", async () => {
  const createWalWriter = await loadWriter();
  assert.ok(createWalWriter);

  const root = await mkdtemp(join(tmpdir(), "inspector-wal-"));
  const current = new Date("2026-09-08T00:00:01.000Z");
  try {
    const writer = await createWalWriter({
      root,
      writerId: "writer-1",
      now: () => current,
    });
    writer.append({
      eventId: "event-1",
      timestamp: "2026-09-07T23:59:59.000Z",
      kind: "tool-end",
    });
    await writer.flush();

    assert.match(
      await readFile(join(root, "wal", "writer-1", "2026-09-07.jsonl"), "utf8"),
      /"eventId":"event-1"/,
    );
    await assert.rejects(
      readFile(join(root, "wal", "writer-1", "2026-09-08.jsonl"), "utf8"),
      { code: "ENOENT" },
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("splits a day into bounded fragments before a WAL segment exceeds 16 MiB", async () => {
  const createWalWriter = await loadWriter();
  assert.ok(createWalWriter);

  const root = await mkdtemp(join(tmpdir(), "inspector-wal-"));
  try {
    const writer = await createWalWriter({
      root,
      writerId: "writer-1",
      now: () => new Date("2026-09-07T12:00:00.000Z"),
    });
    const dimensions = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [
        `dimension-${String(index).padStart(2, "0")}-${"k".repeat(35)}`,
        "d".repeat(128),
      ]),
    );
    const attribution = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [
        `attribution-${String(index).padStart(2, "0")}-${"k".repeat(33)}`,
        "a".repeat(128),
      ]),
    );
    for (let batch = 0; batch < 80; batch += 1) {
      for (let index = 0; index < 64; index += 1) {
        writer.appendTelemetry({
          schemaVersion: 1,
          source: "source",
          metric: "metric",
          value: index,
          kind: "counter",
          dimensions,
          attribution,
        });
      }
      await writer.flush();
    }

    assert.equal(
      (await readdir(join(root, "wal", "writer-1"))).filter((name) =>
        name.endsWith(".jsonl"),
      ).length > 1,
      true,
    );
    const recovered = await recoverSession({
      directory: root,
      piCursor: { lineCount: 0, revision: "0".repeat(64) },
    });
    assert.equal(recovered.availability, "available");
    assert.deepEqual(recovered.cursors.wal, { "writer-1": 5_120 });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("rotates an active writer into immutable daily segments", async () => {
  const createWalWriter = await loadWriter();
  assert.ok(createWalWriter);

  const root = await mkdtemp(join(tmpdir(), "inspector-wal-"));
  let current = new Date("2026-09-07T23:59:59.000Z");
  try {
    const writer = await createWalWriter({
      root,
      writerId: "writer-1",
      now: () => current,
    });
    writer.append({
      eventId: "event-1",
      timestamp: current.toISOString(),
      kind: "tool-start",
    });
    await writer.flush();

    current = new Date("2026-09-08T00:00:00.000Z");
    writer.append({
      eventId: "event-2",
      timestamp: current.toISOString(),
      kind: "tool-end",
    });
    await writer.flush();

    assert.deepEqual(await readdir(join(root, "wal", "writer-1")), [
      ".owner",
      "2026-09-07.jsonl",
      "2026-09-07.jsonl.closed",
      "2026-09-08.jsonl",
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test(
  "closes the active segment when the UTC date advances with no pending events",
  {
    timeout: 5000,
  },
  async () => {
    const createWalWriter = await loadWriter();
    assert.ok(createWalWriter);

    const root = await mkdtemp(join(tmpdir(), "inspector-wal-"));
    let current = new Date("2026-09-07T23:59:59.800Z");
    try {
      const writer = await createWalWriter({
        root,
        writerId: "writer-1",
        now: () => current,
      });
      writer.append({
        eventId: "event-1",
        timestamp: current.toISOString(),
        kind: "tool-start",
      });
      await writer.flush();

      current = new Date("2026-09-08T00:00:00.000Z");
      await new Promise((resolve) => setTimeout(resolve, 350));

      assert.deepEqual(await readdir(join(root, "wal", "writer-1")), [
        ".owner",
        "2026-09-07.jsonl",
        "2026-09-07.jsonl.closed",
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  },
);

test("does not keep the process alive while waiting for the next UTC day", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-wal-child-"));
  const walModule = new URL("../../src/storage/wal.ts", import.meta.url).href;
  const script = `
    import { createWalWriter } from ${JSON.stringify(walModule)};
    const writer = await createWalWriter({
      root: process.argv[1],
      writerId: "writer-1",
      now: () => new Date("2026-09-08T00:00:00.000Z"),
    });
    writer.append({
      eventId: "event-1",
      timestamp: "2026-09-08T00:00:00.000Z",
      kind: "tool-start",
    });
    await writer.flush();
    process.stdout.write("ready");
  `;
  try {
    const { stdout } = await execFile(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", script, root],
      { timeout: 3000 },
    );
    assert.equal(stdout, "ready");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("preserves writer recovery through clock rollback with dated segments", async () => {
  const createWalWriter = await loadWriter();
  assert.ok(createWalWriter);

  const root = await mkdtemp(join(tmpdir(), "inspector-wal-"));
  const directory = root;
  let current = new Date("2026-09-08T12:00:00.000Z");
  try {
    const writer = await createWalWriter({
      root,
      writerId: "writer-1",
      now: () => current,
    });
    writer.append({
      eventId: "event-1",
      timestamp: "2026-09-08T12:00:00.000Z",
      kind: "live_timing",
      timing: {
        category: "tool",
        status: "running",
        confidence: "live",
        startedAt: "2026-09-08T12:00:00.000Z",
      },
    });
    await writer.flush();

    current = new Date("2026-09-07T12:00:00.000Z");
    writer.append({
      eventId: "event-2",
      timestamp: "2026-09-07T12:00:00.000Z",
      kind: "live_timing",
      timing: {
        category: "tool",
        status: "running",
        confidence: "live",
        startedAt: "2026-09-07T12:00:00.000Z",
      },
    });
    await writer.flush();

    assert.deepEqual(await readdir(join(root, "wal", "writer-1")), [
      ".owner",
      "2026-09-07.jsonl",
      "2026-09-08.jsonl",
      "2026-09-08.jsonl.closed",
    ]);
    const recovered = await recoverSession({
      directory,
      piCursor: { lineCount: 0, revision: "0".repeat(64) },
    });
    assert.equal(recovered.availability, "available");
    assert.deepEqual(recovered.cursors.wal, { "writer-1": 2 });
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

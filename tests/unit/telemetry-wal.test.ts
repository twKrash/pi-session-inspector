import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

type CreateWriter = (options: {
  root: string;
  writerId: string;
  now: () => Date;
}) => Promise<{
  appendTelemetry(envelope: unknown): void;
  flush(): Promise<void>;
}>;

type Consume = (
  input: unknown,
  sink: { appendTelemetry(envelope: unknown): void },
) => void;

async function load(): Promise<{
  createWalWriter?: CreateWriter;
  consumeTelemetry?: Consume;
}> {
  try {
    const [wal, telemetry] = await Promise.all([
      import(new URL("../../src/storage/wal.ts", import.meta.url).href),
      import(new URL("../../src/pi/telemetry.ts", import.meta.url).href),
    ]);
    return {
      createWalWriter: wal.createWalWriter,
      consumeTelemetry: telemetry.consumeTelemetry,
    };
  } catch {
    return {};
  }
}

test("drops malformed direct telemetry without normalizing it", async () => {
  const { createWalWriter } = await load();
  assert.ok(createWalWriter);

  const root = await mkdtemp(join(tmpdir(), "inspector-wal-"));
  const segment = join(root, "wal", "writer-1", "2026-09-07.jsonl");
  try {
    const writer = await createWalWriter({
      root,
      writerId: "writer-1",
      now: () => new Date("2026-09-07T12:00:00.000Z"),
    });
    writer.appendTelemetry({
      schemaVersion: 1,
      source: "ctx",
      metric: "mode",
      value: "full",
      kind: "gauge",
      dimensions: [],
    });
    await writer.flush();

    await assert.rejects(readFile(segment, "utf8"), { code: "ENOENT" });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("persists only consumer-sanitized telemetry in a WAL record", async () => {
  const { createWalWriter, consumeTelemetry } = await load();
  assert.ok(createWalWriter);
  assert.ok(consumeTelemetry);

  const root = await mkdtemp(join(tmpdir(), "inspector-wal-"));
  try {
    const writer = await createWalWriter({
      root,
      writerId: "writer-1",
      now: () => new Date("2026-09-07T12:00:00.000Z"),
    });
    consumeTelemetry(
      {
        schemaVersion: 1,
        source: "ctx",
        metric: "mode",
        value: "Bearer secret-value",
        kind: "gauge",
      },
      writer,
    );
    await writer.flush();

    const contents = await readFile(
      join(root, "wal", "writer-1", "2026-09-07.jsonl"),
      "utf8",
    );
    assert.match(contents, /"kind":"telemetry"/);
    assert.match(contents, /"metric":"mode"/);
    assert.equal(contents.includes("secret-value"), false);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

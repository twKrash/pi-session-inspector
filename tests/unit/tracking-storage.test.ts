import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

type CreateStorage = (options: {
  root: string;
  sessionId: string;
  appendEntry(type: string, data: unknown): void;
}) => {
  writePending(sessionId: string): Promise<void>;
  appendMarker(): void;
  promote(sessionId: string): Promise<void>;
};

async function loadStorage(): Promise<CreateStorage | undefined> {
  try {
    return (
      await import(
        new URL("../../src/storage/tracking.ts", import.meta.url).href
      )
    ).createTrackingStorage;
  } catch {
    return undefined;
  }
}

test("persists pending metadata, appends one namespaced marker, then atomically promotes", async () => {
  const createTrackingStorage = await loadStorage();
  assert.ok(createTrackingStorage);

  const root = await mkdtemp(join(tmpdir(), "inspector-tracking-"));
  try {
    const calls: string[] = [];
    const storage = createTrackingStorage({
      root,
      sessionId: "session-1",
      appendEntry: (type, data) =>
        calls.push(`${type}:${JSON.stringify(data)}`),
    });

    await storage.writePending("session-1");
    storage.appendMarker();
    await storage.promote("session-1");

    assert.deepEqual(calls, [
      'session-inspector:tracking-start:{"schemaVersion":1}',
    ]);
    assert.equal(
      await readFile(join(root, "sessions", "session-1", "meta.json"), "utf8"),
      '{"schemaVersion":1,"sessionId":"session-1","state":"tracking"}\n',
    );
    await assert.rejects(
      readFile(
        join(root, "sessions", "session-1", "meta.json.pending"),
        "utf8",
      ),
      { code: "ENOENT" },
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("rejects path-unsafe or mismatched session IDs before storage access", async () => {
  const createTrackingStorage = await loadStorage();
  assert.ok(createTrackingStorage);

  assert.throws(
    () =>
      createTrackingStorage({
        root: tmpdir(),
        sessionId: "../outside",
        appendEntry: () => undefined,
      }),
    /path-safe ASCII token/,
  );

  const root = await mkdtemp(join(tmpdir(), "inspector-tracking-"));
  try {
    const storage = createTrackingStorage({
      root,
      sessionId: "session-1",
      appendEntry: () => undefined,
    });

    await assert.rejects(
      storage.writePending("../outside"),
      /path-safe ASCII token/,
    );
    await assert.rejects(
      storage.writePending("session-2"),
      /does not match this tracking storage/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

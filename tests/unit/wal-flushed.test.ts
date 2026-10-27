import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createWalWriter } from "../../src/storage/wal.ts";

const now = () => new Date("2026-09-07T12:00:00.000Z");
const event = {
  eventId: "event-1",
  timestamp: now().toISOString(),
  kind: "tool-end",
};

test("calls observer once after a successful persisted flush", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-wal-flushed-"));
  const calls: string[] = [];
  try {
    const writer = await createWalWriter({
      root,
      writerId: "writer-1",
      now,
      write: async (_path, data) => {
        calls.push(`write:${data.length}`);
      },
      onFlushed: () => {
        calls.push("notified");
      },
    });
    writer.append(event);
    await writer.flush();
    assert.equal(calls.length, 2);
    assert.ok(calls[0]?.startsWith("write:"));
    assert.equal(calls[1], "notified");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not call observer after a failed write", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-wal-flushed-"));
  let notified = false;
  try {
    const writer = await createWalWriter({
      root,
      writerId: "writer-1",
      now,
      write: async () => {
        throw new Error("failed");
      },
      onFlushed: () => {
        notified = true;
      },
    });
    writer.append(event);
    await writer.flush();
    assert.equal(notified, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("observer throw does not fail a successful writer flush", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-wal-flushed-"));
  try {
    const writer = await createWalWriter({
      root,
      writerId: "writer-1",
      now,
      onFlushed: () => {
        throw new Error("observer");
      },
    });
    writer.append(event);
    await assert.doesNotReject(writer.flush());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

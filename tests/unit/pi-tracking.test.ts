import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

type TrackPiSession = (options: {
  root: string;
  sessionId: string;
  appendEntry(type: string, data: unknown): void;
}) => Promise<boolean>;

async function loadTrackPiSession(): Promise<TrackPiSession | undefined> {
  try {
    return (
      await import(new URL("../../src/pi/tracking-pi.ts", import.meta.url).href)
    ).trackPiSession;
  } catch {
    return undefined;
  }
}

test("returns false rather than throwing for invalid tracking input", async () => {
  const trackPiSession = await loadTrackPiSession();
  assert.ok(trackPiSession);

  await assert.doesNotReject(async () => {
    assert.equal(
      await trackPiSession({
        root: tmpdir(),
        sessionId: "../outside",
        appendEntry: () => undefined,
      }),
      false,
    );
  });
});

test("composes Inspector metadata with Pi's sole tracking marker write", async () => {
  const trackPiSession = await loadTrackPiSession();
  assert.ok(trackPiSession);

  const root = await mkdtemp(join(tmpdir(), "inspector-pi-tracking-"));
  try {
    const calls: string[] = [];
    assert.equal(
      await trackPiSession({
        root,
        sessionId: "session-1",
        appendEntry: (type, data) =>
          calls.push(`${type}:${JSON.stringify(data)}`),
      }),
      true,
    );
    assert.deepEqual(calls, [
      'session-inspector:tracking-start:{"schemaVersion":1}',
    ]);
    assert.equal(
      await readFile(join(root, "sessions", "session-1", "meta.json"), "utf8"),
      '{"schemaVersion":1,"sessionId":"session-1","state":"tracking"}\n',
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

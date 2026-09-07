import assert from "node:assert/strict";
import { test } from "node:test";

type StartTracking = (
  storage: {
    writePending(sessionId: string): Promise<void>;
    appendMarker(): void;
    promote(sessionId: string): Promise<void>;
  },
  sessionId: string,
) => Promise<boolean>;

async function loadStartTracking(): Promise<StartTracking | undefined> {
  try {
    return (
      await import(new URL("../../src/pi/tracking.ts", import.meta.url).href)
    ).startTracking;
  } catch {
    return undefined;
  }
}

test("creates pending metadata before its namespaced Pi marker and promotion", async () => {
  const startTracking = await loadStartTracking();
  assert.ok(startTracking);

  const calls: string[] = [];
  const started = await startTracking(
    {
      writePending: async (sessionId) => {
        calls.push(`pending:${sessionId}`);
      },
      appendMarker: () => calls.push("marker"),
      promote: async (sessionId) => {
        calls.push(`promote:${sessionId}`);
      },
    },
    "session-1",
  );

  assert.equal(started, true);
  assert.deepEqual(calls, ["pending:session-1", "marker", "promote:session-1"]);
});

test("swallows transaction failures without attempting later tracking steps", async () => {
  const startTracking = await loadStartTracking();
  assert.ok(startTracking);

  const calls: string[] = [];
  const started = await startTracking(
    {
      writePending: async () => {
        calls.push("pending");
        throw new Error("disk unavailable");
      },
      appendMarker: () => calls.push("marker"),
      promote: async () => {
        calls.push("promote");
      },
    },
    "session-1",
  );

  assert.equal(started, false);
  assert.deepEqual(calls, ["pending"]);
});

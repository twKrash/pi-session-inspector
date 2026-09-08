import assert from "node:assert/strict";
import { test } from "node:test";

type Register = (
  api: { on(event: string, handler: () => Promise<void>): void },
  writer: {
    append(event: {
      eventId: string;
      timestamp: string;
      kind: string;
    }): void | Promise<void>;
    flush(): Promise<void>;
  },
  options: { now(): Date; randomId(): string },
) => void;

async function loadRegister(): Promise<Register | undefined> {
  try {
    return (
      await import(new URL("../../src/pi/live-wal.ts", import.meta.url).href)
    ).registerLiveWal;
  } catch {
    return undefined;
  }
}

test("records payload-free lifecycle kinds and flushes at shutdown", async () => {
  const registerLiveWal = await loadRegister();
  assert.ok(registerLiveWal);

  const handlers = new Map<string, () => Promise<void>>();
  const events: unknown[] = [];
  let flushes = 0;
  registerLiveWal(
    { on: (event, handler) => handlers.set(event, handler) },
    {
      append: (event) => {
        events.push(event);
      },
      flush: async () => {
        flushes += 1;
      },
    },
    {
      now: () => new Date("2026-09-07T12:00:00.000Z"),
      randomId: () => "event-1",
    },
  );

  await handlers.get("tool_execution_start")?.();
  await handlers.get("session_shutdown")?.();

  assert.deepEqual(events, [
    {
      eventId: "event-1",
      timestamp: "2026-09-07T12:00:00.000Z",
      kind: "tool_execution_start",
    },
    {
      eventId: "event-1",
      timestamp: "2026-09-07T12:00:00.000Z",
      kind: "session_shutdown",
    },
  ]);
  assert.equal(flushes, 1);
});

test("returns before a never-settling append promise", async () => {
  const registerLiveWal = await loadRegister();
  assert.ok(registerLiveWal);

  const handlers = new Map<string, () => Promise<void>>();
  let appendStarted: (() => void) | undefined;
  let hookReturned = false;
  let appendBeforeHookReturned = false;
  const appended = new Promise<void>((resolve) => {
    appendStarted = resolve;
  });
  registerLiveWal(
    { on: (event, handler) => handlers.set(event, handler) },
    {
      append: () => {
        appendBeforeHookReturned = !hookReturned;
        appendStarted?.();
        return new Promise(() => {});
      },
      flush: async () => {},
    },
    {
      now: () => new Date("2026-09-07T12:00:00.000Z"),
      randomId: () => "event-1",
    },
  );

  const toolStart = handlers.get("tool_execution_start");
  assert.ok(toolStart);
  const hook = toolStart();
  hookReturned = true;
  await assert.doesNotReject(hook);
  await appended;
  assert.equal(appendBeforeHookReturned, false);
});

test("catches a rejected append promise", async () => {
  const registerLiveWal = await loadRegister();
  assert.ok(registerLiveWal);

  const handlers = new Map<string, () => Promise<void>>();
  const unhandled: unknown[] = [];
  const onUnhandledRejection = (reason: unknown): void => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", onUnhandledRejection);
  try {
    registerLiveWal(
      { on: (event, handler) => handlers.set(event, handler) },
      {
        append: () => Promise.reject(new Error("storage unavailable")),
        flush: async () => {},
      },
      {
        now: () => new Date("2026-09-07T12:00:00.000Z"),
        randomId: () => "event-1",
      },
    );

    const toolStart = handlers.get("tool_execution_start");
    assert.ok(toolStart);
    await assert.doesNotReject(toolStart());
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandledRejection);
  }
});

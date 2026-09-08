import assert from "node:assert/strict";
import { test } from "node:test";

type Register = (
  api: { on(event: string, handler: () => Promise<void>): void },
  writer: {
    append(event: {
      eventId: string;
      timestamp: string;
      kind: "live_timing";
      timing: {
        category: "agent" | "turn" | "tool" | "provider" | "model";
        status: "running" | "unknown" | "unsupported";
        confidence: "live" | "unsupported";
        startedAt?: string;
        endedAt?: string;
        durationMs?: number;
      };
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

test("records FIFO payload-free timing boundaries and flushes at shutdown", async () => {
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
  await handlers.get("tool_execution_start")?.();
  await handlers.get("tool_execution_end")?.();
  await handlers.get("session_shutdown")?.();

  assert.deepEqual(events, [
    {
      eventId: "event-1",
      timestamp: "2026-09-07T12:00:00.000Z",
      kind: "live_timing",
      timing: {
        category: "provider",
        status: "unsupported",
        confidence: "unsupported",
      },
    },
    {
      eventId: "event-1",
      timestamp: "2026-09-07T12:00:00.000Z",
      kind: "live_timing",
      timing: {
        category: "model",
        status: "unsupported",
        confidence: "unsupported",
      },
    },
    {
      eventId: "event-1",
      timestamp: "2026-09-07T12:00:00.000Z",
      kind: "live_timing",
      timing: {
        category: "tool",
        status: "running",
        confidence: "live",
        startedAt: "2026-09-07T12:00:00.000Z",
      },
    },
    {
      eventId: "event-1",
      timestamp: "2026-09-07T12:00:00.000Z",
      kind: "live_timing",
      timing: {
        category: "tool",
        status: "running",
        confidence: "live",
        startedAt: "2026-09-07T12:00:00.000Z",
      },
    },
    {
      eventId: "event-1",
      timestamp: "2026-09-07T12:00:00.000Z",
      kind: "live_timing",
      timing: {
        category: "tool",
        status: "unknown",
        confidence: "live",
        startedAt: "2026-09-07T12:00:00.000Z",
        endedAt: "2026-09-07T12:00:00.000Z",
        durationMs: 0,
      },
    },
  ]);
  assert.equal(flushes, 4);
});

test("starts an immediate nonblocking flush for each lifecycle boundary", async () => {
  const registerLiveWal = await loadRegister();
  assert.ok(registerLiveWal);

  const handlers = new Map<string, () => Promise<void>>();
  let flushes = 0;
  let releaseFlush: (() => void) | undefined;
  const flushStarted = new Promise<void>((resolve) => {
    releaseFlush = resolve;
  });
  registerLiveWal(
    { on: (event, handler) => handlers.set(event, handler) },
    {
      append: () => undefined,
      flush: () => {
        flushes += 1;
        releaseFlush?.();
        return new Promise(() => {});
      },
    },
    {
      now: () => new Date("2026-09-07T12:00:00.000Z"),
      randomId: () => "event-1",
    },
  );

  const toolStart = handlers.get("tool_execution_start");
  assert.ok(toolStart);
  await toolStart();
  await flushStarted;
  assert.equal(flushes, 1);
});

test("pairs agent, turn, and tool boundaries FIFO without payload correlation", async () => {
  const registerLiveWal = await loadRegister();
  assert.ok(registerLiveWal);

  const handlers = new Map<string, () => Promise<void>>();
  const events: Array<{ timing?: { category: string; startedAt?: string } }> =
    [];
  let tick = 0;
  registerLiveWal(
    { on: (event, handler) => handlers.set(event, handler) },
    {
      append: (event) => {
        events.push(event);
      },
      flush: async () => {},
    },
    {
      now: () => new Date(`2026-09-07T12:00:0${tick++}.000Z`),
      randomId: () => "event-1",
    },
  );

  for (const category of ["agent", "turn", "tool"] as const) {
    await handlers.get(
      `${category === "tool" ? "tool_execution" : category}_start`,
    )?.();
    await handlers.get(
      `${category === "tool" ? "tool_execution" : category}_end`,
    )?.();
  }

  assert.deepEqual(
    events.slice(2).map(({ timing }) => timing),
    [
      {
        category: "agent",
        status: "running",
        confidence: "live",
        startedAt: "2026-09-07T12:00:02.000Z",
      },
      {
        category: "agent",
        status: "unknown",
        confidence: "live",
        startedAt: "2026-09-07T12:00:02.000Z",
        endedAt: "2026-09-07T12:00:03.000Z",
        durationMs: 1000,
      },
      {
        category: "turn",
        status: "running",
        confidence: "live",
        startedAt: "2026-09-07T12:00:04.000Z",
      },
      {
        category: "turn",
        status: "unknown",
        confidence: "live",
        startedAt: "2026-09-07T12:00:04.000Z",
        endedAt: "2026-09-07T12:00:05.000Z",
        durationMs: 1000,
      },
      {
        category: "tool",
        status: "running",
        confidence: "live",
        startedAt: "2026-09-07T12:00:06.000Z",
      },
      {
        category: "tool",
        status: "unknown",
        confidence: "live",
        startedAt: "2026-09-07T12:00:06.000Z",
        endedAt: "2026-09-07T12:00:07.000Z",
        durationMs: 1000,
      },
    ],
  );
});

test("leaves unmatched starts as bounded anonymous running records", async () => {
  const registerLiveWal = await loadRegister();
  assert.ok(registerLiveWal);

  const handlers = new Map<string, () => Promise<void>>();
  const events: Array<{ kind: string; timing?: { status: string } }> = [];
  registerLiveWal(
    { on: (event, handler) => handlers.set(event, handler) },
    {
      append: (event) => {
        events.push(event);
      },
      flush: async () => {},
    },
    {
      now: () => new Date("2026-09-07T12:00:00.000Z"),
      randomId: () => "event-1",
    },
  );

  await handlers.get("turn_start")?.();

  assert.equal(events.at(-1)?.kind, "live_timing");
  assert.equal(events.at(-1)?.timing?.status, "running");
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

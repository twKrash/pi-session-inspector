import assert from "node:assert/strict";
import { test } from "node:test";

import { canonicalOpaqueDigest } from "../../src/core/opaque-id.ts";

type Timing = {
  category: "agent" | "turn" | "tool" | "provider" | "model";
  status: "running" | "unknown" | "unsupported";
  confidence: "live" | "unsupported";
  subjectId?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
};

type Register = (
  api: {
    on(event: string, handler: (payload?: unknown) => Promise<void>): void;
  },
  writer: {
    append(event: {
      eventId: string;
      timestamp: string;
      kind: "live_timing";
      timing: Timing;
    }): void | Promise<void>;
    flush(): Promise<void>;
  },
  options: { sessionId: string; now(): Date; randomId(): string },
) => { liveOverflow(): number };

async function loadRegister(): Promise<Register | undefined> {
  try {
    return (
      await import(new URL("../../src/pi/live-wal.ts", import.meta.url).href)
    ).registerLiveWal;
  } catch {
    return undefined;
  }
}

function subject(sessionId: string, toolCallId: string): string {
  return `live-tool-${canonicalOpaqueDigest("live-tool", sessionId, toolCallId)}`;
}

test("records payload-free timing boundaries, omits unsupported categories, and flushes at shutdown", async () => {
  const registerLiveWal = await loadRegister();
  assert.ok(registerLiveWal);

  const handlers = new Map<string, (payload?: unknown) => Promise<void>>();
  const events: Array<{ kind: string; timing: Timing }> = [];
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
      sessionId: "s1",
      now: () => new Date("2026-09-07T12:00:00.000Z"),
      randomId: () => "event-1",
    },
  );

  await handlers.get("tool_execution_start")?.({
    kind: "tool_execution_start",
    toolCallId: "call_a",
  });
  await handlers.get("tool_execution_end")?.({
    kind: "tool_execution_end",
    toolCallId: "call_a",
  });
  await handlers.get("session_shutdown")?.({ kind: "session_shutdown" });

  // Provider/model capability is static; new writers persist no unsupported rows.
  assert.equal(
    events.some(({ timing }) => timing.status === "unsupported"),
    false,
  );
  assert.deepEqual(
    events.map(({ timing }) => timing),
    [
      {
        category: "tool",
        status: "running",
        confidence: "live",
        subjectId: subject("s1", "call_a"),
        startedAt: "2026-09-07T12:00:00.000Z",
      },
      {
        category: "tool",
        status: "unknown",
        confidence: "live",
        subjectId: subject("s1", "call_a"),
        startedAt: "2026-09-07T12:00:00.000Z",
        endedAt: "2026-09-07T12:00:00.000Z",
        durationMs: 0,
      },
    ],
  );
  assert.equal(flushes, 3);
});

test("starts an immediate nonblocking flush for each lifecycle boundary", async () => {
  const registerLiveWal = await loadRegister();
  assert.ok(registerLiveWal);

  const handlers = new Map<string, (payload?: unknown) => Promise<void>>();
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
      sessionId: "s1",
      now: () => new Date("2026-09-07T12:00:00.000Z"),
      randomId: () => "event-1",
    },
  );

  const toolStart = handlers.get("tool_execution_start");
  assert.ok(toolStart);
  await toolStart({ kind: "tool_execution_start", toolCallId: "call_a" });
  await flushStarted;
  assert.equal(flushes, 1);
});

test("pairs agent and turn boundaries FIFO and tool boundaries by subject", async () => {
  const registerLiveWal = await loadRegister();
  assert.ok(registerLiveWal);

  const handlers = new Map<string, (payload?: unknown) => Promise<void>>();
  const events: Array<{ timing?: Timing }> = [];
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
      sessionId: "s1",
      now: () => new Date(`2026-09-07T12:00:0${tick++}.000Z`),
      randomId: () => "event-1",
    },
  );

  for (const category of ["agent", "turn"] as const) {
    await handlers.get(`${category}_start`)?.({ kind: `${category}_start` });
    await handlers.get(`${category}_end`)?.({ kind: `${category}_end` });
  }
  await handlers.get("tool_execution_start")?.({
    kind: "tool_execution_start",
    toolCallId: "call_a",
  });
  await handlers.get("tool_execution_end")?.({
    kind: "tool_execution_end",
    toolCallId: "call_a",
  });

  assert.deepEqual(
    events.map(({ timing }) => timing),
    [
      {
        category: "agent",
        status: "running",
        confidence: "live",
        startedAt: "2026-09-07T12:00:00.000Z",
      },
      {
        category: "agent",
        status: "unknown",
        confidence: "live",
        startedAt: "2026-09-07T12:00:00.000Z",
        endedAt: "2026-09-07T12:00:01.000Z",
        durationMs: 1000,
      },
      {
        category: "turn",
        status: "running",
        confidence: "live",
        startedAt: "2026-09-07T12:00:02.000Z",
      },
      {
        category: "turn",
        status: "unknown",
        confidence: "live",
        startedAt: "2026-09-07T12:00:02.000Z",
        endedAt: "2026-09-07T12:00:03.000Z",
        durationMs: 1000,
      },
      {
        category: "tool",
        status: "running",
        confidence: "live",
        subjectId: subject("s1", "call_a"),
        startedAt: "2026-09-07T12:00:04.000Z",
      },
      {
        category: "tool",
        status: "unknown",
        confidence: "live",
        subjectId: subject("s1", "call_a"),
        startedAt: "2026-09-07T12:00:04.000Z",
        endedAt: "2026-09-07T12:00:05.000Z",
        durationMs: 1000,
      },
    ],
  );
});

test("concurrent tools pair by subject, not arrival order", async () => {
  const registerLiveWal = await loadRegister();
  assert.ok(registerLiveWal);

  const handlers = new Map<string, (payload?: unknown) => Promise<void>>();
  const events: Array<{ timing: Timing }> = [];
  registerLiveWal(
    { on: (event, handler) => handlers.set(event, handler) },
    {
      append: (event) => {
        events.push(event);
      },
      flush: async () => {},
    },
    {
      sessionId: "s1",
      now: () => new Date("2026-09-12T10:00:00.000Z"),
      randomId: () => "event-1",
    },
  );

  await handlers.get("tool_execution_start")?.({
    kind: "tool_execution_start",
    toolCallId: "call_a",
  });
  await handlers.get("tool_execution_start")?.({
    kind: "tool_execution_start",
    toolCallId: "call_b",
  });
  await handlers.get("tool_execution_end")?.({
    kind: "tool_execution_end",
    toolCallId: "call_b",
  });
  await handlers.get("tool_execution_end")?.({
    kind: "tool_execution_end",
    toolCallId: "call_a",
  });

  const runs = events.filter(({ timing }) => timing.status === "running");
  const done = events.filter(({ timing }) => timing.status === "unknown");
  assert.equal(runs.length, 2);
  assert.equal(done.length, 2);
  assert.equal(typeof runs[0]?.timing.subjectId, "string");
  assert.match(String(runs[0]?.timing.subjectId), /^live-tool-[a-f0-9]{64}$/);
  assert.notEqual(runs[0]?.timing.subjectId, runs[1]?.timing.subjectId);
  // call_b completes first; call_a completes second — arrival order must not pair them.
  assert.equal(done[0]?.timing.subjectId, runs[1]?.timing.subjectId);
  assert.equal(done[1]?.timing.subjectId, runs[0]?.timing.subjectId);
  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes("call_a"), false);
  assert.equal(serialized.includes("call_b"), false);
});

test("does not close another subject with an unmatched end", async () => {
  const registerLiveWal = await loadRegister();
  assert.ok(registerLiveWal);

  const handlers = new Map<string, (payload?: unknown) => Promise<void>>();
  const events: Array<{ timing: Timing }> = [];
  registerLiveWal(
    { on: (event, handler) => handlers.set(event, handler) },
    {
      append: (event) => {
        events.push(event);
      },
      flush: async () => {},
    },
    {
      sessionId: "s1",
      now: () => new Date("2026-09-12T10:00:00.000Z"),
      randomId: () => "event-1",
    },
  );

  await handlers.get("tool_execution_start")?.({
    kind: "tool_execution_start",
    toolCallId: "call_a",
  });
  // call_b was never opened; its end must not close call_a.
  await handlers.get("tool_execution_end")?.({
    kind: "tool_execution_end",
    toolCallId: "call_b",
  });
  assert.equal(
    events.filter(({ timing }) => timing.status === "unknown").length,
    0,
  );
  assert.equal(
    events.filter(({ timing }) => timing.status === "running").length,
    1,
  );

  await handlers.get("tool_execution_end")?.({
    kind: "tool_execution_end",
    toolCallId: "call_a",
  });
  assert.equal(
    events.filter(({ timing }) => timing.status === "unknown").length,
    1,
  );
});

test("bounds open tool subjects, drops the new start and counts the overflow", async () => {
  const registerLiveWal = await loadRegister();
  assert.ok(registerLiveWal);

  const handlers = new Map<string, (payload?: unknown) => Promise<void>>();
  const events: Array<{ timing: Timing }> = [];
  const registration = registerLiveWal(
    { on: (event, handler) => handlers.set(event, handler) },
    {
      append: (event) => {
        events.push(event);
      },
      flush: async () => {},
    },
    {
      sessionId: "s1",
      now: () => new Date("2026-09-12T10:00:00.000Z"),
      randomId: () => "event-1",
    },
  );

  for (let index = 0; index < 65; index += 1) {
    await handlers.get("tool_execution_start")?.({
      kind: "tool_execution_start",
      toolCallId: `call_${index}`,
    });
  }
  const runs = events.filter(({ timing }) => timing.status === "running");
  assert.equal(runs.length, 64);
  assert.equal(registration.liveOverflow(), 1);
  // The dropped 65th start never evicts an older subject that may still close.
  await handlers.get("tool_execution_end")?.({
    kind: "tool_execution_end",
    toolCallId: "call_0",
  });
  const done = events.filter(({ timing }) => timing.status === "unknown");
  assert.equal(done.length, 1);
  assert.equal(done[0]?.timing.subjectId, runs[0]?.timing.subjectId);
});

test("ignores a repeated start for an already-open subject", async () => {
  const registerLiveWal = await loadRegister();
  assert.ok(registerLiveWal);

  const handlers = new Map<string, (payload?: unknown) => Promise<void>>();
  const events: Array<{ timing: Timing }> = [];
  registerLiveWal(
    { on: (event, handler) => handlers.set(event, handler) },
    {
      append: (event) => {
        events.push(event);
      },
      flush: async () => {},
    },
    {
      sessionId: "s1",
      now: () => new Date("2026-09-12T10:00:00.000Z"),
      randomId: () => "event-1",
    },
  );

  await handlers.get("tool_execution_start")?.({
    kind: "tool_execution_start",
    toolCallId: "call_a",
  });
  await handlers.get("tool_execution_start")?.({
    kind: "tool_execution_start",
    toolCallId: "call_a",
  });
  assert.equal(
    events.filter(({ timing }) => timing.status === "running").length,
    1,
  );
});

test("drops tool events without a bounded call id and never writes a subject", async () => {
  const registerLiveWal = await loadRegister();
  assert.ok(registerLiveWal);

  const handlers = new Map<string, (payload?: unknown) => Promise<void>>();
  const events: Array<{ timing: Timing }> = [];
  registerLiveWal(
    { on: (event, handler) => handlers.set(event, handler) },
    {
      append: (event) => {
        events.push(event);
      },
      flush: async () => {},
    },
    {
      sessionId: "s1",
      now: () => new Date("2026-09-12T10:00:00.000Z"),
      randomId: () => "event-1",
    },
  );

  await handlers.get("tool_execution_start")?.({
    kind: "tool_execution_start",
  });
  await handlers.get("tool_execution_end")?.({ kind: "tool_execution_end" });
  await handlers.get("tool_execution_start")?.({
    kind: "tool_execution_start",
    toolCallId: "",
  });

  assert.deepEqual(events, []);
});

test("leaves unmatched starts as bounded anonymous running records", async () => {
  const registerLiveWal = await loadRegister();
  assert.ok(registerLiveWal);

  const handlers = new Map<string, (payload?: unknown) => Promise<void>>();
  const events: Array<{ kind: string; timing?: Timing }> = [];
  registerLiveWal(
    { on: (event, handler) => handlers.set(event, handler) },
    {
      append: (event) => {
        events.push(event);
      },
      flush: async () => {},
    },
    {
      sessionId: "s1",
      now: () => new Date("2026-09-07T12:00:00.000Z"),
      randomId: () => "event-1",
    },
  );

  await handlers.get("turn_start")?.({ kind: "turn_start" });

  assert.equal(events.at(-1)?.kind, "live_timing");
  assert.equal(events.at(-1)?.timing?.status, "running");
  assert.equal(events.at(-1)?.timing?.subjectId, undefined);
});

test("returns before a never-settling append promise", async () => {
  const registerLiveWal = await loadRegister();
  assert.ok(registerLiveWal);

  const handlers = new Map<string, (payload?: unknown) => Promise<void>>();
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
      sessionId: "s1",
      now: () => new Date("2026-09-07T12:00:00.000Z"),
      randomId: () => "event-1",
    },
  );

  const toolStart = handlers.get("tool_execution_start");
  assert.ok(toolStart);
  const hook = toolStart({
    kind: "tool_execution_start",
    toolCallId: "call_a",
  });
  hookReturned = true;
  await assert.doesNotReject(hook);
  await appended;
  assert.equal(appendBeforeHookReturned, false);
});

test("catches a rejected append promise", async () => {
  const registerLiveWal = await loadRegister();
  assert.ok(registerLiveWal);

  const handlers = new Map<string, (payload?: unknown) => Promise<void>>();
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
        sessionId: "s1",
        now: () => new Date("2026-09-07T12:00:00.000Z"),
        randomId: () => "event-1",
      },
    );

    const toolStart = handlers.get("tool_execution_start");
    assert.ok(toolStart);
    await assert.doesNotReject(
      toolStart({ kind: "tool_execution_start", toolCallId: "call_a" }),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandledRejection);
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";

type Register = (
  api: {
    on(event: string, handler: (payload?: unknown) => Promise<void>): void;
  },
  observe: (event: { kind: string; toolCallId?: string }) => void,
) => void;

async function loadRegister(): Promise<Register | undefined> {
  try {
    return (await import(new URL("../../src/pi/live.ts", import.meta.url).href))
      .registerLiveObserver;
  } catch {
    return undefined;
  }
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("registers only observer hooks and swallows telemetry failures", async () => {
  const registerLiveObserver = await loadRegister();
  assert.ok(registerLiveObserver);

  const handlers = new Map<string, (payload?: unknown) => Promise<void>>();
  registerLiveObserver(
    { on: (event, handler) => handlers.set(event, handler) },
    () => {
      throw new Error("storage unavailable");
    },
  );

  assert.deepEqual(
    [...handlers.keys()],
    [
      "session_start",
      "session_shutdown",
      "agent_start",
      "agent_end",
      "turn_start",
      "turn_end",
      "tool_execution_start",
      "tool_execution_end",
      "session_compact",
      "session_tree",
      "model_select",
      "thinking_level_select",
    ],
  );
  const toolStart = handlers.get("tool_execution_start");
  assert.ok(toolStart);
  await assert.doesNotReject(toolStart());
});

test("passes only the lifecycle kind and bounded toolCallId, never hook payloads", async () => {
  const registerLiveObserver = await loadRegister();
  assert.ok(registerLiveObserver);

  const handlers = new Map<string, (payload?: unknown) => Promise<void>>();
  const observed: Array<{ kind: string; toolCallId?: string }> = [];
  registerLiveObserver(
    { on: (event, handler) => handlers.set(event, handler) },
    (event) => {
      observed.push(event);
    },
  );

  await handlers.get("tool_execution_start")?.({
    kind: "tool_execution_start",
    toolCallId: "call_a",
    args: { secret: "hunter2" },
    result: { output: "secret" },
    message: { role: "assistant", content: "prompt" },
    provider: { apiKey: "sk-secret" },
    model: { id: "model" },
  });
  await handlers.get("agent_start")?.({
    kind: "agent_start",
    message: { role: "assistant", content: "prompt" },
  });
  await settle();

  assert.deepEqual(observed, [
    { kind: "tool_execution_start", toolCallId: "call_a" },
    { kind: "agent_start" },
  ]);
  const serialized = JSON.stringify(observed);
  assert.equal(serialized.includes("hunter2"), false);
  assert.equal(serialized.includes("sk-secret"), false);
  assert.equal(serialized.includes("prompt"), false);
});

test("drops an oversized or non-string toolCallId", async () => {
  const registerLiveObserver = await loadRegister();
  assert.ok(registerLiveObserver);

  const handlers = new Map<string, (payload?: unknown) => Promise<void>>();
  const observed: Array<{ kind: string; toolCallId?: string }> = [];
  registerLiveObserver(
    { on: (event, handler) => handlers.set(event, handler) },
    (event) => {
      observed.push(event);
    },
  );

  await handlers.get("tool_execution_end")?.({
    kind: "tool_execution_end",
    toolCallId: "x".repeat(513),
  });
  await handlers.get("tool_execution_end")?.({
    kind: "tool_execution_end",
    toolCallId: 42,
  });
  await handlers.get("tool_execution_end")?.({});
  await settle();

  assert.deepEqual(observed, [
    { kind: "tool_execution_end" },
    { kind: "tool_execution_end" },
    { kind: "tool_execution_end" },
  ]);
});

test("returns before an observer promise settles", async () => {
  const registerLiveObserver = await loadRegister();
  assert.ok(registerLiveObserver);

  const handlers = new Map<string, (payload?: unknown) => Promise<void>>();
  registerLiveObserver(
    { on: (event, handler) => handlers.set(event, handler) },
    () => new Promise(() => {}),
  );

  const toolStart = handlers.get("tool_execution_start");
  assert.ok(toolStart);
  let settled = false;
  void toolStart().then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, true);
});

import assert from "node:assert/strict";
import { test } from "node:test";

type Register = (
  api: { on(event: string, handler: () => Promise<void>): void },
  observe: (event: { kind: string }) => void,
) => void;

async function loadRegister(): Promise<Register | undefined> {
  try {
    return (await import(new URL("../../src/pi/live.ts", import.meta.url).href))
      .registerLiveObserver;
  } catch {
    return undefined;
  }
}

test("registers only observer hooks and swallows telemetry failures", async () => {
  const registerLiveObserver = await loadRegister();
  assert.ok(registerLiveObserver);

  const handlers = new Map<string, () => Promise<void>>();
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

test("returns before an observer promise settles", async () => {
  const registerLiveObserver = await loadRegister();
  assert.ok(registerLiveObserver);

  const handlers = new Map<string, () => Promise<void>>();
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

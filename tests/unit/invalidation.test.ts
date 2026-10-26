import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionInvalidationSignal } from "../../src/ui/invalidation.ts";

test("listeners receive only the runtime and session IDs", () => {
  const signal = new SessionInvalidationSignal();
  const event = { runtimeId: "runtime-1", sessionId: "session-1" };
  let received: unknown;
  signal.subscribe(function () {
    received = arguments[0];
  });

  signal.notify(event);

  assert.deepEqual(received, event);
  assert.deepEqual(Object.keys(received as object).sort(), [
    "runtimeId",
    "sessionId",
  ]);
});

test("listeners unsubscribe and throwing listeners do not prevent others", () => {
  const signal = new SessionInvalidationSignal();
  const event = { runtimeId: "runtime-1", sessionId: "session-1" };
  let calls = 0;
  const unsubscribe = signal.subscribe(() => {
    calls += 1;
  });
  signal.subscribe(() => {
    throw new Error("observer");
  });
  signal.subscribe(() => {
    calls += 10;
  });
  signal.notify(event);
  unsubscribe();
  signal.notify(event);
  assert.equal(calls, 21);
});

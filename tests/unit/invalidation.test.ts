import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionInvalidationSignal } from "../../src/ui/invalidation.ts";

test("listeners unsubscribe and throwing listeners do not prevent others", () => {
  const signal = new SessionInvalidationSignal();
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
  signal.notify();
  unsubscribe();
  signal.notify();
  assert.equal(calls, 21);
});

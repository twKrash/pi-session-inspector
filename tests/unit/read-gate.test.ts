import assert from "node:assert/strict";
import { test } from "node:test";
import { createGate } from "../../src/pi/read-gate.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Runs `count` tasks through a gate and reports peak concurrency and start order. */
async function run(limit: number, count: number, ticks: (i: number) => number) {
  const gate = createGate(limit);
  let active = 0;
  let peak = 0;
  const started: number[] = [];
  await Promise.all(
    Array.from({ length: count }, (_, i) =>
      gate(async () => {
        started.push(i);
        peak = Math.max(peak, ++active);
        for (let n = 0; n < ticks(i); n++) await tick();
        active--;
      }),
    ),
  );
  return { peak, started };
}

test("no more than the limit run at once, and the limit is reached", async () => {
  const { peak } = await run(3, 12, () => 2);
  assert.equal(peak, 3);
});

test("tasks start in arrival order", async () => {
  const { started } = await run(2, 8, (i) => (i % 3) + 1);
  assert.deepEqual(started, [0, 1, 2, 3, 4, 5, 6, 7]);
});

test("a task's result and failure pass through and free its slot", async () => {
  const gate = createGate(1);
  assert.equal(await gate(async () => "value"), "value");
  await assert.rejects(
    gate(async () => {
      throw new Error("boom");
    }),
    /boom/,
  );
  assert.equal(await gate(async () => "after"), "after");
});

test("a limit of one runs tasks strictly one after another", async () => {
  const { peak } = await run(1, 5, () => 1);
  assert.equal(peak, 1);
});

test("the limit holds when new tasks keep arriving while others wait", async () => {
  // History sessions call the gate again after each of their files, so
  // arrivals are spread over time rather than enqueued in one tick.
  const gate = createGate(2);
  let active = 0;
  let peak = 0;
  const running: Promise<void>[] = [];
  for (let i = 0; i < 10; i++) {
    running.push(
      gate(async () => {
        peak = Math.max(peak, ++active);
        for (let n = 0; n < 4; n++) await tick();
        active--;
      }),
    );
    await tick();
  }
  await Promise.all(running);
  assert.equal(peak, 2);
});

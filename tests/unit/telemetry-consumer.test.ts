import assert from "node:assert/strict";
import { test } from "node:test";

type Consume = (
  input: unknown,
  sink: { appendTelemetry(envelope: unknown): void },
) => void;

async function loadConsume(): Promise<Consume | undefined> {
  try {
    return (
      await import(new URL("../../src/pi/telemetry.ts", import.meta.url).href)
    ).consumeTelemetry;
  } catch {
    return undefined;
  }
}

test("sends only redacted validated telemetry to its local sink", async () => {
  const consumeTelemetry = await loadConsume();
  assert.ok(consumeTelemetry);

  const received: unknown[] = [];
  consumeTelemetry(
    {
      schemaVersion: 1,
      source: "ctx",
      metric: "mode",
      value: "Bearer secret-value",
      kind: "gauge",
      dimensions: { token: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop" },
    },
    { appendTelemetry: (envelope) => received.push(envelope) },
  );

  assert.equal(received.length, 1);
  assert.equal(JSON.stringify(received).includes("secret-value"), false);
  assert.equal(JSON.stringify(received).includes("ghp_"), false);
});

test("swallows a local sink failure without retrying", async () => {
  const consumeTelemetry = await loadConsume();
  assert.ok(consumeTelemetry);

  let calls = 0;
  assert.doesNotThrow(() =>
    consumeTelemetry(
      {
        schemaVersion: 1,
        source: "ctx",
        metric: "mode",
        value: "full",
        kind: "gauge",
      },
      {
        appendTelemetry: () => {
          calls += 1;
          throw new Error("disk unavailable");
        },
      },
    ),
  );
  assert.equal(calls, 1);
});

test("drops invalid telemetry before it reaches its local sink", async () => {
  const consumeTelemetry = await loadConsume();
  assert.ok(consumeTelemetry);

  const received: unknown[] = [];
  consumeTelemetry(
    {
      schemaVersion: 1,
      source: "ctx",
      metric: "calls",
      value: "secret-invalid-counter",
      kind: "counter",
    },
    { appendTelemetry: (envelope) => received.push(envelope) },
  );

  assert.deepEqual(received, []);
});

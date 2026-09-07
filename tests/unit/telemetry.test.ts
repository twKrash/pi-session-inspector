import assert from "node:assert/strict";
import { test } from "node:test";

type Validator = (input: unknown) => unknown;

async function loadValidator(): Promise<Validator | undefined> {
  try {
    return (
      await import(new URL("../../src/pi/telemetry.ts", import.meta.url).href)
    ).validateTelemetry;
  } catch {
    return undefined;
  }
}

test("accepts bounded state telemetry without retaining a secret dimension", async () => {
  const validateTelemetry = await loadValidator();
  assert.ok(validateTelemetry);

  const result = validateTelemetry({
    schemaVersion: 1,
    source: "caveman",
    metric: "mode",
    value: "full",
    kind: "gauge",
    dimensions: { authorization: "Bearer secret-value" },
    attribution: { agentId: "agent-1" },
  });

  assert.equal(JSON.stringify(result).includes("secret-value"), false);
});

test("redacts opaque token-shaped gauge values", async () => {
  const validateTelemetry = await loadValidator();
  assert.ok(validateTelemetry);

  const token = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop";
  const result = validateTelemetry({
    schemaVersion: 1,
    source: "ctx",
    metric: "state",
    value: token,
    kind: "gauge",
    dimensions: { state: token },
    attribution: { agentId: token },
  });
  const serialized = JSON.stringify(result);

  assert.equal((result as { ok: boolean }).ok, true);
  assert.equal(serialized.includes(token), false);
  assert.equal(serialized.includes("[REDACTED]"), true);
});

test("rejects string counter values without echoing supplied content", async () => {
  const validateTelemetry = await loadValidator();
  assert.ok(validateTelemetry);

  const result = validateTelemetry({
    schemaVersion: 1,
    source: "ctx",
    metric: "calls",
    value: "not-a-number",
    kind: "counter",
  });

  assert.equal(JSON.stringify(result).includes("not-a-number"), false);
});

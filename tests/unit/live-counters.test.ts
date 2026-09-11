import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { registerLiveCounters } from "../../src/integrations/live-counters.ts";

test("translates public permission bus events into bounded envelopes only", async () => {
  const rows = JSON.parse(
    await readFile(
      new URL(
        "../fixtures/integrations/permission-events.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as Array<{ channel: string; data: unknown }>;
  const handlers = new Map<string, (data: unknown) => void>();
  const envelopes: unknown[] = [];
  const inputHandlers: Array<(event: { text: string }) => void> = [];

  registerLiveCounters(
    {
      events: {
        on: (channel, handler) => {
          handlers.set(channel, handler);
          return () => {};
        },
      },
      on: (_event, handler) => inputHandlers.push(handler),
    },
    {
      appendTelemetry: (envelope) => envelopes.push(envelope),
      flush: async () => {},
    },
    {
      inventoryNames: () => new Set(["council-mode", "hf-cli"]),
      now: () => new Date("2026-09-11T10:00:00Z"),
    },
  );

  for (const row of rows) handlers.get(row.channel)?.(row.data);

  const serialized = JSON.stringify(envelopes);
  assert.equal(serialized.includes("sentinel"), false);
  assert.equal(serialized.includes("/etc/"), false);
  assert.deepEqual(
    envelopes
      .filter(
        (envelope) =>
          (envelope as { metric: string }).metric === "permission.decision",
      )
      .map(
        (envelope) =>
          (envelope as { dimensions: Record<string, string> }).dimensions,
      ),
    [
      { result: "allow", resolution: "policy_allow" },
      { result: "deny", resolution: "user_denied" },
    ],
  );

  inputHandlers[0]?.({ text: "/skill:council-mode --scope tree" });
  inputHandlers[0]?.({ text: "/skill:unknown-mode secret prompt text" });
  inputHandlers[0]?.({ text: "ordinary prompt text" });

  assert.deepEqual(
    envelopes.filter(
      (envelope) =>
        (envelope as { metric: string }).metric === "skill.invocation",
    ),
    [
      {
        schemaVersion: 1,
        source: "pi-input",
        metric: "skill.invocation",
        kind: "counter",
        value: 1,
        dimensions: { skill: "council-mode" },
        timestamp: Date.parse("2026-09-11T10:00:00Z"),
      },
    ],
  );
  assert.equal(JSON.stringify(envelopes).includes("secret prompt text"), false);
});

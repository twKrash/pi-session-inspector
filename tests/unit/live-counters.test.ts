import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { registerLiveCounters } from "../../src/integrations/live-counters.ts";
import { foldTelemetryCounters } from "../../src/core/live-counter-fold.ts";

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
      sessionId: "live-counters-session",
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

  // Missing or unrecognised producer resolutions are bounded to the closed
  // vocabulary; the raw producer string must never reach the writer.
  const decisionHandler = handlers.get("permissions:decision");
  decisionHandler?.({
    result: "allow",
    resolution: "sentinel-unknown-resolution",
  });
  decisionHandler?.({ result: "deny" });
  assert.deepEqual(
    envelopes
      .filter(
        (envelope) =>
          (envelope as { metric: string }).metric === "permission.decision",
      )
      .slice(2)
      .map(
        (envelope) =>
          (envelope as { dimensions: Record<string, string> }).dimensions,
      ),
    [
      { result: "allow", resolution: "other" },
      { result: "deny", resolution: "other" },
    ],
  );
  assert.equal(
    JSON.stringify(envelopes).includes("sentinel-unknown-resolution"),
    false,
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

  // permission.prompt: every valid promptSource maps to its bounded envelope.
  const promptHandler = handlers.get("permissions:ui_prompt");
  promptHandler?.({ source: "skill_input" });
  promptHandler?.({ source: "skill_read" });
  promptHandler?.({ source: "sentinel-unknown-source" });
  assert.deepEqual(
    envelopes
      .filter(
        (envelope) =>
          (envelope as { metric: string }).metric === "permission.prompt",
      )
      .map(
        (envelope) =>
          (envelope as { dimensions: Record<string, string> }).dimensions,
      ),
    [
      { promptSource: "tool_call" },
      { promptSource: "skill_input" },
      { promptSource: "skill_read" },
    ],
  );
  assert.equal(
    JSON.stringify(envelopes).includes("sentinel-unknown-source"),
    false,
  );

  // permissions:ready is a presence envelope with no dimensions, and folding it
  // must not invent or change any counter.
  const readyEnvelopes = envelopes.filter(
    (envelope) =>
      (envelope as { metric: string }).metric === "permission.ready",
  );
  assert.deepEqual(readyEnvelopes, [
    {
      schemaVersion: 1,
      source: "permission-system",
      metric: "permission.ready",
      kind: "counter",
      value: 1,
      timestamp: Date.parse("2026-09-11T10:00:00Z"),
    },
  ]);
  assert.equal(Object.hasOwn(readyEnvelopes[0] as object, "dimensions"), false);
  const readyFolded = foldTelemetryCounters(readyEnvelopes);
  assert.deepEqual(readyFolded.counters, {});
  assert.equal(readyFolded.presence.permission, true);
});

test("repeated registration for one session keeps exactly one listener set", () => {
  const busHandlers = new Map<string, (data: unknown) => void>();
  const inputHandlers: Array<(event: { text: string }) => void> = [];
  let busSubscriptions = 0;
  const api = {
    events: {
      on: (channel: string, handler: (data: unknown) => void) => {
        busSubscriptions += 1;
        busHandlers.set(channel, handler);
        return () => {};
      },
    },
    on: (_event: "input", handler: (event: { text: string }) => void) => {
      inputHandlers.push(handler);
    },
  };
  const firstEnvelopes: unknown[] = [];
  const secondEnvelopes: unknown[] = [];
  const options = {
    sessionId: "live-dedupe-session",
    inventoryNames: () => new Set(["council-mode"]),
    now: () => new Date("2026-09-11T10:00:00Z"),
  };

  const first = registerLiveCounters(
    api,
    {
      appendTelemetry: (envelope) => firstEnvelopes.push(envelope),
      flush: async () => {},
    },
    options,
  );
  // A second registration for the same session must be a no-op: no new bus or
  // input listeners, and no second envelope for a single observed event.
  const second = registerLiveCounters(
    api,
    {
      appendTelemetry: (envelope) => secondEnvelopes.push(envelope),
      flush: async () => {},
    },
    options,
  );
  assert.equal(second, first);
  assert.equal(busSubscriptions, 3);
  assert.equal(inputHandlers.length, 1);

  inputHandlers[0]?.({ text: "/skill:council-mode" });
  assert.equal(
    firstEnvelopes.filter(
      (envelope) =>
        (envelope as { metric: string }).metric === "skill.invocation",
    ).length,
    1,
  );
  assert.equal(secondEnvelopes.length, 0);

  // Disposal releases the session so a later registration attaches again.
  first.dispose();
  registerLiveCounters(
    api,
    {
      appendTelemetry: (envelope) => secondEnvelopes.push(envelope),
      flush: async () => {},
    },
    options,
  );
  assert.equal(inputHandlers.length, 2);
  inputHandlers[1]?.({ text: "/skill:council-mode" });
  assert.equal(secondEnvelopes.length, 1);
});

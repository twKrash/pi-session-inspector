import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { foldTelemetryCounters } from "../../src/core/live-counter-fold.ts";
import { registerLiveCounters } from "../../src/integrations/live-counters.ts";

function attributionOf(
  envelope: Record<string, unknown> | undefined,
): Record<string, string> {
  return (envelope?.attribution ?? {}) as Record<string, string>;
}

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
      on: (_event, handler) => {
        inputHandlers.push(handler);
        return () => {};
      },
    },
    {
      appendTelemetry: (envelope) => envelopes.push(envelope),
      flush: async () => {},
    },
    {
      sessionId: "live-counters-session",
      root: "/inspector",
      runtimeId: "runtime-live-counters",
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

test("permission request attribution is stable within a session and differs across sessions", () => {
  const handlers = new Map<string, (payload: unknown) => void>();
  const childHandlers = new Map<string, (payload: unknown) => void>();
  const envelopes: Record<string, unknown>[] = [];
  const childEnvelopes: Record<string, unknown>[] = [];
  const registration = registerLiveCounters(
    {
      events: {
        on: (channel, handler) => {
          handlers.set(channel, handler);
          return () => {};
        },
      },
      on: () => () => {},
    },
    {
      appendTelemetry: (envelope) => {
        envelopes.push(envelope as Record<string, unknown>);
      },
      flush: async () => {},
    },
    {
      sessionId: "permission-attribution-session",
      root: "/inspector",
      runtimeId: "runtime-permission-attribution",
      inventoryNames: () => new Set<string>(),
      now: () => new Date("2026-09-12T10:00:00.000Z"),
    },
  );
  const childRegistration = registerLiveCounters(
    {
      events: {
        on: (channel, handler) => {
          childHandlers.set(channel, handler);
          return () => {};
        },
      },
      on: () => () => {},
    },
    {
      appendTelemetry: (envelope) => {
        childEnvelopes.push(envelope as Record<string, unknown>);
      },
      flush: async () => {},
    },
    {
      sessionId: "permission-attribution-child-session",
      root: "/inspector",
      runtimeId: "runtime-permission-attribution-child",
      inventoryNames: () => new Set<string>(),
      now: () => new Date("2026-09-12T10:00:00.000Z"),
    },
  );

  // Same-session prompt/decision metadata is deterministic for one raw id.
  handlers.get("permissions:ui_prompt")?.({
    requestId: "req-1",
    source: "tool_call",
    request: {},
  });
  handlers.get("permissions:decision")?.({
    requestId: "req-1",
    result: "allow",
    resolution: "user_approved",
  });
  const [prompt, decision] = envelopes;
  assert.equal(attributionOf(prompt).request, attributionOf(decision).request);
  assert.match(
    String(attributionOf(prompt).request),
    /^permission-request-[a-f0-9]{64}$/,
  );

  // Forwarded parent prompt / child decision metadata is session-scoped, so it
  // must not be treated as an Inspector cross-session join key.
  childHandlers.get("permissions:decision")?.({
    requestId: "req-1",
    result: "allow",
    resolution: "user_approved",
  });
  assert.notEqual(
    attributionOf(prompt).request,
    attributionOf(childEnvelopes[0]).request,
  );
  assert.equal(JSON.stringify(envelopes).includes("req-1"), false);
  assert.equal(JSON.stringify(childEnvelopes).includes("req-1"), false);

  registration.dispose();
  childRegistration.dispose();
});

test("repeated permissions:ready stays presence-only", () => {
  const handlers = new Map<string, (payload: unknown) => void>();
  const envelopes: unknown[] = [];
  const observed: string[] = [];
  const registration = registerLiveCounters(
    {
      events: {
        on: (channel, handler) => {
          handlers.set(channel, handler);
          return () => {};
        },
      },
      on: () => () => {},
    },
    {
      appendTelemetry: (envelope) => envelopes.push(envelope),
      flush: async () => {},
    },
    {
      sessionId: "permission-ready-repeat-session",
      root: "/inspector",
      runtimeId: "runtime-permission-ready-repeat",
      inventoryNames: () => new Set<string>(),
      now: () => new Date("2026-09-12T10:00:00.000Z"),
      markPresence: (integration) => observed.push(integration),
    },
  );

  const ready = handlers.get("permissions:ready");
  ready?.({ sessionId: "node-1" });
  ready?.({ sessionId: "node-1", additionalProducerField: true });

  assert.deepEqual(observed, ["permission", "permission"]);
  assert.equal(
    envelopes.filter(
      (envelope) =>
        (envelope as { metric: string }).metric === "permission.ready",
    ).length,
    2,
  );
  const folded = foldTelemetryCounters(envelopes);
  assert.deepEqual(folded.counters, {});
  assert.equal(folded.presence.permission, true);
  registration.dispose();
});

test("permission decisions and prompts count independently from additive fields", () => {
  const handlers = new Map<string, (payload: unknown) => void>();
  const envelopes: unknown[] = [];
  const registration = registerLiveCounters(
    {
      events: {
        on: (channel, handler) => {
          handlers.set(channel, handler);
          return () => {};
        },
      },
      on: () => () => {},
    },
    {
      appendTelemetry: (envelope) => envelopes.push(envelope),
      flush: async () => {},
    },
    {
      sessionId: "permission-independent-counts-session",
      root: "/inspector",
      runtimeId: "runtime-permission-independent-counts",
      inventoryNames: () => new Set<string>(),
      now: () => new Date("2026-09-12T10:00:00.000Z"),
    },
  );

  // One real prompt followed by its decision, plus one automatic decision that
  // has no prompt. Additional producer fields must not affect known mapping.
  handlers.get("permissions:ui_prompt")?.({
    requestId: "req-prompt",
    source: "tool_call",
    protocolVersion: 99,
    futureField: { ignored: true },
  });
  handlers.get("permissions:decision")?.({
    requestId: "req-prompt",
    result: "allow",
    resolution: "user_approved",
    protocolVersion: 99,
    futureField: { ignored: true },
  });
  handlers.get("permissions:decision")?.({
    requestId: "req-automatic",
    result: "deny",
    resolution: "policy_deny",
    futureField: "ignored",
  });

  const folded = foldTelemetryCounters(envelopes);
  assert.deepEqual(folded.counters.permission, {
    decisions: 2,
    allowed: 1,
    denied: 1,
    prompts: 1,
    promptToolCall: 1,
  });
  assert.equal(
    (folded.counters.permission?.decisions ?? 0) >
      (folded.counters.permission?.prompts ?? 0),
    true,
  );
  const serialized = JSON.stringify(envelopes);
  assert.equal(serialized.includes("protocolVersion"), false);
  assert.equal(serialized.includes("futureField"), false);
  assert.equal(serialized.includes("req-prompt"), false);
  assert.equal(serialized.includes("req-automatic"), false);
  registration.dispose();
});

test("absent or invalid request ids produce no attribution at all", () => {
  const handlers = new Map<string, (payload: unknown) => void>();
  const envelopes: Record<string, unknown>[] = [];
  registerLiveCounters(
    {
      events: {
        on: (channel, handler) => {
          handlers.set(channel, handler);
          return () => {};
        },
      },
      on: () => () => {},
    },
    {
      appendTelemetry: (envelope) => {
        envelopes.push(envelope as Record<string, unknown>);
      },
      flush: async () => {},
    },
    {
      sessionId: "permission-attribution-invalid-session",
      root: "/inspector",
      runtimeId: "runtime-permission-attribution-invalid",
      inventoryNames: () => new Set<string>(),
      now: () => new Date("2026-09-12T10:00:00.000Z"),
    },
  );

  const prompt = handlers.get("permissions:ui_prompt");
  const decision = handlers.get("permissions:decision");
  prompt?.({ source: "tool_call" });
  prompt?.({ source: "tool_call", requestId: 42 });
  prompt?.({ source: "tool_call", requestId: "" });
  prompt?.({ source: "tool_call", requestId: "bad\u0000id" });
  prompt?.({ source: "tool_call", requestId: "x".repeat(513) });
  decision?.({ result: "allow", resolution: "user_approved" });
  decision?.({ result: "allow", resolution: "user_approved", requestId: 42 });

  assert.equal(envelopes.length, 7);
  assert.equal(
    envelopes.every((envelope) => envelope.attribution === undefined),
    true,
  );
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
      return () => {};
    },
  };
  const firstEnvelopes: unknown[] = [];
  const secondEnvelopes: unknown[] = [];
  const options = {
    sessionId: "live-dedupe-session",
    root: "/inspector",
    runtimeId: "runtime-live-dedupe",
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
  assert.equal(busSubscriptions, 4);
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

type LiveBus = {
  api: {
    events: {
      on(channel: string, handler: (data: unknown) => void): () => void;
    };
    on(event: "input", handler: (event: { text: string }) => void): () => void;
  };
  emitSkill(text: string): void;
  emit(channel: string, data: unknown): void;
  inputHandlerCount(): number;
  inputHandler(): ((event: { text: string }) => void) | undefined;
  subscriptionCount(): number;
};

/** A live bus whose subscriptions can actually be removed on disposal. */
function createLiveBus(options?: { failUnsubscribe?: boolean }): LiveBus {
  const inputs: Array<(event: { text: string }) => void> = [];
  const bus = new Map<string, Array<(data: unknown) => void>>();
  const unsubscribe =
    (remove: () => void): (() => void) =>
    () => {
      if (options?.failUnsubscribe === true) {
        throw new Error("unsubscribe failed");
      }
      remove();
    };
  return {
    api: {
      events: {
        on: (channel, handler) => {
          const list = bus.get(channel) ?? [];
          list.push(handler);
          bus.set(channel, list);
          return unsubscribe(() => {
            const index = list.indexOf(handler);
            if (index >= 0) list.splice(index, 1);
          });
        },
      },
      on: (_event, handler) => {
        inputs.push(handler);
        return unsubscribe(() => {
          const index = inputs.indexOf(handler);
          if (index >= 0) inputs.splice(index, 1);
        });
      },
    },
    emitSkill: (text) => {
      for (const handler of [...inputs]) handler({ text });
    },
    emit: (channel, data) => {
      for (const handler of [...(bus.get(channel) ?? [])]) handler(data);
    },
    inputHandlerCount: () => inputs.length,
    inputHandler: () => inputs[0],
    subscriptionCount: () =>
      inputs.length +
      [...bus.values()].reduce((total, list) => total + list.length, 0),
  };
}

const liveWriter = (
  sink: unknown[],
): { appendTelemetry(envelope: unknown): void; flush(): Promise<void> } => ({
  appendTelemetry: (envelope) => sink.push(envelope),
  flush: async () => {},
});

const runtimeOptions = (
  runtimeId: string,
): {
  root: string;
  sessionId: string;
  runtimeId: string;
  inventoryNames(): ReadonlySet<string>;
  now(): Date;
} => ({
  root: "/inspector",
  sessionId: "runtime-session",
  runtimeId,
  inventoryNames: () => new Set(["council-mode"]),
  now: () => new Date("2026-09-11T10:00:00Z"),
});

test("a registration owned by a replaced runtime is disposed, never reused", () => {
  const bus = createLiveBus();
  const replaced: unknown[] = [];
  const resumed: unknown[] = [];

  const first = registerLiveCounters(
    bus.api,
    liveWriter(replaced),
    runtimeOptions("runtime-1"),
  );
  const firstHandler = bus.inputHandler();
  bus.emitSkill("/skill:council-mode");
  bus.emit("permissions:decision", {
    result: "deny",
    resolution: "policy_deny",
  });
  assert.equal(replaced.length, 2);
  const subscriptions = bus.subscriptionCount();

  // Same live api, new runtime: the previous runtime's listeners cannot observe
  // this runtime, so its registration must be disposed instead of returned.
  const second = registerLiveCounters(
    bus.api,
    liveWriter(resumed),
    runtimeOptions("runtime-2"),
  );
  assert.notEqual(second, first);
  assert.notEqual(bus.inputHandler(), firstHandler);
  assert.equal(bus.inputHandlerCount(), 1);
  assert.equal(bus.subscriptionCount(), subscriptions);

  bus.emitSkill("/skill:council-mode");
  bus.emit("permissions:decision", {
    result: "allow",
    resolution: "user_approved",
  });
  assert.equal(
    replaced.length,
    2,
    "a replaced runtime must not receive events",
  );
  assert.equal(
    resumed.length,
    2,
    "the resumed runtime must receive exactly one envelope per event",
  );

  // Duplicate prevention inside one runtime is unchanged: a repeated
  // registration returns the same registration and adds no subscriptions.
  assert.equal(
    registerLiveCounters(
      bus.api,
      liveWriter(resumed),
      runtimeOptions("runtime-2"),
    ),
    second,
  );
  assert.equal(bus.inputHandlerCount(), 1);
});

test("identity separates the same session id under two roots", () => {
  const bus = createLiveBus();
  const firstRoot: unknown[] = [];
  const secondRoot: unknown[] = [];

  const first = registerLiveCounters(bus.api, liveWriter(firstRoot), {
    ...runtimeOptions("runtime-1"),
    root: "/inspector-one",
  });
  const second = registerLiveCounters(bus.api, liveWriter(secondRoot), {
    ...runtimeOptions("runtime-1"),
    root: "/inspector-two",
  });
  assert.notEqual(first, second);
  assert.equal(bus.inputHandlerCount(), 2);

  bus.emitSkill("/skill:council-mode");
  assert.equal(firstRoot.length, 1);
  assert.equal(secondRoot.length, 1);
});

test("dispose is idempotent and a failing unsubscribe stays observer-only", () => {
  const failing = createLiveBus({ failUnsubscribe: true });
  const sink: unknown[] = [];
  const registration = registerLiveCounters(
    failing.api,
    liveWriter(sink),
    runtimeOptions("runtime-1"),
  );

  assert.doesNotThrow(() => registration.dispose());
  assert.doesNotThrow(() => registration.dispose());

  const next = createLiveBus();
  const nextSink: unknown[] = [];
  registerLiveCounters(
    next.api,
    liveWriter(nextSink),
    runtimeOptions("runtime-2"),
  );
  next.emitSkill("/skill:council-mode");
  assert.equal(nextSink.length, 1);
});

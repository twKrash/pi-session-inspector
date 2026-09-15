import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  IntegrationAdapter,
  IntegrationEvidence,
  IntegrationRegistration,
} from "../../src/integrations/contract.ts";
import { createIntegrationRegistry } from "../../src/integrations/registry.ts";

/** Minimal counter-shaped adapter; every test overrides only what it asserts. */
function adapter(
  key: string,
  order: number,
  overrides: Partial<IntegrationAdapter> = {},
): IntegrationAdapter {
  return {
    key,
    order,
    schemas: { 1: { counters: ["calls"] } },
    ...overrides,
  };
}

test("rejects a duplicate integration key", () => {
  assert.throws(
    () => createIntegrationRegistry([adapter("alpha", 1), adapter("alpha", 2)]),
    /duplicate integration key: alpha/,
  );
});

test("rejects a duplicate report order", () => {
  assert.throws(
    () => createIntegrationRegistry([adapter("alpha", 1), adapter("beta", 1)]),
    /duplicate integration order: 1/,
  );
});

test("rejects a malformed key, order, or schema", () => {
  for (const key of ["", "Alpha", "al pha", "a".repeat(33), "__proto__"]) {
    assert.throws(
      () => createIntegrationRegistry([adapter(key, 1)]),
      /invalid integration key/,
      key,
    );
  }
  for (const order of [-1, 1.5, Number.NaN]) {
    assert.throws(
      () => createIntegrationRegistry([adapter("alpha", order)]),
      /invalid integration order/,
      String(order),
    );
  }
  assert.throws(
    () => createIntegrationRegistry([adapter("alpha", 1, { schemas: {} })]),
    /needs at least one schema version/,
  );
  for (const version of [0, -1, 1.5]) {
    assert.throws(
      () =>
        createIntegrationRegistry([
          adapter("alpha", 1, {
            schemas: { [version]: { counters: ["calls"] } },
          }),
        ]),
      /invalid schema version/,
      String(version),
    );
  }
  assert.throws(
    () =>
      createIntegrationRegistry([
        adapter("alpha", 1, {
          schemas: { 1: { counters: ["calls", "calls"] } },
        }),
      ]),
    /duplicate counter: calls/,
  );
  assert.throws(
    () =>
      createIntegrationRegistry([
        adapter("alpha", 1, { schemas: { 1: { counters: ["cal ls"] } } }),
      ]),
    /invalid counter name/,
  );
});

test("rejects an alias that collides with a key or another alias", () => {
  assert.throws(
    () =>
      createIntegrationRegistry([
        adapter("alpha", 1, { aliases: ["beta"] }),
        adapter("beta", 2),
      ]),
    /alias collides with an integration key: beta/,
  );
  assert.throws(
    () =>
      createIntegrationRegistry([
        adapter("alpha", 1, { aliases: ["a"] }),
        adapter("beta", 2, { aliases: ["a"] }),
      ]),
    /duplicate integration alias: a/,
  );
});

test("derives keys, order, and lookup deterministically", () => {
  const registry = createIntegrationRegistry([
    adapter("gamma", 30),
    adapter("alpha", 10, { aliases: ["a"] }),
    adapter("beta", 20, {
      legacyOnly: true,
      schemas: { 1: { counters: ["x"] } },
    }),
  ]);

  // Declaration order never determines report order.
  assert.deepEqual(registry.keys, ["alpha", "gamma"]);
  assert.deepEqual(registry.rowKeys, ["alpha", "beta", "gamma"]);
  assert.equal(registry.has("beta"), true);
  assert.equal(registry.has("delta"), false);
  assert.equal(registry.resolveAlias("a"), "alpha");
  assert.equal(registry.resolveAlias("alpha"), "alpha");
  assert.equal(registry.resolveAlias("__proto__"), undefined);
  assert.equal(registry.resolveAlias("constructor"), undefined);
});

test("counter and version validation comes from adapter metadata", () => {
  const registry = createIntegrationRegistry([
    adapter("alpha", 1, {
      schemas: {
        1: { counters: ["calls"] },
        2: { counters: ["calls", "tokens"] },
      },
    }),
  ]);

  assert.equal(registry.isKnownVersion("alpha", 1), true);
  assert.equal(registry.isKnownVersion("alpha", 2), true);
  assert.equal(registry.isKnownVersion("alpha", 3), false);
  assert.equal(registry.isKnownVersion("beta", 1), false);
  assert.equal(registry.isAllowedCounter("alpha", 1, "calls"), true);
  assert.equal(registry.isAllowedCounter("alpha", 1, "tokens"), false);
  assert.equal(registry.isAllowedCounter("alpha", 2, "tokens"), true);
  assert.equal(registry.isAllowedCounter("alpha", 3, "calls"), false);
  assert.equal(registry.primaryVersion("alpha"), 1);
  assert.equal(registry.primaryVersion("beta"), undefined);
});

test("presence defaults derive from registry membership", () => {
  const registry = createIntegrationRegistry([
    adapter("alpha", 1, {
      detectPresence: ({ tools }) =>
        tools.includes("alpha") ? "present" : "absent",
    }),
    // No presence capability: the key still gets an explicit row.
    adapter("beta", 2),
  ]);

  const available = registry.readPresence({
    extensionCommands: [],
    tools: ["alpha"],
    observed: [],
    inventoryAvailable: true,
  });
  assert.deepEqual(available.presence, { alpha: "present", beta: "unknown" });
  assert.deepEqual(available.reasons, {
    alpha: "inventory-signal",
    beta: "not-observed",
  });

  // Absence is only reported when the inventory itself is readable.
  const unavailable = registry.readPresence({
    extensionCommands: [],
    tools: [],
    observed: [],
    inventoryAvailable: false,
  });
  assert.deepEqual(unavailable.presence, { alpha: "unknown", beta: "unknown" });
});

test("one failing adapter never breaks another", async () => {
  const registry = createIntegrationRegistry([
    adapter("alpha", 1, {
      detectPresence: () => {
        throw new Error("presence failed");
      },
      readPersistedEvidence: () => {
        throw new Error("evidence failed");
      },
      registerLive: () => {
        throw new Error("registration failed");
      },
      foldTelemetry: () => {
        throw new Error("fold failed");
      },
      contributeCanonical: () => {
        throw new Error("contribution failed");
      },
    }),
    adapter("beta", 2, {
      detectPresence: () => "present",
      readPersistedEvidence: () => evidence("beta", { calls: 3 }),
      registerLive: () => ({ dispose: () => {} }),
      foldTelemetry: () => ({ counters: { calls: 1 } }),
      contributeCanonical: () => ({ state: "supported" }),
    }),
  ]);

  const presence = registry.readPresence({
    extensionCommands: [],
    tools: [],
    observed: [],
    inventoryAvailable: true,
  });
  assert.deepEqual(presence.presence, { alpha: "unknown", beta: "present" });
  assert.equal(presence.reasons.alpha, "presence-failed");
  assert.equal(presence.reasons.beta, "inventory-signal");

  const persisted = registry.readPersistedEvidence({ entries: [] });
  assert.deepEqual(
    persisted.rows.map((row) => row.integration),
    ["beta"],
  );
  assert.equal(persisted.reasons.alpha, "evidence-failed");

  const live = registry.registerLive(liveContext());
  // The throwing registration is counted; the healthy one is still registered.
  assert.equal(live.failures(), 1);
  live.dispose();

  assert.deepEqual(registry.foldTelemetry(permissionEnvelope()), {
    integration: "beta",
    counters: { calls: 1 },
  });
  assert.deepEqual(
    await registry.contributeCanonical({ entries: [], sessionId: "s" }),
    {
      contributions: { beta: { state: "supported" } },
      reasons: { alpha: "contribution-failed" },
    },
  );
});

test("a failing telemetry fold yields no counters, never a partial one", () => {
  const registry = createIntegrationRegistry([
    adapter("alpha", 1, {
      foldTelemetry: () => {
        throw new Error("fold failed");
      },
    }),
  ]);
  assert.equal(registry.foldTelemetry(permissionEnvelope()), undefined);
});

test("live registrations are disposed exactly once", () => {
  const disposed: string[] = [];
  const registry = createIntegrationRegistry([
    adapter("alpha", 1, {
      registerLive: () => ({
        dispose: () => void disposed.push("alpha"),
      }),
    }),
    adapter("beta", 2, {
      registerLive: () => ({
        dispose: () => {
          disposed.push("beta");
          throw new Error("disposal failed");
        },
      }),
    }),
    adapter("gamma", 3, {
      registerLive: () => {
        throw new Error("registration failed");
      },
    }),
  ]);

  const registration = registry.registerLive(liveContext());
  assert.equal(registration.failures(), 1);
  registration.dispose();
  registration.dispose();
  assert.deepEqual(disposed.sort(), ["alpha", "beta"]);
});

test("persisted evidence rows keep report order and bounded reasons", () => {
  const registry = createIntegrationRegistry([
    adapter("beta", 2, {
      readPersistedEvidence: () => ({
        integration: "beta",
        state: "unsupported",
        version: 9,
        reason: "unsupported-schema",
      }),
    }),
    adapter("alpha", 1, {
      readPersistedEvidence: () => evidence("alpha", { calls: 2 }),
    }),
  ]);

  const result = registry.readPersistedEvidence({ entries: [] });
  assert.deepEqual(result.rows, [
    {
      integration: "alpha",
      version: 1,
      state: "supported",
      counters: { calls: 2 },
    },
    { integration: "beta", version: 9, state: "unsupported" },
  ]);
  assert.deepEqual(result.reasons, {
    alpha: "evidence-supported",
    beta: "unsupported-schema",
  });
});

test("evidence returned for the wrong key is dropped, and an undeclared version is reported", () => {
  const registry = createIntegrationRegistry([
    adapter("alpha", 1, {
      readPersistedEvidence: () =>
        evidence("beta", { calls: 1 }) as IntegrationEvidence,
    }),
    adapter("beta", 2, {
      readPersistedEvidence: () =>
        evidence("beta", { calls: 1 }, 7) as IntegrationEvidence,
    }),
  ]);

  const result = registry.readPersistedEvidence({ entries: [] });
  assert.deepEqual(result.rows, [
    { integration: "beta", version: 7, state: "unsupported" },
  ]);
  assert.deepEqual(result.reasons, {
    alpha: "malformed-evidence",
    beta: "unsupported-schema",
  });
});

test("a live observation keyed by integration wins over an inventory signal", () => {
  const registry = createIntegrationRegistry([
    adapter("alpha", 1, {
      detectPresence: () => "absent",
    }),
    adapter("beta", 2),
  ]);

  const rows = registry.readPresence({
    extensionCommands: [],
    tools: [],
    observed: ["alpha", "beta"],
    inventoryAvailable: true,
  });
  assert.deepEqual(rows.presence, { alpha: "present", beta: "present" });
  assert.deepEqual(rows.reasons, {
    alpha: "live-signal",
    beta: "live-signal",
  });
});

test("an applied telemetry fold carries the registry key that produced it", () => {
  const registry = createIntegrationRegistry([
    adapter("alpha", 1, {
      foldTelemetry: (envelope) =>
        (envelope as { metric?: unknown }).metric === "alpha.calls"
          ? { counters: { calls: 2 } }
          : undefined,
    }),
    adapter("beta", 2, {
      foldTelemetry: (envelope) =>
        (envelope as { metric?: unknown }).metric === "beta.ready"
          ? { presence: true }
          : undefined,
    }),
  ]);

  assert.deepEqual(registry.foldTelemetry({ metric: "alpha.calls" }), {
    integration: "alpha",
    counters: { calls: 2 },
  });
  assert.deepEqual(registry.foldTelemetry({ metric: "beta.ready" }), {
    integration: "beta",
    presence: true,
  });
  assert.equal(registry.foldTelemetry({ metric: "other" }), undefined);
});

test("a legacy-only key validates rows but never resolves as a report key", () => {
  const registry = createIntegrationRegistry([
    adapter("alpha", 1, { aliases: ["a"] }),
    adapter("mode", 2, { legacyOnly: true }),
  ]);

  assert.deepEqual(registry.keys, ["alpha"]);
  assert.deepEqual(registry.rowKeys, ["alpha", "mode"]);
  assert.equal(registry.has("mode"), true);
  assert.equal(registry.resolveAlias("mode"), undefined);
  assert.equal(registry.resolveAlias("alpha"), "alpha");
  assert.equal(registry.resolveAlias("a"), "alpha");
});

test("a legacy-only adapter cannot own an alias", () => {
  assert.throws(
    () =>
      createIntegrationRegistry([
        adapter("alpha", 1),
        adapter("mode", 2, { legacyOnly: true, aliases: ["m"] }),
      ]),
    /legacy-only integration cannot own an alias: m/,
  );
});

function evidence(
  integration: string,
  counters: Record<string, number>,
  version = 1,
): IntegrationEvidence {
  return {
    integration,
    state: "supported",
    version,
    counters,
    reason: "evidence-supported",
  };
}

function liveContext() {
  return {
    api: { events: { on: () => () => {} }, on: () => () => {} },
    appendTelemetry: () => {},
    sessionId: "session-1",
    now: () => new Date("2026-09-15T00:00:00.000Z"),
    inventoryNames: () => new Set<string>(),
    markPresence: () => {},
  };
}

function permissionEnvelope() {
  return {
    schemaVersion: 1,
    source: "permission-system",
    metric: "permission.decision",
    kind: "counter",
    value: 1,
    dimensions: { result: "allow", resolution: "policy_allow" },
    timestamp: 0,
  };
}

export type { IntegrationRegistration };

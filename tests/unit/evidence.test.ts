import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createEvidenceRegistry,
  type EvidenceAdapter,
  type EvidenceRegistry,
} from "../../src/integrations/evidence.ts";
import type { AgentRun } from "../../src/core/events.ts";

function registry(): EvidenceRegistry {
  return createEvidenceRegistry([
    {
      integration: "context",
      version: 1,
      read: (value) =>
        typeof value.calls === "number"
          ? { counters: { calls: value.calls } }
          : {},
    },
  ]);
}

test("reads only registered versions and bounded counters", () => {
  const evidence = registry();

  assert.equal(
    evidence.read({ integration: "ctx", version: 1, value: {} }).state,
    "supported",
  );
  assert.equal(
    evidence.read({ integration: "ctx", version: 99, value: {} }).state,
    "unsupported",
  );
  assert.equal(evidence.read(undefined).state, "unavailable");
  assert.equal(
    evidence.read({ integration: "ctx", version: 1, value: { raw: "secret" } })
      .state,
    "unsupported",
  );
});

test("rejects hidden, symbol, and accessor local evidence without reading it", () => {
  const hidden = Object.create(null, {
    calls: { enumerable: true, value: 1 },
    raw: { enumerable: false, value: "secret" },
  });
  const symbol = Symbol("secret");
  const symbolic = { calls: 1, [symbol]: "secret" };
  const accessor = Object.create(null, {
    raw: { enumerable: true, get: () => "secret" },
  });

  for (const value of [hidden, symbolic, accessor]) {
    assert.deepEqual(
      registry().read({ integration: "context", version: 1, value }),
      {
        state: "unsupported",
        diagnostic: "invalid-evidence",
      },
    );
  }
});

test("materializes proxy evidence descriptors once before validation", () => {
  let descriptorReads = 0;
  let observedValue: Readonly<Record<string, number | boolean>> | undefined;
  const value = new Proxy(
    {},
    {
      ownKeys: () => ["calls"],
      getOwnPropertyDescriptor: () => {
        descriptorReads += 1;
        return {
          configurable: true,
          enumerable: true,
          value: descriptorReads === 1 ? 1 : 99,
        };
      },
    },
  );
  const evidence = createEvidenceRegistry([
    {
      integration: "context",
      version: 1,
      read: (adapterValue) => {
        observedValue = adapterValue;
        return { counters: adapterValue };
      },
    },
  ]);

  assert.deepEqual(
    evidence.read({ integration: "context", version: 1, value }),
    {
      integration: "context",
      version: 1,
      state: "supported",
      counters: { calls: 1 },
    },
  );
  assert.equal(descriptorReads, 1);
  assert.equal(Object.isFrozen(observedValue), true);
});

test("snapshots validated adapter counters", () => {
  const counters = { calls: 2 };
  const evidence = createEvidenceRegistry([
    {
      integration: "context",
      version: 1,
      read: () => ({ counters }),
    },
  ]);

  const result = evidence.read({
    integration: "context",
    version: 1,
    value: {},
  });
  counters.calls = 99;

  assert.deepEqual(result, {
    integration: "context",
    version: 1,
    state: "supported",
    counters: { calls: 2 },
  });
});

test("rejects prototype-member integration names as invalid evidence", () => {
  for (const integration of [
    "__proto__",
    "constructor",
    "toString",
    "hasOwnProperty",
  ]) {
    assert.deepEqual(registry().read({ integration, version: 1, value: {} }), {
      state: "unsupported",
      diagnostic: "invalid-evidence",
    });
  }
});

test("rejects malformed adapter output with a fixed diagnostic", () => {
  const hiddenOutput = Object.create(null, {
    counters: { enumerable: true, value: { calls: 1 } },
    raw: { enumerable: false, value: "secret" },
  });
  const symbolOutput = { [Symbol("secret")]: true };
  const accessorOutput = Object.create(null, {
    counters: { enumerable: true, get: () => ({ calls: 1 }) },
  });

  for (const output of [
    null,
    false,
    0,
    [],
    new Date(),
    hiddenOutput,
    symbolOutput,
    accessorOutput,
  ]) {
    const adapter: EvidenceAdapter = {
      integration: "context",
      version: 1,
      read: () => output as never,
    };

    assert.deepEqual(
      createEvidenceRegistry([adapter]).read({
        integration: "context",
        version: 1,
        value: {},
      }),
      { state: "unsupported", diagnostic: "adapter-rejected" },
    );
  }
});

test("rejects adapter counters outside its integration version allowlist", () => {
  const evidence = createEvidenceRegistry([
    {
      integration: "context",
      version: 1,
      read: () => ({ counters: { token: 1 } }),
    },
  ]);

  assert.deepEqual(
    evidence.read({ integration: "context", version: 1, value: {} }),
    { state: "unsupported", diagnostic: "adapter-rejected" },
  );
});

test("uses canonical cooperative confidence for agent runs", () => {
  const agentRun = {
    id: "child-1",
    status: "succeeded",
    confidence: "cooperative",
  } satisfies AgentRun;

  assert.equal(agentRun.confidence, "cooperative");
});

test("keeps only finite numeric counters and fixed diagnostic codes", () => {
  const result = registry().read({
    integration: "context",
    version: 1,
    value: { calls: 2 },
  });

  assert.deepEqual(result, {
    integration: "context",
    version: 1,
    state: "supported",
    counters: { calls: 2 },
  });
  assert.deepEqual(registry().read("private text"), {
    state: "unsupported",
    diagnostic: "invalid-evidence",
  });
});

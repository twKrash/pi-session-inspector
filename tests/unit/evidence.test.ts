import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createEvidenceRegistry,
  type EvidenceRegistry,
} from "../../src/integrations/evidence.ts";

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

test("rejects hostile local evidence without reading an accessor", () => {
  const value = Object.create(null, {
    raw: { enumerable: true, get: () => "secret" },
  });

  assert.deepEqual(
    registry().read({ integration: "context", version: 1, value }),
    {
      state: "unsupported",
      diagnostic: "invalid-evidence",
    },
  );
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

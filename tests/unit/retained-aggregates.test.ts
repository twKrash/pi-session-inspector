import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRetainedAggregates } from "../../src/core/retained-aggregates.ts";

test("folded prefix and retained suffix are disjoint and labelled", () => {
  const aggregates = buildRetainedAggregates({
    sessionId: "s1",
    checkpoint: {
      aggregates: {
        skillInvocations: { alpha: 4 },
        skillOverflowInvocations: 1,
        integrationCounters: { permission: { decisions: 2 } },
        presence: { permission: true },
      },
      cursors: {
        pi: { lineCount: 0, revision: "0".repeat(64) },
        wal: { "w-1": 2 },
      },
      sealedWal: { "w-1": 2 },
      evidence: { checkpointedAt: "2026-09-12T10:00:00.000Z" },
    },
    retained: {
      skillNames: ["alpha", "beta"],
      counters: { permission: { decisions: 1 } },
      permissionPresence: false,
    },
  });
  // Null-prototype canonical maps: normalize before comparing to a literal.
  assert.deepEqual(
    { ...aggregates.skillInvocations?.named?.value },
    {
      alpha: 4,
      beta: 1,
    },
  );
  assert.equal(aggregates.skillInvocations?.named?.state, "aggregate-only");
  assert.deepEqual({ ...aggregates.boundary.foldedThrough }, { "w-1": 2 });
  assert.deepEqual({ ...aggregates.boundary.sealedThrough }, { "w-1": 2 });
  assert.equal(aggregates.permissionPresence?.value, true);
  assert.equal(aggregates.integration?.permission?.value.decisions, 3);
});

test("no checkpoint yields no synthetic aggregate values", () => {
  const aggregates = buildRetainedAggregates({
    sessionId: "s1",
    checkpoint: undefined,
    retained: { skillNames: [], counters: {}, permissionPresence: false },
  });
  assert.equal(aggregates.skillInvocations, undefined);
  assert.equal(aggregates.boundary.detail, "expired");
});

test("a __proto__ writer id survives the canonical boundary", () => {
  // `__proto__` is a legal writer token; the cursor copy must keep it as an own
  // key on both boundary maps instead of dropping it via the inherited setter.
  const aggregates = buildRetainedAggregates({
    sessionId: "s1",
    checkpoint: {
      aggregates: { presence: { permission: true } },
      cursors: { wal: { ["__proto__"]: 3 } },
      sealedWal: { ["__proto__"]: 3 },
      evidence: { checkpointedAt: "2026-09-12T10:00:00.000Z" },
    },
    retained: { skillNames: [], counters: {}, permissionPresence: false },
  });

  assert.equal(
    Object.hasOwn(aggregates.boundary.foldedThrough, "__proto__"),
    true,
  );
  assert.equal(aggregates.boundary.foldedThrough["__proto__"], 3);
  assert.equal(
    Object.hasOwn(aggregates.boundary.sealedThrough, "__proto__"),
    true,
  );
  assert.equal(aggregates.boundary.sealedThrough["__proto__"], 3);
  assert.equal(aggregates.boundary.detail, "aggregate-only");
});

test("boundary inconsistency is rejected, never repaired", () => {
  assert.throws(() =>
    buildRetainedAggregates({
      sessionId: "s1",
      checkpoint: {
        cursors: { wal: { "w-1": 9 } },
        sealedWal: {},
        aggregates: {},
      },
      retained: {
        skillNames: [],
        counters: {},
        permissionPresence: false,
        lastSequence: { "w-1": 3 },
      },
    }),
  );
});

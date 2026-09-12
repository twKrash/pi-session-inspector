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
  assert.deepEqual(aggregates.skillInvocations?.named?.value, {
    alpha: 4,
    beta: 1,
  });
  assert.equal(aggregates.skillInvocations?.named?.state, "aggregate-only");
  assert.deepEqual(aggregates.boundary.foldedThrough, { "w-1": 2 });
  assert.deepEqual(aggregates.boundary.sealedThrough, { "w-1": 2 });
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

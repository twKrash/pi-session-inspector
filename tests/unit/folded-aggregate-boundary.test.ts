import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRetainedAggregates } from "../../src/core/retained-aggregates.ts";

test("detail is full only when no folded or pruned contribution exists", () => {
  const aggregates = buildRetainedAggregates({
    sessionId: "s1",
    checkpoint: {
      aggregates: {},
      cursors: { wal: {} },
      sealedWal: {},
      evidence: {},
    },
    retained: {
      skillNames: ["alpha"],
      counters: { permission: { decisions: 1 } },
      permissionPresence: true,
    },
  });
  assert.equal(aggregates.boundary.detail, "full");
  // Without a folded prefix there is no aggregate-only survivor, so every
  // value is omitted instead of being reported as a fabricated zero.
  assert.equal(aggregates.integration, undefined);
  assert.equal(aggregates.skillInvocations, undefined);
  assert.equal(aggregates.permissionPresence, undefined);
});

test("sealed streams without folded counts stay aggregate-only, never zero", () => {
  const aggregates = buildRetainedAggregates({
    sessionId: "s1",
    checkpoint: {
      aggregates: {},
      cursors: { wal: { "w-1": 5 } },
      sealedWal: { "w-1": 5 },
      evidence: {},
    },
    retained: { skillNames: [], counters: {}, permissionPresence: false },
  });
  assert.equal(aggregates.boundary.detail, "aggregate-only");
  assert.equal(aggregates.integration, undefined);
  assert.equal(aggregates.skillInvocations, undefined);
  assert.deepEqual(aggregates.boundary.foldedThrough, { "w-1": 5 });
  assert.deepEqual(aggregates.boundary.sealedThrough, { "w-1": 5 });
});

test("cursor ahead of the retained sequence needs a matching seal", () => {
  const accepted = buildRetainedAggregates({
    sessionId: "s1",
    checkpoint: {
      aggregates: { presence: { permission: true } },
      cursors: { wal: { "w-1": 5 } },
      sealedWal: { "w-1": 5 },
      evidence: {},
    },
    retained: {
      skillNames: [],
      counters: {},
      permissionPresence: false,
      lastSequence: { "w-1": 3 },
    },
  });
  assert.equal(accepted.permissionPresence?.value, true);

  assert.throws(
    () =>
      buildRetainedAggregates({
        sessionId: "s1",
        checkpoint: {
          aggregates: { presence: { permission: true } },
          cursors: { wal: { "w-1": 5 } },
          sealedWal: {},
          evidence: {},
        },
        retained: {
          skillNames: [],
          counters: {},
          permissionPresence: false,
          lastSequence: { "w-1": 3 },
        },
      }),
    /boundary inconsistent/,
  );
});

test("cursor within the retained sequence is accepted without a seal", () => {
  const aggregates = buildRetainedAggregates({
    sessionId: "s1",
    checkpoint: {
      aggregates: { presence: { permission: true } },
      cursors: { wal: { "w-1": 2 } },
      sealedWal: {},
      evidence: {},
    },
    retained: {
      skillNames: [],
      counters: {},
      permissionPresence: false,
      lastSequence: { "w-1": 3 },
    },
  });
  assert.equal(aggregates.permissionPresence?.value, true);
});

test("integration counters sum disjointly and drop hostile keys", () => {
  const aggregates = buildRetainedAggregates({
    sessionId: "s1",
    checkpoint: {
      aggregates: {
        integrationCounters: {
          permission: { decisions: 2, allowed: 2 },
          rtk: { calls: 1 },
          "../etc": { calls: 9 },
        },
      },
      cursors: { wal: {} },
      sealedWal: {},
      evidence: {},
    },
    retained: {
      skillNames: [],
      counters: {
        permission: { decisions: 1, denied: 1 },
        rtk: { calls: 2, "bad key": 3 },
      },
      permissionPresence: false,
    },
  });
  assert.deepEqual(aggregates.integration?.permission?.value, {
    decisions: 3,
    allowed: 2,
    denied: 1,
  });
  assert.deepEqual(aggregates.integration?.rtk?.value, { calls: 3 });
  assert.equal(Object.hasOwn(aggregates.integration ?? {}, "../etc"), false);
});

test("named skills keep the folded prefix and add only new retained names", () => {
  const aggregates = buildRetainedAggregates({
    sessionId: "s1",
    checkpoint: {
      aggregates: {
        skillInvocations: { alpha: 4 },
        skillOverflowInvocations: 1,
      },
      cursors: { wal: {} },
      sealedWal: {},
      evidence: {},
    },
    retained: {
      skillNames: ["alpha", "beta", "beta", "../etc"],
      counters: {},
      permissionPresence: false,
    },
  });
  assert.deepEqual(aggregates.skillInvocations?.named?.value, {
    alpha: 4,
    beta: 2,
  });
  assert.equal(aggregates.skillInvocations?.overflow?.value, 1);
});

test("aggregate values carry only the boundary, never an event time", () => {
  const aggregates = buildRetainedAggregates({
    sessionId: "s1",
    checkpoint: {
      aggregates: { skillInvocations: { alpha: 4 } },
      cursors: { wal: { "w-1": 2 } },
      sealedWal: { "w-1": 2 },
      evidence: { checkpointedAt: "2026-09-12T10:00:00.000Z" },
    },
    retained: {
      skillNames: ["beta"],
      counters: {},
      permissionPresence: false,
    },
  });
  const named = aggregates.skillInvocations?.named;
  assert.deepEqual(Object.keys(named ?? {}).sort(), [
    "boundary",
    "state",
    "value",
  ]);
  assert.deepEqual(named?.boundary.foldedThrough, { "w-1": 2 });
  assert.deepEqual(named?.boundary.sealedThrough, { "w-1": 2 });
  assert.equal(JSON.stringify(named).includes("observedAt"), false);
  assert.equal(JSON.stringify(aggregates).includes("../etc"), false);
});

test("checkpoint evidence supplies checkpointedAt and expiration boundary", () => {
  const withEvidence = buildRetainedAggregates({
    sessionId: "s1",
    checkpoint: {
      aggregates: { presence: { permission: true } },
      cursors: { wal: {} },
      sealedWal: {},
      evidence: {
        checkpointedAt: "2026-09-12T10:00:00.000Z",
        detailCoverage: { walDetailExpiredBefore: "2026-09-12T09:00:00.000Z" },
      },
    },
    retained: { skillNames: [], counters: {}, permissionPresence: false },
  });
  assert.deepEqual(withEvidence.boundary.checkpointedAt, {
    state: "known",
    at: "2026-09-12T10:00:00.000Z",
    basis: "checkpoint-observer",
  });
  assert.equal(
    withEvidence.boundary.detailExpiredBefore,
    "2026-09-12T09:00:00.000Z",
  );

  const withoutEvidence = buildRetainedAggregates({
    sessionId: "s1",
    checkpoint: {
      aggregates: { presence: { permission: true } },
      cursors: { wal: {} },
      sealedWal: {},
    },
    retained: { skillNames: [], counters: {}, permissionPresence: false },
  });
  assert.deepEqual(withoutEvidence.boundary.checkpointedAt, {
    state: "unavailable",
  });
  assert.equal(withoutEvidence.boundary.detailExpiredBefore, undefined);
});

test("resource counts surface as aggregate-only with last observation time", () => {
  const observed = buildRetainedAggregates({
    sessionId: "s1",
    checkpoint: {
      aggregates: {
        resourceCounts: {
          commands: 3,
          skills: 2,
          observedAt: "2026-09-12T12:00:00.000Z",
        },
      },
      cursors: { wal: {} },
      sealedWal: {},
      evidence: {},
    },
    retained: { skillNames: [], counters: {}, permissionPresence: false },
  });
  assert.equal(observed.resources?.state, "aggregate-only");
  assert.deepEqual(observed.resources?.counts, { commands: 3, skills: 2 });
  assert.deepEqual(observed.resources?.observedAt, {
    state: "known",
    at: "2026-09-12T12:00:00.000Z",
    basis: "inventory-observer",
  });

  const unobserved = buildRetainedAggregates({
    sessionId: "s1",
    checkpoint: {
      aggregates: { resourceCounts: { commands: 3, skills: 2 } },
      cursors: { wal: {} },
      sealedWal: {},
      evidence: {},
    },
    retained: { skillNames: [], counters: {}, permissionPresence: false },
  });
  assert.deepEqual(unobserved.resources?.observedAt, { state: "unavailable" });
});

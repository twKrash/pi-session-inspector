import assert from "node:assert/strict";
import { test } from "node:test";
import {
  emptyFoldedCounters,
  foldTelemetryCounters,
  MAX_SKILL_KEYS,
  mergeFoldedCounters,
} from "../../src/core/live-counter-fold.ts";

const envelope = (over: Record<string, unknown>) => ({
  schemaVersion: 1,
  source: "permission-system",
  metric: "permission.decision",
  kind: "counter",
  value: 1,
  ...over,
});

test("folds allowlisted permission counters and ignores unknown metrics", () => {
  const folded = foldTelemetryCounters([
    envelope({ dimensions: { result: "allow", resolution: "policy_allow" } }),
    envelope({ dimensions: { result: "deny", resolution: "user_denied" } }),
    envelope({ dimensions: { result: "deny", resolution: "gate_error" } }),
    envelope({ metric: "unknown.metric", dimensions: { result: "allow" } }),
    envelope({ kind: "gauge", dimensions: { result: "allow" } }),
  ]);

  assert.deepEqual(folded.counters.permission, {
    decisions: 3,
    allowed: 1,
    denied: 2,
    gateErrors: 1,
  });
});

test("folds skill invocations by validated name and counts overflow exactly", () => {
  const rows = Array.from({ length: MAX_SKILL_KEYS + 3 }, (_, index) =>
    envelope({
      source: "pi-input",
      metric: "skill.invocation",
      dimensions: { skill: `skill-${index}` },
    }),
  );
  const folded = foldTelemetryCounters(rows);

  assert.equal(Object.keys(folded.skillInvocations).length, MAX_SKILL_KEYS);
  assert.equal(folded.otherInvocations, 3);

  // Incremental fold: an omitted key keeps counting exactly, and repeated folds add once per event.
  const resumed = foldTelemetryCounters(
    rows.slice(0, MAX_SKILL_KEYS + 1),
    folded,
  );
  assert.equal(resumed.otherInvocations, 4);
  assert.equal(Object.keys(resumed.skillInvocations).length, MAX_SKILL_KEYS);

  const bogus = foldTelemetryCounters([
    envelope({
      source: "pi-input",
      metric: "skill.invocation",
      dimensions: { skill: "/etc/passwd" },
    }),
    envelope({
      source: "pi-input",
      metric: "skill.invocation",
      dimensions: { skill: "" },
    }),
  ]);
  assert.deepEqual(bogus.skillInvocations, {});
  assert.equal(bogus.otherInvocations, 0);
});

test("records durable permission presence without inventing counters", () => {
  const folded = foldTelemetryCounters([
    envelope({ metric: "permission.ready", dimensions: undefined }),
    envelope({ dimensions: { result: "allow", resolution: "policy_allow" } }),
  ]);

  assert.equal(folded.presence.permission, true);
  assert.deepEqual(folded.counters.permission, { decisions: 1, allowed: 1 });

  const merged = mergeFoldedCounters(undefined, folded);
  assert.equal(merged.presence.permission, true);
  assert.deepEqual(merged.counters.permission, { decisions: 1, allowed: 1 });
});

test("merges checkpoint and delta buckets by integer addition", () => {
  const checkpoint = foldTelemetryCounters([
    envelope({ dimensions: { result: "allow", resolution: "policy_allow" } }),
    envelope({
      source: "pi-input",
      metric: "skill.invocation",
      dimensions: { skill: "council-mode" },
    }),
  ]);
  const delta = foldTelemetryCounters([
    envelope({ dimensions: { result: "deny", resolution: "user_denied" } }),
    envelope({
      source: "pi-input",
      metric: "skill.invocation",
      dimensions: { skill: "council-mode" },
    }),
  ]);

  const effective = mergeFoldedCounters(checkpoint, delta);
  assert.deepEqual(effective.counters.permission, {
    decisions: 2,
    allowed: 1,
    denied: 1,
  });
  assert.deepEqual(effective.skillInvocations, { "council-mode": 2 });

  // Idempotence guard: merging the same delta twice is a caller error the tests pin by asserting
  // the caller always merges against the persisted checkpoint exactly once (see Task 5 tests).
  assert.deepEqual(
    mergeFoldedCounters(checkpoint, emptyFoldedCounters()),
    checkpoint,
  );
});

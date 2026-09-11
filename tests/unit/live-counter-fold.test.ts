import assert from "node:assert/strict";
import { test } from "node:test";
import {
  counterDeltaAfterCursors,
  emptyFoldedCounters,
  foldTelemetryCounters,
  MAX_COUNTER_KEYS,
  MAX_SKILL_KEYS,
  mergeFoldedCounters,
  type FoldedCounters,
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

  // mergeFoldedCounters is additive, not idempotent: an empty delta is a no-op,
  // but merging the same delta twice counts it twice. Callers must merge each
  // delta against the persisted checkpoint exactly once.
  assert.deepEqual(
    mergeFoldedCounters(checkpoint, emptyFoldedCounters()),
    checkpoint,
  );
  const twice = mergeFoldedCounters(
    mergeFoldedCounters(checkpoint, delta),
    delta,
  );
  assert.deepEqual(twice.counters.permission, {
    decisions: 3,
    allowed: 1,
    denied: 2,
  });
  assert.deepEqual(twice.skillInvocations, { "council-mode": 3 });
});

test("folds permission.prompt by promptSource and ignores invalid sources", () => {
  const prompt = (promptSource: unknown) =>
    envelope({ metric: "permission.prompt", dimensions: { promptSource } });

  const folded = foldTelemetryCounters([
    prompt("tool_call"),
    prompt("tool_call"),
    prompt("skill_input"),
    prompt("skill_read"),
  ]);
  assert.deepEqual(folded.counters.permission, {
    prompts: 4,
    promptToolCall: 2,
    promptSkillInput: 1,
    promptSkillRead: 1,
  });
  assert.equal(folded.otherInvocations, 0);

  // Invalid or missing promptSource folds nothing: no counter, no generic key.
  const invalid = foldTelemetryCounters([
    prompt("bogus"),
    prompt(undefined),
    envelope({ metric: "permission.prompt" }),
  ]);
  assert.deepEqual(invalid.counters, {});
});

test("permission.ready yields presence only and changes no counters", () => {
  const folded = foldTelemetryCounters([
    envelope({ metric: "permission.ready", dimensions: undefined }),
  ]);

  assert.equal(folded.presence.permission, true);
  assert.deepEqual(folded.counters, {});
  assert.deepEqual(folded.skillInvocations, {});
  assert.equal(folded.otherInvocations, 0);
});

test("mergeFoldedCounters enforces the skill cap and counts overflow exactly", () => {
  const names = (offset: number, count: number) =>
    Object.fromEntries(
      Array.from({ length: count }, (_, index) => [
        `skill-${String(offset + index).padStart(3, "0")}`,
        1,
      ]),
    );

  const base = mergeFoldedCounters(undefined, {
    ...emptyFoldedCounters(),
    skillInvocations: names(0, MAX_SKILL_KEYS),
  });
  const delta: FoldedCounters = {
    ...emptyFoldedCounters(),
    skillInvocations: { ...names(MAX_SKILL_KEYS, 4), "skill-000": 5 },
  };

  const merged = mergeFoldedCounters(base, delta);
  assert.equal(Object.keys(merged.skillInvocations).length, MAX_SKILL_KEYS);
  // An overflow name that already exists in the base is tracked, not diverted.
  assert.equal(merged.skillInvocations["skill-000"], 6);
  // Four genuinely new names overflow, each counted exactly.
  assert.equal(merged.otherInvocations, 4);
});

test("mergeFoldedCounters keeps base keys first and adds sorted delta keys", () => {
  const base = mergeFoldedCounters(undefined, {
    ...emptyFoldedCounters(),
    skillInvocations: { "base-a": 1, "base-b": 1 },
  });
  const delta: FoldedCounters = {
    ...emptyFoldedCounters(),
    skillInvocations: { zeta: 1, alpha: 1, mike: 1 },
  };

  const merged = mergeFoldedCounters(base, delta);
  assert.deepEqual(Object.keys(merged.skillInvocations), [
    "base-a",
    "base-b",
    "alpha",
    "mike",
    "zeta",
  ]);
});

test("mergeFoldedCounters drops counter keys beyond the per-integration cap", () => {
  const numbered = (count: number) =>
    Object.fromEntries(
      Array.from({ length: count }, (_, index) => [`key-${index}`, 1]),
    );

  // Existing 16 keys are kept; keys outside the cap are dropped, not generic-keyed.
  const base: FoldedCounters = {
    ...emptyFoldedCounters(),
    counters: { permission: numbered(MAX_COUNTER_KEYS) },
  };
  const delta: FoldedCounters = {
    ...emptyFoldedCounters(),
    counters: {
      permission: { "key-0": 10, "key-99": 1, "key-100": 2 },
    },
  };

  const merged = mergeFoldedCounters(base, delta);
  const counters = merged.counters.permission ?? {};
  assert.equal(Object.keys(counters).length, MAX_COUNTER_KEYS);
  assert.equal(counters["key-0"], 11);
  assert.equal(counters["key-99"], undefined);
  assert.equal(counters["key-100"], undefined);
  assert.equal(merged.otherInvocations, 0);

  // Empty base: only the first 16 sorted delta keys are admitted.
  const overflowed = mergeFoldedCounters(undefined, {
    ...emptyFoldedCounters(),
    counters: {
      permission: Object.fromEntries(
        Array.from({ length: MAX_COUNTER_KEYS + 4 }, (_, index) => [
          `k${String(index).padStart(2, "0")}`,
          1,
        ]),
      ),
    },
  });
  assert.equal(
    Object.keys(overflowed.counters.permission ?? {}).length,
    MAX_COUNTER_KEYS,
  );
  assert.equal(overflowed.counters.permission?.k15, 1);
  assert.equal(overflowed.counters.permission?.k16, undefined);
});

test("counterDeltaAfterCursors folds only records strictly after each writer cursor", () => {
  const allow = envelope({
    dimensions: { result: "allow", resolution: "policy_allow" },
  });
  const deny = envelope({
    dimensions: { result: "deny", resolution: "user_denied" },
  });
  const records = [
    { writerId: "w1", writerSequence: 1, telemetry: allow },
    { writerId: "w1", writerSequence: 2, telemetry: deny },
    { writerId: "w2", writerSequence: 5, telemetry: allow },
    { writerId: "w2", writerSequence: 6 },
    { writerId: "w1", writerSequence: 3, telemetry: allow },
  ];

  // At/below the cursor is excluded; above it is included; a writer with no
  // cursor is fully included; a record without telemetry is ignored.
  const folded = counterDeltaAfterCursors(records, { w1: 1 });
  assert.deepEqual(folded.counters.permission, {
    decisions: 3,
    allowed: 2,
    denied: 1,
  });
  assert.equal(folded.presence.permission, false);

  // Cursors for different writers are applied independently.
  const bounded = counterDeltaAfterCursors(records, { w1: 2, w2: 5 });
  assert.deepEqual(bounded.counters.permission, { decisions: 1, allowed: 1 });
});

test("counterDeltaAfterCursors returns a fold independent of its inputs", () => {
  const allow = envelope({
    dimensions: { result: "allow", resolution: "policy_allow" },
  });
  const records = [{ writerId: "w1", writerSequence: 2, telemetry: allow }];
  const cursors = { w1: 1 };

  const folded = counterDeltaAfterCursors(records, cursors);

  const record = records[0];
  if (record !== undefined) {
    record.writerSequence = 0;
    const telemetry = record.telemetry as unknown as {
      dimensions: Record<string, string>;
    };
    telemetry.dimensions.result = "deny";
  }
  cursors.w1 = 99;

  assert.deepEqual(folded.counters.permission, { decisions: 1, allowed: 1 });
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { foldTelemetryCounters } from "../../src/core/live-counter-fold.ts";
import { readSkillInvocations } from "../../src/integrations/skill-invocations.ts";

const record = (overrides: Record<string, unknown> = {}) => ({
  eventId: "evt-1",
  writerId: "w-1",
  writerSequence: 1,
  timestamp: "2026-09-12T10:00:00.000Z",
  telemetry: {
    schemaVersion: 1,
    source: "pi-input",
    metric: "skill.invocation",
    value: 1,
    kind: "counter",
    dimensions: { skill: "context-mode" },
  },
  ...overrides,
});

test("valid skill invocation becomes a live-authority fact", () => {
  const facts = readSkillInvocations({ sessionId: "s1", records: [record()] });
  assert.equal(facts.length, 1);
  assert.equal(facts[0]?.skill, "context-mode");
  assert.equal(facts[0]?.provenance.authority, "live");
  assert.equal(facts[0]?.time.state, "known");
  assert.deepEqual(facts[0]?.wal, {
    eventId: "evt-1",
    writerId: "w-1",
    writerSequence: 1,
  });
});

test("non-skill, overflow and invalid names produce no fact", () => {
  const facts = readSkillInvocations({
    sessionId: "s1",
    records: [
      record({
        eventId: "e2",
        telemetry: {
          schemaVersion: 1,
          source: "pi-input",
          metric: "skill.invocation",
          value: 2,
          kind: "counter",
          dimensions: { skill: "x" },
        },
      }),
      record({
        eventId: "e3",
        telemetry: {
          schemaVersion: 1,
          source: "other",
          metric: "skill.invocation",
          value: 1,
          kind: "counter",
          dimensions: { skill: "x" },
        },
      }),
      record({
        eventId: "e4",
        telemetry: {
          schemaVersion: 1,
          source: "pi-input",
          metric: "skill.invocation",
          value: 1,
          kind: "counter",
          dimensions: { skill: "../etc" },
        },
      }),
    ],
  });
  assert.deepEqual(facts, []);
});

test("fact identity, provenance and observer time basis are fixed", () => {
  const facts = readSkillInvocations({ sessionId: "s1", records: [record()] });
  const fact = facts[0];
  assert.equal(fact?.kind, "skill-invocation");
  assert.equal(fact?.factId, "skill-invocation:evt-1");
  assert.equal(fact?.sessionId, "s1");
  assert.equal(fact?.provenance.source, "integration-telemetry");
  assert.equal(fact?.provenance.recordId, "evt-1");
  assert.equal(fact?.provenance.schemaVersion, 1);
  assert.deepEqual(fact?.time, {
    state: "known",
    at: "2026-09-12T10:00:00.000Z",
    basis: "wal-observer",
  });
});

test("malformed telemetry, missing dimensions and invalid skills produce no fact", () => {
  const facts = readSkillInvocations({
    sessionId: "s1",
    records: [
      // No telemetry at all: a timing-only WAL record.
      record({ eventId: "e2", telemetry: undefined }),
      // Missing dimensions entirely.
      record({
        eventId: "e3",
        telemetry: {
          schemaVersion: 1,
          source: "pi-input",
          metric: "skill.invocation",
          value: 1,
          kind: "counter",
        },
      }),
      // Non-string skill dimension.
      record({
        eventId: "e4",
        telemetry: {
          schemaVersion: 1,
          source: "pi-input",
          metric: "skill.invocation",
          value: 1,
          kind: "counter",
          dimensions: { skill: 7 },
        },
      }),
      // Oversized name exceeds the shared skill-name bound.
      record({
        eventId: "e5",
        telemetry: {
          schemaVersion: 1,
          source: "pi-input",
          metric: "skill.invocation",
          value: 1,
          kind: "counter",
          dimensions: { skill: `a${"b".repeat(64)}` },
        },
      }),
      // Redacted producer text can never satisfy the skill-name grammar.
      record({
        eventId: "e6",
        telemetry: {
          schemaVersion: 1,
          source: "pi-input",
          metric: "skill.invocation",
          value: 1,
          kind: "counter",
          dimensions: { skill: "[REDACTED]" },
        },
      }),
      // Same metric from a different kind.
      record({
        eventId: "e7",
        telemetry: {
          schemaVersion: 1,
          source: "pi-input",
          metric: "skill.invocation",
          value: 1,
          kind: "event",
          dimensions: { skill: "x" },
        },
      }),
    ],
  });
  assert.deepEqual(facts, []);
});

test("facts are ordered by writerId then writerSequence, not input order", () => {
  const facts = readSkillInvocations({
    sessionId: "s1",
    records: [
      record({ eventId: "b3", writerId: "w-2", writerSequence: 3 }),
      record({ eventId: "a2", writerId: "w-1", writerSequence: 2 }),
      record({ eventId: "b1", writerId: "w-2", writerSequence: 1 }),
      record({ eventId: "a1", writerId: "w-1", writerSequence: 1 }),
    ],
  });
  assert.deepEqual(
    facts.map((fact) => fact.wal),
    [
      { eventId: "a1", writerId: "w-1", writerSequence: 1 },
      { eventId: "a2", writerId: "w-1", writerSequence: 2 },
      { eventId: "b1", writerId: "w-2", writerSequence: 1 },
      { eventId: "b3", writerId: "w-2", writerSequence: 3 },
    ],
  );
});

/** The exact fact shape: an extra copied producer dimension would fail here. */
test("R19: the produced skill fact carries exactly the bounded fields", () => {
  const facts = readSkillInvocations({
    sessionId: "s1",
    records: [
      record({
        telemetry: {
          schemaVersion: 1,
          source: "pi-input",
          metric: "skill.invocation",
          value: 1,
          kind: "counter",
          dimensions: {
            skill: "context-mode",
            task: "PRIVATE_TASK",
            body: "PRIVATE_BODY",
          },
        },
      }),
    ],
  });

  assert.deepEqual(facts, [
    {
      factId: "skill-invocation:evt-1",
      sessionId: "s1",
      kind: "skill-invocation",
      skill: "context-mode",
      wal: { eventId: "evt-1", writerId: "w-1", writerSequence: 1 },
      provenance: {
        source: "integration-telemetry",
        authority: "live",
        recordId: "evt-1",
        schemaVersion: 1,
      },
      time: {
        state: "known",
        at: "2026-09-12T10:00:00.000Z",
        basis: "wal-observer",
      },
    },
  ]);
  assert.equal(JSON.stringify(facts).includes("PRIVATE_TASK"), false);
  assert.equal(JSON.stringify(facts).includes("PRIVATE_BODY"), false);
});

test("R19: a pi-input counter with the wrong metric or a non-unit value yields no fact", () => {
  const skillEnvelope = (over: Record<string, unknown>) => ({
    schemaVersion: 1,
    source: "pi-input",
    metric: "skill.invocation",
    value: 1,
    kind: "counter",
    dimensions: { skill: "context-mode" },
    ...over,
  });
  const facts = readSkillInvocations({
    sessionId: "s1",
    records: [
      // Right source/value/kind, wrong metric.
      record({
        eventId: "e1",
        telemetry: skillEnvelope({ metric: "skill.other" }),
      }),
      // Right metric, non-unit values.
      record({ eventId: "e2", telemetry: skillEnvelope({ value: 0 }) }),
      record({ eventId: "e3", telemetry: skillEnvelope({ value: 1.5 }) }),
      record({ eventId: "e4", telemetry: skillEnvelope({ value: -1 }) }),
      record({ eventId: "e5", telemetry: skillEnvelope({ value: true }) }),
      // The unit case is the only one that yields a fact.
      record({ eventId: "e6", telemetry: skillEnvelope({}) }),
    ],
  });

  assert.deepEqual(
    facts.map((fact) => fact.wal.eventId),
    ["e6"],
  );
});

/** The fold and the reader must agree on exactly which records are invocations. */
test("R19: folded skill counts equal the reader's fact count for the same records", () => {
  const telemetry = (skill: unknown) => ({
    schemaVersion: 1,
    source: "pi-input",
    metric: "skill.invocation",
    value: 1,
    kind: "counter",
    dimensions: { skill },
  });
  const records = [
    record({
      eventId: "e1",
      writerSequence: 1,
      telemetry: telemetry("council-mode"),
    }),
    record({
      eventId: "e2",
      writerSequence: 2,
      telemetry: telemetry("council-mode"),
    }),
    record({
      eventId: "e3",
      writerSequence: 3,
      telemetry: telemetry("council-mode"),
    }),
    // Rejected by both sides: a name outside the shared grammar.
    record({
      eventId: "e4",
      writerSequence: 4,
      telemetry: telemetry("bad name"),
    }),
  ];
  const folded = foldTelemetryCounters(records.map((entry) => entry.telemetry));
  const facts = readSkillInvocations({ sessionId: "s1", records });

  assert.equal(facts.length, 3);
  assert.equal(
    folded.skillInvocations["council-mode"],
    facts.filter((fact) => fact.skill === "council-mode").length,
  );
  assert.equal(Object.hasOwn(folded.skillInvocations, "bad name"), false);
  assert.equal(Object.keys(folded.skillInvocations).length, 1);
});

test("R19: a null telemetry envelope yields no fact and never throws", () => {
  const records = [
    record({ eventId: "e-null", telemetry: null }),
  ] as unknown as Parameters<typeof readSkillInvocations>[0]["records"];

  assert.doesNotThrow(() => readSkillInvocations({ sessionId: "s1", records }));
  assert.deepEqual(readSkillInvocations({ sessionId: "s1", records }), []);
});

test("trusting a hostile telemetry shape never throws", () => {
  const facts = readSkillInvocations({
    sessionId: "s1",
    records: [
      record({ eventId: "e2", telemetry: {} }),
      record({ eventId: "e3", telemetry: { dimensions: null } }),
      record({
        eventId: "e4",
        telemetry: {
          source: "pi-input",
          metric: "skill.invocation",
          value: 1,
          kind: "counter",
          dimensions: Object.assign(Object.create(null), {
            skill: "context-mode",
          }),
        },
      }),
    ],
  });
  assert.deepEqual(
    facts.map((fact) => fact.skill),
    ["context-mode"],
  );
});

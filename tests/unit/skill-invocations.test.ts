import assert from "node:assert/strict";
import { test } from "node:test";
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

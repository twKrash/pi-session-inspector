import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildCanonicalSession,
  projectEvidenceHealth,
} from "../../src/core/canonical.ts";
import type {
  FoldedAggregateEvidence,
  LiveTimingObservation,
  SkillInvocationObservation,
} from "../../src/core/evidence.ts";
import { canonicalOpaqueDigest } from "../../src/core/opaque-id.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";

// Minimal local fixtures (R2): the brief shows assertions, not a harness.

const HEADER = {
  type: "session",
  version: 3,
  id: "s1",
  timestamp: "2026-09-12T09:59:00.000Z",
};
const MARKER = {
  type: "custom",
  id: "marker",
  parentId: null,
  timestamp: "2026-09-12T10:00:00.000Z",
  customType: "session-inspector:tracking-start",
  data: { schemaVersion: 1 },
};
const ASSISTANT = {
  type: "message",
  id: "gen-1",
  parentId: "marker",
  timestamp: "2026-09-12T10:01:00.000Z",
  message: {
    role: "assistant",
    provider: "openai",
    model: "gpt",
    usage: { totalTokens: 100, cost: { total: 0.5 } },
    content: [{ type: "toolCall", id: "call_1", name: "bash" }],
  },
};
const TOOL_RESULT = {
  type: "message",
  id: "res-1",
  parentId: "gen-1",
  timestamp: "2026-09-12T10:01:05.000Z",
  message: {
    role: "toolResult",
    toolCallId: "call_1",
    toolName: "bash",
    isError: false,
    usage: { totalTokens: 10, cost: { total: 0.1 } },
  },
};

function parsed(records: object[]) {
  return parseSessionJsonl(
    [HEADER, ...records].map((record) => JSON.stringify(record)).join("\n") +
      "\n",
  );
}

function skillFact(): SkillInvocationObservation {
  return {
    factId: "skill-invocation:evt-7",
    sessionId: "s1",
    kind: "skill-invocation",
    skill: "demo",
    wal: { eventId: "evt-7", writerId: "w1", writerSequence: 3 },
    provenance: {
      source: "integration-telemetry",
      authority: "live",
      recordId: "evt-7",
      schemaVersion: 1,
    },
    time: {
      state: "known",
      at: "2026-09-12T10:02:00.000Z",
      basis: "wal-observer",
    },
  };
}

function skillRecord(eventId: string, sequence: number, skill: string) {
  return {
    eventId,
    writerId: "w1",
    writerSequence: sequence,
    timestamp: "2026-09-12T10:02:00.000Z",
    telemetry: {
      kind: "counter",
      value: 1,
      source: "pi-input",
      metric: "skill.invocation",
      dimensions: { skill },
    },
  };
}

test("missing marker yields unavailable with health, not a session", () => {
  const result = buildCanonicalSession({
    sessionId: "s1",
    parsed: parsed([ASSISTANT, TOOL_RESULT]),
    scope: "tree",
    leafId: null,
    evidence: { atomic: [], folded: [] },
  });
  assert.notEqual(result.state, "ready");
  assert.equal(result.state, "unavailable");
  assert.ok(
    result.health.diagnostics.some(
      (diagnostic) => diagnostic.code === "tracking-marker-missing",
    ),
  );
  assert.equal(JSON.stringify(result).includes("hasSessionHeader"), false);
});

test("ready session exposes skill detail, aggregates and reconciled usage", () => {
  const folded: FoldedAggregateEvidence[] = [
    {
      kind: "checkpoint-wal-aggregates",
      sessionId: "s1",
      foldedThrough: { w1: 3 },
      sealedThrough: {},
      skillInvocations: { demo: 2 },
      checkpointedAt: {
        state: "known",
        at: "2026-09-12T10:00:30.000Z",
        basis: "checkpoint-observer",
      },
      provenance: {
        source: "checkpoint",
        authority: "derived",
        schemaVersion: 1,
      },
    },
  ];
  const result = buildCanonicalSession({
    sessionId: "s1",
    parsed: parsed([MARKER, ASSISTANT, TOOL_RESULT]),
    scope: "tree",
    leafId: null,
    evidence: { atomic: [skillFact()], folded },
    walRecords: [
      skillRecord("evt-7", 3, "demo"),
      skillRecord("evt-9", 4, "demo2"),
    ],
  });
  assert.equal(result.state, "ready");
  const session = result.state === "ready" ? result.session : undefined;
  assert.equal(session?.skillInvocations.length, 1);
  assert.equal(session?.markerEntryId, "marker");
  assert.equal(session?.retainedAggregates.boundary.detail, "aggregate-only");
  assert.equal(session?.usage.state, "known");
  assert.equal(
    session?.usage.state === "known" ? session.usage.known.totalTokens : -1,
    110,
  );
  // R38: folded prefix (demo: 2) plus the retained post-cursor suffix (demo2: 1).
  assert.equal(
    session?.retainedAggregates.skillInvocations?.named?.value.demo,
    2,
  );
  assert.equal(
    session?.retainedAggregates.skillInvocations?.named?.value.demo2,
    1,
  );
  assert.ok(session);
  const health = projectEvidenceHealth(session);
  assert.equal(health.aggregates.skillInvocations.retainedInvocations, 1);
  assert.equal(health.aggregates.skillInvocations.names, 2);
  assert.equal(health.aggregates.detail, "aggregate-only");
  assert.equal(health.core, "supported");
  assert.equal(health.schemaVersion, 1);
});

test("unknown semantic node never emits a payload fact", () => {
  const unknown = {
    type: "mystery-node",
    id: "unknown-1",
    parentId: "marker",
    timestamp: "2026-09-12T10:00:30.000Z",
    payload: "producer secret payload",
  };
  const result = buildCanonicalSession({
    sessionId: "s1",
    parsed: parsed([MARKER, unknown, ASSISTANT]),
    scope: "tree",
    leafId: null,
    evidence: { atomic: [], folded: [] },
  });
  const session = result.state === "ready" ? result.session : undefined;
  assert.equal(session?.graph.nodes.length, 3);
  assert.equal(session?.graph.nodes[1]?.semanticType.state, "unknown");
  assert.equal(session?.generations.length, 1);
  assert.equal(
    JSON.stringify(session).includes("producer secret payload"),
    false,
  );
});

test("live timing correlates to a native tool call by exact opaque subject", () => {
  const subject = `live-tool-${canonicalOpaqueDigest("live-tool", "s1", "call_1")}`;
  const fact: LiveTimingObservation = {
    factId: "live-timing:evt-1",
    sessionId: "s1",
    kind: "live-timing",
    category: "tool",
    status: "complete",
    subjectId: subject,
    startedAt: "2026-09-12T10:01:00.000Z",
    endedAt: "2026-09-12T10:01:01.000Z",
    durationMs: 42,
    provenance: {
      source: "inspector-wal",
      authority: "live",
      recordId: "evt-1",
      schemaVersion: 1,
    },
    time: {
      state: "known",
      at: "2026-09-12T10:01:00.000Z",
      basis: "wal-observer",
    },
  };
  const result = buildCanonicalSession({
    sessionId: "s1",
    parsed: parsed([MARKER, ASSISTANT, TOOL_RESULT]),
    scope: "tree",
    leafId: null,
    evidence: { atomic: [fact], folded: [] },
  });
  const session = result.state === "ready" ? result.session : undefined;
  assert.equal(session?.tools[0]?.durationMs, 42);
  assert.ok(session);
  const health = projectEvidenceHealth(session);
  assert.equal(health.joins.matchedLiveToolTimings, 1);
  assert.equal(health.joins.toolCalls, 1);
});

test("boundary inconsistency becomes a bounded diagnostic, not a throw", () => {
  const folded: FoldedAggregateEvidence[] = [
    {
      kind: "checkpoint-wal-aggregates",
      sessionId: "s1",
      foldedThrough: { w1: 5 },
      sealedThrough: {},
      skillInvocations: { demo: 2 },
      checkpointedAt: { state: "unavailable" },
      provenance: {
        source: "checkpoint",
        authority: "derived",
        schemaVersion: 1,
      },
    },
  ];
  const result = buildCanonicalSession({
    sessionId: "s1",
    parsed: parsed([MARKER, ASSISTANT]),
    scope: "tree",
    leafId: null,
    evidence: { atomic: [], folded },
    walRecords: [skillRecord("evt-3", 3, "demo")],
  });
  assert.equal(result.state, "ready");
  const session = result.state === "ready" ? result.session : undefined;
  assert.ok(
    session?.health.diagnostics.some(
      (diagnostic) => diagnostic.code === "checkpoint-aggregate-invalid",
    ),
  );
  assert.equal(session?.retainedAggregates.boundary.detail, "expired");
});

test("parent resolution failure forwards a bounded diagnostic", () => {
  const result = buildCanonicalSession({
    sessionId: "s1",
    parsed: parsed([MARKER, ASSISTANT]),
    scope: "tree",
    leafId: null,
    evidence: { atomic: [], folded: [] },
    parentSession: { state: "unavailable" },
  });
  assert.equal(result.state, "ready");
  const session = result.state === "ready" ? result.session : undefined;
  assert.deepEqual(session?.parentSession, { state: "unavailable" });
  assert.ok(
    session?.health.diagnostics.some(
      (diagnostic) => diagnostic.code === "parent-session-unavailable",
    ),
  );
});

test("an unsupported Pi format yields unsupported health, never facts", () => {
  const result = buildCanonicalSession({
    sessionId: "s1",
    parsed: parseSessionJsonl(
      `${JSON.stringify({ ...HEADER, version: 2 })}\n${JSON.stringify(MARKER)}\n`,
    ),
    scope: "tree",
    leafId: null,
    evidence: { atomic: [], folded: [] },
  });
  assert.equal(result.state, "unsupported");
  assert.ok(
    result.health.diagnostics.some(
      (diagnostic) => diagnostic.code === "source-format-unsupported",
    ),
  );
});

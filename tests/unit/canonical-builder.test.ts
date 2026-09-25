import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  attachSubagentEvidence,
  buildCanonicalSession,
  projectEvidenceHealth,
} from "../../src/core/canonical.ts";
import { reduceEntries } from "../../src/core/reduce.ts";
import type {
  FoldedAggregateEvidence,
  LiveTimingObservation,
  SkillInvocationObservation,
} from "../../src/core/evidence.ts";
import { MAX_FOLDED_COUNT } from "../../src/core/live-counter-fold.ts";
import type { SubagentSourceEvidence } from "../../src/core/events.ts";
import { readSubagentEvidence } from "../../src/integrations/subagents.ts";
import { canonicalOpaqueDigest } from "../../src/core/opaque-id.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";

test("audited effort fixture is normalized once before canonical health and usage", () => {
  const parsed = parseSessionJsonl(
    readFileSync(
      "tests/fixtures/pi/0.85.1/subagent-agent-run-effort.jsonl",
      "utf8",
    ),
  );
  const evidence = readSubagentEvidence(parsed.entries, parsed.id);
  const built = buildCanonicalSession({
    parsed,
    scope: "tree",
    leafId: null,
    evidence: { atomic: [], folded: [] },
    subagents: evidence,
  });

  assert.equal(built.state, "ready");
  if (built.state !== "ready") throw new Error("unreachable");
  const session = built.session;
  const foreground = session.agents.find((run) => run.agent === "agent-a");
  assert.deepEqual(
    {
      durationMs: foreground?.durationMs,
      toolCalls: foreground?.toolCalls,
      coverage: foreground?.effortCoverage,
    },
    {
      durationMs: 1234,
      toolCalls: 3,
      coverage: {
        duration: "partial",
        generations: "unavailable",
        tools: "partial",
        errors: "unavailable",
        usage: "partial",
        cost: "partial",
      },
    },
  );
  assert.equal(
    session.agents.filter((run) => run.durationMs !== undefined).length,
    2,
  );
  assert.equal(
    session.agents.filter((run) => run.toolCalls !== undefined).length,
    2,
  );
  // Historical workflow-summary usage is unvalidated and remains unavailable.
  assert.equal(
    session.usage.lines.filter((line) => line.domain === "child-breakdown")
      .length,
    3,
  );
  assert.equal(session.health.joins.agentRuns, session.agents.length);
  assert.equal(session.health.usage.childLines, 3);
  assert.equal(
    session.usage.lines
      .filter((line) => line.domain === "child-breakdown")
      .every((line) => line.contributesToSession === false),
    true,
  );
  assert.equal(JSON.stringify(session).includes("fg-container"), false);
});

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

test("deduplicates a duplicate tree-scope id before L1 usage reduction", () => {
  const first = {
    ...ASSISTANT,
    id: "duplicate-generation",
    parentId: "marker",
    message: {
      ...ASSISTANT.message,
      usage: { totalTokens: 7, cost: { total: 0.07 } },
    },
  };
  const duplicate = {
    ...first,
    timestamp: "2026-09-12T10:02:00.000Z",
    message: {
      ...first.message,
      usage: { totalTokens: 99, cost: { total: 0.99 } },
    },
  };
  const source = parsed([MARKER, first, duplicate]);
  const result = buildCanonicalSession({
    parsed: source,
    scope: "tree",
    leafId: null,
    evidence: { atomic: [], folded: [] },
  });
  assert.equal(result.state, "ready");
  if (result.state !== "ready") return;
  assert.deepEqual(result.session.scopedEntryIds, ["duplicate-generation"]);
  assert.equal(
    result.session.scopedEntryIds.filter((id) => id === "duplicate-generation")
      .length,
    1,
  );
  assert.equal(result.session.generations.length, 1);
  assert.equal(result.session.usage.state, "known");
  if (result.session.usage.state === "known") {
    assert.equal(result.session.usage.known.totalTokens, 7);
  }
});

test("retains native economics and independent field coverage in canonical usage", () => {
  const first = {
    ...ASSISTANT,
    id: "economics-generation-1",
    message: {
      ...ASSISTANT.message,
      usage: {
        input: 20,
        output: 8,
        cacheRead: 1,
        cacheWrite: 1,
        reasoning: 3,
        totalTokens: 30,
        cost: {
          input: 0.04,
          output: 0.06,
          cacheRead: 0.01,
          cacheWrite: 0.013,
          total: 0.123,
        },
      },
    },
  };
  const second = {
    ...ASSISTANT,
    id: "economics-generation-2",
    parentId: first.id,
    message: {
      ...ASSISTANT.message,
      usage: {
        input: 5,
        output: 3,
        cacheRead: 0,
        totalTokens: 8,
        cost: { input: 0.02, output: 0.03, cacheRead: 0, total: 0.05 },
      },
    },
  };
  const result = buildCanonicalSession({
    parsed: parsed([
      MARKER,
      first,
      second,
      {
        ...TOOL_RESULT,
        parentId: second.id,
        message: {
          ...TOOL_RESULT.message,
          usage: {
            input: 2,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 3,
            cost: {
              input: 0.005,
              output: 0.004,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0.009,
            },
          },
        },
      },
    ]),
    scope: "tree",
    leafId: null,
    evidence: { atomic: [], folded: [] },
  });

  assert.equal(result.state, "ready");
  if (result.state !== "ready" || result.session.usage.state !== "known") {
    return;
  }
  assert.deepEqual(result.session.usage.known, {
    totalTokens: 41,
    cost: 0.182,
    inputTokens: 27,
    outputTokens: 12,
    cacheReadTokens: 1,
    cacheWriteTokens: 1,
    reasoningTokens: 3,
    inputCost: 0.065,
    outputCost: 0.094,
    cacheReadCost: 0.01,
    cacheWriteCost: 0.013,
  });
  assert.equal(
    result.session.usage.fieldCoverage?.inputTokens.state,
    "complete",
  );
  assert.equal(
    result.session.usage.fieldCoverage?.cacheWriteTokens.state,
    "partial",
  );
  assert.equal(
    result.session.usage.fieldCoverage?.reasoningTokens.state,
    "partial",
  );
});

test("rejects a cap-plus-one retained checkpoint counter as bounded invalid", () => {
  const folded: FoldedAggregateEvidence[] = [
    {
      kind: "checkpoint-wal-aggregates",
      sessionId: "s1",
      foldedThrough: { w1: 1 },
      sealedThrough: {},
      skillInvocations: { demo: MAX_FOLDED_COUNT },
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
    parsed: parsed([MARKER, ASSISTANT]),
    scope: "tree",
    leafId: null,
    evidence: { atomic: [], folded },
    walRecords: [skillRecord("evt-cap-plus-one", 2, "demo")],
  });
  assert.equal(result.state, "ready");
  if (result.state !== "ready") return;
  assert.equal(result.session.effectiveCounters.state, "unavailable");
  assert.ok(
    result.session.health.diagnostics.some(
      (diagnostic) => diagnostic.code === "checkpoint-aggregate-invalid",
    ),
  );
  assert.equal(
    result.session.retainedAggregates.skillInvocations?.named?.value.demo,
    undefined,
  );
});

test("R49: a ready session publishes the builder's resolved scoped entry ids", () => {
  // The full native graph is not the scoped set: the branching fixture keeps a
  // pre-marker entry, a sibling branch, and an unknown-semantic node.
  const source = readFileSync(
    "tests/fixtures/pi/0.85.1/branching.jsonl",
    "utf8",
  );
  const branching = parseSessionJsonl(source);
  const active = buildCanonicalSession({
    parsed: branching,
    scope: "active",
    leafId: "e6",
    evidence: { atomic: [], folded: [] },
  });
  const tree = buildCanonicalSession({
    parsed: branching,
    scope: "tree",
    leafId: null,
    evidence: { atomic: [], folded: [] },
  });
  assert.equal(active.state, "ready");
  assert.equal(tree.state, "ready");
  const activeSession = active.state === "ready" ? active.session : undefined;
  const treeSession = tree.state === "ready" ? tree.session : undefined;
  assert.ok(activeSession && treeSession);

  // L2 consumes these ids instead of re-deriving scope; reducing every graph
  // node would report the sibling branch (72 tokens) for an active read (42).
  const byId = new Map(branching.entries.map((entry) => [entry.id, entry]));
  const scoped = (ids: readonly string[]) =>
    ids.flatMap((id) => {
      const entry = byId.get(id);
      return entry === undefined ? [] : [entry];
    });
  assert.equal(
    reduceEntries(branching.id, scoped(activeSession.scopedEntryIds)).usage
      .totalTokens,
    42,
  );
  assert.equal(
    reduceEntries(branching.id, scoped(treeSession.scopedEntryIds)).usage
      .totalTokens,
    72,
  );
  assert.notDeepEqual(activeSession.scopedEntryIds, treeSession.scopedEntryIds);
  // Scoped, never the whole graph: the marker itself and the pre-marker entry
  // stay out, and the unknown-semantic node stays in (L2 skips it by parse).
  assert.equal(activeSession.scopedEntryIds.includes("tracking-marker"), false);
  assert.equal(treeSession.scopedEntryIds.includes("tracking-marker"), false);
  assert.equal(activeSession.scopedEntryIds.includes("e7"), false);
  assert.equal(treeSession.scopedEntryIds.includes("e7"), true);
  assert.equal(
    activeSession.graph.nodes.length > activeSession.scopedEntryIds.length,
    true,
  );
});

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

function liveTiming(
  category: LiveTimingObservation["category"],
): LiveTimingObservation {
  return {
    factId: `live-timing:evt-${category}`,
    sessionId: "s1",
    kind: "live-timing",
    category,
    status: "complete",
    startedAt: "2026-09-12T10:01:00.000Z",
    endedAt: "2026-09-12T10:01:01.000Z",
    provenance: {
      source: "inspector-wal",
      authority: "live",
      recordId: `evt-${category}`,
      schemaVersion: 1,
    },
    time: {
      state: "known",
      at: "2026-09-12T10:01:00.000Z",
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

/**
 * Walks every string in a serialized value so a privacy test can assert no
 * string exceeds a hard bound, independent of which field carried it.
 */
function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, out);
  }
  return out;
}

test("missing marker yields unavailable with health, not a session", () => {
  const result = buildCanonicalSession({
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
  // P2.7: the source row must not claim full detail when nothing was observed.
  const piJsonl = result.health.sources.find(
    (row) => row.source === "pi-jsonl",
  );
  assert.equal(piJsonl?.detail, "not-observed");
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
  assert.equal(session?.retainedSkillInvocations?.named.demo, 1);
  assert.equal(session?.retainedSkillInvocations?.overflow, 0);
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

test("R45: a prototype-named writer id still arms the retained boundary check", () => {
  const folded: FoldedAggregateEvidence[] = [
    {
      kind: "checkpoint-wal-aggregates",
      sessionId: "s1",
      foldedThrough: { ["__proto__"]: 5 },
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
    parsed: parsed([MARKER, ASSISTANT]),
    scope: "tree",
    leafId: null,
    evidence: { atomic: [], folded },
    // `__proto__` is a legal writer id (underscore-leading token). The retained
    // sequence (3) is behind the cursor (5) with no matching seal, so the
    // boundary is inconsistent and must be rejected, never silently disarmed.
    walRecords: [{ ...skillRecord("evt-3", 3, "demo"), writerId: "__proto__" }],
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
  // P2.7: detail is `unsupported`, never a false `full`.
  const piJsonl = result.health.sources.find(
    (row) => row.source === "pi-jsonl",
  );
  assert.equal(piJsonl?.detail, "unsupported");
});

// ---------------------------------------------------------------------------
// Round 1 fix tests
// ---------------------------------------------------------------------------

test("P1.1: a usage-less assistant never creates a zero-valued line", () => {
  const noUsage = {
    type: "message",
    id: "gen-nousage",
    parentId: "marker",
    timestamp: "2026-09-12T10:01:00.000Z",
    message: { role: "assistant", provider: "openai", model: "gpt" },
  };
  const noUsageCompaction = {
    type: "compaction",
    id: "comp-nousage",
    parentId: "gen-nousage",
    timestamp: "2026-09-12T10:01:30.000Z",
    summary: "bounded",
  };
  const result = buildCanonicalSession({
    parsed: parsed([MARKER, noUsage, noUsageCompaction]),
    scope: "tree",
    leafId: null,
    evidence: { atomic: [], folded: [] },
  });
  assert.equal(result.state, "ready");
  const session = result.state === "ready" ? result.session : undefined;
  assert.ok(session);
  assert.equal(session.generations.length, 1);
  assert.equal(session.compactions.length, 1);
  assert.equal(session.usage.state, "known");
  assert.equal(session.usage.lines.length, 0);
  assert.equal(
    session.usage.state === "known" ? session.usage.known.totalTokens : -1,
    0,
  );
  assert.equal(projectEvidenceHealth(session).usage.nativeLines, 0);
});

test("P1.2a: child run usage never changes the session/native totals", () => {
  const subagents: SubagentSourceEvidence = {
    activity: {
      state: "supported",
      calls: 1,
      succeeded: 1,
      failed: 0,
      interrupted: 0,
      tools: [],
    },
    state: "supported",
    diagnostics: [],
    observations: [
      {
        sourceIdentity: `subagent-source-${"a".repeat(64)}`,
        order: 0,
        run: {
          id: `subagent-${"1".repeat(64)}`,
          status: "succeeded",
          confidence: "cooperative",
          effortCoverage: {
            duration: "unavailable",
            generations: "unavailable",
            tools: "unavailable",
            errors: "unavailable",
            usage: "partial",
            cost: "partial",
          },
          usage: { totalTokens: 999, cost: 9 },
        },
      },
    ],
  };
  const result = buildCanonicalSession({
    parsed: parsed([MARKER, ASSISTANT, TOOL_RESULT]),
    scope: "tree",
    leafId: null,
    evidence: { atomic: [], folded: [] },
    subagents,
  });
  assert.equal(result.state, "ready");
  const session = result.state === "ready" ? result.session : undefined;
  assert.ok(session);
  assert.equal(session.usage.state, "known");
  assert.equal(
    session.usage.state === "known" ? session.usage.known.totalTokens : -1,
    110,
  );
  assert.equal(
    session.usage.state === "known"
      ? session.usage.composition.generations.totalTokens
      : -1,
    100,
  );
  assert.equal(
    session.usage.state === "known"
      ? session.usage.composition.toolResults.totalTokens
      : -1,
    10,
  );
  const child = session.usage.lines.filter(
    (line) => line.domain === "child-breakdown",
  );
  assert.equal(child.length, 1);
  assert.equal(child[0]?.contributesToSession, false);
  assert.equal(child[0]?.bucket, "child-run");

  const base = buildCanonicalSession({
    parsed: parsed([MARKER, ASSISTANT, TOOL_RESULT]),
    scope: "tree",
    leafId: null,
    evidence: { atomic: [], folded: [] },
  });
  assert.equal(base.state, "ready");
  if (base.state !== "ready") throw new Error("unreachable");
  const attached = attachSubagentEvidence(base.session, subagents);
  assert.deepEqual(attached.agents, session.agents);
  assert.deepEqual(attached.usage, session.usage);
  assert.deepEqual(attached.health, session.health);

  const health = projectEvidenceHealth(session);
  assert.equal(health.usage.childLines, 1);
  assert.equal(health.usage.nativeLines, 2);
});

test("fails closed and diagnoses duplicate public run IDs without aliases", () => {
  const publicId = `subagent-${"1".repeat(64)}`;
  const effortCoverage = {
    duration: "unavailable",
    generations: "unavailable",
    tools: "unavailable",
    errors: "unavailable",
    usage: "unavailable",
    cost: "unavailable",
  } as const;
  const subagents: SubagentSourceEvidence = {
    activity: {
      state: "supported",
      calls: 1,
      succeeded: 1,
      failed: 0,
      interrupted: 0,
      tools: [],
    },
    observations: [
      {
        sourceIdentity: `subagent-source-${"a".repeat(64)}`,
        order: 0,
        run: {
          id: publicId,
          status: "succeeded",
          confidence: "cooperative",
          effortCoverage,
        },
      },
      {
        sourceIdentity: `subagent-source-${"b".repeat(64)}`,
        order: 1,
        run: {
          id: publicId,
          status: "failed",
          confidence: "cooperative",
          effortCoverage,
        },
      },
    ],
    state: "supported",
    diagnostics: [],
  };
  const result = buildCanonicalSession({
    parsed: parsed([MARKER]),
    scope: "tree",
    leafId: null,
    evidence: { atomic: [], folded: [] },
    subagents,
  });

  assert.equal(result.state, "ready");
  if (result.state !== "ready") return;
  assert.deepEqual(result.session.agents, []);
  assert.deepEqual(
    result.session.health.diagnostics
      .filter((diagnostic) => diagnostic.source === "subagent-result")
      .filter(
        (diagnostic) => diagnostic.code === "cooperative-evidence-conflict",
      )
      .map(({ code, count }) => ({ code, count })),
    [{ code: "cooperative-evidence-conflict", count: 1 }],
  );
  const serialized = JSON.stringify(result.session.health.diagnostics);
  assert.equal(serialized.includes(publicId), false);
  assert.equal(serialized.includes(`subagent-source-${"a".repeat(64)}`), false);
});

test("P1.2b: aggregate overflow publishes unavailable usage and bounded lines", () => {
  const big = (id: string) => ({
    type: "message",
    id,
    parentId: "marker",
    timestamp: "2026-09-12T10:01:00.000Z",
    message: {
      role: "assistant",
      provider: "openai",
      model: "gpt",
      usage: { totalTokens: Number.MAX_SAFE_INTEGER, cost: { total: 0 } },
    },
  });
  const result = buildCanonicalSession({
    parsed: parsed([MARKER, big("gen-big-1"), big("gen-big-2")]),
    scope: "tree",
    leafId: null,
    evidence: { atomic: [], folded: [] },
  });
  assert.equal(result.state, "ready");
  const session = result.state === "ready" ? result.session : undefined;
  assert.ok(session);
  assert.equal(session.usage.state, "unavailable");
  assert.equal(session.usage.state === "unavailable", true);
  if (session.usage.state === "unavailable") {
    assert.equal(session.usage.reason, "overflow");
    // Bounded individual lines remain; no clamped aggregate is published.
    assert.equal(session.usage.lines.length, 2);
    assert.equal("known" in session.usage, false);
    assert.equal("composition" in session.usage, false);
  }
  const overflow = session.health.diagnostics.find(
    (diagnostic) => diagnostic.code === "usage-overflow",
  );
  assert.ok(overflow);
  assert.equal(overflow.source, "pi-jsonl");
  assert.equal(overflow.severity, "error");
  assert.equal(projectEvidenceHealth(session).usage.nativeLines, 2);
});

test("P1.2c: an uncorrelated native tool call reports the live source partial", () => {
  const result = buildCanonicalSession({
    parsed: parsed([MARKER, ASSISTANT, TOOL_RESULT]),
    scope: "tree",
    leafId: null,
    evidence: { atomic: [], folded: [] },
    walRecords: [skillRecord("evt-1", 1, "demo")],
  });
  assert.equal(result.state, "ready");
  const session = result.state === "ready" ? result.session : undefined;
  assert.ok(session);
  const live = session.health.sources.find(
    (row) => row.source === "inspector-wal",
  );
  assert.equal(live?.state, "partial");
});

test("P1.2c: a non-zero liveOverflow reports the live source partial", () => {
  // No native tool call and no running live fact: `liveOverflow` is the only
  // term that can flip the source to partial.
  const assistantNoToolCall = {
    type: "message",
    id: "gen-no-tool",
    parentId: "marker",
    timestamp: "2026-09-12T10:01:00.000Z",
    message: {
      role: "assistant",
      provider: "openai",
      model: "gpt",
      content: [],
    },
  };
  const result = buildCanonicalSession({
    parsed: parsed([MARKER, assistantNoToolCall]),
    scope: "tree",
    leafId: null,
    evidence: { atomic: [liveTiming("turn")], folded: [] },
    walRecords: [],
    liveOverflow: 3,
  });
  assert.equal(result.state, "ready");
  const session = result.state === "ready" ? result.session : undefined;
  assert.ok(session);
  const live = session.health.sources.find(
    (row) => row.source === "inspector-wal",
  );
  assert.equal(live?.state, "partial");
  // P2.7: recordsSeen stays honest when walRecords is empty but facts exist.
  assert.ok(live && live.recordsSeen >= live.factsAccepted);
  assert.equal(live?.factsAccepted, 1);
});

test("P1.2d: serialized session and health carry no path, secret, or unbounded string", () => {
  const secret = "sk-abcdefghijklmnopqrstuvwxyz0123456789";
  const path = "/home/dvory/.pi/secrets/credentials.jsonl";
  const longPayload = `${secret} ${path} `.repeat(200);
  const unknown = {
    type: "mystery-node",
    id: "unknown-1",
    parentId: "marker",
    timestamp: "2026-09-12T10:00:30.000Z",
    payload: longPayload,
  };
  const modelChange = {
    type: "model_change",
    id: "mc-1",
    parentId: "marker",
    timestamp: "2026-09-12T10:00:40.000Z",
    modelId: `Bearer ${secret}`,
    provider: secret,
  };
  const result = buildCanonicalSession({
    parsed: parsed([MARKER, unknown, modelChange, ASSISTANT, TOOL_RESULT]),
    scope: "tree",
    leafId: null,
    evidence: { atomic: [], folded: [] },
    inventory: {
      observedAt: "2026-09-12T10:03:00.000Z",
      commands: [
        {
          name: "cmd",
          source: "extension",
          sourceLabel: "safe-label",
          scope: "user",
          origin: "package",
          description: longPayload,
        },
      ],
      skills: [],
      resources: [],
      toolSources: { bash: path },
    },
  });
  assert.equal(result.state, "ready");
  const session = result.state === "ready" ? result.session : undefined;
  assert.ok(session);
  const serialized = `${JSON.stringify(session)}\n${JSON.stringify(
    projectEvidenceHealth(session),
  )}`;
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("sk-"), false);
  assert.equal(serialized.includes(path), false);
  assert.equal(serialized.includes("/home/"), false);
  assert.equal(serialized.includes("Bearer "), false);
  assert.equal(serialized.includes("password"), false);
  for (const value of collectStrings([
    session,
    projectEvidenceHealth(session),
  ])) {
    assert.ok(
      value.length <= 256,
      `unbounded string of ${value.length} chars escaped`,
    );
  }
});

test("R57: the inventory diagnostic fires only when no observation instant exists", () => {
  const rows = {
    commands: [
      {
        name: "cmd",
        source: "extension",
        sourceLabel: "local",
        scope: "user",
        origin: "top-level",
      },
    ],
    skills: [],
    resources: [],
    toolSources: {},
  };
  const build = (
    inventory: Parameters<typeof buildCanonicalSession>[0]["inventory"],
  ) => {
    const result = buildCanonicalSession({
      parsed: parsed([MARKER]),
      scope: "tree",
      leafId: null,
      evidence: { atomic: [], folded: [] },
      ...(inventory === undefined ? {} : { inventory }),
    });
    assert.equal(result.state, "ready");
    return result.state === "ready" ? result.session : undefined;
  };
  const missingTime = (
    diagnostics: readonly {
      code: string;
      source: string;
      severity: string;
    }[],
  ) =>
    diagnostics.filter(
      (diagnostic) => diagnostic.code === "inventory-observation-time-missing",
    );

  // A genuinely instant-less observation input is the legacy-snapshot signal
  // (design §14.2/§14.3): it is diagnosed, and the source stays partial with
  // no fabricated observation time.
  const timeless = build(rows);
  assert.ok(timeless);
  assert.deepEqual(
    missingTime(timeless.health.diagnostics).map((diagnostic) => [
      diagnostic.source,
      diagnostic.severity,
    ]),
    [["inventory", "warning"]],
  );
  const timelessSource = timeless.health.sources.find(
    (row) => row.source === "inventory",
  );
  assert.equal(timelessSource?.state, "partial");
  assert.equal(timelessSource?.observedAt, undefined);

  // The same rows carrying their capture instant publish a supported
  // observation and no missing-time diagnostic.
  const observed = build({
    ...rows,
    observedAt: "2026-09-12T10:02:00.000Z",
  });
  assert.ok(observed);
  assert.deepEqual(missingTime(observed.health.diagnostics), []);
  const observedSource = observed.health.sources.find(
    (row) => row.source === "inventory",
  );
  assert.equal(observedSource?.state, "supported");
  assert.equal(observedSource?.observedAt, "2026-09-12T10:02:00.000Z");
});

test("P2.3: a pattern-valid but non-canonical integration key is never republished", () => {
  const folded: FoldedAggregateEvidence[] = [
    {
      kind: "checkpoint-wal-aggregates",
      sessionId: "s1",
      foldedThrough: { w1: 3 },
      sealedThrough: {},
      integrationCounters: {
        context: { reads: 2 },
        "evil-integration": { calls: 5 },
      },
      checkpointedAt: { state: "unavailable" },
      provenance: {
        source: "checkpoint",
        authority: "derived",
        schemaVersion: 1,
      },
    },
  ];
  const result = buildCanonicalSession({
    parsed: parsed([MARKER, ASSISTANT]),
    scope: "tree",
    leafId: null,
    evidence: { atomic: [], folded },
    walRecords: [skillRecord("evt-3", 3, "demo")],
  });
  assert.equal(result.state, "ready");
  const session = result.state === "ready" ? result.session : undefined;
  assert.ok(session);
  assert.deepEqual(Object.keys(session.retainedAggregates.integration ?? {}), [
    "context",
  ]);
  assert.equal(
    JSON.stringify(session.retainedAggregates).includes("evil-integration"),
    false,
  );
});

// ---------------------------------------------------------------------------
// Round 3 fix tests (usage-invalid)
// ---------------------------------------------------------------------------

/** An assistant whose `usage` record is structurally present but invalid. */
const INVALID_USAGE_ASSISTANT = {
  type: "message",
  id: "gen-invalid",
  parentId: "marker",
  timestamp: "2026-09-12T10:01:30.000Z",
  message: {
    role: "assistant",
    provider: "openai",
    model: "gpt",
    usage: {},
  },
};

test("R3a: a present-but-invalid usage emits no line and never changes the total", () => {
  const result = buildCanonicalSession({
    parsed: parsed([MARKER, ASSISTANT, INVALID_USAGE_ASSISTANT]),
    scope: "tree",
    leafId: null,
    evidence: { atomic: [], folded: [] },
  });
  assert.equal(result.state, "ready");
  const session = result.state === "ready" ? result.session : undefined;
  assert.ok(session);
  // The owner fact itself is preserved (spec §7.2 gate 8).
  assert.equal(session.generations.length, 2);
  assert.equal(session.usage.state, "known");
  assert.equal(session.usage.lines.length, 1);
  assert.equal(
    session.usage.lines.some(
      (line) => line.ownerId === "generation:gen-invalid",
    ),
    false,
  );
  assert.equal(
    session.usage.state === "known" ? session.usage.known.totalTokens : -1,
    100,
  );
});

test("R3b: a present-but-invalid usage marks its bucket coverage partial", () => {
  const result = buildCanonicalSession({
    parsed: parsed([MARKER, ASSISTANT, INVALID_USAGE_ASSISTANT]),
    scope: "tree",
    leafId: null,
    evidence: { atomic: [], folded: [] },
  });
  assert.equal(result.state, "ready");
  const session = result.state === "ready" ? result.session : undefined;
  assert.ok(session);
  const coverage = session.usage.coverage.generation;
  assert.equal(coverage.state, "partial");
  assert.equal(coverage.owners, 2);
  // Only the reducer-validated usage counts as ownersWithUsage.
  assert.equal(coverage.ownersWithUsage, 1);
});

test("R3c: health carries a bounded usage-invalid diagnostic for the rejected classes", () => {
  const invalidCompaction = {
    type: "compaction",
    id: "comp-invalid",
    parentId: "gen-invalid",
    timestamp: "2026-09-12T10:01:40.000Z",
    summary: "bounded",
    usage: {},
  };
  const callerWithTool = {
    type: "message",
    id: "gen-call-2",
    parentId: "marker",
    timestamp: "2026-09-12T10:01:50.000Z",
    message: {
      role: "assistant",
      provider: "openai",
      model: "gpt",
      content: [{ type: "toolCall", id: "call_2", name: "bash" }],
    },
  };
  const invalidToolResult = {
    type: "message",
    id: "res-2",
    parentId: "gen-call-2",
    timestamp: "2026-09-12T10:01:55.000Z",
    message: {
      role: "toolResult",
      toolCallId: "call_2",
      toolName: "bash",
      isError: false,
      usage: { totalTokens: "x", cost: { total: 0 } },
    },
  };
  const result = buildCanonicalSession({
    parsed: parsed([
      MARKER,
      ASSISTANT,
      TOOL_RESULT,
      INVALID_USAGE_ASSISTANT,
      invalidCompaction,
      callerWithTool,
      invalidToolResult,
    ]),
    scope: "tree",
    leafId: null,
    evidence: { atomic: [], folded: [] },
  });
  assert.equal(result.state, "ready");
  const session = result.state === "ready" ? result.session : undefined;
  assert.ok(session);
  const health = projectEvidenceHealth(session);
  const diagnostic = health.diagnostics.find(
    (entry) => entry.code === "usage-invalid",
  );
  assert.ok(diagnostic);
  assert.equal(diagnostic.source, "pi-jsonl");
  assert.equal(diagnostic.severity, "warning");
  assert.equal(diagnostic.count, 3);
  // Every rejected class also reads partial, so completeness is never claimed.
  assert.equal(session.usage.coverage.generation.state, "partial");
  assert.equal(session.usage.coverage.compaction.state, "partial");
  assert.equal(session.usage.coverage["tool-result"].state, "partial");
});

// ---------------------------------------------------------------------------
// Round 2 fix tests
// ---------------------------------------------------------------------------

test("P1.A: a usage-bearing branch summary emits a branch-summary usage line", () => {
  const fixture = readFileSync(
    "tests/fixtures/pi/0.85.1/usage-composition.jsonl",
    "utf8",
  );
  const result = buildCanonicalSession({
    parsed: parseSessionJsonl(fixture),
    scope: "tree",
    leafId: "b1",
    evidence: { atomic: [], folded: [] },
  });
  assert.equal(result.state, "ready");
  const session = result.state === "ready" ? result.session : undefined;
  assert.ok(session);
  assert.equal(session.usage.state, "known");
  if (session.usage.state !== "known") return;
  const branchLine = session.usage.lines.find(
    (line) => line.bucket === "branch-summary",
  );
  assert.ok(branchLine, "branch-summary usage line missing");
  assert.equal(branchLine.usage.totalTokens, 10);
  assert.equal(branchLine.contributesToSession, true);
  assert.equal(session.usage.composition.branchSummaries.totalTokens, 10);
  // Session total reconciles the branch summary instead of dropping it.
  assert.equal(session.usage.known.totalTokens, 180);
});

test("P1.A: a lone usage-bearing branch summary reconciles its own usage", () => {
  const branchSummary = {
    type: "branch_summary",
    id: "b-only",
    parentId: "marker",
    timestamp: "2026-09-12T10:05:00.000Z",
    summary: "bounded",
    usage: { totalTokens: 17, cost: { total: 0.017 } },
  };
  const result = buildCanonicalSession({
    parsed: parsed([MARKER, branchSummary]),
    scope: "tree",
    leafId: null,
    evidence: { atomic: [], folded: [] },
  });
  assert.equal(result.state, "ready");
  const session = result.state === "ready" ? result.session : undefined;
  assert.ok(session);
  assert.equal(session.usage.state, "known");
  if (session.usage.state !== "known") return;
  const branchLine = session.usage.lines.find(
    (line) => line.bucket === "branch-summary",
  );
  assert.ok(branchLine, "branch-summary usage line missing");
  assert.equal(branchLine.usage.totalTokens, 17);
  assert.deepEqual(session.usage.known, { totalTokens: 17, cost: 0.017 });
});

test("caps canonical agent-run input at 256 distinct rows and keeps admitted updates", () => {
  const subagents: SubagentSourceEvidence = {
    activity: {
      state: "supported",
      calls: 300,
      succeeded: 300,
      failed: 0,
      interrupted: 0,
      tools: [],
    },
    state: "supported",
    diagnostics: [],
    observations: [
      ...Array.from({ length: 300 }, (_, index) => {
        const id = index.toString(16).padStart(64, "0");
        return {
          sourceIdentity: `subagent-source-${id}`,
          order: index,
          run: {
            id: `subagent-${id}`,
            status: "succeeded" as const,
            confidence: "cooperative" as const,
            effortCoverage: {
              duration: "unavailable" as const,
              generations: "unavailable" as const,
              tools: "unavailable" as const,
              errors: "unavailable" as const,
              usage: "unavailable" as const,
              cost: "unavailable" as const,
            },
          },
        };
      }),
      {
        sourceIdentity: `subagent-source-${"0".repeat(64)}`,
        order: 300,
        run: {
          id: `subagent-${"0".repeat(64)}`,
          status: "succeeded" as const,
          confidence: "cooperative" as const,
          effortCoverage: {
            duration: "unavailable" as const,
            generations: "unavailable" as const,
            tools: "unavailable" as const,
            errors: "unavailable" as const,
            usage: "partial" as const,
            cost: "unavailable" as const,
          },
          usage: { totalTokens: 300 },
        },
      },
    ],
  };
  const result = buildCanonicalSession({
    parsed: parsed([MARKER]),
    scope: "tree",
    leafId: null,
    subagents,
    evidence: { atomic: [], folded: [] },
  });

  assert.equal(result.state, "ready");
  if (result.state !== "ready") return;
  assert.equal(result.session.agents.length, 256);
  assert.equal(result.session.agents[0]?.usage?.totalTokens, 300);
  assert.equal(result.session.health.joins.agentRuns, 256);
});

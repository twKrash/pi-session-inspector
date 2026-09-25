import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  AgentRun,
  AgentRunIdentityAlias,
  AgentRunSourceObservation,
} from "../../src/core/events.ts";
import { reconcileAgentRuns } from "../../src/core/subagent-reconciliation.ts";

type ReconcileResult = {
  runs: AgentRun[];
  diagnostics: readonly { code: string; count: number }[];
};

const sourceA = `subagent-source-${"a".repeat(64)}`;
const sourceB = `subagent-source-${"b".repeat(64)}`;
const sourceC = `subagent-source-${"d".repeat(64)}`;
const shared = `subagent-canonical-${"c".repeat(64)}`;
const publicIdA = `subagent-${"1".repeat(64)}`;
const publicIdB = `subagent-${"2".repeat(64)}`;
const publicIdC = `subagent-${"3".repeat(64)}`;
const effortCoverage: AgentRun["effortCoverage"] = {
  duration: "unavailable",
  generations: "unavailable",
  tools: "unavailable",
  errors: "unavailable",
  usage: "unavailable",
  cost: "unavailable",
};

const observation = (
  sourceIdentity: string,
  order: number,
  id: string,
  status: AgentRun["status"],
  fields: Partial<AgentRun> = {},
): AgentRunSourceObservation => ({
  sourceIdentity,
  order,
  run: {
    id,
    status,
    confidence: "cooperative",
    effortCoverage,
    ...fields,
  },
});

const observationA = observation(sourceA, 1, publicIdA, "running", {
  agent: "shared-agent",
  observedAt: "2026-09-24T19:00:00.000Z",
  usage: { totalTokens: 10 },
});
const observationB = observation(sourceB, 2, publicIdB, "succeeded", {
  agent: "shared-agent",
  observedAt: "2026-09-24T19:00:00.000Z",
  usage: { totalTokens: 20 },
});
const aliases: AgentRunIdentityAlias[] = [
  { sourceIdentity: sourceA, canonicalIdentity: shared, publicId: publicIdA },
  { sourceIdentity: sourceB, canonicalIdentity: shared, publicId: publicIdA },
];

function assertBoundedConflict(result: ReconcileResult): void {
  assert.equal(result.diagnostics.length, 1);
  const [diagnostic] = result.diagnostics;
  assert.deepEqual(Object.keys(diagnostic ?? {}).sort(), ["code", "count"]);
  assert.equal(diagnostic?.code, "cooperative-evidence-conflict");
  assert.ok(Number.isSafeInteger(diagnostic?.count));
  assert.ok((diagnostic?.count ?? 0) > 0);
  assert.ok((diagnostic?.count ?? 0) <= 256);
}

test("exact aliases merge while preserving an observed public ID", () => {
  const reconcile = reconcileAgentRuns;
  const result = reconcile([observationB, observationA], aliases);
  assert.equal(result.runs.length, 1);
  assert.equal(result.runs[0]?.id, publicIdA);
  assert.equal(result.runs[0]?.status, "succeeded");
  assert.deepEqual(result.runs[0]?.usage, { totalTokens: 20 });
  assert.deepEqual(reconcile([observationA, observationB], aliases), result);
});

test("same-order alias objects with equal bounded fields do not conflict", () => {
  const result = reconcileAgentRuns(
    [
      observation(sourceA, 7, publicIdA, "failed", {
        usage: { totalTokens: 7, cost: 0.5 },
        failure: { reason: "exit-nonzero", detail: 1 },
      }),
      observation(sourceB, 7, publicIdB, "failed", {
        usage: { cost: 0.5, totalTokens: 7 },
        failure: { detail: 1, reason: "exit-nonzero" },
      }),
    ],
    aliases,
  );

  assert.equal(result.runs.length, 1);
  assert.deepEqual(result.runs[0]?.usage, { totalTokens: 7, cost: 0.5 });
  assert.deepEqual(result.runs[0]?.failure, {
    reason: "exit-nonzero",
    detail: 1,
  });
  assert.deepEqual(result.diagnostics, []);
});

test("conflicted aliased effort fields report unavailable coverage", () => {
  const result = reconcileAgentRuns(
    [
      observation(sourceA, 7, publicIdA, "succeeded", {
        usage: { totalTokens: 7 },
        durationMs: 5,
        toolCalls: 1,
      }),
      observation(sourceB, 7, publicIdB, "succeeded", {
        usage: { totalTokens: 8 },
        durationMs: 6,
        toolCalls: 2,
      }),
    ],
    aliases,
  );
  const [run] = result.runs;

  assert.equal(result.runs.length, 1);
  assert.equal(run?.usage, undefined);
  assert.equal(run?.durationMs, undefined);
  assert.equal(run?.toolCalls, undefined);
  assert.deepEqual(run?.effortCoverage, {
    duration: "unavailable",
    generations: "unavailable",
    tools: "unavailable",
    errors: "unavailable",
    usage: "unavailable",
    cost: "unavailable",
  });
  assertBoundedConflict(result);
});

test("no alias means no merge by shared labels or timestamps", () => {
  const reconcile = reconcileAgentRuns;
  const result = reconcile([observationB, observationA]);
  assert.equal(result.runs.length, 2);
  assert.deepEqual(
    result.runs.map((run) => run.id),
    [publicIdA, publicIdB],
  );
});

test("latest valid fields upgrade absent values without summing usage", () => {
  const reconcile = reconcileAgentRuns;
  const result = reconcile([
    observation(sourceC, 1, publicIdC, "running"),
    observation(sourceC, 2, publicIdC, "succeeded", {
      model: "bounded-model",
      usage: { totalTokens: 7 },
    }),
  ]);
  assert.equal(result.runs.length, 1);
  assert.equal(result.runs[0]?.model, "bounded-model");
  assert.equal(result.runs[0]?.status, "succeeded");
  assert.deepEqual(result.runs[0]?.usage, { totalTokens: 7 });
});

test("conflicting parent and agent identities are withheld", () => {
  const reconcile = reconcileAgentRuns;
  const result = reconcile([
    observation(sourceC, 1, publicIdC, "running", {
      parentId: publicIdA,
      agent: "agent-one",
    }),
    observation(sourceC, 2, publicIdC, "succeeded", {
      parentId: publicIdB,
      agent: "agent-two",
    }),
  ]);
  assert.equal(result.runs[0]?.parentId, undefined);
  assert.equal(result.runs[0]?.agent, undefined);
  assert.equal(Object.hasOwn(result.runs[0] ?? {}, "parentId"), false);
  assert.equal(Object.hasOwn(result.runs[0] ?? {}, "agent"), false);
  assertBoundedConflict(result);
});

test("terminal-to-running regression becomes unknown regardless of input order", () => {
  const reconcile = reconcileAgentRuns;
  const terminal = observation(sourceC, 1, publicIdC, "succeeded");
  const regression = observation(sourceC, 2, publicIdC, "running");
  const forward = reconcile([terminal, regression]);
  const reverse = reconcile([regression, terminal]);
  assert.equal(forward.runs[0]?.status, "unknown");
  assert.deepEqual(reverse, forward);
  assertBoundedConflict(forward);
});

test("ambiguous aliases fall back to distinct source identities", () => {
  const reconcile = reconcileAgentRuns;
  const ambiguous: AgentRunIdentityAlias[] = [
    { sourceIdentity: sourceA, canonicalIdentity: shared, publicId: publicIdA },
    { sourceIdentity: sourceA, canonicalIdentity: shared, publicId: publicIdB },
    { sourceIdentity: sourceB, canonicalIdentity: shared, publicId: publicIdA },
  ];
  const result = reconcile([observationA, observationB], ambiguous);
  assert.equal(result.runs.length, 2);
  assertBoundedConflict(result);
});

test("conflicting or unobserved alias public IDs do not force a merge", () => {
  const reconcile = reconcileAgentRuns;
  const conflicting: AgentRunIdentityAlias[] = [
    { sourceIdentity: sourceA, canonicalIdentity: shared, publicId: publicIdA },
    { sourceIdentity: sourceB, canonicalIdentity: shared, publicId: publicIdB },
  ];
  const absent: AgentRunIdentityAlias[] = [
    { sourceIdentity: sourceA, canonicalIdentity: shared, publicId: publicIdC },
    { sourceIdentity: sourceB, canonicalIdentity: shared, publicId: publicIdC },
  ];
  for (const aliases of [conflicting, absent]) {
    const result = reconcile([observationA, observationB], aliases);
    assert.equal(result.runs.length, 2);
    assertBoundedConflict(result);
  }
});

test("fails closed when source identities exceed the bounded result", () => {
  const observations = Array.from({ length: 257 }, (_, order) => {
    const digest = order.toString(16).padStart(64, "0");
    return observation(
      `subagent-source-${digest}`,
      order,
      `subagent-${digest}`,
      "running",
    );
  });
  const forward = reconcileAgentRuns(observations);
  const reverse = reconcileAgentRuns([...observations].reverse());
  assert.deepEqual(forward, reverse);
  assert.equal(forward.runs.length, 0);
  assertBoundedConflict(forward);
});

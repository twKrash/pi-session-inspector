import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { ReducedSession, SessionEntry } from "../../src/core/events.ts";
import { readPiEntryEvidence } from "../../src/integrations/pi-entries.ts";
import { readSubagentEvidence as readSubagentEvidenceWithSession } from "../../src/integrations/subagents.ts";
import { MAX_COUNTER_KEYS } from "../../src/core/live-counter-fold.ts";
import { isAllowedIntegrationCounter } from "../../src/core/integration-counter-allowlists.ts";
import {
  MAX_HEALTH_DIAGNOSTICS,
  toSessionReport,
} from "../../src/core/reports.ts";
import {
  buildEvidenceHealth,
  MAX_EVIDENCE_COUNT,
} from "../../src/core/evidence-health.ts";
import type { CanonicalRetainedAggregates } from "../../src/core/retained-aggregates.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";

const SESSION_ID = "session-reports-test";
const readSubagentEvidence = (entries: readonly SessionEntry[]) =>
  readSubagentEvidenceWithSession(entries, SESSION_ID);

const parent: ReducedSession = {
  sessionId: "session-1",
  usage: { totalTokens: 100, cost: 10 },
  usageComposition: {
    generations: { totalTokens: 0, cost: 0 },
    toolResults: { totalTokens: 0, cost: 0 },
    compactions: { totalTokens: 0, cost: 0 },
    branchSummaries: { totalTokens: 0, cost: 0 },
  },
  generations: [],
  tools: [],
  compactions: [],
  errors: [],
};

test("projects explicit integration evidence without adding child usage", async () => {
  const fixture = await readFile(
    new URL(
      "../fixtures/pi/0.85.1/subagent-tool-results.jsonl",
      import.meta.url,
    ),
    "utf8",
  );
  const subagents = readSubagentEvidence(parseSessionJsonl(fixture).entries);
  const integrations = readPiEntryEvidence([
    {
      type: "custom",
      id: "context-1",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      customType: "ctx_status",
      data: { schemaVersion: 1, active: true },
    } satisfies SessionEntry,
  ]);

  const report = toSessionReport(parent, {
    agents: { state: subagents.state, runs: subagents.runs },
    integrations,
  });

  // Child-agent usage is a breakdown: the parent total is unchanged.
  assert.equal(report.usage.cost, 10);
  assert.equal(report.agentEvidence, "supported");
  const completed = report.agents.find((run) => run.status === "succeeded");
  assert.equal(completed?.usage?.cost, 0.1);
  assert.equal(completed?.agent, "reviewer");
  assert.match(report.agents[0]?.id ?? "", /^subagent-[a-f0-9]{64}$/);
  assert.equal(report.integrations[0]?.integration, "context");
  assert.equal(JSON.stringify(report).includes("PRIVATE_TASK"), false);
  assert.equal(
    JSON.stringify(report).includes("raw-tool-result-sentinel"),
    false,
  );
});

test("carries only bounded agent labels into agent rows", () => {
  const label = "a".repeat(64);
  const report = toSessionReport(parent, {
    agents: {
      state: "supported",
      runs: [
        {
          id: `subagent-${"0".repeat(64)}`,
          status: "succeeded",
          confidence: "cooperative",
          agent: label,
        },
        {
          id: `subagent-${"1".repeat(64)}`,
          status: "succeeded",
          confidence: "cooperative",
          agent: "/home/dev/PRIVATE/agent",
        },
      ],
    },
  });

  assert.equal(report.agents[0]?.agent, label);
  assert.equal(report.agents[1]?.agent, undefined);
});

test("projects only the bounded archive presence verdict on agent rows", () => {
  const report = toSessionReport(parent, {
    agents: {
      state: "supported",
      runs: [
        {
          id: `subagent-${"0".repeat(64)}`,
          status: "succeeded",
          confidence: "cooperative",
          artifacts: "available",
        },
        {
          id: `subagent-${"1".repeat(64)}`,
          status: "succeeded",
          confidence: "cooperative",
          artifacts: "missing",
        },
        {
          id: `subagent-${"2".repeat(64)}`,
          status: "succeeded",
          confidence: "cooperative",
          // A forged producer value must never reach the report.
          artifacts: "/home/dev/PRIVATE/archive.json" as never,
        },
      ],
    },
  });

  assert.equal(report.agents[0]?.artifacts, "available");
  assert.equal(report.agents[1]?.artifacts, "missing");
  assert.equal(report.agents[2]?.artifacts, undefined);
  assert.equal(JSON.stringify(report).includes("PRIVATE"), false);
});

test("defaults to unavailable integration rows when adapter evidence is absent", () => {
  const report = toSessionReport(parent);

  assert.deepEqual(report.agents, []);
  assert.deepEqual(report.integrations, []);
});

test("does not serialize short secret-looking counter keys", () => {
  const report = toSessionReport(parent, {
    integrations: [
      {
        integration: "context",
        version: 1,
        state: "supported",
        counters: { calls: 2, token: 1 },
      },
    ],
  });

  assert.deepEqual(report.integrations, [
    {
      integration: "context",
      presence: "unknown",
      version: 1,
      state: "supported",
      counters: { calls: 2 },
    },
  ]);
  assert.equal(JSON.stringify(report).includes('"token"'), false);
});

test("retains known unsupported integrations at unknown versions without counters", () => {
  const report = toSessionReport(parent, {
    integrations: [
      {
        integration: "context",
        version: 1,
        state: "unsupported",
        counters: { calls: 9 },
      },
      {
        integration: "rtk",
        version: 99,
        state: "unsupported",
      },
      {
        integration: "lens",
        version: 1,
        state: "supported",
        counters: { calls: 2 },
      },
    ],
  });

  assert.deepEqual(report.integrations, [
    {
      integration: "context",
      presence: "unknown",
      version: 1,
      state: "unsupported",
    },
    {
      integration: "rtk",
      presence: "unknown",
      version: 99,
      state: "unsupported",
    },
    {
      integration: "lens",
      presence: "unknown",
      version: 1,
      state: "supported",
      counters: { calls: 2 },
    },
  ]);
});

test("drops forged evidence fields and rows without projecting private values", () => {
  const privateSentinel = "private-evidence-sentinel".repeat(10);
  const report = toSessionReport(parent, {
    agents: {
      state: "supported",
      runs: [
        {
          id: "valid-agent",
          parentId: privateSentinel,
          status: "succeeded",
          confidence: "cooperative",
          usage: { totalTokens: Number.POSITIVE_INFINITY, cost: 1 },
        },
        {
          id: privateSentinel,
          parentId: "parent-agent",
          status: "succeeded",
          confidence: "cooperative",
          usage: { totalTokens: 1, cost: 1 },
        },
      ],
    },
    integrations: [
      {
        integration: "context",
        version: 1,
        state: "supported",
        counters: {
          calls: 2,
          enabled: true,
          infinite: Number.POSITIVE_INFINITY,
          negative: -1,
          [privateSentinel]: 1,
        },
      },
      {
        integration: privateSentinel as "context",
        version: 1,
        state: "supported",
      },
    ],
  });

  assert.deepEqual(report.agents, []);
  assert.deepEqual(report.integrations, [
    {
      integration: "context",
      presence: "unknown",
      version: 1,
      state: "supported",
      counters: { calls: 2 },
    },
  ]);
  assert.equal(JSON.stringify(report).includes(privateSentinel), false);
});

test("cold WAL notice uses the same defensive evidence projection", () => {
  assert.doesNotThrow(() =>
    toSessionReport(parent, {
      get walDetail(): "expired" {
        throw Error("producer getter");
      },
    }),
  );
  assert.equal(
    toSessionReport(parent, { walDetail: "expired" }).walDetail,
    "expired",
  );
});

const observedPresence = {
  context: "unknown",
  rtk: "unknown",
  ponytail: "present",
  caveman: "absent",
  permission: "present",
  subagents: "present",
  lens: "unknown",
} as const;

const foldedPermissionCounters = {
  counters: { permission: { decisions: 2, allowed: 1, denied: 1 } },
  skillInvocations: {},
  otherInvocations: 0,
  presence: { permission: true },
} as const;

test("emits one row per known integration with observation presence and counters", () => {
  const report = toSessionReport(parent, {
    presence: observedPresence,
    counters: foldedPermissionCounters,
    integrations: [
      {
        integration: "context",
        version: 1,
        state: "supported",
        counters: { calls: 2 },
      },
    ],
  });

  assert.deepEqual(
    report.integrations.map((row) => row.integration),
    [
      "context",
      "rtk",
      "ponytail",
      "caveman",
      "permission",
      "subagents",
      "lens",
    ],
  );
  assert.deepEqual(report.integrations[0], {
    integration: "context",
    // Supported evidence promotes the row to `present`; `unknown` is not a signal.
    presence: "present",
    version: 1,
    state: "supported",
    counters: { calls: 2 },
  });
  assert.deepEqual(
    report.integrations.find((row) => row.integration === "permission"),
    {
      integration: "permission",
      presence: "present",
      version: 1,
      state: "supported",
      counters: { decisions: 2, allowed: 1, denied: 1 },
    },
  );
  // A present producer with no evidence is still `unavailable`, never zero.
  assert.deepEqual(
    report.integrations.find((row) => row.integration === "subagents"),
    { integration: "subagents", presence: "present", state: "unavailable" },
  );
  assert.deepEqual(
    report.integrations.find((row) => row.integration === "caveman"),
    { integration: "caveman", presence: "absent", state: "unavailable" },
  );
});

test("keeps the legacy mode row beside the known keys without dropping it", () => {
  const report = toSessionReport(parent, {
    presence: observedPresence,
    integrations: [
      {
        integration: "mode",
        version: 1,
        state: "supported",
        counters: { changes: 1 },
      },
    ],
  });

  assert.equal(report.integrations.length, 8);
  assert.deepEqual(report.integrations[7], {
    integration: "mode",
    presence: "unknown",
    version: 1,
    state: "supported",
    counters: { changes: 1 },
  });
});

test("projects only bounded folded counter names and safe counts", () => {
  const report = toSessionReport(parent, {
    presence: observedPresence,
    counters: {
      counters: {
        permission: {
          decisions: 2,
          "private-evidence-sentinel token": 5,
          negative: -1,
        },
      },
      skillInvocations: {},
      otherInvocations: 0,
      presence: { permission: true },
    },
  });

  const permission = report.integrations.find(
    (row) => row.integration === "permission",
  );
  assert.deepEqual(permission?.counters, { decisions: 2 });
  assert.equal(
    JSON.stringify(report).includes("private-evidence-sentinel"),
    false,
  );
});

const foldedPermission = {
  counters: {
    permission: {
      decisions: 2,
      allowed: 1,
      denied: 1,
      prompts: 1,
      promptToolCall: 1,
      promptSkillInput: 1,
      promptSkillRead: 1,
      gateErrors: 1,
    },
  },
  skillInvocations: {},
  otherInvocations: 0,
  presence: { permission: true },
} as const;

test("projects folded permission counters named by the v1 allowlist", () => {
  const report = toSessionReport(parent, {
    presence: observedPresence,
    counters: foldedPermission,
  });

  const permission = report.integrations.find(
    (row) => row.integration === "permission",
  );
  assert.equal(permission?.state, "supported");
  assert.equal(permission?.presence, "present");
  assert.deepEqual(permission?.counters, foldedPermission.counters.permission);
});

test("rejects folded counters outside the per-integration allowlist", () => {
  const report = toSessionReport(parent, {
    presence: observedPresence,
    counters: {
      counters: {
        permission: { arbitraryName: 1, events: 1, granted: 1, decisions: 3 },
        subagents: { foo: 1 },
      },
      skillInvocations: {},
      otherInvocations: 0,
      presence: { permission: true },
    },
  });

  const permission = report.integrations.find(
    (row) => row.integration === "permission",
  );
  assert.deepEqual(permission?.counters, { decisions: 3 });
  const subagents = report.integrations.find(
    (row) => row.integration === "subagents",
  );
  assert.equal(subagents?.counters, undefined);
  assert.equal(subagents?.state, "unavailable");
});

test("carries exactly the spec 4.6 permission v1 counter allowlist", () => {
  const allowed = [
    "decisions",
    "allowed",
    "denied",
    "prompts",
    "promptToolCall",
    "promptSkillInput",
    "promptSkillRead",
    "gateErrors",
  ] as const;
  for (const key of allowed) {
    assert.equal(isAllowedIntegrationCounter("permission", 1, key), true, key);
  }
  for (const key of ["events", "granted", "arbitraryName", "gateWarning"]) {
    assert.equal(isAllowedIntegrationCounter("permission", 1, key), false, key);
  }
  assert.deepEqual(
    allowed.filter((key) => !isAllowedIntegrationCounter("permission", 1, key)),
    [],
  );
  // Subagents has no v1 folded counter vocabulary; rows come from agentActivity.
  assert.equal(isAllowedIntegrationCounter("subagents", 1, "foo"), false);
  assert.equal(isAllowedIntegrationCounter("subagents", 1, "runs"), false);
});

test("reports present for an evidence-only row with no inventory signal", () => {
  const report = toSessionReport(parent, {
    counters: {
      counters: { rtk: { compactions: 2 } },
      skillInvocations: {},
      otherInvocations: 0,
      presence: { permission: false },
    },
    integrations: [
      {
        integration: "rtk",
        version: 1,
        state: "supported",
        counters: { compactions: 2 },
      },
    ],
  });

  assert.deepEqual(
    report.integrations.find((row) => row.integration === "rtk"),
    {
      integration: "rtk",
      presence: "present",
      version: 1,
      state: "supported",
      counters: { compactions: 2 },
    },
  );
});

test("rejects rather than truncates a folded bucket above the fold key cap", () => {
  const permission: Record<string, number> = { decisions: 1 };
  for (let index = 0; index <= MAX_COUNTER_KEYS; index++)
    permission[`extra${index}`] = 1;
  assert.equal(Object.keys(permission).length, MAX_COUNTER_KEYS + 2);

  const report = toSessionReport(parent, {
    presence: observedPresence,
    counters: {
      counters: { permission },
      skillInvocations: {},
      otherInvocations: 0,
      presence: { permission: true },
    },
  });

  const row = report.integrations.find(
    (item) => item.integration === "permission",
  );
  assert.equal(row?.state, "unavailable");
  assert.equal(row?.counters, undefined);
});

/** Native subagent tool calls with no rich `details` projection at all. */
const nativeSubagentEntries: SessionEntry[] = [
  {
    id: "assistant-native",
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    type: "message",
    message: {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "call-native-1",
          name: "subagent",
          input: { task: "PRIVATE_TASK" },
        },
        { type: "toolCall", id: "call-native-2", name: "subagent_wait" },
      ],
    },
  },
  {
    id: "result-native-1",
    parentId: "assistant-native",
    timestamp: "2026-01-01T00:00:01.000Z",
    type: "message",
    message: {
      role: "toolResult",
      toolCallId: "call-native-1",
      toolName: "subagent",
      isError: false,
      content: [{ type: "text", text: "PRIVATE_TASK response" }],
    },
  },
];

test("carries native subagent activity even when rich runs are unavailable", () => {
  const native = readSubagentEvidence(nativeSubagentEntries);
  const report = toSessionReport(parent, {
    agents: { state: native.state, runs: native.runs },
    agentActivity: native.activity,
  });

  assert.equal(report.agentActivity.state, "supported");
  assert.equal(report.agentActivity.calls, 2);
  assert.equal(report.agentActivity.succeeded, 1);
  assert.equal(report.agentActivity.interrupted, 1);
  assert.deepEqual(report.agentActivity.tools, [
    { name: "subagent", calls: 1 },
    { name: "subagent_wait", calls: 1 },
  ]);
  assert.deepEqual(report.agents, []);
  assert.equal(report.agentEvidence, "unavailable");
  assert.equal(JSON.stringify(report).includes("PRIVATE_TASK"), false);
});

test("reports unavailable zero activity when no subagent evidence is assembled", () => {
  const report = toSessionReport(parent);

  assert.equal(report.agentActivity.state, "unavailable");
  assert.equal(report.agentActivity.calls, 0);
  assert.equal(report.agentActivity.succeeded, 0);
  assert.equal(report.agentActivity.failed, 0);
  assert.equal(report.agentActivity.interrupted, 0);
  assert.deepEqual(report.agentActivity.tools, []);
  assert.equal(report.agentActivity.usage, undefined);
});

test("never adds aggregate subagent activity usage to session totals", () => {
  const entries: SessionEntry[] = [
    {
      id: "assistant-usage",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id: "call-usage-1", name: "subagent" }],
      },
    },
    {
      id: "result-usage",
      parentId: "assistant-usage",
      timestamp: "2026-01-01T00:00:01.000Z",
      type: "message",
      message: {
        role: "toolResult",
        toolCallId: "call-usage-1",
        toolName: "subagent",
        isError: false,
        usage: { totalTokens: 500, cost: 5 },
      },
    },
  ];
  const evidence = readSubagentEvidence(entries);
  const report = toSessionReport(parent, { agentActivity: evidence.activity });

  assert.equal(report.agentActivity.usage?.totalTokens, 500);
  assert.equal(report.agentActivity.usage?.cost, 5);
  // Session totals are owned by the Pi reduction, never the child breakdown.
  assert.equal(report.usage.totalTokens, 100);
  assert.equal(report.usage.cost, 10);
});

test("drops invalid activity counts, unbounded names, and usage", () => {
  const report = toSessionReport(parent, {
    agentActivity: {
      state: "supported",
      calls: 3,
      succeeded: 1,
      failed: 1,
      interrupted: 1,
      tools: [
        { name: "subagent", calls: 3 },
        { name: "/home/dev/PRIVATE", calls: 1 } as never,
        { name: "subagent_wait", calls: -1 } as never,
      ],
      usage: { totalTokens: Number.POSITIVE_INFINITY, cost: 1 } as never,
    },
  });

  assert.equal(report.agentActivity.state, "supported");
  assert.deepEqual(report.agentActivity.tools, [
    { name: "subagent", calls: 3 },
  ]);
  assert.equal(report.agentActivity.usage, undefined);
  assert.equal(JSON.stringify(report).includes("PRIVATE"), false);
});

test("projects bounded exit-code failure details and drops out-of-range ones", () => {
  const run = (seed: string, detail: number) => ({
    id: `subagent-${seed.repeat(64)}`,
    status: "failed" as const,
    confidence: "cooperative" as const,
    failure: { reason: "exit-nonzero" as const, detail },
  });
  const report = toSessionReport(parent, {
    agents: {
      state: "supported",
      runs: [run("a", 2_147_483_647), run("b", 2_147_483_648), run("c", -1)],
    },
  });
  assert.deepEqual(report.agents[0]?.failure, {
    reason: "exit-nonzero",
    detail: 2_147_483_647,
  });
  assert.deepEqual(report.agents[1]?.failure, { reason: "exit-nonzero" });
  assert.deepEqual(report.agents[2]?.failure, { reason: "exit-nonzero" });
});

// --- Task 14: canonical health and retained aggregates on the report DTO ---

/** A valid health built through the canonical builder, not a hand-rolled shape. */
function sampleHealth() {
  return buildEvidenceHealth({
    core: "supported",
    sources: [
      {
        source: "inspector-wal",
        authority: "live",
        state: "supported",
        schemaVersion: 1,
        recordsSeen: 3,
        factsAccepted: 2,
        recordsRejected: 1,
        detail: "full",
      },
      {
        source: "pi-jsonl",
        authority: "native",
        state: "partial",
        schemaVersion: 3,
        recordsSeen: 5,
        factsAccepted: 4,
        recordsRejected: 1,
        detail: "full",
      },
    ],
    joins: {
      toolCalls: 1,
      toolResults: 1,
      matchedToolResults: 1,
      matchedLiveToolTimings: 1,
      agentRuns: 1,
      knownAgentParents: 1,
    },
    usage: {
      nativeLines: 1,
      childLines: 0,
      compositionReconciled: true,
      dated: "supported",
    },
    aggregates: {
      detail: "aggregate-only",
      integrationCounters: 1,
      skillInvocations: { names: 1, overflow: 0, retainedInvocations: 1 },
      permissionPresence: "supported",
      resources: "supported",
    },
    diagnostics: [],
  });
}

const aggregateBoundary = {
  foldedThrough: { "writer-a": 4 },
  sealedThrough: {},
};

function sampleAggregates(): CanonicalRetainedAggregates {
  return {
    schemaVersion: 1,
    boundary: {
      detail: "aggregate-only",
      foldedThrough: { "writer-a": 4 },
      sealedThrough: {},
      checkpointedAt: {
        state: "known",
        at: "2026-09-07T00:00:00.000Z",
        basis: "checkpoint-observer",
      },
    },
    integration: {
      permission: {
        value: { decisions: 2 },
        state: "aggregate-only",
        boundary: aggregateBoundary,
      },
    },
    skillInvocations: {
      named: {
        value: { demo: 3 },
        state: "aggregate-only",
        boundary: aggregateBoundary,
      },
    },
    permissionPresence: {
      value: true,
      state: "aggregate-only",
      boundary: aggregateBoundary,
    },
  };
}

test("report exposes bounded health and labels aggregate-only counts", () => {
  // Seeded sentinel: a `req-`-prefixed producer string is offered where only a
  // canonical key/instant may survive. Without it, the absence assertion below
  // is vacuous (nothing in the input could ever have carried the substring).
  const seededSentinel = "req-private sentinel";
  const seeded = {
    ...sampleAggregates(),
    boundary: {
      ...sampleAggregates().boundary,
      checkpointedAt: {
        state: "known",
        at: seededSentinel,
        basis: "checkpoint-observer",
      },
    },
    integration: {
      permission: {
        value: { decisions: 2, [seededSentinel]: 9 },
        state: "aggregate-only",
        boundary: aggregateBoundary,
      },
    },
    skillInvocations: {
      named: {
        value: { demo: 3, [seededSentinel]: 9 },
        state: "aggregate-only",
        boundary: aggregateBoundary,
      },
    },
  } as unknown as CanonicalRetainedAggregates;
  const report = toSessionReport(parent, {
    evidenceHealth: sampleHealth(),
    retainedAggregates: seeded,
  });

  assert.equal(JSON.stringify(seeded).includes("req-"), true);
  assert.equal(report.evidenceHealth.aggregates.detail, "aggregate-only");
  assert.equal(JSON.stringify(report).includes("req-"), false);
  // Both seeded carriers were dropped, and the valid values survived.
  assert.equal(
    report.retainedAggregates?.integration?.permission?.value.decisions,
    2,
  );
  assert.deepEqual(
    Object.keys(
      report.retainedAggregates?.integration?.permission?.value ?? {},
    ),
    ["decisions"],
  );
  assert.deepEqual(
    Object.keys(
      report.retainedAggregates?.skillInvocations?.named?.value ?? {},
    ),
    ["demo"],
  );
  assert.equal(
    report.retainedAggregates?.boundary.checkpointedAt.state,
    "unavailable",
  );
  // Fixed source order, regardless of input order.
  assert.equal(
    report.evidenceHealth.sources.map((source) => source.source).join(),
    "pi-jsonl,inspector-wal",
  );
  assert.equal(report.retainedAggregates?.boundary.detail, "aggregate-only");
  assert.equal(
    report.retainedAggregates?.integration?.permission?.value.decisions,
    2,
  );
  assert.equal(
    report.retainedAggregates?.skillInvocations?.named?.value.demo,
    3,
  );
});

test("T14: forged projection counts are clamped to the bounded health range", () => {
  const forged = {
    ...sampleHealth(),
    joins: {
      ...sampleHealth().joins,
      // A safe integer beyond the projection bound, at the bound, and below it.
      toolCalls: MAX_EVIDENCE_COUNT + 1,
      matchedToolResults: MAX_EVIDENCE_COUNT,
      agentRuns: -1,
    },
    usage: { ...sampleHealth().usage, nativeLines: MAX_EVIDENCE_COUNT + 1 },
    aggregates: {
      ...sampleHealth().aggregates,
      integrationCounters: MAX_EVIDENCE_COUNT + 1,
    },
    diagnostics: [
      {
        code: "unknown-entry",
        severity: "info",
        count: MAX_EVIDENCE_COUNT + 1,
        source: "pi-jsonl",
      },
      {
        code: "usage-invalid",
        severity: "warning",
        count: 0,
        source: "inspector-wal",
      },
    ],
  } as never;

  const report = toSessionReport(parent, { evidenceHealth: forged });

  assert.equal(report.evidenceHealth.joins.toolCalls, 0);
  assert.equal(
    report.evidenceHealth.joins.matchedToolResults,
    MAX_EVIDENCE_COUNT,
  );
  assert.equal(report.evidenceHealth.joins.agentRuns, 0);
  assert.equal(report.evidenceHealth.usage.nativeLines, 0);
  assert.equal(report.evidenceHealth.aggregates.integrationCounters, 0);
  // A diagnostic count is a positive bounded count: out-of-range floors to 1.
  assert.deepEqual(
    report.evidenceHealth.diagnostics.map((row) => row.count),
    [1, 1],
  );
});

test("T14: the projection caps diagnostics at the bounded row budget", () => {
  // `MAX_HEALTH_DIAGNOSTICS` is the projection's row budget: it bounds the
  // forged rows the projection reads, before the rebuilt health merges them by
  // source+code (`MAX_HEALTH_DIAGNOSTICS + 4` duplicates merge to one row with
  // a count of exactly the budget, so a raised/removed bound changes the count).
  const diagnostics = Array.from(
    { length: MAX_HEALTH_DIAGNOSTICS + 4 },
    () => ({
      code: "unknown-entry",
      severity: "info",
      count: 1,
      source: "pi-jsonl" as const,
    }),
  );
  const forged = { ...sampleHealth(), diagnostics } as never;

  const report = toSessionReport(parent, { evidenceHealth: forged });

  assert.equal(report.evidenceHealth.diagnostics.length, 1);
  assert.deepEqual(report.evidenceHealth.diagnostics, [
    {
      code: "unknown-entry",
      severity: "info",
      count: MAX_HEALTH_DIAGNOSTICS,
      source: "pi-jsonl",
    },
  ]);
});

test("T14: an aggregate value in any state other than aggregate-only is dropped", () => {
  const forged = {
    ...sampleAggregates(),
    integration: {
      permission: {
        value: { decisions: 2 },
        state: "retained",
        boundary: aggregateBoundary,
      },
    },
    skillInvocations: {
      named: {
        value: { demo: 3 },
        state: "full",
        boundary: aggregateBoundary,
      },
      overflow: {
        value: 4,
        state: "aggregate-only",
        boundary: aggregateBoundary,
      },
    },
    permissionPresence: {
      value: true,
      state: "expired",
      boundary: aggregateBoundary,
    },
    resources: {
      counts: { commands: 1, skills: 1 },
      state: "expired",
      observedAt: { state: "unavailable" },
    },
  } as never;

  const report = toSessionReport(parent, { retainedAggregates: forged });

  assert.equal(report.retainedAggregates?.integration, undefined);
  assert.equal(report.retainedAggregates?.skillInvocations?.named, undefined);
  assert.equal(report.retainedAggregates?.permissionPresence, undefined);
  assert.equal(report.retainedAggregates?.resources, undefined);
  // The one well-formed value is still published.
  assert.equal(report.retainedAggregates?.skillInvocations?.overflow?.value, 4);
  assert.equal(report.retainedAggregates?.boundary.detail, "aggregate-only");
});

test("T14: a forged diagnostic severity falls back to the code's default", () => {
  const forged = {
    ...sampleHealth(),
    diagnostics: [
      {
        code: "unknown-entry",
        severity: "fatal",
        count: 1,
        source: "pi-jsonl",
      },
      {
        code: "usage-invalid",
        severity: 7,
        count: 1,
        source: "inspector-wal",
      },
      {
        code: "tracking-marker-missing",
        severity: "critical",
        count: 1,
        source: "pi-jsonl",
      },
    ],
  } as never;

  const report = toSessionReport(parent, { evidenceHealth: forged });

  assert.deepEqual(
    report.evidenceHealth.diagnostics.map((row) => [row.code, row.severity]),
    // Sorted by source then code, exactly as the canonical health sorts.
    [
      ["tracking-marker-missing", "warning"],
      ["unknown-entry", "info"],
      ["usage-invalid", "warning"],
    ],
  );
});

test("emits an unavailable health shape when no health is supplied", () => {
  const report = toSessionReport(parent);

  assert.equal(report.evidenceHealth.schemaVersion, 1);
  assert.equal(report.evidenceHealth.core, "unavailable");
  assert.deepEqual(report.evidenceHealth.sources, []);
  assert.deepEqual(report.evidenceHealth.joins, {
    toolCalls: 0,
    toolResults: 0,
    matchedToolResults: 0,
    matchedLiveToolTimings: 0,
    agentRuns: 0,
    knownAgentParents: 0,
  });
  assert.equal(report.evidenceHealth.usage.dated, "unavailable");
  assert.equal(report.evidenceHealth.aggregates.detail, "expired");
  assert.deepEqual(report.evidenceHealth.diagnostics, []);
  assert.equal(report.retainedAggregates, undefined);
  // Every renderer sees the same shape, even with no evidence at all.
  assert.deepEqual(report.evidenceHealth, {
    schemaVersion: 1,
    core: "unavailable",
    sources: [],
    joins: {
      toolCalls: 0,
      toolResults: 0,
      matchedToolResults: 0,
      matchedLiveToolTimings: 0,
      agentRuns: 0,
      knownAgentParents: 0,
    },
    usage: {
      nativeLines: 0,
      childLines: 0,
      compositionReconciled: false,
      dated: "unavailable",
    },
    aggregates: {
      detail: "expired",
      integrationCounters: 0,
      skillInvocations: { names: 0, overflow: 0, retainedInvocations: 0 },
      permissionPresence: "unavailable",
      resources: "unavailable",
    },
    diagnostics: [],
  });
});

test("re-validates forged health so no out-of-enum or unbounded value survives", () => {
  const sentinel = "req-private-health".repeat(8);
  const forged = {
    schemaVersion: 1,
    core: "hacked",
    sources: [
      {
        source: "evil-source",
        authority: "native",
        state: "supported",
        recordsSeen: 1,
        factsAccepted: 1,
        recordsRejected: 0,
        detail: "full",
      },
      {
        source: "pi-jsonl",
        authority: "native",
        state: "supported",
        schemaVersion: 3,
        recordsSeen: Number.POSITIVE_INFINITY,
        factsAccepted: -5,
        recordsRejected: 1,
        detail: "full",
      },
      {
        source: "inspector-wal",
        authority: "live",
        state: "partial",
        schemaVersion: 1,
        recordsSeen: 2,
        factsAccepted: 1,
        recordsRejected: 0,
        detail: "full",
        observedAt: sentinel,
      },
    ],
    joins: {
      toolCalls: -1,
      toolResults: "5",
      matchedToolResults: 1,
      matchedLiveToolTimings: 1,
      agentRuns: 1,
      knownAgentParents: 1,
    },
    usage: {
      nativeLines: 1,
      childLines: 0,
      compositionReconciled: "yes",
      dated: "bogus",
    },
    aggregates: {
      detail: "bogus",
      integrationCounters: 1,
      skillInvocations: { names: 1, overflow: 0, retainedInvocations: 1 },
      permissionPresence: "hacked",
      resources: "expired",
    },
    diagnostics: [
      {
        code: "hacked-code",
        severity: "fatal",
        count: 1,
        source: "pi-jsonl",
      },
      {
        code: "unknown-entry",
        severity: "warning",
        count: 2,
        source: "pi-jsonl",
      },
    ],
  } as never;

  const report = toSessionReport(parent, { evidenceHealth: forged });

  assert.equal(report.evidenceHealth.core, "unavailable");
  assert.deepEqual(
    report.evidenceHealth.sources.map((source) => source.source),
    ["pi-jsonl", "inspector-wal"],
  );
  assert.equal(
    report.evidenceHealth.sources.find((s) => s.source === "pi-jsonl")
      ?.recordsSeen,
    0,
  );
  assert.equal(report.evidenceHealth.usage.compositionReconciled, false);
  assert.equal(report.evidenceHealth.usage.dated, "unavailable");
  assert.equal(report.evidenceHealth.aggregates.detail, "expired");
  assert.equal(
    report.evidenceHealth.aggregates.permissionPresence,
    "unavailable",
  );
  assert.deepEqual(
    report.evidenceHealth.diagnostics.map((row) => row.code),
    ["unknown-entry"],
  );
  assert.equal(JSON.stringify(report).includes(sentinel), false);
});

test("re-validates forged retained aggregates to canonical keys and bounds", () => {
  const sentinel = "req-private-aggregate".repeat(8);
  const forged = {
    schemaVersion: 1,
    boundary: {
      detail: "aggregate-only",
      foldedThrough: { "writer-a": 4 },
      sealedThrough: {},
      checkpointedAt: { state: "known", at: sentinel, basis: "bogus" },
    },
    integration: {
      permission: {
        value: { decisions: 2, [sentinel]: 9 },
        state: "aggregate-only",
        boundary: aggregateBoundary,
      },
      "evil-integration": {
        value: { calls: 1 },
        state: "aggregate-only",
        boundary: aggregateBoundary,
      },
    },
    skillInvocations: {
      named: {
        value: { demo: 3, [sentinel]: 1 },
        state: "aggregate-only",
        boundary: aggregateBoundary,
      },
    },
  } as never;

  const report = toSessionReport(parent, { retainedAggregates: forged });

  assert.equal(report.retainedAggregates?.boundary.detail, "aggregate-only");
  assert.equal(
    report.retainedAggregates?.integration?.permission?.value.decisions,
    2,
  );
  assert.equal(
    (report.retainedAggregates?.integration as Record<string, unknown>)?.[
      "evil-integration"
    ],
    undefined,
  );
  assert.equal(
    report.retainedAggregates?.skillInvocations?.named?.value.demo,
    3,
  );
  assert.equal(
    report.retainedAggregates?.boundary.checkpointedAt.state,
    "unavailable",
  );
  assert.equal(JSON.stringify(report).includes(sentinel), false);
});

test("drops a whole retained aggregate when the boundary is forged", () => {
  const report = toSessionReport(parent, {
    retainedAggregates: {
      schemaVersion: 1,
      boundary: {
        detail: "aggregate-only",
        foldedThrough: { "writer-a": "NaN" },
        sealedThrough: {},
        checkpointedAt: { state: "unavailable" },
      },
    } as never,
  });

  assert.equal(report.retainedAggregates, undefined);
});

test("drops a retained aggregate when a sealed writer is missing from foldedThrough", () => {
  // A seal without a fold cursor cannot be merged: the boundary is
  // inconsistent, so the whole aggregate must be dropped, never repaired.
  const report = toSessionReport(parent, {
    retainedAggregates: {
      ...sampleAggregates(),
      boundary: {
        ...sampleAggregates().boundary,
        foldedThrough: { "writer-a": 4 },
        sealedThrough: { "writer-b": 2 },
      },
    } as never,
  });

  assert.equal(report.retainedAggregates, undefined);
});

test("drops a retained aggregate when a seal exceeds its fold cursor", () => {
  const report = toSessionReport(parent, {
    retainedAggregates: {
      ...sampleAggregates(),
      boundary: {
        ...sampleAggregates().boundary,
        foldedThrough: { "writer-a": 4 },
        sealedThrough: { "writer-a": 5 },
      },
    } as never,
  });

  assert.equal(report.retainedAggregates, undefined);
});

test("drops a retained aggregate when an expired boundary still carries cursors", () => {
  const report = toSessionReport(parent, {
    retainedAggregates: {
      schemaVersion: 1,
      boundary: {
        detail: "expired",
        foldedThrough: { "writer-a": 4 },
        sealedThrough: { "writer-a": 4 },
        checkpointedAt: { state: "unavailable" },
      },
    } as never,
  });

  assert.equal(report.retainedAggregates, undefined);
});

test("keeps a retained aggregate for an underscore-leading writer id", () => {
  // The storage writer grammar accepts underscore-leading tokens; the report
  // projection must use the same grammar so a real writer is never dropped.
  const report = toSessionReport(parent, {
    retainedAggregates: {
      schemaVersion: 1,
      boundary: {
        detail: "aggregate-only",
        foldedThrough: { _writer: 4 },
        sealedThrough: { _writer: 4 },
        checkpointedAt: { state: "unavailable" },
      },
      integration: {
        permission: {
          value: { decisions: 2 },
          state: "aggregate-only",
          boundary: { foldedThrough: { _writer: 4 }, sealedThrough: {} },
        },
      },
    } as never,
  });

  assert.equal(report.retainedAggregates?.boundary.foldedThrough._writer, 4);
  assert.equal(
    report.retainedAggregates?.integration?.permission?.value.decisions,
    2,
  );
});

test("preserves a supplied truncated boolean and rejects other supplied types", () => {
  const preserved = toSessionReport(parent, {
    evidenceHealth: { ...sampleHealth(), truncated: true } as never,
  });
  assert.equal(preserved.evidenceHealth.truncated, true);

  const rejected = toSessionReport(parent, {
    evidenceHealth: { ...sampleHealth(), truncated: "yes" } as never,
  });
  assert.equal(rejected.evidenceHealth.truncated, undefined);
});

test("keeps a __proto__ writer id in the boundary with its aggregate", () => {
  // `__proto__` is a legal storage writer id (underscore-leading token). A
  // plain-object cursor map silently loses it, which would drop the writer
  // from the boundary while keeping the aggregate: exactly what the
  // projection forbids. Computed keys keep it an own property on the way in.
  const boundaryCursor = { ["__proto__"]: 4 };
  const report = toSessionReport(parent, {
    retainedAggregates: {
      schemaVersion: 1,
      boundary: {
        detail: "aggregate-only",
        foldedThrough: boundaryCursor,
        sealedThrough: { ["__proto__"]: 4 },
        checkpointedAt: { state: "unavailable" },
      },
      integration: {
        permission: {
          value: { decisions: 2 },
          state: "aggregate-only",
          boundary: { foldedThrough: boundaryCursor, sealedThrough: {} },
        },
      },
    } as never,
  });

  const folded = report.retainedAggregates?.boundary.foldedThrough as
    | Record<string, number>
    | undefined;
  assert.ok(folded);
  assert.equal(Object.hasOwn(folded, "__proto__"), true);
  assert.equal(folded["__proto__"], 4);
  assert.equal(
    Object.hasOwn(
      report.retainedAggregates?.boundary.sealedThrough ?? {},
      "__proto__",
    ),
    true,
  );
  assert.equal(
    report.retainedAggregates?.integration?.permission?.value.decisions,
    2,
  );
});

test("drops a retained aggregate for writer ids outside the token grammar", () => {
  const tooLong = "w".repeat(129);
  const longReport = toSessionReport(parent, {
    retainedAggregates: {
      schemaVersion: 1,
      boundary: {
        detail: "aggregate-only",
        foldedThrough: { [tooLong]: 0 },
        sealedThrough: {},
        checkpointedAt: { state: "unavailable" },
      },
    } as never,
  });
  assert.equal(longReport.retainedAggregates, undefined);

  const slashReport = toSessionReport(parent, {
    retainedAggregates: {
      schemaVersion: 1,
      boundary: {
        detail: "aggregate-only",
        foldedThrough: { "writer/a": 0 },
        sealedThrough: {},
        checkpointedAt: { state: "unavailable" },
      },
    } as never,
  });
  assert.equal(slashReport.retainedAggregates, undefined);
});

test("drops a retained aggregate when only one expired cursor map is populated", () => {
  const report = toSessionReport(parent, {
    retainedAggregates: {
      schemaVersion: 1,
      boundary: {
        detail: "expired",
        foldedThrough: { "writer-a": 4 },
        sealedThrough: {},
        checkpointedAt: { state: "unavailable" },
      },
    } as never,
  });

  assert.equal(report.retainedAggregates, undefined);
});

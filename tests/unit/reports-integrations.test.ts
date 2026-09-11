import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { ReducedSession, SessionEntry } from "../../src/core/events.ts";
import { readPiEntryEvidence } from "../../src/integrations/pi-entries.ts";
import { readSubagentEvidence } from "../../src/integrations/subagents.ts";
import { MAX_COUNTER_KEYS } from "../../src/core/live-counter-fold.ts";
import { isAllowedIntegrationCounter } from "../../src/core/integration-counter-allowlists.ts";
import { toSessionReport } from "../../src/core/reports.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";

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

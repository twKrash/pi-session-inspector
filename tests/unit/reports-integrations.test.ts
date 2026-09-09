import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReducedSession, SessionEntry } from "../../src/core/events.ts";
import { readPiEntryEvidence } from "../../src/integrations/pi-entries.ts";
import { readSubagentRuns } from "../../src/integrations/subagents.ts";
import { toSessionReport } from "../../src/core/reports.ts";

const parent: ReducedSession = {
  sessionId: "session-1",
  usage: { totalTokens: 100, cost: 10 },
  generations: [],
  tools: [],
  compactions: [],
};

test("projects explicit integration evidence without adding child usage", () => {
  const subagents = readSubagentRuns({
    version: 1,
    runs: [
      {
        id: "child-run",
        parentId: "parent-run",
        status: "complete",
        usage: { totalTokens: 60, cost: 3 },
      },
    ],
  });
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
    agents: subagents,
    integrations,
  });

  assert.equal(report.usage.cost, 10);
  assert.equal(report.agents[0]?.usage?.cost, 3);
  assert.equal(report.integrations[0]?.integration, "context");
  assert.equal(
    JSON.stringify(report).includes("raw-tool-result-sentinel"),
    false,
  );
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
      version: 1,
      state: "supported",
      counters: { calls: 2 },
    },
  ]);
  assert.equal(JSON.stringify(report).includes('"token"'), false);
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

  assert.deepEqual(report.agents, [
    {
      id: "valid-agent",
      status: "succeeded",
      confidence: "cooperative",
    },
  ]);
  assert.deepEqual(report.integrations, [
    {
      integration: "context",
      version: 1,
      state: "supported",
      counters: { calls: 2 },
    },
  ]);
  assert.equal(JSON.stringify(report).includes(privateSentinel), false);
});

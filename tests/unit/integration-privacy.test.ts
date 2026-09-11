import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReducedSession, SessionEntry } from "../../src/core/events.ts";
import { toSessionReport } from "../../src/core/reports.ts";
import { renderJson } from "../../src/ui/json.ts";
import { createEvidenceRegistry } from "../../src/integrations/evidence.ts";
import { readPiEntryEvidence } from "../../src/integrations/pi-entries.ts";
import { readSubagentEvidence } from "../../src/integrations/subagents.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";

const secret = "m5-seeded-secret";
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

test("privacy corpus excludes seeded secrets from every integration adapter and report JSON", () => {
  const registry = createEvidenceRegistry([
    {
      integration: "context",
      version: 1,
      read: (value) => ({ counters: { calls: value.calls ?? 0 } }),
    },
  ]);
  const registryOutput = registry.read({
    integration: "context",
    version: 1,
    value: { calls: 1, private: secret },
  });
  const piEntryOutput = readPiEntryEvidence([
    {
      type: "custom",
      id: "context-1",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      customType: "ctx_status",
      data: { schemaVersion: 1, active: true, private: secret },
    } satisfies SessionEntry,
  ]);
  const producerCompletionId = `completion-${secret}`;
  const producerChildId = `child-${secret}`;
  const subagentEvidence = readSubagentEvidence(
    parseSessionJsonl(
      [
        JSON.stringify({ type: "session", version: 3, id: "session-1" }),
        JSON.stringify({
          type: "message",
          id: "m1",
          parentId: null,
          timestamp: "2026-01-01T00:00:00.000Z",
          message: {
            role: "assistant",
            provider: "acme",
            model: "alpha",
            content: [{ type: "toolCall", id: "c1", name: "subagent_wait" }],
          },
        }),
        JSON.stringify({
          type: "message",
          id: "m2",
          parentId: "m1",
          timestamp: "2026-01-01T00:00:01.000Z",
          message: {
            role: "toolResult",
            toolCallId: "c1",
            toolName: "subagent_wait",
            isError: false,
            content: [],
            usage: {
              input: 5,
              output: 4,
              cacheRead: 3,
              cacheWrite: 2,
              totalTokens: 14,
              cost: { total: 0.02 },
            },
            details: {
              completions: [
                {
                  runId: producerCompletionId,
                  agent: "workflow",
                  state: "complete",
                  success: true,
                  results: [
                    {
                      runId: producerChildId,
                      agent: "reviewer",
                      success: false,
                    },
                  ],
                },
              ],
            },
          },
        }),
      ].join("\n"),
    ).entries,
  );
  const subagentOutput = {
    state: subagentEvidence.state,
    runs: subagentEvidence.runs,
  };
  const report = toSessionReport(parent, {
    agents: subagentOutput,
    integrations: piEntryOutput,
  });

  assert.equal(subagentOutput.state, "supported");
  assert.equal(subagentOutput.runs.length, 2);
  assert.match(subagentOutput.runs[0]?.id ?? "", /^subagent-[a-f0-9]{64}$/);
  assert.equal(subagentOutput.runs[0]?.parentId, undefined);
  assert.equal(subagentOutput.runs[1]?.parentId, subagentOutput.runs[0]?.id);
  assert.deepEqual(report.agents, subagentOutput.runs);

  for (const output of [
    registryOutput,
    piEntryOutput,
    subagentEvidence,
    report,
    renderJson(report),
  ]) {
    const json = JSON.stringify(output);
    assert.equal(json.includes(secret), false);
    assert.equal(json.includes(producerChildId), false);
    assert.equal(json.includes(producerCompletionId), false);
  }
});

test("missing subagent tool results remain unavailable rather than supported", () => {
  const entries = parseSessionJsonl(
    [
      JSON.stringify({ type: "session", version: 3, id: "session-1" }),
      JSON.stringify({
        type: "message",
        id: "m1",
        parentId: null,
        timestamp: "2026-01-01T00:00:00.000Z",
        message: {
          role: "assistant",
          provider: "acme",
          model: "alpha",
          content: [{ type: "toolCall", id: "c9", name: "read" }],
        },
      }),
    ].join("\n"),
  ).entries;
  const evidence = readSubagentEvidence(entries);
  const report = toSessionReport(parent, {
    agents: { state: evidence.state, runs: evidence.runs },
  });

  assert.equal(evidence.state, "unavailable");
  assert.deepEqual(evidence.runs, []);
  assert.equal(evidence.activity.calls, 0);
  assert.equal(report.agentEvidence, "unavailable");
  assert.deepEqual(report.agents, []);
});

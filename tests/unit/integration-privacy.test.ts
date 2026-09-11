import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReducedSession, SessionEntry } from "../../src/core/events.ts";
import { toSessionReport } from "../../src/core/reports.ts";
import { renderJson } from "../../src/ui/json.ts";
import { createEvidenceRegistry } from "../../src/integrations/evidence.ts";
import { readPiEntryEvidence } from "../../src/integrations/pi-entries.ts";
import { readSubagentRuns } from "../../src/integrations/subagents.ts";

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
  const producerChildId = `child-${secret}`;
  const producerParentId = `parent-${secret}`;
  const subagentOutput = readSubagentRuns({
    version: 1,
    runs: [
      {
        id: producerChildId,
        parentId: producerParentId,
        status: "complete",
      },
      {
        id: `nested-${secret}`,
        parentId: producerChildId,
        status: "complete",
      },
    ],
  });
  const report = toSessionReport(parent, {
    agents: subagentOutput,
    integrations: piEntryOutput,
  });

  assert.equal(subagentOutput.state, "supported");
  assert.match(subagentOutput.runs[0]?.id ?? "", /^subagent-[a-f0-9]{64}$/);
  assert.match(
    subagentOutput.runs[0]?.parentId ?? "",
    /^subagent-[a-f0-9]{64}$/,
  );
  assert.equal(subagentOutput.runs[1]?.parentId, subagentOutput.runs[0]?.id);
  assert.deepEqual(report.agents, subagentOutput.runs);

  for (const output of [
    registryOutput,
    piEntryOutput,
    subagentOutput,
    report,
    renderJson(report),
  ]) {
    const json = JSON.stringify(output);
    assert.equal(json.includes(secret), false);
    assert.equal(json.includes(producerChildId), false);
    assert.equal(json.includes(producerParentId), false);
  }
});

test("missing public subagent artifact remains unavailable rather than supported", () => {
  const missingArtifact = readSubagentRuns(undefined);
  const report = toSessionReport(parent, { agents: missingArtifact });

  assert.deepEqual(missingArtifact, { state: "unavailable", runs: [] });
  assert.equal(report.agentEvidence, "unavailable");
  assert.deepEqual(report.agents, []);
});

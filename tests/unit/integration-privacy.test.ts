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
  generations: [],
  tools: [],
  compactions: [],
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
  const subagentOutput = readSubagentRuns({
    version: 1,
    runs: [
      {
        id: "child-1",
        parentId: "parent-1",
        status: "complete",
        result: secret,
      },
    ],
  });
  const report = toSessionReport(parent, {
    agents: subagentOutput,
    integrations: piEntryOutput,
  });

  for (const output of [
    registryOutput,
    piEntryOutput,
    subagentOutput,
    report,
    renderJson(report),
  ]) {
    assert.equal(JSON.stringify(output).includes(secret), false);
  }
});

test("missing public subagent artifact remains unavailable rather than supported", () => {
  const missingArtifact = readSubagentRuns(undefined);
  const report = toSessionReport(parent, { agents: missingArtifact });

  assert.deepEqual(missingArtifact, { state: "unavailable", runs: [] });
  assert.equal(report.agentEvidence, "unavailable");
  assert.deepEqual(report.agents, []);
});

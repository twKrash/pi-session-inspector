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

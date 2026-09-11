import assert from "node:assert/strict";
import { test } from "node:test";

import type { SessionReport } from "../../src/core/reports.ts";
import {
  CURRENT_TABS,
  createCurrentTuiModel,
  reduceCurrentTui,
  type CurrentTuiState,
} from "../../src/ui/current.ts";

const report: SessionReport = {
  sessionId: "session-1",
  usage: { totalTokens: 42, cost: 0.01 },
  usageComposition: {
    generations: { totalTokens: 0, cost: 0 },
    toolResults: { totalTokens: 0, cost: 0 },
    compactions: { totalTokens: 0, cost: 0 },
    branchSummaries: { totalTokens: 0, cost: 0 },
  },
  models: [],
  tools: [],
  compactions: [],
  generations: [],
  agents: [],
  agentEvidence: "unavailable",
  integrations: [],
  durationEvidence: "unavailable",
  errors: [],
};

const initial: CurrentTuiState = { tab: "overview", scope: "active" };

test("keeps the complete fixed current-session tab set", () => {
  assert.deepEqual(CURRENT_TABS, [
    "overview",
    "models",
    "tools",
    "commands",
    "agents",
    "skills",
    "integrations",
    "errors",
    "ledger",
  ]);
});

test("moves tabs within the fixed range and changes valid scope", () => {
  assert.equal(reduceCurrentTui(initial, { type: "next-tab" }).tab, "models");
  assert.equal(
    reduceCurrentTui({ ...initial, tab: "ledger" }, { type: "next-tab" }).tab,
    "ledger",
  );
  assert.equal(
    reduceCurrentTui(initial, { type: "previous-tab" }).tab,
    "overview",
  );
  assert.equal(
    reduceCurrentTui(initial, { type: "set-scope", scope: "tree" }).scope,
    "tree",
  );
});

test("projects report data without materializing a ledger", () => {
  const model = createCurrentTuiModel(report, "active");

  assert.equal(model.report, report);
  assert.equal(model.scope, "active");
  assert.equal(model.unavailable, "unavailable");
  assert.equal(model.ledger, undefined);
});

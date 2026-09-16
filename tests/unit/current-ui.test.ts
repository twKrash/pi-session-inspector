import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type SessionReport,
  unavailableEvidenceHealth,
} from "../../src/core/reports.ts";
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
  agentUsage: { runsTotal: 0, runsWithUsage: 0 },
  agentEvidence: "unavailable",
  agentActivity: {
    state: "unavailable",
    calls: 0,
    succeeded: 0,
    failed: 0,
    interrupted: 0,
    tools: [],
  },
  integrations: [],
  durationEvidence: "unavailable",
  commands: { state: "unavailable", items: [], count: null },
  skills: {
    state: "unavailable",
    items: [],
    count: null,
    invocationState: "unavailable",
    invocationCount: null,
    otherInvocations: null,
  },
  resources: { state: "unavailable", items: [] },
  errors: [],
  evidenceHealth: unavailableEvidenceHealth(),
};

const initial: CurrentTuiState = { tab: "overview", scope: "active", page: 0 };

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

test("pages the content within its own bounds", () => {
  const second = reduceCurrentTui(
    { ...initial, page: 1 },
    { type: "next-page", pageCount: 2 },
  );
  assert.equal(second.page, 1);

  const first = reduceCurrentTui(initial, { type: "previous-page" });
  assert.equal(first.page, 0);

  assert.equal(
    reduceCurrentTui(
      { ...initial, page: 3 },
      { type: "next-page", pageCount: 3 },
    ).page,
    2,
  );
  // A page count that shrank below the current page cannot strand the view.
  assert.equal(
    reduceCurrentTui({ ...initial, page: 4 }, { type: "previous-page" }).page,
    3,
  );
});

test("returns to the first page when the content is replaced", () => {
  const paged = { ...initial, page: 3 };

  assert.equal(reduceCurrentTui(paged, { type: "next-tab" }).page, 0);
  assert.equal(reduceCurrentTui(paged, { type: "previous-tab" }).page, 0);
  assert.equal(
    reduceCurrentTui(paged, { type: "set-scope", scope: "tree" }).page,
    0,
  );
});

test("projects report data without materializing a ledger", () => {
  const model = createCurrentTuiModel(report, "active");

  assert.equal(model.report, report);
  assert.equal(model.scope, "active");
  assert.equal(model.unavailable, "unavailable");
  assert.equal(model.ledger, undefined);
});

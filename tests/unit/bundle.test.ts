import assert from "node:assert/strict";
import { test } from "node:test";

import type { Scope } from "../../src/core/events.ts";
import type { SessionReport } from "../../src/core/reports.ts";
import {
  createCurrentTuiModel,
  type CurrentTuiModel,
} from "../../src/ui/current.ts";
import { loadInspectorBundle } from "../../src/ui/bundle.ts";
import type { GlobalReport } from "../../src/ui/load-history.ts";

const maintenance = {
  writerId: "maintainer-1",
  now: () => new Date("2026-03-01T00:00:00.000Z"),
  isPidAlive: () => false,
};
const root = "/inspector-root";
const sessionDirectory = "/pi-sessions";

const emptyActivity = {
  state: "unavailable" as const,
  calls: 0,
  succeeded: 0,
  failed: 0,
  interrupted: 0,
  tools: [],
};

function reportFor(scope: Scope, dates: readonly string[]): SessionReport {
  const last = dates[dates.length - 1] ?? "2026-02-02";
  return {
    sessionId: "session-a",
    usage: {
      totalTokens: dates.length * 10 + 5,
      cost: dates.length * 0.1 + 0.05,
    },
    usageComposition: {
      generations: { totalTokens: dates.length * 10, cost: dates.length * 0.1 },
      toolResults: { totalTokens: 5, cost: 0.05 },
      compactions: { totalTokens: 0, cost: 0 },
      branchSummaries: { totalTokens: 0, cost: 0 },
    },
    models: [],
    tools: [
      {
        id: `tool:${scope}`,
        timestamp: `${last}T11:00:00.000Z`,
        name: "read",
        status: "succeeded",
        usage: { totalTokens: 5, cost: 0.05 },
      },
    ],
    compactions: [],
    generations: dates.map((date, index) => ({
      id: `generation:${scope}:${index}`,
      timestamp: `${date}T10:00:00.000Z`,
      provider: "acme",
      model: "alpha",
      usage: { totalTokens: 10, cost: 0.1 },
    })),
    errors: [],
    agents: [],
    agentEvidence: "unavailable",
    agentActivity: emptyActivity,
    integrations: [],
    durationEvidence: "unavailable",
    commands: { state: "unavailable", items: [], count: null },
    skills: {
      state: "unavailable",
      items: [],
      invocationState: "unavailable",
      invocationCount: null,
      otherInvocations: null,
    },
    resources: { state: "unavailable", items: [] },
  };
}

function modelFor(
  scope: Scope,
  dates: readonly string[] = ["2026-02-01", "2026-02-02"],
): CurrentTuiModel {
  return createCurrentTuiModel(reportFor(scope, dates), scope);
}

function unavailableHistory() {
  return {
    availability: "unavailable" as const,
    sessions: [],
    diagnostics: [],
  };
}

function unavailableGlobal(): GlobalReport {
  return {
    availability: "unavailable",
    sessions: [],
    usage: { totalTokens: 0, cost: 0 },
    dates: [],
    diagnostics: [],
    inventory: { commands: null, skills: null, resources: null },
  };
}

test("precomputes both current views without extra loader calls after generation", async () => {
  let currentCalls = 0;
  const bundle = await loadInspectorBundle({
    theme: "dark",
    initialScope: "tree",
    root,
    sessionDirectory: () => sessionDirectory,
    maintenance,
    loadCurrent: async (scope) => {
      currentCalls += 1;
      return modelFor(scope);
    },
    loadHistory: async () => unavailableHistory(),
    loadGlobal: async () => unavailableGlobal(),
  });

  assert.equal(currentCalls, 2);
  assert.equal(bundle.initialScope, "tree");
  assert.equal(bundle.theme, "dark");
  assert.equal(bundle.current.active.availability, "available");
  assert.equal(bundle.current.tree.availability, "available");
  assert.equal(bundle.current.active.report?.sessionId, "session-a");

  // Offline range rows are embedded per view and per section.
  assert.ok((bundle.current.active.daily?.length ?? 0) > 0);
  assert.equal(bundle.current.active.dailyTruncated, false);
  assert.equal(bundle.schemaVersion, 1);
});

test("degrades one unavailable view without failing the bundle", async () => {
  const bundle = await loadInspectorBundle({
    theme: "light",
    initialScope: "active",
    root,
    sessionDirectory: () => sessionDirectory,
    maintenance,
    loadCurrent: async (scope) =>
      scope === "active" ? undefined : modelFor("tree"),
    loadHistory: async () => unavailableHistory(),
    loadGlobal: async () => unavailableGlobal(),
  });

  assert.equal(bundle.current.active.availability, "unavailable");
  assert.equal(bundle.current.active.diagnostic, "current-unavailable");
  assert.equal(bundle.current.active.report, undefined);
  assert.equal(bundle.current.active.daily, undefined);
  assert.equal(bundle.current.tree.availability, "available");
});

test("derives one daily row per report date and caps at 366 with truncation", async () => {
  const bundle = await loadInspectorBundle({
    theme: "dark",
    initialScope: "active",
    root,
    sessionDirectory: () => sessionDirectory,
    maintenance,
    loadCurrent: async (scope) => modelFor(scope),
    loadHistory: async () => unavailableHistory(),
    loadGlobal: async () => unavailableGlobal(),
  });

  assert.deepEqual(bundle.current.active.daily, [
    {
      date: "2026-02-01",
      sessions: 1,
      totalTokens: 10,
      cost: 0.1,
      generations: 1,
      tools: 0,
    },
    {
      date: "2026-02-02",
      sessions: 1,
      totalTokens: 15,
      cost: 0.1 + 0.05,
      generations: 1,
      tools: 1,
    },
  ]);

  const dates = Array.from({ length: 400 }, (_, index) =>
    new Date(Date.UTC(2025, 0, 1) + index * 86_400_000)
      .toISOString()
      .slice(0, 10),
  );
  const capped = await loadInspectorBundle({
    theme: "dark",
    initialScope: "active",
    root,
    sessionDirectory: () => sessionDirectory,
    maintenance,
    loadCurrent: async (scope) => modelFor(scope, dates),
    loadHistory: async () => unavailableHistory(),
    loadGlobal: async () => unavailableGlobal(),
  });

  assert.equal(capped.current.active.daily?.length, 366);
  assert.equal(capped.current.active.dailyTruncated, true);
});

test("degrades history and global sections when their loaders throw", async () => {
  const bundle = await loadInspectorBundle({
    theme: "light",
    initialScope: "active",
    root,
    sessionDirectory: () => sessionDirectory,
    maintenance,
    loadCurrent: async (scope) => modelFor(scope),
    loadHistory: async () => {
      throw new Error("boom");
    },
    loadGlobal: async () => {
      throw new Error("boom");
    },
  });

  assert.equal(bundle.history.availability, "unavailable");
  assert.deepEqual(bundle.history.sessions, []);
  assert.equal(bundle.global.availability, "unavailable");
  assert.deepEqual(bundle.global.dates, []);
  assert.equal(bundle.current.active.availability, "available");
});

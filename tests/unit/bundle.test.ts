import assert from "node:assert/strict";
import { test } from "node:test";

import type { Scope } from "../../src/core/events.ts";
import {
  type SessionReport,
  unavailableEvidenceHealth,
} from "../../src/core/reports.ts";
import {
  createCurrentTuiModel,
  type CurrentTuiModel,
} from "../../src/ui/current.ts";
import { CAPABILITIES, loadInspectorBundle } from "../../src/ui/bundle.ts";
import {
  MAX_MODELS_PER_DATE,
  type DateUsageRow,
  type DatedModelRow,
} from "../../src/ui/dated-usage.ts";
import type { GlobalReport } from "../../src/ui/load-history.ts";

const maintenance = {
  writerId: "maintainer-1",
  now: () => new Date("2026-03-01T00:00:00.000Z"),
  isPidAlive: () => false,
};
const root = "/inspector-root";
const sessionDirectory = "/pi-sessions";

/** Every test here loads the same bundle except for its current-session loader. */
const bundleInput = {
  theme: "dark" as const,
  initialScope: "active" as const,
  root,
  sessionDirectory: () => sessionDirectory,
  maintenance,
};

const emptyActivity = {
  state: "unavailable" as const,
  calls: 0,
  succeeded: 0,
  failed: 0,
  interrupted: 0,
  tools: [],
};

// The scope is deliberately absent from the synthetic report: real report ids
// come from persisted entries, so two views of one session with identical
// projections are byte-identical (spec §4.3).
function reportFor(dates: readonly string[]): SessionReport {
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
        id: "tool:read",
        timestamp: `${last}T11:00:00.000Z`,
        name: "read",
        status: "succeeded",
        usage: { totalTokens: 5, cost: 0.05 },
      },
    ],
    compactions: [],
    generations: dates.map((date, index) => ({
      id: `generation:${index}`,
      timestamp: `${date}T10:00:00.000Z`,
      provider: "acme",
      model: "alpha",
      usage: { totalTokens: 10, cost: 0.1 },
    })),
    errors: [],
    agents: [],
    agentUsage: { runsTotal: 0, runsWithUsage: 0 },
    agentEvidence: "unavailable",
    agentActivity: emptyActivity,
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
    evidenceHealth: unavailableEvidenceHealth(),
  };
}

const zeroUsage = () => ({ totalTokens: 0, cost: 0 });

/** One synthetic dated row, shaped exactly like the loader's projection rows. */
function datedRow(date: string): DateUsageRow {
  return {
    date,
    totalTokens: 0,
    cost: 0,
    generations: 0,
    tools: 0,
    errors: 0,
    composition: {
      generations: zeroUsage(),
      toolResults: zeroUsage(),
      compactions: zeroUsage(),
      branchSummaries: zeroUsage(),
    },
  };
}

/**
 * Mirrors a report's dated evidence into the projection a loader attaches: one
 * row per date a record falls on plus one model row per generation. Dates stay
 * uncapped so the fold under test owns the window bound; the per-date model
 * bound is the projection's own contract and is left to the caller.
 */
function projectionFor(
  report: SessionReport,
): NonNullable<CurrentTuiModel["datedUsage"]> {
  const byDate = new Map<string, DateUsageRow>();
  const at = (date: string): DateUsageRow => {
    const existing = byDate.get(date);
    if (existing !== undefined) return existing;
    const created = datedRow(date);
    byDate.set(date, created);
    return created;
  };
  const add = (
    row: DateUsageRow,
    part: keyof DateUsageRow["composition"],
    usage: { totalTokens: number; cost: number },
  ): void => {
    row.composition[part].totalTokens += usage.totalTokens;
    row.composition[part].cost += usage.cost;
    row.totalTokens += usage.totalTokens;
    row.cost += usage.cost;
  };
  const models: DatedModelRow[] = [];
  for (const generation of report.generations) {
    const date = dayOf(generation.timestamp);
    if (date === undefined) continue;
    const row = at(date);
    row.generations += 1;
    add(row, "generations", generation.usage);
    models.push({
      date,
      provider: generation.provider,
      model: generation.model,
      generations: 1,
      totalTokens: generation.usage.totalTokens,
      cost: generation.usage.cost,
    });
  }
  for (const tool of report.tools) {
    const date = dayOf(tool.timestamp);
    if (date === undefined) continue;
    at(date).tools += 1;
    if (tool.usage !== undefined) add(at(date), "toolResults", tool.usage);
  }
  for (const compaction of report.compactions) {
    const date = dayOf(compaction.timestamp);
    if (date === undefined) continue;
    add(at(date), "compactions", compaction.usage);
  }
  return {
    dates: [...byDate.values()].sort((left, right) =>
      left.date.localeCompare(right.date),
    ),
    models: models.sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        left.provider.localeCompare(right.provider) ||
        left.model.localeCompare(right.model),
    ),
    truncated: false,
    modelsTruncated: false,
  };
}

function dayOf(timestamp: string): string | undefined {
  const date = timestamp.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
}

/**
 * A model carrying the projection a loader would attach. `truncated` models a
 * session whose dated window cannot represent its whole native usage.
 */
function modelFor(
  scope: Scope,
  dates: readonly string[] = ["2026-02-01", "2026-02-02"],
  truncated = false,
): CurrentTuiModel {
  const report = reportFor(dates);
  const projection = projectionFor(report);
  return createCurrentTuiModel(report, scope, {
    ...projection,
    truncated: projection.truncated || truncated,
  });
}

/** One usage-bearing generation per model name on one date. */
function modelForMany(
  scope: Scope,
  models: readonly string[],
  date = "2026-03-01",
): CurrentTuiModel {
  const report = reportFor([date]);
  report.generations = models.map((model, index) => ({
    id: `generation:${index}`,
    timestamp: `${date}T10:00:00.000Z`,
    provider: "acme",
    model,
    usage: { totalTokens: 10, cost: 0.1 },
  }));
  const projection = projectionFor(report);
  return createCurrentTuiModel(report, scope, {
    ...projection,
    models: projection.models.slice(0, MAX_MODELS_PER_DATE),
    modelsTruncated: projection.models.length > MAX_MODELS_PER_DATE,
  });
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
      composition: {
        generations: { totalTokens: 10, cost: 0.1 },
        toolResults: { totalTokens: 0, cost: 0 },
        compactions: { totalTokens: 0, cost: 0 },
        branchSummaries: { totalTokens: 0, cost: 0 },
      },
    },
    {
      date: "2026-02-02",
      sessions: 1,
      totalTokens: 15,
      cost: 0.15,
      generations: 1,
      tools: 1,
      composition: {
        generations: { totalTokens: 10, cost: 0.1 },
        toolResults: { totalTokens: 5, cost: 0.05 },
        compactions: { totalTokens: 0, cost: 0 },
        branchSummaries: { totalTokens: 0, cost: 0 },
      },
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

test("a view carries dated rows, per-date model rows and composition", async () => {
  const bundle = await loadInspectorBundle({
    ...bundleInput,
    loadCurrent: async (scope) =>
      modelFor(scope, ["2026-03-01T10:00:00.000Z", "2026-03-02T10:00:00.000Z"]),
  });
  const view = bundle.current.active;
  // The last date also carries the report's tool usage, exactly as the dated
  // projection attributes it.
  assert.deepEqual(
    view.daily?.map((row) => [row.date, row.generations, row.totalTokens]),
    [
      ["2026-03-01", 1, 10],
      ["2026-03-02", 1, 15],
    ],
  );
  assert.deepEqual(
    view.daily?.map((row) => row.tools),
    [0, 1],
  );
  assert.equal(view.daily?.[0]?.composition.generations.totalTokens, 10);
  assert.equal(view.daily?.[0]?.composition.toolResults.totalTokens, 0);
  assert.equal(view.daily?.[1]?.composition.toolResults.totalTokens, 5);
  assert.equal(view.dailyTruncated, false);
  assert.deepEqual(
    view.datedModels?.map((row) => [
      row.date,
      row.provider,
      row.model,
      row.totalTokens,
    ]),
    [
      ["2026-03-01", "acme", "alpha", 10],
      ["2026-03-02", "acme", "alpha", 10],
    ],
  );
  assert.equal(view.modelsTruncated, false);
});

test("model rows are capped per date and flagged", async () => {
  const models = Array.from({ length: 70 }, (_, index) => `model-${index}`);
  const bundle = await loadInspectorBundle({
    ...bundleInput,
    loadCurrent: async (scope) => modelForMany(scope, models),
  });
  const view = bundle.current.active;
  const newest = view.datedModels?.at(-1)?.date;
  assert.equal(
    view.datedModels?.filter((row) => row.date === newest).length,
    MAX_MODELS_PER_DATE,
  );
  assert.equal(view.modelsTruncated, true);
});

test("an unavailable view advertises no capabilities and no dated rows", async () => {
  const bundle = await loadInspectorBundle({
    ...bundleInput,
    loadCurrent: async () => undefined,
  });
  assert.deepEqual(bundle.current.active.capabilities, []);
  assert.equal(bundle.current.active.datedModels, undefined);
  assert.equal(bundle.current.active.daily, undefined);
});

test("an absent dated projection leaves the dated keys absent, never zero", async () => {
  const bundle = await loadInspectorBundle({
    ...bundleInput,
    loadCurrent: async (scope) =>
      createCurrentTuiModel(reportFor(["2026-03-01"]), scope),
  });
  const view = bundle.current.active;
  assert.equal(view.availability, "available");
  for (const key of [
    "usageByDate",
    "datedModels",
    "modelsTruncated",
    "daily",
    "dailyTruncated",
  ]) {
    assert.equal(key in view, false, key);
  }
});

test("a partial dated window keeps its daily aggregate partial, never complete", async () => {
  const bundle = await loadInspectorBundle({
    ...bundleInput,
    // The dated-window shape of a session whose usage summary is unavailable:
    // activity rows exist, no usage can be published, and the window cannot
    // represent the spend (`unavailable != 0`).
    loadCurrent: async (scope) =>
      createCurrentTuiModel(reportFor([]), scope, {
        dates: [{ ...datedRow("2026-02-01"), errors: 2 }],
        models: [],
        truncated: true,
        modelsTruncated: false,
      }),
  });
  const view = bundle.current.active;
  assert.deepEqual(
    view.daily?.map((row) => [row.date, row.totalTokens]),
    [["2026-02-01", 0]],
  );
  assert.equal(view.dailyTruncated, true);
});

test("the capability table is data, not client prose", () => {
  assert.deepEqual(
    [CAPABILITIES.global, CAPABILITIES.history],
    [["overview"], ["overview"]],
  );
  assert.ok(CAPABILITIES.current.includes("environment"));
  assert.deepEqual(
    CAPABILITIES.current.filter(
      (tab) => tab === "commands" || tab === "skills",
    ),
    [],
  );
});

test("identical projections set the flag, divergent ones clear it", async () => {
  const same = await loadInspectorBundle({
    ...bundleInput,
    loadCurrent: async (scope) => modelFor(scope, ["2026-03-01T10:00:00.000Z"]),
  });
  assert.equal(same.current.sameReportProjection, true);

  const different = await loadInspectorBundle({
    ...bundleInput,
    loadCurrent: async (scope) =>
      modelFor(
        scope,
        scope === "active"
          ? ["2026-03-01T10:00:00.000Z"]
          : ["2026-03-01T10:00:00.000Z", "2026-03-02T10:00:00.000Z"],
      ),
  });
  assert.equal(different.current.sameReportProjection, false);
});

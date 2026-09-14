import assert from "node:assert/strict";
import { test } from "node:test";

import { createCurrentTuiModel } from "../../src/ui/current.ts";
import { sessionView } from "../../src/ui/report-projection.ts";
import { toSessionReport } from "../../src/core/reports.ts";
import { sessionDatedUsage } from "../../src/ui/dated-usage.ts";
import { renderJson } from "../../src/ui/json.ts";
import { parseRangeQuery } from "../../src/ui/range.ts";
import { renderSnapshot } from "../../src/ui/snapshot.ts";
import {
  projectGlobalReport,
  projectHistoryReport,
  projectInspectorUi,
} from "../../src/ui/ui-projection.ts";
import {
  canonicalFromFixture,
  completeBundleFor,
  fixtureMatrix,
  snapshotForCurrent,
  snapshotForGlobal,
  snapshotForHistory,
} from "./fixtures.ts";
import { FORBIDDEN_PRODUCER_KEYS } from "../helpers/bundle-scenarios.ts";
import {
  assertAggregateReconciliation,
  assertBundleReconciliation,
  assertCoveragePartition,
  assertDatedUsageReconciliation,
  assertNoSyntheticZero,
  assertPrivacySafe,
  assertReportReconciliation,
  assertRangeRoundTrip,
  assertTransportReconciliation,
} from "./assertions.ts";

const matrix = fixtureMatrix();

test("fixture matrix exposes every M8.5 state", () => {
  const matrix = fixtureMatrix();
  assert.deepEqual(
    matrix.reports.map((fixture) => fixture.state),
    ["complete", "partial", "aggregate-only", "expired", "unavailable"],
  );
  assert.ok(matrix.bundles.some(({ id }) => id === "current-active-tree"));
  assert.ok(matrix.aggregates.some(({ id }) => id === "history-global"));
});

for (const fixture of matrix.reports) {
  test(`report-reconciliation/${fixture.id}`, () => {
    assertReportReconciliation(fixture);
  });
}

for (const fixture of matrix.coverages) {
  test(`coverage-partition/${fixture.id}`, () => {
    assertCoveragePartition(fixture);
  });
}

for (const fixture of matrix.bundles) {
  test(`bundle-reconciliation/${fixture.id}`, () => {
    assertBundleReconciliation(fixture);
  });
}

for (const fixture of matrix.aggregates) {
  test(`aggregate-reconciliation/${fixture.id}`, () => {
    assertAggregateReconciliation(fixture);
  });
}

test("range intents round-trip through their route representation", () => {
  assertRangeRoundTrip({ kind: "preset", preset: 7 });
  assertRangeRoundTrip({
    kind: "custom",
    from: "2026-02-01",
    to: "2026-02-03",
  });
});

test("range parser rejects incomplete, duplicate, inverted, and oversized input", () => {
  for (const query of [
    "from=2026-02-01",
    "to=2026-02-02",
    "from=2026-02-03&to=2026-02-01",
    "from=2026-02-01&from=2026-02-02&to=2026-02-03",
    "preset=7&from=2026-02-01&to=2026-02-02",
    "from=2026-02-30&to=2026-03-01",
    "x".repeat(513),
  ]) {
    assert.deepEqual(parseRangeQuery(query), {
      ok: false,
      code: "invalid-range",
    });
  }
});

test("unavailable values never become synthetic zero", () => {
  assertNoSyntheticZero({
    id: "unavailable-fixture",
    value: { label: "Unavailable", usage: null },
    unavailable: true,
  });
  const fixture = matrix.reports.find(({ state }) => state === "complete");
  assert.ok(fixture);
  const base = completeBundleFor(fixture);
  const bundle: typeof base = {
    ...base,
    current: {
      ...base.current,
      active: {
        availability: "unavailable",
        diagnostic: "current-unavailable",
      } as const,
      tree: {
        availability: "unavailable",
        diagnostic: "tree-unavailable",
      } as const,
    },
    history: {
      availability: "unavailable",
      sessions: [],
      diagnostics: [],
    },
    global: {
      availability: "unavailable",
      sessions: [],
      usage: { totalTokens: 0, cost: 0 },
      dates: [],
      diagnostics: [],
      inventory: { commands: null, skills: null, resources: null },
    },
  };
  const unavailableFixture = matrix.reports.find(
    ({ state }) => state === "unavailable",
  );
  assert.ok(unavailableFixture);
  const ui = projectInspectorUi({ bundle });
  const snapshots = [
    snapshotForCurrent(ui.current.tree),
    snapshotForHistory(ui.history),
    snapshotForGlobal(ui.global),
  ];
  const rendered = snapshots.map((snapshot) => renderSnapshot(snapshot));
  assert.ok(rendered.every((document) => document.includes("Unavailable")));
  assertNoSyntheticZero({
    id: "unavailable-projection",
    value: [ui, snapshots, rendered, renderJson(unavailableFixture.report)],
    unavailable: true,
  });
});

test("deterministic fixture artifacts remain privacy-safe", () => {
  assertPrivacySafe(
    "bundle-fixture",
    [matrix.bundles[0]?.bundle],
    FORBIDDEN_PRODUCER_KEYS,
  );
});

test("canonical evidence variants reconcile by scope and composition", () => {
  const composed = canonicalFromFixture("usage-composition.jsonl");
  assertReportReconciliation({
    id: "usage-composition",
    state: "complete",
    report: toSessionReport(composed),
    canonical: composed,
  });
  assertDatedUsageReconciliation({
    id: "usage-composition",
    canonical: composed,
    report: toSessionReport(composed),
  });

  const unknown = canonicalFromFixture("unknown-entry-ancestry.jsonl");
  assertReportReconciliation({
    id: "unknown-entry-ancestry",
    state: "complete",
    report: toSessionReport(unknown),
    canonical: unknown,
  });
  assertDatedUsageReconciliation({
    id: "unknown-entry-ancestry",
    canonical: unknown,
    report: toSessionReport(unknown),
  });
});

test("canonical dated usage reconciles by logical UTC attribution", () => {
  const fixture = matrix.reports.find(({ state }) => state === "complete");
  assert.ok(fixture?.canonical);
  assertDatedUsageReconciliation({
    id: "mixed-usage",
    canonical: fixture.canonical,
    report: fixture.report,
  });
  const crossMidnight = canonicalFromFixture("cross-midnight.jsonl");
  assertDatedUsageReconciliation({
    id: "cross-midnight",
    canonical: crossMidnight,
    report: toSessionReport(crossMidnight),
  });
  const partial = matrix.reports.find(({ state }) => state === "partial");
  assert.ok(partial?.canonical);
  assertDatedUsageReconciliation({
    id: "long-session-partial-dated",
    canonical: partial.canonical,
    report: partial.report,
  });

  const active = canonicalFromFixture("branching.jsonl", "active", "e6");
  const tree = canonicalFromFixture("branching.jsonl", "tree");
  const activeReport = toSessionReport(active);
  const treeReport = toSessionReport(tree);
  assert.notEqual(active.scopedEntryIds.length, tree.scopedEntryIds.length);
  assert.notEqual(
    activeReport.usage?.totalTokens,
    treeReport.usage?.totalTokens,
  );
  assertReportReconciliation({
    id: "branching-active-scope",
    state: "complete",
    report: activeReport,
    canonical: active,
  });
  assertReportReconciliation({
    id: "branching-tree-scope",
    state: "complete",
    report: treeReport,
    canonical: tree,
  });
});

test("hostile producer-shaped fields stop at projection boundaries", () => {
  const bundle = structuredClone(matrix.bundles[0]?.bundle);
  assert.ok(bundle);
  const report = bundle.current.tree.report;
  assert.ok(report);
  Object.assign(report, {
    task: "RAW_PRODUCER_TASK",
    finalOutput: "RAW_PRODUCER_OUTPUT",
    progressSummary: "RAW_PRODUCER_PROGRESS",
    transcriptPath: "RAW_PRODUCER_PATH",
    artifactPaths: ["RAW_PRODUCER_ARTIFACT"],
    sessionFile: "RAW_PRODUCER_FILE",
    sessionName: "RAW_PRODUCER_NAME",
  });
  const tool = report.tools[0];
  assert.ok(tool);
  Object.assign(tool, {
    arguments: "RAW_PRODUCER_ARGUMENT",
    result: "RAW_PRODUCER_RESULT",
  });
  const ui = projectInspectorUi({ bundle });
  const json = renderJson(ui.current.tree.report);
  const html = renderSnapshot(snapshotForCurrent(ui.current.tree));
  assertPrivacySafe(
    "hostile-producer-boundary",
    [ui, json, html],
    FORBIDDEN_PRODUCER_KEYS,
  );
  assert.equal(json.includes("RAW_PRODUCER_"), false);
  assert.equal(html.includes("RAW_PRODUCER_"), false);
});

test("aggregate dated truncation preserves known rows", () => {
  const fixture = matrix.aggregates.find(
    ({ id }) => id === "history-global-truncated",
  );
  assert.ok(fixture);
  assertAggregateReconciliation(fixture);
  const intent = {
    kind: "custom",
    from: "2026-01-01",
    to: "2026-02-03",
  } as const;
  const historyView = projectHistoryReport(fixture.history, intent);
  const globalView = projectGlobalReport(fixture.global, intent);
  const expectedHistoryDates = [
    ...new Set(
      fixture.history.sessions.flatMap((session) =>
        session.availability === "available"
          ? session.usageByDate.map(({ date }) => date)
          : [],
      ),
    ),
  ].sort();
  assert.deepEqual(
    historyView.daily.map(({ date }) => date),
    expectedHistoryDates,
  );
  assert.deepEqual(
    globalView.daily.map(({ date }) => date),
    fixture.global.dates.map(({ date }) => date),
  );
  assert.ok(
    historyView.daily.every(
      ({ date }) => date >= intent.from && date <= intent.to,
    ),
  );
  assert.ok(
    globalView.daily.every(
      ({ date }) => date >= intent.from && date <= intent.to,
    ),
  );
  assert.equal(historyView.truncated, true);
  assert.equal(globalView.truncated, true);
  const fullyCovered = {
    kind: "custom",
    from: "2026-02-01",
    to: "2026-02-02",
  } as const;
  assert.equal(
    projectHistoryReport(fixture.history, fullyCovered).truncated,
    false,
  );
  assert.equal(
    projectGlobalReport(fixture.global, fullyCovered).truncated,
    false,
  );
});

test("current dated truncation preserves known rows", () => {
  const fixture = matrix.reports.find(({ state }) => state === "partial");
  assert.ok(fixture?.canonical);
  const bundle = completeBundleFor(fixture);
  assertBundleReconciliation({ id: "current-partial-dated", bundle });
  const ui = projectInspectorUi({
    bundle,
    intent: {
      kind: "custom",
      from: "2026-02-03",
      to: "2027-02-04",
    },
  });
  const range = ui.current.tree.range;
  assert.ok(range);
  assert.equal(range.truncated, true);
  assert.ok(range.daily.length > 0);
});

test("same report flag means equal report projections", () => {
  const fixture = matrix.reports.find(({ state }) => state === "complete");
  assert.ok(fixture);
  const base = completeBundleFor(fixture);
  const bundle = {
    ...base,
    current: {
      ...base.current,
      active: { ...base.current.active, report: base.current.tree.report },
      sameReportProjection: true,
    },
  };
  assertBundleReconciliation({ id: "same-report", bundle });
});

test("all report surfaces consume one canonical projection", () => {
  const fixture = matrix.reports.find(({ state }) => state === "complete");
  assert.ok(fixture?.canonical);
  const bundle = completeBundleFor(fixture);
  const report = bundle.current.tree.report;
  assert.ok(report);
  const datedUsage = sessionDatedUsage(fixture.canonical);
  const ui = projectInspectorUi({ bundle });
  const snapshots = [
    snapshotForCurrent(ui.current.tree),
    snapshotForHistory(ui.history),
    snapshotForGlobal(ui.global),
  ];
  assertTransportReconciliation({
    report,
    view: sessionView(report),
    ui,
    tui: createCurrentTuiModel(report, "tree", datedUsage),
    datedUsage,
    snapshots,
  });
});

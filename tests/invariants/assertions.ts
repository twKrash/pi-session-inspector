import * as fc from "fast-check";

import type { AgentToolActivity } from "../../src/integrations/subagents.ts";
import type { CanonicalSession } from "../../src/core/canonical.ts";
import type { Usage, UsageComposition } from "../../src/core/events.ts";
import { toSessionReport, type SessionReport } from "../../src/core/reports.ts";
import { reduceEntries } from "../../src/core/reduce.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";
import type { SessionCoverage } from "../../src/core/session-coverage.ts";
import type { CurrentTuiModel } from "../../src/ui/current.ts";
import { buildDailyRows } from "../../src/ui/daily.ts";
import { sessionDatedUsage } from "../../src/ui/dated-usage.ts";
import { FORBIDDEN_PRODUCER_KEYS } from "../helpers/bundle-scenarios.ts";
import {
  parseRangeQuery,
  serializeRangeQuery,
  type RangeIntent,
} from "../../src/ui/range.ts";
import { renderJson } from "../../src/ui/json.ts";
import { renderSnapshot, type SnapshotDto } from "../../src/ui/snapshot.ts";
import {
  modelRangeRows,
  sessionView,
  type SessionReportView,
  type ToolCallRow,
  toolSummary,
} from "../../src/ui/report-projection.ts";
import {
  projectGlobalReport,
  projectHistoryReport,
  projectInspectorUi,
  type InspectorUiSnapshot,
  type UiSessionProjection,
} from "../../src/ui/ui-projection.ts";
import {
  completeBundleFor,
  fixtureMatrix,
  type AggregateFixture,
  type BundleFixture,
  type ReportFixture,
} from "./fixtures.ts";

const rangeFixture = fixtureMatrix().reports.find(
  ({ state }) => state === "complete",
);
if (rangeFixture === undefined) throw new Error("range fixture missing");
const rangeBundle = completeBundleFor(rangeFixture);

const USAGE_FIELDS = [
  "totalTokens",
  "cost",
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
] as const;

function fail(id: string, invariant: string): never {
  throw new Error(`[${id}] ${invariant}`);
}

function round(value: number): number {
  return Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
}

function addUsage(left: Usage, right: Usage): Usage {
  const result: Usage = {
    totalTokens: left.totalTokens + right.totalTokens,
    cost: round(left.cost + right.cost),
  };
  for (const field of USAGE_FIELDS.slice(2)) {
    const value = left[field] ?? right[field];
    if (value !== undefined) {
      result[field] = (left[field] ?? 0) + (right[field] ?? 0);
    }
  }
  return result;
}

function usageMatches(
  id: string,
  invariant: string,
  actual: Usage,
  expected: Usage,
): void {
  for (const field of USAGE_FIELDS) {
    const actualValue = actual[field];
    const expectedValue = expected[field];
    if (actualValue === undefined && expectedValue === undefined) continue;
    if (round(actualValue ?? 0) !== round(expectedValue ?? 0)) {
      fail(id, invariant);
    }
  }
}

function totalsEqual(
  left: { totalTokens: number; cost: number },
  right: { totalTokens: number; cost: number },
): boolean {
  return (
    left.totalTokens === right.totalTokens &&
    round(left.cost) === round(right.cost)
  );
}

function assertActivity(id: string, activity: AgentToolActivity): void {
  const values = [
    activity.calls,
    activity.succeeded,
    activity.failed,
    activity.interrupted,
  ];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    fail(id, "agent-activity-bounds");
  }
  if (
    activity.succeeded + activity.failed + activity.interrupted !==
    activity.calls
  ) {
    fail(id, "agent-activity-partition");
  }
  if (
    activity.tools.reduce((sum, tool) => sum + tool.calls, 0) !== activity.calls
  ) {
    fail(id, "agent-activity-tool-count");
  }
}

function assertBoundedNumbers(id: string, value: unknown): void {
  if (typeof value === "number") {
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      value > Number.MAX_SAFE_INTEGER
    ) {
      fail(id, "bounded-numbers");
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertBoundedNumbers(id, item);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) assertBoundedNumbers(id, item);
  }
}

function assertModels(id: string, report: SessionReport): void {
  const expected = new Map<
    string,
    {
      provider: string;
      model: string;
      generations: number;
      totalTokens: number;
      cost: number;
    }
  >();
  for (const generation of report.generations) {
    const key = `${generation.provider}\u0000${generation.model}`;
    const row = expected.get(key) ?? {
      provider: generation.provider,
      model: generation.model,
      generations: 0,
      totalTokens: 0,
      cost: 0,
    };
    row.generations += 1;
    row.totalTokens += generation.usage.totalTokens;
    row.cost = round(row.cost + generation.usage.cost);
    expected.set(key, row);
  }
  const actual = [...report.models].sort(
    (left, right) =>
      left.provider.localeCompare(right.provider) ||
      left.model.localeCompare(right.model),
  );
  const rows = [...expected.values()].sort(
    (left, right) =>
      left.provider.localeCompare(right.provider) ||
      left.model.localeCompare(right.model),
  );
  if (actual.length !== rows.length) fail(id, "model-count");
  for (let index = 0; index < rows.length; index += 1) {
    const left = actual[index];
    const right = rows[index];
    if (
      left.provider !== right.provider ||
      left.model !== right.model ||
      left.generations !== right.generations ||
      left.totalTokens !== right.totalTokens ||
      round(left.cost) !== round(right.cost)
    ) {
      fail(id, "model-reconciliation");
    }
  }
}

function assertTools(id: string, report: SessionReport): void {
  const rows: ToolCallRow[] = report.tools.map((tool) => ({
    name: tool.name,
    ...(tool.source === undefined ? {} : { source: tool.source }),
    status: tool.status,
    timestamp: tool.timestamp,
    usage:
      tool.usage === undefined
        ? null
        : { totalTokens: tool.usage.totalTokens, cost: tool.usage.cost },
  }));
  const summaries = toolSummary({ tools: rows });
  if (
    summaries.reduce((sum, row) => sum + row.calls, 0) !== report.tools.length
  ) {
    fail(id, "tool-call-count");
  }
  for (const row of summaries) {
    if (row.succeeded + row.failed + row.interrupted !== row.calls) {
      fail(id, "tool-status-partition");
    }
    if (row.withUsage > row.calls) fail(id, "tool-usage-count");
  }
}

function assertInventory(id: string, report: SessionReport): void {
  if (report.commands.state === "supported") {
    if (report.commands.count !== report.commands.items.length) {
      fail(id, "command-inventory-count");
    }
  } else if (report.commands.count !== null) {
    fail(id, "command-inventory-unavailable");
  }
  if (report.skills.state === "supported") {
    if (
      report.skills.count === null ||
      report.skills.count < 0 ||
      report.skills.count > report.skills.items.length
    ) {
      fail(id, "skill-inventory-count");
    }
  } else if (report.skills.count !== null) {
    fail(id, "skill-inventory-unavailable");
  }
  for (const row of report.resources.items) {
    for (const value of [row.commands, row.skills, row.prompts, row.tools]) {
      if (!Number.isSafeInteger(value) || value < 0) {
        fail(id, "resource-count-bounds");
      }
    }
  }
  if (
    report.resources.state === "supported" &&
    report.commands.state === "supported"
  ) {
    const resourceTotals = report.resources.items.reduce(
      (totals, row) => ({
        commands: totals.commands + row.commands,
        skills: totals.skills + row.skills,
        prompts: totals.prompts + row.prompts,
      }),
      { commands: 0, skills: 0, prompts: 0 },
    );
    const commandRows = report.commands.items;
    if (
      resourceTotals.commands !==
        commandRows.filter(({ source }) => source === "extension").length ||
      resourceTotals.prompts !==
        commandRows.filter(({ source }) => source === "prompt").length
    ) {
      fail(id, "resource-source-reconciliation");
    }
    if (
      report.skills.state === "supported" &&
      resourceTotals.skills !== report.skills.count
    ) {
      fail(id, "resource-skill-reconciliation");
    }
  }
}

export function assertReportReconciliation(fixture: ReportFixture): void {
  const { id, report } = fixture;
  assertBoundedNumbers(id, report);
  if (report.usage === undefined) {
    if (report.usageComposition !== undefined) {
      fail(id, "unavailable-composition");
    }
  } else {
    if (report.usageComposition === undefined) {
      fail(id, "known-usage-composition-missing");
    }
    const composition = report.usageComposition as UsageComposition;
    const expected = Object.values(composition).reduce(addUsage, {
      totalTokens: 0,
      cost: 0,
    });
    usageMatches(
      id,
      "native-composition-reconciliation",
      report.usage,
      expected,
    );
  }
  assertModels(id, report);
  assertTools(id, report);
  assertActivity(id, report.agentActivity);
  if (
    !Number.isSafeInteger(report.agentUsage.runsTotal) ||
    !Number.isSafeInteger(report.agentUsage.runsWithUsage) ||
    report.agentUsage.runsTotal < 0 ||
    report.agentUsage.runsWithUsage < 0 ||
    report.agentUsage.runsWithUsage > report.agentUsage.runsTotal
  ) {
    fail(id, "agent-usage-bounds");
  }
  assertInventory(id, report);
  if (fixture.state === "complete" && report.usage === undefined) {
    fail(id, "complete-usage-missing");
  }
  if (
    (fixture.state === "aggregate-only" || fixture.state === "unavailable") &&
    report.usage !== undefined
  ) {
    fail(id, "unavailable-usage-published");
  }
  if (fixture.state === "expired" && report.walDetail !== "expired") {
    fail(id, "expired-detail-missing");
  }
}

export function assertCoveragePartition(report: {
  coverage?: SessionCoverage;
}): void {
  const coverage = report.coverage;
  if (coverage === undefined) fail("coverage", "missing");
  const values = [coverage.inspected, coverage.available, coverage.unavailable];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    fail("coverage", "bounds");
  }
  if (coverage.inspected !== coverage.available + coverage.unavailable) {
    fail("coverage", "inspected-partition");
  }
  const ratioExpected =
    coverage.inspected === 0 || coverage.discoveryLimited
      ? null
      : Math.round((coverage.available / coverage.inspected) * 10_000) / 10_000;
  if (coverage.sessionRatio !== ratioExpected) fail("coverage", "ratio");
  const complete =
    coverage.inspected > 0 &&
    coverage.available === coverage.inspected &&
    !coverage.discoveryLimited;
  if (coverage.complete !== complete) fail("coverage", "complete");
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertAggregateCoverageLabels(
  id: string,
  availability: "available" | "unavailable",
  coverage: SessionCoverage | undefined,
  labels: { sessions: string; usageUnavailable: boolean },
): void {
  if (availability === "unavailable" || coverage === undefined) {
    if (
      labels.sessions !== "coverage.unknown" ||
      labels.usageUnavailable !== (availability === "unavailable")
    ) {
      fail(id, "aggregate-coverage-labels");
    }
    return;
  }
  const expectedSessions =
    coverage.inspected === 0
      ? "coverage.none"
      : coverage.complete
        ? "coverage.complete"
        : coverage.discoveryLimited
          ? "coverage.sessionsLimited"
          : "coverage.sessions";
  const expectedUnavailable =
    coverage.inspected === 0 ||
    (!coverage.complete && coverage.available === 0);
  if (
    labels.sessions !== expectedSessions ||
    labels.usageUnavailable !== expectedUnavailable
  ) {
    fail(id, "aggregate-coverage-labels");
  }
}

function assertRangeTotals(
  id: string,
  range: NonNullable<UiSessionProjection["range"]>,
): void {
  if (range.resolved !== null) {
    for (const row of range.daily) {
      if (row.date < range.resolved.from || row.date > range.resolved.to) {
        fail(id, "range-membership");
      }
    }
  }
  const totals = range.daily.reduce(
    (
      sum: {
        totalTokens: number;
        cost: number;
        generations: number;
        tools: number;
        days: number;
      },
      row,
    ) => ({
      totalTokens: sum.totalTokens + row.totalTokens,
      cost: round(sum.cost + row.cost),
      generations: sum.generations + row.generations,
      tools: sum.tools + row.tools,
      days: sum.days + 1,
    }),
    { totalTokens: 0, cost: 0, generations: 0, tools: 0, days: 0 },
  );
  if (
    totals.totalTokens !== range.totals.totalTokens ||
    round(totals.cost) !== round(range.totals.cost) ||
    totals.generations !== range.totals.generations ||
    totals.tools !== range.totals.tools ||
    totals.days !== range.totals.days
  ) {
    fail(id, "range-total-reconciliation");
  }
}

export function assertBundleReconciliation(fixture: BundleFixture): void {
  const { id, bundle } = fixture;
  const ui = projectInspectorUi({ bundle });
  const current = [
    [bundle.current.active, ui.current.active],
    [bundle.current.tree, ui.current.tree],
  ] as const;
  for (const [source, projected] of current) {
    if (source.availability === "unavailable" || source.report === undefined) {
      if (
        projected.report !== undefined ||
        projected.range !== undefined ||
        projected.capabilities.length !== 0
      ) {
        fail(id, "unavailable-current-projection");
      }
      assertNoSyntheticZero({ id, value: projected, unavailable: true });
      continue;
    }
    if (projected.report === undefined || projected.range === undefined) {
      fail(id, "current-projection-missing");
    }
    const range = projected.range;
    if (!sameJson(projected.report, sessionView(source.report))) {
      fail(id, "current-report-projection");
    }
    assertRangeTotals(id, range);
    if (source.daily !== undefined && source.usageByDate !== undefined) {
      const rebuilt = buildDailyRows([
        {
          sessionId: source.report.sessionId,
          rows: source.usageByDate,
          truncated: source.dailyTruncated === true,
        },
      ]);
      if (
        !sameJson(rebuilt.rows, source.daily) ||
        rebuilt.truncated !== (source.dailyTruncated === true)
      ) {
        fail(id, "current-daily-source");
      }
      const resolved = range.resolved;
      const expectedDaily =
        resolved === null
          ? []
          : source.daily.filter(
              (row) => row.date >= resolved.from && row.date <= resolved.to,
            );
      if (!sameJson(range.daily, expectedDaily)) {
        fail(id, "current-daily-range");
      }
      const oldest = source.daily[0]?.date;
      const expectedTruncated =
        source.dailyTruncated === true &&
        range.resolved !== null &&
        oldest !== undefined &&
        range.resolved.from < oldest;
      if (range.truncated !== expectedTruncated) {
        fail(id, "current-daily-truncation");
      }
    }
    if (source.datedModels !== undefined) {
      const resolved = range.resolved;
      const expectedModels =
        resolved === null
          ? []
          : modelRangeRows(
              source.datedModels.filter(
                (row) => row.date >= resolved.from && row.date <= resolved.to,
              ),
            );
      if (!sameJson(range.models, expectedModels)) {
        fail(id, "current-model-range");
      }
      const expectedModelsTruncated =
        range.resolved !== null && source.modelsTruncated === true;
      if (range.modelsTruncated !== expectedModelsTruncated) {
        fail(id, "current-model-truncation");
      }
    }
  }
  const reportEqual =
    bundle.current.active.report !== undefined &&
    bundle.current.tree.report !== undefined &&
    sameJson(bundle.current.active.report, bundle.current.tree.report);
  if (bundle.current.sameReportProjection && !reportEqual) {
    fail(id, "current-report-equivalence");
  }
  const treeReport = bundle.current.tree.report;
  if (treeReport !== undefined) {
    assertReportReconciliation({
      id: `${id}-tree-report`,
      state: "complete",
      report: treeReport,
    });
  }
  if (treeReport?.usage !== undefined) {
    const nativeRows = [
      ...treeReport.generations.map(({ usage }) => usage),
      ...treeReport.tools.flatMap(({ usage }) =>
        usage === undefined ? [] : [usage],
      ),
      ...treeReport.compactions.map(({ usage }) => usage),
    ];
    const nativeTotal = nativeRows.reduce(addUsage, {
      totalTokens: 0,
      cost: 0,
    });
    if (!totalsEqual(treeReport.usage, nativeTotal)) {
      fail(id, "native-source-reconciliation");
    }
    const childTotal = treeReport.agents.reduce(
      (total, agent) =>
        agent.usage === undefined ? total : addUsage(total, agent.usage),
      { totalTokens: 0, cost: 0 },
    );
    if (
      (childTotal.totalTokens > 0 || childTotal.cost > 0) &&
      totalsEqual(addUsage(nativeTotal, childTotal), treeReport.usage)
    ) {
      fail(id, "child-usage-additivity");
    }
  }
  if (bundle.history.coverage !== undefined) {
    assertCoveragePartition(bundle.history);
  }
  if (bundle.global.coverage !== undefined) {
    assertCoveragePartition(bundle.global);
  }
  if (ui.history.availability === "unavailable") {
    assertNoSyntheticZero({ id, value: ui.history, unavailable: true });
  }
  if (ui.global.availability === "unavailable") {
    assertNoSyntheticZero({ id, value: ui.global, unavailable: true });
  }
}

export function assertAggregateReconciliation(fixture: AggregateFixture): void {
  const { id, history, global } = fixture;
  if (history.sessions.length !== global.sessions.length) {
    fail(id, "aggregate-membership-count");
  }
  for (let index = 0; index < history.sessions.length; index += 1) {
    if (
      history.sessions[index]?.sessionId !== global.sessions[index]?.sessionId
    ) {
      fail(id, "aggregate-membership-order");
    }
  }
  const byDate = new Map<
    string,
    { sessions: Set<string>; totalTokens: number; cost: number }
  >();
  for (const session of history.sessions) {
    if (session.availability !== "available") {
      if ("usageByDate" in session || "usageByDateTruncated" in session) {
        fail(id, "unavailable-session-usage-window");
      }
      continue;
    }
    for (const row of session.usageByDate) {
      const current = byDate.get(row.date) ?? {
        sessions: new Set<string>(),
        totalTokens: 0,
        cost: 0,
      };
      current.sessions.add(session.sessionId);
      current.totalTokens += row.totalTokens;
      current.cost = round(current.cost + row.cost);
      byDate.set(row.date, current);
    }
  }
  const dates = [...byDate].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const dateWindowTruncated = history.sessions.some(
    (session) =>
      session.availability === "available" && session.usageByDateTruncated,
  );
  if (!dateWindowTruncated) {
    if (dates.length !== global.dates.length) {
      fail(id, "global-date-count");
    }
    const total = { totalTokens: 0, cost: 0 };
    for (let index = 0; index < dates.length; index += 1) {
      const [date, expected] = dates[index];
      const actual = global.dates[index];
      if (
        actual === undefined ||
        actual.date !== date ||
        actual.sessions !== expected.sessions.size ||
        actual.usage.totalTokens !== expected.totalTokens ||
        round(actual.usage.cost) !== round(expected.cost)
      ) {
        fail(id, "global-date-reconciliation");
      }
      total.totalTokens += expected.totalTokens;
      total.cost = round(total.cost + expected.cost);
    }
    if (!totalsEqual(global.usage, total)) {
      fail(id, "global-usage-reconciliation");
    }
  }
  if (history.coverage !== undefined) assertCoveragePartition(history);
  if (global.coverage !== undefined) assertCoveragePartition(global);
  const historyView = projectHistoryReport(history);
  const globalView = projectGlobalReport(global);
  if (
    history.availability === "unavailable" ||
    global.availability === "unavailable"
  ) {
    assertNoSyntheticZero({
      id,
      value: [historyView, globalView],
      unavailable: true,
    });
  }
  assertAggregateCoverageLabels(
    id,
    history.availability,
    history.coverage,
    historyView.usageLabels,
  );
  assertAggregateCoverageLabels(
    id,
    global.availability,
    global.coverage,
    globalView.usageLabels,
  );
  if (
    history.coverage !== undefined &&
    historyView.coverage?.complete !== history.coverage.complete
  ) {
    fail(id, "history-coverage-projection");
  }
  if (
    global.coverage !== undefined &&
    globalView.coverage?.complete !== global.coverage.complete
  ) {
    fail(id, "global-coverage-projection");
  }
  if (historyView.daily.length !== globalView.daily.length) {
    fail(id, "aggregate-projection-date-count");
  }
  for (let index = 0; index < historyView.daily.length; index += 1) {
    const left = historyView.daily[index];
    const right = globalView.daily[index];
    if (
      left?.date !== right?.date ||
      left?.totalTokens !== right?.totalTokens ||
      round(left?.cost ?? 0) !== round(right?.cost ?? 0)
    ) {
      fail(id, "aggregate-projection-reconciliation");
    }
  }
}

export function assertTransportReconciliation(input: {
  report: SessionReport;
  view: SessionReportView;
  ui: InspectorUiSnapshot;
  tui: CurrentTuiModel;
  datedUsage: CurrentTuiModel["datedUsage"];
  snapshots: readonly SnapshotDto[];
}): void {
  const { report, view, ui, tui, datedUsage, snapshots } = input;
  if (!sameJson(tui.report, report)) fail("surfaces", "tui-report-source");
  if (!sameJson(tui.datedUsage, datedUsage)) {
    fail("surfaces", "tui-dated-source");
  }
  if (!sameJson(ui.current.tree.report, view)) {
    fail("surfaces", "ui-report-source");
  }
  const json = renderJson(report);
  if (!json.endsWith("\n") || !sameJson(JSON.parse(json), report)) {
    fail("surfaces", "json-report-source");
  }
  const html = snapshots.map((snapshot) => renderSnapshot(snapshot));
  for (let index = 1; index < html.length; index += 1) {
    if (
      html[index] === html[0] &&
      snapshots[index]?.kind !== snapshots[0]?.kind
    ) {
      fail("surfaces", "snapshot-target-separation");
    }
  }
  for (const rendered of html) {
    if (
      rendered.includes("<script") ||
      rendered.includes("fetch(") ||
      rendered.includes("http://") ||
      rendered.includes("https://")
    ) {
      fail("surfaces", "snapshot-capability-boundary");
    }
  }
  assertPrivacySafe(
    "surfaces",
    [report, view, ui, tui, ...snapshots, json, ...html],
    FORBIDDEN_PRODUCER_KEYS,
  );
}

export function assertRangeRoundTrip(intent: RangeIntent): void {
  const query = serializeRangeQuery(intent)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join("&");
  const parsed = parseRangeQuery(query);
  if (!parsed.ok || !sameJson(parsed.intent, intent)) {
    fail("range", "route-round-trip");
  }
}

export function assertNoSyntheticZero(input: {
  id: string;
  value: unknown;
  unavailable: boolean;
}): void {
  if (!input.unavailable) return;
  const text =
    typeof input.value === "string" ? input.value : JSON.stringify(input.value);
  if (text.includes("$0.00") || /(?:^|[^0-9])0%(?:[^0-9]|$)/.test(text)) {
    fail(input.id, "unavailable-not-zero");
  }
  const hasPublishedUsage = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(hasPublishedUsage);
    if (value === null || typeof value !== "object") return false;
    return Object.entries(value).some(
      ([key, item]) =>
        (key === "usage" && item !== null && item !== undefined) ||
        hasPublishedUsage(item),
    );
  };
  if (hasPublishedUsage(input.value)) {
    fail(input.id, "unavailable-usage");
  }
}

export function assertPrivacySafe(
  id: string,
  values: readonly unknown[],
  forbiddenKeys: readonly string[],
): void {
  const forbidden = new Set(forbiddenKeys);
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      if (
        value.includes("SECRET_") ||
        value.includes("RAW_PRODUCER_") ||
        forbiddenKeys.some((key) => value.includes(key))
      ) {
        fail(id, "privacy-boundary");
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value === null || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (forbidden.has(key)) fail(id, "privacy-boundary");
      visit(item);
    }
  };
  for (const value of values) visit(value);
}

export function runProperty<Ts extends unknown[]>(
  id: string,
  property: fc.IProperty<Ts>,
  seed: number,
): void {
  const details = fc.check(property, {
    seed,
    numRuns: 100,
    endOnFailure: true,
  });
  if (details.failed) {
    throw new Error(
      `[${id}] seed=${details.seed} path=${details.counterexamplePath ?? "-"} runs=${details.numRuns}`,
    );
  }
}

export function assertGeneratedRangeProjection(intent: RangeIntent): void {
  const ui = projectInspectorUi({ bundle: rangeBundle, intent });
  assertBoundedNumbers("range", ui);
  const sessionRanges = [ui.current.active.range, ui.current.tree.range];
  for (const range of sessionRanges) {
    if (range !== undefined) assertRangeTotals("range", range);
  }
  for (const { rows, resolved } of [
    { rows: ui.history.daily, resolved: ui.history.resolved },
    { rows: ui.global.daily, resolved: ui.global.resolved },
  ]) {
    if (resolved !== null) {
      for (const row of rows) {
        if (row.date < resolved.from || row.date > resolved.to) {
          fail("range", "generated-range-membership");
        }
      }
    }
  }
}

export function assertRepeatedReductionStable(
  source: string,
  repeats: number,
): void {
  const outputs: string[] = [];
  for (let index = 0; index < repeats; index += 1) {
    const parsed = parseSessionJsonl(source);
    outputs.push(
      JSON.stringify(
        toSessionReport(reduceEntries(parsed.id ?? "property", parsed.entries)),
      ),
    );
  }
  if (outputs.some((output) => output !== outputs[0])) {
    fail("reduction", "repeat-stability");
  }
}

export function assertDatedUsageReconciliation(input: {
  id: string;
  canonical: CanonicalSession;
  report: SessionReport;
}): void {
  const { id, canonical, report } = input;
  const dated = sessionDatedUsage(canonical);
  for (let index = 1; index < dated.dates.length; index += 1) {
    const previous = dated.dates[index - 1];
    const current = dated.dates[index];
    if (previous === undefined || current === undefined) {
      fail(id, "dated-order");
    }
    if (previous.date >= current.date) {
      fail(id, "dated-order");
    }
  }
  let datedTotal: Usage = { totalTokens: 0, cost: 0 };
  for (const date of dated.dates) {
    let composed: Usage = { totalTokens: 0, cost: 0 };
    for (const part of Object.values(date.composition)) {
      composed = addUsage(composed, part);
    }
    if (
      date.totalTokens !== composed.totalTokens ||
      round(date.cost) !== round(composed.cost)
    ) {
      fail(id, "dated-composition");
    }
    datedTotal = addUsage(datedTotal, date);
  }
  if (canonical.usage.state === "known" && !dated.truncated) {
    usageMatches(id, "dated-usage-fold", datedTotal, canonical.usage.known);
  }

  const nativeTotal = canonical.usage.lines
    .filter(
      (line) => line.domain === "native-session" && line.contributesToSession,
    )
    .reduce((total, line) => addUsage(total, line.usage), {
      totalTokens: 0,
      cost: 0,
    });
  if (canonical.usage.state === "known") {
    usageMatches(
      id,
      "native-usage-ownership",
      canonical.usage.known,
      nativeTotal,
    );
    const childTotal = canonical.usage.lines
      .filter((line) => line.domain === "child-breakdown")
      .reduce((total, line) => addUsage(total, line.usage), {
        totalTokens: 0,
        cost: 0,
      });
    if (childTotal.totalTokens > 0 || childTotal.cost > 0) {
      if (
        totalsEqual(addUsage(nativeTotal, childTotal), canonical.usage.known)
      ) {
        fail(id, "child-usage-additivity");
      }
    }
  }

  if (!dated.truncated && !dated.modelsTruncated) {
    const expected = new Map<
      string,
      { generations: number; totalTokens: number; cost: number }
    >();
    for (const generation of report.generations) {
      const key = `${generation.provider}\u0000${generation.model}`;
      const current = expected.get(key) ?? {
        generations: 0,
        totalTokens: 0,
        cost: 0,
      };
      current.generations += 1;
      current.totalTokens += generation.usage.totalTokens;
      current.cost = round(current.cost + generation.usage.cost);
      expected.set(key, current);
    }
    const actual = new Map<
      string,
      { generations: number; totalTokens: number; cost: number }
    >();
    for (const model of dated.models) {
      const key = `${model.provider}\u0000${model.model}`;
      const current = actual.get(key) ?? {
        generations: 0,
        totalTokens: 0,
        cost: 0,
      };
      current.generations += model.generations;
      current.totalTokens += model.totalTokens;
      current.cost = round(current.cost + model.cost);
      actual.set(key, current);
    }
    if (!sameJson([...actual].sort(), [...expected].sort())) {
      fail(id, "dated-model-fold");
    }
  }
}

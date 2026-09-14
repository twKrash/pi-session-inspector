import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildCanonicalSession,
  type CanonicalSession,
} from "../../src/core/canonical.ts";
import type { Scope } from "../../src/core/events.ts";
import {
  toSessionReport,
  unavailableEvidenceHealth,
  type SessionReport,
} from "../../src/core/reports.ts";
import type { SessionCoverage } from "../../src/core/session-coverage.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";
import { buildDailyRows } from "../../src/ui/daily.ts";
import type { CurrentView, InspectorBundle } from "../../src/ui/bundle.ts";
import { sessionDatedUsage } from "../../src/ui/dated-usage.ts";
import type { GlobalReport, HistoryReport } from "../../src/ui/load-history.ts";
import type {
  SnapshotDto,
  SnapshotHistoryProjection,
  SnapshotHistoryRow,
  SnapshotRange,
  SnapshotSessionProjection,
} from "../../src/ui/snapshot.ts";
import type {
  UiGlobalProjection,
  UiHistoryProjection,
  UiHistorySession,
  UiRangeProjection,
  UiSessionProjection,
} from "../../src/ui/ui-projection.ts";

export type FixtureState =
  | "complete"
  | "partial"
  | "aggregate-only"
  | "expired"
  | "unavailable";

export type ReportFixture = {
  id: string;
  state: FixtureState;
  report: SessionReport;
  canonical?: CanonicalSession;
};

export type BundleFixture = {
  id: string;
  bundle: InspectorBundle;
};

export type AggregateFixture = {
  id: string;
  history: HistoryReport;
  global: GlobalReport;
};

export type CoverageFixture = {
  id: string;
  coverage: SessionCoverage;
};

export type FixtureMatrix = {
  reports: readonly ReportFixture[];
  bundles: readonly BundleFixture[];
  aggregates: readonly AggregateFixture[];
  coverages: readonly CoverageFixture[];
};

function readFixture(relativePath: string): string {
  return readFileSync(
    new URL(`../fixtures/${relativePath}`, import.meta.url),
    "utf8",
  );
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFixture(relativePath)) as T;
}

export function canonicalFromFixture(
  relativePath: string,
  scope: Scope = "tree",
  leafId: string | null = null,
): CanonicalSession {
  const parsed = parseSessionJsonl(readFixture(`pi/0.85.1/${relativePath}`));
  const built = buildCanonicalSession({
    parsed,
    scope,
    leafId,
    evidence: { atomic: [], folded: [] },
  });
  assert.equal(built.state, "ready", `fixture ${relativePath} must build`);
  if (built.state !== "ready") throw new Error("unreachable");
  return built.session;
}

function withoutUsage(report: SessionReport): SessionReport {
  const copy = structuredClone(report);
  delete copy.usage;
  delete copy.usageComposition;
  return copy;
}

export function completeBundleFor(fixture: ReportFixture): InspectorBundle {
  const bundle = readJson<InspectorBundle>("bundles/inspector-bundle.json");
  if (fixture.canonical === undefined) return bundle;
  const dated = sessionDatedUsage(fixture.canonical);
  const daily = buildDailyRows([
    {
      sessionId: fixture.canonical.sessionId,
      rows: dated.dates,
      truncated: dated.truncated,
    },
  ]);
  const currentView = (template: CurrentView): CurrentView => ({
    ...template,
    availability: "available",
    report: fixture.report,
    usageByDate: dated.dates,
    datedModels: dated.models,
    modelsTruncated: dated.modelsTruncated,
    daily: daily.rows,
    dailyTruncated: daily.truncated,
  });
  return {
    ...bundle,
    current: {
      active: currentView(bundle.current.active),
      tree: currentView(bundle.current.tree),
      sameReportProjection: true,
    },
  };
}

function snapshotRange(range: UiRangeProjection): SnapshotRange {
  const { requested: _requested, ...snapshot } = range;
  return snapshot;
}

function snapshotSession(view: UiSessionProjection): SnapshotSessionProjection {
  const { range, ...rest } = view;
  return {
    ...rest,
    ...(range === undefined ? {} : { range: snapshotRange(range) }),
  };
}

export function snapshotForCurrent(view: UiSessionProjection): SnapshotDto {
  return {
    kind: "current",
    schemaVersion: 1,
    theme: "dark",
    projection: snapshotSession(view),
  };
}

export function snapshotForHistory(view: UiHistoryProjection): SnapshotDto {
  const { requested: _requested, sessions, ...rest } = view;
  const rows: SnapshotHistoryRow[] = sessions.map(
    (session: UiHistorySession) => {
      const { view: _view, ...row } = session;
      return row;
    },
  );
  const projection: SnapshotHistoryProjection = { ...rest, sessions: rows };
  return { kind: "history", schemaVersion: 1, theme: "dark", projection };
}

export function snapshotForGlobal(view: UiGlobalProjection): SnapshotDto {
  const { requested: _requested, ...projection } = view;
  return { kind: "global", schemaVersion: 1, theme: "dark", projection };
}

export function fixtureMatrix(): FixtureMatrix {
  const canonical = canonicalFromFixture("mixed-usage.jsonl");
  const complete = toSessionReport(canonical);
  const partialCanonical = canonicalFromFixture("long-session.jsonl");
  const partial = toSessionReport(partialCanonical);
  const aggregateOnly = withoutUsage(
    readJson<SessionReport>("reports/tree.json"),
  );
  const expired = { ...complete, walDetail: "expired" as const };
  const unavailable = {
    ...withoutUsage(partial),
    evidenceHealth: unavailableEvidenceHealth(),
  };
  const bundle = readJson<InspectorBundle>("bundles/inspector-bundle.json");
  const emptyCoverage: SessionCoverage = {
    inspected: 0,
    available: 0,
    unavailable: 0,
    sessionRatio: null,
    complete: false,
    discoveryLimited: false,
    reasons: {},
  };
  const emptyHistory: HistoryReport = {
    availability: "available",
    sessions: [],
    diagnostics: [],
    coverage: emptyCoverage,
  };
  const emptyGlobal: GlobalReport = {
    availability: "available",
    sessions: [],
    usage: { totalTokens: 0, cost: 0 },
    dates: [],
    diagnostics: [],
    coverage: emptyCoverage,
    inventory: { commands: null, skills: null, resources: null },
  };
  const unavailableHistory: HistoryReport = {
    availability: "unavailable",
    sessions: [],
    diagnostics: [],
  };
  const unavailableGlobal: GlobalReport = {
    availability: "unavailable",
    sessions: [],
    usage: { totalTokens: 0, cost: 0 },
    dates: [],
    diagnostics: [],
    inventory: { commands: null, skills: null, resources: null },
  };
  const completeCoverage: SessionCoverage = {
    inspected: 1,
    available: 1,
    unavailable: 0,
    sessionRatio: 1,
    complete: true,
    discoveryLimited: false,
    reasons: {},
  };
  const completeHistory: HistoryReport = {
    ...bundle.history,
    sessions: bundle.history.sessions.filter(
      (session) => session.availability === "available",
    ),
    coverage: completeCoverage,
  };
  const completeGlobal: GlobalReport = {
    ...bundle.global,
    sessions: bundle.global.sessions.filter(
      (session) => session.availability === "available",
    ),
    coverage: completeCoverage,
  };
  const cappedCoverage = readJson<SessionCoverage>(
    "reports/coverage-capped.json",
  );
  const discoveryLimitedHistory: HistoryReport = {
    ...completeHistory,
    coverage: cappedCoverage,
  };
  const discoveryLimitedGlobal: GlobalReport = {
    ...completeGlobal,
    coverage: cappedCoverage,
  };
  const truncatedHistory: HistoryReport = {
    ...bundle.history,
    sessions: bundle.history.sessions.map((session) =>
      session.availability === "available"
        ? { ...session, usageByDateTruncated: true }
        : session,
    ),
  };
  const truncatedGlobal: GlobalReport = {
    ...bundle.global,
    sessions: bundle.global.sessions.map((session) =>
      session.availability === "available"
        ? { ...session, usageByDateTruncated: true }
        : session,
    ),
  };

  return {
    reports: [
      { id: "report-complete", state: "complete", report: complete, canonical },
      {
        id: "report-partial",
        state: "partial",
        report: partial,
        canonical: partialCanonical,
      },
      {
        id: "report-aggregate-only",
        state: "aggregate-only",
        report: aggregateOnly,
      },
      { id: "report-expired", state: "expired", report: expired },
      { id: "report-unavailable", state: "unavailable", report: unavailable },
    ],
    bundles: [{ id: "current-active-tree", bundle }],
    aggregates: [
      {
        id: "history-global",
        history: bundle.history,
        global: bundle.global,
      },
      {
        id: "history-global-empty",
        history: emptyHistory,
        global: emptyGlobal,
      },
      {
        id: "history-global-unavailable",
        history: unavailableHistory,
        global: unavailableGlobal,
      },
      {
        id: "history-global-complete",
        history: completeHistory,
        global: completeGlobal,
      },
      {
        id: "history-global-discovery-limited",
        history: discoveryLimitedHistory,
        global: discoveryLimitedGlobal,
      },
      {
        id: "history-global-truncated",
        history: truncatedHistory,
        global: truncatedGlobal,
      },
    ],
    coverages: [
      {
        id: "coverage-partial",
        coverage: readJson<SessionCoverage>("reports/coverage-partial.json"),
      },
      {
        id: "coverage-capped",
        coverage: readJson<SessionCoverage>("reports/coverage-capped.json"),
      },
      { id: "coverage-empty", coverage: emptyCoverage },
    ],
  };
}

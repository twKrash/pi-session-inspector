import type { RetainedWalRecord } from "../core/canonical.ts";
import type { Scope } from "../core/events.ts";
import type { L0Evidence } from "../core/evidence.ts";
import type { SubagentEvidence } from "../integrations/subagents.ts";
import type { SessionReport } from "../core/reports.ts";
import type { CurrentTuiModel } from "./current.ts";
import { buildDailyRows, type DailyRow } from "./daily.ts";
import type { DatedModelRow, DateUsageRow } from "./dated-usage.ts";
import { loadCurrentSessionReport } from "./load-current.ts";
import {
  loadGlobalReport,
  loadHistoryReports,
  type GlobalReport,
  type HistoryReport,
  type SessionEvidenceProvider,
} from "./load-history.ts";
import type { SessionObservation } from "./observation.ts";

// The one daily-row shape every surface charts (spec §5.4).
export type { DailyRow } from "./daily.ts";

/**
 * The tabs each section can render (spec §15, design §9.3). `environment`
 * replaces the separate commands/skills tabs; a multi-session aggregate exposes
 * overview only until its breakdowns are defined, while a selected history
 * session carries a full `SessionReport` and therefore offers every tab.
 */
const ALL_TABS: readonly string[] = [
  "overview",
  "models",
  "tools",
  "environment",
  "agents",
  "integrations",
  "errors",
  "ledger",
];

/**
 * The one capability table the browser is built from. `historySession` is not a
 * section: it is the set a history route offers once a session is selected
 * (design §9.3), so a deep link to a session's Models tab is honoured while
 * `#/history/models` for the aggregate still coerces to overview.
 */
export const CAPABILITIES: Readonly<
  Record<"current" | "history" | "historySession" | "global", readonly string[]>
> = {
  current: ALL_TABS,
  history: ["overview"],
  historySession: ALL_TABS,
  global: ["overview"],
};

/** A view that failed to replay can render no tab at all. */
const NO_CAPABILITIES: readonly string[] = [];

/**
 * One precomputed current view. `report` is the only home for report-derived
 * tables; `usageByDate` and `datedModels` carry the view's own dated projection
 * and `daily` the folded range rows. A view that failed to replay is
 * `unavailable` with a bounded diagnostic code, never fabricated zeros, and a
 * view whose projection is absent carries no dated key at all.
 */
export type CurrentView = {
  availability: "available" | "unavailable";
  diagnostic?: string;
  report?: SessionReport;
  /** The bounded per-date rows the session's own usage lines produced. */
  usageByDate?: readonly DateUsageRow[];
  /** Per-date model rows; capped at MAX_MODELS_PER_DATE and flagged. */
  datedModels?: readonly DatedModelRow[];
  modelsTruncated?: boolean;
  daily?: readonly DailyRow[];
  dailyTruncated?: boolean;
  /** The tabs this view can render; an unavailable view renders none. */
  capabilities?: readonly string[];
};

/** One self-contained, offline document's worth of report-level DTOs. */
export type InspectorBundle = {
  schemaVersion: 1;
  theme: "light" | "dark";
  initialScope: Scope;
  current: {
    active: CurrentView;
    tree: CurrentView;
    /**
     * True when both views carry the same report projection (spec §4.3). It is
     * a statement about report data only, never about entry sets: `false` means
     * the views differ, not that one of them is wrong.
     */
    sameReportProjection: boolean;
  };
  history: HistoryReport;
  global: GlobalReport;
};

type MaintenanceOptions = {
  writerId: string;
  now: () => Date;
  isPidAlive: (pid: number) => boolean;
};

export type CurrentSessionLoader = (
  scope: Scope,
) => Promise<CurrentTuiModel | undefined>;
export type HistoryLoader = () => Promise<HistoryReport>;
export type GlobalLoader = () => Promise<GlobalReport>;

/**
 * Input for {@link loadInspectorBundle}. The three loaders are injectable so
 * tests can count calls and exercise degradation; they default to the real
 * report loaders. `initialScope` only selects which precomputed view is shown
 * first — both views are always attempted.
 */
export type InspectorBundleInput = {
  theme: "light" | "dark";
  initialScope: Scope;
  root: string;
  sessionDirectory(): string;
  maintenance: MaintenanceOptions;
  observation?: SessionObservation;
  /**
   * L0 evidence for the current session, built by the composition root. The
   * bundle never reads storage for it; without it the current views stay
   * evidence-free exactly like a loader called without evidence.
   */
  currentEvidence?: {
    evidence: L0Evidence;
    walRecords?: readonly RetainedWalRecord[];
    liveOverflow?: number;
  };
  /** Composition-root provider for validated archive-backed child evidence. */
  subagentEvidence?: (
    entries: readonly import("../core/events.ts").SessionEntry[],
    sessionId: string,
  ) => Promise<SubagentEvidence>;
  /**
   * Per-session L0 evidence for history/global sections, built by the
   * composition root (R51). The default history/global loaders forward it; a
   * caller that injects its own loaders may omit it.
   */
  historyEvidence?: SessionEvidenceProvider;
  current?: { sessionFile?: string; leafId: string | null };
  loadCurrent?: CurrentSessionLoader;
  loadHistory?: HistoryLoader;
  loadGlobal?: GlobalLoader;
};

/** Bounded code, never free text or a raw error message. */
const CURRENT_UNAVAILABLE = "current-unavailable";

/**
 * Loads every section of the Inspector UI document: both current views are
 * replayed at generation time (active-leaf and tree scope) and history/global
 * use their existing loaders. It never writes and never throws — any section
 * or view failure degrades to `availability: "unavailable"`.
 */
export async function loadInspectorBundle(
  input: InspectorBundleInput,
): Promise<InspectorBundle> {
  const loadCurrent = input.loadCurrent ?? defaultCurrentLoader(input);
  const loadHistory = input.loadHistory ?? defaultHistoryLoader(input);
  const loadGlobal = input.loadGlobal ?? defaultGlobalLoader(input);

  // Both views are always attempted; initialScope never changes what is
  // precomputed, only which view the renderer displays first.
  const [active, tree] = await Promise.all([
    currentView(loadCurrent, "active"),
    currentView(loadCurrent, "tree"),
  ]);
  const [history, global] = await Promise.all([
    historySection(loadHistory),
    globalSection(loadGlobal),
  ]);

  return {
    schemaVersion: 1,
    theme: input.theme,
    initialScope: input.initialScope,
    current: {
      active,
      tree,
      sameReportProjection: sameReportProjection(active, tree),
    },
    history,
    global,
  };
}

async function currentView(
  loadCurrent: CurrentSessionLoader,
  scope: Scope,
): Promise<CurrentView> {
  let model: CurrentTuiModel | undefined;
  try {
    model = await loadCurrent(scope);
  } catch {
    return noCurrentView();
  }
  if (model === undefined) {
    return noCurrentView();
  }
  const { report } = model;
  const projection = model.datedUsage;
  // The view's daily rows are the fold of the very projection the session
  // published, so no timestamp is read twice and a partial window stays partial.
  const daily =
    projection === undefined
      ? undefined
      : buildDailyRows([
          {
            sessionId: report.sessionId,
            rows: projection.dates,
            truncated: projection.truncated,
          },
        ]);
  return {
    availability: "available",
    report,
    ...(projection === undefined
      ? {}
      : {
          usageByDate: projection.dates,
          datedModels: projection.models,
          modelsTruncated: projection.modelsTruncated,
        }),
    ...(daily === undefined
      ? {}
      : { daily: daily.rows, dailyTruncated: daily.truncated }),
    capabilities: CAPABILITIES.current,
  };
}

/** A view that could not be replayed: one bounded code, no rows, no tabs. */
function noCurrentView(): CurrentView {
  return {
    availability: "unavailable",
    diagnostic: CURRENT_UNAVAILABLE,
    capabilities: NO_CAPABILITIES,
  };
}

/**
 * True when both views carry the same report projection (spec §4.3): the same
 * availability, the same diagnostic when unavailable, and byte-identical
 * `report`, `daily` and `datedModels` data. The capability table is view wiring,
 * not report data, and object identity is never the claim.
 */
function sameReportProjection(active: CurrentView, tree: CurrentView): boolean {
  if (active.availability !== tree.availability) return false;
  if (active.diagnostic !== tree.diagnostic) return false;
  return canonicalViewData(active) === canonicalViewData(tree);
}

function canonicalViewData(view: CurrentView): string {
  return canonical({
    report: view.report ?? null,
    daily: view.daily ?? null,
    datedModels: view.datedModels ?? null,
  });
}

/**
 * Stable serialization for the comparison above: object keys sorted, arrays in
 * their documented order, `undefined` entries dropped. Two views with the same
 * data always compare equal, whatever order their keys were built in.
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function historySection(
  loadHistory: HistoryLoader,
): Promise<HistoryReport> {
  try {
    return await loadHistory();
  } catch {
    return { availability: "unavailable", sessions: [], diagnostics: [] };
  }
}

async function globalSection(loadGlobal: GlobalLoader): Promise<GlobalReport> {
  try {
    return await loadGlobal();
  } catch {
    return {
      availability: "unavailable",
      sessions: [],
      usage: { totalTokens: 0, cost: 0 },
      dates: [],
      diagnostics: [],
      inventory: { commands: null, skills: null, resources: null },
    };
  }
}

function defaultCurrentLoader(
  input: InspectorBundleInput,
): CurrentSessionLoader {
  const sessionFile = input.current?.sessionFile;
  const leafId = input.current?.leafId ?? null;
  const { observation, currentEvidence } = input;
  return (scope) =>
    loadCurrentSessionReport(sessionFile, scope, {
      leafId,
      ...(observation === undefined ? {} : { observation }),
      ...(currentEvidence === undefined ? {} : currentEvidence),
      ...(input.subagentEvidence === undefined
        ? {}
        : { subagentEvidence: input.subagentEvidence }),
    });
}

function defaultHistoryLoader(input: InspectorBundleInput): HistoryLoader {
  return () =>
    loadHistoryReports({
      root: input.root,
      sessionDirectory: input.sessionDirectory,
      scope: "tree",
      maintenance: input.maintenance,
      ...(input.historyEvidence === undefined
        ? {}
        : { sessionEvidence: input.historyEvidence }),
    });
}

function defaultGlobalLoader(input: InspectorBundleInput): GlobalLoader {
  return () =>
    loadGlobalReport({
      root: input.root,
      sessionDirectory: input.sessionDirectory,
      scope: "tree",
      maintenance: input.maintenance,
      ...(input.historyEvidence === undefined
        ? {}
        : { sessionEvidence: input.historyEvidence }),
    });
}

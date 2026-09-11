import type { Scope } from "../core/events.ts";
import type { SessionReport } from "../core/reports.ts";
import type { CurrentTuiModel } from "./current.ts";
import { loadCurrentSessionReport } from "./load-current.ts";
import {
  loadGlobalReport,
  loadHistoryReports,
  type GlobalReport,
  type HistoryReport,
} from "./load-history.ts";
import type { SessionObservation } from "./observation.ts";

/** Bounded offline range row for one calendar date of one current view. */
export type DailyRow = {
  date: string;
  sessions: number;
  totalTokens: number;
  cost: number;
  generations: number;
  tools: number;
};

/**
 * One precomputed current view. `report` is the only home for report-derived
 * tables; `daily` carries the offline range rows. A view that failed to replay
 * is `unavailable` with a bounded diagnostic code, never fabricated zeros.
 */
export type CurrentView = {
  availability: "available" | "unavailable";
  diagnostic?: string;
  report?: SessionReport;
  daily?: readonly DailyRow[];
  dailyTruncated?: boolean;
};

/** One self-contained, offline document's worth of report-level DTOs. */
export type InspectorBundle = {
  schemaVersion: 1;
  theme: "light" | "dark";
  initialScope: Scope;
  current: { active: CurrentView; tree: CurrentView };
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
  current?: { sessionFile?: string; leafId: string | null };
  loadCurrent?: CurrentSessionLoader;
  loadHistory?: HistoryLoader;
  loadGlobal?: GlobalLoader;
};

/** Daily rows beyond this bound are dropped and marked truncated. */
const MAX_DAILY_ROWS = 366;
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
    current: { active, tree },
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
    return { availability: "unavailable", diagnostic: CURRENT_UNAVAILABLE };
  }
  if (model === undefined) {
    return { availability: "unavailable", diagnostic: CURRENT_UNAVAILABLE };
  }
  const { rows, truncated } = dailyRows(model.report);
  return {
    availability: "available",
    report: model.report,
    daily: rows,
    dailyTruncated: truncated,
  };
}

/**
 * Projects one date-keyed row per date present in the report's own dated
 * evidence (generations, tools, compactions). `sessions` is always 1 per
 * date because a current view covers exactly one session. Only the most
 * recent `MAX_DAILY_ROWS` dates are kept so range presets anchored on the
 * newest date remain complete.
 */
function dailyRows(report: SessionReport): {
  rows: DailyRow[];
  truncated: boolean;
} {
  const byDate = new Map<string, DailyRow>();
  const rowFor = (date: string): DailyRow => {
    const existing = byDate.get(date);
    if (existing !== undefined) return existing;
    const row: DailyRow = {
      date,
      sessions: 1,
      totalTokens: 0,
      cost: 0,
      generations: 0,
      tools: 0,
    };
    byDate.set(date, row);
    return row;
  };

  for (const generation of report.generations) {
    const date = dayOf(generation.timestamp);
    if (date === undefined) continue;
    const row = rowFor(date);
    row.generations += 1;
    row.totalTokens += generation.usage.totalTokens;
    row.cost += generation.usage.cost;
  }
  for (const tool of report.tools) {
    const date = dayOf(tool.timestamp);
    if (date === undefined) continue;
    const row = rowFor(date);
    row.tools += 1;
    if (tool.usage !== undefined) {
      row.totalTokens += tool.usage.totalTokens;
      row.cost += tool.usage.cost;
    }
  }
  for (const compaction of report.compactions) {
    const date = dayOf(compaction.timestamp);
    if (date === undefined) continue;
    const row = rowFor(date);
    row.totalTokens += compaction.usage.totalTokens;
    row.cost += compaction.usage.cost;
  }

  const all = [...byDate.values()].sort((left, right) =>
    left.date.localeCompare(right.date),
  );
  const truncated = all.length > MAX_DAILY_ROWS;
  return {
    rows: truncated ? all.slice(all.length - MAX_DAILY_ROWS) : all,
    truncated,
  };
}

function dayOf(timestamp: string): string | undefined {
  const date = timestamp.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
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
  const { observation } = input;
  return (scope) =>
    loadCurrentSessionReport(sessionFile, scope, {
      leafId,
      ...(observation === undefined ? {} : { observation }),
      inspectorRoot: input.root,
    });
}

function defaultHistoryLoader(input: InspectorBundleInput): HistoryLoader {
  return () =>
    loadHistoryReports({
      root: input.root,
      sessionDirectory: input.sessionDirectory,
      scope: "tree",
      maintenance: input.maintenance,
    });
}

function defaultGlobalLoader(input: InspectorBundleInput): GlobalLoader {
  return () =>
    loadGlobalReport({
      root: input.root,
      sessionDirectory: input.sessionDirectory,
      scope: "tree",
      maintenance: input.maintenance,
    });
}

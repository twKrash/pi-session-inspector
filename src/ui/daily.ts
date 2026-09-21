import { usageFieldCoverage } from "../core/events.ts";
import {
  attachUsageFieldCoverage,
  MAX_DATED_DATES,
  mergeUsageFieldCoverage,
  OPTIONAL_USAGE_FIELDS,
  type DateUsageRow,
  type OptionalUsageFields,
  type SafeUsage,
  type UsageCoverageCarrier,
  usageFieldCoverageOf,
} from "./dated-usage.ts";

/** One date of one or more sessions: the only daily series any surface charts. */
export type DailyRow = {
  date: string;
  sessions: number;
  totalTokens: number;
  cost: number;
  generations: number;
  tools: number;
  /** The four additive parts, so a fold stays exactly as additive as its inputs. */
  composition: {
    generations: SafeUsage;
    toolResults: SafeUsage;
    compactions: SafeUsage;
    branchSummaries: SafeUsage;
  };
} & OptionalUsageFields &
  UsageCoverageCarrier;

/** One session's contribution: its own dated window and that window's verdict. */
export type DailyContribution = {
  sessionId: string;
  rows: readonly DateUsageRow[];
  truncated: boolean;
};

const COMPOSITION_PARTS = [
  "generations",
  "toolResults",
  "compactions",
  "branchSummaries",
] as const;

const zero = (): SafeUsage => ({ totalTokens: 0, cost: 0 });
// The dated projection and the reducer round costs at this precision, so a fold
// of already-rounded rows stays equal to the report's own total (spec §5.6).
const round = (value: number): number =>
  Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;

/**
 * Sums per-session dated rows by date (spec §5.4, R19). It never reads a
 * timestamp: a session that cannot be dated contributes nothing and is counted
 * only by the coverage line. `sessions` counts the distinct sessions that
 * contributed to a date. `truncated` is true when any contribution was capped
 * or partial, or when the fold itself exceeds MAX_DATED_DATES: an aggregate
 * never looks complete while a contributing window is partial.
 */
export function buildDailyRows(contributions: readonly DailyContribution[]): {
  rows: DailyRow[];
  truncated: boolean;
} {
  const byDate = new Map<string, { row: DailyRow; sessionIds: Set<string> }>();
  const at = (date: string): { row: DailyRow; sessionIds: Set<string> } => {
    const existing = byDate.get(date);
    if (existing !== undefined) return existing;
    const created = {
      row: {
        date,
        sessions: 0,
        totalTokens: 0,
        cost: 0,
        generations: 0,
        tools: 0,
        composition: {
          generations: zero(),
          toolResults: zero(),
          compactions: zero(),
          branchSummaries: zero(),
        },
      },
      sessionIds: new Set<string>(),
    };
    attachUsageFieldCoverage(created.row, usageFieldCoverage([]));
    byDate.set(date, created);
    return created;
  };

  let truncated = false;
  for (const contribution of contributions) {
    // The flag travels with the window, not with its rows: a session whose
    // usage summary is unavailable contributes no row and still makes the
    // aggregate partial.
    truncated = truncated || contribution.truncated;
    for (const dated of contribution.rows) {
      const { row, sessionIds } = at(dated.date);
      sessionIds.add(contribution.sessionId);
      row.totalTokens += dated.totalTokens;
      row.cost = round(row.cost + dated.cost);
      row.generations += dated.generations;
      row.tools += dated.tools;
      for (const field of OPTIONAL_USAGE_FIELDS) {
        const value = dated[field];
        if (value !== undefined) {
          const next = (row[field] ?? 0) + value;
          row[field] = field.endsWith("Cost") ? round(next) : next;
        }
      }
      attachUsageFieldCoverage(
        row,
        mergeUsageFieldCoverage([
          usageFieldCoverageOf(row),
          usageFieldCoverageOf(dated) ?? usageFieldCoverage([dated]),
        ]),
      );
      for (const part of COMPOSITION_PARTS) {
        const total = row.composition[part];
        total.totalTokens += dated.composition[part].totalTokens;
        total.cost = round(total.cost + dated.composition[part].cost);
        for (const field of OPTIONAL_USAGE_FIELDS) {
          const value = dated.composition[part][field];
          if (value === undefined) continue;
          const next = (total[field] ?? 0) + value;
          total[field] = field.endsWith("Cost") ? round(next) : next;
        }
      }
    }
  }

  const all = [...byDate.values()].sort((left, right) =>
    left.row.date.localeCompare(right.row.date),
  );
  const capped = all.length > MAX_DATED_DATES;
  const retained = capped ? all.slice(all.length - MAX_DATED_DATES) : all;
  return {
    rows: retained.map(({ row, sessionIds }) =>
      attachUsageFieldCoverage(
        {
          ...row,
          sessions: sessionIds.size,
        },
        usageFieldCoverageOf(row) ?? usageFieldCoverage([]),
      ),
    ),
    truncated: truncated || capped,
  };
}

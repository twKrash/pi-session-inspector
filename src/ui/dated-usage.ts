import type {
  CanonicalSession,
  CanonicalUsageLine,
} from "../core/canonical.ts";
import type { Usage } from "../core/events.ts";

export type SafeUsage = { totalTokens: number; cost: number };
export type DateUsageRow = {
  date: string;
  totalTokens: number;
  cost: number;
  /**
   * The optional producer token breakdown travels with the date so an aggregate
   * fold stays exactly as additive as the per-record fold it replaces. A key is
   * present only when a contributing native line carried it, never as zero.
   */
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  generations: number;
  tools: number;
  errors: number;
  composition: {
    generations: SafeUsage;
    toolResults: SafeUsage;
    compactions: SafeUsage;
    branchSummaries: SafeUsage;
  };
};
export type DatedModelRow = {
  date: string;
  provider: string;
  model: string;
  generations: number;
  totalTokens: number;
  cost: number;
};

export const MAX_DATED_DATES = 366;
export const MAX_MODELS_PER_DATE = 64;
const COMPOSITION_PART: Readonly<
  Record<
    CanonicalUsageLine["bucket"],
    keyof DateUsageRow["composition"] | undefined
  >
> = {
  generation: "generations",
  "tool-result": "toolResults",
  compaction: "compactions",
  "branch-summary": "branchSummaries",
  "child-run": undefined,
};
const OPTIONAL_USAGE_FIELDS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
] as const;
const zero = (): SafeUsage => ({ totalTokens: 0, cost: 0 });
// The canonical builder and the reducer both round costs at this precision, so
// a per-date sum can equal the report's own total exactly (spec §5.6).
const round = (value: number): number =>
  Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
const dayOf = (timestamp: unknown): string | undefined => {
  if (typeof timestamp !== "string") return undefined;
  const date = timestamp.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
};

/**
 * THE dated projection (spec §5.4, R19): every per-date figure comes from the
 * builder's own attribution. Line dates are grouped by bucket; `dateByOwner`
 * makes the model rows share the very same decision, so a generation can never
 * appear in one projection and not the other. Observation counters
 * (`generations`/`tools`/`errors`) describe activity, not spend.
 */
export function sessionDatedUsage(session: CanonicalSession): {
  dates: DateUsageRow[];
  models: DatedModelRow[];
  truncated: boolean;
  modelsTruncated: boolean;
} {
  const byDate = new Map<string, DateUsageRow>();
  const rowFor = (date: string): DateUsageRow => {
    const existing = byDate.get(date) ?? {
      date,
      totalTokens: 0,
      cost: 0,
      generations: 0,
      tools: 0,
      errors: 0,
      composition: {
        generations: zero(),
        toolResults: zero(),
        compactions: zero(),
        branchSummaries: zero(),
      },
    };
    byDate.set(date, existing);
    return existing;
  };
  const addUsage = (
    row: DateUsageRow,
    usage: Usage,
    part: keyof DateUsageRow["composition"],
  ): void => {
    row.composition[part].totalTokens += usage.totalTokens;
    row.composition[part].cost = round(row.composition[part].cost + usage.cost);
    row.totalTokens += usage.totalTokens;
    row.cost = round(row.cost + usage.cost);
    for (const field of OPTIONAL_USAGE_FIELDS) {
      const value = usage[field];
      if (value === undefined) continue;
      row[field] = (row[field] ?? 0) + value;
    }
  };
  const dateByOwner = new Map<string, string>();
  let unattributed = false;
  let nativeLines = 0;
  // An overflowed aggregate publishes no total, so its bounded lines are never
  // summed here either (`unavailable != 0`); they only make the window partial
  // below instead of being dated as a fabricated zero row.
  const publishable = session.usage.state === "known";
  for (const line of session.usage.lines) {
    // Child runs are a breakdown of this session's tool-result usage and are
    // never added to a native date row.
    if (line.domain !== "native-session") continue;
    nativeLines += 1;
    if (!publishable) continue;
    const date =
      line.attributedAt.state === "known"
        ? dayOf(line.attributedAt.at)
        : undefined;
    if (date === undefined) {
      unattributed = true;
      continue;
    }
    dateByOwner.set(line.ownerId, date);
    const part = COMPOSITION_PART[line.bucket];
    if (part !== undefined) addUsage(rowFor(date), line.usage, part);
  }
  for (const generation of session.generations) {
    const date = dayOf(generation.timestamp);
    if (date !== undefined) rowFor(date).generations += 1;
  }
  for (const tool of session.tools) {
    const date = dayOf(tool.timestamp);
    if (date !== undefined) rowFor(date).tools += 1;
  }
  for (const error of session.errors) {
    const date = dayOf(error.timestamp);
    if (date !== undefined) rowFor(date).errors += 1;
  }
  const byModel = new Map<string, DatedModelRow>();
  const perDate = new Map<string, Set<string>>();
  let modelsTruncated = false;
  for (const generation of session.generations) {
    const date = dateByOwner.get(generation.id);
    if (date === undefined) continue;
    const key = `${date}\u0000${generation.provider}\u0000${generation.model}`;
    const seen = perDate.get(date) ?? new Set<string>();
    if (!seen.has(key)) {
      if (seen.size >= MAX_MODELS_PER_DATE) {
        modelsTruncated = true;
        continue;
      }
      seen.add(key);
      perDate.set(date, seen);
    }
    const row = byModel.get(key) ?? {
      date,
      provider: generation.provider,
      model: generation.model,
      generations: 0,
      totalTokens: 0,
      cost: 0,
    };
    row.generations += 1;
    row.totalTokens += generation.usage.totalTokens;
    row.cost = round(row.cost + generation.usage.cost);
    byModel.set(key, row);
  }
  const all = [...byDate.keys()].sort();
  const capped = all.length > MAX_DATED_DATES;
  // An unavailable summary with native lines means spend exists that this
  // window cannot represent: it is partial, never complete. With no native
  // line there is simply nothing to date (spec §5.6).
  const usageUnavailable = nativeLines > 0 && !publishable;
  const retained = capped ? all.slice(all.length - MAX_DATED_DATES) : all;
  const kept = new Set(retained);
  return {
    dates: retained.map((date) => byDate.get(date) as DateUsageRow),
    models: [...byModel.values()]
      .filter((row) => kept.has(row.date))
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          a.provider.localeCompare(b.provider) ||
          a.model.localeCompare(b.model),
      ),
    truncated:
      capped ||
      unattributed ||
      usageUnavailable ||
      session.health.usage.dated === "partial",
    modelsTruncated,
  };
}

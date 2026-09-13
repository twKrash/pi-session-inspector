/**
 * The pure range contract (design §5.1-§5.6): presets anchored on a view's own
 * latest observed UTC date, inclusive boundaries, a validated custom pair, one
 * filter for every tab, and honest aggregate membership.
 *
 * Every exported function below is inlined into the generated document with
 * `Function.prototype.toString()` and evaluated with no module scope, so each
 * one is self-contained: no module-scope constant, no runtime import, no Node
 * or DOM API, no clock read, and no module-scope regex. Constants are declared
 * inside the function that uses them, and shared logic is written inline rather
 * than as a named nested helper: the transpiler wraps named nested functions
 * with a module-scope `__name` helper, which would break the inlined source.
 * Type-only declarations are erased at runtime and carry no such requirement.
 */

/** The three bounded presets. Module-internal: `RangeState`/`RangeIntent` name it. */
type RangePreset = 7 | 14 | 30;

/** A resolved range: a preset (when one produced it) plus its inclusive span. */
export type RangeState = {
  preset: RangePreset | null;
  from: string;
  to: string;
};

/**
 * A range as chosen in the interface, before it meets a view's dates: a preset
 * is an unresolved intent, a custom range is an already validated pair.
 */
export type RangeIntent =
  | { kind: "preset"; preset: RangePreset }
  | { kind: "custom"; from: string; to: string };

/**
 * The latest `YYYY-MM-DD` in `dates`, ignoring anything not in that exact
 * format. Fixed-width ISO dates compare chronologically as strings, so no clock
 * or calendar arithmetic is needed. `undefined` when no valid date exists.
 */
export function latestObservedDate(
  dates: readonly string[],
): string | undefined {
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  let latest: string | undefined;
  for (const value of dates) {
    if (typeof value !== "string" || !DATE.test(value)) continue;
    if (latest === undefined || value > latest) latest = value;
  }
  return latest;
}

/**
 * Shifts one UTC calendar date by whole days, handling month and year
 * boundaries. Returns `undefined` for a malformed or non-existent date (for
 * example `2026-02-30`) and for a non-integer offset. No clock is read and no
 * `1970-01-01` sentinel is ever substituted: an unparsable date is refused.
 */
export function shiftUtcDay(date: string, days: number): string | undefined {
  const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
  const match = DATE.exec(date);
  if (match === null || !Number.isInteger(days)) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const at = new Date(0);
  at.setUTCFullYear(year, month - 1, day);
  if (
    at.getUTCFullYear() !== year ||
    at.getUTCMonth() !== month - 1 ||
    at.getUTCDate() !== day
  ) {
    return undefined;
  }
  at.setUTCDate(at.getUTCDate() + days);
  return `${String(at.getUTCFullYear()).padStart(4, "0")}-${String(at.getUTCMonth() + 1).padStart(2, "0")}-${String(at.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Resolves a preset against a view's own dates: `to` is the latest observed
 * date and `from` is `to - (preset - 1)`, so the span is inclusive and anchored
 * on observation, never on the machine clock. `undefined` when the view has no
 * valid date (there is nothing to anchor on).
 */
export function presetRange(
  preset: RangePreset,
  dates: readonly string[],
): RangeState | undefined {
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  let to: string | undefined;
  for (const value of dates) {
    if (typeof value !== "string" || !DATE.test(value)) continue;
    if (to === undefined || value > to) to = value;
  }
  if (to === undefined) return undefined;
  const at = new Date(0);
  at.setUTCFullYear(
    Number(to.slice(0, 4)),
    Number(to.slice(5, 7)) - 1,
    Number(to.slice(8, 10)) - (preset - 1),
  );
  const from = `${String(at.getUTCFullYear()).padStart(4, "0")}-${String(at.getUTCMonth() + 1).padStart(2, "0")}-${String(at.getUTCDate()).padStart(2, "0")}`;
  return { preset, from, to };
}

/**
 * Resolves a range intent against a view's own dates. A valid custom pair
 * passes through unchanged (never clamped to observed data) and is honoured
 * even when the view has no observed dates, so a deep link is restored exactly.
 * With no intent, `current` defaults to the full observed span (`preset: null`)
 * and `aggregate` to 14 days. A preset intent anchors on the view's latest
 * date. `undefined` when a default or preset intent meets a view with no valid
 * date (there is nothing to anchor on), or when a custom pair is itself
 * invalid.
 */
export function resolveRange(
  intent: RangeIntent | undefined,
  dates: readonly string[],
  kind: "current" | "aggregate",
): RangeState | undefined {
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  let earliest: string | undefined;
  let latest: string | undefined;
  for (const value of dates) {
    if (typeof value !== "string" || !DATE.test(value)) continue;
    if (earliest === undefined || value < earliest) earliest = value;
    if (latest === undefined || value > latest) latest = value;
  }
  if (intent !== undefined && intent.kind === "custom") {
    if (
      !DATE.test(intent.from) ||
      !DATE.test(intent.to) ||
      intent.from > intent.to
    ) {
      return undefined;
    }
    return { preset: null, from: intent.from, to: intent.to };
  }
  if (latest === undefined) return undefined;
  const preset: RangePreset | null =
    intent === undefined ? (kind === "aggregate" ? 14 : null) : intent.preset;
  if (preset === null)
    return { preset: null, from: earliest ?? latest, to: latest };
  const at = new Date(0);
  at.setUTCFullYear(
    Number(latest.slice(0, 4)),
    Number(latest.slice(5, 7)) - 1,
    Number(latest.slice(8, 10)) - (preset - 1),
  );
  const from = `${String(at.getUTCFullYear()).padStart(4, "0")}-${String(at.getUTCMonth() + 1).padStart(2, "0")}-${String(at.getUTCDate()).padStart(2, "0")}`;
  return { preset, from, to: latest };
}

/** True when a UTC date falls inside a range; both boundaries are inclusive. */
export function isInRange(date: string, range: RangeState): boolean {
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  if (!DATE.test(date)) return false;
  return date >= range.from && date <= range.to;
}

/** Serializes a range intent into the route query pairs (design §9.1). */
export function serializeRangeQuery(intent: RangeIntent): [string, string][] {
  if (intent.kind === "preset") return [["preset", String(intent.preset)]];
  return [
    ["from", intent.from],
    ["to", intent.to],
  ];
}

/**
 * Parses a route query into a range intent, or `undefined` when it cannot be
 * applied as a whole. A `preset` key has precedence over a pair and must name a
 * known preset; otherwise a complete, well-formed, non-inverted `from`/`to`
 * pair is required. A lone endpoint, a malformed date, an empty string, and an
 * unknown or empty preset are all rejected — never partially applied.
 */
export function parseRangeQuery(query: string): RangeIntent | undefined {
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  if (typeof query !== "string") return undefined;
  const params = new Map<string, string>();
  for (const part of query.split("&")) {
    if (part === "") continue;
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const key = part.slice(0, separator);
    if (!params.has(key)) params.set(key, part.slice(separator + 1));
  }
  const preset = params.get("preset");
  if (preset !== undefined) {
    const resolved: RangePreset | undefined =
      preset === "7"
        ? 7
        : preset === "14"
          ? 14
          : preset === "30"
            ? 30
            : undefined;
    if (resolved === undefined) return undefined;
    return { kind: "preset", preset: resolved };
  }
  const from = params.get("from");
  const to = params.get("to");
  if (from === undefined || to === undefined) return undefined;
  if (!DATE.test(from) || !DATE.test(to)) return undefined;
  if (from > to) return undefined;
  return { kind: "custom", from, to };
}

/**
 * The row sets one view filters. `rows`, `models` and `tools` carry a `date`
 * where the projection produced one; a tool may instead carry the canonical
 * persisted `timestamp`, whose UTC day is the call day (design §5.7). `agents`
 * are dated by `observedAt` and `errors` by `timestamp`, and either field may
 * be absent — an undated row is never in range.
 */
export type ViewRows = {
  rows: readonly { date?: string }[];
  models: readonly { date?: string }[];
  tools: readonly { date?: string; timestamp?: string }[];
  agents: readonly { observedAt?: string }[];
  errors: readonly { timestamp?: string }[];
};

/**
 * The one range filter every tab renders from (design §5.4): keeps the rows
 * whose UTC date is inside the range and preserves each array's order. It is
 * generic over the view so a caller's concrete row types survive the filter.
 * Each predicate is written inline: a named nested helper would be transpiled
 * with a module-scope `__name`, which the inlined source cannot resolve.
 */
export function filterView<T extends ViewRows>(view: T, range: RangeState): T {
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const source: ViewRows = view;
  const next: ViewRows = {
    rows: source.rows.filter((row) => {
      const date = typeof row.date === "string" ? row.date.slice(0, 10) : "";
      return DATE.test(date) && date >= range.from && date <= range.to;
    }),
    models: source.models.filter((row) => {
      const date = typeof row.date === "string" ? row.date.slice(0, 10) : "";
      return DATE.test(date) && date >= range.from && date <= range.to;
    }),
    tools: source.tools.filter((row) => {
      const value = row.date ?? row.timestamp;
      const date = typeof value === "string" ? value.slice(0, 10) : "";
      return DATE.test(date) && date >= range.from && date <= range.to;
    }),
    agents: source.agents.filter((row) => {
      const value = row.observedAt;
      const date = typeof value === "string" ? value.slice(0, 10) : "";
      return DATE.test(date) && date >= range.from && date <= range.to;
    }),
    errors: source.errors.filter((row) => {
      const value = row.timestamp;
      const date = typeof value === "string" ? value.slice(0, 10) : "";
      return DATE.test(date) && date >= range.from && date <= range.to;
    }),
  };
  return { ...view, ...next } as T;
}

/** One aggregate session's verdict for a range (design §5.6). */
export type HistoryRowRange = {
  /** At least one retained dated row lies inside the range. */
  member: boolean;
  /** In-range usage, or `null` when the whole range is omitted history. */
  totalTokens: number | null;
  cost: number | null;
  /** The range reaches before the retained window, so usage is partial. */
  partial: boolean;
};

/**
 * Decides an aggregate session's range membership from its retained dated rows
 * (design §5.6). Membership needs at least one in-range row, never a span
 * overlap. The truncation verdict is decided **before** any sum: when the entry
 * is truncated, the range does not reach the oldest retained row, and no row is
 * in range, the range lies entirely inside omitted history, so usage is
 * `null`/unknown rather than a fabricated zero. A truncated entry whose range
 * does reach before the oldest retained row is `partial: true`.
 */
export function historyRowRange(
  entry: {
    usageByDate?: readonly {
      date?: string;
      totalTokens?: number;
      cost?: number;
    }[];
    usageByDateTruncated?: boolean;
  },
  range: RangeState,
): HistoryRowRange {
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const truncated = entry.usageByDateTruncated === true;
  const rows = entry.usageByDate ?? [];
  const retained: { totalTokens: number; cost: number }[] = [];
  let oldest: string | undefined;
  for (const row of rows) {
    const date = row.date;
    if (date === undefined || !DATE.test(date)) continue;
    if (oldest === undefined || date < oldest) oldest = date;
    if (date < range.from || date > range.to) continue;
    retained.push({
      totalTokens: row.totalTokens ?? 0,
      cost: row.cost ?? 0,
    });
  }
  // The verdicts are fixed before any usage is summed, so an omitted range can
  // never be published as a zero.
  const reachesOmitted =
    truncated && (oldest === undefined || range.from < oldest);
  const entirelyOmitted =
    truncated &&
    retained.length === 0 &&
    (oldest === undefined || range.to < oldest);
  if (entirelyOmitted) {
    return { member: false, totalTokens: null, cost: null, partial: true };
  }
  let totalTokens = 0;
  let cost = 0;
  for (const row of retained) {
    totalTokens += row.totalTokens;
    cost += row.cost;
  }
  return {
    member: retained.length > 0,
    totalTokens,
    cost: Math.round(cost * 1_000_000_000_000) / 1_000_000_000_000,
    partial: reachesOmitted,
  };
}

/**
 * The one cost rule the two rendered surfaces share: the offline snapshot, and
 * the browser bundle (through the prelude's `web.format` adapter).
 *
 * `toFixed(2)` alone is not honest for this report. Native costs are persisted
 * at far more precision than cents, so a known non-zero cost such as
 * `0.004893924` rendered as `$0.00` — a published figure displayed as a
 * different one, and indistinguishable from a real zero. The ladder below keeps
 * zero and non-zero distinguishable at every scale:
 *
 * - `0` → `$0.00` (a genuine zero, the only value that may read as zero);
 * - one cent or more → the ordinary two decimals;
 * - below one cent but at least `0.0001` → four decimals, so `$0.0049`;
 * - below `0.0001` → the stated bound `< $0.0001`, never a rounded zero.
 *
 * A negative value is not something the report should publish; it is still
 * formatted with its sign rather than silently shown as a positive amount.
 */
export function formatCost(value: number): string {
  const magnitude = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (magnitude === 0) return "$0.00";
  if (magnitude >= 0.01) return `${sign}$${magnitude.toFixed(2)}`;
  if (magnitude >= 0.0001) return `${sign}$${magnitude.toFixed(4)}`;
  return `${sign}< $0.0001`;
}

/**
 * The one confidence-badge tone rule both surfaces share: known sources read
 * plain (`""`), an inferred value warns, and every other state is neutral.
 */
export function confidenceTone(confidence: string): "neutral" | "warn" | "" {
  if (
    confidence === "native" ||
    confidence === "live" ||
    confidence === "cooperative" ||
    confidence === "supported"
  ) {
    return "";
  }
  return confidence === "inferred" ? "warn" : "neutral";
}

const localParts = new Map<string, Intl.DateTimeFormat>();

/** A full ISO-8601 instant: date, time and an explicit zone (`Z` or `±HH:MM`). */
const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * A persisted ISO instant as `YYYY-MM-DD HH:MM:SS UTC±H` in the runtime's local
 * time zone (or `timeZone` when given): the snapshot formats where it is made,
 * the browser where it is viewed, and the offset says which. Only a full ISO
 * instant is converted — a date-only, zone-less or other value is returned
 * unchanged, never guessed — and the current time is never read.
 */
export function formatLocalTimestamp(iso: string, timeZone?: string): string {
  if (!ISO_INSTANT.test(iso)) return iso;
  const instant = Date.parse(iso);
  if (!Number.isFinite(instant)) return iso;
  const key = timeZone ?? "";
  let formatter = localParts.get(key);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "shortOffset",
      ...(timeZone === undefined ? {} : { timeZone }),
    });
    localParts.set(key, formatter);
  }
  const part: Record<string, string> = {};
  for (const { type, value } of formatter.formatToParts(instant)) {
    part[type] = value;
  }
  // `GMT`, `GMT+0` and `GMT+2` read as `UTC`, `UTC` and `UTC+2`: the range
  // panel speaks UTC, so the offset uses the same word.
  const offset = (part.timeZoneName ?? "")
    .replace(/^GMT(?:[+-]0)?$/, "UTC")
    .replace(/^GMT/, "UTC");
  return `${part.year}-${part.month}-${part.day} ${part.hour}:${part.minute}:${part.second} ${offset}`;
}

/** Past this many rows a row-per-event table (ledger, calls) starts collapsed. */
export const COLLAPSE_ROWS = 100;

/**
 * The column-folding rule both surfaces share: with two rows or more, the
 * indexes of columns whose every row's text is `unavailable`. A row whose cell
 * count differs from `headerCount` keeps every column.
 */
export function unavailableColumns(
  headerCount: number,
  rows: readonly (readonly string[])[],
  unavailable: string,
): number[] {
  if (rows.length < 2) return [];
  const indexes: number[] = [];
  for (let index = 0; index < headerCount; index += 1) {
    if (
      rows.every(
        (row) =>
          row.length === headerCount && row[index]?.trim() === unavailable,
      )
    ) {
      indexes.push(index);
    }
  }
  return indexes;
}

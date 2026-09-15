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

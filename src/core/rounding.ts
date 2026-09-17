/**
 * The one retained-precision cost rounding. Six layers used to carry a private
 * copy of this expression — the canonical fold, the report builder, the live
 * reducer, the subagent roll-up and both UI projections — so the accounting
 * semantic had six homes and could drift between them. It has one now.
 */
export function roundCost(value: number): number {
  return Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
}

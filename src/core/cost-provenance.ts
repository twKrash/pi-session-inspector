import type { Usage } from "./events.ts";
import { roundCost } from "./rounding.ts";

type Amounts = Pick<Usage, "totalTokens" | "cost" | "costProvenance">;

const hasAmount = (part: Amounts): boolean =>
  part.totalTokens > 0 || roundCost(part.cost) > 0;

/**
 * Provenance of `left + right`, read before the amounts are added. A part with
 * no amount (zero tokens and zero cost at retained precision) has nothing to
 * qualify, so beside a part that has an amount it adds no evidence, whatever
 * bit it carries. Two amount-free parts keep each other's explicit bits, so a
 * zero-only aggregate still states its own source and later drops out when a
 * part with an amount joins it. A part with an amount and no bit (written
 * before Pi 1.5.0, or an invalid bit) is `unmarked`. One kind stays itself
 * (unmarked stays unknown); any combination is `mixed`. Emptiness comes from
 * the amounts, so the rule holds across copies, serialization, and any
 * grouping or order of folds for costs normalized to retained precision. Raw
 * sub-precision cost leaves are outside this associativity guarantee because
 * their rounded aggregate can cross the precision boundary.
 */
export function combineCostProvenance(
  left: Amounts,
  right: Amounts,
): Usage["costProvenance"] {
  const parts = [left, right];
  const counted = parts.some(hasAmount) ? parts.filter(hasAmount) : parts;
  const seen = new Set<string>();
  for (const part of counted) {
    const provenance = part.costProvenance;
    if (
      provenance === "provider" ||
      provenance === "catalog-estimate" ||
      provenance === "mixed"
    ) {
      seen.add(provenance);
    } else if (hasAmount(part)) {
      seen.add("unmarked");
    }
  }
  if (seen.size > 1 || seen.has("mixed")) return "mixed";
  const [only] = seen;
  return only === "provider" || only === "catalog-estimate" ? only : undefined;
}

/** Folds `incoming` into `target`'s provenance. Call before adding the amounts. */
export function foldCostProvenance(target: Amounts, incoming: Amounts): void {
  const next = combineCostProvenance(target, incoming);
  if (next === undefined) delete target.costProvenance;
  else target.costProvenance = next;
}

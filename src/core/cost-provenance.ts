import type { Usage } from "./events.ts";
import { roundCost } from "./rounding.ts";

type Amounts = Pick<Usage, "totalTokens" | "cost" | "costProvenance">;

/**
 * Provenance of `left + right`, read before the amounts are added. A part with
 * no amount has nothing to qualify, so it adds no evidence; a nonzero part with
 * no provenance bit (written before Pi 1.5.0, or an invalid bit) is `unmarked`.
 * One kind stays itself (unmarked stays unknown); any combination is `mixed`.
 * Deriving emptiness from the amounts keeps the rule true across copies and
 * serialization without a marker field. Cost is rounded first, the same
 * retained precision every fold applies, so a sub-precision leaf is empty in
 * every grouping.
 */
export function combineCostProvenance(
  left: Amounts,
  right: Amounts,
): Usage["costProvenance"] {
  const seen = new Set<string>();
  for (const part of [left, right]) {
    if (part.costProvenance !== undefined) seen.add(part.costProvenance);
    else if (part.totalTokens > 0 || roundCost(part.cost) > 0) {
      seen.add("unmarked");
    }
  }
  if (seen.size > 1 || seen.has("mixed")) return "mixed";
  const [only] = seen;
  return only === "provider" || only === "catalog-estimate" ? only : undefined;
}

/** Folds `incoming` into `target`'s provenance. Call before adding the amounts. */
export function foldCostProvenance(
  target: Amounts & { costProvenance?: Usage["costProvenance"] },
  incoming: Amounts,
): void {
  const next = combineCostProvenance(target, incoming);
  if (next !== undefined) target.costProvenance = next;
}

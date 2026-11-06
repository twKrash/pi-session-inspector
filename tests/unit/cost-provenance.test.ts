import assert from "node:assert/strict";
import { test } from "node:test";

import {
  combineCostProvenance,
  foldCostProvenance,
} from "../../src/core/cost-provenance.ts";
import type { Usage } from "../../src/core/events.ts";
import { roundCost } from "../../src/core/rounding.ts";

const part = (
  totalTokens: number,
  cost: number,
  costProvenance?: Usage["costProvenance"],
): Usage => ({
  totalTokens,
  cost,
  ...(costProvenance === undefined ? {} : { costProvenance }),
});

const add = (left: Usage, right: Usage): Usage => {
  const costProvenance = combineCostProvenance(left, right);
  return part(
    left.totalTokens + right.totalTokens,
    roundCost(left.cost + right.cost),
    costProvenance,
  );
};

test("a zero-usage provider record adds no evidence to a nonzero catalog record, in either order", () => {
  const zero = part(0, 0, "provider");
  const nonzero = part(10, 0.1, "catalog-estimate");
  assert.equal(combineCostProvenance(zero, nonzero), "catalog-estimate");
  assert.equal(combineCostProvenance(nonzero, zero), "catalog-estimate");
});

test("zero-only records keep their own explicit provenance", () => {
  assert.equal(
    combineCostProvenance(part(0, 0, "provider"), part(0, 0)),
    "provider",
  );
  assert.equal(
    combineCostProvenance(
      part(0, 0, "provider"),
      part(0, 0, "catalog-estimate"),
    ),
    "mixed",
  );
  assert.equal(combineCostProvenance(part(0, 0), part(0, 0)), undefined);
});

const parts: readonly [string, Usage][] = [
  ["zero unmarked", part(0, 0)],
  ["zero provider", part(0, 0, "provider")],
  ["zero catalog", part(0, 0, "catalog-estimate")],
  ["zero mixed", part(0, 0, "mixed")],
  ["nonzero unmarked", part(5, 0.05)],
  ["nonzero provider", part(10, 0.1, "provider")],
  ["nonzero catalog", part(20, 0.2, "catalog-estimate")],
  ["nonzero mixed", part(30, 0.3, "mixed")],
  ["invalid provenance", part(40, 0.4, "invalid" as Usage["costProvenance"])],
];

test("aggregation is commutative and associative for every grouping, including zero-only intermediates", () => {
  for (const [an, a] of parts) {
    for (const [bn, b] of parts) {
      assert.equal(
        add(a, b).costProvenance,
        add(b, a).costProvenance,
        `${an} + ${bn}`,
      );
      for (const [cn, c] of parts) {
        assert.equal(
          add(add(a, b), c).costProvenance,
          add(a, add(b, c)).costProvenance,
          `(${an} + ${bn}) + ${cn}`,
        );
      }
    }
  }
});

test("zero-amount provenance stays neutral through grouped zero-only intermediates", () => {
  const provider = part(0, 0, "provider");
  const catalog = part(0, 0, "catalog-estimate");
  const nonzero = part(10, 0.1, "catalog-estimate");
  const forward = add(add(provider, catalog), nonzero);
  const grouped = add(provider, add(catalog, nonzero));
  assert.equal(forward.costProvenance, "catalog-estimate");
  assert.equal(grouped.costProvenance, "catalog-estimate");
});

test("numeric totals and unmarked costs retain their existing behavior", () => {
  assert.deepEqual(
    add(part(10, 0.1, "provider"), part(20, 0.2, "catalog-estimate")),
    part(30, 0.3, "mixed"),
  );
});

test("a fold into a zero-only target replaces its provenance, never leaves it stale", () => {
  const target = part(0, 0, "provider");
  foldCostProvenance(target, part(5, 0.05));
  assert.equal(target.costProvenance, undefined);
  const catalog = part(0, 0, "provider");
  foldCostProvenance(catalog, part(5, 0.05, "catalog-estimate"));
  assert.equal(catalog.costProvenance, "catalog-estimate");
});

test("unmarked historical and invalid usage still make a provider total mixed", () => {
  assert.equal(
    combineCostProvenance(part(5, 0.05), part(10, 0.1, "provider")),
    "mixed",
  );
  assert.equal(
    combineCostProvenance(
      part(40, 0.4, "invalid" as Usage["costProvenance"]),
      part(10, 0.1, "provider"),
    ),
    "mixed",
  );
  assert.equal(
    combineCostProvenance(
      part(0, 0, "invalid" as Usage["costProvenance"]),
      part(0, 0, "provider"),
    ),
    "provider",
  );
});

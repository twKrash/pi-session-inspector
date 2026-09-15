import assert from "node:assert/strict";
import { test } from "node:test";

import { formatCost } from "../../src/ui/format.ts";

/**
 * One cost rule for every surface. The bug this pins is that a known non-zero
 * cost used to render through `toFixed(2)` and become `$0.00` — a published
 * figure rendered as a different (and impossible) one. Zero and small non-zero
 * must stay distinguishable, and a value below the smallest shown precision is
 * stated as a bound rather than rounded into a fabricated zero.
 */
test("a known non-zero cost never renders as a zero", () => {
  assert.equal(formatCost(0.0049), "$0.0049");
  assert.equal(formatCost(0.004893924), "$0.0049");
  assert.equal(formatCost(0.005), "$0.0050");
  assert.equal(formatCost(0.0001), "$0.0001");
  assert.equal(formatCost(0.00004), "< $0.0001");
  assert.equal(formatCost(0.000009), "< $0.0001");
});

test("a genuine zero cost still renders as zero", () => {
  assert.equal(formatCost(0), "$0.00");
  assert.equal(formatCost(-0), "$0.00");
});

test("a cost at or above one cent keeps the ordinary two decimals", () => {
  assert.equal(formatCost(0.01), "$0.01");
  assert.equal(formatCost(0.5), "$0.50");
  assert.equal(formatCost(12.5), "$12.50");
  assert.equal(formatCost(1234.567), "$1234.57");
});

test("a sign the report should never publish still formats honestly", () => {
  assert.equal(formatCost(-0.0049), "-$0.0049");
  assert.equal(formatCost(-1.5), "-$1.50");
});

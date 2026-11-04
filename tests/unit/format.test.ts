import assert from "node:assert/strict";
import { test } from "node:test";

import {
  COLLAPSE_ROWS,
  confidenceTone,
  formatCost,
  formatLocalTimestamp,
  unavailableColumns,
} from "../../src/ui/format.ts";

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
  assert.equal(formatCost(-0.00004), "-< $0.0001");
});

test("a timestamp renders in the given local zone with its offset, not as raw ISO", () => {
  assert.equal(
    formatLocalTimestamp("2026-10-30T20:03:35.831Z", "UTC"),
    "2026-10-30 20:03:35 UTC",
  );
  assert.equal(
    formatLocalTimestamp("2026-10-30T23:30:00.000Z", "Europe/Kyiv"),
    "2026-10-31 01:30:00 UTC+2",
  );
  // An explicit offset is an instant too.
  assert.equal(
    formatLocalTimestamp("2026-10-30T23:30:00+02:00", "UTC"),
    "2026-10-30 21:30:00 UTC",
  );
  // Midnight is 00, never 24.
  assert.equal(
    formatLocalTimestamp("2026-01-01T00:00:00.000Z", "UTC"),
    "2026-01-01 00:00:00 UTC",
  );
});

test("only a full ISO instant is converted; anything else is shown as persisted", () => {
  // Date.parse accepts each of these and would invent an instant.
  for (const value of [
    "not-a-time",
    "12",
    "1",
    "2026-03-10",
    "2026-03-10T10:00:00",
    "March 10, 2026",
  ]) {
    assert.equal(formatLocalTimestamp(value, "UTC"), value);
  }
});

test("a column folds only when every one of two or more rows is Unavailable", () => {
  const U = "Unavailable";
  assert.deepEqual(
    unavailableColumns(
      3,
      [
        ["a", U, U],
        ["b", U, " Unavailable "],
      ],
      U,
    ),
    [1, 2],
  );
  assert.deepEqual(unavailableColumns(2, [["a", U]], U), []);
  assert.deepEqual(
    unavailableColumns(
      2,
      [
        ["a", U],
        ["b", "1"],
      ],
      U,
    ),
    [],
  );
  // A row with a different cell count keeps every column.
  assert.deepEqual(unavailableColumns(2, [["a", U], [U]], U), []);
  // The first column folds like any other.
  assert.deepEqual(
    unavailableColumns(
      2,
      [
        [U, "a"],
        [U, "b"],
      ],
      U,
    ),
    [0],
  );
  assert.equal(COLLAPSE_ROWS, 100);
});

test("known sources read plain, inferred warns, the rest are neutral", () => {
  assert.equal(confidenceTone("native"), "");
  assert.equal(confidenceTone("live"), "");
  assert.equal(confidenceTone("inferred"), "warn");
  assert.equal(confidenceTone("unavailable"), "neutral");
});

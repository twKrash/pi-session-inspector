import assert from "node:assert/strict";
import { test } from "node:test";
import {
  filterView,
  historyRowRange,
  isInRange,
  latestObservedDate,
  parseRangeQuery,
  presetRange,
  resolveRange,
  serializeRangeQuery,
  shiftUtcDay,
  type RangeState,
} from "../../src/ui/range.ts";

const dates = ["2026-09-01", "2026-09-11", "2026-09-12"];

test("presets are anchored on the latest observed date, inclusively", () => {
  assert.deepEqual(presetRange(7, dates), {
    preset: 7,
    from: "2026-09-06",
    to: "2026-09-12",
  });
  assert.deepEqual(presetRange(14, dates), {
    preset: 14,
    from: "2026-08-30",
    to: "2026-09-12",
  });
  assert.deepEqual(presetRange(30, dates), {
    preset: 30,
    from: "2026-08-14",
    to: "2026-09-12",
  });
  assert.equal(presetRange(7, []), undefined);
});

test("boundaries are inclusive and defaults are span/14D", () => {
  assert.equal(
    isInRange("2026-09-12", {
      preset: null,
      from: "2026-09-12",
      to: "2026-09-12",
    }),
    true,
  );
  assert.equal(
    isInRange("2026-09-11", {
      preset: null,
      from: "2026-09-12",
      to: "2026-09-12",
    }),
    false,
  );
  assert.deepEqual(resolveRange(undefined, dates, "current"), {
    preset: null,
    from: "2026-09-01",
    to: "2026-09-12",
  });
  assert.deepEqual(resolveRange(undefined, dates, "aggregate"), {
    preset: 14,
    from: "2026-08-30",
    to: "2026-09-12",
  });
  assert.equal(resolveRange(undefined, [], "current"), undefined);
  assert.equal(resolveRange(undefined, [], "aggregate"), undefined);
});

test("a preset stays an unresolved intent until it meets a view's dates", () => {
  assert.deepEqual(parseRangeQuery("preset=7"), { kind: "preset", preset: 7 });
  assert.deepEqual(parseRangeQuery("preset=30&from=2026-09-01&to=2026-09-12"), {
    kind: "preset",
    preset: 30,
  });
  assert.deepEqual(
    [parseRangeQuery("preset=99"), parseRangeQuery("preset=")],
    [undefined, undefined],
  );
  assert.deepEqual(serializeRangeQuery({ kind: "preset", preset: 7 }), [
    ["preset", "7"],
  ]);
  assert.equal(
    resolveRange({ kind: "preset", preset: 7 }, [], "current"),
    undefined,
  );
});

test("a custom range survives only as a valid pair", () => {
  assert.deepEqual(parseRangeQuery("from=2026-09-01&to=2026-09-12"), {
    kind: "custom",
    from: "2026-09-01",
    to: "2026-09-12",
  });
  for (const query of [
    "",
    "from=2026-09-01",
    "to=2026-09-12",
    "from=2026-09-12&to=2026-09-01",
    "from=x&to=y",
    "preset=99",
  ]) {
    assert.equal(parseRangeQuery(query), undefined, query);
  }
  assert.deepEqual(
    serializeRangeQuery({
      kind: "custom",
      from: "2026-09-01",
      to: "2026-09-12",
    }),
    [
      ["from", "2026-09-01"],
      ["to", "2026-09-12"],
    ],
  );
});

test("a validated custom pair is restored even with no observed dates", () => {
  const custom = {
    kind: "custom",
    from: "2026-09-01",
    to: "2026-09-12",
  } as const;
  assert.deepEqual(resolveRange(custom, [], "current"), {
    preset: null,
    from: "2026-09-01",
    to: "2026-09-12",
  });
  assert.deepEqual(resolveRange(custom, [], "aggregate"), {
    preset: null,
    from: "2026-09-01",
    to: "2026-09-12",
  });
  assert.equal(
    resolveRange(
      { kind: "custom", from: "2026-09-12", to: "2026-09-01" },
      [],
      "current",
    ),
    undefined,
  );
  assert.equal(resolveRange(undefined, [], "current"), undefined);
  assert.equal(
    resolveRange({ kind: "preset", preset: 7 }, [], "current"),
    undefined,
  );
});

test("no helper can produce the 1970 sentinel", () => {
  const pairs = [
    ...serializeRangeQuery({
      kind: "custom",
      from: "2026-09-01",
      to: "2026-09-12",
    }),
    ...serializeRangeQuery({ kind: "preset", preset: 14 }),
  ];
  assert.equal(
    pairs.some(([, value]) => value.startsWith("1970")),
    false,
  );
});

test("day shifting is UTC-stable and bad dates are ignored", () => {
  assert.equal(shiftUtcDay("2026-03-01", -1), "2026-02-28");
  assert.equal(shiftUtcDay("2026-01-01", -1), "2025-12-31");
  assert.equal(
    latestObservedDate(["bogus", "2026-09-12", "2026-09-01"]),
    "2026-09-12",
  );
});

test("one filter decides every tab's rows", () => {
  const view = {
    rows: [{ date: "2026-09-01" }, { date: "2026-09-12" }],
    models: [{ date: "2026-09-01" }, { date: "2026-09-12" }],
    tools: [{ date: "2026-09-01" }, { date: "2026-09-12" }],
    agents: [
      { observedAt: "2026-09-01T23:00:00.000Z" },
      { observedAt: undefined },
    ],
    errors: [{ timestamp: "2026-09-12T00:01:00.000Z" }],
  };
  const seven = filterView(view, presetRange(7, dates) as RangeState);
  assert.deepEqual(
    [
      seven.rows.length,
      seven.models.length,
      seven.tools.length,
      seven.agents.length,
      seven.errors.length,
    ],
    [1, 1, 1, 0, 1],
  );
});

test("aggregate membership needs an in-range record, truncation decides first", () => {
  const usageRow = (date: string, totalTokens: number) => ({
    date,
    totalTokens,
    cost: totalTokens / 100,
  });
  const range = { preset: null, from: "2026-09-01", to: "2026-09-12" };
  assert.deepEqual(
    historyRowRange(
      { usageByDate: [usageRow("2026-01-01", 10), usageRow("2026-09-12", 20)] },
      range,
    ),
    { member: true, totalTokens: 20, cost: 0.2, partial: false },
  );
  assert.deepEqual(
    historyRowRange({ usageByDate: [usageRow("2026-01-01", 10)] }, range),
    { member: false, totalTokens: 0, cost: 0, partial: false },
  );
  const retained = {
    usageByDate: [usageRow("2029-06-21", 5)],
    usageByDateTruncated: true,
  };
  assert.deepEqual(
    historyRowRange(retained, {
      preset: null,
      from: "2029-06-21",
      to: "2029-06-21",
    }),
    { member: true, totalTokens: 5, cost: 0.05, partial: false },
  );
  assert.deepEqual(
    historyRowRange(retained, {
      preset: null,
      from: "2020-01-01",
      to: "2029-06-21",
    }),
    { member: true, totalTokens: 5, cost: 0.05, partial: true },
  );
  assert.deepEqual(
    historyRowRange(retained, {
      preset: null,
      from: "2020-01-01",
      to: "2020-12-31",
    }),
    { member: false, totalTokens: null, cost: null, partial: true },
  );
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import * as fc from "fast-check";

import { parseSessionJsonl } from "../../src/pi/adapter.ts";
import {
  buildCanonicalSession,
  type CanonicalSessionBuildResult,
} from "../../src/core/canonical.ts";
import { type DailyContribution, buildDailyRows } from "../../src/ui/daily.ts";
import { shiftUtcDay, type RangeIntent } from "../../src/ui/range.ts";
import {
  assertGeneratedRangeProjection,
  assertRangeRoundTrip,
  assertRepeatedReductionStable,
  runProperty,
} from "./assertions.ts";

const row = (
  date: string,
  totalTokens: number,
  cost: number,
): DailyContribution["rows"][number] => ({
  date,
  totalTokens,
  cost,
  generations: 1,
  tools: 0,
  errors: 0,
  composition: {
    generations: { totalTokens, cost },
    toolResults: { totalTokens: 0, cost: 0 },
    compactions: { totalTokens: 0, cost: 0 },
    branchSummaries: { totalTokens: 0, cost: 0 },
  },
});

const BASE_CONTRIBUTIONS: readonly DailyContribution[] = [
  {
    sessionId: "session-a",
    rows: [row("2026-02-01", 10, 0.01)],
    truncated: false,
  },
  {
    sessionId: "session-b",
    rows: [row("2026-02-02", 20, 0.02)],
    truncated: true,
  },
  {
    sessionId: "session-c",
    rows: [row("2026-02-01", 30, 0.03)],
    truncated: false,
  },
];

const permutationArb: fc.Arbitrary<readonly number[]> = fc.uniqueArray(
  fc.integer({ min: 0, max: BASE_CONTRIBUTIONS.length - 1 }),
  {
    minLength: BASE_CONTRIBUTIONS.length,
    maxLength: BASE_CONTRIBUTIONS.length,
  },
);

function projectOrderInsensitiveFixture(
  order: readonly number[],
): ReturnType<typeof buildDailyRows> {
  return buildDailyRows(
    order.map((index) => {
      const contribution = BASE_CONTRIBUTIONS[index];
      assert.ok(contribution);
      return contribution;
    }),
  );
}

function shiftedDay(base: string, offset: number): string {
  const date = shiftUtcDay(base, offset);
  assert.ok(date);
  return date;
}

const validIntentArb: fc.Arbitrary<RangeIntent> = fc.oneof(
  fc
    .constantFrom(7, 14, 30)
    .map((preset) => ({ kind: "preset", preset }) as const),
  fc
    .tuple(fc.integer({ min: 0, max: 30 }), fc.integer({ min: 0, max: 30 }))
    .map(([left, right]) => {
      const from = Math.min(left, right);
      const to = Math.max(left, right);
      return {
        kind: "custom",
        from: shiftedDay("2026-03-01", from),
        to: shiftedDay("2026-03-01", to),
      } as const;
    }),
);

const validRangeArb: fc.Arbitrary<RangeIntent> = fc
  .tuple(fc.integer({ min: 0, max: 30 }), fc.integer({ min: 0, max: 30 }))
  .map(([left, right]) => {
    const from = Math.min(left, right);
    const to = Math.max(left, right);
    return {
      kind: "custom",
      from: shiftedDay("2026-02-01", from),
      to: shiftedDay("2026-02-01", to),
    } as const;
  });

const SANITIZED_SOURCE = readFileSync(
  new URL("../fixtures/pi/0.85.1/mixed-usage.jsonl", import.meta.url),
  "utf8",
);

function reduceSafeFixtureWithUnknown(
  kind:
    | "unknown-a"
    | "unknown-b"
    | "malformed-a"
    | "missing-id"
    | "invalid-timestamp",
): CanonicalSessionBuildResult {
  const suffix =
    kind === "malformed-a"
      ? "{malformed-json"
      : kind === "missing-id"
        ? JSON.stringify({
            parentId: null,
            timestamp: "2026-02-02T00:00:00.000Z",
            type: "message",
          })
        : JSON.stringify({
            id: `fixed-${kind}`,
            parentId: null,
            timestamp:
              kind === "invalid-timestamp"
                ? "not-a-timestamp"
                : "2026-02-02T00:00:00.000Z",
            type: kind === "invalid-timestamp" ? "message" : kind,
          });
  const parsed = parseSessionJsonl(`${SANITIZED_SOURCE}\n${suffix}\n`);
  return buildCanonicalSession({
    parsed,
    scope: "tree",
    leafId: null,
    evidence: { atomic: [], folded: [] },
  });
}

const repeatedSource = SANITIZED_SOURCE;

test("property: order-insensitive projections", () => {
  runProperty(
    "order-insensitive-projections",
    fc.property(permutationArb, (order) => {
      const original = projectOrderInsensitiveFixture([0, 1, 2]);
      const permuted = projectOrderInsensitiveFixture(order);
      assert.deepEqual(permuted, original);
    }),
    850501,
  );
});

test("property: malformed entities degrade without crashing", () => {
  runProperty(
    "malformed-entities",
    fc.property(
      fc.constantFrom(
        "unknown-a",
        "unknown-b",
        "malformed-a",
        "missing-id",
        "invalid-timestamp",
      ),
      (kind) => {
        const result = reduceSafeFixtureWithUnknown(kind);
        assert.ok(
          result.state === "ready" ||
            result.state === "unavailable" ||
            result.state === "unsupported",
        );
      },
    ),
    850502,
  );
});

test("property: range routes canonicalize", () => {
  runProperty(
    "range-routes",
    fc.property(validIntentArb, (intent) => assertRangeRoundTrip(intent)),
    850503,
  );
});

test("property: range projections stay bounded", () => {
  runProperty(
    "bounded-range-projections",
    fc.property(validRangeArb, (intent) =>
      assertGeneratedRangeProjection(intent),
    ),
    850504,
  );
});

test("property: repeated reduction is stable", () => {
  runProperty(
    "repeated-reduction",
    fc.property(fc.integer({ min: 2, max: 3 }), (repeats) => {
      assertRepeatedReductionStable(repeatedSource, repeats);
    }),
    850505,
  );
});

test("property diagnostics redact counterexamples", () => {
  assert.throws(
    () =>
      runProperty(
        "redacted-property",
        fc.property(fc.constant("RAW_PRODUCER_COUNTEREXAMPLE"), (value) =>
          assert.equal(value, "not-the-generated-value"),
        ),
        850506,
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(
        error.message,
        /^\[redacted-property\] seed=-?\d+ path=.* runs=\d+$/,
      );
      assert.equal(
        error.message.includes("RAW_PRODUCER_COUNTEREXAMPLE"),
        false,
      );
      assert.equal(error.message.includes("counterexample"), false);
      return true;
    },
  );
});

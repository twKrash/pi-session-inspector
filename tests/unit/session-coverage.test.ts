import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COVERAGE_REASON_CODES,
  buildSessionCoverage,
} from "../../src/core/session-coverage.ts";

const available = { availability: "available" as const };

test("partial sets are not complete and expose a session ratio", () => {
  assert.deepEqual(
    buildSessionCoverage({
      availability: "available",
      discoveryLimited: false,
      sessions: [
        available,
        { availability: "unavailable", reason: "manifest-unavailable" },
      ],
    }),
    {
      inspected: 2,
      available: 1,
      unavailable: 1,
      sessionRatio: 0.5,
      complete: false,
      discoveryLimited: false,
      reasons: { "manifest-unavailable": 1 },
    },
  );
});

test("a capped discovery hides the ratio and is never complete", () => {
  const coverage = buildSessionCoverage({
    availability: "available",
    discoveryLimited: true,
    sessions: [available],
  });
  assert.deepEqual(
    [coverage?.sessionRatio, coverage?.complete, coverage?.discoveryLimited],
    [null, false, true],
  );
});

test("an empty inspection set is not complete and has no ratio", () => {
  const coverage = buildSessionCoverage({
    availability: "available",
    discoveryLimited: false,
    sessions: [],
  });
  assert.deepEqual(
    [
      coverage?.inspected,
      coverage?.sessionRatio,
      coverage?.complete,
      JSON.stringify(coverage?.reasons),
    ],
    [0, null, false, "{}"],
  );
});

test("an unavailable aggregate has no coverage at all", () => {
  assert.equal(
    buildSessionCoverage({
      availability: "unavailable",
      discoveryLimited: false,
      sessions: [],
    }),
    undefined,
  );
});

test("a fully replayed uncapped set is complete", () => {
  const coverage = buildSessionCoverage({
    availability: "available",
    discoveryLimited: false,
    sessions: [available, available],
  });
  assert.deepEqual([coverage?.complete, coverage?.sessionRatio], [true, 1]);
});

// Totality is enforced by the type of COVERAGE_REASON_CODES (a missing reason or an
// unknown code fails `npm run typecheck`); this only pins the declared key set.
test("every reason has a bounded-code mapping", () => {
  assert.deepEqual(Object.keys(COVERAGE_REASON_CODES).sort(), [
    "manifest-unavailable",
    "marker-unavailable",
    "no-manifest",
    "replay-failed",
    "session-unreadable",
  ]);
  for (const codes of Object.values(COVERAGE_REASON_CODES)) {
    assert.ok(codes.length > 0);
  }
});

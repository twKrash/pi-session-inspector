import assert from "node:assert/strict";
import { test } from "node:test";

import { toolSummary } from "../../src/ui/report-projection.ts";
import { toolUsageVerdict } from "../../src/ui/ui-projection.ts";

/**
 * Grouped Tools figures from the production UAT: every call carries a persisted
 * status and timestamp, some carry native usage, and some correlate to a live
 * duration — never all of them. The summary must publish what it has and say
 * how much that is, instead of a total that reads as complete.
 */

function call(
  name: string,
  overrides: {
    timestamp?: string;
    usage?: { totalTokens: number; cost: number } | null;
    durationMs?: number | null;
  } = {},
) {
  const { timestamp = "2026-09-15T10:00:00.000Z", usage = null } = overrides;
  return {
    name,
    status: "succeeded" as const,
    timestamp,
    usage,
    ...(overrides.durationMs === undefined
      ? {}
      : { durationMs: overrides.durationMs }),
  };
}

test("usage coverage distinguishes complete, partial, and absent usage", () => {
  const complete = toolSummary({
    tools: [
      call("read", { usage: { totalTokens: 10, cost: 0.1 } }),
      call("read", { usage: { totalTokens: 5, cost: 0.05 } }),
    ],
  })[0];
  assert.equal(complete?.withUsage, 2);
  assert.equal(complete?.tokens, 15);

  // The UAT shape: three subagent calls, one carrying native usage.
  const partial = toolSummary({
    tools: [
      call("subagent", { usage: { totalTokens: 34477, cost: 0.004893924 } }),
      call("subagent"),
      call("subagent"),
    ],
  })[0];
  assert.equal(partial?.calls, 3);
  assert.equal(partial?.withUsage, 1);
  assert.equal(partial?.tokens, 34477);
  assert.equal(partial?.cost, 0.004893924);

  const none = toolSummary({ tools: [call("bash"), call("bash")] })[0];
  assert.equal(none?.withUsage, 0);
  assert.equal(none?.tokens, 0);
  assert.equal(none?.cost, 0);
});

test("duration coverage distinguishes complete, partial, and absent durations", () => {
  const complete = toolSummary({
    tools: [
      call("bash", { durationMs: 1000 }),
      call("bash", { durationMs: 3000 }),
    ],
  })[0];
  assert.equal(complete?.withDuration, 2);
  assert.equal(complete?.durationMs, 4000);
  assert.equal(complete?.durationLabel, "4.0 s");
  assert.equal(complete?.averageLabel, "2.0 s");

  const partial = toolSummary({
    tools: [
      call("subagent", { durationMs: 1200 }),
      call("subagent"),
      call("subagent"),
    ],
  })[0];
  assert.equal(partial?.calls, 3);
  assert.equal(partial?.withDuration, 1);
  assert.equal(partial?.durationMs, 1200);
  assert.equal(partial?.durationLabel, "1.2 s");
  assert.equal(partial?.averageLabel, "1.2 s");

  const none = toolSummary({ tools: [call("bash"), call("bash")] })[0];
  assert.equal(none?.withDuration, 0);
  assert.equal(none?.durationMs, 0);
  // No correlated call is Unavailable, never `0 ms`.
  assert.equal(none?.durationLabel, null);
  assert.equal(none?.averageLabel, null);
});

test("the rendered coverage verdict names the incomplete figure", () => {
  const complete = toolUsageVerdict(
    toolSummary({
      tools: [
        call("bash", {
          usage: { totalTokens: 1, cost: 0.01 },
          durationMs: 10,
        }),
      ],
    })[0] as never,
  );
  assert.equal(complete.partial, false);
  assert.equal(complete.durationPartial, false);

  const partial = toolUsageVerdict(
    toolSummary({
      tools: [
        call("subagent", {
          usage: { totalTokens: 34477, cost: 0.004893924 },
          durationMs: 10,
        }),
        call("subagent"),
        call("subagent"),
      ],
    })[0] as never,
  );
  assert.equal(partial.partial, true);
  assert.equal(partial.durationPartial, true);
  assert.equal(partial.calls, 3);
  assert.equal(partial.withUsage, 1);
  assert.equal(partial.withDuration, 1);

  const none = toolUsageVerdict(toolSummary({ tools: [call("bash")] })[0] as never);
  assert.equal(none.partial, false);
  assert.equal(none.durationPartial, false);
});

test("a null duration is not a correlated one", () => {
  const row = toolSummary({
    tools: [
      call("bash", { durationMs: null }),
      call("bash", { durationMs: 500 }),
    ],
  })[0];
  assert.equal(row?.calls, 2);
  assert.equal(row?.withDuration, 1);
  assert.equal(row?.durationMs, 500);
});

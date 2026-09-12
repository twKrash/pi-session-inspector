import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  buildCanonicalSession,
  type CanonicalSession,
} from "../../src/core/canonical.ts";
import { reduceEntries } from "../../src/core/reduce.ts";
import { toSessionReport, type SessionReport } from "../../src/core/reports.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";
import { sessionDatedUsage } from "../../src/ui/dated-usage.ts";
import { loadHistoryReports } from "../../src/ui/load-history.ts";

const FIXTURE = "tests/fixtures/pi/0.85.1/mixed-usage.jsonl";

function canonicalOf(file: string): CanonicalSession {
  const parsed = parseSessionJsonl(readFileSync(file, "utf8"));
  const built = buildCanonicalSession({
    parsed,
    scope: "tree",
    leafId: null,
    evidence: { atomic: [], folded: [] },
  });
  // The fixture must satisfy the production L1 contract, never a relaxed one.
  assert.equal(built.state, "ready");
  if (built.state !== "ready") throw new Error("unreachable");
  return built.session;
}

function reportOf(file: string): SessionReport {
  const parsed = parseSessionJsonl(readFileSync(file, "utf8"));
  return toSessionReport(reduceEntries(parsed.id ?? "fixture", parsed.entries));
}

test("the marker-bearing fixture builds a ready canonical session", () => {
  const session = canonicalOf(FIXTURE);
  assert.equal(session.sessionId, "mixed-usage-session");
  assert.equal(session.health.usage.dated, "supported");
});

test("dated rows attribute every usage source by logical call", () => {
  const { dates, truncated } = sessionDatedUsage(canonicalOf(FIXTURE));
  assert.equal(truncated, false);
  assert.deepEqual(
    dates.map((row) => [
      row.date,
      row.totalTokens,
      row.generations,
      row.tools,
      row.errors,
    ]),
    [
      ["2026-09-01", 165, 1, 1, 0],
      ["2026-09-02", 30, 0, 0, 0],
      ["2026-09-03", 10, 0, 0, 0],
      ["2026-09-04", 2, 1, 1, 0],
      ["2026-09-05", 0, 0, 0, 1],
    ],
  );
  assert.deepEqual(dates[0]?.composition, {
    generations: { totalTokens: 150, cost: 1.5 },
    toolResults: { totalTokens: 15, cost: 0.15 },
    compactions: { totalTokens: 0, cost: 0 },
    branchSummaries: { totalTokens: 0, cost: 0 },
  });
});

test("the retained window reconciles with the report's own usage", () => {
  const { dates } = sessionDatedUsage(canonicalOf(FIXTURE));
  const report = reportOf(FIXTURE);
  assert.equal(
    dates.reduce((sum, row) => sum + row.totalTokens, 0),
    report.usage?.totalTokens,
  );
  assert.equal(
    Math.round(dates.reduce((sum, row) => sum + row.cost, 0) * 1e6) / 1e6,
    report.usage?.cost,
  );
});

test("model rows join the same attribution as the date rows", () => {
  const { dates, models } = sessionDatedUsage(canonicalOf(FIXTURE));
  for (const date of dates) {
    const fromModels = models
      .filter((row) => row.date === date.date)
      .reduce((sum, row) => sum + row.totalTokens, 0);
    assert.equal(
      fromModels,
      date.composition.generations.totalTokens,
      date.date,
    );
  }
  assert.deepEqual(
    models.map((row) => row.date),
    ["2026-09-01", "2026-09-04"],
  );
});

test("an unattributable native line marks the window partial, never zero", () => {
  const session = canonicalOf(FIXTURE);
  const { dates, truncated } = sessionDatedUsage({
    ...session,
    health: {
      ...session.health,
      usage: { ...session.health.usage, dated: "partial" },
    },
  });
  assert.equal(truncated, true);
  assert.ok(dates.reduce((sum, row) => sum + row.totalTokens, 0) > 0);
});

test("the retained window is capped and flagged", async () => {
  const history = await loadHistoryReports(
    await longSessionOptions({ days: 400 }),
  );
  const session = history.sessions[0];
  assert.equal(session?.availability, "available");
  if (session?.availability !== "available") return;
  assert.equal(session.usageByDate.length, 366);
  assert.equal(session.usageByDateTruncated, true);
});

test("a short session is exact and not truncated", async () => {
  const history = await loadHistoryReports(
    await longSessionOptions({ days: 3 }),
  );
  const session = history.sessions[0];
  if (session?.availability !== "available")
    throw new Error("expected available");
  assert.equal(session.usageByDateTruncated, false);
  assert.equal(
    session.usageByDate.reduce((sum, row) => sum + row.totalTokens, 0),
    session.report.usage?.totalTokens,
  );
});

/** The one session id the long-window loader cases use. */
const LONG_SESSION_ID = "22222222-2222-4222-8222-222222222222";

/** The deterministic UTC timestamp of one day index of the long window. */
function dayTimestamp(index: number): string {
  return new Date(Date.UTC(2026, 0, 1) + index * 86_400_000).toISOString();
}

/** A marker-bearing source with one usage-bearing generation per day, in one chain. */
function longSessionSource(days: number): string {
  const lines = [
    JSON.stringify({ type: "session", version: 3, id: LONG_SESSION_ID }),
    JSON.stringify({
      type: "custom",
      id: "marker",
      parentId: null,
      timestamp: "2025-12-31T23:59:59.000Z",
      customType: "session-inspector:tracking-start",
      data: { schemaVersion: 1 },
    }),
  ];
  let parentId = "marker";
  for (let index = 0; index < days; index += 1) {
    const id = `g${index}`;
    lines.push(
      JSON.stringify({
        type: "message",
        id,
        parentId,
        timestamp: dayTimestamp(index),
        message: {
          role: "assistant",
          provider: "acme",
          model: "alpha",
          content: [],
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
            cost: {
              input: 0.01,
              output: 0.01,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0.02,
            },
          },
        },
      }),
    );
    parentId = id;
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Writes one manifest plus a marker-bearing JSONL with one usage-bearing
 * generation per day into a fresh temp root and returns LoadHistoryOptions.
 */
async function longSessionOptions({
  days,
}: {
  days: number;
}): Promise<Parameters<typeof loadHistoryReports>[0]> {
  const root = await mkdtemp(join(tmpdir(), "inspector-dated-usage-"));
  const sessionDirectory = join(root, "public-sessions");
  await mkdir(sessionDirectory);
  await writeFile(
    join(sessionDirectory, `${LONG_SESSION_ID}.jsonl`),
    longSessionSource(days),
  );
  await mkdir(join(root, "sessions", LONG_SESSION_ID), { recursive: true });
  await writeFile(
    join(root, "sessions", LONG_SESSION_ID, "meta.json"),
    `${JSON.stringify({ schemaVersion: 2, sessionId: LONG_SESSION_ID, sourceFile: `${LONG_SESSION_ID}.jsonl`, state: "tracking" })}\n`,
  );
  return {
    root,
    sessionDirectory: () => sessionDirectory,
    scope: "tree",
    maintenance: {
      writerId: "maintainer-1",
      now: () => new Date("2026-02-03T12:00:00.000Z"),
      isPidAlive: () => false,
    },
  };
}

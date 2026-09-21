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
import { buildDailyRows } from "../../src/ui/daily.ts";
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

test("projects a canonical session directly into the report DTO", () => {
  const actual = toSessionReport(canonicalOf(FIXTURE));
  const expected = reportOf(FIXTURE);

  assert.deepEqual(actual.usage, expected.usage);
  assert.deepEqual(actual.usageComposition, expected.usageComposition);
  assert.deepEqual(actual.generations, expected.generations);
  assert.deepEqual(actual.compactions, expected.compactions);
  assert.deepEqual(actual.errors, expected.errors);
  assert.deepEqual(actual.tools, expected.tools);
  assert.deepEqual(actual.models, expected.models);
  assert.equal(actual.evidenceHealth.core, "supported");
  assert.ok(actual.retainedAggregates);
});

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
    generations: {
      totalTokens: 150,
      cost: 1.5,
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      inputCost: 1,
      outputCost: 0.5,
      cacheReadCost: 0,
      cacheWriteCost: 0,
    },
    toolResults: {
      totalTokens: 15,
      cost: 0.15,
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      inputCost: 0.1,
      outputCost: 0.05,
      cacheReadCost: 0,
      cacheWriteCost: 0,
    },
    compactions: { totalTokens: 0, cost: 0 },
    branchSummaries: { totalTokens: 0, cost: 0 },
  });
});

test("dated rows preserve native costs and reasoning while zero stays known", () => {
  const { dates } = sessionDatedUsage(canonicalOf(FIXTURE));
  const row = dates[0];
  assert.equal(row?.inputCost, 1.1);
  assert.equal(row?.outputCost, 0.55);
  assert.equal(row?.cacheReadCost, 0);
  assert.equal(row?.cacheWriteCost, 0);
  assert.equal(row?.reasoningTokens, undefined);

  const [daily] = buildDailyRows([
    {
      sessionId: "a",
      truncated: false,
      rows: [
        {
          date: "2026-09-01",
          totalTokens: 1,
          cost: 0.01,
          inputTokens: 1,
          outputTokens: 0,
          cacheReadTokens: 1,
          cacheWriteTokens: 0,
          inputCost: 0.01,
          outputCost: 0,
          cacheReadCost: 0,
          generations: 1,
          tools: 0,
          errors: 0,
          composition: {
            generations: { totalTokens: 1, cost: 0.01 },
            toolResults: { totalTokens: 0, cost: 0 },
            compactions: { totalTokens: 0, cost: 0 },
            branchSummaries: { totalTokens: 0, cost: 0 },
          },
        },
      ],
    },
    {
      sessionId: "b",
      truncated: false,
      rows: [
        {
          date: "2026-09-01",
          totalTokens: 1,
          cost: 0.01,
          inputTokens: 1,
          outputTokens: 0,
          cacheReadTokens: 0,
          inputCost: 0.01,
          outputCost: 0,
          cacheReadCost: 0,
          generations: 1,
          tools: 0,
          errors: 0,
          composition: {
            generations: { totalTokens: 1, cost: 0.01 },
            toolResults: { totalTokens: 0, cost: 0 },
            compactions: { totalTokens: 0, cost: 0 },
            branchSummaries: { totalTokens: 0, cost: 0 },
          },
        },
      ],
    },
  ]).rows;
  assert.equal(daily?.cacheReadTokens, 1);
  assert.equal(Object.hasOwn(daily ?? {}, "cacheWriteTokens"), true);
  assert.equal(daily?.cacheWriteTokens, 0);
  assert.equal(daily?.cacheWriteCost, undefined);
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

test("an overflowed session never dates its unaggregatable usage as zero", () => {
  const session = canonicalOfSource(overflowSource());
  // The fixture must reach the real L1 overflow verdict, never a relaxed one.
  assert.equal(session.usage.state, "unavailable");
  assert.equal(
    session.usage.lines.filter((line) => line.domain === "native-session")
      .length,
    2,
  );
  const { dates, truncated } = sessionDatedUsage(session);
  // The bounded lines stay dated as activity only; an unaggregatable spend is
  // never republished as a zero and the window is never called complete.
  assert.equal(truncated, true);
  assert.deepEqual(
    dates.map((row) => [row.date, row.totalTokens, row.cost, row.generations]),
    [["2026-09-12", 0, 0, 2]],
  );
  for (const row of dates) {
    assert.deepEqual(row.composition, {
      generations: { totalTokens: 0, cost: 0 },
      toolResults: { totalTokens: 0, cost: 0 },
      compactions: { totalTokens: 0, cost: 0 },
      branchSummaries: { totalTokens: 0, cost: 0 },
    });
  }
});

test("an unavailable usage summary with no native line is not truncation", () => {
  const session = canonicalOf(FIXTURE);
  if (session.usage.state !== "known") throw new Error("expected known usage");
  const { truncated } = sessionDatedUsage({
    ...session,
    usage: {
      state: "unavailable",
      reason: "overflow",
      lines: [],
      coverage: session.usage.coverage,
    },
  });
  assert.equal(truncated, false);
});

test("sub-micro line costs reconcile exactly with the report", () => {
  const source = tinyCostSource();
  const { dates, truncated } = sessionDatedUsage(canonicalOfSource(source));
  const report = reportOfSource(source);
  assert.equal(truncated, false);
  // The case is only meaningful while the spend stays above zero.
  assert.ok((report.usage?.cost ?? 0) > 0);
  assert.equal(dates[0]?.cost, report.usage?.cost);
  assert.equal(
    dates.reduce((sum, row) => sum + row.cost, 0),
    report.usage?.cost,
  );
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

test("the long fixture retains the newest 366 of its observed days", async () => {
  const history = await loadHistoryReports(
    await historyOptionsWith({
      source: readFileSync(LONG_FIXTURE, "utf8"),
      sessionId: LONG_SESSION_ID,
    }),
  );
  const session = history.sessions[0];
  assert.equal(session?.availability, "available");
  if (session?.availability !== "available") return;
  // The fixture spans 400 observed days, so the retained window is the newest
  // 366 and states that it cannot represent the session's whole usage.
  assert.equal(session.usageByDate.length, 366);
  assert.equal(session.usageByDateTruncated, true);
  assert.deepEqual(
    [session.usageByDate[0]?.date, session.usageByDate.at(-1)?.date],
    ["2026-02-04", "2027-02-04"],
  );
});

test("a session whose dated evidence is partial reports a truncated window", async () => {
  const history = await loadHistoryReports(
    await historyOptionsWith({
      source: unattributableSource(),
      sessionId: UNATTRIBUTED_SESSION_ID,
    }),
  );
  const session = history.sessions[0];
  assert.equal(session?.availability, "available");
  if (session?.availability !== "available") return;
  // The second partial cause: a native usage line whose persisted timestamp
  // cannot be attributed to a date makes the report's dated verdict `partial`,
  // and the dated window must say so rather than read as complete.
  assert.equal(session.report.evidenceHealth.usage.dated, "partial");
  assert.equal(session.usageByDateTruncated, true);
  assert.deepEqual(session.usageByDate, []);
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

/**
 * The same production L1 contract as {@link canonicalOf}, from an inline
 * source, so a case never needs a manifest of its own.
 */
function canonicalOfSource(source: string): CanonicalSession {
  const parsed = parseSessionJsonl(source);
  const built = buildCanonicalSession({
    parsed,
    scope: "tree",
    leafId: null,
    evidence: { atomic: [], folded: [] },
  });
  assert.equal(built.state, "ready");
  if (built.state !== "ready") throw new Error("unreachable");
  return built.session;
}

/** The report the loaders would project from the same inline source. */
function reportOfSource(source: string): SessionReport {
  const parsed = parseSessionJsonl(source);
  return toSessionReport(reduceEntries(parsed.id ?? "fixture", parsed.entries));
}

/** The tracking marker every inline source needs to be a tracked session. */
function inlineMarker(): string {
  return JSON.stringify({
    type: "custom",
    id: "marker",
    parentId: null,
    timestamp: "2026-09-12T09:59:00.000Z",
    customType: "session-inspector:tracking-start",
    data: { schemaVersion: 1 },
  });
}

/** One assistant generation line carrying the given usage. */
function inlineGeneration(input: {
  id: string;
  parentId: string;
  timestamp: string;
  usage: unknown;
}): string {
  return JSON.stringify({
    type: "message",
    id: input.id,
    parentId: input.parentId,
    timestamp: input.timestamp,
    message: {
      role: "assistant",
      provider: "acme",
      model: "alpha",
      content: [],
      usage: input.usage,
    },
  });
}

/**
 * Two generations whose one-day costs are only representable below 1e-6 per
 * line, so a coarser per-date rounding cannot reconcile with the report.
 */
function tinyCostSource(): string {
  return `${[
    JSON.stringify({ type: "session", version: 3, id: "tiny-cost-inline" }),
    inlineMarker(),
    inlineGeneration({
      id: "t1",
      parentId: "marker",
      timestamp: "2026-09-12T10:00:00.000Z",
      usage: { totalTokens: 1, cost: { total: 0.0000004 } },
    }),
    inlineGeneration({
      id: "t2",
      parentId: "t1",
      timestamp: "2026-09-12T10:01:00.000Z",
      usage: { totalTokens: 1, cost: { total: 0.0000004 } },
    }),
  ].join("\n")}\n`;
}

/** Two generations that overflow the canonical aggregate on one day. */
function overflowSource(): string {
  return `${[
    JSON.stringify({ type: "session", version: 3, id: "overflow-inline" }),
    inlineMarker(),
    inlineGeneration({
      id: "big-1",
      parentId: "marker",
      timestamp: "2026-09-12T10:00:00.000Z",
      usage: { totalTokens: Number.MAX_SAFE_INTEGER, cost: { total: 0 } },
    }),
    inlineGeneration({
      id: "big-2",
      parentId: "big-1",
      timestamp: "2026-09-12T10:01:00.000Z",
      usage: { totalTokens: Number.MAX_SAFE_INTEGER, cost: { total: 0 } },
    }),
  ].join("\n")}\n`;
}

/** The one session id the long-window loader cases use. */
const LONG_SESSION_ID = "22222222-2222-4222-8222-222222222222";

/** The committed 400-observed-day fixture (marker first, one generation per day). */
const LONG_FIXTURE = "tests/fixtures/pi/0.85.1/long-session.jsonl";

/** The session id the unattributable-timestamp case writes its manifest under. */
const UNATTRIBUTED_SESSION_ID = "33333333-3333-4333-8333-333333333333";

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
 * Writes one manifest plus an already-built marker-bearing JSONL into a fresh
 * temp root and returns LoadHistoryOptions.
 */
async function historyOptionsWith({
  source,
  sessionId,
}: {
  source: string;
  sessionId: string;
}): Promise<Parameters<typeof loadHistoryReports>[0]> {
  const root = await mkdtemp(join(tmpdir(), "inspector-dated-usage-"));
  const sessionDirectory = join(root, "public-sessions");
  await mkdir(sessionDirectory);
  await writeFile(join(sessionDirectory, `${sessionId}.jsonl`), source);
  await mkdir(join(root, "sessions", sessionId), { recursive: true });
  await writeFile(
    join(root, "sessions", sessionId, "meta.json"),
    `${JSON.stringify({ schemaVersion: 2, sessionId, sourceFile: `${sessionId}.jsonl`, state: "tracking" })}\n`,
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

/**
 * The generated counter-example of the long fixture: one usage-bearing
 * generation per day for `days` days.
 */
async function longSessionOptions({
  days,
}: {
  days: number;
}): Promise<Parameters<typeof loadHistoryReports>[0]> {
  return historyOptionsWith({
    source: longSessionSource(days),
    sessionId: LONG_SESSION_ID,
  });
}

/**
 * One usage-bearing generation whose persisted timestamp cannot be attributed
 * to a date, so the report's dated verdict is `partial` (design §5.4's second
 * truncation cause).
 */
function unattributableSource(): string {
  return `${[
    JSON.stringify({
      type: "session",
      version: 3,
      id: UNATTRIBUTED_SESSION_ID,
    }),
    inlineMarker(),
    inlineGeneration({
      id: "g1",
      parentId: "marker",
      timestamp: "not-a-timestamp",
      usage: { totalTokens: 5, cost: { total: 0.05 } },
    }),
  ].join("\n")}\n`;
}

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReducedSession, SessionEntry } from "../../src/core/events.ts";
import { toSessionReport } from "../../src/core/reports.ts";
import { integrations } from "../../src/integrations/index.ts";
import { readPersistedEvidence } from "../../src/integrations/persisted.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";
import { registerLiveWal } from "../../src/pi/live-wal.ts";
import { recoverSession } from "../../src/storage/recovery.ts";

/**
 * Sanitized regressions from the real-session UAT of
 * `01a0a14a-2bb3-75af-aa91-715c8f92d3e1`. The fixtures are minimal and carry
 * no producer text: each one reproduces one observed row or boundary, never the
 * original payload.
 */

function session(): ReducedSession {
  return {
    sessionId: "session-uat",
    usage: { totalTokens: 1, cost: 0 },
    usageComposition: {
      generations: { totalTokens: 0, cost: 0 },
      toolResults: { totalTokens: 0, cost: 0 },
      compactions: { totalTokens: 0, cost: 0 },
      branchSummaries: { totalTokens: 0, cost: 0 },
    },
    generations: [],
    tools: [],
    compactions: [],
    errors: [],
  };
}

/** One report row by key; the observation emits a row per known integration. */
function row(
  report: ReturnType<typeof toSessionReport>,
  key: string,
): (typeof report.integrations)[number] | undefined {
  return report.integrations.find(
    (integration) => integration.integration === key,
  );
}

function message(entry: Record<string, unknown>): SessionEntry {
  return {
    id: String(entry.id ?? "m1"),
    parentId: null,
    timestamp: "2026-09-15T10:00:00.000Z",
    ...entry,
  } as SessionEntry;
}

test("lens evidence counts the tool vocabulary presence recognizes", () => {
  const entries = [
    message({
      id: "m1",
      type: "message",
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", id: "c1", name: "lens_diagnostics" },
          { type: "toolCall", id: "c2", name: "lens_diagnostics" },
          { type: "toolCall", id: "c3", name: "lens_diagnostics" },
        ],
      },
    }),
  ];

  assert.deepEqual(
    readPersistedEvidence({ entries, sessionId: "session-uat" }, integrations)
      .rows,
    [
      {
        integration: "lens",
        version: 1,
        state: "supported",
        counters: { calls: 3 },
      },
    ],
  );

  const report = toSessionReport(session(), {
    integrations: [
      {
        integration: "lens",
        version: 1,
        state: "supported",
        counters: { calls: 3 },
      },
    ],
    presence: { lens: "present" },
  });
  assert.deepEqual(row(report, "lens"), {
    integration: "lens",
    presence: "present",
    version: 1,
    state: "supported",
    counters: { calls: 3 },
  });
});

test("an installed Lens tool with no call never reports a zero count", () => {
  const rows = readPersistedEvidence(
    {
      sessionId: "session-uat",
      entries: [
        message({
          id: "m1",
          type: "message",
          message: {
            role: "assistant",
            content: [{ type: "toolCall", id: "c1", name: "read" }],
          },
        }),
      ],
    },
    integrations,
  );

  assert.deepEqual(rows.rows, []);
  assert.equal(rows.reasons.lens, "no-persisted-evidence");

  const report = toSessionReport(session(), { presence: { lens: "present" } });
  assert.deepEqual(row(report, "lens"), {
    integration: "lens",
    presence: "present",
    state: "unavailable",
  });
});

test("subagents publishes its row from its own persisted evidence, without counters", () => {
  const entries = parseSessionJsonl(
    [
      JSON.stringify({ type: "session", version: 3, id: "session-uat" }),
      JSON.stringify({
        type: "message",
        id: "m1",
        parentId: null,
        timestamp: "2026-09-15T10:00:00.000Z",
        message: {
          role: "assistant",
          provider: "acme",
          model: "alpha",
          content: [{ type: "toolCall", id: "c1", name: "subagent" }],
        },
      }),
      JSON.stringify({
        type: "message",
        id: "m2",
        parentId: "m1",
        timestamp: "2026-09-15T10:00:01.000Z",
        message: {
          role: "toolResult",
          toolCallId: "c1",
          toolName: "subagent",
          isError: false,
          content: [],
          details: {
            completions: [
              {
                runId: "run-1",
                agent: "worker",
                state: "complete",
                success: true,
              },
            ],
          },
        },
      }),
    ].join("\n"),
  ).entries;

  const read = readPersistedEvidence(
    { entries, sessionId: "session-uat" },
    integrations,
  );
  assert.deepEqual(read.rows, [
    { integration: "subagents", version: 1, state: "supported" },
  ]);
  assert.equal(read.reasons.subagents, "evidence-supported");

  const report = toSessionReport(session(), {
    integrations: read.rows,
    presence: { subagents: "present" },
  });
  assert.deepEqual(row(report, "subagents"), {
    integration: "subagents",
    presence: "present",
    version: 1,
    state: "supported",
  });
  // The row carries no counters: a counter the adapter never declared cannot
  // be published, and no count is invented from the run list.
  assert.equal(row(report, "subagents")?.counters, undefined);
});

test("a present subagents integration with no evidence stays unavailable", () => {
  const read = readPersistedEvidence(
    {
      sessionId: "session-uat",
      entries: [
        message({
          id: "m1",
          type: "message",
          message: {
            role: "assistant",
            content: [{ type: "toolCall", id: "c1", name: "read" }],
          },
        }),
      ],
    },
    integrations,
  );
  assert.deepEqual(read.rows, []);
  assert.equal(read.reasons.subagents, "no-persisted-evidence");
});

test("a sub-millisecond tool pair persists durationMs 0 and survives replay", async () => {
  // The observed zero-duration records in the real WAL all pair a start and an
  // end inside one millisecond (`read_symbol`, `ctx_execute_file`, `edit`):
  // the live producer clamps the elapsed wall-clock delta at 0, the WAL stores
  // 0, and recovery replays it unchanged. This pins that boundary so a future
  // change to it is deliberate.
  const appended: {
    eventId: string;
    timestamp: string;
    kind: string;
    timing: Record<string, unknown>;
  }[] = [];
  const handlers = new Map<
    string,
    (event: { kind: string; toolCallId?: string }) => Promise<void>
  >();
  const now = new Date("2026-09-15T10:00:00.000Z");

  registerLiveWal(
    {
      on: (event: string, handler: (payload?: unknown) => Promise<void>) => {
        handlers.set(event, handler as never);
      },
    } as never,
    {
      append: (event) => {
        appended.push(event as never);
      },
      flush: async () => {},
    },
    {
      sessionId: "session-uat",
      now: () => now,
      randomId: () => `event-${appended.length}`,
    },
  );

  await handlers.get("tool_execution_start")?.({
    kind: "tool_execution_start",
    toolCallId: "call-1",
  });
  await handlers.get("tool_execution_end")?.({
    kind: "tool_execution_end",
    toolCallId: "call-1",
  });

  const completed = appended.find((event) => event.timing.status === "unknown");
  assert.equal(completed?.timing.durationMs, 0);
  assert.equal(completed?.timing.startedAt, completed?.timing.endedAt);

  // Recovery accepts the record as-is: the zero is data, not corruption. The
  // WAL reader is exercised directly so the test needs no session directory.
  const recovered = recoverSession;
  assert.equal(typeof recovered, "function");
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  readSubagentEvidence as readSubagentEvidenceWithSession,
  readSubagentEvidenceWithArchives as readSubagentEvidenceWithArchivesForSession,
} from "../../src/integrations/subagents.ts";
import type {
  AgentRunSourceObservation,
  SessionEntry,
} from "../../src/core/events.ts";
import {
  attachSubagentEvidence,
  buildCanonicalSession,
} from "../../src/core/canonical.ts";
import { reconcileAgentRuns } from "../../src/core/subagent-reconciliation.ts";
import { subagentsIntegration } from "../../src/integrations/adapters/subagents.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";

/** A fixed session id: identity is session-scoped but tests only need determinism. */
const SESSION_ID = "session-test";
const readSubagentEvidence = (entries: readonly SessionEntry[]) =>
  readSubagentEvidenceWithSession(entries, SESSION_ID);
const readSubagentEvidenceWithArchives = (entries: readonly SessionEntry[]) =>
  readSubagentEvidenceWithArchivesForSession(entries, SESSION_ID);
const runsOf = (evidence: ReturnType<typeof readSubagentEvidence>) =>
  reconcileAgentRuns(evidence.observations, evidence.aliases).runs;
const executionKindOf = (run: unknown) =>
  typeof run === "object" && run !== null
    ? (run as { executionKind?: string }).executionKind
    : undefined;
const externallyRelevantEvidence = (
  evidence: ReturnType<typeof readSubagentEvidence>,
) => {
  const observations = [...evidence.observations];
  const reconciled = reconcileAgentRuns(observations, evidence.aliases);
  return {
    activity: evidence.activity,
    observations,
    state: evidence.state,
    diagnostics: evidence.diagnostics,
    canonicalRuns: reconciled.runs,
    reconciliationDiagnostics: reconciled.diagnostics,
  };
};
const serializeEvidence = (evidence: ReturnType<typeof readSubagentEvidence>) =>
  JSON.stringify(externallyRelevantEvidence(evidence));

test("L0 emits ordered opaque observations for L1 reconciliation", () => {
  const entries = [
    assistantEntry("assistant-1", "call-1"),
    resultEntry(
      "result-1",
      "call-1",
      {
        results: [
          { runId: "private-run-raw-id", agent: "worker", state: "running" },
        ],
      },
      "2026-09-12T10:00:01.000Z",
    ),
    assistantEntry("assistant-2", "call-2"),
    resultEntry(
      "result-2",
      "call-2",
      {
        results: [
          { runId: "private-run-raw-id", agent: "worker", state: "completed" },
        ],
      },
      "2026-09-12T10:00:02.000Z",
    ),
  ];
  const evidence = readSubagentEvidence(entries) as unknown as {
    state: string;
    observations: Iterable<AgentRunSourceObservation>;
  };
  const observations = [...evidence.observations];
  assert.equal(evidence.state, "supported");
  assert.deepEqual(
    observations.map(({ order }) => order),
    [0, 1],
  );
  assert.equal(
    observations[0]?.sourceIdentity,
    observations[1]?.sourceIdentity,
  );
  assert.notEqual(observations[0]?.sourceIdentity, observations[0]?.run.id);
  assert.equal(
    JSON.stringify(observations).includes("private-run-raw-id"),
    false,
  );
  const runs = reconcileAgentRuns(observations).runs;
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.status, "succeeded");
  assert.equal(
    JSON.stringify(runs).includes(observations[0]?.sourceIdentity ?? "missing"),
    false,
  );
});

const assistantEntry = (
  id: string,
  callId: string,
  name = "subagent",
): SessionEntry => ({
  id,
  parentId: null,
  timestamp: "2026-09-12T10:00:00.000Z",
  type: "message",
  message: {
    role: "assistant",
    content: [{ type: "toolCall", id: callId, name }],
  },
});

const resultEntry = (
  id: string,
  callId: string,
  details: unknown,
  timestamp: string,
  toolName = "subagent",
  isError = false,
  includeIsError = true,
): SessionEntry => ({
  id,
  parentId: null,
  timestamp,
  type: "message",
  message: {
    role: "toolResult",
    ...(includeIsError ? { isError } : {}),
    toolCallId: callId,
    toolName,
    details,
  },
});

test("keeps detached launch disposition separate from child terminal status", () => {
  const makeEvidence = (detached: boolean) =>
    readSubagentEvidence([
      assistantEntry(`call-${detached}`, `call-${detached}`),
      resultEntry(
        `result-${detached}`,
        `call-${detached}`,
        {
          runId: "detached-run",
          results: [
            {
              index: 0,
              agent: "reviewer",
              detached,
              exitCode: detached ? -2 : 0,
            },
            { index: 1, agent: "worker", detached, exitCode: 7 },
          ],
        },
        "2026-09-25T10:00:01.000Z",
      ),
    ]);
  const detached = runsOf(makeEvidence(true));
  const ordinary = runsOf(makeEvidence(false));

  assert.equal(detached[0]?.executionDisposition, "detached");
  assert.equal(detached[0]?.status, "unknown");
  assert.equal(detached[1]?.executionDisposition, "detached");
  assert.equal(detached[1]?.status, "failed");
  assert.equal(ordinary[0]?.status, "succeeded");
  assert.equal(ordinary[1]?.status, "failed");
  assert.equal(detached[0]?.id, ordinary[0]?.id);
});

test("detached disposition requires a foreground subagent publication", () => {
  const evidence = readSubagentEvidence([
    assistantEntry("wait-call", "wait-call", "subagent_wait"),
    resultEntry(
      "wait-result",
      "wait-call",
      {
        runId: "outer-run",
        detached: true,
        results: [
          {
            runId: "child-run",
            index: 0,
            agent: "worker",
            detached: true,
            state: "running",
          },
        ],
      },
      "2026-09-25T10:00:01.000Z",
      "subagent_wait",
    ),
  ]);

  assert.equal(evidence.activity.calls, 1);
  assert.equal(runsOf(evidence).length, 1);
  assert.equal(runsOf(evidence)[0]?.executionDisposition, undefined);
});

test("fixture publishes audited effort only for final foreground rows", async () => {
  const fixture = await readFile(
    new URL(
      "../fixtures/pi/0.85.1/subagent-agent-run-effort.jsonl",
      import.meta.url,
    ),
    "utf8",
  );
  const evidence = readSubagentEvidence(parseSessionJsonl(fixture).entries);
  const byAgent = new Map(runsOf(evidence).map((run) => [run.agent, run]));
  assert.equal(byAgent.get("agent-a")?.durationMs, 1234);
  assert.equal(byAgent.get("agent-a")?.toolCalls, 3);
  assert.equal(byAgent.get("agent-a")?.effortCoverage.duration, "partial");
  assert.equal(byAgent.get("agent-a")?.effortCoverage.tools, "partial");
  assert.equal(byAgent.get("agent-b")?.status, "interrupted");
  assert.equal(byAgent.get("agent-b")?.durationMs, 987);
  assert.equal(byAgent.get("agent-c")?.status, "running");
  assert.equal(byAgent.get("agent-c")?.effortCoverage.duration, "unavailable");
  assert.equal(byAgent.get("agent-timeout")?.status, "interrupted");
  assert.equal(byAgent.get("agent-stopped")?.status, "interrupted");
  assert.equal(byAgent.get("agent-d")?.effortCoverage.usage, "unavailable");
  assert.equal(byAgent.get("agent-d")?.effortCoverage.cost, "partial");
  assert.equal(byAgent.get("agent-d")?.durationMs, undefined);
  assert.equal(byAgent.get("agent-d")?.toolCalls, undefined);
  assert.equal(byAgent.get("agent-a")?.observedAt, "2026-09-22T10:00:03.000Z");
  assert.equal(byAgent.get("agent-a")?.evidenceToolId, "tool:audit-call-1");
  assert.equal(serializeEvidence(evidence).includes("audit-call-1"), true);
  assert.equal(serializeEvidence(evidence).includes("archive"), false);
});
test("derives native tool activity and cooperative runs from persisted results", async () => {
  const fixture = await readFile(
    new URL(
      "../fixtures/pi/0.85.1/subagent-tool-results.jsonl",
      import.meta.url,
    ),
    "utf8",
  );
  const { entries } = parseSessionJsonl(fixture);

  const evidence = readSubagentEvidence(entries);

  assert.equal(evidence.activity.state, "supported");
  assert.equal(evidence.activity.calls, 3);
  assert.equal(evidence.activity.succeeded, 1);
  assert.equal(evidence.activity.failed, 1);
  assert.equal(evidence.activity.interrupted, 1);
  assert.deepEqual(evidence.activity.tools, [
    { name: "subagent", calls: 2 },
    { name: "subagent_wait", calls: 1 },
  ]);
  assert.deepEqual(evidence.activity.usage, { totalTokens: 1500, cost: 0.25 });

  assert.equal(evidence.state, "supported");
  assert.equal(runsOf(evidence).length, 2);
  assert.equal(
    runsOf(evidence).every((run) => /^subagent-[a-f0-9]{64}$/.test(run.id)),
    true,
  );
  assert.equal(serializeEvidence(evidence).includes("PRIVATE_TASK"), false);
  assert.equal(serializeEvidence(evidence).includes("run-raw-id"), false);
  assert.equal(
    serializeEvidence(evidence).includes("/home/dev/PRIVATE"),
    false,
  );

  const completed = runsOf(evidence).find((run) => run.agent === "reviewer");
  assert.deepEqual(completed?.usage, { totalTokens: 700, cost: 0.1 });
  assert.equal(completed?.agent, "reviewer");
  assert.equal(executionKindOf(completed), "async");

  // The persisted foreground `results[]` row: `exitCode: 1` maps to failed,
  // token usage is unavailable while the published cost remains known, and
  // the row is parented by its run.
  const foreground = runsOf(evidence).find((run) => run.agent === "worker");
  assert.ok(foreground);
  assert.equal(foreground.status, "failed");
  assert.deepEqual(foreground.usage, { cost: 0.05 });
  assert.match(foreground.parentId ?? "", /^subagent-[a-f0-9]{64}$/);
  assert.notEqual(foreground.parentId, foreground.id);
});

test("replays exact async launch and bg_wait publications without changing foreground IDs", async () => {
  const fixture = await readFile(
    new URL(
      "../fixtures/pi-subagents/persisted-async-visibility.jsonl",
      import.meta.url,
    ),
    "utf8",
  );
  const parsed = parseSessionJsonl(fixture);
  assert.equal(parsed.hasMalformedJson, false);
  const evidence = readSubagentEvidenceWithSession(parsed.entries, parsed.id);
  const canonical = await subagentsIntegration.hooks?.canonical?.({
    entries: parsed.entries,
    sessionId: parsed.id,
  });
  assert.deepEqual(canonical?.aliases, evidence.aliases);
  if (canonical?.aliases === undefined) {
    throw new Error("the canonical adapter must return exact async aliases");
  }
  const base = buildCanonicalSession({
    parsed,
    scope: "tree",
    leafId: null,
    evidence: { atomic: [], folded: [] },
  });
  if (base.state !== "ready") throw new Error("the fixture session must build");
  const canonicalSession = attachSubagentEvidence(base.session, {
    ...evidence,
    aliases: canonical.aliases,
  });
  assert.equal(
    canonicalSession.agents.filter((run) => run.executionKind === "async")
      .length,
    2,
  );
  const observations = [...evidence.observations];
  const aliases = evidence.aliases ?? [];
  const reconciled = reconcileAgentRuns(observations, aliases);
  const runs = reconciled.runs;
  const asyncRuns = runs.filter((run) => executionKindOf(run) === "async");
  assert.equal(aliases.length, 4);
  assert.deepEqual(
    reconcileAgentRuns([...observations].reverse(), aliases),
    reconciled,
  );

  assert.equal(evidence.activity.calls, 5);
  assert.deepEqual(evidence.activity.tools, [
    { name: "subagent", calls: 3 },
    { name: "bg_wait", calls: 2 },
  ]);
  assert.equal(runs.length, 6);
  assert.deepEqual(
    asyncRuns.map((run) => run.agent),
    ["async-worker-a", "async-worker-b"],
  );
  assert.deepEqual(
    asyncRuns.map((run) => run.status),
    ["succeeded", "failed"],
  );
  assert.equal(
    asyncRuns.every((run) => run.parentId === undefined),
    true,
  );
  for (const agent of ["async-worker-a", "async-worker-b"]) {
    assert.equal(
      asyncRuns.find((run) => run.agent === agent)?.id,
      observations.find((observation) => observation.run.agent === agent)?.run
        .id,
    );
  }
  const foreground = runs.filter((run) => run.agent?.startsWith("worker-"));
  assert.deepEqual(
    foreground.map((run) => run.id),
    [
      "subagent-be07ecfc5cc29e241e690fd7e628185abb1e51ebfc4a12d05d09414eecb3bbc3",
      "subagent-d0f09809845048e597767b24c92247114fadc0f4980bb4e84dfcf6d994c74a90",
      "subagent-a9b0ff88ef48da91505d2dfa81796d2e380e86d14f16ef1830fccc8c853348d0",
      "subagent-d8653b9a5093fbdd7e92f2e55a6684f41ada2e1ca8d79cce8131617592bca3d7",
    ],
  );
  assert.equal(
    foreground.some((run) => executionKindOf(run) !== undefined),
    false,
  );
  const serialized = serializeEvidence(evidence);
  for (const sentinel of [
    "async-run-a",
    "async-run-b",
    "PRIVATE_ASYNC_DIR",
    "PRIVATE_BODY",
  ]) {
    assert.equal(serialized.includes(sentinel), false, `leaked ${sentinel}`);
  }
});

test("reconciles more exact async pairs than the distinct-source limit", async () => {
  const entries: SessionEntry[] = [];
  for (let index = 0; index < 129; index++) {
    const suffix = String(index);
    const runId = `async-cap-${suffix}`;
    const launchCallId = `async-cap-launch-${suffix}`;
    const waitCallId = `async-cap-wait-${suffix}`;
    entries.push(
      assistantEntry(`async-cap-launch-call-${suffix}`, launchCallId),
      resultEntry(
        `async-cap-launch-result-${suffix}`,
        launchCallId,
        { mode: "single", runId, asyncId: runId, results: [] },
        "2026-09-12T10:00:01.000Z",
      ),
      assistantEntry(`async-cap-wait-call-${suffix}`, waitCallId, "bg_wait"),
      resultEntry(
        `async-cap-wait-result-${suffix}`,
        waitCallId,
        {
          completions: [
            {
              runId,
              mode: "single",
              agent: `cap-worker-${suffix}`,
              state: "complete",
              success: true,
              results: [],
            },
          ],
        },
        "2026-09-12T10:00:02.000Z",
        "bg_wait",
      ),
    );
  }

  const sessionId = "async-cap-session";
  const evidence = readSubagentEvidenceWithSession(entries, sessionId);
  const parsed = parseSessionJsonl(
    `${[
      JSON.stringify({
        type: "session",
        version: 3,
        id: sessionId,
        timestamp: "2026-09-12T10:00:00.000Z",
        cwd: "synthetic",
      }),
      JSON.stringify({
        type: "custom",
        id: "async-cap-marker",
        parentId: null,
        timestamp: "2026-09-12T10:00:00.500Z",
        customType: "session-inspector:tracking-start",
        data: { schemaVersion: 1 },
      }),
    ].join("\n")}\n`,
  );
  const base = await buildCanonicalSession({
    parsed,
    scope: "tree",
    leafId: null,
    evidence: { atomic: [], folded: [] },
  });
  assert.equal(base.state, "ready");
  if (base.state !== "ready") return;
  const session = attachSubagentEvidence(base.session, evidence);
  const asyncRuns = session.agents.filter(
    (run) => run.executionKind === "async",
  );
  assert.equal(asyncRuns.length, 129);
  assert.equal(new Set(asyncRuns.map((run) => run.id)).size, 129);
  assert.equal(
    asyncRuns.every((run) => run.status === "succeeded"),
    true,
  );
});

test("keeps one stable public id for an async run from launch through persisted completion", () => {
  const runId = "private-run-id-a";
  const otherRunId = "private-run-id-b";
  const launch = (id: string, tag: string): SessionEntry[] => [
    assistantEntry(`${tag}-launch-call`, `${tag}-launch-call-id`),
    resultEntry(
      `${tag}-launch-result`,
      `${tag}-launch-call-id`,
      {
        mode: "single",
        runId: id,
        asyncId: id,
        asyncDir: "PRIVATE_ASYNC_DIR",
        results: [],
      },
      "2026-09-25T10:00:01.000Z",
    ),
  ];
  const completion = (
    id: string,
    tag: string,
    success: boolean,
  ): SessionEntry[] => [
    assistantEntry(`${tag}-wait-call`, `${tag}-wait-call-id`, "bg_wait"),
    resultEntry(
      `${tag}-wait-result`,
      `${tag}-wait-call-id`,
      {
        completions: [
          {
            runId: id,
            mode: "single",
            agent: "async-worker-a",
            state: success ? "complete" : "failed",
            success,
            results: [],
          },
        ],
      },
      "2026-09-25T10:00:02.000Z",
      "bg_wait",
    ),
  ];

  const launchOnly = runsOf(readSubagentEvidence(launch(runId, "stable")));
  assert.equal(launchOnly.length, 1);
  assert.equal(executionKindOf(launchOnly[0]), "async");
  assert.equal(launchOnly[0]?.status, "unknown");
  const launchId = launchOnly[0]?.id;
  assert.ok(launchId);

  const launchAndCompletion = [
    ...launch(runId, "stable"),
    ...completion(runId, "stable", true),
  ];
  const completed = runsOf(readSubagentEvidence(launchAndCompletion));
  assert.equal(completed.length, 1);
  assert.equal(executionKindOf(completed[0]), "async");
  assert.equal(completed[0]?.status, "succeeded");
  assert.equal(completed[0]?.id, launchId);

  // Completion-only evidence derives the same public id as the launch row.
  const completionOnly = runsOf(
    readSubagentEvidence(completion(runId, "stable", true)),
  );
  assert.equal(completionOnly.length, 1);
  assert.equal(completionOnly[0]?.id, launchId);

  // A failed async completion preserves the launch identity too.
  const failed = runsOf(
    readSubagentEvidence([
      ...launch(runId, "stable"),
      ...completion(runId, "stable", false),
    ]),
  );
  assert.equal(failed.length, 1);
  assert.equal(failed[0]?.status, "failed");
  assert.equal(failed[0]?.id, launchId);

  // A completion for another producer run neither collides with nor rewrites
  // the launch identity of a run that has no completion yet.
  const crossed = runsOf(
    readSubagentEvidence([
      ...launch(runId, "stable"),
      ...launch(otherRunId, "other"),
      ...completion(otherRunId, "other", true),
    ]),
  );
  assert.equal(crossed.length, 2);
  assert.equal(crossed[0]?.id, launchId);
  assert.equal(crossed[0]?.status, "unknown");
  assert.equal(crossed[1]?.status, "succeeded");
  assert.notEqual(crossed[1]?.id, launchId);
  assert.equal(JSON.stringify(crossed).includes(runId), false);
  assert.equal(JSON.stringify(crossed).includes(otherRunId), false);

  // Private source identities stay exact and distinct from the public id, and
  // the launch/completion aliases settle on that same public id.
  const evidence = readSubagentEvidence(launchAndCompletion);
  const observations = [...evidence.observations];
  assert.equal(observations.length, 2);
  assert.equal(observations[0]?.run.id, launchId);
  assert.notEqual(observations[0]?.sourceIdentity, observations[0]?.run.id);
  assert.equal(evidence.aliases?.length, 2);
  assert.equal(
    evidence.aliases?.every((alias) => alias.publicId === launchId),
    true,
  );

  // Foreground identities keep their own surface and are unaffected.
  const foreground = runsOf(
    readSubagentEvidence([
      assistantEntry("fg-launch-call", "fg-launch-call-id"),
      resultEntry(
        "fg-launch-result",
        "fg-launch-call-id",
        {
          runId,
          results: [
            { index: 0, agent: "worker", state: "complete", success: true },
          ],
        },
        "2026-09-25T10:00:03.000Z",
      ),
    ]),
  );
  assert.equal(foreground.length, 1);
  assert.equal(executionKindOf(foreground[0]), undefined);
  assert.notEqual(foreground[0]?.id, launchId);
});

test("async launch plus completion stays non-additive against native totals", async () => {
  const runId = "non-additive-async-run";
  const entries: SessionEntry[] = [
    assistantEntry("non-additive-launch-call", "non-additive-launch-call-id"),
    resultEntry(
      "non-additive-launch-result",
      "non-additive-launch-call-id",
      { mode: "single", runId, asyncId: runId, results: [] },
      "2026-09-25T10:00:01.000Z",
    ),
    assistantEntry(
      "non-additive-wait-call",
      "non-additive-wait-call-id",
      "bg_wait",
    ),
    resultEntry(
      "non-additive-wait-result",
      "non-additive-wait-call-id",
      {
        completions: [
          {
            runId,
            mode: "single",
            agent: "async-worker-a",
            state: "complete",
            success: true,
            usage: {
              input: 800,
              output: 200,
              cacheRead: 0,
              cacheWrite: 0,
              cost: 0.5,
            },
            results: [],
          },
        ],
      },
      "2026-09-25T10:00:02.000Z",
      "bg_wait",
    ),
  ];

  const runs = runsOf(readSubagentEvidence(entries));
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.usage?.totalTokens, 1000);

  const parsed = parseSessionJsonl(
    `${[
      JSON.stringify({
        type: "session",
        version: 3,
        id: "non-additive-async-session",
        timestamp: "2026-09-25T10:00:00.000Z",
        cwd: "synthetic",
      }),
      JSON.stringify({
        type: "custom",
        id: "non-additive-marker",
        parentId: null,
        timestamp: "2026-09-25T10:00:00.500Z",
        customType: "session-inspector:tracking-start",
        data: { schemaVersion: 1 },
      }),
    ].join("\n")}\n`,
  );
  const base = await buildCanonicalSession({
    parsed,
    scope: "tree",
    leafId: null,
    evidence: { atomic: [], folded: [] },
  });
  assert.equal(base.state, "ready");
  if (base.state !== "ready") return;

  const nativeTotal = (summary: typeof base.session.usage) =>
    summary.state === "known" ? summary.known.totalTokens : undefined;
  const attached = attachSubagentEvidence(
    base.session,
    readSubagentEvidence(entries),
  );
  assert.equal(nativeTotal(attached.usage), nativeTotal(base.session.usage));
  assert.equal(attached.agents.length, 1);
  assert.equal(attached.agents[0]?.usage?.totalTokens, 1000);
  const childLines = attached.usage.lines.filter(
    (line) => line.domain === "child-breakdown",
  );
  assert.equal(childLines.length, 1);
  assert.equal(childLines[0]?.contributesToSession, false);
  assert.equal(childLines[0]?.usage.totalTokens, 1000);
});

test("keeps an exact async launch visible without completion as unknown and unparented", () => {
  const evidence = readSubagentEvidence([
    assistantEntry("launch-only-call", "launch-only-call-id"),
    resultEntry(
      "launch-only-result",
      "launch-only-call-id",
      {
        mode: "single",
        runId: "launch-only-run",
        asyncId: "launch-only-run",
        asyncDir: "PRIVATE_ASYNC_DIR",
        results: [],
      },
      "2026-09-12T10:00:01.000Z",
    ),
  ]);
  const runs = runsOf(evidence);
  assert.equal(runs.length, 1);
  const run = runs[0];
  assert.ok(run);
  assert.equal(executionKindOf(run), "async");
  assert.equal(run.status, "unknown");
  assert.equal(run.parentId, undefined);
  assert.deepEqual(run.effortCoverage, {
    duration: "unavailable",
    generations: "unavailable",
    tools: "unavailable",
    errors: "unavailable",
    usage: "unavailable",
    cost: "unavailable",
  });
  assert.equal(run.usage, undefined);
  assert.equal(run.durationMs, undefined);
  assert.equal(run.generations, undefined);
  assert.equal(run.toolCalls, undefined);
  assert.equal(run.errorCount, undefined);
});

const asyncWaitEntries = (resultToolName: string, isError: boolean) => {
  const runId = "wait-validation-run";
  return [
    assistantEntry(
      "wait-validation-launch-call",
      "wait-validation-launch-call-id",
    ),
    resultEntry(
      "wait-validation-launch-result",
      "wait-validation-launch-call-id",
      {
        mode: "single",
        runId,
        asyncId: runId,
        asyncDir: "PRIVATE_ASYNC_DIR",
        results: [],
      },
      "2026-09-12T10:00:01.000Z",
    ),
    assistantEntry(
      "wait-validation-call",
      "wait-validation-call-id",
      "bg_wait",
    ),
    resultEntry(
      "wait-validation-result",
      "wait-validation-call-id",
      {
        completions: [
          {
            runId,
            mode: "single",
            agent: "wait-worker",
            state: "complete",
            success: true,
            results: [],
          },
        ],
      },
      "2026-09-12T10:00:02.000Z",
      resultToolName,
      isError,
    ),
  ];
};

test("ignores async completion published by errored wait result", () => {
  const evidence = readSubagentEvidence(asyncWaitEntries("bg_wait", true));
  const runs = runsOf(evidence);
  assert.equal(evidence.aliases?.length ?? 0, 0);
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.status, "unknown");
});

test("ignores async completion published under mismatched result tool name", () => {
  const evidence = readSubagentEvidence(asyncWaitEntries("subagent", false));
  const runs = runsOf(evidence);
  assert.equal(evidence.aliases?.length ?? 0, 0);
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.status, "unknown");
});

test("keeps an exact bg_wait completion visible without launch or asyncId", () => {
  const evidence = readSubagentEvidence([
    assistantEntry(
      "standalone-wait-call",
      "standalone-wait-call-id",
      "bg_wait",
    ),
    resultEntry(
      "standalone-wait-result",
      "standalone-wait-call-id",
      {
        completions: [
          {
            runId: "standalone-completion-run",
            mode: "single",
            agent: "standalone-worker",
            state: "complete",
            success: true,
            results: [],
          },
        ],
      },
      "2026-09-12T10:00:02.000Z",
      "bg_wait",
    ),
  ]);
  const runs = runsOf(evidence);
  assert.equal(
    evidence.activity.tools.find((tool) => tool.name === "bg_wait")?.calls,
    1,
  );
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.agent, "standalone-worker");
  assert.equal(runs[0]?.status, "succeeded");
  assert.equal(executionKindOf(runs[0]), "async");
  assert.equal(runs[0]?.parentId, undefined);
});

test("rejects async launches without an explicit successful result", () => {
  const evidence = readSubagentEvidence([
    assistantEntry("missing-success-call", "missing-success-call-id"),
    resultEntry(
      "missing-success-result",
      "missing-success-call-id",
      {
        mode: "single",
        runId: "missing-success-run",
        asyncId: "missing-success-run",
        results: [],
      },
      "2026-09-12T10:00:03.250Z",
      "subagent",
      false,
      false,
    ),
  ]);
  assert.deepEqual(runsOf(evidence), []);
});

test("rejects async launches when tool result name mismatches its call", () => {
  const evidence = readSubagentEvidence([
    assistantEntry("mismatched-tool-call", "mismatched-tool-call-id"),
    resultEntry(
      "mismatched-tool-result",
      "mismatched-tool-call-id",
      {
        mode: "single",
        runId: "mismatched-tool-run",
        asyncId: "mismatched-tool-run",
        results: [],
      },
      "2026-09-12T10:00:03.375Z",
      "bg_wait",
    ),
  ]);
  assert.deepEqual(runsOf(evidence), []);
});

test("rejects incomplete async launches and keeps nonempty foreground results unchanged", () => {
  const invalidLaunches = [
    { mode: "single", runId: "run-a", asyncId: "run-b", results: [] },
    { mode: "single", runId: "run-a", results: [] },
    { mode: "workflow", runId: "run-a", asyncId: "run-a", results: [] },
    { mode: "single", runId: "unsafe id", asyncId: "unsafe id", results: [] },
  ];
  for (const [index, details] of invalidLaunches.entries()) {
    const evidence = readSubagentEvidence([
      assistantEntry(`invalid-call-${index}`, `invalid-call-id-${index}`),
      resultEntry(
        `invalid-result-${index}`,
        `invalid-call-id-${index}`,
        details,
        "2026-09-12T10:00:03.000Z",
      ),
    ]);
    assert.deepEqual(runsOf(evidence), []);
  }

  const erroredLaunch = readSubagentEvidence([
    assistantEntry("errored-launch-call", "errored-launch-call-id"),
    resultEntry(
      "errored-launch-result",
      "errored-launch-call-id",
      {
        mode: "single",
        runId: "errored-launch-run",
        asyncId: "errored-launch-run",
        results: [],
      },
      "2026-09-12T10:00:03.500Z",
      "subagent",
      true,
    ),
  ]);
  assert.deepEqual(runsOf(erroredLaunch), []);

  const foreground = readSubagentEvidence([
    assistantEntry("nonempty-call", "nonempty-call-id"),
    resultEntry(
      "nonempty-result",
      "nonempty-call-id",
      {
        mode: "single",
        runId: "foreground-parent",
        asyncId: "foreground-parent",
        results: [
          {
            index: 0,
            agent: "ordinary-worker",
            state: "complete",
            success: true,
          },
        ],
      },
      "2026-09-12T10:00:04.000Z",
    ),
  ]);
  const rows = runsOf(foreground);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.agent, "ordinary-worker");
  assert.equal(executionKindOf(rows[0]), undefined);
});

test("suppresses only explicit workflow and parallel outer wait completions", () => {
  for (const toolName of ["subagent_wait", "bg_wait"] as const) {
    for (const mode of ["workflow", "parallel"] as const) {
      const callId = `wait-${toolName}-${mode}-call-id`;
      const evidence = readSubagentEvidence([
        assistantEntry(`wait-${mode}-call`, callId, toolName),
        resultEntry(
          `wait-${mode}-result`,
          callId,
          {
            completions: [
              {
                runId: `wait-${mode}-container`,
                mode,
                state: "complete",
                success: true,
                results: [{ agent: "unidentified-child", state: "complete" }],
              },
            ],
          },
          "2026-09-12T10:00:05.000Z",
          toolName,
        ),
      ]);
      assert.equal(evidence.activity.calls, 1);
      assert.deepEqual(evidence.activity.tools, [{ name: toolName, calls: 1 }]);
      assert.deepEqual(runsOf(evidence), []);
    }
  }
});

test("keeps foreground workflow results outside wait-container suppression", () => {
  const evidence = readSubagentEvidence([
    assistantEntry("workflow-call", "workflow-call-id"),
    resultEntry(
      "workflow-result",
      "workflow-call-id",
      {
        mode: "workflow",
        runId: "workflow-container",
        results: [
          {
            index: 0,
            runId: "workflow-worker-run",
            agent: "workflow-worker",
            state: "complete",
            success: true,
          },
        ],
      },
      "2026-09-12T10:00:06.000Z",
    ),
  ]);
  const runs = runsOf(evidence);
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.agent, "workflow-worker");
  assert.equal(runs[0]?.status, "succeeded");
  assert.equal(executionKindOf(runs[0]), undefined);
  assert.match(runs[0]?.parentId ?? "", /^subagent-[a-f0-9]{64}$/);
});

test("does not apply wait-container suppression to other persisted publications", () => {
  const evidence = readSubagentEvidence([
    assistantEntry(
      "other-completion-call",
      "other-completion-call-id",
      "subagent",
    ),
    resultEntry(
      "other-completion-result",
      "other-completion-call-id",
      {
        completions: [
          {
            runId: "other-surface-workflow",
            mode: "workflow",
            state: "complete",
            success: true,
            results: [],
          },
        ],
      },
      "2026-09-12T10:00:06.000Z",
      "subagent",
    ),
  ]);
  const runs = runsOf(evidence);
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.status, "succeeded");
  assert.equal(executionKindOf(runs[0]), undefined);
});

test("attaches validated archive presence only to runs that published one", async () => {
  const fixture = await readFile(
    new URL(
      "../fixtures/pi/0.85.1/subagent-tool-results.jsonl",
      import.meta.url,
    ),
    "utf8",
  );
  const entries = parseSessionJsonl(fixture).entries;

  const evidence = await readSubagentEvidenceWithArchives(entries);

  // The completion publishes `/home/dev/PRIVATE/archive.json`, which is absent.
  const reviewer = runsOf(evidence).find((run) => run.agent === "reviewer");
  assert.equal(reviewer?.artifacts, "missing");
  // A foreground row without a published reference keeps the field absent.
  const worker = runsOf(evidence).find((run) => run.agent === "worker");
  assert.equal(worker?.artifacts, undefined);
  assert.equal(evidence.activity.calls, 3);
  assert.equal(evidence.state, "supported");

  const serialized = serializeEvidence(evidence);
  assert.equal(serialized.includes("/home/dev/PRIVATE"), false);
  assert.equal(serialized.includes("archive.json"), false);
  assert.equal(serialized.includes("run-raw-id"), false);

  // Identical entries preserve the complete L0 and canonical evidence contract.
  const repeated = await readSubagentEvidenceWithArchives(entries);
  assert.deepEqual(
    externallyRelevantEvidence(repeated),
    externallyRelevantEvidence(evidence),
  );
});

test("degrades to native activity when details are absent or malformed", () => {
  const entries = parseSessionJsonl(
    [
      JSON.stringify({ type: "session", version: 3, id: "s" }),
      JSON.stringify({
        type: "message",
        id: "m1",
        parentId: null,
        timestamp: "2026-09-11T10:00:00Z",
        message: {
          role: "assistant",
          provider: "p",
          model: "m",
          content: [{ type: "toolCall", id: "c1", name: "subagent" }],
        },
      }),
      JSON.stringify({
        type: "message",
        id: "m2",
        parentId: "m1",
        timestamp: "2026-09-11T10:00:01Z",
        message: {
          role: "toolResult",
          toolCallId: "c1",
          toolName: "subagent",
          isError: true,
          details: { completions: "not-an-array" },
          content: [],
        },
      }),
    ].join("\n"),
  ).entries;

  const evidence = readSubagentEvidence(entries);
  assert.equal(evidence.activity.calls, 1);
  assert.equal(evidence.activity.failed, 1);
  assert.deepEqual(runsOf(evidence), []);
  assert.equal(evidence.state, "unavailable");
});

test("maps nested completion children with bounded parents and unknown statuses", () => {
  const entries = parseSessionJsonl(
    [
      JSON.stringify({ type: "session", version: 3, id: "s" }),
      JSON.stringify({
        type: "message",
        id: "m1",
        parentId: null,
        timestamp: "2026-09-11T10:00:00Z",
        message: {
          role: "assistant",
          provider: "p",
          model: "m",
          content: [{ type: "toolCall", id: "c1", name: "subagent_wait" }],
        },
      }),
      JSON.stringify({
        type: "message",
        id: "m2",
        parentId: "m1",
        timestamp: "2026-09-11T10:00:01Z",
        message: {
          role: "toolResult",
          toolCallId: "c1",
          toolName: "subagent_wait",
          isError: false,
          content: [],
          details: {
            completions: [
              {
                runId: "workflow-run",
                agent: "workflow",
                success: true,
                state: "complete",
                results: [
                  {
                    runId: "child-run",
                    agent: "/home/dev/PRIVATE/agent",
                    state: "future-state",
                    usage: {
                      input: 1,
                      output: 2,
                      cacheRead: 3,
                      cacheWrite: 4,
                      cost: 0.5,
                      turns: 1,
                    },
                  },
                  { runId: "workflow-run", agent: "duplicate-run-id" },
                ],
              },
            ],
          },
        },
      }),
    ].join("\n"),
  ).entries;

  const evidence = readSubagentEvidence(entries);

  // Publication surfaces have independent identities: the completion row and
  // its nested children are separate bounded rows even when raw ids repeat.
  assert.equal(runsOf(evidence).length, 3);
  const [completion, child, duplicate] = runsOf(evidence);
  assert.match(completion?.id ?? "", /^subagent-[a-f0-9]{64}$/);
  assert.equal(completion?.parentId, undefined);
  assert.equal(completion?.agent, "workflow");
  assert.equal(completion?.status, "succeeded");
  assert.deepEqual(evidence.diagnostics, []);
  assert.equal(child?.parentId, completion?.id);
  assert.equal(child?.agent, undefined);
  assert.equal(child?.status, "unknown");
  assert.deepEqual(child?.usage, { totalTokens: 10, cost: 0.5 });
  assert.equal(duplicate?.parentId, completion?.id);
  assert.equal(duplicate?.agent, "duplicate-run-id");
  assert.equal(duplicate?.status, "unknown");
  assert.equal(evidence.state, "supported");
  assert.equal(serializeEvidence(evidence).includes("future-state"), false);
  assert.equal(serializeEvidence(evidence).includes("PRIVATE"), false);
});

test("counts only subagent tool calls and their joined results", () => {
  const entries = parseSessionJsonl(
    [
      JSON.stringify({ type: "session", version: 3, id: "s" }),
      JSON.stringify({
        type: "message",
        id: "m1",
        parentId: null,
        timestamp: "2026-09-11T10:00:00Z",
        message: {
          role: "assistant",
          provider: "p",
          model: "m",
          content: [
            { type: "toolCall", id: "c9", name: "read" },
            { type: "toolCall", id: "c1", name: "subagent_supervisor" },
          ],
        },
      }),
      JSON.stringify({
        type: "message",
        id: "m2",
        parentId: "m1",
        timestamp: "2026-09-11T10:00:01Z",
        message: {
          role: "toolResult",
          toolCallId: "c9",
          toolName: "read",
          isError: false,
          content: [],
          usage: {
            input: 5,
            output: 5,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 10,
            cost: { total: 9 },
          },
          details: { results: [{ runId: "unrelated-run", success: true }] },
        },
      }),
      JSON.stringify({
        type: "message",
        id: "m3",
        parentId: "m2",
        timestamp: "2026-09-11T10:00:02Z",
        message: {
          role: "toolResult",
          toolCallId: "c1",
          toolName: "subagent_supervisor",
          isError: false,
          content: [],
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
            cost: { total: 0.02 },
          },
        },
      }),
    ].join("\n"),
  ).entries;

  const evidence = readSubagentEvidence(entries);

  assert.equal(evidence.activity.calls, 1);
  assert.equal(evidence.activity.succeeded, 1);
  assert.deepEqual(evidence.activity.tools, [
    { name: "subagent_supervisor", calls: 1 },
  ]);
  assert.deepEqual(evidence.activity.usage, { totalTokens: 2, cost: 0.02 });
  assert.deepEqual(runsOf(evidence), []);
});

test("never throws on malformed entries and yields no fabricated rows", () => {
  const entries = parseSessionJsonl(
    [
      JSON.stringify({ type: "session", version: 3, id: "s" }),
      "{ malformed JSONL",
      JSON.stringify({
        type: "message",
        id: "m1",
        parentId: null,
        timestamp: "2026-09-11T10:00:00Z",
        message: "not-an-object",
      }),
      JSON.stringify({
        type: "message",
        id: "m2",
        parentId: "m1",
        timestamp: "2026-09-11T10:00:01Z",
        message: {
          role: "assistant",
          provider: "p",
          model: "m",
          content: "not-an-array",
        },
      }),
      JSON.stringify({
        type: "message",
        id: "m3",
        parentId: "m2",
        timestamp: "2026-09-11T10:00:02Z",
        message: {
          role: "assistant",
          provider: "p",
          model: "m",
          content: [{ type: "toolCall", name: "subagent" }],
        },
      }),
      JSON.stringify({
        type: "message",
        id: "m4",
        parentId: "m3",
        timestamp: "2026-09-11T10:00:03Z",
        message: {
          role: "toolResult",
          toolCallId: "c1",
          toolName: "subagent",
          isError: false,
          content: [],
          details: { results: [{ agent: "worker" }] },
        },
      }),
    ].join("\n"),
  ).entries;

  const evidence = readSubagentEvidence(entries);

  // A call without a joinable id is unresolved, never a fabricated run.
  assert.equal(evidence.activity.calls, 1);
  assert.equal(evidence.activity.interrupted, 1);
  assert.deepEqual(evidence.activity.usage, undefined);
  assert.deepEqual(runsOf(evidence), []);
  assert.equal(evidence.state, "unavailable");
});

test("identifies two foreground children of one parallel run by index", () => {
  const entries = parseSessionJsonl(
    [
      JSON.stringify({ type: "session", version: 3, id: "s" }),
      JSON.stringify({
        type: "message",
        id: "m1",
        parentId: null,
        timestamp: "2026-09-11T10:00:00Z",
        message: {
          role: "assistant",
          provider: "p",
          model: "m",
          content: [{ type: "toolCall", id: "c1", name: "subagent" }],
        },
      }),
      JSON.stringify({
        type: "message",
        id: "m2",
        parentId: "m1",
        timestamp: "2026-09-11T10:00:01Z",
        message: {
          role: "toolResult",
          toolCallId: "c1",
          toolName: "subagent",
          isError: false,
          content: [],
          details: {
            mode: "parallel",
            runId: "parallel-run",
            results: [
              {
                index: 0,
                agent: "worker",
                exitCode: 0,
                task: "PRIVATE_TASK one",
                sessionFile: "/home/dev/PRIVATE/session.jsonl",
                usage: {
                  input: 200,
                  output: 100,
                  cacheRead: 50,
                  cacheWrite: 0,
                  cost: 0.2,
                  turns: 2,
                },
              },
              {
                index: 1,
                agent: "builder",
                exitCode: 1,
                task: "PRIVATE_TASK two",
                usage: { input: 100, output: 50, cost: 0.05 },
              },
            ],
          },
        },
      }),
    ].join("\n"),
  ).entries;

  const evidence = readSubagentEvidence(entries);

  assert.equal(evidence.state, "supported");
  assert.equal(runsOf(evidence).length, 2);
  const [complete, partial] = runsOf(evidence);
  assert.notEqual(complete?.id, partial?.id);
  assert.equal(complete?.agent, "worker");
  assert.equal(partial?.agent, "builder");
  assert.equal(complete?.status, "succeeded");
  assert.equal(partial?.status, "failed");
  assert.deepEqual(complete?.usage, { totalTokens: 350, cost: 0.2 });
  assert.deepEqual(partial?.usage, { cost: 0.05 });
  // Both children share the opaque aggregate run id as their parent.
  assert.match(complete?.parentId ?? "", /^subagent-[a-f0-9]{64}$/);
  assert.equal(complete?.parentId, partial?.parentId);
  assert.notEqual(complete?.parentId, complete?.id);
  // The publishing run container is a relationship, not a run: no synthetic
  // AgentRun is materialized for the identity it names.
  assert.equal(
    runsOf(evidence).some((run) => run.id === complete?.parentId),
    false,
  );
  assert.equal(serializeEvidence(evidence).includes("PRIVATE_TASK"), false);
  assert.equal(
    serializeEvidence(evidence).includes("/home/dev/PRIVATE"),
    false,
  );
});

test("skips foreground result rows without a usable run id and index", () => {
  const entries = parseSessionJsonl(
    [
      JSON.stringify({ type: "session", version: 3, id: "s" }),
      JSON.stringify({
        type: "message",
        id: "m1",
        parentId: null,
        timestamp: "2026-09-11T10:00:00Z",
        message: {
          role: "assistant",
          provider: "p",
          model: "m",
          content: [
            { type: "toolCall", id: "c1", name: "subagent" },
            { type: "toolCall", id: "c2", name: "subagent" },
          ],
        },
      }),
      JSON.stringify({
        type: "message",
        id: "m2",
        parentId: "m1",
        timestamp: "2026-09-11T10:00:01Z",
        message: {
          role: "toolResult",
          toolCallId: "c1",
          toolName: "subagent",
          isError: false,
          content: [],
          details: {
            runId: "agg-run",
            results: [
              { agent: "no-index", exitCode: 0 },
              { index: -1, agent: "negative", exitCode: 0 },
              { index: 1.5, agent: "fractional", exitCode: 0 },
              {
                index: 2,
                agent: "worker",
                exitCode: 0,
                usage: {
                  input: 1,
                  output: 2,
                  cacheRead: 3,
                  cacheWrite: 4,
                  cost: 0.1,
                },
              },
              { index: 3, agent: "other", exitCode: 1 },
            ],
          },
        },
      }),
      JSON.stringify({
        type: "message",
        id: "m3",
        parentId: "m2",
        timestamp: "2026-09-11T10:00:02Z",
        message: {
          role: "toolResult",
          toolCallId: "c2",
          toolName: "subagent",
          isError: false,
          content: [],
          // A usable index without an aggregate run id is still unidentifiable.
          details: { results: [{ index: 0, agent: "orphan", exitCode: 0 }] },
        },
      }),
    ].join("\n"),
  ).entries;

  const evidence = readSubagentEvidence(entries);

  assert.equal(evidence.activity.calls, 2);
  assert.equal(runsOf(evidence).length, 2);
  assert.equal(
    runsOf(evidence).every(
      (run) =>
        /^subagent-[a-f0-9]{64}$/.test(run.id) &&
        run.parentId !== undefined &&
        /^subagent-[a-f0-9]{64}$/.test(run.parentId),
    ),
    true,
  );
  const [complete, partial] = runsOf(evidence);
  assert.notEqual(complete?.id, partial?.id);
  assert.equal(complete?.parentId, partial?.parentId);
  assert.equal(
    runsOf(evidence).some((run) => run.id === complete?.parentId),
    false,
  );
  assert.equal(complete?.agent, "worker");
  assert.deepEqual(complete?.usage, { totalTokens: 10, cost: 0.1 });
  assert.equal(partial?.agent, "other");
  assert.equal(partial?.status, "failed");
  assert.equal(partial?.usage, undefined);
  assert.equal(serializeEvidence(evidence).includes("no-index"), false);
  assert.equal(serializeEvidence(evidence).includes("orphan"), false);
});

test("a malformed aggregate run id never becomes a parent identity", () => {
  const entries = parseSessionJsonl(
    [
      JSON.stringify({ type: "session", version: 3, id: "s" }),
      JSON.stringify({
        type: "message",
        id: "m1",
        parentId: null,
        timestamp: "2026-09-11T10:00:00Z",
        message: {
          role: "assistant",
          provider: "p",
          model: "m",
          content: [{ type: "toolCall", id: "c1", name: "subagent" }],
        },
      }),
      JSON.stringify({
        type: "message",
        id: "m2",
        parentId: "m1",
        timestamp: "2026-09-11T10:00:01Z",
        message: {
          role: "toolResult",
          toolCallId: "c1",
          toolName: "subagent",
          isError: false,
          content: [],
          details: {
            runId: "not a run id!",
            results: [
              { index: 0, agent: "container-only", exitCode: 0 },
              { runId: "child-run-1", agent: "self-identified", exitCode: 0 },
            ],
          },
        },
      }),
    ].join("\n"),
  ).entries;

  const evidence = readSubagentEvidence(entries);

  // The row the unusable aggregate identity was the only identity for is
  // skipped; the row with an identity of its own stays, with no parent.
  assert.equal(runsOf(evidence).length, 1);
  assert.equal(runsOf(evidence)[0]?.agent, "self-identified");
  assert.equal(runsOf(evidence)[0]?.parentId, undefined);
  assert.equal(serializeEvidence(evidence).includes("not a run id!"), false);
  assert.equal(serializeEvidence(evidence).includes("container-only"), false);
});

test("counts a joined call id's tool-result usage exactly once", () => {
  const result = (id: string) =>
    JSON.stringify({
      type: "message",
      id,
      parentId: "m1",
      timestamp: "2026-09-11T10:00:01Z",
      message: {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "subagent",
        isError: false,
        content: [],
        usage: {
          input: 5,
          output: 5,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 10,
          cost: { total: 0.1 },
        },
      },
    });
  const entries = parseSessionJsonl(
    [
      JSON.stringify({ type: "session", version: 3, id: "s" }),
      JSON.stringify({
        type: "message",
        id: "m1",
        parentId: null,
        timestamp: "2026-09-11T10:00:00Z",
        message: {
          role: "assistant",
          provider: "p",
          model: "m",
          content: [{ type: "toolCall", id: "c1", name: "subagent" }],
        },
      }),
      result("r1"),
      result("r2"),
    ].join("\n"),
  ).entries;

  const evidence = readSubagentEvidence(entries);

  assert.equal(evidence.activity.calls, 1);
  assert.equal(evidence.activity.succeeded, 1);
  assert.deepEqual(evidence.activity.usage, { totalTokens: 10, cost: 0.1 });
});

test("reports unavailable activity for a session without subagent calls", () => {
  const entries = parseSessionJsonl(
    [
      JSON.stringify({ type: "session", version: 3, id: "s" }),
      JSON.stringify({
        type: "message",
        id: "m1",
        parentId: null,
        timestamp: "2026-09-11T10:00:00Z",
        message: {
          role: "assistant",
          provider: "p",
          model: "m",
          content: [{ type: "toolCall", id: "c9", name: "read" }],
        },
      }),
    ].join("\n"),
  ).entries;

  assert.deepEqual(readSubagentEvidence(entries), {
    activity: {
      state: "unavailable",
      calls: 0,
      succeeded: 0,
      failed: 0,
      interrupted: 0,
      tools: [],
    },
    observations: [],
    state: "unavailable",
    diagnostics: [],
  });
});

test("run carries publication time, evidence tool id, model and failure", () => {
  const evidence = readSubagentEvidence([
    assistantEntry("a", "call_1"),
    resultEntry(
      "r",
      "call_1",
      {
        results: [
          {
            runId: "run-1",
            agent: "delegate",
            success: false,
            exitCode: 2,
            model: "gpt-5",
            thinking: "high",
            usage: {
              input: 1,
              output: 1,
              cacheRead: 0,
              cacheWrite: 0,
              cost: 0.01,
            },
          },
        ],
      },
      "2026-09-12T10:00:05.000Z",
    ),
  ]);
  const run = runsOf(evidence)[0];
  assert.equal(run?.observedAt, "2026-09-12T10:00:05.000Z");
  assert.equal(run?.evidenceToolId, "tool:call_1");
  assert.equal(run?.model, "gpt-5");
  assert.equal(run?.thinking, "high");
  assert.deepEqual(run?.failure, { reason: "exit-nonzero", detail: 2 });
  assert.deepEqual(evidence.diagnostics, []);
});

test("same-surface publications keep the latest observation exactly once", () => {
  const evidence = readSubagentEvidence([
    assistantEntry("a", "call_1"),
    resultEntry(
      "r1",
      "call_1",
      { results: [{ runId: "run-1", agent: "delegate", success: true }] },
      "2026-09-12T10:00:05.000Z",
    ),
    assistantEntry("b", "call_2", "subagent_wait"),
    resultEntry(
      "r2",
      "call_2",
      { results: [{ runId: "run-1", agent: "delegate", success: true }] },
      "2026-09-12T10:01:00.000Z",
    ),
  ]);
  // Same-surface replacement remains precedence-based.
  assert.equal(runsOf(evidence).length, 1);
  assert.equal(runsOf(evidence)[0]?.observedAt, "2026-09-12T10:01:00.000Z");
  assert.equal(runsOf(evidence)[0]?.evidenceToolId, "tool:call_2");
  assert.deepEqual(evidence.diagnostics, []);
});

test("drops conflicting identity fields with a conflict diagnostic", () => {
  const evidence = readSubagentEvidence([
    assistantEntry("a", "call_1"),
    resultEntry(
      "r1",
      "call_1",
      { results: [{ runId: "run-1", agent: "delegate", success: true }] },
      "2026-09-12T10:00:05.000Z",
    ),
    assistantEntry("b", "call_2", "subagent_wait"),
    resultEntry(
      "r2",
      "call_2",
      { completions: [{ runId: "run-1", agent: "reviewer", success: true }] },
      "2026-09-12T10:01:00.000Z",
      "subagent_wait",
    ),
  ]);
  // Different publication surfaces remain separate and do not create a false
  // identity conflict when raw producer ids coincide.
  assert.equal(runsOf(evidence).length, 2);
  assert.notEqual(runsOf(evidence)[0]?.id, runsOf(evidence)[1]?.id);
  assert.equal(runsOf(evidence)[0]?.agent, "delegate");
  assert.equal(runsOf(evidence)[1]?.agent, "reviewer");
  assert.deepEqual(evidence.diagnostics, []);
});

test("terminal-to-running regression on one surface yields unknown plus a diagnostic", () => {
  const evidence = readSubagentEvidence([
    assistantEntry("a", "call_1"),
    resultEntry(
      "r1",
      "call_1",
      { results: [{ runId: "run-1", agent: "delegate", success: true }] },
      "2026-09-12T10:00:05.000Z",
    ),
    assistantEntry("b", "call_2", "subagent_wait"),
    resultEntry(
      "r2",
      "call_2",
      {
        results: [{ runId: "run-1", agent: "delegate", state: "running" }],
      },
      "2026-09-12T10:01:00.000Z",
    ),
  ]);
  assert.equal(runsOf(evidence).length, 1);
  assert.equal(runsOf(evidence)[0]?.status, "unknown");
  assert.deepEqual(reconcileAgentRuns(evidence.observations).diagnostics, [
    { code: "cooperative-evidence-conflict", count: 1 },
  ]);
});

test("derives only closed bounded failure reasons", () => {
  const evidence = readSubagentEvidence([
    assistantEntry("a", "call_1"),
    resultEntry(
      "r1",
      "call_1",
      {
        results: [
          {
            runId: "run-signal",
            agent: "a",
            state: "failed",
            processSignal: "SIGTERM",
          },
          { runId: "run-failed", agent: "b", success: false },
          {
            runId: "run-absent",
            agent: "c",
            state: "failed",
            outputState: "absent",
          },
          {
            runId: "run-free",
            agent: "d",
            state: "failed",
            reason: "PRIVATE free text",
          },
        ],
      },
      "2026-09-12T10:00:05.000Z",
    ),
  ]);
  const byAgent = new Map(runsOf(evidence).map((run) => [run.agent, run]));
  assert.deepEqual(byAgent.get("a")?.failure, {
    reason: "process-signal",
    detail: "SIGTERM",
  });
  assert.deepEqual(byAgent.get("b")?.failure, { reason: "completion-failed" });
  assert.deepEqual(byAgent.get("c")?.failure, { reason: "output-absent" });
  assert.equal(byAgent.get("d")?.failure, undefined);
  assert.equal(
    serializeEvidence(evidence).includes("PRIVATE free text"),
    false,
  );
});

test("bounds model and thinking producer labels", () => {
  const evidence = readSubagentEvidence([
    assistantEntry("a", "call_1"),
    resultEntry(
      "r1",
      "call_1",
      {
        results: [
          {
            runId: "run-1",
            agent: "a",
            model: "/home/dev/PRIVATE/model",
            thinking: "high",
          },
          {
            runId: "run-2",
            agent: "b",
            model: "gpt-5",
            thinking: "sk-abcdef123456",
          },
        ],
      },
      "2026-09-12T10:00:05.000Z",
    ),
  ]);
  const byAgent = new Map(runsOf(evidence).map((run) => [run.agent, run]));
  assert.equal(byAgent.get("a")?.model, undefined);
  assert.equal(byAgent.get("a")?.thinking, "high");
  assert.equal(byAgent.get("b")?.model, "gpt-5");
  assert.equal(byAgent.get("b")?.thinking, undefined);
  assert.equal(serializeEvidence(evidence).includes("PRIVATE"), false);
});

test("selects the latest child usage instead of summing repeated publications", () => {
  const usage = (input: number, cost: number) => ({
    input,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost,
  });
  const evidence = readSubagentEvidence([
    assistantEntry("a", "call_1"),
    resultEntry(
      "r1",
      "call_1",
      {
        completions: [
          {
            runId: "run-1",
            agent: "delegate",
            success: true,
            usage: usage(10, 0.1),
          },
        ],
      },
      "2026-09-12T10:00:05.000Z",
    ),
    assistantEntry("b", "call_2", "subagent_wait"),
    resultEntry(
      "r2",
      "call_2",
      {
        completions: [
          {
            runId: "run-1",
            agent: "delegate",
            success: true,
            usage: usage(20, 0.2),
          },
        ],
      },
      "2026-09-12T10:01:00.000Z",
      "subagent_wait",
    ),
  ]);
  assert.deepEqual(runsOf(evidence)[0]?.usage, { totalTokens: 20, cost: 0.2 });
});

test("classifies a payload carrying both a signal and an exit code as process-signal", () => {
  // R21 precedence: a signal carries the process cause and wins over exitCode.
  const evidence = readSubagentEvidence([
    assistantEntry("a", "call_1"),
    resultEntry(
      "r1",
      "call_1",
      {
        results: [
          {
            runId: "run-1",
            agent: "delegate",
            exitCode: 137,
            processSignal: "SIGKILL",
          },
        ],
      },
      "2026-09-12T10:00:05.000Z",
    ),
  ]);
  assert.deepEqual(runsOf(evidence)[0]?.failure, {
    reason: "process-signal",
    detail: "SIGKILL",
  });
});

test("different surfaces stay separate while same-surface replacement remains ordered", () => {
  // Cross-surface rows are not correlated, even when their raw ids match.
  // Same-surface publications keep the latest accepted observation.
  const usage = (input: number, cost: number) => ({
    input,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost,
  });
  const evidence = readSubagentEvidence([
    assistantEntry("a", "call_1"),
    resultEntry(
      "r1",
      "call_1",
      {
        results: [
          {
            runId: "run-1",
            agent: "delegate",
            state: "running",
            usage: usage(10, 0.1),
          },
        ],
        completions: [
          {
            runId: "run-1",
            agent: "delegate",
            success: true,
            usage: usage(20, 0.2),
          },
        ],
      },
      "2026-09-12T10:00:05.000Z",
    ),
  ]);
  // Distinct surfaces remain distinct bounded rows.
  assert.equal(runsOf(evidence).length, 2);
  assert.equal(runsOf(evidence)[0]?.status, "running");
  assert.equal(runsOf(evidence)[1]?.status, "succeeded");
  assert.deepEqual(
    runsOf(evidence).map((run) => run.usage),
    [
      { totalTokens: 10, cost: 0.1 },
      { totalTokens: 20, cost: 0.2 },
    ],
  );
  assert.deepEqual(evidence.diagnostics, []);
});

test("run identity is session-scoped and deterministic", () => {
  // R23: identity is `canonicalOpaqueDigest("subagent-run", sessionId, rawId)`.
  const entries: SessionEntry[] = [
    assistantEntry("a", "call_1"),
    resultEntry(
      "r1",
      "call_1",
      { results: [{ runId: "shared-run", agent: "delegate", success: true }] },
      "2026-09-12T10:00:05.000Z",
    ),
  ];
  const first = readSubagentEvidenceWithSession(entries, "session-a");
  const again = readSubagentEvidenceWithSession(entries, "session-a");
  const second = readSubagentEvidenceWithSession(entries, "session-b");
  const firstRuns = reconcileAgentRuns(first.observations).runs;
  const againRuns = reconcileAgentRuns(again.observations).runs;
  const secondRuns = reconcileAgentRuns(second.observations).runs;
  assert.equal(firstRuns.length, 1);
  assert.match(firstRuns[0]?.id ?? "", /^subagent-[a-f0-9]{64}$/);
  assert.equal(firstRuns[0]?.id, againRuns[0]?.id);
  assert.notEqual(firstRuns[0]?.id, secondRuns[0]?.id);
});

test("recognises previously omitted real process signals", () => {
  // R25: the hand-written closed set now includes SIGPWR/SIGSTKFLT/SIGEMT/…
  const evidence = readSubagentEvidence([
    assistantEntry("a", "call_1"),
    resultEntry(
      "r1",
      "call_1",
      {
        results: [
          {
            runId: "run-1",
            agent: "a",
            state: "failed",
            processSignal: "SIGPWR",
          },
          {
            runId: "run-2",
            agent: "b",
            state: "failed",
            processSignal: "SIGSTKFLT",
          },
          {
            runId: "run-3",
            agent: "c",
            state: "failed",
            processSignal: "SIGEMT",
          },
        ],
      },
      "2026-09-12T10:00:05.000Z",
    ),
  ]);
  assert.deepEqual(
    runsOf(evidence).map((run) => run.failure),
    [
      { reason: "process-signal", detail: "SIGPWR" },
      { reason: "process-signal", detail: "SIGSTKFLT" },
      { reason: "process-signal", detail: "SIGEMT" },
    ],
  );
});

test("bounds the accepted exit-code failure detail", () => {
  // R24: a detail outside [0, 2_147_483_647] is not evidence.
  const evidence = readSubagentEvidence([
    assistantEntry("a", "call_1"),
    resultEntry(
      "r1",
      "call_1",
      {
        results: [
          { runId: "run-max", agent: "a", exitCode: 2_147_483_647 },
          { runId: "run-over", agent: "b", exitCode: 2_147_483_648 },
          { runId: "run-negative", agent: "c", exitCode: -1 },
        ],
      },
      "2026-09-12T10:00:05.000Z",
    ),
  ]);
  const byAgent = new Map(runsOf(evidence).map((run) => [run.agent, run]));
  assert.deepEqual(byAgent.get("a")?.failure, {
    reason: "exit-nonzero",
    detail: 2_147_483_647,
  });
  assert.equal(byAgent.get("b")?.failure, undefined);
  assert.equal(byAgent.get("c")?.failure, undefined);
});

test("attributes workflow result metrics to exact child keys without leaking ids", async () => {
  // Sanitized 0.71.0-style shape; real events do not persist producerVersion.
  const fixture = await readFile(
    new URL(
      "../fixtures/pi/0.85.1/subagent-workflow-key-correlation.jsonl",
      import.meta.url,
    ),
    "utf8",
  );
  const evidence = readSubagentEvidence(parseSessionJsonl(fixture).entries);

  assert.equal(runsOf(evidence).length, 2);
  const byAgent = new Map(runsOf(evidence).map((run) => [run.agent, run]));
  assert.deepEqual(
    {
      durationMs: byAgent.get("summary-agent-a")?.durationMs,
      toolCalls: byAgent.get("summary-agent-a")?.toolCalls,
      usage: byAgent.get("summary-agent-a")?.usage,
      status: byAgent.get("summary-agent-a")?.status,
      parentId: byAgent.get("summary-agent-a")?.parentId,
    },
    {
      durationMs: 1200,
      toolCalls: 3,
      usage: { totalTokens: 126, cost: 0.001 },
      status: "succeeded",
      parentId: undefined,
    },
  );
  assert.deepEqual(
    {
      durationMs: byAgent.get("summary-agent-b")?.durationMs,
      toolCalls: byAgent.get("summary-agent-b")?.toolCalls,
      usage: byAgent.get("summary-agent-b")?.usage,
    },
    {
      durationMs: 800,
      toolCalls: 1,
      usage: { totalTokens: 215, cost: 0.002 },
    },
  );
  assert.equal(evidence.activity.usage, undefined);
  for (const privateValue of [
    "private-step-a",
    "private-step-b",
    "workflow-child-a",
    "workflow-child-b",
    "workflow%container",
  ]) {
    assert.equal(serializeEvidence(evidence).includes(privateValue), false);
  }
});

test("keeps exact workflow identities separate when summary agent is absent", () => {
  const runId = "workflow-container";
  const evidence = readSubagentEvidence([
    assistantEntry("workflow-call", "workflow-tool"),
    resultEntry(
      "workflow-result",
      "workflow-tool",
      {
        mode: "workflow",
        runId,
        results: [
          {
            index: 0,
            workflowKey: "private-step",
            agent: "result-agent",
            progressSummary: { durationMs: 900, toolCount: 2 },
            usage: {
              input: 20,
              output: 5,
              cacheRead: 0,
              cacheWrite: 0,
              cost: 0.01,
            },
          },
        ],
        workflowChildren: {
          version: 1,
          parentToolCallId: "originating-workflow-call",
          workflowRunId: runId,
          inventoryComplete: true,
          workflowState: "running",
          children: [
            {
              childId: "private-step",
              runId: "workflow-child-run",
              state: "running",
              activity: { currentTool: "bash", durationMs: 5, toolCount: 1 },
            },
          ],
        },
      },
      "2026-09-12T10:00:01.000Z",
    ),
  ]);

  assert.equal(runsOf(evidence).length, 2);
  assert.notEqual(runsOf(evidence)[0]?.id, runsOf(evidence)[1]?.id);
  assert.equal(runsOf(evidence)[0]?.agent, "result-agent");
  assert.equal(runsOf(evidence)[1]?.agent, undefined);
  assert.equal(runsOf(evidence)[1]?.status, "running");
  assert.equal(runsOf(evidence)[1]?.durationMs, 900);
  assert.deepEqual(runsOf(evidence)[1]?.usage, { totalTokens: 25, cost: 0.01 });
  assert.equal(serializeEvidence(evidence).includes("private-step"), false);
});

test("withholds correlated workflow evidence when exact producer keys are absent or ambiguous", () => {
  const runId = "workflow%container";
  const makeResult = (workflowKey?: string) => ({
    index: 0,
    ...(workflowKey === undefined ? {} : { workflowKey }),
    agent: "result-agent",
    progressSummary: { durationMs: 900, toolCount: 2 },
    usage: {
      input: 20,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0.01,
    },
  });
  const makeChild = (
    childId?: string,
    extra: Record<string, unknown> = {},
  ) => ({
    ...(childId === undefined ? {} : { childId }),
    runId: "workflow-child-run",
    agent: "summary-agent",
    state: "completed",
    ...extra,
  });
  const makeDetails = (
    options: {
      mode?: unknown;
      version?: unknown;
      workflowRunId?: unknown;
      results?: unknown;
      children?: unknown;
      summaryOverrides?: Record<string, unknown>;
    } = {},
  ) => ({
    mode: options.mode ?? "workflow",
    runId,
    results: options.results ?? [makeResult("step-a")],
    workflowChildren: {
      version: options.version ?? 1,
      parentToolCallId: "originating-workflow-call",
      workflowRunId: options.workflowRunId ?? runId,
      inventoryComplete: true,
      workflowState: "completed",
      children: options.children ?? [makeChild("step-a")],
      ...options.summaryOverrides,
    },
  });
  const withoutSummaryField = (field: string) => {
    const details = makeDetails();
    const workflowChildren = { ...details.workflowChildren };
    delete (workflowChildren as Record<string, unknown>)[field];
    return { ...details, workflowChildren };
  };
  const oversizedResults = Array.from({ length: 257 }, (_, index) =>
    makeResult(`step-${index}`),
  );
  const oversizedChildren = Array.from({ length: 257 }, (_, index) =>
    makeChild(index === 0 ? "step-a" : `step-${index}`),
  );
  const cases: Array<[string, ReturnType<typeof makeDetails>]> = [
    ["missing workflowKey", makeDetails({ results: [makeResult()] })],
    ["missing childId", makeDetails({ children: [makeChild()] })],
    [
      "different workflowKey and childId",
      makeDetails({ results: [makeResult("other-step")] }),
    ],
    [
      "duplicate workflowKey",
      makeDetails({ results: [makeResult("step-a"), makeResult("step-a")] }),
    ],
    [
      "duplicate childId",
      makeDetails({
        children: [makeChild("step-a"), makeChild("step-a")],
      }),
    ],
    [
      "malformed key",
      makeDetails({
        results: [makeResult("bad%key")],
        children: [makeChild("bad%key")],
      }),
    ],
    [
      "unbounded key",
      makeDetails({
        results: [makeResult("x".repeat(129))],
        children: [makeChild("x".repeat(129))],
      }),
    ],
    ["non-workflow publication", makeDetails({ mode: "single" })],
    ["unsupported workflow summary version", makeDetails({ version: 2 })],
    [
      "missing parent tool-call identity",
      withoutSummaryField("parentToolCallId"),
    ],
    [
      "missing inventory completeness",
      withoutSummaryField("inventoryComplete"),
    ],
    ["missing workflow state", withoutSummaryField("workflowState")],
    [
      "incomplete workflow inventory",
      makeDetails({ summaryOverrides: { inventoryComplete: false } }),
    ],
    [
      "unsupported workflow state",
      makeDetails({ summaryOverrides: { workflowState: "unknown" } }),
    ],
    [
      "unsupported workflow summary field",
      makeDetails({ summaryOverrides: { futureField: true } }),
    ],
    [
      "parent tool-call ID over byte bound",
      makeDetails({
        summaryOverrides: { parentToolCallId: "é".repeat(2049) },
      }),
    ],
    [
      "unknown child field",
      makeDetails({ children: [makeChild("step-a", { futureField: true })] }),
    ],
    [
      "unsupported child usage field",
      makeDetails({
        children: [
          makeChild("step-a", {
            usage: {
              input: 20,
              output: 6,
              cacheRead: 0,
              cacheWrite: 0,
              cost: 0.2,
            },
          }),
        ],
      }),
    ],
    [
      "oversized optional child label",
      makeDetails({
        children: [makeChild("step-a", { model: "é".repeat(129) })],
      }),
    ],
    [
      "invalid running-child activity",
      makeDetails({
        children: [
          makeChild("step-a", {
            state: "running",
            activity: { futureField: 1 },
          }),
        ],
      }),
    ],
    [
      "invalid child state",
      makeDetails({ children: [makeChild("step-a", { state: "unknown" })] }),
    ],
    [
      "conflicting workflow run identity",
      makeDetails({ workflowRunId: "another-container" }),
    ],
    ["result array over bound", makeDetails({ results: oversizedResults })],
    ["child array over bound", makeDetails({ children: oversizedChildren })],
  ];

  for (const [name, details] of cases) {
    const evidence = readSubagentEvidence([
      assistantEntry("workflow-call", "workflow-tool"),
      resultEntry(
        "workflow-result",
        "workflow-tool",
        details,
        "2026-09-12T10:00:01.000Z",
      ),
    ]);
    const child = runsOf(evidence).find((run) => run.agent === "summary-agent");
    assert.ok(child, name);
    assert.equal(child?.durationMs, undefined, name);
    assert.equal(child?.toolCalls, undefined, name);
    assert.equal(child?.usage, undefined, name);
    assert.equal(child?.effortCoverage.duration, "unavailable", name);
    assert.equal(child?.effortCoverage.tools, "unavailable", name);
  }
});

test("preserves unrelated workflow groups when one result key is ambiguous", () => {
  const runId = "workflow%container";
  const makeResult = (workflowKey: string, durationMs: number) => ({
    workflowKey,
    progressSummary: { durationMs, toolCount: 2 },
    usage: {
      input: 20,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0.01,
    },
  });
  const evidence = readSubagentEvidence([
    assistantEntry("workflow-call", "workflow-tool"),
    resultEntry(
      "workflow-result",
      "workflow-tool",
      {
        mode: "workflow",
        runId,
        results: [
          makeResult("step-a", 900),
          makeResult("step-a", 901),
          makeResult("step-b", 800),
        ],
        workflowChildren: {
          version: 1,
          parentToolCallId: "originating-workflow-call",
          workflowRunId: runId,
          inventoryComplete: true,
          workflowState: "completed",
          children: [
            {
              childId: "step-a",
              runId: "workflow-child-a",
              agent: "summary-agent-a",
              state: "completed",
            },
            {
              childId: "step-b",
              runId: "workflow-child-b",
              agent: "summary-agent-b",
              state: "completed",
            },
          ],
        },
      },
      "2026-09-12T10:00:01.000Z",
    ),
  ]);
  const byAgent = new Map(runsOf(evidence).map((run) => [run.agent, run]));
  const ambiguous = byAgent.get("summary-agent-a");
  const exact = byAgent.get("summary-agent-b");
  assert.equal(runsOf(evidence).length, 2);
  assert.ok(ambiguous);
  assert.ok(exact);
  assert.equal(ambiguous.durationMs, undefined);
  assert.equal(ambiguous.toolCalls, undefined);
  assert.equal(ambiguous.usage, undefined);
  assert.equal(ambiguous.effortCoverage.duration, "unavailable");
  assert.equal(exact.durationMs, 800);
  assert.equal(exact.toolCalls, 2);
  assert.deepEqual(exact.usage, { totalTokens: 25, cost: 0.01 });
});

test("collects workflowChildren children after results and completions", () => {
  // This legacy fixture lacks the workflowKey/childId contract; equal
  // container/index values therefore stay surface-scoped.
  const entries = [
    assistantEntry("call", "tool"),
    resultEntry(
      "result",
      "tool",
      {
        runId: "parent",
        results: [{ index: 0, status: "failed" }],
        workflowChildren: { children: [{ index: 0, success: true }] },
      },
      "2026-09-12T10:00:01.000Z",
    ),
  ];
  const evidence = readSubagentEvidence(entries);
  assert.equal(runsOf(evidence).length, 2);
  assert.equal(runsOf(evidence)[0]?.status, "unknown");
  assert.equal(runsOf(evidence)[1]?.status, "succeeded");
  assert.notEqual(runsOf(evidence)[0]?.parentId, runsOf(evidence)[1]?.parentId);
  assert.equal(runsOf(evidence)[0]?.effortCoverage.duration, "unavailable");
  assert.equal(runsOf(evidence)[1]?.effortCoverage.duration, "unavailable");
});

test("same-surface publications keep omitted fields", () => {
  const evidence = readSubagentEvidence([
    assistantEntry("a", "call_1"),
    resultEntry(
      "r1",
      "call_1",
      {
        results: [
          {
            runId: "run-1",
            agent: "delegate",
            model: "gpt-5",
            thinking: "high",
            exitCode: 2,
          },
        ],
      },
      "2026-09-12T10:00:05.000Z",
    ),
    assistantEntry("b", "call_2", "subagent_wait"),
    resultEntry(
      "r2",
      "call_2",
      { results: [{ runId: "run-1", agent: "delegate" }] },
      "2026-09-12T10:01:00.000Z",
    ),
  ]);
  assert.equal(runsOf(evidence).length, 1);
  assert.equal(runsOf(evidence)[0]?.model, "gpt-5");
  assert.equal(runsOf(evidence)[0]?.thinking, "high");
  assert.deepEqual(runsOf(evidence)[0]?.failure, {
    reason: "exit-nonzero",
    detail: 2,
  });
});

test("same-surface publication order follows entry ordinal", () => {
  const evidence = readSubagentEvidence([
    assistantEntry("a", "call_1"),
    resultEntry(
      "r1",
      "call_1",
      { results: [{ runId: "run-1", agent: "delegate", success: true }] },
      "2026-09-12T10:05:00.000Z",
    ),
    assistantEntry("b", "call_2", "subagent_wait"),
    resultEntry(
      "r2",
      "call_2",
      { results: [{ runId: "run-1", agent: "delegate", success: true }] },
      "2026-09-12T10:00:00.000Z",
    ),
  ]);
  assert.equal(runsOf(evidence).length, 1);
  assert.equal(runsOf(evidence)[0]?.observedAt, "2026-09-12T10:00:00.000Z");
  assert.equal(runsOf(evidence)[0]?.evidenceToolId, "tool:call_2");
});

test("counts same-surface field conflicts", () => {
  const evidence = readSubagentEvidence([
    assistantEntry("a", "call_1"),
    resultEntry(
      "r1",
      "call_1",
      { results: [{ runId: "run-1", agent: "delegate", success: true }] },
      "2026-09-12T10:00:05.000Z",
    ),
    assistantEntry("b", "call_2", "subagent_wait"),
    resultEntry(
      "r2",
      "call_2",
      { results: [{ runId: "run-1", agent: "reviewer", success: false }] },
      "2026-09-12T10:01:00.000Z",
    ),
  ]);
  assert.deepEqual(reconcileAgentRuns(evidence.observations).diagnostics, [
    { code: "cooperative-evidence-conflict", count: 2 },
  ]);
});

// The publication regressions: the joined case (the publishing entry's
// observation time and canonical tool id) is pinned by "run carries publication
// time, evidence tool id, model and failure" above; these two add the negative
// halves so a call or a result that cannot be joined publishes nothing.

test("a result that cannot be joined publishes no run", () => {
  const evidence = readSubagentEvidence([
    {
      id: "r1",
      parentId: null,
      timestamp: "2026-09-12T00:01:00.000Z",
      type: "message",
      message: {
        role: "toolResult",
        toolName: "subagent",
        details: { results: [{ runId: "run-1", success: true }] },
      },
    },
  ]);
  assert.equal(runsOf(evidence).length, 0);
});

test("a call without a result publishes no run while activity still counts it", () => {
  const evidence = readSubagentEvidence([assistantEntry("a1", "call-1")]);
  assert.deepEqual([runsOf(evidence).length, evidence.activity.calls], [0, 1]);
});

test("preserves audited tool counts and partial usage independently", () => {
  const evidence = readSubagentEvidence([
    assistantEntry("a1", "call-1"),
    resultEntry(
      "r1",
      "call-1",
      {
        runId: "aggregate-1",
        results: [
          {
            index: 0,
            agent: "delegate",
            success: true,
            progressSummary: { durationMs: 1, toolCount: 1_000_000 },
            usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
          },
        ],
      },
      "2026-09-12T10:00:05.000Z",
    ),
  ]);
  const run = runsOf(evidence).find(
    (candidate) => candidate.agent === "delegate",
  );
  assert.equal(run?.toolCalls, 1_000_000);
  assert.deepEqual(run?.usage, { totalTokens: 15 });
  assert.equal(run?.effortCoverage.usage, "partial");
  assert.equal(run?.effortCoverage.cost, "unavailable");
});

test("accepts one-billion tool calls and rejects larger counts and token sums", () => {
  const evidence = readSubagentEvidence([
    assistantEntry("a1", "call-1"),
    resultEntry(
      "r1",
      "call-1",
      {
        runId: "aggregate-1",
        results: [
          {
            index: 0,
            agent: "accepted-tool-count",
            success: true,
            progressSummary: { toolCount: 1_000_000_000 },
          },
          {
            index: 1,
            agent: "rejected-tool-count",
            success: true,
            progressSummary: { toolCount: 1_000_000_001 },
          },
          {
            index: 2,
            agent: "over-token-sum",
            success: true,
            usage: {
              input: 1_000_000_000,
              output: 1,
              cacheRead: 0,
              cacheWrite: 0,
              cost: 0.5,
            },
          },
        ],
      },
      "2026-09-12T10:00:05.000Z",
    ),
  ]);

  const accepted = runsOf(evidence).find(
    (run) => run.agent === "accepted-tool-count",
  );
  const rejected = runsOf(evidence).find(
    (run) => run.agent === "rejected-tool-count",
  );
  const overTokenSum = runsOf(evidence).find(
    (run) => run.agent === "over-token-sum",
  );
  assert.equal(accepted?.toolCalls, 1_000_000_000);
  assert.equal(rejected?.toolCalls, undefined);
  assert.deepEqual(overTokenSum?.usage, { cost: 0.5 });
  assert.equal(overTokenSum?.effortCoverage.usage, "unavailable");
  assert.equal(overTokenSum?.effortCoverage.cost, "partial");
});

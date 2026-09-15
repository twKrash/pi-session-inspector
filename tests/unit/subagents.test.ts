import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  readSubagentEvidence as readSubagentEvidenceWithSession,
  readSubagentEvidenceWithArchives as readSubagentEvidenceWithArchivesForSession,
} from "../../src/integrations/subagents.ts";
import type { SessionEntry } from "../../src/core/events.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";

/** A fixed session id: identity is session-scoped but tests only need determinism. */
const SESSION_ID = "session-test";
const readSubagentEvidence = (entries: readonly SessionEntry[]) =>
  readSubagentEvidenceWithSession(entries, SESSION_ID);
const readSubagentEvidenceWithArchives = (entries: readonly SessionEntry[]) =>
  readSubagentEvidenceWithArchivesForSession(entries, SESSION_ID);

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
): SessionEntry => ({
  id,
  parentId: null,
  timestamp,
  type: "message",
  message: {
    role: "toolResult",
    toolCallId: callId,
    toolName: "subagent",
    details,
  },
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
  assert.equal(evidence.runs.length, 2);
  assert.equal(
    evidence.runs.every((run) => /^subagent-[a-f0-9]{64}$/.test(run.id)),
    true,
  );
  assert.equal(JSON.stringify(evidence).includes("PRIVATE_TASK"), false);
  assert.equal(JSON.stringify(evidence).includes("run-raw-id"), false);
  assert.equal(JSON.stringify(evidence).includes("/home/dev/PRIVATE"), false);

  const completed = evidence.runs.find((run) => run.agent === "reviewer");
  assert.deepEqual(completed?.usage, { totalTokens: 700, cost: 0.1 });
  assert.equal(completed?.agent, "reviewer");

  // The persisted foreground `results[]` row: `exitCode: 1` maps to failed, a
  // partial usage group yields no usage, and the row is parented by its run.
  const foreground = evidence.runs.find((run) => run.agent === "worker");
  assert.ok(foreground);
  assert.equal(foreground.status, "failed");
  assert.equal(foreground.usage, undefined);
  assert.match(foreground.parentId ?? "", /^subagent-[a-f0-9]{64}$/);
  assert.notEqual(foreground.parentId, foreground.id);
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
  const reviewer = evidence.runs.find((run) => run.agent === "reviewer");
  assert.equal(reviewer?.artifacts, "missing");
  // A foreground row without a published reference keeps the field absent.
  const worker = evidence.runs.find((run) => run.agent === "worker");
  assert.equal(worker?.artifacts, undefined);
  assert.equal(evidence.activity.calls, 3);
  assert.equal(evidence.state, "supported");

  const serialized = JSON.stringify(evidence);
  assert.equal(serialized.includes("/home/dev/PRIVATE"), false);
  assert.equal(serialized.includes("archive.json"), false);
  assert.equal(serialized.includes("run-raw-id"), false);

  // Identical entries produce identical ordering and evidence.
  assert.deepEqual(await readSubagentEvidenceWithArchives(entries), evidence);
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
  assert.deepEqual(evidence.runs, []);
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

  // The nested entry repeating the completion's own run id is not a second run:
  // it merges as a repeated observation. Its conflicting agent is dropped with a
  // `cooperative-evidence-conflict` diagnostic rather than overwriting the first.
  assert.equal(evidence.runs.length, 2);
  const [completion, child] = evidence.runs;
  assert.match(completion?.id ?? "", /^subagent-[a-f0-9]{64}$/);
  assert.equal(completion?.parentId, undefined);
  assert.equal(completion?.agent, undefined);
  assert.equal(completion?.status, "succeeded");
  assert.deepEqual(evidence.diagnostics, [
    { code: "cooperative-evidence-conflict", count: 1 },
  ]);
  assert.equal(child?.parentId, completion?.id);
  assert.equal(child?.agent, undefined);
  assert.equal(child?.status, "unknown");
  assert.deepEqual(child?.usage, { totalTokens: 10, cost: 0.5 });
  assert.equal(evidence.state, "supported");
  assert.equal(JSON.stringify(evidence).includes("future-state"), false);
  assert.equal(JSON.stringify(evidence).includes("PRIVATE"), false);
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
  assert.deepEqual(evidence.runs, []);
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
  assert.deepEqual(evidence.runs, []);
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
  assert.equal(evidence.runs.length, 2);
  const [complete, partial] = evidence.runs;
  assert.notEqual(complete?.id, partial?.id);
  assert.equal(complete?.agent, "worker");
  assert.equal(partial?.agent, "builder");
  assert.equal(complete?.status, "succeeded");
  assert.equal(partial?.status, "failed");
  assert.deepEqual(complete?.usage, { totalTokens: 350, cost: 0.2 });
  assert.equal(partial?.usage, undefined);
  // Both children share the opaque aggregate run id as their parent.
  assert.match(complete?.parentId ?? "", /^subagent-[a-f0-9]{64}$/);
  assert.equal(complete?.parentId, partial?.parentId);
  assert.notEqual(complete?.parentId, complete?.id);
  // The publishing run container is a relationship, not a run: no synthetic
  // AgentRun is materialized for the identity it names.
  assert.equal(
    evidence.runs.some((run) => run.id === complete?.parentId),
    false,
  );
  assert.equal(JSON.stringify(evidence).includes("PRIVATE_TASK"), false);
  assert.equal(JSON.stringify(evidence).includes("/home/dev/PRIVATE"), false);
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
  assert.equal(evidence.runs.length, 2);
  assert.equal(
    evidence.runs.every(
      (run) =>
        /^subagent-[a-f0-9]{64}$/.test(run.id) &&
        run.parentId !== undefined &&
        /^subagent-[a-f0-9]{64}$/.test(run.parentId),
    ),
    true,
  );
  const [complete, partial] = evidence.runs;
  assert.notEqual(complete?.id, partial?.id);
  assert.equal(complete?.parentId, partial?.parentId);
  assert.equal(
    evidence.runs.some((run) => run.id === complete?.parentId),
    false,
  );
  assert.equal(complete?.agent, "worker");
  assert.deepEqual(complete?.usage, { totalTokens: 10, cost: 0.1 });
  assert.equal(partial?.agent, "other");
  assert.equal(partial?.status, "failed");
  assert.equal(partial?.usage, undefined);
  assert.equal(JSON.stringify(evidence).includes("no-index"), false);
  assert.equal(JSON.stringify(evidence).includes("orphan"), false);
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
  assert.equal(evidence.runs.length, 1);
  assert.equal(evidence.runs[0]?.agent, "self-identified");
  assert.equal(evidence.runs[0]?.parentId, undefined);
  assert.equal(JSON.stringify(evidence).includes("not a run id!"), false);
  assert.equal(JSON.stringify(evidence).includes("container-only"), false);
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
    runs: [],
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
  const run = evidence.runs[0];
  assert.equal(run?.observedAt, "2026-09-12T10:00:05.000Z");
  assert.equal(run?.evidenceToolId, "tool:call_1");
  assert.equal(run?.model, "gpt-5");
  assert.equal(run?.thinking, "high");
  assert.deepEqual(run?.failure, { reason: "exit-nonzero", detail: 2 });
  assert.deepEqual(evidence.diagnostics, []);
});

test("repeated publications keep the latest observation exactly once", () => {
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
      { completions: [{ runId: "run-1", agent: "delegate", success: true }] },
      "2026-09-12T10:01:00.000Z",
    ),
  ]);
  assert.equal(evidence.runs.length, 1);
  assert.equal(evidence.runs[0]?.observedAt, "2026-09-12T10:01:00.000Z");
  assert.equal(evidence.runs[0]?.evidenceToolId, "tool:call_2");
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
    ),
  ]);
  assert.equal(evidence.runs.length, 1);
  assert.equal(evidence.runs[0]?.agent, undefined);
  assert.deepEqual(evidence.diagnostics, [
    { code: "cooperative-evidence-conflict", count: 1 },
  ]);
});

test("terminal-to-running regression yields unknown plus a diagnostic", () => {
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
        completions: [{ runId: "run-1", agent: "delegate", state: "running" }],
      },
      "2026-09-12T10:01:00.000Z",
    ),
  ]);
  assert.equal(evidence.runs.length, 1);
  assert.equal(evidence.runs[0]?.status, "unknown");
  assert.deepEqual(evidence.diagnostics, [
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
  const byAgent = new Map(evidence.runs.map((run) => [run.agent, run]));
  assert.deepEqual(byAgent.get("a")?.failure, {
    reason: "process-signal",
    detail: "SIGTERM",
  });
  assert.deepEqual(byAgent.get("b")?.failure, { reason: "completion-failed" });
  assert.deepEqual(byAgent.get("c")?.failure, { reason: "output-absent" });
  assert.equal(byAgent.get("d")?.failure, undefined);
  assert.equal(JSON.stringify(evidence).includes("PRIVATE free text"), false);
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
  const byAgent = new Map(evidence.runs.map((run) => [run.agent, run]));
  assert.equal(byAgent.get("a")?.model, undefined);
  assert.equal(byAgent.get("a")?.thinking, "high");
  assert.equal(byAgent.get("b")?.model, "gpt-5");
  assert.equal(byAgent.get("b")?.thinking, undefined);
  assert.equal(JSON.stringify(evidence).includes("PRIVATE"), false);
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
    ),
  ]);
  assert.deepEqual(evidence.runs[0]?.usage, { totalTokens: 20, cost: 0.2 });
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
  assert.deepEqual(evidence.runs[0]?.failure, {
    reason: "process-signal",
    detail: "SIGKILL",
  });
});

test("a later completions row wins over an earlier results row in the same entry", () => {
  // R22 within-entry order: `results[]` is applied first and `completions[]`
  // last, so the completion's terminal status and usage win with no conflict.
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
  assert.equal(evidence.runs.length, 1);
  assert.equal(evidence.runs[0]?.status, "succeeded");
  assert.deepEqual(evidence.runs[0]?.usage, { totalTokens: 20, cost: 0.2 });
  assert.equal(evidence.runs[0]?.observedAt, "2026-09-12T10:00:05.000Z");
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
  assert.equal(first.runs.length, 1);
  assert.match(first.runs[0]?.id ?? "", /^subagent-[a-f0-9]{64}$/);
  assert.equal(first.runs[0]?.id, again.runs[0]?.id);
  assert.notEqual(first.runs[0]?.id, second.runs[0]?.id);
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
    evidence.runs.map((run) => run.failure),
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
  const byAgent = new Map(evidence.runs.map((run) => [run.agent, run]));
  assert.deepEqual(byAgent.get("a")?.failure, {
    reason: "exit-nonzero",
    detail: 2_147_483_647,
  });
  assert.equal(byAgent.get("b")?.failure, undefined);
  assert.equal(byAgent.get("c")?.failure, undefined);
});

test("collects workflowChildren children after results and completions", () => {
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
  assert.equal(evidence.runs.length, 1);
  assert.equal(evidence.runs[0]?.status, "succeeded");
});

test("keeps the latest value of a field omitted by a later publication", () => {
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
      { completions: [{ runId: "run-1", agent: "delegate" }] },
      "2026-09-12T10:01:00.000Z",
    ),
  ]);
  assert.equal(evidence.runs.length, 1);
  assert.equal(evidence.runs[0]?.model, "gpt-5");
  assert.equal(evidence.runs[0]?.thinking, "high");
  assert.deepEqual(evidence.runs[0]?.failure, {
    reason: "exit-nonzero",
    detail: 2,
  });
});

test("orders publications by entry ordinal, not by timestamp", () => {
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
      { completions: [{ runId: "run-1", agent: "delegate", success: true }] },
      "2026-09-12T10:00:00.000Z",
    ),
  ]);
  assert.equal(evidence.runs.length, 1);
  assert.equal(evidence.runs[0]?.observedAt, "2026-09-12T10:00:00.000Z");
  assert.equal(evidence.runs[0]?.evidenceToolId, "tool:call_2");
});

test("counts two independent field conflicts", () => {
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
      { completions: [{ runId: "run-1", agent: "reviewer", success: false }] },
      "2026-09-12T10:01:00.000Z",
    ),
  ]);
  assert.deepEqual(evidence.diagnostics, [
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
  assert.equal(evidence.runs.length, 0);
});

test("a call without a result publishes no run while activity still counts it", () => {
  const evidence = readSubagentEvidence([assistantEntry("a1", "call-1")]);
  assert.deepEqual([evidence.runs.length, evidence.activity.calls], [0, 1]);
});

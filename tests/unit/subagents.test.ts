import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  readSubagentEvidence,
  readSubagentEvidenceWithArchives,
} from "../../src/integrations/subagents.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";

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

  // The nested entry repeating the completion's own run id is not a second run.
  assert.equal(evidence.runs.length, 2);
  const [completion, child] = evidence.runs;
  assert.match(completion?.id ?? "", /^subagent-[a-f0-9]{64}$/);
  assert.equal(completion?.parentId, undefined);
  assert.equal(completion?.agent, "workflow");
  assert.equal(completion?.status, "succeeded");
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
  assert.equal(complete?.agent, "worker");
  assert.deepEqual(complete?.usage, { totalTokens: 10, cost: 0.1 });
  assert.equal(partial?.agent, "other");
  assert.equal(partial?.status, "failed");
  assert.equal(partial?.usage, undefined);
  assert.equal(JSON.stringify(evidence).includes("no-index"), false);
  assert.equal(JSON.stringify(evidence).includes("orphan"), false);
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
  });
});

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { SessionEntry } from "../../src/core/events.ts";
import { reconcileAgentRuns } from "../../src/core/subagent-reconciliation.ts";
import { readCanonicalContributions } from "../../src/integrations/contributions.ts";
import {
  readDurableSubagentEvidence,
  readSubagentEvidenceWithArchives,
} from "../../src/integrations/subagents.ts";
import { readChildSessionProjections } from "../../src/pi/child-sessions.ts";
import { assistant, header, usage, user } from "../helpers/child-session.ts";

const SESSION_ID = "inspector-session-uuid";
const RUN_ID = "producer-run-1";

let root: string;
let parentFile: string;
let childPath: string;
let asyncDir: string;
before(async () => {
  root = await mkdtemp(join(tmpdir(), "child-wiring-"));
  parentFile = join(root, "parent.jsonl");
  childPath = join(root, "parent", RUN_ID, "run-0", "session.jsonl");
  asyncDir = join(root, "async-run");
  await mkdir(join(root, "parent", RUN_ID, "run-0"), { recursive: true });
});
after(() => rm(root, { recursive: true, force: true }));

const entriesFor = (sessionValue: string = childPath) =>
  [
    {
      id: "launch-call",
      parentId: null,
      timestamp: "2026-11-05T00:00:01.000Z",
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id: "call-1", name: "subagent" }],
      },
    },
    {
      id: "launch-result",
      parentId: "launch-call",
      timestamp: "2026-11-05T00:00:02.000Z",
      type: "message",
      message: {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "subagent",
        isError: false,
        details: {
          mode: "single",
          runId: RUN_ID,
          asyncId: RUN_ID,
          results: [],
          asyncDir,
        },
      },
    },
    {
      id: "notice",
      parentId: "launch-result",
      timestamp: "2026-11-05T00:00:30.000Z",
      type: "custom_message",
      customType: "subagent-notify",
      content: "sanitized",
      details: {
        runs: [
          {
            agent: "reviewer",
            status: "completed",
            runId: RUN_ID,
            asyncDir,
            sessionLabel: "Session file",
            sessionValue,
          },
        ],
      },
    },
  ] as unknown as SessionEntry[];

const writeChild = (lines: string[]) =>
  writeFile(childPath, `${lines.join("\n")}\n`);
const freshChild = (extra: string[] = []) =>
  writeChild([
    header({ parentSession: parentFile }),
    user("u0", null),
    assistant("a1", null, { usage: usage(40, 0.5), toolCalls: ["t1", "t2"] }),
    assistant("a2", "a1", { usage: usage(60, 0.25) }),
    ...extra,
  ]);

const runOf = (
  evidence: Awaited<ReturnType<typeof readDurableSubagentEvidence>>,
) => reconcileAgentRuns(evidence.observations, evidence.aliases).runs[0];

test("a deleted run directory still yields durable model, tokens, cost, and tools", async () => {
  await freshChild();
  for (const evidence of [
    await readDurableSubagentEvidence(
      entriesFor(),
      SESSION_ID,
      parentFile,
      readChildSessionProjections,
    ),
    await readSubagentEvidenceWithArchives(
      entriesFor(),
      SESSION_ID,
      parentFile,
      readChildSessionProjections,
    ),
  ]) {
    const run = runOf(evidence);
    assert.equal(run?.model, "fixture-model");
    assert.equal(run?.toolCalls, 2);
    assert.equal(run?.usage?.totalTokens, 100);
    assert.equal(run?.usage?.cost, 0.75);
    assert.equal(run?.effortCoverage.usage, "partial");
    assert.equal(run?.status, "succeeded", "outcome stays the notice's");
    assert.equal(run?.durationMs, undefined, "duration is never derived");
  }
});

test("enrichment adds no row, no native activity, and no path to the evidence", async () => {
  await freshChild();
  const plain = await readSubagentEvidenceWithArchives(
    entriesFor(),
    SESSION_ID,
  );
  const durable = await readDurableSubagentEvidence(
    entriesFor(),
    SESSION_ID,
    parentFile,
    readChildSessionProjections,
  );
  assert.equal(
    reconcileAgentRuns(durable.observations, durable.aliases).runs.length,
    1,
  );
  assert.deepEqual(durable.activity, plain.activity);
  const serialized = JSON.stringify({
    observations: [...durable.observations],
    aliases: durable.aliases,
  });
  assert.equal(serialized.includes(root), false, "no path leaks");
  assert.equal(serialized.includes(RUN_ID), false, "no raw run id leaks");
});

test("history never reads the temporary lifecycle artifact but the current view still does", async () => {
  await freshChild();
  await mkdir(asyncDir, { recursive: true });
  await writeFile(
    join(asyncDir, "status.json"),
    JSON.stringify({
      lifecycleArtifactVersion: 3,
      mode: "single",
      runId: RUN_ID,
      sessionId: parentFile,
      steps: [
        {
          status: "complete",
          exitCode: 0,
          durationMs: 1234,
          toolCount: 99,
          model: "lifecycle-model",
        },
      ],
    }),
  );
  try {
    const history = runOf(
      await readDurableSubagentEvidence(
        entriesFor(),
        SESSION_ID,
        parentFile,
        readChildSessionProjections,
      ),
    );
    assert.equal(history?.durationMs, undefined);
    const current = runOf(
      await readSubagentEvidenceWithArchives(
        entriesFor(),
        SESSION_ID,
        parentFile,
        readChildSessionProjections,
      ),
    );
    assert.equal(current?.durationMs, 1234, "lifecycle still fills the gap");
    assert.equal(current?.model, "fixture-model", "the durable file wins");
    assert.equal(current?.toolCalls, 2, "the durable file wins");
  } finally {
    await rm(asyncDir, { recursive: true, force: true });
  }
});

test("a resumed, forked, foreign, or missing child file changes nothing", async () => {
  const baseline = runOf(
    await readSubagentEvidenceWithArchives(entriesFor(), SESSION_ID),
  );
  const unchanged = async (label: string) => {
    const run = runOf(
      await readDurableSubagentEvidence(
        entriesFor(),
        SESSION_ID,
        parentFile,
        readChildSessionProjections,
      ),
    );
    assert.deepEqual(run, baseline, label);
  };
  await writeChild([
    header({ parentSession: parentFile }),
    user("u0", null),
    assistant("a1", null, { usage: usage(40, 0.5) }),
    user("u1", "a1"),
  ]);
  await unchanged("resumed: a second prompt");
  await writeChild([
    header({ parentSession: parentFile }),
    user("u0", null),
    assistant("launch-call", null, { usage: usage(40, 0.5) }),
  ]);
  await unchanged("forked: inherits the parent's launch entry");
  await writeChild([
    header({ parentSession: join(root, "someone-else.jsonl") }),
    user("u0", null),
    assistant("a1", null, { usage: usage(40, 0.5) }),
  ]);
  await unchanged("foreign parent");
  await rm(childPath);
  await unchanged("missing file");
});

test("the canonical contribution follows the durable file only with the session file and an injected reader", async () => {
  await freshChild();
  const withFile = await readCanonicalContributions({
    entries: entriesFor(),
    sessionId: SESSION_ID,
    sessionFile: parentFile,
    childSessions: readChildSessionProjections,
  });
  const withoutReader = await readCanonicalContributions({
    entries: entriesFor(),
    sessionId: SESSION_ID,
    sessionFile: parentFile,
  });
  const withoutFile = await readCanonicalContributions({
    entries: entriesFor(),
    sessionId: SESSION_ID,
  });
  const modelOf = (result: typeof withFile) =>
    reconcileAgentRuns(
      result.contributions.subagents?.observations ?? [],
      result.contributions.subagents?.aliases,
    ).runs[0]?.model;
  assert.equal(modelOf(withFile), "fixture-model");
  assert.equal(modelOf(withoutFile), undefined);
  assert.equal(
    modelOf(withoutReader),
    undefined,
    "no injected reader, no read",
  );
});

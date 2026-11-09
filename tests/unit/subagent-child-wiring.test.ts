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
import {
  assistant,
  bareUsage,
  header,
  usage,
  user,
} from "../helpers/child-session.ts";
import { needsProcfs } from "../helpers/procfs.ts";

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
    assistant("a1", "u0", { usage: usage(40, 0.5), toolCalls: ["t1", "t2"] }),
    assistant("a2", "a1", { usage: usage(60, 0.25) }),
    ...extra,
  ]);

const runOf = (
  evidence: Awaited<ReturnType<typeof readDurableSubagentEvidence>>,
) => reconcileAgentRuns(evidence.observations, evidence.aliases).runs[0];

test(
  "a deleted run directory still yields durable model, tokens, cost, and tools",
  needsProcfs,
  async () => {
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
  },
);

test(
  "enrichment adds no row, no native activity, and no path to the evidence",
  needsProcfs,
  async () => {
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
  },
);

test(
  "history never reads the temporary lifecycle artifact but the current view still does",
  needsProcfs,
  async () => {
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
      assert.equal(
        current?.usage?.inputTokens,
        100,
        "component tokens survive the lifecycle fill",
      );
      assert.equal(current?.usage?.outputTokens, 0);
      assert.equal(current?.usage?.cost, 0.75);
    } finally {
      await rm(asyncDir, { recursive: true, force: true });
    }
  },
);

/** Later `bg_wait` completions of the same run, in order, each publishing the given usage. */
const withCompletions = (...published: Record<string, unknown>[]) =>
  [
    ...entriesFor(),
    ...published.flatMap((publishedUsage, index) => [
      {
        id: `wait-call-${index}`,
        parentId: index === 0 ? "notice" : `wait-result-${index - 1}`,
        timestamp: `2026-11-05T00:0${index + 1}:00.000Z`,
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: `wait-${index}`, name: "bg_wait" }],
        },
      },
      {
        id: `wait-result-${index}`,
        parentId: `wait-call-${index}`,
        timestamp: `2026-11-05T00:0${index + 1}:01.000Z`,
        type: "message",
        message: {
          role: "toolResult",
          toolCallId: `wait-${index}`,
          toolName: "bg_wait",
          isError: false,
          details: {
            completions: [
              {
                runId: RUN_ID,
                mode: "single",
                agent: "reviewer",
                state: "complete",
                success: true,
                usage: publishedUsage,
                results: [],
              },
            ],
          },
        },
      },
    ]),
  ] as unknown as SessionEntry[];

test(
  "a later cost-only completion keeps its cost and the child's tokens in the reconciled run",
  needsProcfs,
  async () => {
    await freshChild();
    const run = runOf(
      await readDurableSubagentEvidence(
        withCompletions({ cost: 0.5 }),
        SESSION_ID,
        parentFile,
        readChildSessionProjections,
      ),
    );
    assert.equal(
      run?.usage?.cost,
      0.5,
      "the persisted cost wins over the child's 0.75",
    );
    assert.equal(
      run?.usage?.totalTokens,
      100,
      "tokens the completion lacks come from the child",
    );
    assert.equal(run?.usage?.inputTokens, 100);
    assert.equal(run?.effortCoverage.usage, "partial");
    assert.equal(run?.effortCoverage.cost, "partial");
  },
);

test(
  "a later token-only completion keeps its tokens and gains the child's cost",
  needsProcfs,
  async () => {
    await freshChild();
    const run = runOf(
      await readDurableSubagentEvidence(
        withCompletions({ input: 40, output: 2, cacheRead: 0, cacheWrite: 0 }),
        SESSION_ID,
        parentFile,
        readChildSessionProjections,
      ),
    );
    assert.equal(
      run?.usage?.totalTokens,
      42,
      "the persisted tokens win over the child's 100",
    );
    assert.equal(
      run?.usage?.cost,
      0.75,
      "the cost the completion lacks comes from the child",
    );
  },
);

test(
  "a field an earlier completion published survives a later one that lacks it",
  needsProcfs,
  async () => {
    await freshChild();
    const run = runOf(
      await readDurableSubagentEvidence(
        withCompletions(
          { input: 7, output: 0, cacheRead: 0, cacheWrite: 0 },
          { cost: 0.5 },
        ),
        SESSION_ID,
        parentFile,
        readChildSessionProjections,
      ),
    );
    assert.equal(
      run?.usage?.totalTokens,
      7,
      "the earlier persisted tokens win over the child's 100",
    );
    assert.equal(run?.usage?.cost, 0.5);
  },
);

/** A valid dedicated child whose assistant usage has only a total and a cost. */
const bareChild = () =>
  writeChild([
    header({ parentSession: parentFile }),
    user("u0", null),
    assistant("a1", "u0", { usage: bareUsage(100, 0.75), toolCalls: ["t1"] }),
  ]);

test(
  "persisted usage fields survive reconciliation when the child adds no usage field",
  needsProcfs,
  async () => {
    await bareChild();
    const tokens = { input: 7, output: 0, cacheRead: 0, cacheWrite: 0 };
    for (const [label, order] of [
      ["tokens then cost", [tokens, { cost: 2 }]],
      ["cost then tokens", [{ cost: 2 }, tokens]],
    ] as const) {
      const run = runOf(
        await readDurableSubagentEvidence(
          withCompletions(...order),
          SESSION_ID,
          parentFile,
          readChildSessionProjections,
        ),
      );
      // The child only supplies the model and the tool count here; both persisted
      // fields were already defined, one in each publication.
      assert.equal(run?.model, "fixture-model", label);
      assert.equal(run?.toolCalls, 1, label);
      assert.deepEqual(run?.usage, { totalTokens: 7, cost: 2 }, label);
    }
  },
);

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
    assistant("a1", "u0", { usage: usage(40, 0.5) }),
    user("u1", "a1"),
  ]);
  await unchanged("resumed: a second prompt");
  await writeChild([
    header({ parentSession: parentFile }),
    user("u0", null),
    assistant("launch-call", "u0", { usage: usage(40, 0.5) }),
  ]);
  await unchanged("forked: inherits the parent's launch entry");
  await writeChild([
    header({ parentSession: join(root, "someone-else.jsonl") }),
    user("u0", null),
    assistant("a1", "u0", { usage: usage(40, 0.5) }),
  ]);
  await unchanged("foreign parent");
  await rm(childPath);
  await unchanged("missing file");
});

test(
  "the canonical contribution follows the durable file only with the session file and an injected reader",
  needsProcfs,
  async () => {
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
  },
);

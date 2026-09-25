import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  attachSubagentEvidence,
  buildCanonicalSession,
} from "../../src/core/canonical.ts";
import type { SessionEntry } from "../../src/core/events.ts";
import { toSessionReport } from "../../src/core/reports.ts";
import { readSubagentEvidence } from "../../src/integrations/subagents.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";
import { readSubagentEvidenceWithArchives } from "../../src/integrations/subagents.ts";
import { reconcileAgentRuns } from "../../src/core/subagent-reconciliation.ts";

const SESSION_ID = "foreground-session";
const RUN_ID = "foreground-run";
const SESSION_FILE = "/pi/session.jsonl";
const HISTORY_RELATIVE_PATH = "async-subagent-results/foreground-history.json";

function entries(
  details: Record<string, unknown>,
  callId = "call-1",
  suffix = "",
): SessionEntry[] {
  return [
    {
      id: `assistant-entry${suffix}`,
      parentId: null,
      timestamp: "2026-09-25T10:00:00.000Z",
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id: callId, name: "subagent" }],
      },
    },
    {
      id: `result-entry${suffix}`,
      parentId: null,
      timestamp: "2026-09-25T10:00:01.000Z",
      type: "message",
      message: {
        role: "toolResult",
        toolCallId: callId,
        toolName: "subagent",
        isError: false,
        details,
      },
    },
  ];
}

function envelope(
  child: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 1,
    runs: [
      {
        runId: RUN_ID,
        mode: "parallel",
        cwd: "/private/worktree",
        sessionId: SESSION_ID,
        updatedAt: 1_790_323_200_000,
        children: [{ agent: "reviewer", index: 0, ...child }],
        ...overrides,
      },
    ],
  };
}

async function withHistory(
  value: unknown,
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "inspector-foreground-history-"));
  const previous = process.env.PI_SUBAGENTS_TEMP_ROOT;
  try {
    process.env.PI_SUBAGENTS_TEMP_ROOT = root;
    const historyPath = join(root, HISTORY_RELATIVE_PATH);
    await mkdir(join(root, "async-subagent-results"), { recursive: true });
    if (value !== undefined)
      await writeFile(historyPath, JSON.stringify(value), { mode: 0o600 });
    await run(root);
  } finally {
    if (previous === undefined) delete process.env.PI_SUBAGENTS_TEMP_ROOT;
    else process.env.PI_SUBAGENTS_TEMP_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
}

async function readRuns(
  root?: string,
  details: Record<string, unknown> = {
    runId: RUN_ID,
    results: [{ index: 0, agent: "reviewer", detached: true, exitCode: -2 }],
  },
) {
  const source = entries(details);
  const evidence = await readSubagentEvidenceWithArchives(
    source,
    SESSION_ID,
    root === undefined ? undefined : SESSION_FILE,
  );
  return reconcileAgentRuns(evidence.observations, evidence.aliases).runs;
}

test("enriches detached child only from exact completed foreground history", async () => {
  await withHistory(
    envelope({ status: "completed", exitCode: 0 }),
    async (root) => {
      const runs = await readRuns(root);
      assert.equal(runs.length, 1);
      assert.equal(runs[0]?.executionDisposition, "detached");
      assert.equal(runs[0]?.status, "succeeded");
    },
  );
});

test("skips history enrichment when detached launch references exceed the cap", async () => {
  await withHistory(
    envelope({ status: "completed", exitCode: 0 }),
    async () => {
      const source = entries({
        runId: RUN_ID,
        results: [
          { index: 0, agent: "reviewer", detached: true, exitCode: -2 },
        ],
      });
      for (let index = 1; index < 257; index++) {
        source.push({
          id: `assistant-${index}`,
          parentId: null,
          timestamp: "2026-09-25T10:00:00.000Z",
          type: "message",
          message: {
            role: "assistant",
            content: [
              { type: "toolCall", id: `overflow-${index}`, name: "subagent" },
            ],
          },
        });
      }
      const evidence = await readSubagentEvidenceWithArchives(
        source,
        SESSION_ID,
        SESSION_FILE,
      );
      assert.equal(
        reconcileAgentRuns(evidence.observations, evidence.aliases).runs[0]
          ?.status,
        "unknown",
      );
    },
  );
});

test("maps exact failed foreground history with or without exit code", async () => {
  for (const child of [
    { status: "failed", exitCode: 1 },
    { status: "failed" },
  ]) {
    await withHistory(envelope(child), async (root) => {
      const run = (await readRuns(root))[0];
      assert.equal(run?.executionDisposition, "detached");
      assert.equal(run?.status, "failed");
    });
  }
});

test("maps paused and stopped foreground history to interrupted", async () => {
  for (const status of ["paused", "stopped"]) {
    await withHistory(envelope({ status }), async (root) => {
      assert.equal((await readRuns(root))[0]?.status, "interrupted");
    });
  }
});

test("contradictory or unsupported terminal evidence fails closed", async () => {
  for (const child of [
    { status: "completed", exitCode: 1 },
    { status: "failed", exitCode: 0 },
    { status: "completed" },
    { status: "completed", finalOutput: "PRIVATE_OUTPUT_SENTINEL" },
    { status: "future-status", exitCode: 0 },
  ]) {
    await withHistory(envelope(child), async (root) => {
      assert.equal((await readRuns(root))[0]?.status, "unknown");
    });
  }
});

test("ignores package metadata and reads only recognized history schema version", async () => {
  const value = envelope({ status: "completed", exitCode: 0 });
  value.producerVersion = "99.0.0";
  await withHistory(value, async (root) => {
    assert.equal((await readRuns(root))[0]?.status, "succeeded");
  });
});

test("rejects unsupported envelope version and changed identity schema", async () => {
  for (const value of [
    { ...envelope({ status: "completed", exitCode: 0 }), version: 2 },
    envelope({ status: "completed", exitCode: 0 }, { sessionId: undefined }),
  ]) {
    await withHistory(value, async (root) => {
      assert.equal((await readRuns(root))[0]?.status, "unknown");
    });
  }
});

test("requires exact session, run, and child-index identity", async () => {
  const wrongSession = envelope({ status: "completed", exitCode: 0 });
  const wrongSessionRun = (wrongSession.runs as Record<string, unknown>[])[0];
  assert.ok(wrongSessionRun);
  wrongSessionRun.sessionId = "other-session";
  const wrongRun = envelope({ status: "completed", exitCode: 0 });
  const wrongRunEntry = (wrongRun.runs as Record<string, unknown>[])[0];
  assert.ok(wrongRunEntry);
  wrongRunEntry.runId = "other-run";
  const wrongIndex = envelope({ status: "completed", exitCode: 0 });
  const wrongIndexRun = (wrongIndex.runs as Record<string, unknown>[])[0];
  assert.ok(wrongIndexRun);
  const wrongIndexChild = (
    wrongIndexRun.children as Record<string, unknown>[]
  )[0];
  assert.ok(wrongIndexChild);
  wrongIndexChild.index = 1;
  for (const value of [wrongSession, wrongRun, wrongIndex]) {
    await withHistory(value, async (root) => {
      assert.equal((await readRuns(root))[0]?.status, "unknown");
    });
  }
});

test("duplicate exact foreground-history match fails closed", async () => {
  const value = envelope({ status: "completed", exitCode: 0 });
  const run = (value.runs as Record<string, unknown>[])[0];
  assert.ok(run);
  (run.children as Record<string, unknown>[]).push({
    index: 0,
    agent: "different-display-name",
    status: "completed",
    exitCode: 0,
  });
  await withHistory(value, async (root) => {
    assert.equal((await readRuns(root))[0]?.status, "unknown");
  });
});

test("does not let foreground history replace a later persisted terminal status", async () => {
  await withHistory(
    envelope({ status: "completed", exitCode: 0 }),
    async () => {
      const source = [
        ...entries(
          {
            runId: RUN_ID,
            results: [
              { index: 0, agent: "reviewer", detached: true, exitCode: -2 },
            ],
          },
          "call-first",
          "-first",
        ),
        ...entries(
          {
            runId: RUN_ID,
            detached: true,
            results: [{ index: 0, agent: "reviewer", exitCode: 1 }],
          },
          "call-later",
          "-later",
        ),
      ];
      const evidence = await readSubagentEvidenceWithArchives(
        source,
        SESSION_ID,
        SESSION_FILE,
      );
      assert.equal(
        reconcileAgentRuns(evidence.observations, evidence.aliases).runs[0]
          ?.status,
        "failed",
      );
    },
  );
});

test("keeps persisted terminal Pi evidence ahead of foreground history", async () => {
  await withHistory(
    envelope({ status: "failed", exitCode: 1 }),
    async (root) => {
      const runs = await readRuns(root, {
        runId: RUN_ID,
        results: [
          {
            index: 0,
            agent: "reviewer",
            detached: true,
            success: true,
            exitCode: 0,
          },
        ],
      });
      assert.equal(runs[0]?.status, "succeeded");
    },
  );
});

test("does not read history without the current-session locator context", async () => {
  await withHistory(
    envelope({ status: "completed", exitCode: 0 }),
    async () => {
      const runs = await readRuns();
      assert.equal(runs[0]?.executionDisposition, "detached");
      assert.equal(runs[0]?.status, "unknown");
    },
  );
});

test("keeps detached disposition through canonical report normalization", async () => {
  const parsed = parseSessionJsonl(
    readFileSync(
      new URL(
        "../fixtures/pi-subagents/foreground-detached.jsonl",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const base = buildCanonicalSession({
    parsed,
    scope: "tree",
    leafId: null,
    evidence: { atomic: [], folded: [] },
  });
  if (base.state !== "ready") throw new Error("fixture must build");
  const baseReport = toSessionReport(base.session);
  const persistedEvidence = readSubagentEvidence(parsed.entries, parsed.id);
  const persistedRun = reconcileAgentRuns(
    persistedEvidence.observations,
    persistedEvidence.aliases,
  ).runs[0];
  assert.ok(persistedRun);

  await withHistory(
    envelope(
      { agent: "scout", status: "completed", exitCode: 0 },
      { mode: "single" },
    ),
    async () => {
      const evidence = await readSubagentEvidenceWithArchives(
        parsed.entries,
        parsed.id,
        SESSION_FILE,
      );
      const original = [...evidence.observations][0];
      assert.ok(original);
      assert.equal(original.run.executionDisposition, "detached");
      assert.equal(original.run.status, "succeeded");
      assert.equal(original.run.id, persistedRun.id);

      const { executionDisposition: _disposition, ...laterRun } = original.run;
      const laterObservation = {
        ...original,
        order: original.order + 1,
        run: { ...laterRun, status: "unknown" as const },
      };
      const unrelatedObservation = {
        ...laterObservation,
        sourceIdentity: `subagent-source-${"a".repeat(64)}`,
        order: laterObservation.order + 1,
        run: {
          ...laterObservation.run,
          id: `subagent-${"b".repeat(64)}`,
          agent: "unrelated",
        },
      };
      const observations = [original, laterObservation, unrelatedObservation];
      const reconciled = reconcileAgentRuns(observations, evidence.aliases);
      assert.equal(reconciled.runs.length, 2);
      assert.equal(reconciled.runs[0]?.id, original.run.id);
      assert.equal(reconciled.runs[0]?.executionDisposition, "detached");
      assert.equal(reconciled.runs[0]?.status, "succeeded");
      assert.equal(reconciled.runs[1]?.executionDisposition, undefined);

      const report = toSessionReport(
        attachSubagentEvidence(base.session, {
          ...evidence,
          observations,
        }),
      );
      const run = report.agents.find(({ id }) => id === original.run.id);
      assert.equal(report.agents.length, 2);
      assert.equal(
        report.agents.filter(({ id }) => id === original.run.id).length,
        1,
      );
      assert.equal(run?.id, persistedRun.id);
      assert.equal(run?.executionDisposition, "detached");
      assert.equal(run?.status, "succeeded");
      assert.equal(
        report.agents.find(({ agent }) => agent === "unrelated")
          ?.executionDisposition,
        undefined,
      );
      assert.deepEqual(report.usage, baseReport.usage);
      assert.deepEqual(report.usageComposition, baseReport.usageComposition);
    },
  );
});

test("foreground history changes neither native session totals nor tool activity", async () => {
  const parsed = parseSessionJsonl(
    readFileSync(
      new URL(
        "../fixtures/pi-subagents/foreground-detached.jsonl",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const persistedEvidence = readSubagentEvidence(parsed.entries, parsed.id);
  const buildReport = (subagents: typeof persistedEvidence) => {
    const built = buildCanonicalSession({
      parsed,
      scope: "tree",
      leafId: null,
      evidence: { atomic: [], folded: [] },
      subagents,
    });
    if (built.state !== "ready") throw new Error("fixture must build");
    return toSessionReport(built.session);
  };
  const persisted = buildReport(persistedEvidence);

  await withHistory(
    envelope({ status: "completed", exitCode: 0 }),
    async () => {
      const enrichedEvidence = await readSubagentEvidenceWithArchives(
        parsed.entries,
        parsed.id,
        SESSION_FILE,
      );
      const enriched = buildReport(enrichedEvidence);
      assert.deepEqual(enriched.usage, persisted.usage);
      assert.deepEqual(enriched.usageComposition, persisted.usageComposition);
      assert.deepEqual(enriched.agentActivity, persisted.agentActivity);
      assert.deepEqual(enriched.agentUsage, persisted.agentUsage);
    },
  );
});

test("history rows cannot create AgentRuns and cannot change public IDs", async () => {
  const value = envelope({ status: "completed", exitCode: 0 });
  (value.runs as Record<string, unknown>[]).push({
    runId: "orphan-run",
    mode: "parallel",
    cwd: "/private/worktree",
    sessionId: SESSION_ID,
    updatedAt: 1_790_323_200_001,
    children: [{ agent: "orphan", index: 0, status: "completed", exitCode: 0 }],
  });
  await withHistory(value, async (root) => {
    const enriched = await readRuns(root);
    const persisted = await readRuns(undefined);
    assert.equal(enriched.length, 1);
    assert.equal(enriched[0]?.id, persisted[0]?.id);
    assert.equal(enriched[0]?.status, "succeeded");
  });
});

test("private producer payload and identities never enter public AgentRuns", async () => {
  const value = envelope({
    status: "completed",
    exitCode: 0,
    task: "PRIVATE_TASK_SENTINEL",
    finalOutput: "PRIVATE_OUTPUT_SENTINEL",
  });
  await withHistory(value, async (root) => {
    const publicRuns = await readRuns(root);
    const serialized = JSON.stringify(publicRuns);
    for (const privateValue of [
      "/private/worktree",
      RUN_ID,
      SESSION_ID,
      "PRIVATE_TASK_SENTINEL",
      "PRIVATE_OUTPUT_SENTINEL",
    ])
      assert.equal(serialized.includes(privateValue), false);
  });
});

test("symlink, malformed, oversized, and missing files fail closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-foreground-history-"));
  const previous = process.env.PI_SUBAGENTS_TEMP_ROOT;
  try {
    process.env.PI_SUBAGENTS_TEMP_ROOT = root;
    const directory = join(root, "async-subagent-results");
    await mkdir(directory, { recursive: true });
    const file = join(directory, "foreground-history.json");
    await writeFile(file, "{not json");
    assert.equal((await readRuns(root))[0]?.status, "unknown");
    await rm(file);
    await writeFile(file, "x".repeat(9 * 1024 * 1024));
    assert.equal((await readRuns(root))[0]?.status, "unknown");
    await rm(file);
    await writeFile(
      join(root, "outside.json"),
      JSON.stringify(envelope({ status: "completed", exitCode: 0 })),
    );
    await symlink(join(root, "outside.json"), file);
    assert.equal((await readRuns(root))[0]?.status, "unknown");
    await rm(file);
    assert.equal((await readRuns(root))[0]?.status, "unknown");

    await rm(directory, { recursive: true });
    const outside = join(root, "outside-results");
    await mkdir(outside);
    await writeFile(
      join(outside, "foreground-history.json"),
      JSON.stringify(envelope({ status: "completed", exitCode: 0 })),
    );
    await symlink(outside, directory, "dir");
    assert.equal((await readRuns(root))[0]?.status, "unknown");
  } finally {
    if (previous === undefined) delete process.env.PI_SUBAGENTS_TEMP_ROOT;
    else process.env.PI_SUBAGENTS_TEMP_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});

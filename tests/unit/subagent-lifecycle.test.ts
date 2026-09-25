import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type {
  SessionEntry,
  SubagentSourceEvidence,
} from "../../src/core/events.ts";
import { reconcileAgentRuns } from "../../src/core/subagent-reconciliation.ts";
import {
  attachSubagentEvidence,
  buildCanonicalSession,
} from "../../src/core/canonical.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";
import { loadCurrentSessionReport } from "../../src/ui/load-current.ts";
import { readSubagentEvidenceWithArchives } from "../../src/integrations/subagents.ts";

const inspectorSession = "inspector-session-uuid";
const producerRunId = "producer-run-private-sentinel";

type LifecycleReader = (
  entries: readonly SessionEntry[],
  sessionId: string,
  sessionFile?: string,
) => Promise<SubagentSourceEvidence>;
const readCurrent = readSubagentEvidenceWithArchives as LifecycleReader;

function launchEntries(
  asyncDir: string,
  details: Record<string, unknown> = {},
  prefix = "launch",
) {
  const callId = `${prefix}-tool-call`;
  return [
    {
      id: `${prefix}-call`,
      parentId: null,
      timestamp: "2026-09-25T10:00:00.000Z",
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id: callId, name: "subagent" }],
      },
    },
    {
      id: `${prefix}-result`,
      parentId: `${prefix}-call`,
      timestamp: "2026-09-25T10:00:01.000Z",
      type: "message",
      message: {
        role: "toolResult",
        toolCallId: callId,
        toolName: "subagent",
        isError: false,
        details: {
          mode: "single",
          runId: producerRunId,
          asyncId: producerRunId,
          results: [],
          asyncDir,
          ...details,
        },
      },
    },
  ] as unknown as SessionEntry[];
}

function status(
  step: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  return {
    lifecycleArtifactVersion: 3,
    mode: "single",
    runId: producerRunId,
    sessionId: "/private/session-file-sentinel.jsonl",
    steps: [step],
    ...overrides,
  };
}

async function setup(
  artifact: unknown,
  options: { sessionId?: string; sessionFile?: string; write?: boolean } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "inspector-c2-"));
  const asyncDir = join(root, "async-run");
  await mkdir(asyncDir);
  const sessionFile =
    options.sessionFile ?? "/private/session-file-sentinel.jsonl";
  if (options.write !== false) {
    await writeFile(join(asyncDir, "status.json"), JSON.stringify(artifact));
  }
  return {
    root,
    asyncDir,
    sessionFile,
    entries: launchEntries(asyncDir),
    sessionId: options.sessionId ?? inspectorSession,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

async function readRun(input: Awaited<ReturnType<typeof setup>>) {
  const evidence = await readCurrent(
    input.entries,
    input.sessionId,
    input.sessionFile,
  );
  const run = reconcileAgentRuns(evidence.observations, evidence.aliases)
    .runs[0];
  assert.ok(run, "validated C1 launch must remain visible");
  return { evidence, run };
}

test("v3 referenced lifecycle fills missing toolCalls on existing C1 async run", async () => {
  const input = await setup(status({ status: "running", toolCount: 6 }));
  try {
    const { run } = await readRun(input);
    assert.equal(run.executionKind, "async");
    assert.equal(run.toolCalls, 6);
    assert.equal(run.effortCoverage.tools, "partial");
    assert.equal(run.status, "unknown");
    assert.equal(run.parentId, undefined);
  } finally {
    await input.cleanup();
  }
});

test("absent lifecycle toolCount remains unavailable", async () => {
  const input = await setup(status({ status: "running" }));
  try {
    const { run } = await readRun(input);
    assert.equal(run.toolCalls, undefined);
    assert.equal(run.effortCoverage.tools, "unavailable");
  } finally {
    await input.cleanup();
  }
});

test("explicit zero is preserved as partial current-view effort", async () => {
  const input = await setup(status({ status: "running", toolCount: 0 }));
  try {
    const { run } = await readRun(input);
    assert.equal(run.toolCalls, 0);
    assert.equal(run.effortCoverage.tools, "partial");
  } finally {
    await input.cleanup();
  }
});

test("complete single step may fill absent model with producer label", async () => {
  const input = await setup(
    status({ status: "complete", model: "provider/model-a" }),
  );
  try {
    const { run } = await readRun(input);
    assert.equal(run.model, "provider/model-a");
  } finally {
    await input.cleanup();
  }
});

test("non-complete lifecycle steps never fill model", async (t) => {
  for (const stepStatus of [
    "pending",
    "running",
    "completed",
    "failed",
    "paused",
    "stopped",
    "partial",
    "rejected",
  ]) {
    await t.test(stepStatus, async () => {
      const input = await setup(
        status({ status: stepStatus, model: "provider/model-a" }),
      );
      try {
        const { run } = await readRun(input);
        assert.equal(run.model, undefined);
      } finally {
        await input.cleanup();
      }
    });
  }
});

test("persisted completion model wins over a later relaunch publication", async () => {
  const input = await setup(
    status({ status: "complete", model: "provider/lifecycle", toolCount: 99 }),
  );
  input.entries.push(
    {
      id: "wait-call",
      parentId: "launch-result",
      timestamp: "2026-09-25T10:00:02.000Z",
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id: "wait-tool-call", name: "bg_wait" }],
      },
    },
    {
      id: "wait-result",
      parentId: "wait-call",
      timestamp: "2026-09-25T10:00:03.000Z",
      type: "message",
      message: {
        role: "toolResult",
        toolCallId: "wait-tool-call",
        toolName: "bg_wait",
        isError: false,
        details: {
          completions: [
            {
              runId: producerRunId,
              mode: "single",
              agent: "worker",
              state: "complete",
              success: true,
              results: [],
              model: "provider/persisted",
              progressSummary: { toolCount: 4 },
            },
          ],
        },
      },
    },
    {
      id: "relaunch-call",
      parentId: null,
      timestamp: "2026-09-25T10:00:04.000Z",
      type: "message",
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", id: "relaunch-tool-call", name: "subagent" },
        ],
      },
    },
    {
      id: "relaunch-result",
      parentId: "relaunch-call",
      timestamp: "2026-09-25T10:00:05.000Z",
      type: "message",
      message: {
        role: "toolResult",
        toolCallId: "relaunch-tool-call",
        toolName: "subagent",
        isError: false,
        details: {
          mode: "single",
          runId: producerRunId,
          asyncId: producerRunId,
          results: [],
          asyncDir: input.asyncDir,
        },
      },
    },
  );
  try {
    const { run } = await readRun(input);
    assert.equal(run.model, "provider/persisted");
    // C1 does not publish effort on the outer async completion, so its absent
    // count remains eligible for the explicitly provisional lifecycle value.
    assert.equal(run.toolCalls, 99);
  } finally {
    await input.cleanup();
  }
});

test("wrong runId and missing or mismatched parent session file reject enrichment", async (t) => {
  const cases = [
    {
      name: "wrong runId",
      artifact: status({ status: "running", toolCount: 7 }, { runId: "other" }),
    },
    {
      name: "missing sessionId",
      artifact: status(
        { status: "running", toolCount: 7 },
        { sessionId: undefined },
      ),
    },
    {
      name: "mismatched sessionId",
      artifact: status(
        { status: "running", toolCount: 7 },
        { sessionId: "/other/session.jsonl" },
      ),
    },
  ];
  for (const item of cases)
    await t.test(item.name, async () => {
      const input = await setup(item.artifact);
      try {
        const { run } = await readRun(input);
        assert.equal(run.toolCalls, undefined);
        assert.equal(run.model, undefined);
      } finally {
        await input.cleanup();
      }
    });
});

test("missing, malformed, oversized, or unsupported artifacts preserve C1 row", async (t) => {
  const cases = [
    { name: "missing", write: false },
    { name: "malformed", content: "{" },
    {
      name: "unsupported version",
      content: JSON.stringify(
        status(
          { status: "running", toolCount: 8 },
          { lifecycleArtifactVersion: 2 },
        ),
      ),
    },
    {
      name: "wrong mode",
      content: JSON.stringify(
        status({ status: "running", toolCount: 8 }, { mode: "workflow" }),
      ),
    },
    {
      name: "wrong step cardinality",
      content: JSON.stringify({
        ...status({ status: "running", toolCount: 8 }),
        steps: [
          { status: "running", toolCount: 8 },
          { status: "running", toolCount: 9 },
        ],
      }),
    },
    { name: "oversized", content: " ".repeat(140 * 1024) },
  ];
  for (const item of cases)
    await t.test(item.name, async () => {
      const input = await setup({}, { write: item.write !== false });
      if (item.content !== undefined)
        await writeFile(join(input.asyncDir, "status.json"), item.content);
      try {
        const { evidence, run } = await readRun(input);
        assert.equal(
          reconcileAgentRuns(evidence.observations, evidence.aliases).runs
            .length,
          1,
        );
        assert.equal(
          run.id,
          reconcileAgentRuns(
            (
              await readCurrent(
                input.entries,
                input.sessionId,
                input.sessionFile,
              )
            ).observations,
          ).runs[0]?.id,
        );
        assert.equal(run.status, "unknown");
        assert.equal(run.toolCalls, undefined);
      } finally {
        await input.cleanup();
      }
    });
});

test("missing or unsupported step status rejects lifecycle enrichment", async (t) => {
  for (const [name, step] of [
    ["missing status", { toolCount: 7 }],
    ["unsupported status", { status: "unknown", toolCount: 7 }],
  ] as const)
    await t.test(name, async () => {
      const input = await setup(status(step));
      try {
        const { run } = await readRun(input);
        assert.equal(run.toolCalls, undefined);
        assert.equal(run.model, undefined);
      } finally {
        await input.cleanup();
      }
    });
});

test("published step statuses permit bounded tool counts", async (t) => {
  for (const stepStatus of [
    "pending",
    "running",
    "complete",
    "completed",
    "failed",
    "partial",
    "paused",
    "stopped",
    "rejected",
  ])
    await t.test(stepStatus, async () => {
      const input = await setup(status({ status: stepStatus, toolCount: 7 }));
      try {
        const { run } = await readRun(input);
        assert.equal(run.toolCalls, 7);
        assert.equal(run.effortCoverage.tools, "partial");
      } finally {
        await input.cleanup();
      }
    });
});

test("invalid toolCount or eligible model rejects the artifact without partial enrichment", async (t) => {
  for (const [name, step] of [
    ["negative count", { status: "running", toolCount: -1 }],
    ["fractional count", { status: "running", toolCount: 1.5 }],
    ["unsafe count", { status: "running", toolCount: Number.MAX_SAFE_INTEGER }],
    [
      "unbounded model",
      { status: "complete", model: "m".repeat(500), toolCount: 5 },
    ],
  ] as const)
    await t.test(name, async () => {
      const input = await setup(status(step));
      try {
        const { run } = await readRun(input);
        if ("toolCount" in step) assert.equal(run.toolCalls, undefined);
        if ("model" in step) {
          assert.equal(run.model, undefined);
          assert.equal(run.toolCalls, undefined);
        }
      } finally {
        await input.cleanup();
      }
    });
});

test("published v3 fixture enriches current report only", async () => {
  const input = await setup({});
  try {
    const piSession = await readFile(
      new URL("../fixtures/pi/0.85.1/token-economics.jsonl", import.meta.url),
      "utf8",
    );
    const parsed = parseSessionJsonl(piSession);
    const launches = launchEntries(input.asyncDir);
    parsed.entries.push(...launches);
    input.sessionFile = join(input.root, "current-session.jsonl");
    await writeFile(
      input.sessionFile,
      `${piSession.trimEnd()}\n${launches
        .map((entry) => JSON.stringify(entry))
        .join("\n")}\n`,
    );

    // Sanitized v3 artifact shape from pi-subagents@0.71.0, tag v0.71.0,
    // release commit 4af5e85a427b9f87334585ae8d0eb365d4dd2a1e.
    const artifact = JSON.parse(
      await readFile(
        new URL(
          "../fixtures/pi-subagents/0.71.0/status-single-complete-v3.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await writeFile(
      join(input.asyncDir, "status.json"),
      JSON.stringify({
        ...artifact,
        runId: producerRunId,
        sessionId: input.sessionFile,
      }),
    );

    const current = await loadCurrentSessionReport(input.sessionFile, "tree", {
      leafId: null,
      subagentEvidence: readCurrent,
    });
    const withoutLifecycle = await loadCurrentSessionReport(
      input.sessionFile,
      "tree",
      { leafId: null },
    );
    assert.ok(current);
    assert.ok(withoutLifecycle);
    const currentRun = current.report.agents[0];
    const baselineRun = withoutLifecycle.report.agents[0];
    assert.ok(currentRun);
    assert.ok(baselineRun);
    assert.equal(currentRun.id, baselineRun.id);
    assert.equal(currentRun.status, baselineRun.status);
    assert.equal(currentRun.parentId, baselineRun.parentId);
    assert.equal(currentRun.toolCalls, 2);
    assert.equal(currentRun.effortCoverage.tools, "partial");
    assert.equal(currentRun.model, "provider/model-a");
    assert.equal(baselineRun.toolCalls, undefined);
    assert.equal(baselineRun.model, undefined);
    assert.deepEqual(current.report.usage, withoutLifecycle.report.usage);

    const history = await readCurrent(parsed.entries, parsed.id);
    const historyRun = reconcileAgentRuns(history.observations, history.aliases)
      .runs[0];
    assert.equal(historyRun?.id, currentRun.id);
    assert.equal(historyRun?.toolCalls, undefined);
    assert.equal(historyRun?.model, undefined);
  } finally {
    await input.cleanup();
  }
});

test("over-limit async launches skip lifecycle reads and preserve C1 evidence", async () => {
  const input = await setup(status({ status: "running", toolCount: 7 }));
  for (let index = 0; index < 256; index++) {
    const runId = `extra-run-${index}`;
    input.entries.push(
      ...launchEntries(
        join(input.root, `async-${index}`),
        { runId, asyncId: runId },
        `extra-${index}`,
      ),
    );
  }
  try {
    const persisted = await readCurrent(input.entries, input.sessionId);
    const current = await readCurrent(
      input.entries,
      input.sessionId,
      input.sessionFile,
    );
    const persistedRows = [...persisted.observations];
    const currentRows = [...current.observations];
    assert.equal(persistedRows.length, 257);
    assert.deepEqual(currentRows, persistedRows);
    assert.deepEqual(current.activity, persisted.activity);
    assert.deepEqual(current.aliases, persisted.aliases);
    assert.equal(currentRows[0]?.run.toolCalls, undefined);
  } finally {
    await input.cleanup();
  }
});

test("missing parent session-file identity skips lifecycle enrichment", async () => {
  const input = await setup(status({ status: "running", toolCount: 7 }));
  try {
    const evidence = await readCurrent(input.entries, input.sessionId);
    const run = reconcileAgentRuns(evidence.observations, evidence.aliases)
      .runs[0];
    assert.equal(run?.toolCalls, undefined);
  } finally {
    await input.cleanup();
  }
});

test("lifecycle artifact cannot create an AgentRun without persisted C1 launch evidence", async () => {
  const input = await setup(
    status({ status: "complete", model: "provider/model-a", toolCount: 2 }),
  );
  try {
    const evidence = await readCurrent([], input.sessionId, input.sessionFile);
    assert.equal(
      reconcileAgentRuns(evidence.observations, evidence.aliases).runs.length,
      0,
    );
  } finally {
    await input.cleanup();
  }
});

test("lifecycle cannot create a run and does not alter native activity totals", async () => {
  const input = await setup(
    status({ status: "complete", model: "provider/model-a", toolCount: 2 }),
  );
  try {
    const before = await readCurrent(input.entries, input.sessionId);
    const after = await readCurrent(
      input.entries,
      input.sessionId,
      input.sessionFile,
    );
    assert.equal(
      reconcileAgentRuns(before.observations, before.aliases).runs.length,
      1,
    );
    assert.equal(
      reconcileAgentRuns(after.observations, after.aliases).runs.length,
      1,
    );
    assert.deepEqual(after.activity, before.activity);
    assert.deepEqual(after.aliases, before.aliases);
  } finally {
    await input.cleanup();
  }
});

test("lifecycle payload sentinels never appear in evidence or canonical report rows", async () => {
  const input = await setup({
    ...status({
      status: "complete",
      model: "provider/model-safe",
      toolCount: 2,
    }),
    error: "PRIVATE_ERROR_SENTINEL",
    output: "PRIVATE_OUTPUT_SENTINEL",
    requestedModel: "PRIVATE_REQUESTED_MODEL_SENTINEL",
    sessionRoot: "PRIVATE_PATH_SENTINEL",
    nestedChildren: [{ task: "PRIVATE_TASK_SENTINEL" }],
  });
  try {
    const { evidence, run } = await readRun(input);
    const serialized = JSON.stringify({ evidence, run });
    for (const secret of [
      "PRIVATE_ERROR_SENTINEL",
      "PRIVATE_OUTPUT_SENTINEL",
      "PRIVATE_REQUESTED_MODEL_SENTINEL",
      "PRIVATE_PATH_SENTINEL",
      "PRIVATE_TASK_SENTINEL",
      producerRunId,
      input.asyncDir,
      input.sessionFile,
    ])
      assert.equal(serialized.includes(secret), false, `leaked ${secret}`);
  } finally {
    await input.cleanup();
  }
});

test("lifecycle reader rejects symlinks at asyncDir, parent components, and status.json", async (t) => {
  await t.test("asyncDir symlink", async () => {
    const input = await setup(status({ status: "running", toolCount: 5 }));
    const link = join(input.root, "async-link");
    await symlink(input.asyncDir, link);
    input.entries = launchEntries(link);
    try {
      assert.equal((await readRun(input)).run.toolCalls, undefined);
    } finally {
      await input.cleanup();
    }
  });
  await t.test("parent component symlink", async () => {
    const input = await setup(status({ status: "running", toolCount: 5 }));
    const parent = join(input.root, "parent-link");
    await symlink(input.root, parent);
    input.entries = launchEntries(join(parent, "async-run"));
    try {
      assert.equal((await readRun(input)).run.toolCalls, undefined);
    } finally {
      await input.cleanup();
    }
  });
  await t.test("status.json symlink", async () => {
    const input = await setup({}, { write: false });
    const target = join(input.root, "target.json");
    await writeFile(
      target,
      JSON.stringify(status({ status: "running", toolCount: 5 })),
    );
    await symlink(target, join(input.asyncDir, "status.json"));
    try {
      assert.equal((await readRun(input)).run.toolCalls, undefined);
    } finally {
      await input.cleanup();
    }
  });
});

test("malformed or escaping lifecycle references fail closed", async (t) => {
  for (const reference of [
    "relative/path",
    "/private/../escape",
    "",
    "x".repeat(5000),
  ]) {
    await t.test(JSON.stringify(reference), async () => {
      const input = await setup(status({ status: "running", toolCount: 5 }));
      input.entries = launchEntries(reference);
      try {
        const { run } = await readRun(input);
        assert.equal(run.toolCalls, undefined);
      } finally {
        await input.cleanup();
      }
    });
  }
});

test("lifecycle enrichment leaves native session usage unchanged", async () => {
  const input = await setup({});
  try {
    const fixture = await readFile(
      new URL("../fixtures/pi/0.85.1/token-economics.jsonl", import.meta.url),
      "utf8",
    );
    const parsed = parseSessionJsonl(fixture);
    parsed.entries.push(...launchEntries(input.asyncDir));
    input.sessionFile = join(input.root, "parent-session.jsonl");
    await writeFile(
      input.sessionFile,
      `${fixture.trimEnd()}\n${parsed.entries
        .slice(-2)
        .map((entry) => JSON.stringify(entry))
        .join("\n")}\n`,
    );
    await writeFile(input.sessionFile, fixture);
    await writeFile(
      join(input.asyncDir, "status.json"),
      JSON.stringify({
        ...status({
          status: "complete",
          model: "provider/model-a",
          toolCount: 3,
        }),
        sessionId: input.sessionFile,
        runId: producerRunId,
      }),
    );
    const base = buildCanonicalSession({
      parsed,
      scope: "tree",
      leafId: null,
      evidence: { atomic: [], folded: [] },
    });
    assert.equal(base.state, "ready");
    if (base.state !== "ready") return;
    const persisted = await readCurrent(parsed.entries, parsed.id);
    const enriched = await readCurrent(
      parsed.entries,
      parsed.id,
      input.sessionFile,
    );
    const before = attachSubagentEvidence(base.session, persisted);
    const after = attachSubagentEvidence(base.session, enriched);
    assert.equal(before.usage.state, "known");
    assert.equal(after.usage.state, "known");
    if (before.usage.state !== "known" || after.usage.state !== "known") return;
    assert.equal(before.usage.known.totalTokens, 41);
    assert.deepEqual(after.usage, before.usage);
  } finally {
    await input.cleanup();
  }
});

test("historical canonical adapter remains persisted-only", async () => {
  const input = await setup(
    status({ status: "complete", model: "provider/model-a", toolCount: 8 }),
  );
  try {
    const history = await readSubagentEvidenceWithArchives(
      input.entries,
      input.sessionId,
    );
    const historical = reconcileAgentRuns(history.observations, history.aliases)
      .runs[0];
    assert.equal(historical?.toolCalls, undefined);
    assert.equal(historical?.model, undefined);
  } finally {
    await input.cleanup();
  }
});

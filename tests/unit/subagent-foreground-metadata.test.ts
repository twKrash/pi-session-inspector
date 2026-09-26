/**
 * Documented per-child foreground metadata enrichment.
 *
 * The terminal outcome of an already-proven detached foreground run comes from
 * the per-child `_meta.json` referenced by `artifactPaths.metadataPath` in the
 * same persisted result (pi-subagents issue #2485). Nothing here scans a
 * directory, infers a filename, or creates an AgentRun.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { buildCanonicalSession } from "../../src/core/canonical.ts";
import type { SessionEntry } from "../../src/core/events.ts";
import { toSessionReport } from "../../src/core/reports.ts";
import { reconcileAgentRuns } from "../../src/core/subagent-reconciliation.ts";
import {
  readSubagentEvidence,
  readSubagentEvidenceWithArchives,
} from "../../src/integrations/subagents.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";

const SESSION_ID = "foreground-session";
const RUN_ID = "foreground-run";
const SESSION_FILE = "/pi/session.jsonl";
const CALL_ID = "call-detached";
const METADATA_FILE = `${RUN_ID}_scout_0_meta.json`;
const MATCHING_RUN = "foreground-run-match";
const OTHER_RUN = "foreground-run-other";
const LEGACY_HISTORY_RELATIVE_PATH =
  "async-subagent-results/foreground-history.json";

type MetadataValue = Record<string, unknown>;

function entries(
  details: Record<string, unknown>,
  callId = CALL_ID,
  suffix = "",
): SessionEntry[] {
  return [
    {
      id: `assistant-entry${suffix}`,
      parentId: "marker",
      timestamp: "2026-09-25T10:00:00.000Z",
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id: callId, name: "subagent" }],
      },
    },
    {
      id: `result-entry${suffix}`,
      parentId: `assistant-entry${suffix}`,
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
  ] as SessionEntry[];
}

/** Detached foreground publication; the metadata reference is optional. */
function detachedDetails(metadataPath?: string): Record<string, unknown> {
  return {
    mode: "single",
    runId: RUN_ID,
    results: [
      {
        index: 0,
        agent: "scout",
        detached: true,
        exitCode: -2,
        ...(metadataPath === undefined
          ? {}
          : { artifactPaths: { metadataPath } }),
      },
    ],
  };
}

function sessionSource(details: Record<string, unknown>): string {
  return [
    JSON.stringify({
      type: "session",
      version: 3,
      id: SESSION_ID,
      timestamp: "2026-09-25T10:00:00.000Z",
      sessionFile: SESSION_FILE,
    }),
    JSON.stringify({
      type: "custom",
      id: "marker",
      parentId: null,
      timestamp: "2026-09-25T10:00:00.500Z",
      customType: "session-inspector:tracking-start",
      data: { schemaVersion: 1 },
    }),
    ...entries(details).map((entry) => JSON.stringify(entry)),
  ].join("\n");
}

async function withMetadata(
  value: MetadataValue | string | undefined,
  run: (metadataPath: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "inspector-foreground-metadata-"));
  try {
    const metadataPath = join(root, METADATA_FILE);
    if (typeof value === "string") await writeFile(metadataPath, value);
    else if (value !== undefined)
      await writeFile(metadataPath, JSON.stringify(value), { mode: 0o600 });
    await run(metadataPath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function readRuns(
  details: Record<string, unknown>,
): Promise<ReturnType<typeof reconcileAgentRuns>["runs"]> {
  const evidence = await readSubagentEvidenceWithArchives(
    entries(details),
    SESSION_ID,
    SESSION_FILE,
  );
  return reconcileAgentRuns(evidence.observations, evidence.aliases).runs;
}

test("detached provisional row stays detached without terminal metadata", async () => {
  const runs = await readRuns(detachedDetails());
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.executionDisposition, "detached");
  assert.equal(runs[0]?.status, "unknown");
});

test("provisional metadata still records the detached sentinel as no outcome", async () => {
  await withMetadata(
    { runId: RUN_ID, exitCode: -2, timestamp: 1_790_323_200_000 },
    async (metadataPath) => {
      const runs = await readRuns(detachedDetails(metadataPath));
      assert.equal(runs[0]?.executionDisposition, "detached");
      assert.equal(runs[0]?.status, "unknown");
    },
  );
});

test("exact terminal metadata settles the same run as succeeded", async () => {
  await withMetadata(
    { runId: RUN_ID, exitCode: 0, timestamp: 1_790_323_200_500 },
    async (metadataPath) => {
      const runs = await readRuns(detachedDetails(metadataPath));
      assert.equal(runs.length, 1);
      assert.equal(runs[0]?.executionDisposition, "detached");
      assert.equal(runs[0]?.status, "succeeded");
    },
  );
});

test("known limitation: control-interrupted metadata still reports exitCode 0", async () => {
  // ADR 0023 known limitation: the artifact omits the producer's interruption
  // classification, so this shape is indistinguishable from a clean success.
  await withMetadata(
    { runId: RUN_ID, exitCode: 0, interrupted: true },
    async (metadataPath) => {
      const runs = await readRuns(detachedDetails(metadataPath));
      assert.equal(runs[0]?.executionDisposition, "detached");
      assert.equal(runs[0]?.status, "succeeded");
    },
  );
});

test("terminal non-zero exit code settles the row as failed", async () => {
  await withMetadata({ runId: RUN_ID, exitCode: 1 }, async (metadataPath) => {
    const runs = await readRuns(detachedDetails(metadataPath));
    assert.equal(runs[0]?.executionDisposition, "detached");
    assert.equal(runs[0]?.status, "failed");
  });
});

test("valid terminal process signal without an exit code is interrupted", async () => {
  await withMetadata(
    { runId: RUN_ID, processSignal: "SIGKILL" },
    async (metadataPath) => {
      const runs = await readRuns(detachedDetails(metadataPath));
      assert.equal(runs[0]?.status, "interrupted");
    },
  );
});

test("unknown signal token and absent outcome fields invent nothing", async () => {
  for (const metadata of [
    { runId: RUN_ID, processSignal: "SIGWHATEVER" },
    { runId: RUN_ID, timestamp: 1_790_323_200_000 },
    { runId: RUN_ID, exitCode: "0" },
    { runId: RUN_ID, exitCode: 0x7fffffff + 1 },
  ]) {
    await withMetadata(metadata, async (metadataPath) => {
      const runs = await readRuns(detachedDetails(metadataPath));
      assert.equal(runs[0]?.status, "unknown");
    });
  }
});

test("missing, disabled, or absent metadata reference stays unknown", async () => {
  for (const details of [
    detachedDetails(),
    detachedDetails(join(tmpdir(), "inspector-absent-metadata", METADATA_FILE)),
  ]) {
    const runs = await readRuns(details);
    assert.equal(runs[0]?.executionDisposition, "detached");
    assert.equal(runs[0]?.status, "unknown");
  }
  await withMetadata(undefined, async (metadataPath) => {
    const runs = await readRuns(detachedDetails(metadataPath));
    assert.equal(runs[0]?.status, "unknown");
  });
});

test("archived reports never follow a metadata reference", async () => {
  await withMetadata({ runId: RUN_ID, exitCode: 0 }, async (metadataPath) => {
    const evidence = await readSubagentEvidenceWithArchives(
      entries(detachedDetails(metadataPath)),
      SESSION_ID,
    );
    const runs = reconcileAgentRuns(
      evidence.observations,
      evidence.aliases,
    ).runs;
    assert.equal(runs[0]?.executionDisposition, "detached");
    assert.equal(runs[0]?.status, "unknown");
  });
});

test("malformed, unsupported, and oversized metadata fail closed", async () => {
  for (const value of [
    "{not json",
    JSON.stringify(["not", "an", "object"]),
    JSON.stringify({
      runId: RUN_ID,
      exitCode: 0,
      extra: "x".repeat(300 * 1024),
    }),
  ]) {
    await withMetadata(value, async (metadataPath) => {
      const runs = await readRuns(detachedDetails(metadataPath));
      assert.equal(runs[0]?.status, "unknown");
    });
  }
});

test("mismatched runId identity fails closed", async () => {
  for (const metadata of [
    { runId: "other-run", exitCode: 0 },
    { runId: 42, exitCode: 0 },
    { exitCode: 0 },
  ]) {
    await withMetadata(metadata, async (metadataPath) => {
      const runs = await readRuns(detachedDetails(metadataPath));
      assert.equal(runs[0]?.executionDisposition, "detached");
      assert.equal(runs[0]?.status, "unknown");
    });
  }
});

test("metadata identity is re-checked per referenced run", async () => {
  await withMetadata(
    { runId: MATCHING_RUN, exitCode: 0 },
    async (metadataPath) => {
      const source = [
        ...entries(
          {
            runId: MATCHING_RUN,
            results: [
              {
                index: 0,
                agent: "scout",
                detached: true,
                exitCode: -2,
                artifactPaths: { metadataPath },
              },
            ],
          },
          "call-match",
          "-match",
        ),
        ...entries(
          {
            runId: OTHER_RUN,
            results: [
              {
                index: 0,
                agent: "scout",
                detached: true,
                exitCode: -2,
                artifactPaths: { metadataPath },
              },
            ],
          },
          "call-other",
          "-other",
        ),
      ];
      const evidence = await readSubagentEvidenceWithArchives(
        source,
        SESSION_ID,
        SESSION_FILE,
      );
      const runs = reconcileAgentRuns(
        evidence.observations,
        evidence.aliases,
      ).runs;
      assert.equal(runs.length, 2);
      assert.equal(
        runs.filter(({ status }) => status === "succeeded").length,
        1,
      );
      assert.equal(runs.filter(({ status }) => status === "unknown").length, 1);
      for (const run of runs)
        assert.equal(run.executionDisposition, "detached");
    },
  );
});

test("symlinked metadata file or parent directory fails closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-foreground-metadata-"));
  try {
    const outside = join(root, "outside.json");
    await writeFile(outside, JSON.stringify({ runId: RUN_ID, exitCode: 0 }));
    const linkedFile = join(root, METADATA_FILE);
    await symlink(outside, linkedFile);
    assert.equal(
      (await readRuns(detachedDetails(linkedFile)))[0]?.status,
      "unknown",
    );

    const realDirectory = join(root, "real");
    await mkdir(realDirectory);
    await writeFile(
      join(realDirectory, METADATA_FILE),
      JSON.stringify({ runId: RUN_ID, exitCode: 0 }),
    );
    const linkedDirectory = join(root, "linked");
    await symlink(realDirectory, linkedDirectory, "dir");
    assert.equal(
      (await readRuns(detachedDetails(join(linkedDirectory, METADATA_FILE))))[0]
        ?.status,
      "unknown",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unknown additive metadata fields are ignored while known fields hold", async () => {
  await withMetadata(
    {
      runId: RUN_ID,
      exitCode: 0,
      processSignal: null,
      error: null,
      usage: { input: 1, output: 2 },
      futureField: { nested: true },
    },
    async (metadataPath) => {
      const runs = await readRuns(detachedDetails(metadataPath));
      assert.equal(runs[0]?.status, "succeeded");
    },
  );
});

test("metadata cannot create an AgentRun without a persisted child identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-foreground-metadata-"));
  try {
    const artifacts = join(root, "subagent-artifacts");
    await mkdir(artifacts);
    await writeFile(
      join(artifacts, METADATA_FILE),
      JSON.stringify({ runId: RUN_ID, exitCode: 0 }),
    );
    const source = entries({
      mode: "single",
      runId: RUN_ID,
      results: [],
    });
    source[1] = {
      ...source[1],
      message: {
        role: "toolResult",
        toolCallId: CALL_ID,
        toolName: "subagent",
        isError: true,
        details: {},
      },
    } as SessionEntry;
    const evidence = await readSubagentEvidenceWithArchives(
      source,
      SESSION_ID,
      SESSION_FILE,
    );
    assert.deepEqual(
      reconcileAgentRuns(evidence.observations, evidence.aliases).runs,
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persisted terminal evidence still wins over metadata", async () => {
  await withMetadata({ runId: RUN_ID, exitCode: 0 }, async (metadataPath) => {
    const runs = await readRuns({
      runId: RUN_ID,
      results: [
        {
          index: 0,
          agent: "scout",
          detached: true,
          exitCode: 1,
          artifactPaths: { metadataPath },
        },
      ],
    });
    assert.equal(runs[0]?.status, "failed");
  });
});

test("a later persisted terminal observation blocks metadata enrichment", async () => {
  await withMetadata({ runId: RUN_ID, exitCode: 0 }, async (metadataPath) => {
    const source = [
      ...entries(detachedDetails(metadataPath), "call-first", "-first"),
      ...entries(
        {
          runId: RUN_ID,
          results: [
            {
              index: 0,
              agent: "scout",
              detached: true,
              exitCode: 1,
              artifactPaths: { metadataPath },
            },
          ],
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
    const runs = reconcileAgentRuns(
      evidence.observations,
      evidence.aliases,
    ).runs;
    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.executionDisposition, "detached");
    assert.equal(runs[0]?.status, "failed");
  });
});

test("private metadata payload never enters the public AgentRuns", async () => {
  await withMetadata(
    {
      runId: RUN_ID,
      exitCode: 0,
      task: "PRIVATE_TASK_SENTINEL",
      error: "PRIVATE_ERROR_SENTINEL",
      transcriptPath: "/private/transcript.jsonl",
      acceptance: { status: "rejected" },
    },
    async (metadataPath) => {
      const runs = await readRuns(detachedDetails(metadataPath));
      const serialized = JSON.stringify(runs);
      for (const privateValue of [
        metadataPath,
        RUN_ID,
        SESSION_ID,
        "PRIVATE_TASK_SENTINEL",
        "PRIVATE_ERROR_SENTINEL",
        "/private/transcript.jsonl",
      ])
        assert.equal(serialized.includes(privateValue), false);
    },
  );
});

test("keeps detached disposition through canonical report normalization", async () => {
  await withMetadata({ runId: RUN_ID, exitCode: 0 }, async (metadataPath) => {
    const details = detachedDetails(metadataPath);
    const parsed = parseSessionJsonl(sessionSource(details));
    const persistedEvidence = readSubagentEvidence(parsed.entries, parsed.id);
    const buildReport = (subagents: typeof persistedEvidence) => {
      const built = buildCanonicalSession({
        parsed,
        scope: "tree",
        leafId: null,
        evidence: { atomic: [], folded: [] },
        subagents,
      });
      if (built.state !== "ready") throw new Error("source must build");
      return toSessionReport(built.session);
    };
    const persisted = buildReport(persistedEvidence);
    const persistedRun = reconcileAgentRuns(
      persistedEvidence.observations,
      persistedEvidence.aliases,
    ).runs[0];
    assert.ok(persistedRun);
    assert.equal(persistedRun.executionDisposition, "detached");
    assert.equal(persistedRun.status, "unknown");

    const evidence = await readSubagentEvidenceWithArchives(
      parsed.entries,
      parsed.id,
      SESSION_FILE,
    );
    const enrichedRun = reconcileAgentRuns(
      evidence.observations,
      evidence.aliases,
    ).runs[0];
    assert.equal(enrichedRun?.id, persistedRun.id);
    assert.equal(enrichedRun?.executionDisposition, "detached");
    assert.equal(enrichedRun?.status, "succeeded");

    const report = buildReport(evidence);
    const run = report.agents.find(({ id }) => id === persistedRun.id);
    assert.equal(run?.id, persistedRun.id);
    assert.equal(run?.executionDisposition, "detached");
    assert.equal(run?.status, "succeeded");
    assert.deepEqual(report.usage, persisted.usage);
    assert.deepEqual(report.usageComposition, persisted.usageComposition);
    assert.deepEqual(report.agentActivity, persisted.agentActivity);
    assert.deepEqual(report.agentUsage, persisted.agentUsage);
  });
});

test("the private foreground-history bridge is no longer in the production path", async () => {
  assert.equal(
    existsSync("src/integrations/subagent-foreground-history.ts"),
    false,
    "the internal resume-bookkeeping bridge must stay deleted",
  );
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (path.endsWith(".ts")) files.push(path);
    }
  };
  walk("src");
  const offenders = files.filter(
    (file) =>
      readFileSync(file, "utf8").includes("foreground-history") ||
      readFileSync(file, "utf8").includes("async-subagent-results"),
  );
  assert.deepEqual(offenders, []);

  const root = await mkdtemp(join(tmpdir(), "inspector-legacy-history-"));
  const previous = process.env.PI_SUBAGENTS_TEMP_ROOT;
  try {
    process.env.PI_SUBAGENTS_TEMP_ROOT = root;
    await mkdir(join(root, "async-subagent-results"), { recursive: true });
    await writeFile(
      join(root, LEGACY_HISTORY_RELATIVE_PATH),
      JSON.stringify({
        version: 1,
        runs: [
          {
            runId: RUN_ID,
            mode: "single",
            cwd: "/private/worktree",
            sessionId: SESSION_ID,
            updatedAt: 1_790_323_200_500,
            children: [
              { agent: "scout", index: 0, status: "failed", exitCode: 1 },
            ],
          },
        ],
      }),
      { mode: 0o600 },
    );
    await withMetadata({ runId: RUN_ID, exitCode: 0 }, async (metadataPath) => {
      const runs = await readRuns(detachedDetails(metadataPath));
      assert.equal(runs[0]?.status, "succeeded");
    });
    const absent = await readRuns(detachedDetails());
    assert.equal(absent[0]?.status, "unknown");
  } finally {
    if (previous === undefined) delete process.env.PI_SUBAGENTS_TEMP_ROOT;
    else process.env.PI_SUBAGENTS_TEMP_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});

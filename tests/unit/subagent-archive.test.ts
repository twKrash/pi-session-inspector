import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { reconcileAgentRuns } from "../../src/core/subagent-reconciliation.ts";
import { readPublishedArchiveState } from "../../src/integrations/subagent-archive.ts";
import { readSubagentEvidenceWithArchives as readSubagentEvidenceWithArchivesForSession } from "../../src/integrations/subagents.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";
import { loadInspectorBundle } from "../../src/ui/bundle.ts";
import { loadCurrentSessionReport } from "../../src/ui/load-current.ts";

const SESSION_ID = "session-archive-test";
const readSubagentEvidenceWithArchives = (
  entries: Parameters<typeof readSubagentEvidenceWithArchivesForSession>[0],
) => readSubagentEvidenceWithArchivesForSession(entries, SESSION_ID);
const runsOf = (
  evidence: Awaited<ReturnType<typeof readSubagentEvidenceWithArchives>>,
) => reconcileAgentRuns(evidence.observations).runs;
const externallyRelevantEvidence = (
  evidence: Awaited<ReturnType<typeof readSubagentEvidenceWithArchives>>,
) => {
  const observations = [...evidence.observations];
  const reconciled = reconcileAgentRuns(observations);
  return {
    ...evidence,
    observations,
    canonicalRuns: reconciled.runs,
    reconciliationDiagnostics: reconciled.diagnostics,
  };
};
const serializeEvidence = (
  evidence: Awaited<ReturnType<typeof readSubagentEvidenceWithArchives>>,
) => JSON.stringify(externallyRelevantEvidence(evidence));

async function readFixture(): Promise<string> {
  return readFile(
    new URL(
      "../fixtures/integrations/subagent-archive-v1.json",
      import.meta.url,
    ),
    "utf8",
  );
}

test("accepts only versioned, run-matching, bounded regular-file archives", async (t) => {
  const fixture = await readFixture();
  const directory = await mkdtemp(join(tmpdir(), "inspector-archive-"));
  const relative = "archive.json";
  const good = join(directory, "archive.json");
  await writeFile(good, fixture);

  assert.equal(await readPublishedArchiveState(good, "run-a"), "available");
  assert.equal(await readPublishedArchiveState(good, "run-b"), "missing");
  assert.equal(
    await readPublishedArchiveState(join(directory, "absent.json"), "run-a"),
    "missing",
  );
  // A directory, an absent absolute path, and a relative path are rejected.
  assert.equal(await readPublishedArchiveState(directory, "run-a"), "missing");
  assert.equal(
    await readPublishedArchiveState("/home/dev/PRIVATE", "run-a"),
    "missing",
  );
  assert.equal(await readPublishedArchiveState(relative, "run-a"), "missing");
  assert.equal(await readPublishedArchiveState(undefined, "run-a"), "missing");
  assert.equal(await readPublishedArchiveState("", "run-a"), "missing");

  // A symlink to a valid archive is refused; the target itself is fine.
  const symlinkPath = join(directory, "link.json");
  await symlink(good, symlinkPath);
  assert.equal(
    await readPublishedArchiveState(symlinkPath, "run-a"),
    "missing",
  );
  assert.equal(await readPublishedArchiveState(good, "run-a"), "available");

  await writeFile(
    join(directory, "wrong-version.json"),
    JSON.stringify({ version: 2, runId: "run-a", entries: [] }),
  );
  assert.equal(
    await readPublishedArchiveState(
      join(directory, "wrong-version.json"),
      "run-a",
    ),
    "missing",
  );
  // An array is not a plain object version-1 archive.
  await writeFile(join(directory, "array.json"), JSON.stringify([]));
  assert.equal(
    await readPublishedArchiveState(join(directory, "array.json"), "run-a"),
    "missing",
  );
  await writeFile(join(directory, "not-json.json"), "not json");
  assert.equal(
    await readPublishedArchiveState(join(directory, "not-json.json"), "run-a"),
    "missing",
  );

  await writeFile(
    join(directory, "oversize.json"),
    JSON.stringify({
      version: 1,
      runId: "run-a",
      padding: "x".repeat(140 * 1024),
    }),
  );
  assert.equal(
    await readPublishedArchiveState(join(directory, "oversize.json"), "run-a"),
    "missing",
  );

  // FIFO coverage is platform-conditional: skipped where mkfifo is unavailable (e.g. Windows).
  let fifoAvailable = true;
  try {
    execFileSync("mkfifo", [join(directory, "fifo")]);
  } catch {
    fifoAvailable = false;
  }
  if (fifoAvailable) {
    assert.equal(
      await readPublishedArchiveState(join(directory, "fifo"), "run-a"),
      "missing",
    );
  } else {
    t.diagnostic("mkfifo unavailable: FIFO case skipped");
  }
});

function sessionWithArchive(archivePath: string): string {
  return [
    JSON.stringify({ type: "session", version: 3, id: "archive-wiring" }),
    JSON.stringify({
      type: "custom",
      id: "marker",
      parentId: null,
      timestamp: "2026-09-11T10:00:01.000Z",
      customType: "session-inspector:tracking-start",
      data: { schemaVersion: 1 },
    }),
    JSON.stringify({
      type: "message",
      id: "g1",
      parentId: "marker",
      timestamp: "2026-09-11T10:00:02.000Z",
      message: {
        role: "assistant",
        provider: "acme",
        model: "alpha",
        content: [{ type: "toolCall", id: "call-1", name: "subagent_wait" }],
      },
    }),
    JSON.stringify({
      type: "message",
      id: "r1",
      parentId: "g1",
      timestamp: "2026-09-11T10:00:03.000Z",
      message: {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "subagent_wait",
        isError: false,
        content: [],
        details: {
          completions: [
            {
              runId: "run-raw",
              agent: "reviewer",
              state: "complete",
              success: true,
              archivePath,
              results: [],
            },
          ],
        },
      },
    }),
  ].join("\n");
}

test("attaches archive presence per published reference without retaining values", async () => {
  const fixture = await readFixture();
  const directory = await mkdtemp(join(tmpdir(), "inspector-archive-runs-"));
  const archivePath = join(directory, "archive.json");
  await writeFile(archivePath, fixture.replace('"run-a"', '"run-raw"'));
  const present = parseSessionJsonl(sessionWithArchive(archivePath)).entries;

  const available = await readSubagentEvidenceWithArchives(present);
  const availableRuns = runsOf(available);
  assert.equal(availableRuns.length, 1);
  assert.equal(availableRuns[0]?.artifacts, "available");
  assert.equal(available.activity.calls, 1);
  assert.equal(available.state, "supported");

  // The published path, raw run id, and archive entry fields never leave.
  const serialized = serializeEvidence(available);
  assert.equal(serialized.includes(archivePath), false);
  assert.equal(serialized.includes("run-raw"), false);
  assert.equal(serialized.includes("/home/dev/PRIVATE"), false);

  await rm(archivePath, { force: true });
  const missing = await readSubagentEvidenceWithArchives(present);
  assert.equal(runsOf(missing)[0]?.artifacts, "missing");
  // Absence never fabricates `available`, and native activity is unchanged.
  assert.equal(missing.activity.calls, 1);
  assert.equal(missing.state, "supported");
});

test("leaves artifacts absent for runs without a published reference", async () => {
  const entries = parseSessionJsonl(
    [
      JSON.stringify({ type: "session", version: 3, id: "s" }),
      JSON.stringify({
        type: "message",
        id: "m1",
        parentId: null,
        timestamp: "2026-09-11T10:00:00.000Z",
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
        timestamp: "2026-09-11T10:00:01.000Z",
        message: {
          role: "toolResult",
          toolCallId: "c1",
          toolName: "subagent",
          isError: false,
          content: [],
          details: {
            runId: "agg-run",
            results: [{ index: 0, agent: "worker", exitCode: 0 }],
          },
        },
      }),
    ].join("\n"),
  ).entries;

  const evidence = await readSubagentEvidenceWithArchives(entries);
  assert.equal(runsOf(evidence).length, 1);
  assert.equal(runsOf(evidence)[0]?.artifacts, undefined);
});

test("follows only the completion surface and ignores a results-row archivePath", async () => {
  const fixture = await readFixture();
  const directory = await mkdtemp(
    join(tmpdir(), "inspector-archive-boundary-"),
  );
  const archivePath = join(directory, "run-raw.json");
  await writeFile(archivePath, fixture.replace('"run-a"', '"run-raw"'));
  const entries = parseSessionJsonl(
    [
      JSON.stringify({ type: "session", version: 3, id: "s" }),
      JSON.stringify({
        type: "message",
        id: "m1",
        parentId: null,
        timestamp: "2026-09-11T10:00:00.000Z",
        message: {
          role: "assistant",
          provider: "acme",
          model: "alpha",
          content: [{ type: "toolCall", id: "c1", name: "subagent_wait" }],
        },
      }),
      JSON.stringify({
        type: "message",
        id: "m2",
        parentId: "m1",
        timestamp: "2026-09-11T10:00:01.000Z",
        message: {
          role: "toolResult",
          toolCallId: "c1",
          toolName: "subagent_wait",
          isError: false,
          content: [],
          details: {
            runId: "aggregate-run",
            completions: [
              {
                runId: "run-raw",
                agent: "reviewer",
                success: true,
                archivePath,
              },
            ],
            results: [
              {
                index: 0,
                agent: "worker",
                exitCode: 0,
                archivePath,
              },
            ],
          },
        },
      }),
    ].join("\n"),
  ).entries;

  const evidence = await readSubagentEvidenceWithArchives(entries);

  const reviewer = runsOf(evidence).find((run) => run.agent === "reviewer");
  const worker = runsOf(evidence).find((run) => run.agent === "worker");
  assert.equal(runsOf(evidence).length, 2);
  // The completion reference is validated and published.
  assert.equal(reviewer?.artifacts, "available");
  // A results-row reference is deliberately not followed: absent, not "missing".
  assert.equal(worker?.artifacts, undefined);
  assert.equal(serializeEvidence(evidence).includes(archivePath), false);
});

test("a rejected or non-absolute reference yields missing for that run only", async () => {
  const fixture = await readFixture();
  const directory = await mkdtemp(join(tmpdir(), "inspector-archive-mixed-"));
  const good = join(directory, "good.json");
  await writeFile(good, fixture.replace('"run-a"', '"run-present"'));
  const entries = parseSessionJsonl(
    [
      JSON.stringify({ type: "session", version: 3, id: "s" }),
      JSON.stringify({
        type: "message",
        id: "m1",
        parentId: null,
        timestamp: "2026-09-11T10:00:00.000Z",
        message: {
          role: "assistant",
          provider: "acme",
          model: "alpha",
          content: [{ type: "toolCall", id: "c1", name: "subagent_wait" }],
        },
      }),
      JSON.stringify({
        type: "message",
        id: "m2",
        parentId: "m1",
        timestamp: "2026-09-11T10:00:01.000Z",
        message: {
          role: "toolResult",
          toolCallId: "c1",
          toolName: "subagent_wait",
          isError: false,
          content: [],
          details: {
            completions: [
              {
                runId: "run-present",
                agent: "a",
                success: true,
                archivePath: good,
              },
              {
                runId: "run-relative",
                agent: "b",
                success: true,
                archivePath: "relative.json",
              },
              {
                runId: "run-missing",
                agent: "c",
                success: true,
                archivePath: join(directory, "absent.json"),
              },
              {
                runId: "run-oversize",
                agent: "d",
                success: true,
                archivePath: `/${"a".repeat(5000)}`,
              },
            ],
          },
        },
      }),
    ].join("\n"),
  ).entries;

  const evidence = await readSubagentEvidenceWithArchives(entries);
  assert.deepEqual(
    runsOf(evidence).map((run) => run.artifacts),
    ["available", "missing", "missing", undefined],
  );
});

test("bundle current report carries the same archive verdict as direct current loading", async () => {
  const fixture = await readFixture();
  const directory = await mkdtemp(join(tmpdir(), "inspector-archive-bundle-"));
  const sessionFile = join(directory, "session.jsonl");
  const archives = join(directory, "output-archives");
  const archivePath = join(archives, "run-raw.json");
  await mkdir(archives, { recursive: true });
  await writeFile(archivePath, fixture.replace('"run-a"', '"run-raw"'));
  await writeFile(sessionFile, sessionWithArchive(archivePath));
  const archiveProvider = readSubagentEvidenceWithArchivesForSession;
  const direct = await loadCurrentSessionReport(sessionFile, "active", {
    leafId: "r1",
    subagentEvidence: archiveProvider,
  });
  assert.ok(direct);

  const bundle = await loadInspectorBundle({
    theme: "light",
    initialScope: "active",
    root: directory,
    sessionDirectory: () => directory,
    maintenance: {
      writerId: "maintenance-bundle",
      now: () => new Date("2026-09-12T12:00:00.000Z"),
      isPidAlive: () => false,
    },
    current: { sessionFile, leafId: "r1" },
    subagentEvidence: archiveProvider,
    loadHistory: async () => ({
      availability: "unavailable" as const,
      sessions: [],
      diagnostics: [],
    }),
    loadGlobal: async () => ({
      availability: "unavailable" as const,
      sessions: [],
      usage: { totalTokens: 0, cost: 0 },
      dates: [],
      diagnostics: [],
      inventory: { commands: null, skills: null, resources: null },
    }),
  });
  assert.equal(
    bundle.current.active.report?.agents[0]?.artifacts,
    direct.report.agents[0]?.artifacts,
  );
  assert.equal(bundle.current.active.report?.agents[0]?.artifacts, "available");
  await rm(directory, { recursive: true, force: true });
});

test("production report path consumes archive enrichment", async () => {
  const fixture = await readFixture();
  const directory = await mkdtemp(join(tmpdir(), "inspector-archive-wire-"));
  const sessionFile = join(directory, "session.jsonl");
  const archives = join(directory, "output-archives");
  const archivePath = join(archives, "run-raw.json");
  await mkdir(archives, { recursive: true });
  await writeFile(archivePath, fixture.replace('"run-a"', '"run-raw"'));
  await writeFile(sessionFile, sessionWithArchive(archivePath));

  const model = await loadCurrentSessionReport(sessionFile, "active", {
    leafId: "r1",
    // Archive I/O belongs to the composition-root seam, not this loader.
    subagentEvidence: readSubagentEvidenceWithArchivesForSession,
  });
  assert.ok(model);
  assert.equal(model.report.agents.length, 1);
  assert.equal(model.report.agents[0]?.artifacts, "available");
  assert.equal(model.report.agentEvidence, "supported");
  assert.equal(model.report.agentActivity.calls, 1);
  const serializedReport = JSON.stringify(model.report);
  for (const privateValue of [
    archivePath,
    "run-raw",
    "run-a",
    "run-b",
    "/home/dev/PRIVATE",
  ]) {
    assert.equal(serializedReport.includes(privateValue), false);
  }
  // P1.2: the health the same DTO publishes must see the cooperative evidence
  // class the body reports, not an empty L1 agent list.
  assert.equal(
    model.report.evidenceHealth.joins.agentRuns,
    model.report.agents.length,
  );
  assert.equal(
    model.report.evidenceHealth.sources.some(
      (row) => row.source === "subagent-result",
    ),
    true,
  );

  await rm(archivePath, { force: true });
  const missing = await loadCurrentSessionReport(sessionFile, "active", {
    leafId: "r1",
    subagentEvidence: readSubagentEvidenceWithArchivesForSession,
  });
  assert.equal(missing?.report.agents[0]?.artifacts, "missing");
  assert.equal(missing?.report.agentEvidence, "supported");
  assert.equal(missing?.report.agentActivity.calls, 1);

  // Native activity is unchanged by archive absence (agentActivity.calls stays 1).
  const entries = parseSessionJsonl(
    await readFile(sessionFile, "utf8"),
  ).entries;
  const evidence = await readSubagentEvidenceWithArchives(entries);
  assert.equal(evidence.activity.calls, 1);
  assert.equal(runsOf(evidence).length, 1);
});

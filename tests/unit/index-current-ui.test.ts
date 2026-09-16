import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type {
  FoldedAggregateEvidence,
  LiveTimingObservation,
} from "../../src/core/evidence.ts";
import { canonicalOpaqueDigest } from "../../src/core/opaque-id.ts";
import registerSessionInspector, {
  readLiveTimings,
  registerTracking,
} from "../../src/index.ts";
import { renderJson } from "../../src/ui/json.ts";
import { loadCurrentSessionReport } from "../../src/ui/load-current.ts";
import { renderSnapshot } from "../../src/ui/snapshot.ts";
import { projectCurrentView } from "../../src/ui/ui-projection.ts";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

type CommandHandler = (
  args: string,
  ctx: ExtensionCommandContext,
) => Promise<void>;
type CustomFactory = Parameters<ExtensionCommandContext["ui"]["custom"]>[0];

function registerCommand(handlerRef: { current?: CommandHandler }): void {
  registerSessionInspector({
    on: () => {},
    registerCommand: (name: string, command: { handler: CommandHandler }) => {
      if (name === "session-inspector") handlerRef.current = command.handler;
    },
  } as unknown as ExtensionAPI);
}

test("loaders never import storage readers", async () => {
  const currentSource = await readFile("src/ui/load-current.ts", "utf8");
  assert.equal(
    /readCheckpoint|recoverSession|readInventorySnapshot|readWal/.test(
      currentSource,
    ),
    false,
  );
  // Not just the named readers: no storage module reaches L2 at all.
  assert.equal(/from "\.\.\/storage\//.test(currentSource), false);

  const historySource = await readFile("src/ui/load-history.ts", "utf8");
  for (const source of [currentSource, historySource]) {
    assert.equal(
      /readSubagentEvidenceWithArchives|subagent-archive|readPublishedArchiveState/.test(
        source,
      ),
      false,
    );
    assert.equal(/readPiEntryEvidence|reduceEntries\(/.test(source), false);
    assert.equal((source.match(/buildCanonicalSession\(/g) ?? []).length, 1);
  }
});

test("overflow usage remains unavailable through the snapshot and JSON production paths", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const sessionFile = join(directory, "overflow-session.jsonl");
  const max = Number.MAX_SAFE_INTEGER;
  await writeFile(
    sessionFile,
    [
      JSON.stringify({
        type: "session",
        version: 3,
        id: "overflow-session",
        timestamp: "2026-01-01T00:00:00.000Z",
      }),
      JSON.stringify({
        type: "custom",
        id: "tracking-marker",
        parentId: null,
        timestamp: "2026-01-01T00:00:01.000Z",
        customType: "session-inspector:tracking-start",
        data: { schemaVersion: 1 },
      }),
      JSON.stringify({
        type: "message",
        id: "overflow-1",
        parentId: "tracking-marker",
        timestamp: "2026-01-01T00:00:02.000Z",
        message: {
          role: "assistant",
          provider: "acme",
          model: "alpha",
          usage: { totalTokens: max, cost: { total: 0.01 } },
        },
      }),
      JSON.stringify({
        type: "message",
        id: "overflow-2",
        parentId: "overflow-1",
        timestamp: "2026-01-01T00:00:03.000Z",
        message: {
          role: "assistant",
          provider: "acme",
          model: "alpha",
          usage: { totalTokens: max, cost: { total: 0.02 } },
        },
      }),
    ].join("\n") + "\n",
  );
  try {
    const model = await loadCurrentSessionReport(sessionFile, "tree", {
      leafId: null,
      evidence: { atomic: [], folded: [] },
    });
    assert.ok(model);
    const report = model.report;
    // The one production renderer: the same projection the `snapshot` command
    // and the `/api/v1/ui` payload publish.
    const projection = projectCurrentView(
      { availability: "available", report, daily: [] },
      "tree",
    );
    const snapshot = renderSnapshot({
      kind: "current",
      schemaVersion: 1,
      theme: "light",
      projection,
    });
    assert.match(snapshot, /Usage unavailable/);
    assert.equal(projection.report?.usage, undefined);
    const json = JSON.parse(renderJson(report)) as Record<string, unknown>;
    assert.equal(Object.hasOwn(json, "usage"), false);
    assert.equal(Object.hasOwn(json, "usageComposition"), false);
    assert.equal(report.usage, undefined);
    assert.equal(report.usageComposition, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("current loader maps a duplicated tree id to its first parsed entry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const sessionFile = join(directory, "duplicate-session.jsonl");
  await writeFile(
    sessionFile,
    [
      JSON.stringify({
        type: "session",
        version: 3,
        id: "duplicate-session",
        timestamp: "2026-01-01T00:00:00.000Z",
      }),
      JSON.stringify({
        type: "custom",
        id: "tracking-marker",
        parentId: null,
        timestamp: "2026-01-01T00:00:01.000Z",
        customType: "session-inspector:tracking-start",
        data: { schemaVersion: 1 },
      }),
      JSON.stringify({
        type: "message",
        id: "duplicate-generation",
        parentId: "tracking-marker",
        timestamp: "2026-01-01T00:00:02.000Z",
        message: {
          role: "assistant",
          provider: "acme",
          model: "alpha",
          usage: { totalTokens: 7, cost: { total: 0.07 } },
        },
      }),
      JSON.stringify({
        type: "message",
        id: "duplicate-generation",
        parentId: "tracking-marker",
        timestamp: "2026-01-01T00:00:03.000Z",
        message: {
          role: "assistant",
          provider: "acme",
          model: "alpha",
          usage: { totalTokens: 99, cost: { total: 0.99 } },
        },
      }),
    ].join("\n") + "\n",
  );
  try {
    const model = await loadCurrentSessionReport(sessionFile, "tree", {
      leafId: null,
      evidence: { atomic: [], folded: [] },
    });
    assert.ok(model);
    assert.equal(model.report.generations.length, 1);
    assert.equal(model.report.usage?.totalTokens, 7);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("current report is produced from supplied L0 evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const sessionFile = join(directory, "session.jsonl");
  await writeFile(
    sessionFile,
    [
      '{"type":"session","version":3,"id":"fixture-session"}',
      '{"type":"custom","id":"tracking-marker","parentId":null,"timestamp":"2026-01-01T00:00:00.000Z","customType":"session-inspector:tracking-start","data":{"schemaVersion":1}}',
      '{"type":"message","id":"entry-1","parentId":null,"timestamp":"2026-01-01T00:00:00.000Z","message":{"role":"assistant","provider":"acme","model":"alpha","usage":{"totalTokens":7,"cost":{"total":0.01}}}}',
    ].join("\n"),
  );

  const model = await loadCurrentSessionReport(sessionFile, "tree", {
    leafId: null,
    evidence: { atomic: [], folded: [] },
  });
  assert.equal(model?.report.evidenceHealth.core, "supported");
  // The report body still reduces the builder-resolved entries.
  assert.equal(model?.report.usage?.totalTokens, 7);

  // The canonical builder owns availability: an untracked session and an
  // unsupported format stay undefined exactly as before.
  await writeFile(
    sessionFile,
    '{"type":"session","version":3,"id":"fixture-session"}\n',
  );
  assert.equal(
    await loadCurrentSessionReport(sessionFile, "tree", {
      leafId: null,
      evidence: { atomic: [], folded: [] },
    }),
    undefined,
  );
  await writeFile(
    sessionFile,
    [
      '{"type":"session","version":2,"id":"fixture-session"}',
      '{"type":"custom","id":"tracking-marker","parentId":null,"timestamp":"2026-01-01T00:00:00.000Z","customType":"session-inspector:tracking-start","data":{"schemaVersion":1}}',
      '{"type":"message","id":"entry-1","parentId":null,"timestamp":"2026-01-01T00:00:00.000Z"}',
    ].join("\n"),
  );
  assert.equal(
    await loadCurrentSessionReport(sessionFile, "tree", {
      leafId: null,
      evidence: { atomic: [], folded: [] },
    }),
    undefined,
  );

  // A malformed trailing line is a *partial* source, not an unavailable
  // session: the builder keeps the understood facts and reports partial health
  // (the old pre-builder gate hid the whole session).
  await writeFile(
    sessionFile,
    [
      '{"type":"session","version":3,"id":"fixture-session"}',
      '{"type":"custom","id":"tracking-marker","parentId":null,"timestamp":"2026-01-01T00:00:00.000Z","customType":"session-inspector:tracking-start","data":{"schemaVersion":1}}',
      '{"type":"message","id":"entry-1","parentId":null,"timestamp":"2026-01-01T00:00:00.000Z","message":{"role":"assistant","provider":"acme","model":"alpha","usage":{"totalTokens":7,"cost":{"total":0.01}}}}',
      "{ malformed JSONL",
    ].join("\n"),
  );
  const partial = await loadCurrentSessionReport(sessionFile, "tree", {
    leafId: null,
    evidence: { atomic: [], folded: [] },
  });
  assert.equal(partial?.report.evidenceHealth.core, "partial");
  assert.equal(partial?.report.usage?.totalTokens, 7);
});

/**
 * Task 15 carry: recovery validates a WAL record timestamp with `Date.parse`
 * plus a length bound, which also accepts non-ISO forms. An L0 fact's time is a
 * normative instant (`wal-observer`), so the derivation must apply the repo's
 * ISO-instant grammar instead of copying whatever parsed.
 */
test("live timing facts derive a known time only from a bounded ISO instant", () => {
  const timing = {
    category: "turn" as const,
    status: "unknown" as const,
    confidence: "live" as const,
    startedAt: "2026-09-11T10:00:00Z",
    endedAt: "2026-09-11T10:00:05Z",
    durationMs: 5000,
  };
  const record = (eventId: string, timestamp: string) => ({
    eventId,
    timestamp,
    writerId: "writer-live",
    writerSequence: 1,
    kind: "live_timing" as const,
    timing,
  });

  const facts = readLiveTimings({
    sessionId: SESSION_ID,
    records: [
      record("live-iso", "2026-09-11T10:00:05Z"),
      // `Date.parse` accepts all of these; the ISO grammar does not.
      record("live-loose", "2026 Sep 11 10:00:05"),
      record("live-slashes", "2026/09/11 10:00:05"),
    ],
    running: [],
  });

  assert.deepEqual(
    facts.map((fact) => [fact.factId, fact.time]),
    [
      [
        "live-timing:live-iso",
        {
          state: "known",
          at: "2026-09-11T10:00:05Z",
          basis: "wal-observer",
        },
      ],
      // The fact survives (it is real live evidence) but publishes no
      // unvalidated instant as its normative time.
      ["live-timing:live-loose", { state: "unavailable" }],
      ["live-timing:live-slashes", { state: "unavailable" }],
    ],
  );
  assert.equal(facts.length, 3);
});

test("derives live timing facts from validated WAL records and correlates tool durations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const sessionFile = join(directory, "session.jsonl");
  const root = join(directory, "session-inspector", "v1");
  const output = join(directory, "report.json");
  const toolCallId = "call-1";
  await writeFile(
    sessionFile,
    [
      '{"type":"session","version":3,"id":"fixture-session"}',
      '{"type":"custom","id":"tracking-marker","parentId":null,"timestamp":"2026-09-11T09:59:00Z","customType":"session-inspector:tracking-start","data":{"schemaVersion":1}}',
      `{"type":"message","id":"entry-1","parentId":"tracking-marker","timestamp":"2026-09-11T10:00:00Z","message":{"role":"assistant","provider":"acme","model":"alpha","content":[{"type":"toolCall","id":"${toolCallId}","name":"read","arguments":{}}],"usage":{"totalTokens":9,"cost":{"total":0.02}}}}`,
    ].join("\n"),
  );
  // The live producer keys a tool boundary by the canonical subject digest of
  // the native call id; only that exact correlation may produce a duration.
  const subjectId = `live-tool-${canonicalOpaqueDigest("live-tool", SESSION_ID, toolCallId)}`;
  const shard = join(root, "sessions", SESSION_ID, "wal", "writer-live");
  await mkdir(shard, { recursive: true });
  await writeFile(
    join(shard, "2026-09-11.jsonl"),
    `${JSON.stringify({
      eventId: "live-1",
      timestamp: "2026-09-11T10:00:05Z",
      writerId: "writer-live",
      writerSequence: 1,
      kind: "live_timing",
      timing: {
        category: "tool",
        status: "unknown",
        confidence: "live",
        subjectId,
        startedAt: "2026-09-11T10:00:00Z",
        endedAt: "2026-09-11T10:00:05Z",
        durationMs: 5000,
      },
    })}\n`,
  );

  const handlerRef: { current?: CommandHandler } = {};
  registerCommand(handlerRef);
  assert.ok(handlerRef.current);
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = directory;
  try {
    await handlerRef.current(`json --output "${output}"`, {
      mode: "interactive",
      sessionManager: {
        getSessionId: () => SESSION_ID,
        getLeafId: () => "entry-1",
        getSessionFile: () => sessionFile,
        getSessionDir: () => directory,
      },
      ui: {
        notify: () => assert.fail("must export the current session report"),
        custom: async () => assert.fail("must export the current report"),
      },
    } as unknown as ExtensionCommandContext);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  }

  const report = JSON.parse(await readFile(output, "utf8")) as {
    tools: readonly { id: string; durationMs?: number }[];
    durationEvidence: string;
    evidenceHealth: {
      sources: readonly {
        source: string;
        state: string;
        factsAccepted: number;
      }[];
      joins: { toolCalls: number; matchedLiveToolTimings: number };
    };
  };
  // The completed live boundary becomes one L0 fact and correlates to the
  // native tool call through the shared digest, never through a name or time.
  assert.equal(report.tools[0]?.durationMs, 5000);
  assert.equal(report.durationEvidence, "supported");
  const wal = report.evidenceHealth.sources.find(
    (row) => row.source === "inspector-wal",
  );
  assert.equal(wal?.state, "supported");
  assert.equal(wal?.factsAccepted, 1);
  assert.equal(report.evidenceHealth.joins.toolCalls, 1);
  assert.equal(report.evidenceHealth.joins.matchedLiveToolTimings, 1);
});

test("keeps the live registration so a dropped tool start marks live evidence partial", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = directory;
  const sessionDirectory = join(directory, "native");
  await mkdir(sessionDirectory, { recursive: true });
  const sessionFile = join(sessionDirectory, "session.jsonl");
  await writeFile(sessionFile, sessionSource);
  const output = join(directory, "report.json");
  const hooks = new Map<string, (...args: unknown[]) => Promise<void>>();
  const handlers = new Map<string, CommandHandler>();
  try {
    registerSessionInspector({
      on: (event: string, handler: (...args: unknown[]) => Promise<void>) => {
        hooks.set(event, handler);
      },
      registerCommand: (name: string, command: { handler: CommandHandler }) => {
        handlers.set(name, command.handler);
      },
      getCommands: () => [],
      getAllTools: () => [],
      appendEntry: () => {},
      exec: async () => ({ code: 0, killed: false, stdout: "", stderr: "" }),
    } as unknown as ExtensionAPI);
    await hooks.get("session_start")?.(
      {},
      {
        sessionManager: {
          getSessionId: () => SESSION_ID,
          getSessionFile: () => sessionFile,
          getSessionDir: () => sessionDirectory,
        },
      },
    );
    // Live observation is registered during the (detached) promotion.
    for (
      let attempt = 0;
      attempt < 100 && !hooks.has("tool_execution_start");
      attempt++
    ) {
      await sleep(10);
    }
    const start = hooks.get("tool_execution_start");
    const end = hooks.get("tool_execution_end");
    assert.ok(start && end, "live observation must be registered");
    // 65 overlapping tools: the open-subject bound is 64, so the 65th start is
    // dropped and saturates the registration's overflow counter (R29).
    for (let index = 0; index < 65; index++) {
      await start({
        kind: "tool_execution_start",
        toolCallId: `call-${index}`,
      });
    }
    for (let index = 0; index < 65; index++) {
      await end({ kind: "tool_execution_end", toolCallId: `call-${index}` });
    }
    // Appends are detached microtasks; the command then flushes the writer.
    await sleep(50);

    await handlers.get("session-inspector")?.(
      `json --scope tree --output "${output}"`,
      {
        mode: "interactive",
        sessionManager: {
          getSessionId: () => SESSION_ID,
          getLeafId: () => null,
          getSessionFile: () => sessionFile,
          getSessionDir: () => sessionDirectory,
        },
        ui: {
          notify: () => assert.fail("must export the current session report"),
          custom: async () => assert.fail("must export the current report"),
        },
      } as unknown as ExtensionCommandContext,
    );

    const report = JSON.parse(await readFile(output, "utf8")) as {
      durationEvidence: string;
      evidenceHealth: {
        sources: readonly {
          source: string;
          state: string;
          recordsSeen: number;
          factsAccepted: number;
        }[];
      };
    };
    const wal = report.evidenceHealth.sources.find(
      (row) => row.source === "inspector-wal",
    );
    // The live producer's own WAL records reach L0 through the composition
    // root: 64 paired tool boundaries are 64 completed facts over 128 records.
    // The 65th start was dropped, so the registration's overflow counter is
    // what makes this source partial — the paired starts no longer do (P1.3),
    // which makes this assertion the end-to-end R29 discriminator.
    assert.equal(wal?.factsAccepted, 64);
    assert.equal(wal?.recordsSeen, 128);
    assert.equal(wal?.state, "partial");
    assert.equal(report.durationEvidence, "unavailable");
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(directory, { recursive: true, force: true });
  }
});

test("stamps the session-start inventory snapshot with its observation time", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const sessionDirectory = join(directory, "native");
  await mkdir(sessionDirectory, { recursive: true });
  const sessionFile = join(sessionDirectory, "session.jsonl");
  await writeFile(sessionFile, sessionSource);
  // Production tracking creates the Inspector session directory before the
  // session-start capture writes into it.
  await mkdir(
    join(directory, "session-inspector", "v1", "sessions", "stamped-session"),
    { recursive: true },
  );

  let handler:
    | ((event: unknown, context: unknown) => Promise<void>)
    | undefined;
  let schedules = 0;
  registerTracking(
    {
      on: (
        event: string,
        registered: (event: unknown, context: unknown) => Promise<void>,
      ) => {
        // Pi registers several lifecycle handlers, so the stub keys by event.
        if (event === "session_start") handler = registered;
      },
      appendEntry: () => {},
      getCommands: () => [
        {
          name: "ponytail",
          source: "extension",
          sourceInfo: {
            source: "local",
            scope: "user",
            origin: "top-level",
          },
        },
      ],
      getAllTools: () => [],
    } as unknown as Parameters<typeof registerTracking>[0],
    {
      agentDir: directory,
      track: async () => true,
      setupSessionWal: async () => {},
      schedule: () => {
        schedules += 1;
      },
    },
  );
  assert.ok(handler);
  await handler(
    {},
    {
      sessionManager: {
        getSessionId: () => "stamped-session",
        getSessionFile: () => sessionFile,
        getSessionDir: () => sessionDirectory,
      },
    },
  );

  // The capture is detached; the file appearing is the completion signal.
  const snapshotPath = join(
    directory,
    "session-inspector",
    "v1",
    "sessions",
    "stamped-session",
    "inventory.json",
  );
  let bytes: string | undefined;
  for (let attempt = 0; attempt < 100 && bytes === undefined; attempt++) {
    try {
      bytes = await readFile(snapshotPath, "utf8");
    } catch {
      await sleep(10);
    }
  }
  assert.ok(bytes, "the session-start capture must persist its snapshot");
  const snapshot = JSON.parse(bytes) as { observedAt?: unknown };
  // R37: a successful session-start observation is stamped, so retention and
  // the §14.2 freshness contract never depend on a later report load.
  assert.equal(typeof snapshot.observedAt, "string");
  assert.equal(Number.isNaN(Date.parse(snapshot.observedAt as string)), false);
  assert.equal(schedules, 1);
});

test("threads the live overflow count into the live-source partiality", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const sessionFile = join(directory, "session.jsonl");
  await writeFile(sessionFile, sessionSource);
  // One completed boundary: no running fact and no native tool call exists, so
  // the only signal left is the registration's dropped-start count.
  const fact: LiveTimingObservation = {
    factId: "live-timing:live-1",
    sessionId: SESSION_ID,
    kind: "live-timing",
    category: "turn",
    status: "complete",
    startedAt: "2026-09-11T10:00:00Z",
    endedAt: "2026-09-11T10:00:05Z",
    durationMs: 5000,
    provenance: {
      source: "inspector-wal",
      authority: "live",
      recordId: "live-1",
      schemaVersion: 1,
    },
    time: { state: "known", at: "2026-09-11T10:00:05Z", basis: "wal-observer" },
  };
  const liveState = async (
    liveOverflow: number | undefined,
  ): Promise<string | undefined> => {
    const model = await loadCurrentSessionReport(sessionFile, "active", {
      leafId: "entry-1",
      evidence: { atomic: [fact], folded: [] },
      ...(liveOverflow === undefined ? {} : { liveOverflow }),
    });
    return model?.report.evidenceHealth.sources.find(
      (row) => row.source === "inspector-wal",
    )?.state;
  };

  assert.equal(await liveState(undefined), "supported");
  assert.equal(await liveState(0), "supported");
  assert.equal(await liveState(1), "partial");
});

test("loads a durable current session report and leaves ephemeral sessions unavailable", async () => {
  assert.equal(
    await loadCurrentSessionReport(undefined, "active", { leafId: null }),
    undefined,
  );

  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const file = join(directory, "session.jsonl");
  await writeFile(
    file,
    [
      '{"type":"session","version":3,"id":"fixture-session"}',
      '{"type":"custom","id":"tracking-marker","parentId":null,"timestamp":"2026-01-01T00:00:00.000Z","customType":"session-inspector:tracking-start","data":{"schemaVersion":1}}',
      '{"type":"message","id":"entry-1","parentId":null,"timestamp":"2026-01-01T00:00:00.000Z","message":{"role":"assistant","provider":"acme","model":"alpha","usage":{"totalTokens":7,"cost":{"total":0.01}}}}',
    ].join("\n"),
  );

  const model = await loadCurrentSessionReport(file, "active", {
    leafId: "entry-1",
  });
  assert.equal(model?.report.sessionId, "fixture-session");
  assert.equal(model?.scope, "active");
  assert.deepEqual(model?.report.agents, []);
  assert.equal(model?.report.agentEvidence, "unavailable");
  assert.deepEqual(model?.report.integrations, []);

  // A structurally valid session without a tracking marker is unavailable, so
  // an all-zero report can never masquerade as a real one.
  await writeFile(
    file,
    [
      '{"type":"session","version":3,"id":"fixture-session"}',
      '{"type":"message","id":"entry-1","parentId":null,"timestamp":"2026-01-01T00:00:00.000Z","message":{"role":"assistant","provider":"acme","model":"alpha","usage":{"totalTokens":7,"cost":{"total":0.01}}}}',
    ].join("\n"),
  );
  assert.equal(
    await loadCurrentSessionReport(file, "active", { leafId: "entry-1" }),
    undefined,
  );
  assert.equal(
    await loadCurrentSessionReport(file, "tree", { leafId: null }),
    undefined,
  );

  // A marker whose id cannot anchor a boundary (empty here, an over-bound id
  // would resolve identically) must make the report unavailable, not all-zero.
  await writeFile(
    file,
    [
      '{"type":"session","version":3,"id":"fixture-session"}',
      '{"type":"custom","id":"","parentId":null,"timestamp":"2026-01-01T00:00:00.000Z","customType":"session-inspector:tracking-start","data":{"schemaVersion":1}}',
      '{"type":"message","id":"entry-1","parentId":null,"timestamp":"2026-01-01T00:00:00.000Z","message":{"role":"assistant","provider":"acme","model":"alpha","usage":{"totalTokens":7,"cost":{"total":0.01}}}}',
    ].join("\n"),
  );
  assert.equal(
    await loadCurrentSessionReport(file, "active", { leafId: "entry-1" }),
    undefined,
  );
  assert.equal(
    await loadCurrentSessionReport(file, "tree", { leafId: null }),
    undefined,
  );

  await writeFile(file, '{"type":"message"}\n');
  assert.equal(
    await loadCurrentSessionReport(file, "active", { leafId: null }),
    undefined,
  );
  await writeFile(file, '{"type":"session","id":""}\n');
  assert.equal(
    await loadCurrentSessionReport(file, "active", { leafId: null }),
    undefined,
  );
  await writeFile(file, "not JSONL\n");
  assert.equal(
    await loadCurrentSessionReport(file, "active", { leafId: null }),
    undefined,
  );
  await writeFile(
    file,
    [
      '{"type":"session","version":3,"id":"fixture-session"}',
      '{"type":"message","id":"entry-1","parentId":null,"timestamp":"2026-01-01T00:00:00.000Z"}',
      "{ malformed JSONL",
    ].join("\n"),
  );
  assert.equal(
    await loadCurrentSessionReport(file, "active", { leafId: "entry-1" }),
    undefined,
  );
});

test("projects persisted Pi-entry integration evidence in the production loader", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const file = join(directory, "session.jsonl");
  await writeFile(
    file,
    [
      '{"type":"session","version":3,"id":"fixture-session"}',
      '{"type":"custom","id":"tracking-marker","parentId":null,"timestamp":"2026-01-01T00:00:00.000Z","customType":"session-inspector:tracking-start","data":{"schemaVersion":1}}',
      '{"type":"custom","id":"context-1","parentId":null,"timestamp":"2026-01-01T00:00:00.000Z","customType":"ctx_status","data":{"schemaVersion":1,"active":true}}',
    ].join("\n"),
  );

  const model = await loadCurrentSessionReport(file, "tree", { leafId: null });
  assert.deepEqual(model?.report.integrations, [
    {
      integration: "context",
      presence: "present",
      version: 1,
      state: "supported",
      counters: { calls: 1 },
    },
  ]);
  assert.equal(model?.report.agentEvidence, "unavailable");
});

test("renders an unknown known-integration version as Unsupported in the production TUI", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const file = join(directory, "session.jsonl");
  await writeFile(
    file,
    [
      '{"type":"session","version":3,"id":"fixture-session"}',
      '{"type":"custom","id":"tracking-marker","parentId":null,"timestamp":"2026-01-01T00:00:00.000Z","customType":"session-inspector:tracking-start","data":{"schemaVersion":1}}',
      '{"type":"message","id":"rtk-1","parentId":null,"timestamp":"2026-01-01T00:00:00.000Z","message":{"details":{"rtkCompaction":{"schemaVersion":99,"sourceChars":100,"compactedChars":50,"sourceLines":10,"compactedLines":5,"truncated":false}}}}',
    ].join("\n"),
  );

  const handlerRef: { current?: CommandHandler } = {};
  registerCommand(handlerRef);
  assert.ok(handlerRef.current);
  await handlerRef.current("", {
    mode: "tui",
    sessionManager: {
      getLeafId: () => "rtk-1",
      getSessionFile: () => file,
    },
    ui: {
      notify: () => assert.fail("must load the persisted integration evidence"),
      custom: async (factory: CustomFactory) => {
        const component = await factory(
          { requestRender: () => {} } as never,
          { fg: (_color: string, text: string) => text } as never,
          undefined as never,
          () => {},
        );
        for (let index = 0; index < 6; index++)
          component.handleInput?.("\u001B[C");
        const rendered = component.render(120);
        assert.ok(rendered.includes("Integration: rtk"));
        assert.ok(rendered.includes("Status: Unsupported"));
        assert.equal(rendered.includes("Unavailable"), false);
      },
    },
  } as unknown as ExtensionCommandContext);
});

test("auto-discovers subagent runs from persisted tool results in the production loader", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const file = join(directory, "session.jsonl");
  await writeFile(
    file,
    await readFile(
      "tests/fixtures/pi/0.85.1/subagent-tool-results.jsonl",
      "utf8",
    ),
  );

  const model = await loadCurrentSessionReport(file, "active", {
    leafId: "g3",
  });

  assert.equal(model?.report.agentEvidence, "supported");
  assert.equal(model?.report.agents.length, 2);
  assert.equal(
    model?.report.agents.some((run) => run.agent === "reviewer"),
    true,
  );
  // Child usage is a breakdown: session totals only count persisted Pi usage.
  assert.equal(model?.report.usage?.totalTokens, 1515);
});

test("uses Pi's active leaf rather than the latest appended branch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const file = join(directory, "branching.jsonl");
  await writeFile(
    file,
    await readFile("tests/fixtures/pi/0.85.1/branching.jsonl", "utf8"),
  );

  const model = await loadCurrentSessionReport(file, "active", {
    leafId: "e6",
  });
  assert.equal(model?.report.usage?.totalTokens, 42);
});

test("keeps understood facts when Pi's active leaf is an unknown-typed entry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const file = join(directory, "branching.jsonl");
  await writeFile(
    file,
    await readFile("tests/fixtures/pi/0.85.1/branching.jsonl", "utf8"),
  );

  // The newest entry `e8` has unknown semantics (`type: "future_entry"`), and
  // Pi can still report it as the active leaf. Active scope must span its exact
  // `parentId` ancestry and reduce the understood facts on that path — never a
  // defined all-zero report that turns `unavailable` into `0`.
  const model = await loadCurrentSessionReport(file, "active", {
    leafId: "e8",
  });
  assert.ok(model);
  assert.equal(model.report.usage?.totalTokens, 30);
});

test("leaves active scope unavailable when Pi has no known active leaf", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const file = join(directory, "branching.jsonl");
  await writeFile(
    file,
    await readFile("tests/fixtures/pi/0.85.1/branching.jsonl", "utf8"),
  );

  assert.equal(
    await loadCurrentSessionReport(file, "active", { leafId: null }),
    undefined,
  );
  assert.equal(
    await loadCurrentSessionReport(file, "active", { leafId: "unknown-leaf" }),
    undefined,
  );

  const tree = await loadCurrentSessionReport(file, "tree", { leafId: null });
  assert.equal(tree?.report.usage?.totalTokens, 72);
});

test("opens the current-session TUI through Pi's public session lookup", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const file = join(directory, "session.jsonl");
  await writeFile(
    file,
    await readFile("tests/fixtures/pi/0.85.1/branching.jsonl", "utf8"),
  );

  const handlerRef: { current?: CommandHandler } = {};
  registerCommand(handlerRef);

  let customCalls = 0;
  let notifications = 0;
  let toggleTree: (() => void) | undefined;
  let rendered: (() => string[]) | undefined;
  assert.ok(handlerRef.current);
  await handlerRef.current("", {
    mode: "tui",
    sessionManager: {
      getLeafId: () => "e6",
      getSessionFile: () => file,
    },
    ui: {
      notify: () => {
        notifications++;
      },
      custom: async (factory: CustomFactory) => {
        customCalls++;
        const component = await factory(
          { requestRender: () => {} } as never,
          { fg: (_color: string, text: string) => text } as never,
          undefined as never,
          () => {},
        );
        assert.ok(
          component
            .render(120)
            .some((line: string) => line.includes("Total tokens: 42")),
        );
        toggleTree = () => component.handleInput?.("t");
        rendered = () => component.render(120);
      },
    },
  } as unknown as ExtensionCommandContext);

  assert.equal(customCalls, 1);
  assert.equal(notifications, 0);
  assert.ok(toggleTree);
  toggleTree();
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  assert.ok(rendered?.().some((line) => line.includes("Total tokens: 72")));
});

test("loads auto-discovered subagent runs for active and tree scopes through the production command", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const sessionFile = join(directory, "session.jsonl");
  await writeFile(
    sessionFile,
    await readFile(
      "tests/fixtures/pi/0.85.1/subagent-tool-results.jsonl",
      "utf8",
    ),
  );

  const handlerRef: { current?: CommandHandler } = {};
  registerCommand(handlerRef);
  let toggleTree: (() => void) | undefined;
  let rendered: (() => string[]) | undefined;
  assert.ok(handlerRef.current);
  await handlerRef.current("tui", {
    mode: "tui",
    sessionManager: {
      getLeafId: () => "g3",
      getSessionFile: () => sessionFile,
    },
    ui: {
      notify: () => assert.fail("must load the persisted subagent evidence"),
      custom: async (factory: CustomFactory) => {
        const component = await factory(
          { requestRender: () => {} } as never,
          { fg: (_color: string, text: string) => text } as never,
          undefined as never,
          () => {},
        );
        for (let index = 0; index < 4; index++)
          component.handleInput?.("\u001B[C");
        assert.ok(
          component
            .render(120)
            .some((line) => line.includes("Evidence: cooperative")),
        );
        toggleTree = () => component.handleInput?.("t");
        rendered = () => component.render(120);
      },
    },
  } as unknown as ExtensionCommandContext);

  assert.ok(toggleTree);
  toggleTree();
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  assert.ok(
    rendered?.().some((line) => line.includes("Evidence: cooperative")),
  );
});

test("exports auto-discovered subagent evidence in current JSON without rendering producer paths", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const sessionFile = join(directory, "session.jsonl");
  const output = join(directory, "report.json");
  await writeFile(
    sessionFile,
    await readFile(
      "tests/fixtures/pi/0.85.1/subagent-tool-results.jsonl",
      "utf8",
    ),
  );

  const handlerRef: { current?: CommandHandler } = {};
  registerCommand(handlerRef);
  assert.ok(handlerRef.current);
  await handlerRef.current(`json --output "${output}"`, {
    mode: "interactive",
    sessionManager: {
      getLeafId: () => "g3",
      getSessionFile: () => sessionFile,
      getSessionDir: () => directory,
    },
    ui: { notify: () => {}, custom: async () => assert.fail("must export") },
  } as unknown as ExtensionCommandContext);
  const rendered = await readFile(output, "utf8");
  assert.match(rendered, /"agentEvidence":"supported"/);
  assert.equal(rendered.includes("PRIVATE_TASK"), false);
  assert.equal(rendered.includes("/home/dev/PRIVATE"), false);
  const model = await loadCurrentSessionReport(sessionFile, "active", {
    leafId: "g3",
  });
  assert.ok(model);
  assert.equal(model.report.agentEvidence, "supported");
  const projection = projectCurrentView(
    { availability: "available", report: model.report, daily: [] },
    "active",
  );
  assert.equal((projection.report?.agents.length ?? 0) > 0, true);
  const snapshot = renderSnapshot({
    kind: "current",
    schemaVersion: 1,
    theme: "light",
    projection,
  });
  // The payload the UI publishes carries the two discovered runs, and neither
  // it nor the rendered snapshot carries a producer path.
  assert.deepEqual(
    projection.report?.agents.map((row) => row.agent),
    ["worker", "reviewer"],
  );
  assert.equal(JSON.stringify(projection).includes("/home/dev/PRIVATE"), false);
  assert.equal(snapshot.includes("/home/dev/PRIVATE"), false);
});

test("rejects the removed subagent artifact flag without opening the current view", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const sessionFile = join(directory, "session.jsonl");
  await writeFile(
    sessionFile,
    [
      '{"type":"session","version":3,"id":"fixture-session"}',
      '{"type":"message","id":"entry-1","parentId":null,"timestamp":"2026-01-01T00:00:00.000Z","message":{"role":"assistant","provider":"acme","model":"alpha","usage":{"totalTokens":7,"cost":{"total":0.01}}}}',
    ].join("\n"),
  );

  const handlerRef: { current?: CommandHandler } = {};
  registerCommand(handlerRef);
  let customCalls = 0;
  let notifications = 0;
  assert.ok(handlerRef.current);
  await handlerRef.current("--subagents-artifact missing.json", {
    mode: "tui",
    sessionManager: {
      getLeafId: () => "entry-1",
      getSessionFile: () => sessionFile,
    },
    ui: {
      notify: () => {
        notifications++;
      },
      custom: async () => {
        customCalls++;
      },
    },
  } as unknown as ExtensionCommandContext);

  assert.equal(customCalls, 0);
  assert.equal(notifications, 1);
});

test("opens /ledger directly on the lazy Ledger tab", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const file = join(directory, "session.jsonl");
  await writeFile(
    file,
    [
      '{"type":"session","version":3,"id":"fixture-session"}',
      '{"type":"custom","id":"tracking-marker","parentId":null,"timestamp":"2026-01-01T00:00:00.000Z","customType":"session-inspector:tracking-start","data":{"schemaVersion":1}}',
      '{"type":"message","id":"entry-1","parentId":null,"timestamp":"2026-01-01T00:00:00.000Z","message":{"role":"assistant","provider":"acme","model":"alpha","usage":{"totalTokens":7,"cost":{"total":0.01}}}}',
    ].join("\n"),
  );
  const handlerRef: { current?: CommandHandler } = {};
  registerCommand(handlerRef);
  let ledgerRendered: string[] | undefined;
  assert.ok(handlerRef.current);
  await handlerRef.current("tui ledger", {
    mode: "tui",
    sessionManager: { getLeafId: () => "entry-1", getSessionFile: () => file },
    ui: {
      notify: () => assert.fail("must open the ledger"),
      custom: async (factory: CustomFactory) => {
        const component = await factory(
          { requestRender: () => {} } as never,
          { fg: (_color: string, text: string) => text } as never,
          undefined as never,
          () => {},
        );
        ledgerRendered = component.render(120);
      },
    },
  } as unknown as ExtensionCommandContext);

  // Asserted after the handler resolves so a throw inside the swallowed
  // `custom` callback can no longer make this test pass vacuously.
  assert.ok(ledgerRendered?.some((line) => line.includes("Ledger events: 1")));
});

test("rejects non-current command arguments without opening the current view", async () => {
  const handlerRef: { current?: CommandHandler } = {};
  registerCommand(handlerRef);

  let customCalls = 0;
  let notifications = 0;
  assert.ok(handlerRef.current);
  await handlerRef.current("history", {
    mode: "tui",
    sessionManager: {
      getLeafId: () => {
        assert.fail("must not look up a rejected command");
      },
      getSessionFile: () => {
        assert.fail("must not look up a rejected command");
      },
    },
    ui: {
      notify: () => {
        notifications++;
      },
      custom: async () => {
        customCalls++;
      },
    },
  } as unknown as ExtensionCommandContext);

  assert.equal(customCalls, 0);
  assert.equal(notifications, 1);
});

test("notifies and does not throw when public session lookup or replay is unavailable", async () => {
  const handlerRef: { current?: CommandHandler } = {};
  registerCommand(handlerRef);

  let notifications = 0;
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const file = join(directory, "session.jsonl");
  await writeFile(
    file,
    [
      '{"type":"session","version":3,"id":"fixture-session"}',
      '{"type":"message","id":"entry-1","parentId":null,"timestamp":"2026-01-01T00:00:00.000Z"}',
    ].join("\n"),
  );
  assert.ok(handlerRef.current);
  await assert.doesNotReject(
    handlerRef.current("", {
      mode: "tui",
      sessionManager: {
        getLeafId: () => null,
        getSessionFile: () => file,
      },
      ui: {
        notify: () => {
          notifications++;
        },
        custom: async () => assert.fail("must not open without a session"),
      },
    } as unknown as ExtensionCommandContext),
  );
  await assert.doesNotReject(
    handlerRef.current("", {
      mode: "tui",
      sessionManager: {
        getLeafId: () => null,
        getSessionFile: () => undefined,
      },
      ui: {
        notify: () => {
          notifications++;
        },
        custom: async () => assert.fail("must not open without a session"),
      },
    } as unknown as ExtensionCommandContext),
  );
  await assert.doesNotReject(
    handlerRef.current("", {
      mode: "tui",
      sessionManager: {
        getLeafId: () => null,
        getSessionFile: () => join(tmpdir(), "missing-session.jsonl"),
      },
      ui: {
        notify: () => {
          notifications++;
        },
        custom: async () => assert.fail("must not open after replay failure"),
      },
    } as unknown as ExtensionCommandContext),
  );
  assert.equal(notifications, 3);
});

const SESSION_ID = "fixture-session";

const sessionSource = [
  '{"type":"session","version":3,"id":"fixture-session"}',
  '{"type":"custom","id":"tracking-marker","parentId":null,"timestamp":"2026-01-01T00:00:00.000Z","customType":"session-inspector:tracking-start","data":{"schemaVersion":1}}',
  '{"type":"message","id":"entry-1","parentId":null,"timestamp":"2026-01-01T00:00:00.000Z","message":{"role":"assistant","provider":"acme","model":"alpha","usage":{"totalTokens":7,"cost":{"total":0.01}}}}',
].join("\n");

/** Valid derived checkpoint already folding one allowed permission decision. */
function checkpointFixture() {
  return {
    schemaVersion: 1,
    cursors: {
      pi: { lineCount: 2, revision: "0".repeat(64) },
      wal: { "writer-a": 1 },
    },
    aggregates: {
      totalTokens: 0,
      totalCost: 0,
      generations: 0,
      tools: 0,
      compactions: 0,
      integrationCounters: { permission: { decisions: 1, allowed: 1 } },
      presence: { permission: true },
    },
  };
}

const permissionDecision = (result: "allow" | "deny", resolution: string) => ({
  schemaVersion: 1,
  source: "permission-system",
  metric: "permission.decision",
  kind: "counter",
  value: 1,
  dimensions: { result, resolution },
});

const skillInvocation = (skill: string) => ({
  schemaVersion: 1,
  source: "pi-input",
  metric: "skill.invocation",
  kind: "counter",
  value: 1,
  dimensions: { skill },
});

const telemetryRecord = (
  writerId: string,
  writerSequence: number,
  telemetry: Record<string, unknown>,
) => ({
  eventId: `event-${writerSequence}`,
  timestamp: `2026-09-11T10:00:0${writerSequence}Z`,
  writerId,
  writerSequence,
  kind: "telemetry",
  telemetry,
});

/**
 * A tracked fixture session. Each of these tests uses its own session id so the
 * process-wide live registration one test installs can never leak into another
 * test's health (LiveSessionState is keyed by session id).
 */
function trackedSessionSource(sessionId: string): string {
  return [
    JSON.stringify({ type: "session", version: 3, id: sessionId }),
    JSON.stringify({
      type: "custom",
      id: "tracking-marker",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      customType: "session-inspector:tracking-start",
      data: { schemaVersion: 1 },
    }),
    JSON.stringify({
      type: "message",
      id: "entry-1",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      message: {
        role: "assistant",
        provider: "acme",
        model: "alpha",
        usage: { totalTokens: 7, cost: { total: 0.01 } },
      },
    }),
  ].join("\n");
}

/** A writer shard holding the given retained records. */
async function writeShard(
  directory: string,
  sessionId: string,
  writerId: string,
  records: readonly Record<string, unknown>[],
): Promise<void> {
  const shard = join(
    directory,
    "session-inspector",
    "v1",
    "sessions",
    sessionId,
    "wal",
    writerId,
  );
  await mkdir(shard, { recursive: true });
  await writeFile(
    join(shard, "2026-09-11.jsonl"),
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );
}

/** Writes a derived checkpoint for one fixture session. */
async function writeCheckpointFixture(
  directory: string,
  sessionId: string,
  checkpoint: Record<string, unknown>,
): Promise<void> {
  const sessionDirectory = join(
    directory,
    "session-inspector",
    "v1",
    "sessions",
    sessionId,
  );
  await mkdir(sessionDirectory, { recursive: true });
  await writeFile(
    join(sessionDirectory, "checkpoint.json"),
    `${JSON.stringify(checkpoint)}\n`,
  );
}

type ExportedReport = {
  agents: readonly unknown[];
  skills: {
    invocationState: string;
    invocationCount: number | null;
    otherInvocations: number | null;
    items: readonly { name: string; explicitInvocations?: number }[];
  };
  integrations: readonly {
    integration: string;
    presence: string;
    state: string;
    counters?: Readonly<Record<string, number | boolean>>;
  }[];
  /** Inventory rows, distinct from the retained aggregate counts. */
  resources: { state: string; items: readonly unknown[] };
  evidenceHealth: {
    sources: readonly {
      source: string;
      state: string;
      recordsSeen: number;
      factsAccepted: number;
    }[];
    joins: { agentRuns: number };
    aggregates: {
      skillInvocations: { retainedInvocations: number };
      resources: string;
    };
    diagnostics: readonly {
      code: string;
      severity: string;
      count: number;
      source: string;
    }[];
  };
  retainedAggregates?: {
    resources?: {
      counts: {
        commands: number;
        skills: number;
        resources?: number;
        toolSources?: number;
      };
      state: string;
      observedAt: { state: string; at?: string; basis?: string };
    };
  };
};

const walSource = (report: ExportedReport) =>
  report.evidenceHealth.sources.find((row) => row.source === "inspector-wal");

const integrationRow = (report: ExportedReport, integration: string) =>
  report.integrations.find((row) => row.integration === integration);

/**
 * Runs the production `json` export for one fixture session. An optional
 * inventory api makes the production inventory refresh succeed (readable
 * inventory), which is what decides the inventory observation state.
 */
async function exportCurrentReport(input: {
  directory: string;
  sessionFile: string;
  sessionId: string;
  api?: {
    getCommands(): readonly unknown[];
    getAllTools(): readonly unknown[];
  };
}): Promise<ExportedReport> {
  const output = join(input.directory, "report.json");
  const handlerRef: { current?: CommandHandler } = {};
  if (input.api === undefined) {
    registerCommand(handlerRef);
  } else {
    registerSessionInspector({
      on: () => {},
      getCommands: input.api.getCommands,
      getAllTools: input.api.getAllTools,
      registerCommand: (name: string, command: { handler: CommandHandler }) => {
        if (name === "session-inspector") handlerRef.current = command.handler;
      },
    } as unknown as ExtensionAPI);
  }
  assert.ok(handlerRef.current);
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = input.directory;
  try {
    await handlerRef.current(`json --output "${output}"`, {
      mode: "interactive",
      sessionManager: {
        getSessionId: () => input.sessionId,
        getLeafId: () => "entry-1",
        getSessionFile: () => input.sessionFile,
        getSessionDir: () => input.directory,
      },
      ui: {
        notify: () => assert.fail("must export the current session report"),
        custom: async () => assert.fail("must export the current report"),
      },
    } as unknown as ExtensionCommandContext);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  }
  return JSON.parse(await readFile(output, "utf8")) as ExportedReport;
}

test("publishes the retained counter total when the checkpoint folded nothing", async () => {
  const sessionId = "retained-total";
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const sessionFile = join(directory, "session.jsonl");
  await writeFile(sessionFile, trackedSessionSource(sessionId));
  // A boundary that folded nothing: a zero cursor, empty aggregates, no seal
  // and no resource counts, with every retained record after its cursor.
  await writeCheckpointFixture(directory, sessionId, {
    schemaVersion: 1,
    cursors: {
      pi: { lineCount: 2, revision: "0".repeat(64) },
      wal: { "writer-a": 0 },
    },
    aggregates: {
      totalTokens: 0,
      totalCost: 0,
      generations: 0,
      tools: 0,
      compactions: 0,
    },
  });
  await writeShard(directory, sessionId, "writer-a", [
    telemetryRecord("writer-a", 1, permissionDecision("deny", "user_denied")),
    telemetryRecord("writer-a", 2, skillInvocation("council-mode")),
  ]);

  const report = await exportCurrentReport({
    directory,
    sessionFile,
    sessionId,
  });

  // The retained counter total is published even though the folded prefix
  // contributed nothing (P1.1: the DTO used to drop it entirely).
  assert.deepEqual(integrationRow(report, "permission")?.counters, {
    decisions: 1,
    denied: 1,
  });
  assert.equal(report.skills.invocationState, "supported");
  assert.equal(report.skills.invocationCount, 1);
  assert.equal(
    report.skills.items.find((row) => row.name === "council-mode")
      ?.explicitInvocations,
    1,
  );
  // The body and the health that describes it agree.
  assert.equal(
    report.evidenceHealth.aggregates.skillInvocations.retainedInvocations,
    1,
  );
});

test("creates the fold boundary from durable WAL evidence when the read finds none", async () => {
  const sessionId = "boundary-created";
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const sessionFile = join(directory, "session.jsonl");
  await writeFile(sessionFile, trackedSessionSource(sessionId));
  // No checkpoint exists: the durable WAL is the only evidence, and R50
  // publishes no counter total without a fold boundary. The read folds that
  // evidence once — the pass the session-start trigger schedules — and then
  // publishes the bounded total instead of withholding it forever.
  await writeShard(directory, sessionId, "writer-a", [
    telemetryRecord("writer-a", 1, skillInvocation("council-mode")),
    telemetryRecord("writer-a", 2, permissionDecision("deny", "user_denied")),
  ]);

  const report = await exportCurrentReport({
    directory,
    sessionFile,
    sessionId,
  });

  assert.equal(report.skills.invocationState, "supported");
  assert.equal(report.skills.invocationCount, 1);
  assert.equal(
    report.skills.items.find((row) => row.name === "council-mode")
      ?.explicitInvocations,
    1,
  );
  // The boundary makes the WAL-observed decision a trustworthy total. Without
  // it the same row reports no counter at all (never a zero), which the
  // presence-durability fixture pins for the pre-fold read.
  assert.deepEqual(integrationRow(report, "permission")?.counters, {
    decisions: 1,
    denied: 1,
  });
  assert.equal(integrationRow(report, "permission")?.state, "supported");
  assert.equal(
    report.evidenceHealth.aggregates.skillInvocations.retainedInvocations,
    1,
  );
});

test("reports a fully paired live boundary as supported and an unpaired start as partial", async () => {
  const sessionId = "paired-boundary";
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const sessionFile = join(directory, "session.jsonl");
  await writeFile(sessionFile, trackedSessionSource(sessionId));
  const subjectId = `live-tool-${canonicalOpaqueDigest("live-tool", sessionId, "call-1")}`;
  const start = {
    eventId: "live-start",
    timestamp: "2026-09-11T10:00:00Z",
    writerId: "writer-live",
    writerSequence: 1,
    kind: "live_timing",
    timing: {
      category: "tool",
      status: "running",
      confidence: "live",
      subjectId,
      startedAt: "2026-09-11T10:00:00Z",
    },
  };
  const end = {
    eventId: "live-end",
    timestamp: "2026-09-11T10:00:05Z",
    writerId: "writer-live",
    writerSequence: 2,
    kind: "live_timing",
    timing: {
      category: "tool",
      status: "unknown",
      confidence: "live",
      subjectId,
      startedAt: "2026-09-11T10:00:00Z",
      endedAt: "2026-09-11T10:00:05Z",
      durationMs: 5000,
    },
  };

  await writeShard(directory, sessionId, "writer-live", [start, end]);
  const paired = await exportCurrentReport({
    directory,
    sessionFile,
    sessionId,
  });
  // The paired start is not an open boundary, so the live source is complete.
  assert.equal(walSource(paired)?.state, "supported");
  assert.equal(walSource(paired)?.factsAccepted, 1);
  assert.equal(walSource(paired)?.recordsSeen, 2);

  // The unpaired read gets its own clean session: the first read folded a
  // checkpoint boundary for the session it read, and re-writing that shard
  // backwards afterwards is a different (and unavailable) scenario.
  const unpairedDirectory = await mkdtemp(
    join(tmpdir(), "pi-session-inspector-"),
  );
  const unpairedSessionId = "unpaired-boundary";
  const unpairedFile = join(unpairedDirectory, "session.jsonl");
  await writeFile(unpairedFile, trackedSessionSource(unpairedSessionId));
  await writeShard(unpairedDirectory, unpairedSessionId, "writer-live", [
    {
      ...start,
      eventId: "unpaired-start",
      timing: {
        ...start.timing,
        subjectId: `live-tool-${canonicalOpaqueDigest(
          "live-tool",
          unpairedSessionId,
          "call-1",
        )}`,
      },
    },
  ]);
  const unpaired = await exportCurrentReport({
    directory: unpairedDirectory,
    sessionFile: unpairedFile,
    sessionId: unpairedSessionId,
  });
  // A start without a complete partner stays incomplete live evidence.
  assert.equal(walSource(unpaired)?.state, "partial");
  assert.equal(walSource(unpaired)?.factsAccepted, 1);
});

test("current report projects L1 retained aggregates and presence from supplied evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const sessionFile = join(directory, "session.jsonl");
  await writeFile(sessionFile, sessionSource);

  const observation = {
    presence: {
      context: "unknown",
      rtk: "unknown",
      ponytail: "present",
      caveman: "absent",
      permission: "present",
      subagents: "present",
      lens: "unknown",
    },
  } as const;
  // The checkpoint's folded prefix arrives as folded evidence and the deny
  // that landed after its cursor as a retained record, so the builder owns the
  // one fold (R41/R38) and the loader never reconciles the two.
  const folded: FoldedAggregateEvidence[] = [
    {
      kind: "checkpoint-wal-aggregates",
      sessionId: SESSION_ID,
      foldedThrough: { "writer-a": 1 },
      sealedThrough: {},
      integrationCounters: { permission: { decisions: 1, allowed: 1 } },
      presence: { permission: true },
      checkpointedAt: { state: "unavailable" },
      provenance: {
        source: "checkpoint",
        authority: "derived",
        schemaVersion: 1,
      },
    },
  ];
  const walRecords = [
    {
      eventId: "w2",
      writerId: "writer-a",
      writerSequence: 2,
      timestamp: "2026-09-11T10:00:01Z",
      telemetry: permissionDecision("deny", "user_denied"),
    },
  ];

  const model = await loadCurrentSessionReport(sessionFile, "active", {
    leafId: "entry-1",
    observation,
    evidence: { atomic: [], folded },
    walRecords,
  });

  assert.equal(model?.report.integrations.length, 7);
  const permission = model?.report.integrations.find(
    (row) => row.integration === "permission",
  );
  assert.equal(permission?.state, "supported");
  assert.equal(permission?.presence, "present");
  assert.deepEqual(permission?.counters, {
    decisions: 2,
    allowed: 1,
    denied: 1,
  });
  const caveman = model?.report.integrations.find(
    (row) => row.integration === "caveman",
  );
  assert.equal(caveman?.presence, "absent");
  assert.equal(caveman?.state, "unavailable");
  // L1's own fields reach the DTO unchanged (Task 14) and no boundary is
  // claimed when nothing was pruned.
  assert.equal(
    model?.report.evidenceHealth.aggregates.detail,
    "aggregate-only",
  );
  assert.equal(model?.report.evidenceHealth.core, "supported");
  assert.equal(
    model?.report.retainedAggregates?.boundary.detail,
    "aggregate-only",
  );
  assert.equal(model?.report.walDetail, undefined);
});

test("production command folds checkpoint and WAL counters with durable permission presence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const sessionFile = join(directory, "session.jsonl");
  const root = join(directory, "session-inspector", "v1");
  const output = join(directory, "report.json");
  await writeFile(sessionFile, sessionSource);

  const sessionDirectory = join(root, "sessions", SESSION_ID);
  const walShard = join(sessionDirectory, "wal", "writer-a");
  await mkdir(walShard, { recursive: true });
  const checkpointFile = join(sessionDirectory, "checkpoint.json");
  const checkpoint = checkpointFixture();
  await writeFile(checkpointFile, `${JSON.stringify(checkpoint)}\n`);
  await writeFile(
    join(walShard, "2026-09-11.jsonl"),
    `${[
      {
        eventId: "w1",
        timestamp: "2026-09-11T10:00:00Z",
        writerId: "writer-a",
        writerSequence: 1,
        kind: "telemetry",
        telemetry: permissionDecision("allow", "policy_allow"),
      },
      {
        eventId: "w2",
        timestamp: "2026-09-11T10:00:01Z",
        writerId: "writer-a",
        writerSequence: 2,
        kind: "telemetry",
        telemetry: permissionDecision("deny", "user_denied"),
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n")}\n`,
  );
  const checkpointBytes = await readFile(checkpointFile, "utf8");

  const handlerRef: { current?: CommandHandler } = {};
  registerCommand(handlerRef);
  assert.ok(handlerRef.current);
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = directory;
  try {
    await handlerRef.current(`json --output "${output}"`, {
      mode: "interactive",
      sessionManager: {
        getSessionId: () => SESSION_ID,
        getLeafId: () => "entry-1",
        getSessionFile: () => sessionFile,
        getSessionDir: () => directory,
      },
      ui: {
        notify: () => assert.fail("must export the current session report"),
        custom: async () =>
          assert.fail("must export the current session report"),
      },
    } as unknown as ExtensionCommandContext);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  }

  const exported = JSON.parse(await readFile(output, "utf8")) as {
    integrations: readonly {
      integration: string;
      presence: string;
      state: string;
      counters?: Readonly<Record<string, number | boolean>>;
    }[];
  };
  const permission = exported.integrations.find(
    (row) => row.integration === "permission",
  );
  // The bus was observed in a previous process; presence survives the resume.
  assert.equal(permission?.presence, "present");
  assert.equal(permission?.state, "supported");
  assert.deepEqual(permission?.counters, {
    decisions: 2,
    allowed: 1,
    denied: 1,
  });
  assert.equal(exported.integrations.length, 7);
  assert.equal(await readFile(checkpointFile, "utf8"), checkpointBytes);
});

/**
 * Task 15 carry: the `checkpoint-resource-aggregates` folded branch is the
 * production translation of `aggregates.resourceCounts` + `observedAt`. These
 * two cases pin its health state and the observation state of its instant.
 */
test("production command publishes checkpoint resource counts and their observation time", async () => {
  const sessionId = "checkpoint-resources";
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const sessionFile = join(directory, "session.jsonl");
  await writeFile(sessionFile, trackedSessionSource(sessionId));
  const observedAt = "2026-09-11T09:00:00.000Z";
  await writeCheckpointFixture(directory, sessionId, {
    schemaVersion: 1,
    cursors: {
      pi: { lineCount: 2, revision: "0".repeat(64) },
      wal: { "writer-a": 0 },
    },
    aggregates: {
      totalTokens: 0,
      totalCost: 0,
      generations: 0,
      tools: 0,
      compactions: 0,
      resourceCounts: {
        commands: 3,
        skills: 2,
        resources: 1,
        toolSources: 4,
        observedAt,
      },
    },
    evidence: { checkpointedAt: "2026-09-11T09:30:00.000Z" },
  });

  // No readable inventory: the checkpoint's persisted counts are the only
  // inventory evidence, so no inventory-observation diagnostic is emitted.
  const report = await exportCurrentReport({
    directory,
    sessionFile,
    sessionId,
  });

  assert.equal(report.evidenceHealth.aggregates.resources, "supported");
  assert.deepEqual(report.retainedAggregates?.resources, {
    counts: { commands: 3, skills: 2, resources: 1, toolSources: 4 },
    state: "aggregate-only",
    observedAt: {
      state: "known",
      at: observedAt,
      basis: "inventory-observer",
    },
  });
  assert.equal(
    report.evidenceHealth.diagnostics.some(
      (diagnostic) => diagnostic.code === "inventory-observation-time-missing",
    ),
    false,
  );
  // No synthetic activity rows or timestamps accompany the counts.
  assert.equal(report.resources.state, "unavailable");
});

test("a checkpoint resource observation without observedAt keeps its counts but gains no instant", async () => {
  const sessionId = "checkpoint-resources-no-time";
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const sessionFile = join(directory, "session.jsonl");
  await writeFile(sessionFile, trackedSessionSource(sessionId));
  await writeCheckpointFixture(directory, sessionId, {
    schemaVersion: 1,
    cursors: {
      pi: { lineCount: 2, revision: "0".repeat(64) },
      wal: { "writer-a": 0 },
    },
    aggregates: {
      totalTokens: 0,
      totalCost: 0,
      generations: 0,
      tools: 0,
      compactions: 0,
      // Legacy shape: counts without an observation instant.
      resourceCounts: { commands: 1, skills: 1 },
    },
  });

  const report = await exportCurrentReport({
    directory,
    sessionFile,
    sessionId,
    api: {
      getCommands: () => [
        {
          name: "ponytail",
          source: "extension",
          sourceInfo: { source: "local", scope: "user", origin: "top-level" },
        },
      ],
      getAllTools: () => [],
    },
  });

  // The counts survive as labelled aggregates, but never gain a fabricated
  // observation instant.
  assert.equal(report.evidenceHealth.aggregates.resources, "supported");
  assert.deepEqual(report.retainedAggregates?.resources?.observedAt, {
    state: "unavailable",
  });
  assert.deepEqual(report.retainedAggregates?.resources?.counts, {
    commands: 1,
    skills: 1,
  });
  // R57: a readable inventory carries the instant it was observed with, so a
  // fresh snapshot is never diagnosed with a missing observation time (the
  // checkpoint's legacy counts remain time-less on their own row).
  assert.deepEqual(
    report.evidenceHealth.diagnostics.filter(
      (diagnostic) => diagnostic.code === "inventory-observation-time-missing",
    ),
    [],
  );
  const inventorySource = report.evidenceHealth.sources.find(
    (source) => source.source === "inventory",
  );
  assert.equal(inventorySource?.state, "supported");
});

test("reports read effective counters without mutating the checkpoint", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const sessionFile = join(directory, "session.jsonl");
  const root = join(directory, "inspector");
  await writeFile(sessionFile, sessionSource);
  const sessionDirectory = join(root, "sessions", SESSION_ID);
  await mkdir(sessionDirectory, { recursive: true });
  const checkpointFile = join(sessionDirectory, "checkpoint.json");
  await writeFile(checkpointFile, `${JSON.stringify(checkpointFixture())}\n`);
  const bytesBefore = await readFile(checkpointFile, "utf8");

  const observation = {
    presence: {
      context: "unknown",
      rtk: "unknown",
      ponytail: "unknown",
      caveman: "unknown",
      permission: "present",
      subagents: "unknown",
      lens: "unknown",
    },
  } as const;
  const options = {
    leafId: "entry-1",
    observation,
    evidence: {
      atomic: [],
      folded: [
        {
          kind: "checkpoint-wal-aggregates",
          sessionId: SESSION_ID,
          foldedThrough: { "writer-a": 1 },
          sealedThrough: {},
          integrationCounters: { permission: { decisions: 1, allowed: 1 } },
          presence: { permission: true },
          checkpointedAt: { state: "unavailable" },
          provenance: {
            source: "checkpoint",
            authority: "derived",
            schemaVersion: 1,
          },
        } satisfies FoldedAggregateEvidence,
      ],
    },
    walRecords: [
      {
        eventId: "w2",
        writerId: "writer-a",
        writerSequence: 2,
        timestamp: "2026-09-11T10:00:01Z",
        telemetry: permissionDecision("deny", "user_denied"),
      },
    ],
  };

  const first = await loadCurrentSessionReport(sessionFile, "active", options);
  const second = await loadCurrentSessionReport(sessionFile, "active", options);

  // A second read of the same evidence must not add the post-cursor suffix
  // again: the fold lives in L1 and holds no cross-read state.
  assert.deepEqual(
    first?.report.integrations.find((row) => row.integration === "permission")
      ?.counters,
    { decisions: 2, allowed: 1, denied: 1 },
  );
  assert.deepEqual(
    second?.report.integrations.find((row) => row.integration === "permission")
      ?.counters,
    { decisions: 2, allowed: 1, denied: 1 },
  );
  assert.deepEqual(first?.report.evidenceHealth, second?.report.evidenceHealth);
  assert.equal(await readFile(checkpointFile, "utf8"), bytesBefore);
});

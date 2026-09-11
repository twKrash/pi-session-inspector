import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

import registerSessionInspector from "../../src/index.ts";
import {
  foldedFromCheckpointAggregates,
  foldTelemetryCounters,
  mergeFoldedCounters,
} from "../../src/core/live-counter-fold.ts";
import { readCheckpoint } from "../../src/storage/checkpoint.ts";
import { renderHtml } from "../../src/ui/html.ts";
import { loadCurrentSessionReport } from "../../src/ui/load-current.ts";

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
      '{"type":"custom","id":"context-1","parentId":null,"timestamp":"2026-01-01T00:00:00.000Z","customType":"ctx_status","data":{"schemaVersion":1,"active":true}}',
    ].join("\n"),
  );

  const model = await loadCurrentSessionReport(file, "tree", { leafId: null });
  assert.deepEqual(model?.report.integrations, [
    {
      integration: "context",
      presence: "unknown",
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
  assert.equal(model?.report.usage.totalTokens, 1515);
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
  assert.equal(model?.report.usage.totalTokens, 42);
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
  assert.equal(tree?.report.usage.totalTokens, 72);
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
  await handlerRef.current("current", {
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
  await handlerRef.current(`current --format json --output "${output}"`, {
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
  const html = renderHtml({
    kind: "current",
    report: model.report,
    scope: "active",
  });
  assert.match(html, /"agents":\[/);
  assert.equal(html.includes("/home/dev/PRIVATE"), false);
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
      '{"type":"message","id":"entry-1","parentId":null,"timestamp":"2026-01-01T00:00:00.000Z","message":{"role":"assistant","provider":"acme","model":"alpha","usage":{"totalTokens":7,"cost":{"total":0.01}}}}',
    ].join("\n"),
  );
  const handlerRef: { current?: CommandHandler } = {};
  registerCommand(handlerRef);
  assert.ok(handlerRef.current);
  await handlerRef.current("ledger", {
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
        assert.ok(
          component
            .render(120)
            .some((line) => line.includes("Ledger events: 1")),
        );
      },
    },
  } as unknown as ExtensionCommandContext);
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

test("current report shows presence rows and effective counters from the observation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const sessionFile = join(directory, "session.jsonl");
  const root = join(directory, "inspector");
  await writeFile(sessionFile, sessionSource);
  const sessionDirectory = join(root, "sessions", SESSION_ID);
  await mkdir(sessionDirectory, { recursive: true });
  await writeFile(
    join(sessionDirectory, "checkpoint.json"),
    `${JSON.stringify(checkpointFixture())}\n`,
  );

  // Reuse this file's fixture session id so the Inspector directory matches.
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
    counters: mergeFoldedCounters(
      foldedFromCheckpointAggregates({
        integrationCounters: { permission: { decisions: 1, allowed: 1 } },
        presence: { permission: true },
      }),
      foldTelemetryCounters([permissionDecision("deny", "user_denied")]),
    ),
  } as const;
  const model = await loadCurrentSessionReport(sessionFile, "active", {
    leafId: "entry-1",
    observation,
    inspectorRoot: root,
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

  // Reading again with the same effective observation does not add the delta a
  // second time, and the checkpoint on disk is untouched by report reads.
  const checkpointFile = join(sessionDirectory, "checkpoint.json");
  const bytesBefore = await readFile(checkpointFile, "utf8");
  const before = await readCheckpoint({ directory: sessionDirectory });
  const again = await loadCurrentSessionReport(sessionFile, "active", {
    leafId: "entry-1",
    observation,
    inspectorRoot: root,
  });
  assert.deepEqual(
    again?.report.integrations.find((row) => row.integration === "permission")
      ?.counters,
    {
      decisions: 2,
      allowed: 1,
      denied: 1,
    },
  );
  assert.deepEqual(
    await readCheckpoint({ directory: sessionDirectory }),
    before,
  );
  assert.equal(await readFile(checkpointFile, "utf8"), bytesBefore);
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
    await handlerRef.current(`current --format json --output "${output}"`, {
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
    counters: mergeFoldedCounters(
      foldedFromCheckpointAggregates({
        integrationCounters: { permission: { decisions: 1, allowed: 1 } },
        presence: { permission: true },
      }),
      foldTelemetryCounters([permissionDecision("deny", "user_denied")]),
    ),
  } as const;

  const first = await loadCurrentSessionReport(sessionFile, "active", {
    leafId: "entry-1",
    observation,
    inspectorRoot: root,
  });
  const second = await loadCurrentSessionReport(sessionFile, "active", {
    leafId: "entry-1",
    observation,
    inspectorRoot: root,
  });

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
  assert.equal(await readFile(checkpointFile, "utf8"), bytesBefore);
});

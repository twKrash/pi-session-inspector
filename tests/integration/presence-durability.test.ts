import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

import registerSessionInspector from "../../src/index.ts";
import { validateTelemetry } from "../../src/pi/telemetry.ts";
import { createWalWriter } from "../../src/storage/wal.ts";

/**
 * Sanitized regression for two findings from the production UAT: the same
 * immutable session reported `permission` presence `present` while a live
 * process was reading it and `unknown` once it was read as history, and a
 * policy-denied command left no decision counter.
 *
 * The fixture is minimal and carries no producer text: one tracked session, one
 * permission bus sighting, one decision, no checkpoint — exactly the durable
 * shape a live session has before any fold boundary exists.
 */

const SESSION_ID = "presence-durability";
const WRITER_ID = "writer-presence";
const SESSION_DIRECTORY = "pi-sessions";

type CommandHandler = (
  args: string,
  ctx: ExtensionCommandContext,
) => Promise<void>;

type IntegrationRow = {
  integration: string;
  presence: string;
  state: string;
  counters?: Record<string, number>;
};

type SourceRow = {
  sourceLabel: string;
  commands: number;
  skills: number;
  prompts: number;
  tools: number;
};

type ReportLike = {
  integrations?: readonly IntegrationRow[];
  resources?: { items: readonly SourceRow[] };
};

/** One validated permission bus envelope, as the live adapter emits it. */
function envelope(input: {
  metric: string;
  dimensions?: Record<string, unknown>;
}): Record<string, unknown> {
  const result = validateTelemetry({
    schemaVersion: 1,
    source: "permission-system",
    metric: input.metric,
    kind: "counter",
    value: 1,
    timestamp: Date.parse("2026-09-15T10:00:01.000Z"),
    ...(input.dimensions === undefined ? {} : { dimensions: input.dimensions }),
  });
  assert.equal(
    result.ok,
    true,
    `fixture envelope ${input.metric} must validate`,
  );
  if (!result.ok) throw new Error("unreachable");
  return result.envelope as unknown as Record<string, unknown>;
}

/**
 * The tracked Pi source: the sanitized shape of one UAT smoke session, with the
 * producer surfaces each integration adapter reads — `ctx_*` and Lens tool
 * calls, a persisted RTK compaction, the two mode extensions' custom entries,
 * and one subagent run whose native usage lands on only one of its calls.
 */
function sessionSource(): string {
  const assistant = (
    id: string,
    parentId: string | null,
    timestamp: string,
    calls: { id: string; name: string }[],
  ) => ({
    type: "message",
    id,
    parentId,
    timestamp,
    message: {
      role: "assistant",
      provider: "example",
      model: "example-model",
      usage: { totalTokens: 100, cost: { total: 0.01 } },
      content: calls.map((call) => ({
        type: "toolCall",
        id: call.id,
        name: call.name,
      })),
    },
  });
  const toolResult = (
    id: string,
    parentId: string,
    timestamp: string,
    callId: string,
    toolName: string,
    extra: Record<string, unknown> = {},
  ) => ({
    type: "message",
    id,
    parentId,
    timestamp,
    message: {
      role: "toolResult",
      toolCallId: callId,
      toolName,
      isError: false,
      usage: { totalTokens: 10, cost: { total: 0.001 } },
      ...extra,
    },
  });
  const records = [
    {
      type: "session",
      version: 3,
      id: SESSION_ID,
      timestamp: "2026-09-15T09:59:59.000Z",
    },
    {
      type: "custom",
      id: "marker",
      parentId: null,
      timestamp: "2026-09-15T10:00:00.000Z",
      customType: "session-inspector:tracking-start",
      data: { schemaVersion: 1 },
    },
    {
      type: "custom",
      id: "ponytail-1",
      parentId: "marker",
      timestamp: "2026-09-15T10:00:01.000Z",
      customType: "ponytail-mode",
      data: { mode: "full" },
    },
    {
      type: "custom",
      id: "caveman-1",
      parentId: "ponytail-1",
      timestamp: "2026-09-15T10:00:01.500Z",
      customType: "caveman-level",
      data: { level: "full" },
    },
    assistant("gen-1", "caveman-1", "2026-09-15T10:00:02.000Z", [
      { id: "call-ctx-1", name: "ctx_search" },
      { id: "call-ctx-2", name: "ctx_batch_execute" },
      { id: "call-lens-1", name: "lens_diagnostics" },
      { id: "call-lens-2", name: "pi_lens_activate_tools" },
    ]),
    toolResult(
      "res-ctx-1",
      "gen-1",
      "2026-09-15T10:00:03.000Z",
      "call-ctx-1",
      "ctx_search",
    ),
    // The RTK compaction the optimizer recorded on its own tool result.
    toolResult(
      "res-ctx-2",
      "gen-1",
      "2026-09-15T10:00:03.500Z",
      "call-ctx-2",
      "ctx_batch_execute",
      {
        details: {
          rtkCompaction: {
            schemaVersion: 1,
            sourceChars: 51288,
            compactedChars: 12000,
            sourceLines: 713,
            compactedLines: 167,
            truncated: true,
          },
        },
      },
    ),
    toolResult(
      "res-lens-1",
      "gen-1",
      "2026-09-15T10:00:04.000Z",
      "call-lens-1",
      "lens_diagnostics",
    ),
    toolResult(
      "res-lens-2",
      "gen-1",
      "2026-09-15T10:00:04.500Z",
      "call-lens-2",
      "pi_lens_activate_tools",
    ),
    assistant("gen-2", "res-lens-2", "2026-09-15T10:00:05.000Z", [
      { id: "call-sub-1", name: "subagent" },
    ]),
    // One `subagent` call of three carried native usage: the grouped Tools row
    // must publish 34477 over 1 of 3 calls, never as the complete figure.
    toolResult(
      "res-sub-1",
      "gen-2",
      "2026-09-15T10:00:06.000Z",
      "call-sub-1",
      "subagent",
      {
        details: {
          results: [
            {
              index: 0,
              runId: "run-1",
              agent: "worker",
              usage: {
                input: 30000,
                output: 4477,
                cacheRead: 0,
                cacheWrite: 0,
                cost: 0.004893924,
              },
            },
          ],
        },
      },
    ),
  ];
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

/** The sanitized inventory the UAT environment exposed. */
const COMMANDS = [
  {
    name: "ponytail",
    source: "extension",
    description: "mode",
    sourceInfo: { source: "npm:pi-ponytail", scope: "user", origin: "package" },
  },
  {
    name: "caveman",
    source: "extension",
    description: "mode",
    sourceInfo: { source: "npm:pi-caveman", scope: "user", origin: "package" },
  },
  {
    name: "skill:graphify",
    source: "skill",
    sourceInfo: { source: "npm:pi-graphify", scope: "user", origin: "package" },
  },
  {
    name: "review",
    source: "prompt",
    sourceInfo: { source: "builtin", scope: "user", origin: "top-level" },
  },
] as const;

const TOOLS = [
  {
    name: "bash",
    description: "",
    parameters: {},
    sourceInfo: { source: "builtin", scope: "user", origin: "top-level" },
  },
  {
    name: "ctx_search",
    description: "",
    parameters: {},
    sourceInfo: { source: "npm:pi-context", scope: "user", origin: "package" },
  },
  {
    name: "lens_diagnostics",
    description: "",
    parameters: {},
    sourceInfo: { source: "npm:pi-lens", scope: "user", origin: "package" },
  },
  {
    name: "subagent",
    description: "",
    parameters: {},
    sourceInfo: {
      source: "npm:pi-subagents",
      scope: "user",
      origin: "package",
    },
  },
] as const;

type Fixture = {
  agentDir: string;
  report: (args: string, output: string) => Promise<ReportLike>;
  reportPath: string;
  sessionDirectory: string;
  sessionFile: string;
  inspectorRoot: string;
  close: () => Promise<void>;
};

async function buildFixture(): Promise<Fixture> {
  const agentDir = await mkdtemp(join(tmpdir(), "inspector-presence-"));
  const sessionDirectory = join(agentDir, SESSION_DIRECTORY);
  const inspectorRoot = join(agentDir, "session-inspector", "v1");
  const sessionFile = join(sessionDirectory, "session.jsonl");
  const reportPath = join(agentDir, "report.json");
  await mkdir(join(inspectorRoot, "sessions", SESSION_ID), { recursive: true });
  await mkdir(sessionDirectory, { recursive: true });
  await writeFile(sessionFile, sessionSource());
  await writeFile(
    join(inspectorRoot, "sessions", SESSION_ID, "meta.json"),
    `${JSON.stringify({
      schemaVersion: 2,
      sessionId: SESSION_ID,
      sourceFile: "session.jsonl",
      state: "tracking",
    })}\n`,
  );

  // The live WAL, written through the production writer: one `permissions:ready`
  // sighting and one denied decision, exactly as the permission bus published
  // them to the live adapter.
  const writer = await createWalWriter({
    root: join(inspectorRoot, "sessions", SESSION_ID),
    writerId: WRITER_ID,
    now: () => new Date("2026-09-15T10:00:04.000Z"),
  });
  writer.appendTelemetry(envelope({ metric: "permission.ready" }));
  writer.appendTelemetry(
    envelope({
      metric: "permission.decision",
      dimensions: { result: "deny", resolution: "policy_deny" },
    }),
  );
  await writer.flush();

  const handlerRef: { current?: CommandHandler } = {};
  registerSessionInspector({
    on: () => {},
    getCommands: () => [...COMMANDS],
    getAllTools: () => [...TOOLS],
    registerCommand: (name: string, command: { handler: CommandHandler }) => {
      if (name === "session-inspector") handlerRef.current = command.handler;
    },
  } as unknown as ExtensionAPI);

  const handler = handlerRef.current;
  assert.ok(handler, "the production command handler must be registered");
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;

  const run = async (args: string, output: string): Promise<ReportLike> => {
    await handler(args, {
      mode: "interactive",
      sessionManager: {
        getSessionId: () => SESSION_ID,
        getLeafId: () => "res-sub-1",
        getSessionFile: () => sessionFile,
        getSessionDir: () => sessionDirectory,
      },
      ui: {
        notify: (message: string) => {
          throw new Error(`report must be exported, not notified: ${message}`);
        },
        custom: async () => {
          throw new Error("report must be exported, not rendered");
        },
      },
    } as unknown as ExtensionCommandContext);
    return JSON.parse(await readFile(output, "utf8")) as ReportLike;
  };

  return {
    agentDir,
    inspectorRoot,
    sessionDirectory,
    sessionFile,
    reportPath,
    report: run,
    close: async () => {
      if (previousAgentDir === undefined)
        delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      await rm(agentDir, { recursive: true, force: true });
    },
  };
}

function permissionRow(report: ReportLike): IntegrationRow | undefined {
  return report.integrations?.find((row) => row.integration === "permission");
}

function rowsOf(value: unknown): ReportLike {
  const record = value as { report?: ReportLike } & ReportLike;
  return record.report ?? record;
}

test("a durable permission sighting survives the session becoming history", async () => {
  const fixture = await buildFixture();
  try {
    // (1) Historical read first: no checkpoint exists, so the durable WAL is the
    // only sighting. It must read as present, never as unknown or absent.
    const history = rowsOf(
      await fixture.report(
        `json session ${SESSION_ID} --output "${fixture.reportPath}"`,
        fixture.reportPath,
      ),
    );
    const beforeFold = permissionRow(history);
    assert.equal(beforeFold?.presence, "present");
    assert.equal(beforeFold?.state, "unavailable");

    // (2) The current read finds no fold boundary and creates one, so the same
    // evidence now reports its bounded counters instead of withholding them.
    const current = await fixture.report(
      `json current --output "${fixture.reportPath}"`,
      fixture.reportPath,
    );
    const currentRow = permissionRow(current);
    assert.equal(currentRow?.presence, "present");
    assert.equal(currentRow?.state, "supported");
    assert.equal(currentRow?.counters?.decisions, 1);
    assert.equal(currentRow?.counters?.denied, 1);
    assert.equal(currentRow?.counters?.allowed, undefined);

    const checkpoint = JSON.parse(
      await readFile(
        join(fixture.inspectorRoot, "sessions", SESSION_ID, "checkpoint.json"),
        "utf8",
      ),
    ) as {
      aggregates: {
        presence?: { permission?: boolean };
        integrationCounters?: Record<string, Record<string, number>>;
      };
    };
    assert.equal(checkpoint.aggregates.presence?.permission, true);
    assert.equal(
      checkpoint.aggregates.integrationCounters?.permission?.denied,
      1,
    );

    // (3) Both projections of the one immutable session agree on presence.
    const historyAgain = rowsOf(
      await fixture.report(
        `json session ${SESSION_ID} --output "${fixture.reportPath}"`,
        fixture.reportPath,
      ),
    );
    assert.equal(permissionRow(historyAgain)?.presence, "present");
    assert.deepEqual(
      permissionRow(historyAgain),
      permissionRow(
        await fixture.report(
          `json current --output "${fixture.reportPath}"`,
          fixture.reportPath,
        ),
      ),
    );
  } finally {
    await fixture.close();
  }
});

test("one sanitized UAT session projects its whole integration matrix", async () => {
  const fixture = await buildFixture();
  try {
    // The full session tree: the smoke session's tool results are siblings of
    // the active path's own chain, and their evidence is tree evidence.
    const report = await fixture.report(
      `json current --scope tree --output "${fixture.reportPath}"`,
      fixture.reportPath,
    );
    const rowOf = (key: string): IntegrationRow | undefined =>
      report.integrations?.find((row) => row.integration === key);

    // 1-6: every integration the smoke session exercised is supported by its
    // own producer evidence, and each counter is the producer's own figure.
    assert.deepEqual(rowOf("context")?.counters, { calls: 2 });
    assert.deepEqual(rowOf("rtk")?.counters, {
      compactions: 1,
      sourceChars: 51288,
      compactedChars: 12000,
      sourceLines: 713,
      compactedLines: 167,
      truncated: true,
    });
    assert.deepEqual(rowOf("ponytail")?.counters, { changes: 1 });
    assert.deepEqual(rowOf("caveman")?.counters, { changes: 1 });
    assert.deepEqual(rowOf("lens")?.counters, { calls: 2 });
    const subagents = rowOf("subagents");
    assert.equal(subagents?.state, "supported");
    // The rich subagent evidence is a run, never a flattened counter.
    assert.equal(subagents?.counters, undefined);

    // 7: a durable permission sighting in the same immutable session.
    assert.equal(rowOf("permission")?.presence, "present");

    // 10: the Sources counts are the inventory that was supplied, per source.
    const sources = report.resources?.items ?? [];
    assert.deepEqual(
      sources.map((row) => [
        row.sourceLabel,
        row.commands,
        row.skills,
        row.prompts,
        row.tools,
      ]),
      [
        ["builtin", 0, 0, 1, 1],
        ["npm:pi-caveman", 1, 0, 0, 0],
        ["npm:pi-context", 0, 0, 0, 1],
        ["npm:pi-graphify", 0, 1, 0, 0],
        ["npm:pi-lens", 0, 0, 0, 1],
        ["npm:pi-ponytail", 1, 0, 0, 0],
        ["npm:pi-subagents", 0, 0, 0, 1],
      ],
    );

    // 12: filtering is a view concern — the DTO still publishes every declared
    // row, so a hidden row keeps its evidence and no missing figure becomes 0.
    assert.equal(report.integrations?.length, 7);
  } finally {
    await fixture.close();
  }
});

test("a present integration with no evidence reports no counter, never zero", async () => {
  const fixture = await buildFixture();
  try {
    const report = await fixture.report(
      `json current --scope tree --output "${fixture.reportPath}"`,
      fixture.reportPath,
    );
    // A row whose producer leaves no counter publishes none — never a zero
    // bucket: `subagents` is evidence-supported from its runs, and a counter
    // schema that declares none contributes no counter column at all.
    const rows = report.integrations ?? [];
    const subagentsRow = rows.find((row) => row.integration === "subagents");
    assert.equal(subagentsRow?.state, "supported");
    assert.equal(subagentsRow?.counters, undefined);
    for (const row of rows) {
      for (const count of Object.values(row.counters ?? {})) {
        assert.notEqual(
          count,
          0,
          `${row.integration} published a zero counter`,
        );
      }
    }
  } finally {
    await fixture.close();
  }
});

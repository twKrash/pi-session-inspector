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

type ReportLike = { integrations?: readonly IntegrationRow[] };

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

/** The tracked Pi source: header, tracking marker, one generation and one tool. */
function sessionSource(): string {
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
      type: "message",
      id: "gen-1",
      parentId: "marker",
      timestamp: "2026-09-15T10:00:02.000Z",
      message: {
        role: "assistant",
        provider: "example",
        model: "example-model",
        usage: { totalTokens: 100, cost: { total: 0.01 } },
        content: [{ type: "toolCall", id: "call-1", name: "bash" }],
      },
    },
    {
      type: "message",
      id: "res-1",
      parentId: "gen-1",
      timestamp: "2026-09-15T10:00:03.000Z",
      message: {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "bash",
        isError: true,
        usage: { totalTokens: 10, cost: { total: 0.001 } },
      },
    },
  ];
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

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
    getCommands: () => [],
    getAllTools: () => [],
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
        getLeafId: () => "res-1",
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

test("an integration with no evidence reports no counter, never zero", async () => {
  const fixture = await buildFixture();
  try {
    const report = await fixture.report(
      `json current --output "${fixture.reportPath}"`,
      fixture.reportPath,
    );
    // The inventory is readable and empty, so the extension-backed integration
    // has a definite `absent` signal — and still no counters at all: absence is
    // never published as a zero bucket.
    const absent = report.integrations?.find(
      (row) => row.integration === "caveman",
    );
    assert.equal(absent?.presence, "absent");
    assert.equal(absent?.state, "unavailable");
    assert.equal(absent?.counters, undefined);
  } finally {
    await fixture.close();
  }
});

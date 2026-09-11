import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { ReducedSession, SessionEntry } from "../../src/core/events.ts";
import { toSessionReport } from "../../src/core/reports.ts";
import { renderJson } from "../../src/ui/json.ts";
import { createEvidenceRegistry } from "../../src/integrations/evidence.ts";
import { readInventory } from "../../src/integrations/inventory.ts";
import { registerLiveCounters } from "../../src/integrations/live-counters.ts";
import { readIntegrationPresence } from "../../src/integrations/presence.ts";
import { readPiEntryEvidence } from "../../src/integrations/pi-entries.ts";
import { readSubagentEvidence } from "../../src/integrations/subagents.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";
import type { InspectorBundle } from "../../src/ui/bundle.ts";
import { CURRENT_TABS, createCurrentTuiModel } from "../../src/ui/current.ts";
import { createCurrentTuiComponent } from "../../src/ui/current-tui.ts";
import { renderInspectorBundle } from "../../src/ui/html.ts";
import { loadCurrentSessionReport } from "../../src/ui/load-current.ts";
import { emptyObservation } from "../../src/ui/observation.ts";

const secret = "m5-seeded-secret";
const parent: ReducedSession = {
  sessionId: "session-1",
  usage: { totalTokens: 100, cost: 10 },
  usageComposition: {
    generations: { totalTokens: 0, cost: 0 },
    toolResults: { totalTokens: 0, cost: 0 },
    compactions: { totalTokens: 0, cost: 0 },
    branchSummaries: { totalTokens: 0, cost: 0 },
  },
  generations: [],
  tools: [],
  compactions: [],
  errors: [],
};

test("privacy corpus excludes seeded secrets from every integration adapter and report JSON", () => {
  const registry = createEvidenceRegistry([
    {
      integration: "context",
      version: 1,
      read: (value) => ({ counters: { calls: value.calls ?? 0 } }),
    },
  ]);
  const registryOutput = registry.read({
    integration: "context",
    version: 1,
    value: { calls: 1, private: secret },
  });
  const piEntryOutput = readPiEntryEvidence([
    {
      type: "custom",
      id: "context-1",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      customType: "ctx_status",
      data: { schemaVersion: 1, active: true, private: secret },
    } satisfies SessionEntry,
  ]);
  const producerCompletionId = `completion-${secret}`;
  const producerChildId = `child-${secret}`;
  const subagentEvidence = readSubagentEvidence(
    parseSessionJsonl(
      [
        JSON.stringify({ type: "session", version: 3, id: "session-1" }),
        JSON.stringify({
          type: "message",
          id: "m1",
          parentId: null,
          timestamp: "2026-01-01T00:00:00.000Z",
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
          timestamp: "2026-01-01T00:00:01.000Z",
          message: {
            role: "toolResult",
            toolCallId: "c1",
            toolName: "subagent_wait",
            isError: false,
            content: [],
            usage: {
              input: 5,
              output: 4,
              cacheRead: 3,
              cacheWrite: 2,
              totalTokens: 14,
              cost: { total: 0.02 },
            },
            details: {
              completions: [
                {
                  runId: producerCompletionId,
                  agent: "workflow",
                  state: "complete",
                  success: true,
                  results: [
                    {
                      runId: producerChildId,
                      agent: "reviewer",
                      success: false,
                    },
                  ],
                },
              ],
            },
          },
        }),
      ].join("\n"),
    ).entries,
  );
  const subagentOutput = {
    state: subagentEvidence.state,
    runs: subagentEvidence.runs,
  };
  const report = toSessionReport(parent, {
    agents: subagentOutput,
    integrations: piEntryOutput,
  });

  assert.equal(subagentOutput.state, "supported");
  assert.equal(subagentOutput.runs.length, 2);
  assert.match(subagentOutput.runs[0]?.id ?? "", /^subagent-[a-f0-9]{64}$/);
  assert.equal(subagentOutput.runs[0]?.parentId, undefined);
  assert.equal(subagentOutput.runs[1]?.parentId, subagentOutput.runs[0]?.id);
  assert.deepEqual(report.agents, subagentOutput.runs);

  for (const output of [
    registryOutput,
    piEntryOutput,
    subagentEvidence,
    report,
    renderJson(report),
  ]) {
    const json = JSON.stringify(output);
    assert.equal(json.includes(secret), false);
    assert.equal(json.includes(producerChildId), false);
    assert.equal(json.includes(producerCompletionId), false);
  }
});

/** Asserts no sentinel appears in the serialized form of any observed output. */
function assertNoSentinels(
  sentinels: readonly string[],
  output: unknown,
  label: string,
): void {
  const json = JSON.stringify(output) ?? "";
  for (const sentinel of sentinels) {
    assert.equal(json.includes(sentinel), false, `${label} leaked ${sentinel}`);
  }
}

const fixtureUrl = (name: string) =>
  new URL(`../fixtures/integrations/${name}`, import.meta.url);

test("seeded privacy sentinels never reach adapters, report, HTML, or every TUI tab", async () => {
  const sentinels = [
    "PRIVATE_TASK",
    "PRIVATE_BODY",
    "secret",
    "/home/dev/private",
    "C:\\Users\\dev\\private",
    "file:///home/dev/private",
    "permission-value-secret",
    "permission-matched-pattern-secret",
    "promptGuidelines",
  ] as const;

  // 1. Inventory adapter: producer paths, tool description/parameters/
  //    promptGuidelines, and path/secret-like descriptions are never read.
  const commands = JSON.parse(
    await readFile(fixtureUrl("commands-inventory.json"), "utf8"),
  ) as unknown[];
  const tools = JSON.parse(
    await readFile(fixtureUrl("tools-inventory.json"), "utf8"),
  ) as unknown[];
  commands.push({
    name: "private-cmd",
    source: "extension",
    description: `PRIVATE_BODY secret /home/dev/private`,
    sourceInfo: {
      path: "C:\\Users\\dev\\private\\cmd.ts",
      source: "file:///home/dev/private",
      scope: "user",
      origin: "package",
    },
  });
  tools.push({
    name: "private_tool",
    description: "PRIVATE_BODY",
    parameters: { body: "PRIVATE_BODY" },
    promptGuidelines: ["promptGuidelines secret"],
    sourceInfo: {
      path: "file:///home/dev/private/tool.ts",
      source: "file:///home/dev/private",
      scope: "user",
      origin: "package",
    },
  });
  const inventoryOutput = readInventory(commands, tools);
  assertNoSentinels(sentinels, inventoryOutput, "inventory adapter");

  // 2. Permission bus adapter: only the closed result/resolution vocabulary and
  //    prompt source class may be retained; `value`/`matchedPattern`/`request`/
  //    `forwarding`/`agentName`/`origin` never reach the WAL envelope.
  const permissionRows = JSON.parse(
    await readFile(fixtureUrl("permission-events.json"), "utf8"),
  ) as Array<{ channel: string; data: unknown }>;
  permissionRows.push({
    channel: "permissions:decision",
    data: {
      result: "allow",
      resolution: "policy_allow",
      value: "permission-value-secret",
      matchedPattern: "permission-matched-pattern-secret",
      request: { prompt: "PRIVATE_BODY" },
      forwarding: "PRIVATE_BODY",
      agentName: "PRIVATE_TASK",
      origin: "PRIVATE_BODY",
    },
  });
  const handlers = new Map<string, (data: unknown) => void>();
  const inputHandlers: Array<(event: { text: string }) => void> = [];
  const envelopes: unknown[] = [];
  registerLiveCounters(
    {
      events: {
        on: (channel, handler) => {
          handlers.set(channel, handler);
          return () => {};
        },
      },
      on: (_event, handler) => inputHandlers.push(handler),
    },
    {
      appendTelemetry: (envelope) => envelopes.push(envelope),
      flush: async () => {},
    },
    {
      sessionId: "privacy-corpus",
      inventoryNames: () => new Set(["council-mode"]),
      now: () => new Date("2026-09-11T10:00:00Z"),
    },
  );
  for (const row of permissionRows) handlers.get(row.channel)?.(row.data);
  inputHandlers[0]?.({ text: "/skill:council-mode PRIVATE_BODY secret" });
  assertNoSentinels(sentinels, envelopes, "permission adapter");

  // 3. Pi entry adapter: versioned counters only, never custom data payloads.
  const piEntryOutput = readPiEntryEvidence([
    {
      type: "custom",
      id: "ctx-private",
      parentId: null,
      timestamp: "2026-09-11T10:00:00.000Z",
      customType: "ctx_status",
      data: {
        schemaVersion: 1,
        active: true,
        task: "PRIVATE_TASK",
        body: "PRIVATE_BODY",
        path: "/home/dev/private",
      },
    } satisfies SessionEntry,
  ]);
  assertNoSentinels(sentinels, piEntryOutput, "pi entry adapter");

  // 4. Subagent adapter: the producer `task`/session path stay inside; only the
  //    bounded run label, opaque id, and child usage reach the DTO.
  const uatFile = fileURLToPath(
    new URL("../fixtures/pi/0.85.1/uat-session.jsonl", import.meta.url),
  );
  const uatEntries = parseSessionJsonl(await readFile(uatFile, "utf8")).entries;
  const subagentOutput = readSubagentEvidence(uatEntries);
  assertNoSentinels(sentinels, subagentOutput, "subagent adapter");

  // 5. Production report path: observation + UAT fixture -> SessionReport and
  //    both serializers and every TUI tab.
  const inventory = readInventory(commands, tools);
  const observation = {
    ...emptyObservation(),
    presence: readIntegrationPresence({
      extensionCommands: inventory.commands
        .filter((row) => row.source === "extension")
        .map((row) => row.name),
      tools: Object.keys(inventory.toolSources),
      permissionsReady: false,
      inventoryAvailable: true,
    }),
    inventory,
  };
  const model = await loadCurrentSessionReport(uatFile, "tree", {
    leafId: "r1",
    observation,
  });
  assert.ok(model);
  const report = model.report;
  assertNoSentinels(sentinels, report, "SessionReport");
  assertNoSentinels(sentinels, renderJson(report), "renderJson");

  const bundle: InspectorBundle = {
    schemaVersion: 1,
    theme: "dark",
    initialScope: "tree",
    current: {
      active: {
        availability: "unavailable",
        diagnostic: "current-unavailable",
      },
      tree: {
        availability: "available",
        report,
        daily: [],
        dailyTruncated: false,
      },
    },
    history: { availability: "unavailable", sessions: [], diagnostics: [] },
    global: {
      availability: "unavailable",
      sessions: [],
      usage: { totalTokens: 0, cost: 0 },
      dates: [],
      diagnostics: [],
      inventory: { commands: null, skills: null, resources: null },
    },
  };
  assertNoSentinels(sentinels, renderInspectorBundle(bundle), "bundle HTML");

  const theme = { fg: (_color: string, text: string) => text };
  for (const tab of CURRENT_TABS) {
    const component = createCurrentTuiComponent({
      model: createCurrentTuiModel(report, "tree"),
      load: async () => model,
      theme,
      initialTab: tab,
      requestRender: () => {},
      done: () => {},
    });
    assertNoSentinels(sentinels, component.render(120), `TUI ${tab}`);
  }
});

test("missing subagent tool results remain unavailable rather than supported", () => {
  const entries = parseSessionJsonl(
    [
      JSON.stringify({ type: "session", version: 3, id: "session-1" }),
      JSON.stringify({
        type: "message",
        id: "m1",
        parentId: null,
        timestamp: "2026-01-01T00:00:00.000Z",
        message: {
          role: "assistant",
          provider: "acme",
          model: "alpha",
          content: [{ type: "toolCall", id: "c9", name: "read" }],
        },
      }),
    ].join("\n"),
  ).entries;
  const evidence = readSubagentEvidence(entries);
  const report = toSessionReport(parent, {
    agents: { state: evidence.state, runs: evidence.runs },
  });

  assert.equal(evidence.state, "unavailable");
  assert.deepEqual(evidence.runs, []);
  assert.equal(evidence.activity.calls, 0);
  assert.equal(report.agentEvidence, "unavailable");
  assert.deepEqual(report.agents, []);
});

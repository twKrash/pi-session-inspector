import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { ReducedSession, SessionEntry } from "../../src/core/events.ts";
import { canonicalOpaqueDigest } from "../../src/core/opaque-id.ts";
import { reconcileAgentRuns } from "../../src/core/subagent-reconciliation.ts";
import { toSessionReport } from "../../src/core/reports.ts";
import type { PresenceContext } from "../../src/integrations/contract.ts";
import { createEvidenceRegistry } from "../../src/integrations/evidence.ts";
import { readInventory } from "../../src/integrations/inventory.ts";
import { registerLiveCounters } from "../../src/integrations/live-counters.ts";
import { readPersistedEvidence } from "../../src/integrations/persisted.ts";
import { readPresence } from "../../src/integrations/presence.ts";
import { readSubagentEvidence as readSubagentEvidenceWithSession } from "../../src/integrations/subagents.ts";
import { renderJson } from "../../src/ui/json.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";
import type { InspectorBundle } from "../../src/ui/bundle.ts";
import { CURRENT_TABS, createCurrentTuiModel } from "../../src/ui/current.ts";
import { createCurrentTuiComponent } from "../../src/ui/current-tui.ts";
import { loadCurrentSessionReport } from "../../src/ui/load-current.ts";
import { emptyObservation } from "../../src/ui/observation.ts";
import { renderSnapshot } from "../../src/ui/snapshot.ts";
import { projectInspectorUi } from "../../src/ui/ui-projection.ts";
import { FORBIDDEN_PRODUCER_KEYS } from "../helpers/bundle-scenarios.ts";

/** The registry's presence model, keyed by every registered integration. */
const readIntegrationPresence = (signals: PresenceContext) =>
  readPresence(signals).presence;

/** The registry's persisted-evidence read, in report order (ADR 0019). */
const readPiEntryEvidence = (entries: readonly SessionEntry[]) =>
  readPersistedEvidence({ entries, sessionId: "session-privacy-test" }).rows;

const SUBAGENT_SESSION_ID = "session-privacy-test";
const readSubagentEvidence = (entries: readonly SessionEntry[]) =>
  readSubagentEvidenceWithSession(entries, SUBAGENT_SESSION_ID);
const runsOf = (evidence: ReturnType<typeof readSubagentEvidence>) =>
  reconcileAgentRuns(evidence.observations).runs;

const secret = "m5-seeded-secret";
/** Raw producer identity for the opaque `permission-request` domain (§18.7). */
const rawPermissionRequestId = "PRIVATE_REQUEST_ID";
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
  const subagentObservations = [...subagentEvidence.observations];
  const subagentOutput = {
    state: subagentEvidence.state,
    runs: reconcileAgentRuns(subagentObservations).runs,
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
    subagentObservations,
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
    rawPermissionRequestId,
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
      requestId: rawPermissionRequestId,
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
      on: (_event, handler) => {
        inputHandlers.push(handler);
        return () => {};
      },
    },
    {
      appendTelemetry: (envelope) => envelopes.push(envelope),
      flush: async () => {},
    },
    {
      sessionId: "privacy-corpus",
      root: "/inspector",
      runtimeId: "runtime-privacy-corpus",
      inventoryNames: () => new Set(["council-mode"]),
      now: () => new Date("2026-09-11T10:00:00Z"),
    },
  );
  for (const row of permissionRows) handlers.get(row.channel)?.(row.data);
  inputHandlers[0]?.({ text: "/skill:council-mode PRIVATE_BODY secret" });
  assertNoSentinels(sentinels, envelopes, "permission adapter");
  // §18.7: the raw producer identity never appears beside its opaque
  // counterpart — only the domain-separated, session-scoped digest does.
  const opaqueRequestId = `permission-request-${canonicalOpaqueDigest(
    "permission-request",
    "privacy-corpus",
    rawPermissionRequestId,
  )}`;
  assert.match(opaqueRequestId, /^permission-request-[a-f0-9]{64}$/);
  assert.equal(
    JSON.stringify(envelopes).includes(opaqueRequestId),
    true,
    "the opaque counterpart must be published",
  );
  assert.equal(
    JSON.stringify(envelopes).includes(rawPermissionRequestId),
    false,
  );

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
  const sourceObservations = [...subagentOutput.observations];
  assertNoSentinels(sentinels, sourceObservations, "subagent observations");
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
      observed: [],
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
  // §18.7: `unavailable`/`expired` never serialize as a fabricated zero.
  assert.equal(report.evidenceHealth.aggregates.detail, "expired");
  assert.equal(report.skills.invocationState, "unavailable");
  assert.equal(report.skills.invocationCount, null);
  assert.equal(report.skills.otherInvocations, null);
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
      sameReportProjection: false,
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
  const { ui, html: bundleHtml } = treeSnapshot(bundle);
  assertNoSentinels(sentinels, bundleHtml, "snapshot HTML");

  // The projected agent and tool rows carry their bounded role/label fields and
  // the canonical ids only: no producer text, no content, no path field.
  const projected = ui.current.tree.report;
  if (projected === undefined) throw new Error("the tree report must project");
  assert.deepEqual(
    [
      projected.agents[0].agent,
      projected.agents[0].observedAt,
      projected.agents[0].evidenceToolId,
    ],
    ["worker", "2026-09-11T09:00:04.000Z", "tool:call-1"],
  );
  assertNoSentinels(sentinels, projected.agents, "projected agent rows");
  assertNoSentinels(sentinels, projected.tools, "projected tool rows");
  for (const row of [...projected.agents, ...projected.tools]) {
    // The one shared forbidden-key list (no producer text, no path field).
    for (const forbidden of FORBIDDEN_PRODUCER_KEYS) {
      assert.equal(forbidden in row, false, forbidden);
    }
  }

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

test("persisted async identifiers and directories stay out of report, JSON, HTML, and TUI", async () => {
  const sentinels = [
    "async-run-a",
    "async-run-b",
    "PRIVATE_ASYNC_DIR",
    "PRIVATE_BODY",
  ];
  const parsed = parseSessionJsonl(
    await readFile(
      new URL(
        "../fixtures/pi-subagents/persisted-async-visibility.jsonl",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const source = readSubagentEvidenceWithSession(parsed.entries, parsed.id);
  const runs = reconcileAgentRuns(source.observations, source.aliases).runs;
  assert.equal(runs.filter((run) => run.executionKind === "async").length, 2);
  const report = toSessionReport(
    { ...parent, sessionId: parsed.id },
    { agents: { state: "supported", runs } },
  );
  assert.deepEqual(report.usage, parent.usage);
  const json = renderJson(report);
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
      sameReportProjection: false,
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
  const { ui, html } = treeSnapshot(bundle);
  const projected = ui.current.tree.report;
  if (projected === undefined) throw new Error("the tree report must project");
  const asyncRows = projected.agents.filter(
    (run) => run.executionKind === "async",
  );
  assert.equal(asyncRows.length, 2);
  assert.deepEqual(
    asyncRows.map((run) => run.parentId),
    [null, null],
  );
  assertNoSentinels(
    sentinels,
    { source, report, json, html, projected },
    "persisted async report outputs",
  );
  const tuiModel = createCurrentTuiModel(report, "tree");
  assert.equal(
    tuiModel.report.agents.filter((run) => run.executionKind === "async")
      .length,
    2,
  );
  const theme = { fg: (_color: string, text: string) => text };
  for (const tab of CURRENT_TABS) {
    const component = createCurrentTuiComponent({
      model: tuiModel,
      load: async () => tuiModel,
      theme,
      initialTab: tab,
      requestRender: () => {},
      done: () => {},
    });
    assertNoSentinels(
      sentinels,
      component.render(120),
      `persisted async TUI ${tab}`,
    );
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
  const runs = runsOf(evidence);
  const report = toSessionReport(parent, {
    agents: { state: evidence.state, runs },
  });

  assert.equal(evidence.state, "unavailable");
  assert.deepEqual(runs, []);
  assert.equal(evidence.activity.calls, 0);
  assert.equal(report.agentEvidence, "unavailable");
  assert.deepEqual(report.agents, []);
});

function bundleFixture(): InspectorBundle {
  return JSON.parse(
    readFileSync(
      new URL("../fixtures/bundles/inspector-bundle.json", import.meta.url),
      "utf8",
    ),
  ) as InspectorBundle;
}

/**
 * The fixture bundle with hostile producer strings planted in the fields the
 * projection must never read. They live in test code only (no committed fixture
 * carries producer text), and each one is a single-purpose sentinel: the
 * privacy guarantee is that none of them reaches the payload.
 */
/**
 * The one snapshot document for a bundle's tree view: the L2 projection and the
 * rendered snapshot are produced by the same pair of production functions the
 * `snapshot` command calls, so a privacy assertion reads the real output.
 */
function treeSnapshot(bundle: InspectorBundle): {
  ui: ReturnType<typeof projectInspectorUi>;
  html: string;
} {
  const ui = projectInspectorUi({ bundle });
  return {
    ui,
    html: renderSnapshot({
      kind: "current",
      schemaVersion: 1,
      theme: bundle.theme,
      projection: ui.current.tree,
    }),
  };
}

function hostileBundle(): InspectorBundle {
  const bundle = bundleFixture();
  const report = bundle.current.tree.report;
  if (report === undefined) throw new Error("the fixture tree report");
  Object.assign(report, {
    sessionName: "SECRET_TASK",
    task: "SECRET_SUBAGENT_TASK",
    progressSummary: "SECRET_PROMPT",
    finalOutput: "SECRET_OUTPUT",
    transcriptPath: "/home/dev/private/transcript.jsonl",
    artifactPaths: ["/home/dev/private/artifact.json"],
    sessionFile: "file:///home/dev/private/session.jsonl",
  });
  const tool = report.tools[0];
  if (tool === undefined) throw new Error("the fixture tree tool");
  Object.assign(tool, {
    arguments: "SECRET_ARGUMENT",
    result: "SECRET_RESULT",
  });
  return bundle;
}

/**
 * The same fixture with `markup` planted in the bounded string fields the
 * projection does read, so the escaping of the inlined payload is exercised by
 * values that really do reach the document.
 */
function bundleWithHostileStrings(markup: string): InspectorBundle {
  const bundle = bundleFixture();
  const report = bundle.current.tree.report;
  const command = report?.commands.items[0];
  const tool = report?.tools[0];
  if (report === undefined || command === undefined || tool === undefined) {
    throw new Error(
      "the fixture tree projection must carry a command and tool",
    );
  }
  report.sessionId = markup;
  command.name = markup;
  tool.name = markup;
  return bundle;
}

test("the snapshot never carries raw producer text or paths", () => {
  const { ui, html } = treeSnapshot(hostileBundle());
  const sentinels = [
    "SECRET_PROMPT",
    "SECRET_TASK",
    "SECRET_SUBAGENT_TASK",
    "SECRET_RESULT",
    "SECRET_ARGUMENT",
    "SECRET_OUTPUT",
    "progressSummary",
    "finalOutput",
    "transcriptPath",
    "artifactPaths",
    "sessionFile",
    "sessionName",
    "/home/",
    "https://",
  ];
  for (const forbidden of sentinels) {
    assert.equal(html.includes(forbidden), false, forbidden);
  }
  // The planted keys are the ones no producer field may publish under, in the
  // rendered document and in the UI payload the browser receives.
  const payload = JSON.stringify(ui);
  for (const key of FORBIDDEN_PRODUCER_KEYS) {
    assert.equal(html.includes(`"${key}"`), false, key);
    assert.equal(payload.includes(`"${key}"`), false, key);
  }
  // The projection still rendered the rows those hostile fields sat on, so the
  // absence above is not a scenario that planted nothing.
  const projected = ui.current.tree.report;
  if (projected === undefined) throw new Error("the tree report must project");
  assert.deepEqual(
    [projected.tools[0]?.name, projected.commands.items[0]?.name],
    ["read", "review"],
  );
});

test("hostile strings cannot break out of the rendered snapshot", () => {
  const markup = "</script><script>alert(1)</script>";
  const { ui, html } = treeSnapshot(bundleWithHostileStrings(markup));
  // A snapshot carries no script at all: the value is escaped for its text
  // context rather than embedded in a script payload.
  assert.equal(/<script/i.test(html), false);
  assert.equal(html.includes(markup), false);
  assert.equal(html.includes("&lt;/script&gt;&lt;script&gt;alert(1)"), true);
  // The projection still carries the value it read, so the escaping is what
  // dropped the markup, not a projection that discarded the badge.
  assert.equal(ui.current.tree.report?.sessionId, markup);
});

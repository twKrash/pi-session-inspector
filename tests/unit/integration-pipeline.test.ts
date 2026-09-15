import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  IntegrationPresence,
  ReducedSession,
  SessionEntry,
} from "../../src/core/events.ts";
import { toSessionReport } from "../../src/core/reports.ts";
import {
  defineIntegration,
  defineIntegrations,
} from "../../src/integrations/catalog.ts";
import type { Integration } from "../../src/integrations/contract.ts";
import { readCanonicalContributions } from "../../src/integrations/contributions.ts";
import { registerIntegrationLive } from "../../src/integrations/live-counters.ts";
import {
  applyIntegrationTelemetry,
  emptyFoldedCounters,
} from "../../src/core/live-counter-fold.ts";
import { readPersistedEvidence } from "../../src/integrations/persisted.ts";
import { readPresence } from "../../src/integrations/presence.ts";

/**
 * A hypothetical integration that exists only in this test. It owns every fact
 * about itself — its presence signal, its persisted evidence, and its counter
 * vocabulary — and it flows through the generic presence/evidence subsystems
 * and the report pipeline with no core, report, or UI edit. That is the
 * architectural acceptance rule of ADR 0019.
 */
const widgetIntegration = defineIntegration({
  key: "widget",
  aliases: ["widgets"],
  schemas: {
    1: { counters: ["widgets"] },
    2: { counters: ["widgets", "gadgets"] },
  },
  hooks: {
    presence: ({ tools }): IntegrationPresence =>
      tools.includes("widget_tool") ? "present" : "absent",
    persisted: ({ entries }) => {
      let widgets = 0;
      for (const entry of entries) {
        if (entry.type !== "custom" || entry.customType !== "widget-mode") {
          continue;
        }
        widgets += 1;
      }
      return widgets === 0
        ? undefined
        : {
            integration: "widget",
            state: "supported" as const,
            version: 1,
            counters: { widgets },
            reason: "evidence-supported" as const,
          };
    },
  },
});

const gizmoIntegration = defineIntegration({
  key: "gizmo",
  schemas: { 1: { counters: ["calls"] } },
});

const withWidget = defineIntegrations([widgetIntegration, gizmoIntegration]);

function session(): ReducedSession {
  return {
    sessionId: "session-fixture",
    usage: { totalTokens: 10, cost: 1 },
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
}

function widgetEntry(): SessionEntry {
  return {
    id: "widget-1",
    parentId: null,
    timestamp: "2026-09-15T10:00:00.000Z",
    type: "custom",
    customType: "widget-mode",
    data: { schemaVersion: 1 },
  };
}

test("a fixture integration's presence hook flows through generic iteration", () => {
  const rows = readPresence(
    {
      extensionCommands: [],
      tools: ["widget_tool"],
      observed: [],
      inventoryAvailable: true,
    },
    withWidget,
  );

  assert.deepEqual(rows.presence, { widget: "present", gizmo: "unknown" });
  assert.deepEqual(rows.reasons, {
    widget: "inventory-signal",
    gizmo: "not-observed",
  });

  // A live observation of either key is generic state and wins.
  const observed = readPresence(
    {
      extensionCommands: [],
      tools: [],
      observed: ["gizmo", "widget"],
      inventoryAvailable: false,
    },
    withWidget,
  );
  assert.deepEqual(observed.presence, { widget: "present", gizmo: "present" });
  assert.deepEqual(observed.reasons, {
    widget: "live-signal",
    gizmo: "live-signal",
  });
});

test("a fixture integration's persisted hook reaches the report", () => {
  const read = readPersistedEvidence({ entries: [widgetEntry()] }, withWidget);
  assert.deepEqual(read.rows, [
    {
      integration: "widget",
      version: 1,
      state: "supported",
      counters: { widgets: 1 },
    },
  ]);

  const report = toSessionReport(
    session(),
    {
      integrations: read.rows,
      presence: { widget: "present" },
    },
    { integrations: withWidget },
  );

  // Exactly the declared integrations, in declaration order, with the fixture
  // row merged in and no hand-written list anywhere in the projection.
  assert.deepEqual(
    report.integrations.map((row) => row.integration),
    ["widget", "gizmo"],
  );
  assert.deepEqual(report.integrations[0], {
    integration: "widget",
    presence: "present",
    version: 1,
    state: "supported",
    counters: { widgets: 1 },
  });
  assert.equal(
    report.integrations.some((row) => row.integration === "ponytail"),
    false,
  );
});

test("a counter outside the fixture's own schema is stripped, never published", () => {
  const report = toSessionReport(
    session(),
    {
      integrations: [
        {
          integration: "widget",
          version: 1,
          state: "supported",
          counters: { gadgets: 1 },
        },
      ],
    },
    { integrations: withWidget },
  );

  assert.deepEqual(report.integrations, [
    {
      integration: "widget",
      presence: "unknown",
      version: 1,
      state: "supported",
    },
  ]);
});

test("an alias resolves through the catalog, and a legacy key never does", () => {
  const widget = widgetIntegration;
  const legacy = defineIntegration({
    key: "legacy-mode",
    legacyOnly: true,
    schemas: { 1: { counters: ["changes"] } },
  });
  const list = defineIntegrations([widget, legacy]);

  const read = readPersistedEvidence({ entries: [] }, list);
  assert.deepEqual(read.reasons, { widget: "no-persisted-evidence" });

  const report = toSessionReport(
    session(),
    {
      integrations: [
        {
          integration: "legacy-mode",
          version: 1,
          state: "supported",
          counters: { changes: 1 },
        },
      ],
      presence: {},
    },
    { integrations: list },
  );
  assert.deepEqual(
    report.integrations.map((row) => row.integration),
    ["widget", "legacy-mode"],
  );
});

test("a fixture telemetry hook folds by its own key and never another's", () => {
  const widget = defineIntegration({
    key: "widget",
    schemas: { 1: { counters: ["calls"] } },
    hooks: {
      telemetry: (envelope) =>
        (envelope as { metric?: unknown }).metric === "widget.metric"
          ? { counters: { calls: 3 }, presence: true }
          : undefined,
    },
  });
  const list = defineIntegrations([widget]);

  const folded = emptyFoldedCounters();
  const applied = applyIntegrationTelemetry(
    folded,
    { metric: "widget.metric" },
    list,
  );

  assert.equal(applied, true);
  assert.deepEqual(
    (folded.counters as Record<string, Record<string, number>>).widget,
    { calls: 3 },
  );
  assert.deepEqual(folded.presence, { widget: true });
  // No cross-contamination: the shipped permission vocabulary is untouched.
  assert.equal(Object.hasOwn(folded.counters, "permission"), false);
  assert.equal(Object.hasOwn(folded.presence, "permission"), false);

  // An envelope no integration claims yields nothing at all.
  const untouched = emptyFoldedCounters();
  assert.equal(
    applyIntegrationTelemetry(untouched, { metric: "other" }, list),
    false,
  );
  assert.deepEqual(untouched.counters, {});
  assert.deepEqual(untouched.presence, {});
});

test("a fixture live hook registers and disposes while another fails safely", () => {
  let disposed = 0;
  const healthy = defineIntegration({
    key: "healthy",
    schemas: { 1: { counters: ["calls"] } },
    hooks: {
      live: () => ({
        dispose: () => {
          disposed += 1;
        },
      }),
    },
  });
  const throwing = defineIntegration({
    key: "throwing",
    schemas: { 1: { counters: [] } },
    hooks: {
      live: () => {
        throw new Error("registration failed");
      },
    },
  });
  const list = defineIntegrations([throwing, healthy]);

  const disposers = registerIntegrationLive(
    {
      api: { events: { on: () => () => {} }, on: () => () => {} },
      appendTelemetry: () => {},
      sessionId: "session-fixture",
      now: () => new Date("2026-09-15T10:00:00.000Z"),
      inventoryNames: () => new Set<string>(),
      markPresence: () => {},
    },
    list,
  );

  assert.equal(disposers.length, 1, "the healthy integration still registered");
  for (const dispose of disposers) dispose();
  assert.equal(disposed, 1);
});

test("a fixture rich contribution flows through generic orchestration", async () => {
  const rich = defineIntegration({
    key: "rich",
    schemas: { 1: { counters: [] } },
    hooks: {
      canonical: async () => ({
        state: "supported" as const,
        runs: [],
        reason: "evidence-supported" as const,
      }),
    },
  });
  const failing = defineIntegration({
    key: "failing",
    schemas: { 1: { counters: [] } },
    hooks: {
      canonical: () => {
        throw new Error("contribution failed");
      },
    },
  });
  const list = defineIntegrations([rich, failing]);

  const result = await readCanonicalContributions(
    { entries: [], sessionId: "session-fixture" },
    list,
  );
  assert.deepEqual(Object.keys(result.contributions), ["rich"]);
  assert.equal(result.reasons.failing, "contribution-failed");
});

test("a wide registry publishes every declared row, legacy row included", () => {
  // 64 ordinary integrations plus one legacy compatibility row: trusted output
  // is never capped, so none of the 65 rows can be dropped.
  const wide = defineIntegrations([
    ...Array.from({ length: 64 }, (_, index) =>
      defineIntegration({
        key: `wide-${index}`,
        schemas: { 1: { counters: ["calls"] } },
      }),
    ),
    defineIntegration({
      key: "legacy-mode",
      legacyOnly: true,
      schemas: { 1: { counters: ["changes"] } },
    }),
  ]);
  assert.equal(wide.length, 65);

  const report = toSessionReport(
    session(),
    {
      integrations: [
        {
          integration: "legacy-mode",
          version: 1,
          state: "supported",
          counters: { changes: 1 },
        },
      ],
      presence: {},
    },
    { integrations: wide },
  );

  assert.equal(report.integrations.length, 65);
  assert.deepEqual(
    report.integrations.map((row) => row.integration),
    [
      ...Array.from({ length: 64 }, (_, index) => `wide-${index}`),
      "legacy-mode",
    ],
  );
  assert.equal(report.integrations.at(-1)?.state, "supported");
});

test("hostile adapter input stays independently bounded", () => {
  // Registered keys are trusted; adapter-supplied rows are not. A hostile input
  // can neither invent a key nor exceed the safety cap, and the cap is
  // independent of how many integrations are declared.
  const rows: unknown[] = [
    ...Array.from({ length: 200 }, () => ({
      integration: "widget",
      version: 1,
      state: "supported",
      counters: { widgets: 1 },
    })),
    { integration: "not-declared", version: 1, state: "supported" },
  ];
  const report = toSessionReport(
    session(),
    { integrations: rows as never },
    { integrations: withWidget },
  );

  assert.equal(report.integrations.length <= 64, true);
  assert.equal(
    report.integrations.every((row) => row.integration === "widget"),
    true,
  );
});

test("a fixture integration failing never blocks another", () => {
  const throwing = defineIntegration({
    key: "throwing",
    schemas: { 1: { counters: [] } },
    hooks: {
      presence: () => {
        throw new Error("presence failed");
      },
      persisted: () => {
        throw new Error("evidence failed");
      },
    },
  });
  const healthy = defineIntegration({
    key: "healthy",
    schemas: { 1: { counters: ["calls"] } },
    hooks: {
      presence: () => "present",
      persisted: () => ({
        integration: "healthy",
        state: "supported",
        version: 1,
        counters: { calls: 3 },
        reason: "evidence-supported",
      }),
    },
  });
  const list: readonly Integration[] = defineIntegrations([throwing, healthy]);

  const presence = readPresence(
    {
      extensionCommands: [],
      tools: [],
      observed: [],
      inventoryAvailable: true,
    },
    list,
  );
  assert.deepEqual(presence.presence, {
    throwing: "unknown",
    healthy: "present",
  });
  assert.equal(presence.reasons.throwing, "presence-failed");

  const persisted = readPersistedEvidence({ entries: [] }, list);
  assert.deepEqual(
    persisted.rows.map((row) => row.integration),
    ["healthy"],
  );
  assert.equal(persisted.reasons.throwing, "evidence-failed");
});

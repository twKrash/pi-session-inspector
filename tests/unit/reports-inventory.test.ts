import assert from "node:assert/strict";
import { test } from "node:test";

import { reduceEntries } from "../../src/core/reduce.ts";
import { toSessionReport } from "../../src/core/reports.ts";
import { readInventory } from "../../src/integrations/inventory.ts";
import { emptyObservation } from "../../src/ui/observation.ts";

test("composes inventory, invocation counts, and tool source attribution", () => {
  const reduced = reduceEntries("session-a", [
    {
      id: "a1",
      parentId: null,
      timestamp: "2026-09-11T10:00:00Z",
      type: "message",
      message: {
        role: "assistant",
        provider: "acme",
        model: "alpha",
        usage: { totalTokens: 5, cost: { total: 0.1 } },
        content: [{ type: "toolCall", id: "call-1", name: "subagent" }],
      },
    },
    {
      id: "a2",
      parentId: "a1",
      timestamp: "2026-09-11T10:00:01Z",
      type: "message",
      message: {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "subagent",
        isError: false,
        content: [],
      },
    },
  ]);

  const report = toSessionReport(reduced, {
    presence: emptyObservation().presence,
    inventory: readInventory(
      [
        {
          name: "ponytail",
          source: "extension",
          sourceInfo: {
            path: "/x",
            source: "npm:ponytail",
            scope: "user",
            origin: "package",
          },
        },
      ],
      [
        {
          name: "subagent",
          parameters: {},
          sourceInfo: {
            path: "/y",
            source: "npm:pi-subagents",
            scope: "user",
            origin: "package",
          },
        },
      ],
    ),
    counters: {
      counters: {},
      skillInvocations: { "council-mode": 2 },
      otherInvocations: 1,
      presence: { permission: false },
    },
  });

  assert.equal(report.tools[0]?.source, "npm:pi-subagents");
  assert.equal(report.commands.count, 1);
  assert.equal(report.commands.state, "supported");
  assert.equal(report.skills.invocationState, "supported");
  assert.equal(report.skills.invocationCount, 3);
  assert.equal(report.skills.otherInvocations, 1);
  assert.deepEqual(
    report.skills.items.find((row) => row.name === "council-mode")
      ?.explicitInvocations,
    2,
  );
  assert.equal(report.resources.items.length, 2);
});

test("reports inventory as unavailable when no observation is supplied", () => {
  const report = toSessionReport(reduceEntries("session-b", []));
  assert.equal(report.commands.state, "unavailable");
  assert.equal(report.commands.count, null);
  assert.equal(report.skills.invocationState, "unavailable");
  assert.equal(report.skills.invocationCount, null);
  assert.equal(report.skills.otherInvocations, null);
  assert.equal(report.resources.state, "unavailable");
  assert.deepEqual(report.resources.items, []);
});

test("reports persisted inventory counts after the snapshot expires", () => {
  const report = toSessionReport(reduceEntries("session-c", []), {
    resourceCounts: { commands: 7, skills: 2 },
  });

  assert.equal(report.commands.state, "unavailable");
  assert.equal(report.commands.count, 7);
  assert.deepEqual(report.commands.items, []);
  assert.equal(report.resources.state, "unavailable");
  assert.deepEqual(report.resources.items, []);
});

test("carries counted skill names without an inventory and never a fabricated zero", () => {
  const report = toSessionReport(reduceEntries("session-d", []), {
    counters: {
      counters: {},
      skillInvocations: { "council-mode": 4 },
      otherInvocations: 3,
      presence: { permission: false },
    },
  });

  assert.equal(report.skills.state, "unavailable");
  assert.equal(report.skills.invocationState, "supported");
  assert.equal(report.skills.invocationCount, 7);
  assert.equal(report.skills.otherInvocations, 3);
  assert.deepEqual(report.skills.items, [
    { name: "council-mode", explicitInvocations: 4 },
  ]);
});

test("re-sanitizes labels, drops path-like descriptions, and rejects over-cap inventory evidence", () => {
  const command = {
    name: "ok",
    source: "extension" as const,
    sourceLabel: "/home/dev/secret",
    scope: "user" as const,
    origin: "package" as const,
    description: "/home/dev/project/.env",
  };
  const report = toSessionReport(reduceEntries("session-e", []), {
    inventory: {
      schemaVersion: 1,
      commands: [command],
      skills: [],
      resources: [],
      toolSources: { ok: "auto" },
    },
  });

  assert.equal(report.commands.state, "supported");
  assert.equal(report.commands.items[0]?.sourceLabel, "other");
  assert.equal(report.commands.items[0]?.description, undefined);
  assert.equal(JSON.stringify(report).includes("/home/dev"), false);

  const overCap = toSessionReport(reduceEntries("session-f", []), {
    inventory: {
      schemaVersion: 1,
      commands: Array.from({ length: 257 }, () => command),
      skills: [],
      resources: [],
      toolSources: {},
    },
  });
  assert.equal(overCap.commands.state, "unavailable");
  assert.equal(overCap.commands.count, null);
});

test("drops secret-like and over-long inventory descriptions from report rows", () => {
  const rows = [
    {
      name: "ok",
      source: "extension" as const,
      sourceLabel: "builtin",
      scope: "user" as const,
      origin: "package" as const,
      description: "lists files",
    },
    {
      name: "secret",
      source: "extension" as const,
      sourceLabel: "builtin",
      scope: "user" as const,
      origin: "package" as const,
      description: "api key sk-abcdef123",
    },
    {
      name: "long",
      source: "extension" as const,
      sourceLabel: "builtin",
      scope: "user" as const,
      origin: "package" as const,
      description: "x".repeat(121),
    },
  ];
  const report = toSessionReport(reduceEntries("session-g", []), {
    inventory: {
      schemaVersion: 1,
      commands: rows,
      skills: [],
      resources: [],
      toolSources: {},
    },
  });

  assert.equal(report.commands.state, "supported");
  assert.deepEqual(
    report.commands.items.map((row) => row.description),
    ["lists files", undefined, undefined],
  );
  assert.equal(JSON.stringify(report).includes("sk-abcdef123"), false);
});

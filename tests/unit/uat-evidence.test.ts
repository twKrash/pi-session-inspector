import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { IntegrationObservation } from "../../src/core/events.ts";
import type { SessionReport } from "../../src/core/reports.ts";
import { readInventory } from "../../src/integrations/inventory.ts";
import { readIntegrationPresence } from "../../src/integrations/presence.ts";
import { loadInspectorBundle } from "../../src/ui/bundle.ts";
import { renderInspectorBundle } from "../../src/ui/html.ts";
import { renderJson } from "../../src/ui/json.ts";
import type { GlobalReport, HistoryReport } from "../../src/ui/load-history.ts";
import { loadCurrentSessionReport } from "../../src/ui/load-current.ts";
import {
  emptyObservation,
  type SessionObservation,
} from "../../src/ui/observation.ts";

const UAT_FILE = fileURLToPath(
  new URL("../fixtures/pi/0.85.1/uat-session.jsonl", import.meta.url),
);
const UAT_SESSION_ID = "uat-session";
const UAT_LEAF_ID = "r1";

const checkpointBytes = `${JSON.stringify({
  schemaVersion: 1,
  cursors: {
    pi: {
      lineCount: 5,
      revision: "a".repeat(64),
    },
    wal: { "uat-writer": 2 },
  },
  aggregates: {
    totalTokens: 0,
    totalCost: 0,
    generations: 0,
    tools: 0,
    compactions: 0,
  },
  sealedWal: { "uat-writer": 1 },
  sealingVersion: 1,
})}\n`;

/** Real sanitized inventory matching the UAT surface: caveman present, no ponytail. */
function uatInventory() {
  return readInventory(
    [
      {
        name: "caveman",
        source: "extension",
        description: "Caveman mode levels",
        sourceInfo: {
          path: "/home/dev/private/caveman.ts",
          source: "npm:@pi/caveman@1.2.3",
          scope: "user",
          origin: "package",
        },
      },
      {
        name: "skill:council-mode",
        source: "skill",
        description: "Convene a council",
        sourceInfo: {
          path: "/home/dev/private/skills/council-mode/SKILL.md",
          source: "local",
          scope: "user",
          origin: "top-level",
        },
      },
      {
        name: "web-search",
        source: "prompt",
        sourceInfo: {
          path: "/home/dev/private/prompts/web-search.md",
          source: "local",
          scope: "user",
          origin: "top-level",
        },
      },
    ],
    [
      {
        name: "subagent",
        description: "Delegate work",
        parameters: { type: "object" },
        promptGuidelines: ["promptGuidelines-must-not-surface"],
        sourceInfo: {
          path: "C:\\Users\\dev\\private\\subagents.ts",
          source: "npm:pi-subagents@0.67.0",
          scope: "user",
          origin: "package",
        },
      },
      {
        name: "read",
        sourceInfo: {
          path: "file:///home/dev/private/read.ts",
          source: "builtin",
          scope: "user",
          origin: "top-level",
        },
      },
    ],
  );
}

/** Observation shaped exactly like the production `readSessionObservation`. */
function uatObservation(): SessionObservation {
  const inventory = uatInventory();
  return {
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
}

async function readUatReport(
  root: string,
  observation: SessionObservation,
): Promise<SessionReport> {
  const model = await loadCurrentSessionReport(UAT_FILE, "tree", {
    leafId: UAT_LEAF_ID,
    observation,
    inspectorRoot: root,
  });
  assert.ok(model);
  return model.report;
}

function integrationRow(
  report: SessionReport,
  key: string,
): IntegrationObservation | undefined {
  return report.integrations.find((row) => row.integration === key);
}

async function withUatRoot<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "inspector-uat-"));
  try {
    const directory = join(root, "sessions", UAT_SESSION_ID);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "checkpoint.json"), checkpointBytes);
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("reports Caveman, inventory, agent activity, and absent-vs-unavailable integrations", async () => {
  await withUatRoot(async (root) => {
    const report = await readUatReport(root, uatObservation());

    // The checkpoint is consumed for the cold-WAL notice, never rewritten.
    assert.equal(report.walDetail, "expired");

    const caveman = integrationRow(report, "caveman");
    assert.equal(caveman?.state, "supported");
    assert.equal(caveman?.presence, "present");
    const cavemanChanges = caveman?.counters?.changes;
    assert.ok(typeof cavemanChanges === "number" && cavemanChanges >= 1);

    // Ponytail is absent (no producer command/custom entry) and unavailable,
    // never reported as a fabricated zero-counter support row.
    const ponytail = integrationRow(report, "ponytail");
    assert.equal(ponytail?.presence, "absent");
    assert.equal(ponytail?.state, "unavailable");
    assert.equal(ponytail?.counters, undefined);

    // A known producer without a durable bus stays unavailable, not absent.
    const rtk = integrationRow(report, "rtk");
    assert.equal(rtk?.state, "unavailable");
    const permission = integrationRow(report, "permission");
    assert.equal(permission?.state, "unavailable");
    assert.equal(permission?.presence, "unknown");

    assert.equal(report.commands.state, "supported");
    assert.ok(report.commands.items.length >= 1);
    assert.equal(report.commands.count, report.commands.items.length);
    assert.equal(report.skills.state, "supported");
    assert.ok(report.skills.items.length >= 1);
    assert.ok(report.skills.items.some((row) => row.name === "council-mode"));
    assert.equal(report.resources.state, "supported");
    assert.ok(report.resources.items.length >= 1);

    assert.equal(report.agentActivity.calls, 1);
    assert.equal(report.agentActivity.succeeded, 1);
    assert.equal(report.agents.length, 1);
    assert.equal(report.agents[0]?.agent, "worker");
    assert.match(report.agents[0]?.id ?? "", /^subagent-[a-f0-9]{64}$/);
  });
});

test("repeated reads are byte-identical and leave the checkpoint untouched", async () => {
  await withUatRoot(async (root) => {
    const checkpointPath = join(
      root,
      "sessions",
      UAT_SESSION_ID,
      "checkpoint.json",
    );
    const before = await readFile(checkpointPath, "utf8");

    const observation = uatObservation();
    const first = await readUatReport(root, observation);
    const second = await readUatReport(root, observation);

    assert.equal(renderJson(first), renderJson(second));
    assert.equal(JSON.stringify(first), JSON.stringify(second));

    // A second maintenance-free read never mutates durable state.
    assert.equal(await readFile(checkpointPath, "utf8"), before);
  });
});

test("bundle render is deterministic across repeated loads of the same inputs", async () => {
  await withUatRoot(async (root) => {
    const history: HistoryReport = {
      availability: "unavailable",
      sessions: [],
      diagnostics: [],
    };
    const global: GlobalReport = {
      availability: "unavailable",
      sessions: [],
      usage: { totalTokens: 0, cost: 0 },
      dates: [],
      diagnostics: [],
      inventory: { commands: null, skills: null, resources: null },
    };
    const input = {
      theme: "dark" as const,
      initialScope: "tree" as const,
      root,
      sessionDirectory: () => join(root, "sessions"),
      maintenance: {
        writerId: "uat-writer",
        now: () => new Date("2026-09-11T12:00:00.000Z"),
        isPidAlive: () => true,
      },
      observation: uatObservation(),
      current: { sessionFile: UAT_FILE, leafId: UAT_LEAF_ID },
      loadHistory: async () => history,
      loadGlobal: async () => global,
    };

    const first = await loadInspectorBundle(input);
    const second = await loadInspectorBundle(input);

    assert.equal(JSON.stringify(first), JSON.stringify(second));
    const html = renderInspectorBundle(first);
    assert.equal(renderInspectorBundle(second), html);
    assert.equal(first.current.tree.availability, "available");

    // No raw producer content rides the bundle payload.
    for (const sentinel of [
      "PRIVATE_TASK",
      "PRIVATE_BODY",
      "/home/dev/private",
      "C:\\Users\\dev\\private",
      "file:///home/dev/private",
      "promptGuidelines",
    ]) {
      assert.equal(html.includes(sentinel), false, sentinel);
    }
  });
});

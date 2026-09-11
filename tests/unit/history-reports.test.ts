import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  loadGlobalReport,
  loadHistoryReports,
} from "../../src/ui/load-history.ts";
import { readInventory } from "../../src/integrations/inventory.ts";
import { renderJson } from "../../src/ui/json.ts";

const maintenance = {
  writerId: "maintainer-1",
  now: () => new Date("2026-02-03T12:00:00.000Z"),
  isPidAlive: () => false,
};

const unavailableInventory = {
  commands: { state: "unavailable", items: [], count: null },
  skills: {
    state: "unavailable",
    items: [],
    invocationState: "unavailable",
    invocationCount: null,
    otherInvocations: null,
  },
  resources: { state: "unavailable", items: [] },
};

async function createHistoryRoot(): Promise<{
  root: string;
  sessionDirectory: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "inspector-history-reports-"));
  const sessionDirectory = join(root, "public-sessions");
  await mkdir(sessionDirectory);
  await cp(
    "tests/fixtures/reports/history-session.jsonl",
    join(sessionDirectory, "history-session.jsonl"),
  );
  await mkdir(join(root, "sessions", "history-session"), { recursive: true });
  await writeFile(
    join(root, "sessions", "history-session", "meta.json"),
    '{"schemaVersion":2,"sessionId":"history-session","sourceFile":"history-session.jsonl","state":"tracking"}\n',
  );
  return { root, sessionDirectory };
}

test("replays manifest-discovered history through the shared session report pipeline without exposing source locators", async () => {
  const { root, sessionDirectory } = await createHistoryRoot();
  try {
    const history = await loadHistoryReports({
      root,
      sessionDirectory: () => sessionDirectory,
      scope: "tree",
      maintenance,
    });

    assert.deepEqual(history, {
      availability: "available",
      sessions: [
        {
          availability: "available",
          sessionId: "history-session",
          report: {
            sessionId: "history-session",
            usage: { totalTokens: 30, cost: 0.3 },
            usageComposition: {
              generations: { totalTokens: 30, cost: 0.3 },
              toolResults: { totalTokens: 0, cost: 0 },
              compactions: { totalTokens: 0, cost: 0 },
              branchSummaries: { totalTokens: 0, cost: 0 },
            },
            models: [
              {
                provider: "acme",
                model: "alpha",
                generations: 2,
                totalTokens: 30,
                cost: 0.3,
              },
            ],
            tools: [],
            compactions: [],
            generations: [
              {
                id: "generation:main",
                timestamp: "2026-02-01T10:00:00.000Z",
                provider: "acme",
                model: "alpha",
                usage: { totalTokens: 10, cost: 0.1 },
              },
              {
                id: "generation:other",
                timestamp: "2026-02-02T11:00:00.000Z",
                provider: "acme",
                model: "alpha",
                usage: { totalTokens: 20, cost: 0.2 },
              },
            ],
            agents: [],
            agentEvidence: "unavailable",
            agentActivity: {
              state: "unavailable",
              calls: 0,
              succeeded: 0,
              failed: 0,
              interrupted: 0,
              tools: [],
            },
            integrations: [],
            durationEvidence: "unavailable",
            ...unavailableInventory,
            errors: [],
          },
        },
      ],
      diagnostics: [],
    });
    assert.equal(renderJson(history).includes("history-session.jsonl"), false);
    assert.equal(renderJson(history).includes(sessionDirectory), false);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("returns explicit unavailable sessions when a manifest source cannot replay", async () => {
  const { root, sessionDirectory } = await createHistoryRoot();
  try {
    await writeFile(
      join(root, "sessions", "history-session", "meta.json"),
      '{"schemaVersion":2,"sessionId":"history-session","sourceFile":"missing.jsonl","state":"tracking"}\n',
    );
    const history = await loadHistoryReports({
      root,
      sessionDirectory: () => sessionDirectory,
      scope: "tree",
      maintenance,
    });
    assert.deepEqual(history.sessions, [
      { availability: "unavailable", sessionId: "history-session" },
    ]);
    assert.equal(JSON.stringify(history).includes("missing.jsonl"), false);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("makes malformed JSONL after a valid header and marker unavailable rather than undercounting", async () => {
  const { root, sessionDirectory } = await createHistoryRoot();
  try {
    await writeFile(
      join(sessionDirectory, "history-session.jsonl"),
      [
        '{"type":"session","version":3,"id":"history-session"}',
        '{"type":"custom","id":"marker","parentId":null,"timestamp":"2026-02-01T00:00:01.000Z","customType":"session-inspector:tracking-start","data":{"schemaVersion":1}}',
        '{"type":"message","id":"valid","parentId":"marker","timestamp":"2026-02-01T10:00:00.000Z","message":{"role":"assistant","content":[],"provider":"acme","model":"alpha","usage":{"totalTokens":10,"cost":{"total":0.1}}}}',
        "{ malformed JSONL",
      ].join("\n"),
    );

    const history = await loadHistoryReports({
      root,
      sessionDirectory: () => sessionDirectory,
      scope: "tree",
      maintenance,
    });
    const global = await loadGlobalReport({
      root,
      sessionDirectory: () => sessionDirectory,
      scope: "tree",
      maintenance,
    });

    assert.deepEqual(history.sessions, [
      { availability: "unavailable", sessionId: "history-session" },
    ]);
    assert.deepEqual(global.sessions, [
      { availability: "unavailable", sessionId: "history-session" },
    ]);
    assert.deepEqual(global.usage, { totalTokens: 0, cost: 0 });
    assert.deepEqual(global.dates, []);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("rejects active scope for durable history and global reports rather than inventing historical active leaves", async () => {
  const { root, sessionDirectory } = await createHistoryRoot();
  try {
    const active = await loadHistoryReports({
      root,
      sessionDirectory: () => sessionDirectory,
      scope: "active",
      activeLeafId: () => "main",
      maintenance,
    });
    assert.equal(active.availability, "unavailable");
    assert.deepEqual(active.sessions, []);

    const global = await loadGlobalReport({
      root,
      sessionDirectory: () => sessionDirectory,
      scope: "active",
      maintenance,
    });
    assert.equal(global.availability, "unavailable");
    assert.deepEqual(global.sessions, []);
    assert.deepEqual(global.usage, { totalTokens: 0, cost: 0 });

    await writeFile(
      join(sessionDirectory, "history-session.jsonl"),
      '{"type":"session","version":3,"id":"history-session"}\n',
    );
    const unavailable = await loadHistoryReports({
      root,
      sessionDirectory: () => sessionDirectory,
      scope: "tree",
      maintenance,
    });
    assert.deepEqual(unavailable.sessions, [
      { availability: "unavailable", sessionId: "history-session" },
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("preserves branch-summary usage once through history and global reports", async () => {
  const { root, sessionDirectory } = await createHistoryRoot();
  try {
    await writeFile(
      join(sessionDirectory, "history-session.jsonl"),
      [
        '{"type":"session","version":3,"id":"history-session"}',
        '{"type":"custom","id":"marker","parentId":null,"timestamp":"2026-02-01T00:00:01.000Z","customType":"session-inspector:tracking-start","data":{"schemaVersion":1}}',
        '{"type":"branch_summary","id":"summary","parentId":"marker","timestamp":"2026-02-02T11:00:00.000Z","usage":{"totalTokens":17,"cost":{"total":0.17}}}',
      ].join("\n"),
    );
    const options = {
      root,
      sessionDirectory: () => sessionDirectory,
      scope: "tree" as const,
      maintenance,
    };
    const history = await loadHistoryReports(options);
    const global = await loadGlobalReport(options);

    assert.deepEqual(history.sessions[0], {
      availability: "available",
      sessionId: "history-session",
      report: {
        sessionId: "history-session",
        usage: { totalTokens: 17, cost: 0.17 },
        usageComposition: {
          generations: { totalTokens: 0, cost: 0 },
          toolResults: { totalTokens: 0, cost: 0 },
          compactions: { totalTokens: 0, cost: 0 },
          branchSummaries: { totalTokens: 17, cost: 0.17 },
        },
        models: [],
        tools: [],
        compactions: [
          {
            id: "compaction:summary",
            timestamp: "2026-02-02T11:00:00.000Z",
            kind: "branch_summary",
            usage: { totalTokens: 17, cost: 0.17 },
          },
        ],
        generations: [],
        errors: [],
        agents: [],
        agentEvidence: "unavailable",
        agentActivity: {
          state: "unavailable",
          calls: 0,
          succeeded: 0,
          failed: 0,
          interrupted: 0,
          tools: [],
        },
        integrations: [],
        durationEvidence: "unavailable",
        ...unavailableInventory,
      },
    });
    assert.deepEqual(global.usage, { totalTokens: 17, cost: 0.17 });
    assert.deepEqual(global.dates, [
      {
        date: "2026-02-02",
        sessions: 1,
        usage: { totalTokens: 17, cost: 0.17 },
      },
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("keeps the optional token breakdown in global and per-date folds", async () => {
  const { root, sessionDirectory } = await createHistoryRoot();
  try {
    await writeFile(
      join(sessionDirectory, "history-session.jsonl"),
      [
        '{"type":"session","version":3,"id":"history-session"}',
        '{"type":"custom","id":"marker","parentId":null,"timestamp":"2026-02-01T00:00:01.000Z","customType":"session-inspector:tracking-start","data":{"schemaVersion":1}}',
        '{"type":"message","id":"gen","parentId":"marker","timestamp":"2026-02-01T10:00:00.000Z","message":{"role":"assistant","content":[],"provider":"acme","model":"alpha","usage":{"input":10,"output":5,"cacheRead":2,"cacheWrite":1,"totalTokens":18,"cost":{"total":0.03}}}}',
      ].join("\n"),
    );
    const expected = {
      totalTokens: 18,
      cost: 0.03,
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 2,
      cacheWriteTokens: 1,
    };

    const global = await loadGlobalReport({
      root,
      sessionDirectory: () => sessionDirectory,
      scope: "tree",
      maintenance,
    });

    assert.deepEqual(global.usage, expected);
    assert.deepEqual(global.dates, [
      { date: "2026-02-01", sessions: 1, usage: expected },
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("folds native session usage once into deterministic sorted date rows and inclusive date filters", async () => {
  const { root, sessionDirectory } = await createHistoryRoot();
  try {
    const global = await loadGlobalReport({
      root,
      sessionDirectory: () => sessionDirectory,
      scope: "tree",
      dateRange: { from: "2026-02-02", to: "2026-02-02" },
      maintenance,
    });
    assert.deepEqual(global, {
      availability: "available",
      sessions: [{ availability: "available", sessionId: "history-session" }],
      usage: { totalTokens: 20, cost: 0.2 },
      dates: [
        {
          date: "2026-02-02",
          sessions: 1,
          usage: { totalTokens: 20, cost: 0.2 },
        },
      ],
      inventory: { commands: null, skills: null, resources: null },
      diagnostics: [],
    });

    const repeated = await loadGlobalReport({
      root,
      sessionDirectory: () => sessionDirectory,
      scope: "tree",
      maintenance,
    });
    const repeatedAgain = await loadGlobalReport({
      root,
      sessionDirectory: () => sessionDirectory,
      scope: "tree",
      maintenance,
    });
    assert.equal(renderJson(repeated), renderJson(repeatedAgain));
    assert.deepEqual(
      repeated.dates.map((row) => row.date),
      ["2026-02-01", "2026-02-02"],
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("reads history counters from checkpoint aggregates and counts after the snapshot expires", async () => {
  const { root, sessionDirectory } = await createHistoryRoot();
  try {
    await writeFile(
      join(root, "sessions", "history-session", "checkpoint.json"),
      JSON.stringify({
        schemaVersion: 1,
        cursors: {
          pi: { lineCount: 3, revision: "0".repeat(64) },
          wal: {},
        },
        aggregates: {
          totalTokens: 30,
          totalCost: 0.3,
          generations: 2,
          tools: 0,
          compactions: 0,
          integrationCounters: { permission: { decisions: 2 } },
          skillInvocations: { "council-mode": 3 },
          skillOverflowInvocations: 2,
          presence: { permission: true },
          resourceCounts: { commands: 9, skills: 4 },
        },
      }),
    );
    const options = {
      root,
      sessionDirectory: () => sessionDirectory,
      scope: "tree" as const,
      maintenance,
    };

    const history = await loadHistoryReports(options);
    const session = history.sessions[0];
    assert.equal(session?.availability, "available");
    if (session?.availability !== "available") return;

    assert.equal(session.report.commands.state, "unavailable");
    assert.equal(session.report.commands.count, 9);
    assert.deepEqual(session.report.commands.items, []);
    assert.equal(session.report.skills.state, "unavailable");
    assert.equal(session.report.skills.invocationState, "supported");
    assert.equal(session.report.skills.invocationCount, 5);
    assert.equal(session.report.skills.otherInvocations, 2);
    assert.deepEqual(session.report.skills.items, [
      { name: "council-mode", explicitInvocations: 3 },
    ]);
    assert.equal(
      session.report.integrations.find(
        (row) => row.integration === "permission",
      )?.presence,
      "present",
    );

    const global = await loadGlobalReport(options);
    assert.deepEqual(global.inventory, {
      commands: 9,
      skills: 4,
      resources: null,
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("projects history inventory rows from the persisted snapshot", async () => {
  const { root, sessionDirectory } = await createHistoryRoot();
  try {
    const snapshot = readInventory(
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
    );
    await writeFile(
      join(root, "sessions", "history-session", "inventory.json"),
      JSON.stringify(snapshot),
    );
    const options = {
      root,
      sessionDirectory: () => sessionDirectory,
      scope: "tree" as const,
      maintenance,
    };

    const history = await loadHistoryReports(options);
    const session = history.sessions[0];
    assert.equal(session?.availability, "available");
    if (session?.availability !== "available") return;

    assert.equal(session.report.commands.state, "supported");
    assert.equal(session.report.commands.count, 1);
    assert.equal(session.report.commands.items[0]?.name, "ponytail");
    assert.equal(session.report.resources.state, "supported");
    assert.equal(session.report.resources.items.length, 2);
    assert.equal(
      session.report.integrations.find((row) => row.integration === "ponytail")
        ?.presence,
      "present",
    );

    const global = await loadGlobalReport(options);
    assert.deepEqual(global.inventory, {
      commands: null,
      skills: null,
      resources: 2,
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

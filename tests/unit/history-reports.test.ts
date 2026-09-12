import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { FoldedAggregateEvidence } from "../../src/core/evidence.ts";
import type { SessionEvidenceHealth } from "../../src/core/evidence-health.ts";
import type { CanonicalRetainedAggregates } from "../../src/core/retained-aggregates.ts";
import { readIntegrationPresence } from "../../src/integrations/presence.ts";
import {
  loadGlobalReport,
  loadHistoryReports,
  type HistorySessionEvidence,
  type SessionEvidenceProvider,
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

/** L2 history options with an injected per-session evidence provider (R51). */
function historyOptions(root: string, sessionDirectory: string) {
  return {
    root,
    sessionDirectory: () => sessionDirectory,
    scope: "tree" as const,
    maintenance,
  };
}

/** A provider that answers exactly the keyed sessions, `undefined` otherwise. */
function providerFor(
  evidence: Readonly<Record<string, HistorySessionEvidence | undefined>>,
): SessionEvidenceProvider {
  return async ({ sessionId }) => evidence[sessionId];
}

const emptyEvidence: SessionEvidenceProvider = async () => ({
  evidence: { atomic: [], folded: [] },
});

/** Local fixture of the folded checkpoint-wal-aggregates L0 evidence. */
function foldedWalEvidence(
  sessionId: string,
  input: {
    foldedThrough?: Record<string, number>;
    sealedThrough?: Record<string, number>;
    integrationCounters?: Record<string, Record<string, number>>;
    skillInvocations?: Record<string, number>;
    skillOverflowInvocations?: number;
    presence?: { permission?: true };
  } = {},
): FoldedAggregateEvidence {
  return {
    kind: "checkpoint-wal-aggregates",
    sessionId,
    foldedThrough: input.foldedThrough ?? {},
    sealedThrough: input.sealedThrough ?? {},
    ...(input.integrationCounters === undefined
      ? {}
      : { integrationCounters: input.integrationCounters }),
    ...(input.skillInvocations === undefined
      ? {}
      : { skillInvocations: input.skillInvocations }),
    ...(input.skillOverflowInvocations === undefined
      ? {}
      : { skillOverflowInvocations: input.skillOverflowInvocations }),
    ...(input.presence === undefined ? {} : { presence: input.presence }),
    checkpointedAt: { state: "unavailable" },
    provenance: {
      source: "checkpoint",
      authority: "derived",
      schemaVersion: 1,
    },
  };
}

/** Local fixture of the folded checkpoint-resource-aggregates L0 evidence. */
function foldedResourceEvidence(
  sessionId: string,
  resourceCounts: { commands: number; skills: number; resources?: number },
): FoldedAggregateEvidence {
  return {
    kind: "checkpoint-resource-aggregates",
    sessionId,
    resourceCounts,
    observedAt: { state: "unavailable" },
    checkpointedAt: { state: "unavailable" },
    provenance: {
      source: "checkpoint",
      authority: "derived",
      schemaVersion: 1,
    },
  };
}

/**
 * The canonical health a manifest session with valid Pi evidence and no
 * Inspector-owned evidence produces through L1.
 */
function expectedHistoryHealth(input: {
  recordsSeen: number;
  nativeLines: number;
}): SessionEvidenceHealth {
  return {
    schemaVersion: 1,
    core: "supported",
    sources: [
      {
        source: "pi-jsonl",
        authority: "native",
        state: "supported",
        schemaVersion: 3,
        recordsSeen: input.recordsSeen,
        factsAccepted: input.recordsSeen,
        recordsRejected: 0,
        detail: "full",
      },
      {
        source: "inspector-wal",
        authority: "live",
        state: "unavailable",
        recordsSeen: 0,
        factsAccepted: 0,
        recordsRejected: 0,
        detail: "not-observed",
      },
      {
        source: "subagent-result",
        authority: "cooperative",
        state: "unavailable",
        schemaVersion: 1,
        recordsSeen: 0,
        factsAccepted: 0,
        recordsRejected: 0,
        detail: "full",
      },
    ],
    joins: {
      toolCalls: 0,
      toolResults: 0,
      matchedToolResults: 0,
      matchedLiveToolTimings: 0,
      agentRuns: 0,
      knownAgentParents: 0,
    },
    usage: {
      nativeLines: input.nativeLines,
      childLines: 0,
      compositionReconciled: true,
      dated: "supported",
    },
    aggregates: {
      detail: "expired",
      integrationCounters: 0,
      skillInvocations: { names: 0, overflow: 0, retainedInvocations: 0 },
      permissionPresence: "unavailable",
      resources: "expired",
    },
    diagnostics: [],
  };
}

/** The canonical expired boundary a session without a checkpoint reports. */
function expiredRetainedAggregates(): CanonicalRetainedAggregates {
  return {
    schemaVersion: 1,
    boundary: {
      detail: "expired",
      // The report projection copies cursor maps with a null prototype.
      foldedThrough: Object.create(null) as Record<string, number>,
      sealedThrough: Object.create(null) as Record<string, number>,
      checkpointedAt: { state: "unavailable" },
    },
  };
}

/** Adds one manifest-discovered session with a valid native marker. */
async function addManifestSession(
  root: string,
  sessionDirectory: string,
  sessionId: string,
): Promise<void> {
  await writeFile(
    join(sessionDirectory, `${sessionId}.jsonl`),
    [
      JSON.stringify({ type: "session", version: 3, id: sessionId }),
      JSON.stringify({
        type: "custom",
        id: "marker",
        parentId: null,
        timestamp: "2026-02-01T00:00:01.000Z",
        customType: "session-inspector:tracking-start",
        data: { schemaVersion: 1 },
      }),
    ].join("\n"),
  );
  const directory = join(root, "sessions", sessionId);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "meta.json"),
    `${JSON.stringify({ schemaVersion: 2, sessionId, sourceFile: `${sessionId}.jsonl`, state: "tracking" })}\n`,
  );
}

test("history session report comes from the canonical builder", async () => {
  const { root, sessionDirectory } = await createHistoryRoot();
  try {
    const reports = await loadHistoryReports({
      ...historyOptions(root, sessionDirectory),
      sessionEvidence: providerFor({
        "history-session": {
          evidence: {
            atomic: [],
            folded: [
              foldedWalEvidence("history-session", {
                integrationCounters: { permission: { decisions: 2 } },
                skillInvocations: { "council-mode": 3 },
                skillOverflowInvocations: 2,
                presence: { permission: true },
              }),
              foldedResourceEvidence("history-session", {
                commands: 9,
                skills: 4,
              }),
            ],
          },
        },
      }),
    });
    const session = reports.sessions[0];
    assert.equal(session?.availability, "available");
    if (session?.availability !== "available") return;

    // The report is the builder's projection: canonical health, L1 retained
    // aggregates, and no loader-local evidence shape leaking into the DTO.
    assert.equal(session.report.evidenceHealth.core, "supported");
    assert.equal(
      session.report.evidenceHealth.aggregates.detail,
      "aggregate-only",
    );
    assert.equal(
      session.report.retainedAggregates?.boundary.detail,
      "aggregate-only",
    );
    assert.equal("resourceCounts" in (session.report.skills ?? {}), false);
    assert.equal(session.report.commands.count, 9);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("degrades one session to unavailable when its evidence provider fails or returns nothing", async () => {
  const { root, sessionDirectory } = await createHistoryRoot();
  try {
    const providers: SessionEvidenceProvider[] = [
      async () => {
        throw new Error("provider unavailable");
      },
      async () => undefined,
    ];
    for (const sessionEvidence of providers) {
      const history = await loadHistoryReports({
        ...historyOptions(root, sessionDirectory),
        sessionEvidence,
      });
      assert.deepEqual(history.sessions, [
        { availability: "unavailable", sessionId: "history-session" },
      ]);
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("forwards provider-supplied WAL records and live overflow into the canonical fold", async () => {
  const { root, sessionDirectory } = await createHistoryRoot();
  try {
    const permissionDeny = {
      schemaVersion: 1,
      source: "permission-system",
      metric: "permission.decision",
      kind: "counter",
      value: 1,
      dimensions: { result: "deny", resolution: "user_denied" },
    };
    const history = await loadHistoryReports({
      ...historyOptions(root, sessionDirectory),
      sessionEvidence: providerFor({
        "history-session": {
          evidence: {
            atomic: [],
            folded: [
              foldedWalEvidence("history-session", {
                foldedThrough: { "writer-a": 1 },
              }),
            ],
          },
          walRecords: [
            {
              eventId: "event-2",
              writerId: "writer-a",
              writerSequence: 2,
              telemetry: permissionDeny,
            },
          ],
          liveOverflow: 1,
        },
      }),
    });
    const session = history.sessions[0];
    assert.equal(session?.availability, "available");
    if (session?.availability !== "available") return;

    // The retained suffix is folded by L1, never by the loader; the live
    // overflow count reaches the same live-source partiality as Task 15.
    assert.deepEqual(
      session.report.integrations.find(
        (row) => row.integration === "permission",
      )?.counters,
      { decisions: 1, denied: 1 },
    );
    assert.equal(
      session.report.evidenceHealth.sources.find(
        (row) => row.source === "inspector-wal",
      )?.state,
      "partial",
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("reduces exactly the builder's tree-scoped entries and never pre-marker facts", async () => {
  const { root, sessionDirectory } = await createHistoryRoot();
  try {
    await writeFile(
      join(sessionDirectory, "history-session.jsonl"),
      [
        '{"type":"session","version":3,"id":"history-session"}',
        '{"type":"message","id":"pre","parentId":null,"timestamp":"2026-02-01T09:00:00.000Z","message":{"role":"assistant","provider":"acme","model":"alpha","usage":{"totalTokens":99,"cost":{"total":0.99}}}}',
        '{"type":"custom","id":"marker","parentId":"pre","timestamp":"2026-02-01T09:00:01.000Z","customType":"session-inspector:tracking-start","data":{"schemaVersion":1}}',
        '{"type":"message","id":"post","parentId":"marker","timestamp":"2026-02-01T10:00:00.000Z","message":{"role":"assistant","provider":"acme","model":"alpha","usage":{"totalTokens":7,"cost":{"total":0.07}}}}',
      ].join("\n"),
    );

    const history = await loadHistoryReports(
      historyOptions(root, sessionDirectory),
    );
    const session = history.sessions[0];
    assert.equal(session?.availability, "available");
    if (session?.availability !== "available") return;

    // R49: the builder is the single scope authority; the body reduces its
    // resolved ids (post-marker only), never every parsed entry.
    assert.equal(session.report.usage?.totalTokens, 7);
    assert.deepEqual(
      session.report.generations.map((generation) => generation.id),
      ["generation:post"],
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("keeps the cold-detail notice only when a checkpoint seal proves pruned detail", async () => {
  const { root, sessionDirectory } = await createHistoryRoot();
  try {
    const sealed = await loadHistoryReports({
      ...historyOptions(root, sessionDirectory),
      sessionEvidence: providerFor({
        "history-session": {
          evidence: {
            atomic: [],
            folded: [
              foldedWalEvidence("history-session", {
                foldedThrough: { "writer-a": 1 },
                sealedThrough: { "writer-a": 1 },
              }),
            ],
          },
        },
      }),
    });
    const sealedSession = sealed.sessions[0];
    if (sealedSession?.availability !== "available") return;
    assert.equal(sealedSession.report.walDetail, "expired");

    const unsealed = await loadHistoryReports({
      ...historyOptions(root, sessionDirectory),
      sessionEvidence: providerFor({
        "history-session": {
          evidence: {
            atomic: [],
            folded: [
              foldedWalEvidence("history-session", {
                foldedThrough: { "writer-a": 1 },
              }),
            ],
          },
        },
      }),
    });
    const unsealedSession = unsealed.sessions[0];
    if (unsealedSession?.availability !== "available") return;
    assert.equal(unsealedSession.report.walDetail, undefined);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("keeps history health joined to the subagent evidence the DTO publishes", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-history-reports-"));
  const sessionDirectory = join(root, "public-sessions");
  try {
    await mkdir(sessionDirectory);
    await cp(
      "tests/fixtures/pi/0.85.1/uat-session.jsonl",
      join(sessionDirectory, "uat-session.jsonl"),
    );
    const directory = join(root, "sessions", "uat-session");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "meta.json"),
      `${JSON.stringify({ schemaVersion: 2, sessionId: "uat-session", sourceFile: "uat-session.jsonl", state: "tracking" })}\n`,
    );

    const history = await loadHistoryReports({
      ...historyOptions(root, sessionDirectory),
      sessionEvidence: emptyEvidence,
    });
    const session = history.sessions[0];
    assert.equal(session?.availability, "available");
    if (session?.availability !== "available") return;

    // P1.2: the builder receives the same cooperative evidence the report
    // publishes, so health and body cannot contradict each other.
    assert.equal(session.report.agents.length, 1);
    assert.equal(session.report.agentActivity.calls, 1);
    assert.equal(
      session.report.evidenceHealth.joins.agentRuns,
      session.report.agents.length,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("sums canonical resource counts across sessions and stays unknown without them", async () => {
  const { root, sessionDirectory } = await createHistoryRoot();
  try {
    await addManifestSession(root, sessionDirectory, "second-session");
    const evidence = {
      "history-session": {
        evidence: {
          atomic: [],
          folded: [
            foldedResourceEvidence("history-session", {
              commands: 9,
              skills: 4,
            }),
          ],
        },
      },
      "second-session": {
        evidence: {
          atomic: [],
          folded: [
            foldedResourceEvidence("second-session", {
              commands: 1,
              skills: 2,
            }),
          ],
        },
      },
    };

    const global = await loadGlobalReport({
      ...historyOptions(root, sessionDirectory),
      sessionEvidence: providerFor(evidence),
    });
    assert.deepEqual(global.inventory, {
      commands: 10,
      skills: 6,
      resources: null,
    });

    // An unavailable session contributes nothing, and with no session
    // reporting a count the field stays unknown, never a fabricated zero.
    const partial = await loadGlobalReport({
      ...historyOptions(root, sessionDirectory),
      sessionEvidence: providerFor({
        "history-session": evidence["history-session"],
      }),
    });
    assert.deepEqual(partial.inventory, {
      commands: 9,
      skills: 4,
      resources: null,
    });

    const unknown = await loadGlobalReport({
      ...historyOptions(root, sessionDirectory),
      sessionEvidence: emptyEvidence,
    });
    assert.deepEqual(unknown.inventory, {
      commands: null,
      skills: null,
      resources: null,
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

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
            evidenceHealth: expectedHistoryHealth({
              recordsSeen: 3,
              nativeLines: 2,
            }),
            retainedAggregates: expiredRetainedAggregates(),
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
        evidenceHealth: expectedHistoryHealth({
          recordsSeen: 2,
          nativeLines: 1,
        }),
        retainedAggregates: expiredRetainedAggregates(),
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

test("reads history counters from injected checkpoint aggregates and counts after the snapshot expires", async () => {
  const { root, sessionDirectory } = await createHistoryRoot();
  try {
    // The checkpoint aggregates arrive as L0 folded evidence from the
    // composition root; the loader itself reads no checkpoint.
    const options = {
      ...historyOptions(root, sessionDirectory),
      sessionEvidence: providerFor({
        "history-session": {
          evidence: {
            atomic: [],
            folded: [
              foldedWalEvidence("history-session", {
                integrationCounters: { permission: { decisions: 2 } },
                skillInvocations: { "council-mode": 3 },
                skillOverflowInvocations: 2,
                presence: { permission: true },
              }),
              foldedResourceEvidence("history-session", {
                commands: 9,
                skills: 4,
              }),
            ],
          },
        },
      }),
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
    // The persisted snapshot and its presence model arrive through the
    // injected observation; the loader never reads `inventory.json` itself.
    const options = {
      ...historyOptions(root, sessionDirectory),
      sessionEvidence: providerFor({
        "history-session": {
          evidence: { atomic: [], folded: [] },
          observation: {
            presence: readIntegrationPresence({
              extensionCommands: snapshot.commands
                .filter((row) => row.source === "extension")
                .map((row) => row.name),
              tools: Object.keys(snapshot.toolSources),
              permissionsReady: false,
              inventoryAvailable: true,
            }),
            inventory: snapshot,
          },
        },
      }),
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

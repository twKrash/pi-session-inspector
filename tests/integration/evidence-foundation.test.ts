import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

import { buildCanonicalSession } from "../../src/core/canonical.ts";
import type { FoldedAggregateEvidence } from "../../src/core/evidence.ts";
import { canonicalOpaqueDigest } from "../../src/core/opaque-id.ts";
import { reduceEntries } from "../../src/core/reduce.ts";
import registerSessionInspector from "../../src/index.ts";
import { registerLiveCounters } from "../../src/integrations/live-counters.ts";
import { readInventory } from "../../src/integrations/inventory.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";
import { consumeTelemetry } from "../../src/pi/telemetry.ts";
import { writeInventorySnapshot } from "../../src/storage/inventory-snapshot.ts";

/**
 * End-to-end regression coverage for the Evidence Foundation milestone (spec
 * §17 invariants 29-35, §18.8 release checks). One synthetic tracked session is
 * driven through the production composition root — the real command handler,
 * the real WAL/inventory writers and the real canonical builder — and every
 * artifact the read produced is asserted on:
 *
 * - §26: unchanged inputs build byte-identical canonical JSON/report artifacts;
 * - §23: no prohibited producer key or seeded sentinel reaches WAL, checkpoint,
 *   inventory, or report JSON;
 * - §17/§31: aggregate-only survivors are labelled, never zeroed, and carry no
 *   synthetic activity row or timestamp;
 * - §18.2: an unknown-semantic node between known nodes keeps Active ancestry
 *   resolvable.
 *
 * The fixture builder is local to this file (ruling R2): the briefed assertions
 * are the contract, not a reusable harness.
 */

const SESSION_ID = "evidence-foundation";
const OBSERVED_AT = "2026-09-12T07:00:00.000Z";
const TOOL_CALL_ID = "call-1";
const WAL_WRITER_ID = "writer-a";
const DURATION_MS = 5_000;

/** Seeded producer text that no artifact, projection, or report may carry. */
const SEEDED_SENTINELS = [
  "PRIVATE_TASK",
  "PRIVATE_BODY",
  "PRIVATE_GUIDELINE",
  "/home/dev/private",
  "sk-livesecretsk-livesecret",
] as const;

/**
 * Raw producer identity for the opaque `permission-request` domain (§18.7): it
 * must never persist beside its opaque, session-scoped counterpart.
 */
const RAW_PERMISSION_REQUEST_ID = "req-raw-9f3c-private";

/** Exact prohibited producer keys (spec §16.1); `totalTokens` is not `token`. */
const PROHIBITED_KEYS =
  /"(prompt|content|args|arguments|resultBody|task|body|cwd|path|password|secret|token|apiKey|matchedPattern|forwarding|agentName)"\s*:/;

type FixtureReport = {
  sessionId: string;
  walDetail?: string;
  usage: { totalTokens: number; cost: number };
  tools: readonly {
    id: string;
    name: string;
    durationMs?: number;
    source?: string;
  }[];
  durationEvidence: string;
  skills: {
    invocationState: string;
    invocationCount: number | null;
    otherInvocations: number | null;
    items: readonly { name: string; explicitInvocations?: number }[];
  };
  commands: { state: string; count: number | null };
  resources: { state: string; items: readonly unknown[] };
  evidenceHealth: {
    core: string;
    sources: readonly {
      source: string;
      state: string;
      recordsSeen: number;
      factsAccepted: number;
    }[];
    aggregates: {
      detail: string;
      resources: string;
      skillInvocations: {
        names: number;
        overflow: number;
        retainedInvocations: number;
      };
    };
    diagnostics: readonly { code: string; source: string }[];
  };
  retainedAggregates?: {
    boundary: { detail: string; foldedThrough: Record<string, number> };
    integration?: Record<string, { value: Record<string, number> }>;
    skillInvocations?: { named?: { value: Record<string, number> } };
    resources?: {
      counts: Record<string, number>;
      observedAt: { state: string; at?: string };
    };
  };
};

/** The tracked fixture session: one generation, one tool call/result, one turn. */
function sessionSource(): string {
  return [
    JSON.stringify({
      type: "session",
      version: 3,
      id: SESSION_ID,
      timestamp: "2026-09-12T06:59:00.000Z",
      cwd: "/home/dev/private",
    }),
    JSON.stringify({
      type: "custom",
      id: "marker",
      parentId: null,
      timestamp: "2026-09-12T07:00:00.000Z",
      customType: "session-inspector:tracking-start",
      data: { schemaVersion: 1 },
    }),
    JSON.stringify({
      type: "message",
      id: "gen-1",
      parentId: "marker",
      timestamp: "2026-09-12T07:00:01.000Z",
      message: {
        role: "assistant",
        provider: "acme",
        model: "alpha",
        content: [
          {
            type: "toolCall",
            id: TOOL_CALL_ID,
            name: "read",
            arguments: {
              task: "PRIVATE_TASK",
              body: "PRIVATE_BODY",
              promptGuidelines: ["PRIVATE_GUIDELINE"],
              path: "/home/dev/private/session.jsonl",
            },
          },
        ],
        usage: {
          input: 10,
          output: 5,
          cacheRead: 1,
          cacheWrite: 1,
          totalTokens: 17,
          cost: { total: 0.017 },
        },
      },
    }),
    JSON.stringify({
      type: "message",
      id: "res-1",
      parentId: "gen-1",
      timestamp: "2026-09-12T07:00:06.000Z",
      message: {
        role: "toolResult",
        toolCallId: TOOL_CALL_ID,
        toolName: "read",
        isError: false,
        content: [{ type: "text", text: "PRIVATE_BODY" }],
        usage: {
          input: 2,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 3,
          cost: { total: 0.003 },
        },
      },
    }),
    JSON.stringify({
      type: "message",
      id: "gen-2",
      parentId: "res-1",
      timestamp: "2026-09-12T07:00:07.000Z",
      message: {
        role: "assistant",
        provider: "acme",
        model: "alpha",
        content: [
          { type: "text", text: "PRIVATE_BODY sk-livesecretsk-livesecret" },
        ],
        usage: { totalTokens: 5, cost: { total: 0.005 } },
      },
    }),
  ].join("\n");
}

type LiveEnvelopes = {
  /** Raw adapter output (pre-validation), exactly as the adapters emit it. */
  raw: unknown[];
  /** Post-`consumeTelemetry` envelopes: what the production writer persists. */
  validated: unknown[];
};

/**
 * Runs the production permission/input adapters over a hostile producer event
 * set, so the telemetry that reaches the WAL is adapter output rather than a
 * hand-written approximation. Each hostile field must be dropped by the
 * adapter before the envelope exists.
 */
function adapterEnvelopes(): LiveEnvelopes {
  const handlers = new Map<string, (data: unknown) => void>();
  const inputHandlers: Array<(event: { text: string }) => void> = [];
  const raw: unknown[] = [];
  const registration = registerLiveCounters(
    {
      events: {
        on: (channel: string, handler: (data: unknown) => void) => {
          handlers.set(channel, handler);
          return () => {};
        },
      },
      on: (_event: "input", handler: (event: { text: string }) => void) => {
        inputHandlers.push(handler);
        return () => {};
      },
    },
    {
      appendTelemetry: (envelope: unknown) => raw.push(envelope),
      flush: async () => {},
    },
    {
      sessionId: SESSION_ID,
      inventoryNames: () => new Set(["fixture-mode", "other-mode"]),
      now: () => new Date("2026-09-12T07:00:02.000Z"),
    },
  );
  const emit = (channel: string, data: unknown): void => {
    handlers.get(channel)?.(data);
  };
  // Hostile producer payloads: extra private fields must never be copied.
  emit("permissions:ready", {});
  emit("permissions:decision", {
    result: "allow",
    resolution: "policy_allow",
    requestId: RAW_PERMISSION_REQUEST_ID,
    value: "PRIVATE_BODY",
    matchedPattern: "PRIVATE_GUIDELINE",
    request: { prompt: "PRIVATE_BODY" },
    forwarding: "PRIVATE_TASK",
    agentName: "PRIVATE_TASK",
    origin: "PRIVATE_BODY",
  });
  inputHandlers[0]?.({ text: "/skill:fixture-mode PRIVATE_TASK PRIVATE_BODY" });
  emit("permissions:decision", {
    result: "deny",
    resolution: "user_denied",
    value: "PRIVATE_BODY",
  });
  inputHandlers[0]?.({ text: "/skill:other-mode /home/dev/private" });
  registration.dispose();

  const validated: unknown[] = [];
  for (const envelope of raw) {
    consumeTelemetry(envelope, {
      appendTelemetry: (value) => validated.push(value),
    });
  }
  return { raw, validated };
}

type BuiltFixture = {
  report: FixtureReport;
  reportText: string;
  walText: string;
  checkpointText: string;
  inventoryText: string;
  sessionText: string;
};

/**
 * Builds the whole fixture in a fresh temporary root and returns only the
 * artifact bytes plus the parsed report, so `JSON.stringify` of two builds is
 * comparable. The root is removed before returning; nothing in the returned
 * value depends on the temporary path or the wall clock.
 */
async function buildFixtureSession(): Promise<BuiltFixture> {
  const directory = await mkdtemp(join(tmpdir(), "inspector-evidence-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  try {
    const sessionDirectory = join(
      directory,
      "session-inspector",
      "v1",
      "sessions",
      SESSION_ID,
    );
    const sessionFile = join(directory, "session.jsonl");
    await mkdir(join(sessionDirectory, "wal", WAL_WRITER_ID), {
      recursive: true,
    });
    const sessionText = sessionSource();
    await writeFile(sessionFile, sessionText);

    // Telemetry: the first three records are the checkpoint's folded prefix, the
    // rest are the retained post-cursor suffix (invariants 29-31).
    const { raw, validated } = adapterEnvelopes();
    // The adapter's own output is already free of the hostile fields, and every
    // raw envelope passes telemetry validation (nothing is dropped silently).
    assert.equal(raw.length, validated.length);
    for (const sentinel of SEEDED_SENTINELS) {
      assert.equal(JSON.stringify(raw).includes(sentinel), false);
    }
    const envelopes = validated.map((envelope) => envelope as object);
    const boundarySubject = `live-tool-${canonicalOpaqueDigest(
      "live-tool",
      SESSION_ID,
      TOOL_CALL_ID,
    )}`;
    const records = [
      {
        eventId: "wal-event-1",
        timestamp: "2026-09-12T07:00:02.000Z",
        writerId: WAL_WRITER_ID,
        writerSequence: 1,
        kind: "telemetry",
        telemetry: envelopes[0],
      },
      {
        eventId: "wal-event-2",
        timestamp: "2026-09-12T07:00:03.000Z",
        writerId: WAL_WRITER_ID,
        writerSequence: 2,
        kind: "telemetry",
        telemetry: envelopes[1],
      },
      {
        eventId: "wal-event-3",
        timestamp: "2026-09-12T07:00:04.000Z",
        writerId: WAL_WRITER_ID,
        writerSequence: 3,
        kind: "telemetry",
        telemetry: envelopes[2],
      },
      {
        eventId: "wal-event-4",
        timestamp: "2026-09-12T07:00:05.000Z",
        writerId: WAL_WRITER_ID,
        writerSequence: 4,
        kind: "telemetry",
        telemetry: envelopes[3],
      },
      {
        eventId: "wal-event-5",
        timestamp: "2026-09-12T07:00:06.000Z",
        writerId: WAL_WRITER_ID,
        writerSequence: 5,
        kind: "telemetry",
        telemetry: envelopes[4],
      },
      {
        eventId: "wal-event-6",
        timestamp: "2026-09-12T07:00:07.000Z",
        writerId: WAL_WRITER_ID,
        writerSequence: 6,
        kind: "live_timing",
        timing: {
          category: "tool",
          status: "unknown",
          confidence: "live",
          subjectId: boundarySubject,
          startedAt: "2026-09-12T07:00:01.000Z",
          endedAt: "2026-09-12T07:00:06.000Z",
          durationMs: DURATION_MS,
        },
      },
    ];
    const walText = `${records
      .map((record) => JSON.stringify(record))
      .join("\n")}\n`;
    await writeFile(
      join(sessionDirectory, "wal", WAL_WRITER_ID, "2026-09-12.jsonl"),
      walText,
    );

    // Checkpoint: folded prefix = records 1-3, sealed at 3 with its exact
    // expiration boundary, plus the persisted inventory counts.
    const checkpoint = {
      schemaVersion: 1,
      cursors: {
        pi: { lineCount: 2, revision: "0".repeat(64) },
        wal: { [WAL_WRITER_ID]: 3 },
      },
      aggregates: {
        totalTokens: 0,
        totalCost: 0,
        generations: 0,
        tools: 0,
        compactions: 0,
        integrationCounters: { permission: { decisions: 1, allowed: 1 } },
        skillInvocations: { "fixture-mode": 1 },
        presence: { permission: true },
        resourceCounts: {
          commands: 2,
          skills: 1,
          resources: 1,
          toolSources: 1,
          observedAt: OBSERVED_AT,
        },
      },
      sealingVersion: 1,
      sealedWal: { [WAL_WRITER_ID]: 3 },
      evidence: {
        checkpointedAt: "2026-09-12T07:00:08.000Z",
        detailCoverage: { walDetailExpiredBefore: "2026-09-12T07:00:04.000Z" },
      },
    };
    const checkpointText = `${JSON.stringify(checkpoint)}\n`;
    await writeFile(join(sessionDirectory, "checkpoint.json"), checkpointText);

    // Inventory: written through the production sanitizer/writer from hostile
    // producer rows (paths, tool descriptions/parameters, prompt guidelines).
    const inventory = readInventory(
      [
        {
          name: "ponytail",
          source: "extension",
          description: "PRIVATE_BODY secret /home/dev/private",
          sourceInfo: {
            path: "/home/dev/private/ponytail.ts",
            source: "file:///home/dev/private",
            scope: "user",
            origin: "package",
          },
        },
        {
          name: "skill:fixture-mode",
          source: "skill",
          description: "PRIVATE_TASK /home/dev/private",
          sourceInfo: {
            path: "/home/dev/private/skills/fixture-mode.md",
            source: "npm:pi-fixture@1.0.0",
            scope: "user",
            origin: "package",
          },
        },
      ],
      [
        {
          name: "read",
          description: "PRIVATE_BODY",
          parameters: { body: "PRIVATE_BODY" },
          promptGuidelines: ["PRIVATE_GUIDELINE /home/dev/private"],
          sourceInfo: {
            path: "/home/dev/private/read.ts",
            source: "npm:pi-fixture@1.0.0",
            scope: "user",
            origin: "package",
          },
        },
      ],
    );
    assert.equal(
      await writeInventorySnapshot(sessionDirectory, {
        ...inventory,
        observedAt: OBSERVED_AT,
      }),
      true,
    );
    // Read the persisted artifacts *before* the read: the production refresh
    // advances the snapshot's own observation time, which is not an input.
    const inventoryText = await readFile(
      join(sessionDirectory, "inventory.json"),
      "utf8",
    );

    const handlerRef: { current?: CommandHandler } = {};
    registerSessionInspector({
      on: () => {},
      getCommands: () => [
        {
          name: "ponytail",
          source: "extension",
          description: "PRIVATE_BODY secret /home/dev/private",
          sourceInfo: {
            path: "/home/dev/private/ponytail.ts",
            source: "file:///home/dev/private",
            scope: "user",
            origin: "package",
          },
        },
        {
          name: "skill:fixture-mode",
          source: "skill",
          description: "PRIVATE_TASK /home/dev/private",
          sourceInfo: {
            path: "/home/dev/private/skills/fixture-mode.md",
            source: "npm:pi-fixture@1.0.0",
            scope: "user",
            origin: "package",
          },
        },
      ],
      getAllTools: () => [
        {
          name: "read",
          description: "PRIVATE_BODY",
          parameters: { body: "PRIVATE_BODY" },
          promptGuidelines: ["PRIVATE_GUIDELINE /home/dev/private"],
          sourceInfo: {
            path: "/home/dev/private/read.ts",
            source: "npm:pi-fixture@1.0.0",
            scope: "user",
            origin: "package",
          },
        },
      ],
      registerCommand: (name: string, command: { handler: CommandHandler }) => {
        if (name === "session-inspector") handlerRef.current = command.handler;
      },
    } as unknown as ExtensionAPI);
    assert.ok(handlerRef.current);

    const output = join(directory, "report.json");
    process.env.PI_CODING_AGENT_DIR = directory;
    try {
      await handlerRef.current(`json --output "${output}"`, {
        mode: "interactive",
        sessionManager: {
          getSessionId: () => SESSION_ID,
          getLeafId: () => "gen-2",
          getSessionFile: () => sessionFile,
          getSessionDir: () => directory,
        },
        ui: {
          notify: () => assert.fail("must export the current session report"),
          custom: async () => assert.fail("must export the current report"),
        },
      } as unknown as ExtensionCommandContext);
    } finally {
      if (previousAgentDir === undefined)
        delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    }
    const reportText = await readFile(output, "utf8");

    return {
      report: JSON.parse(reportText) as FixtureReport,
      reportText,
      walText,
      checkpointText,
      inventoryText,
      sessionText,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

type CommandHandler = (
  args: string,
  ctx: ExtensionCommandContext,
) => Promise<void>;

test("unchanged inputs produce byte-identical canonical JSON twice", async () => {
  const first = JSON.stringify(await buildFixtureSession());
  const second = JSON.stringify(await buildFixtureSession());

  assert.equal(first, second);
  // The fixture really is the milestone's shape: a folded prefix, a retained
  // suffix, a completed live boundary, and a checkpoint resource observation.
  const built = JSON.parse(first) as BuiltFixture;
  assert.equal(built.report.walDetail, "expired");
  assert.equal(
    built.report.retainedAggregates?.boundary.detail,
    "aggregate-only",
  );
  assert.equal(built.report.durationEvidence, "supported");
  assert.equal(built.report.tools[0]?.durationMs, DURATION_MS);
});

test("privacy scanner finds no prohibited key in any artifact", async () => {
  const fixture = await buildFixtureSession();

  // The seeded producer text is genuinely present in the inputs, otherwise the
  // absence assertions below would be vacuous.
  for (const sentinel of SEEDED_SENTINELS) {
    assert.equal(
      fixture.sessionText.includes(sentinel),
      true,
      `fixture must seed ${sentinel}`,
    );
  }
  assert.equal(fixture.inventoryText.includes("/home/dev/private"), false);

  for (const [label, artifact] of [
    ["wal", fixture.walText],
    ["checkpoint", fixture.checkpointText],
    ["inventory", fixture.inventoryText],
    ["report", fixture.reportText],
  ] as const) {
    assert.doesNotMatch(artifact, PROHIBITED_KEYS, `${label} leaked a key`);
    assert.equal(artifact.includes("/home/"), false, `${label} leaked a path`);
    for (const sentinel of SEEDED_SENTINELS) {
      assert.equal(
        artifact.includes(sentinel),
        false,
        `${label} leaked ${sentinel}`,
      );
    }
  }
});

test("raw producer identities never persist beside their opaque counterpart", async () => {
  const fixture = await buildFixtureSession();

  // The permission-request domain publishes only the domain-separated,
  // session-scoped digest; the raw producer identity is nowhere beside it.
  const opaqueRequestId = `permission-request-${canonicalOpaqueDigest(
    "permission-request",
    SESSION_ID,
    RAW_PERMISSION_REQUEST_ID,
  )}`;
  assert.match(opaqueRequestId, /^permission-request-[a-f0-9]{64}$/);
  assert.equal(fixture.walText.includes(opaqueRequestId), true);
  // The live-tool domain publishes its own opaque subject, never the raw call id.
  assert.match(fixture.walText, /live-tool-[a-f0-9]{64}/);
  assert.equal(
    opaqueRequestId.includes(
      `live-tool-${canonicalOpaqueDigest("live-tool", SESSION_ID, TOOL_CALL_ID)}`,
    ),
    false,
  );

  for (const [label, artifact] of [
    ["wal", fixture.walText],
    ["checkpoint", fixture.checkpointText],
    ["inventory", fixture.inventoryText],
    ["report", fixture.reportText],
  ] as const) {
    assert.equal(
      artifact.includes(RAW_PERMISSION_REQUEST_ID),
      false,
      `${label} carried the raw permission-request identity`,
    );
    assert.equal(
      artifact.includes(`"${TOOL_CALL_ID}"`),
      false,
      `${label} carried the raw tool-call identity beside its opaque subject`,
    );
  }
});

test("aggregate-only and unavailable never serialize as zero", async () => {
  const { report } = await buildFixtureSession();

  assert.equal(report.evidenceHealth.aggregates.detail, "aggregate-only");
  assert.notEqual(report.skills.invocationState, "unavailable");
  // The folded prefix (fixture-mode) and the retained suffix (other-mode) are
  // disjoint and each counted exactly once.
  assert.deepEqual(
    report.skills.items.map((row) => [row.name, row.explicitInvocations]),
    [
      ["fixture-mode", 1],
      ["other-mode", 1],
    ],
  );
  assert.equal(report.skills.invocationCount, 2);
  assert.equal(report.skills.otherInvocations, 0);
  // A retained aggregate survivor keeps its counts and its observation instant;
  // nothing invents a zero or a synthetic activity row.
  assert.equal(report.evidenceHealth.aggregates.resources, "supported");
  assert.deepEqual(report.retainedAggregates?.resources, {
    counts: { commands: 2, skills: 1, resources: 1, toolSources: 1 },
    state: "aggregate-only",
    observedAt: {
      state: "known",
      at: OBSERVED_AT,
      basis: "inventory-observer",
    },
  });
  assert.equal(report.evidenceHealth.aggregates.skillInvocations.names, 2);
  assert.equal(report.evidenceHealth.aggregates.skillInvocations.overflow, 0);
  assert.equal(
    report.evidenceHealth.aggregates.skillInvocations.retainedInvocations,
    2,
  );
});

test("an unknown-semantic node between known nodes keeps Active ancestry resolvable", async () => {
  const parsed = parseSessionJsonl(
    await readFile(
      new URL(
        "../fixtures/pi/0.85.1/unknown-entry-ancestry.jsonl",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  // The fixture is valid JSONL and understood as a supported v3 session.
  assert.equal(parsed.hasMalformedJson, false);
  assert.equal(parsed.id, "unknown-entry-ancestry-session");
  assert.equal(parsed.formatVersion, 3);
  assert.equal(parsed.unknownEntryCount, 1);

  const folded: FoldedAggregateEvidence[] = [];
  const active = buildCanonicalSession({
    parsed,
    scope: "active",
    leafId: "known-leaf",
    evidence: { atomic: [], folded },
  });
  assert.equal(active.state, "ready");
  const session = active.state === "ready" ? active.session : undefined;
  assert.ok(session);
  // The unknown node stays in the resolved ancestry (it is a real graph node)
  // and is skipped only when entries are mapped back for reduction.
  assert.deepEqual(session.scopedEntryIds, [
    "known-parent",
    "unknown-middle",
    "known-leaf",
  ]);
  assert.equal(session.markerEntryId, "marker");
  const byId = new Map(parsed.entries.map((entry) => [entry.id, entry]));
  const scoped = session.scopedEntryIds.flatMap((id) => {
    const entry = byId.get(id);
    return entry === undefined ? [] : [entry];
  });
  assert.equal(reduceEntries(parsed.id, scoped).usage.totalTokens, 42);
  // The unknown node keeps its node state and never emits a payload fact.
  assert.deepEqual(
    session.graph.nodes
      .filter((node) => node.entryId === "unknown-middle")
      .map((node) => node.semanticType),
    [{ state: "unknown" }],
  );
  assert.equal(
    JSON.stringify(session).includes("unknown semantic type"),
    false,
  );
  assert.equal(session.generations.length, 2);
});

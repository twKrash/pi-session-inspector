import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  type InspectorBundleInput,
  loadInspectorBundle,
} from "../../src/ui/bundle.ts";
import type { ParsedSession } from "../../src/pi/adapter.ts";
import type { LoadMetric } from "../../src/ui/load-instrumentation.ts";
import { loadCurrentSessionReport } from "../../src/ui/load-current.ts";
import { loadHistorySessionPage } from "../../src/ui/history-page.ts";
import {
  loadHistoryReports,
  replayDiscoveredHistorySession,
} from "../../src/ui/load-history.ts";
import { serializeUiSnapshot } from "../../src/ui/snapshot-revision.ts";
import { projectInspectorUi } from "../../src/ui/ui-projection.ts";

const maintenance = {
  writerId: "dedup-fixture",
  now: () => new Date("2026-01-03T00:00:00.000Z"),
  isPidAlive: () => false,
};

const SESSION_ID = "dedup-session";

/**
 * One tracked v3 session with two children of the marker, so the active entry
 * set is a strict subset of the tree set. `tokens` is the per-generation usage,
 * which makes a re-read visible in the report.
 */
function sessionBody(tokens: number): string {
  return `${[
    JSON.stringify({ type: "session", version: 3, id: SESSION_ID }),
    JSON.stringify({
      type: "custom",
      id: "marker",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      customType: "session-inspector:tracking-start",
      data: { schemaVersion: 1 },
    }),
    JSON.stringify(
      generation("trunk", "marker", "2026-01-01T00:00:01.000Z", tokens),
    ),
    JSON.stringify(
      generation("leaf", "marker", "2026-01-01T00:00:02.000Z", tokens),
    ),
  ].join("\n")}\n`;
}

function generation(
  id: string,
  parentId: string,
  timestamp: string,
  tokens: number,
): unknown {
  return {
    type: "message",
    id,
    parentId,
    timestamp,
    message: {
      role: "assistant",
      provider: "acme",
      model: "alpha",
      content: [{ type: "text", text: "synthetic fixture" }],
      usage: { totalTokens: tokens, cost: { total: 0.001 } },
    },
  };
}

type Fixture = {
  directory: string;
  sessionFile: string;
  root: string;
  sessionDirectory: string;
};

async function createFixture(): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), "pi-inspector-dedup-"));
  const sessionDirectory = join(directory, "pi-sessions");
  const root = join(directory, "inspector");
  await mkdir(sessionDirectory, { recursive: true });
  await mkdir(join(root, "sessions", SESSION_ID), { recursive: true });
  const sessionFile = join(sessionDirectory, `${SESSION_ID}.jsonl`);
  await writeFile(sessionFile, sessionBody(1), "utf8");
  await writeFile(
    join(root, "sessions", SESSION_ID, "meta.json"),
    `${JSON.stringify({
      schemaVersion: 2,
      sessionId: SESSION_ID,
      sourceFile: `${SESSION_ID}.jsonl`,
      state: "tracking",
    })}\n`,
    "utf8",
  );
  return { directory, sessionFile, root, sessionDirectory };
}

function bundleInput(fixture: Fixture): InspectorBundleInput {
  return {
    theme: "light",
    initialScope: "active",
    root: fixture.root,
    sessionDirectory: () => fixture.sessionDirectory,
    maintenance,
    current: { sessionFile: fixture.sessionFile, leafId: "leaf" },
  };
}

test("one shared current parse yields exactly the per-scope loader views and revision", async () => {
  const fixture = await createFixture();
  try {
    const input = bundleInput(fixture);
    const shared = await loadInspectorBundle(input);
    // The retained per-scope seam is the reference: two independent reads.
    const perScope = await loadInspectorBundle({
      ...input,
      loadCurrent: (scope) =>
        loadCurrentSessionReport(fixture.sessionFile, scope, {
          leafId: "leaf",
        }),
    });

    assert.deepEqual(shared.current, perScope.current);
    assert.equal(shared.current.active.report?.usage?.totalTokens, 1);
    assert.equal(shared.current.tree.report?.usage?.totalTokens, 2);

    const intent = { kind: "preset", preset: 7 } as const;
    const revision = (bundle: typeof shared) =>
      serializeUiSnapshot(
        projectInspectorUi({ bundle, intent, projectName: "dedup" }),
      );
    assert.deepEqual(revision(shared), revision(perScope));
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("a later load reads the source again, so an appended entry is never stale", async () => {
  const fixture = await createFixture();
  try {
    const first = await loadInspectorBundle(bundleInput(fixture));
    await appendFile(
      fixture.sessionFile,
      `${JSON.stringify(generation("later", "leaf", "2026-01-01T00:00:03.000Z", 5))}\n`,
      "utf8",
    );
    const second = await loadInspectorBundle(bundleInput(fixture));

    assert.equal(first.current.tree.report?.usage?.totalTokens, 2);
    assert.equal(second.current.tree.report?.usage?.totalTokens, 7);
    const intent = { kind: "preset", preset: 7 } as const;
    const etag = (bundle: typeof first) =>
      serializeUiSnapshot(
        projectInspectorUi({ bundle, intent, projectName: "dedup" }),
      ).etag;
    assert.notEqual(etag(first), etag(second));
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("a malformed history source still degrades after a valid earlier load", async () => {
  const fixture = await createFixture();
  try {
    const options = {
      root: fixture.root,
      sessionDirectory: () => fixture.sessionDirectory,
      scope: "tree" as const,
      maintenance,
    };
    const available = await loadHistoryReports(options);
    assert.equal(available.sessions[0]?.availability, "available");

    await appendFile(fixture.sessionFile, "{ malformed JSONL\n", "utf8");
    const degraded = await loadHistoryReports(options);
    assert.deepEqual(degraded.sessions, [
      {
        availability: "unavailable",
        sessionId: SESSION_ID,
        reason: "session-unreadable",
      },
    ]);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

/** Writes one tracked session plus its manifest; `malformed` appends a bad line. */
async function writeTrackedSession(
  fixture: Fixture,
  sessionId: string,
  timestamp: string,
  malformed = false,
): Promise<void> {
  const body = sessionBody(1)
    .replaceAll(SESSION_ID, sessionId)
    .replace("2026-01-01T00:00:01.000Z", timestamp);
  await writeFile(
    join(fixture.sessionDirectory, `${sessionId}.jsonl`),
    malformed ? `${body}{ malformed JSONL\n` : body,
    "utf8",
  );
  await mkdir(join(fixture.root, "sessions", sessionId), { recursive: true });
  await writeFile(
    join(fixture.root, "sessions", sessionId, "meta.json"),
    `${JSON.stringify({
      schemaVersion: 2,
      sessionId,
      sourceFile: `${sessionId}.jsonl`,
      state: "tracking",
    })}\n`,
    "utf8",
  );
}

test("a marked but malformed session sorts last in history-page ordering", async () => {
  const fixture = await createFixture();
  try {
    await writeTrackedSession(
      fixture,
      "dedup-later",
      "2026-02-01T00:00:01.000Z",
      true,
    );
    const page = await loadHistorySessionPage(
      {
        root: fixture.root,
        sessionDirectory: () => fixture.sessionDirectory,
        maintenance,
      },
      undefined,
    );
    // Released behavior: a malformed source gets no parse, so it has no sortAt
    // and sorts after every readable session despite its newer timestamp.
    assert.deepEqual(
      page.sessions.map((session) => [session.sessionId, session.availability]),
      [
        [SESSION_ID, "available"],
        ["dedup-later", "unavailable"],
      ],
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

function countReads(): { metrics: LoadMetric[]; reads: () => number } {
  const metrics: LoadMetric[] = [];
  return {
    metrics,
    reads: () =>
      metrics.filter((metric) => metric.stage === "history-jsonl-read").length,
  };
}

test("a valid reused parse costs one read per history source", async () => {
  const fixture = await createFixture();
  try {
    const counter = countReads();
    const report = await loadHistoryReports({
      root: fixture.root,
      sessionDirectory: () => fixture.sessionDirectory,
      scope: "tree",
      maintenance,
      instrumentation: (metric) => counter.metrics.push(metric),
    });
    assert.equal(report.sessions[0]?.availability, "available");
    assert.equal(counter.reads(), 1);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("replay reads again, and measures it, only when the parse is rejected", async () => {
  const fixture = await createFixture();
  try {
    const { parseSessionJsonl } = await import("../../src/pi/adapter.ts");
    const discovered = {
      sessionId: SESSION_ID,
      availability: "available" as const,
      sourceFile: `${SESSION_ID}.jsonl`,
    };
    const replayWith = async (prevalidated: ParsedSession | undefined) => {
      const counter = countReads();
      const replay = await replayDiscoveredHistorySession(
        {
          root: fixture.root,
          sessionDirectory: () => fixture.sessionDirectory,
          maintenance,
          instrumentation: (metric) => counter.metrics.push(metric),
        },
        discovered,
        prevalidated,
      );
      return { replay, reads: counter.reads() };
    };
    const body = sessionBody(1);
    const accepted = await replayWith(parseSessionJsonl(body));
    assert.equal(accepted.replay.availability, "available");
    assert.equal(accepted.reads, 0);

    const unmarked = body.replace(
      "session-inspector:tracking-start",
      "some-other-custom-type",
    );
    const rejected = await replayWith(parseSessionJsonl(unmarked));
    assert.equal(rejected.replay.availability, "available");
    assert.equal(rejected.reads, 1);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("a failed current read leaves both views equally unavailable", async () => {
  const fixture = await createFixture();
  try {
    await rm(fixture.sessionFile, { force: true });
    const bundle = await loadInspectorBundle(bundleInput(fixture));
    assert.equal(bundle.current.active.availability, "unavailable");
    assert.equal(bundle.current.tree.availability, "unavailable");
    assert.equal(bundle.current.active.diagnostic, "current-unavailable");
    assert.equal(bundle.current.tree.diagnostic, "current-unavailable");
    // One read outcome: the views cannot disagree about availability.
    assert.equal(bundle.current.sameReportProjection, true);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("only the read is shared: one scope can fail while the other builds", async () => {
  const fixture = await createFixture();
  try {
    const bundle = await loadInspectorBundle({
      ...bundleInput(fixture),
      current: { sessionFile: fixture.sessionFile, leafId: "missing-leaf" },
    });
    assert.equal(bundle.current.active.availability, "unavailable");
    assert.equal(bundle.current.tree.availability, "available");
    assert.equal(bundle.current.tree.report?.usage?.totalTokens, 2);
    assert.equal(bundle.current.sameReportProjection, false);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("an unmarked reused parse is rejected instead of replayed", async () => {
  const fixture = await createFixture();
  try {
    const unmarked = sessionBody(1).replace(
      "session-inspector:tracking-start",
      "some-other-custom-type",
    );
    await writeFile(fixture.sessionFile, unmarked, "utf8");
    const discovered = {
      sessionId: SESSION_ID,
      availability: "available" as const,
      sourceFile: `${SESSION_ID}.jsonl`,
    };
    Object.defineProperty(discovered, "sourceFile", {
      value: `${SESSION_ID}.jsonl`,
    });
    const replay = await replayDiscoveredHistorySession(
      {
        root: fixture.root,
        sessionDirectory: () => fixture.sessionDirectory,
        maintenance,
      },
      discovered,
      // An unmarked parse must not be trusted just because it parses.
      (await import("../../src/pi/adapter.ts")).parseSessionJsonl(unmarked),
    );
    assert.deepEqual(replay, {
      availability: "unavailable",
      sessionId: SESSION_ID,
      reason: "marker-unavailable",
    });
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

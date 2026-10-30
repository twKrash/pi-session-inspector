import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadCurrentSessionReport } from "../../src/ui/load-current.ts";
import { loadCurrentView, loadInspectorBundle } from "../../src/ui/bundle.ts";
import { loadHistoryAndGlobalReports } from "../../src/ui/load-history.ts";
import {
  emitLoadMetric,
  type LoadInstrumentation,
} from "../../src/ui/load-instrumentation.ts";

test("load instrumentation emits bounded numeric stage metrics and swallows observer errors", () => {
  const events: unknown[] = [];
  const observer: LoadInstrumentation = (event) => {
    events.push(event);
  };
  emitLoadMetric(observer, "current-jsonl-read", 3, 42);
  assert.deepEqual(events, [
    { stage: "current-jsonl-read", durationMs: 3, bytes: 42 },
  ]);
  assert.doesNotThrow(() =>
    emitLoadMetric(
      () => {
        throw new Error("private path");
      },
      "current-jsonl-read",
      1,
      0,
    ),
  );
});

test("absent instrumentation is a no-op", () => {
  assert.doesNotThrow(() => emitLoadMetric(undefined, "current-jsonl-read", 0));
});

test("current report loading emits sanitized stage metrics without changing its result", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-inspector-load-metric-"));
  const sessionFile = join(directory, "session.jsonl");
  await writeFile(
    sessionFile,
    [
      JSON.stringify({ type: "session", version: 3, id: "metric-session" }),
      JSON.stringify({
        type: "custom",
        id: "marker",
        parentId: null,
        timestamp: "2026-01-01T00:00:00.000Z",
        customType: "session-inspector:tracking-start",
        data: { schemaVersion: 1 },
      }),
      JSON.stringify({
        type: "message",
        id: "generation",
        parentId: "marker",
        timestamp: "2026-01-01T00:00:01.000Z",
        message: {
          role: "assistant",
          provider: "acme",
          model: "alpha",
          content: [{ type: "text", text: "synthetic fixture" }],
          usage: { totalTokens: 1, cost: { total: 0.01 } },
        },
      }),
      JSON.stringify({
        type: "message",
        id: "alternate",
        parentId: "marker",
        timestamp: "2026-01-01T00:00:02.000Z",
        message: {
          role: "assistant",
          provider: "acme",
          model: "alpha",
          content: [{ type: "text", text: "synthetic alternate" }],
          usage: { totalTokens: 2, cost: { total: 0.02 } },
        },
      }),
    ].join("\n") + "\n",
  );
  try {
    const events: { stage: string; durationMs: number; bytes?: number }[] = [];
    const options = {
      leafId: null,
      evidence: { atomic: [], folded: [] },
      instrumentation: (event: {
        stage: string;
        durationMs: number;
        bytes?: number;
      }) => events.push(event),
    } as unknown as Parameters<typeof loadCurrentSessionReport>[2];
    const measured = await loadCurrentSessionReport(
      sessionFile,
      "tree",
      options,
    );
    const unmeasured = await loadCurrentSessionReport(sessionFile, "tree", {
      leafId: null,
      evidence: { atomic: [], folded: [] },
    });

    assert.ok(measured);
    assert.deepEqual(measured, unmeasured);
    const bundleEvents: {
      stage: string;
      durationMs: number;
      bytes?: number;
    }[] = [];
    const bundle = await loadInspectorBundle({
      theme: "light",
      initialScope: "tree",
      root: directory,
      sessionDirectory: () => directory,
      maintenance: {
        writerId: "m0-bundle-metrics",
        now: () => new Date("2026-01-02T00:00:00.000Z"),
        isPidAlive: () => false,
      },
      current: { sessionFile, leafId: "alternate" },
      currentEvidence: { evidence: { atomic: [], folded: [] } },
      instrumentation: (event: {
        stage: string;
        durationMs: number;
        bytes?: number;
      }) => bundleEvents.push(event),
    } as unknown as Parameters<typeof loadInspectorBundle>[0]);
    assert.equal(bundle.current.tree.availability, "available");
    const expectedOptions = {
      leafId: "alternate",
      evidence: { atomic: [], folded: [] },
    } as unknown as Parameters<typeof loadCurrentSessionReport>[2];
    const expectedActive = await loadCurrentSessionReport(
      sessionFile,
      "active",
      expectedOptions,
    );
    const expectedTree = await loadCurrentSessionReport(
      sessionFile,
      "tree",
      expectedOptions,
    );
    assert.deepEqual(
      bundle.current.active,
      await loadCurrentView(async () => expectedActive, "active"),
    );
    assert.deepEqual(
      bundle.current.tree,
      await loadCurrentView(async () => expectedTree, "tree"),
    );
    assert.equal(bundle.current.active.report?.usage?.totalTokens, 2);
    assert.equal(bundle.current.tree.report?.usage?.totalTokens, 3);
    assert.equal(
      bundleEvents.filter((event) => event.stage === "current-jsonl-read")
        .length,
      1,
    );
    assert.equal(
      bundleEvents.filter((event) => event.stage === "current-jsonl-parse")
        .length,
      1,
    );
    assert.equal(
      bundleEvents.filter((event) => event.stage === "current-report-build")
        .length,
      2,
    );
    assert.deepEqual(
      events.map((event) => (event as { stage: string }).stage),
      ["current-jsonl-read", "current-jsonl-parse", "current-report-build"],
    );
    for (const [index, event] of events.entries()) {
      const keys = Object.keys(event as object).sort();
      assert.deepEqual(
        keys,
        index === 0
          ? ["bytes", "durationMs", "stage"]
          : ["durationMs", "stage"],
      );
      const metric = event as { durationMs: number; bytes?: number };
      assert.ok(Number.isFinite(metric.durationMs) && metric.durationMs >= 0);
      if (metric.bytes !== undefined) assert.ok(metric.bytes >= 0);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("history report loading measures validation, replay, evidence, and aggregation stages", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "pi-inspector-history-metric-"),
  );
  const root = join(directory, "inspector");
  const sessionDirectory = join(directory, "pi-sessions");
  const sessionId = "history-metrics";
  await mkdir(sessionDirectory, { recursive: true });
  await writeFile(
    join(sessionDirectory, `${sessionId}.jsonl`),
    [
      JSON.stringify({ type: "session", version: 3, id: sessionId }),
      JSON.stringify({
        type: "custom",
        id: "marker",
        parentId: null,
        timestamp: "2026-01-01T00:00:00.000Z",
        customType: "session-inspector:tracking-start",
        data: { schemaVersion: 1 },
      }),
      JSON.stringify({
        type: "message",
        id: "generation",
        parentId: "marker",
        timestamp: "2026-01-01T00:00:01.000Z",
        message: {
          role: "assistant",
          provider: "acme",
          model: "alpha",
          content: [{ type: "text", text: "synthetic fixture" }],
          usage: { totalTokens: 1, cost: { total: 0.01 } },
        },
      }),
      JSON.stringify({
        type: "message",
        id: "alternate",
        parentId: "marker",
        timestamp: "2026-01-01T00:00:02.000Z",
        message: {
          role: "assistant",
          provider: "acme",
          model: "alpha",
          content: [{ type: "text", text: "synthetic alternate" }],
          usage: { totalTokens: 2, cost: { total: 0.02 } },
        },
      }),
    ].join("\n") + "\n",
  );
  const manifestDirectory = join(root, "sessions", sessionId);
  await mkdir(manifestDirectory, { recursive: true });
  await writeFile(
    join(manifestDirectory, "meta.json"),
    `${JSON.stringify({
      schemaVersion: 2,
      sessionId,
      sourceFile: `${sessionId}.jsonl`,
      state: "tracking",
    })}\n`,
  );

  try {
    const events: { stage: string; durationMs: number; bytes?: number }[] = [];
    const reports = loadHistoryAndGlobalReports({
      root,
      sessionDirectory: () => sessionDirectory,
      scope: "tree",
      maintenance: {
        writerId: "m0-metrics",
        now: () => new Date("2026-01-02T00:00:00.000Z"),
        isPidAlive: () => false,
      },
      sessionEvidence: async () => ({ evidence: { atomic: [], folded: [] } }),
      instrumentation: (event: {
        stage: string;
        durationMs: number;
        bytes?: number;
      }) => events.push(event),
    } as unknown as Parameters<typeof loadHistoryAndGlobalReports>[0]);
    const [history, global] = await Promise.all([
      reports.history,
      reports.global,
    ]);

    assert.equal(history.sessions.length, 1);
    assert.equal(global.availability, "available");
    const counts = new Map<string, number>();
    for (const event of events) {
      counts.set(event.stage, (counts.get(event.stage) ?? 0) + 1);
      assert.ok(Number.isFinite(event.durationMs) && event.durationMs >= 0);
      assert.ok(event.bytes === undefined || event.bytes >= 0);
      assert.ok(
        Object.keys(event).every((key) =>
          ["stage", "durationMs", "bytes"].includes(key),
        ),
      );
    }
    assert.equal(counts.get("history-discovery"), 1);
    assert.equal(counts.get("history-jsonl-read"), 1);
    assert.equal(counts.get("history-jsonl-parse"), 1);
    assert.equal(counts.get("history-replay"), 1);
    assert.equal(counts.get("history-evidence-provider"), 1);
    assert.equal(counts.get("history-aggregation"), 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

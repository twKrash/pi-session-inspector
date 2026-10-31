import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { loadInspectorBundle, type InspectorBundle } from "../src/ui/bundle.ts";
import {
  diffUiSnapshot,
  serializeUiSnapshot,
} from "../src/ui/snapshot-revision.ts";
import {
  projectInspectorUi,
  type InspectorUiSnapshot,
} from "../src/ui/ui-projection.ts";
import type { RangeIntent } from "../src/ui/range.ts";
import type { LoadMetric, LoadStage } from "../src/ui/load-instrumentation.ts";
import {
  CORPUS_SEED,
  CORPUS_VERSION,
  entryId,
  writeLiveUiCorpus,
} from "./corpus.ts";
import { writeBenchmarkOutput, summarize } from "./output.ts";

const BASELINE_COMMIT_PREFIX = "c344c8d5121034b544514211265abe3a5358e1ee";
const RANGE_GROUPS: readonly RangeIntent[] = [
  { kind: "preset", preset: 7 },
  { kind: "preset", preset: 14 },
  { kind: "preset", preset: 30 },
];

type Distribution = {
  min: number;
  max: number;
  p50: number;
  p95: number;
  stdev: number;
};

type RefreshResult = {
  requestMs: number;
  loadMs: number;
  projectionMs: number;
  serializationMs: number;
  diffMs: number;
  dtoBytes: number;
  snapshot: InspectorUiSnapshot;
  events: LoadMetric[];
};

type ScenarioResult = {
  name: string;
  samples: number;
  concurrentRangeGroups: number;
  requestWallMs: Distribution;
  refreshGroupWallMs: Distribution;
  loadMs: Distribution;
  projectionMs: Distribution;
  serializationMs: Distribution;
  diffMs: Distribution;
  dtoBytes: Distribution;
  jsonlReadCountPerRequest: number;
  jsonlReadBytesPerRequest: number;
  parseCountPerRequest: number;
  replayCountPerRequest: number;
  stageTimingsMs: Partial<Record<LoadStage, Distribution>>;
};

function parseArgument(prefix: string): string | undefined {
  return process.argv
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
}

function createInput(
  corpus: Awaited<ReturnType<typeof writeLiveUiCorpus>>,
  sessionFile: string,
  instrumentation: (metric: LoadMetric) => void,
) {
  return {
    theme: "light" as const,
    initialScope: "active" as const,
    root: corpus.root,
    sessionDirectory: () => corpus.sessionDirectory,
    maintenance: {
      writerId: "live-ui-benchmark",
      now: () => new Date("2026-01-03T00:00:00.000Z"),
      isPidAlive: () => false,
    },
    current: { sessionFile, leafId: null },
    currentEvidence: { evidence: { atomic: [], folded: [] } },
    historyEvidence: async () => ({ evidence: { atomic: [], folded: [] } }),
    instrumentation,
  };
}

function distribution(samples: readonly number[]): Distribution {
  const summary = summarize([...samples]);
  return {
    min: summary.min,
    max: summary.max,
    p50: summary.median,
    p95: summary.p95,
    stdev: summary.stdev,
  };
}

async function runRefresh(
  input: ReturnType<typeof createInput>,
  intent: RangeIntent,
  previous?: InspectorUiSnapshot,
): Promise<RefreshResult> {
  const events: LoadMetric[] = [];
  const started = performance.now();
  const bundle = await loadInspectorBundle({
    ...input,
    instrumentation: (event) => events.push(event),
  });
  const loadMs = performance.now() - started;

  const projectionStarted = performance.now();
  const snapshot = projectInspectorUi({
    bundle,
    intent,
    projectName: "synthetic benchmark",
  });
  const projectionMs = performance.now() - projectionStarted;

  const serializationStarted = performance.now();
  const serialized = serializeUiSnapshot(snapshot);
  const serializationMs = performance.now() - serializationStarted;

  const diffStarted = performance.now();
  diffUiSnapshot(previous ?? snapshot, snapshot);
  const diffMs = performance.now() - diffStarted;

  return {
    requestMs: performance.now() - started,
    loadMs,
    projectionMs,
    serializationMs,
    diffMs,
    dtoBytes: Buffer.byteLength(serialized.body, "utf8"),
    snapshot,
    events,
  };
}

function scenarioResult(
  name: string,
  requestGroups: readonly (readonly RefreshResult[])[],
  refreshGroupWallMs?: readonly number[],
): ScenarioResult {
  const requests = requestGroups.flat();
  const eventGroups = new Map<LoadStage, number[]>();
  for (const request of requests) {
    for (const event of request.events) {
      const durations = eventGroups.get(event.stage) ?? [];
      durations.push(event.durationMs);
      eventGroups.set(event.stage, durations);
    }
  }
  const count = (stage: (stage: LoadStage) => boolean) =>
    requests.reduce(
      (total, request) =>
        total + request.events.filter((event) => stage(event.stage)).length,
      0,
    );
  const readCount = count((stage) => stage.endsWith("jsonl-read"));
  const parseCount = count((stage) => stage.endsWith("jsonl-parse"));
  const replayCount = count((stage) => stage === "history-replay");
  const readBytes = requests.reduce(
    (total, request) =>
      total +
      request.events.reduce(
        (sum, event) =>
          sum + (event.stage.endsWith("jsonl-read") ? (event.bytes ?? 0) : 0),
        0,
      ),
    0,
  );
  const requestCount = Math.max(1, requests.length);

  return {
    name,
    samples: requestGroups.length,
    concurrentRangeGroups: requestGroups[0]?.length ?? 1,
    requestWallMs: distribution(requests.map((request) => request.requestMs)),
    refreshGroupWallMs: distribution(
      refreshGroupWallMs ??
        requestGroups.map((group) => group[0]?.requestMs ?? 0),
    ),
    loadMs: distribution(requests.map((request) => request.loadMs)),
    projectionMs: distribution(requests.map((request) => request.projectionMs)),
    serializationMs: distribution(
      requests.map((request) => request.serializationMs),
    ),
    diffMs: distribution(requests.map((request) => request.diffMs)),
    dtoBytes: distribution(requests.map((request) => request.dtoBytes)),
    jsonlReadCountPerRequest: readCount / requestCount,
    jsonlReadBytesPerRequest: readBytes / requestCount,
    parseCountPerRequest: parseCount / requestCount,
    replayCountPerRequest: replayCount / requestCount,
    stageTimingsMs: Object.fromEntries(
      [...eventGroups.entries()].map(([stage, durations]) => [
        stage,
        distribution(durations),
      ]),
    ),
  };
}

function appendRecord(
  sessionId: string,
  index: number,
  parentId: string,
): string {
  const appendedId = `append-${sessionId}-${String(index).padStart(3, "0")}`;
  return `${JSON.stringify({
    type: "message",
    id: appendedId,
    parentId,
    timestamp: `2026-01-01T00:01:${String(index).padStart(2, "0")}.000Z`,
    message: {
      role: "assistant",
      provider: "acme",
      model: "alpha",
      content: [{ type: "text", text: "synthetic append" }],
      usage: { totalTokens: 2, cost: { total: 0.002 } },
    },
  })}\n`;
}

async function measureRetainedMemory(
  input: ReturnType<typeof createInput>,
  intent: RangeIntent,
): Promise<{ heapDeltaBytes: number; peakRssBytes: number }> {
  global.gc?.();
  const before = process.memoryUsage().heapUsed;
  const bundle: InspectorBundle = await loadInspectorBundle(input);
  global.gc?.();
  const heapDeltaBytes = process.memoryUsage().heapUsed - before;
  const peakRssBytes =
    process.resourceUsage().maxRSS * (process.platform === "darwin" ? 1 : 1024);
  projectInspectorUi({ bundle, intent, projectName: "synthetic benchmark" });
  return { heapDeltaBytes, peakRssBytes };
}

async function main(): Promise<void> {
  const mode = process.argv.includes("--mode=release") ? "release" : "smoke";
  // An artifact names the milestone it measured; there is no safe default.
  const milestone = parseArgument("--milestone=");
  if (milestone === undefined || milestone.length === 0) {
    throw new Error(
      "pass --milestone=<id> so the artifact names what it measured",
    );
  }
  const sampleCount = mode === "release" ? 10 : 2;
  const output = parseArgument("--out=");
  const baselineCommit =
    parseArgument("--baseline-commit=") ?? BASELINE_COMMIT_PREFIX;
  const headCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  // An uncommitted working tree is part of what produced a measurement.
  const workingTree =
    execFileSync("git", ["status", "--porcelain"], {
      encoding: "utf8",
    }).trim().length > 0
      ? "uncommitted"
      : "clean";
  const implementationCommit = `${headCommit} (${workingTree})`;
  const directory = await mkdtemp(join(tmpdir(), "pi-live-ui-benchmark-"));
  try {
    const corpus = await writeLiveUiCorpus({
      directory,
      sessions: 100,
      records: 40,
      seed: CORPUS_SEED,
    });
    const recordsPerSession = corpus.records / corpus.sessions.length;
    const lastEntryId = entryId(recordsPerSession);
    const firstSession = corpus.sessions[0];
    if (firstSession === undefined)
      throw new Error("benchmark corpus is empty");
    const noMetrics = (_metric: LoadMetric): void => {};
    const input = createInput(corpus, firstSession.path, noMetrics);
    const memory = await measureRetainedMemory(
      input,
      RANGE_GROUPS[2] as RangeIntent,
    );

    const warmGroups: RefreshResult[][] = [];
    let previous: InspectorUiSnapshot | undefined;
    for (let index = 0; index < sampleCount; index += 1) {
      const result = await runRefresh(
        input,
        RANGE_GROUPS[2] as RangeIntent,
        previous,
      );
      previous = result.snapshot;
      warmGroups.push([result]);
    }
    const warm = scenarioResult("warm-full-load", warmGroups);

    await appendFile(
      firstSession.path,
      appendRecord(firstSession.sessionId, 1, lastEntryId),
      "utf8",
    );
    const singleGroups: RefreshResult[][] = [];
    for (let index = 0; index < sampleCount; index += 1) {
      const result = await runRefresh(
        input,
        RANGE_GROUPS[2] as RangeIntent,
        previous,
      );
      previous = result.snapshot;
      singleGroups.push([result]);
    }
    const singleAppend = scenarioResult("one-session-append", singleGroups);

    const secondSession = corpus.sessions[49];
    const thirdSession = corpus.sessions[99];
    if (secondSession === undefined || thirdSession === undefined)
      throw new Error("benchmark corpus is missing update targets");
    await appendFile(
      secondSession.path,
      appendRecord(secondSession.sessionId, 2, lastEntryId),
      "utf8",
    );
    await appendFile(
      thirdSession.path,
      appendRecord(thirdSession.sessionId, 3, lastEntryId),
      "utf8",
    );
    const multiGroups: RefreshResult[][] = [];
    for (let index = 0; index < sampleCount; index += 1) {
      const result = await runRefresh(
        input,
        RANGE_GROUPS[2] as RangeIntent,
        previous,
      );
      previous = result.snapshot;
      multiGroups.push([result]);
    }
    const multiAppend = scenarioResult("multiple-session-updates", multiGroups);

    const rangeBaselines = new Map<string, InspectorUiSnapshot>();
    for (const intent of RANGE_GROUPS) {
      const result = await runRefresh(input, intent);
      rangeBaselines.set(JSON.stringify(intent), result.snapshot);
    }
    const rangeGroups: RefreshResult[][] = [];
    const rangeGroupWallMs: number[] = [];
    for (let index = 0; index < sampleCount; index += 1) {
      const groupStarted = performance.now();
      rangeGroups.push(
        await Promise.all(
          RANGE_GROUPS.map((intent) =>
            runRefresh(
              input,
              intent,
              rangeBaselines.get(JSON.stringify(intent)),
            ),
          ),
        ),
      );
      rangeGroupWallMs.push(performance.now() - groupStarted);
    }
    const multiRange = scenarioResult(
      "three-concurrent-range-groups",
      rangeGroups,
      rangeGroupWallMs,
    );

    // Request-local deduplication: one current read plus one per history
    // session, and one history replay per session. Pass --expected-reads to
    // measure a revision with a different expectation (M0 was 202).
    const expectedReadsPerRequest = Number(
      parseArgument("--expected-reads=") ?? 101,
    );
    if (!Number.isSafeInteger(expectedReadsPerRequest)) {
      throw new Error("--expected-reads must be a non-negative safe integer");
    }
    const expectedReplaysPerRequest = 100;
    for (const scenario of [warm, singleAppend, multiAppend, multiRange]) {
      if (
        scenario.jsonlReadCountPerRequest !== expectedReadsPerRequest ||
        scenario.parseCountPerRequest !== expectedReadsPerRequest ||
        scenario.replayCountPerRequest !== expectedReplaysPerRequest
      ) {
        throw new Error(
          `Unexpected instrumented baseline counts in ${scenario.name}`,
        );
      }
    }

    const results = {
      benchmark: `live-ui-incremental-${milestone}`,
      corpusVersion: CORPUS_VERSION,
      seed: CORPUS_SEED,
      mode,
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      baselineCommit,
      implementationCommit,
      corpus: {
        sessions: corpus.sessions.length,
        recordsPerSession,
        totalRecords: corpus.records,
        jsonlBytes: corpus.bytes,
      },
      memory,
      scenarios: [warm, singleAppend, multiAppend, multiRange],
      deliveryBoundary: {
        measured: "snapshot DTO JSON bytes and revision diff time",
        notMeasured:
          "WebSocket serialization, queue-bound check, socket.send, network delivery",
        implementationBoundary:
          "src/ui/live-channel.ts sendMessage: JSON.stringify, bufferedAmount + payload byte bound, then ws.send",
        // Stage timings nest, so they must not be summed across stages.
        stageNesting:
          "history-discovery encloses history-jsonl-read and history-jsonl-parse; current-report-build encloses each per-scope build",
        memoryMeasurement:
          "heapDeltaBytes is retained heap after a post-load gc, and peakRssBytes is the process-lifetime max: neither isolates the load peak",
      },
      expectedCountsPerRequest: {
        jsonlReads: expectedReadsPerRequest,
        parses: expectedReadsPerRequest,
        historyReplays: expectedReplaysPerRequest,
      },
    };
    console.log(JSON.stringify(results, null, 2));
    if (output !== undefined) await writeBenchmarkOutput(output, results);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

await main();

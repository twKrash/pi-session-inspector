import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { gzipSync } from "node:zlib";

import { projectInspectorUi } from "../src/ui/ui-projection.ts";
import { WEB_ASSETS } from "../src/ui/web-assets.ts";
import {
  createDailyChart,
  applyChartTheme,
  chartTheme,
} from "../scripts/web/chart.ts";
import { createWebClient } from "../tests/helpers/client-harness.ts";
import {
  createChartCanvas,
  installChartEnvironment,
} from "../tests/helpers/chart-harness.ts";
import { summarize, writeBenchmarkOutput, type Samples } from "./output.ts";

/**
 * Interactive browser-asset benchmark.
 *
 * It measures the shipped classic asset the server serves, executed in the same
 * stub-DOM harness the browser tests use, plus the chart adapter on a canvas
 * stub. The point is a maintained, reproducible number for the browser surface:
 * bundle evaluation, first render (startup), refresh, and chart create/update —
 * the four costs a bundled chart library adds.
 *
 *   npm run benchmark:browser          # smoke
 *   npm run benchmark:browser:release  # release mode, writes an artifact
 *   npm run benchmark:browser:check    # compare against the accepted baseline
 *
 * The accepted baseline lives in `benchmark/baselines/browser.json` and is
 * identified by the shipped asset's SHA-256 (the bundle is deterministic, so the
 * hash names exactly the bytes that were measured). Regenerate it only when a
 * retune is accepted, with `--write-baseline`.
 */

// The adapter needs the DOM globals before it constructs a chart; the stub is
// the same one the chart tests use.
installChartEnvironment();

const FIXTURE = "tests/fixtures/bundles/inspector-bundle.json";
const BASELINE = "benchmark/baselines/browser.json";
const TOKEN = "opaque-benchmark-token";

type Metric =
  | "evaluateMs"
  | "startupMs"
  | "refreshMs"
  | "chartCreateMs"
  | "chartUpdateMs";

type Measurement = {
  metrics: Record<Metric, Samples>;
  assetBytes: number;
  assetGzipBytes: number;
  assetSha256: string;
  chartPoints: number;
  behavior: {
    fetchCount: number;
    authorizationValid: boolean;
    tokenLeakedToUrl: boolean;
    tokenLeakedToStorage: boolean;
    storageWrites: number;
    initialRenders: number;
    renderedCanvas: boolean;
  };
};

type BaselineFile = {
  baselineVersion: 1;
  recordedAt: string;
  node: string;
  /** Wall-time medians may drift on shared hardware; sizes may not drift at all. */
  toleranceFactor: number;
  assetBytes: number;
  assetGzipBytes: number;
  assetSha256: string;
  metrics: Record<Metric, Samples>;
};

function readJson<T>(path: string): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    throw new Error(`benchmark input is unreadable: ${path}`);
  }
}

function fixture() {
  return projectInspectorUi({ bundle: readJson(FIXTURE) });
}

/** The daily rows a chart draws, projected exactly as the API returns them. */
function chartInput() {
  const rows = fixture().global.daily;
  return {
    ariaLabel: "benchmark daily cost",
    format: (kind: string, value: number) =>
      kind === "cost" ? `$${value.toFixed(2)}` : String(Math.round(value)),
    labels: rows.map((row) => row.date),
    series: [
      {
        axis: "y" as const,
        format: "cost",
        key: "cost",
        label: "Cost",
        values: rows.map((row) => row.cost ?? null),
      },
    ],
    theme: chartTheme(false),
  };
}

async function sample(): Promise<
  Measurement & { timings: Record<Metric, number> }
> {
  const snapshot = fixture();
  // The shipped asset, exactly the bytes the server serves.
  const asset = WEB_ASSETS.client;
  const sha256 = createHash("sha256").update(asset).digest("hex");

  // The shipped client: evaluation, first render, then one refresh.
  const evaluateStart = performance.now();
  const client = createWebClient({
    hash: `#token=${TOKEN}`,
    responses: [snapshot],
  });
  const evaluated = performance.now();
  await client.start();
  const started = performance.now();
  client.hashchange();
  const refreshed = performance.now();

  // The chart adapter alone, on a canvas of the same size the layout gives it.
  const canvas = createChartCanvas();
  const input = chartInput();
  const chartStart = performance.now();
  const chart = createDailyChart(canvas, input);
  const chartCreated = performance.now();
  applyChartTheme(chart, chartTheme(true));
  const chartUpdated = performance.now();
  chart.destroy();

  const fetches = client.fetches();
  const rendered = client.element("view").querySelectorAll("canvas").length > 0;
  return {
    assetBytes: Buffer.byteLength(asset),
    assetGzipBytes: gzipSync(asset, { level: 9 }).length,
    assetSha256: sha256,
    behavior: {
      authorizationValid: fetches[0]?.authorization === `Bearer ${TOKEN}`,
      fetchCount: fetches.length,
      initialRenders: 1,
      renderedCanvas: rendered,
      storageWrites: client.storageWrites().length,
      tokenLeakedToStorage: client
        .storageWrites()
        .some(({ key }) => key.includes(TOKEN)),
      tokenLeakedToUrl: fetches.some(({ url }) => url.includes(TOKEN)),
    },
    chartPoints: chart.data.datasets[0]?.data.length ?? 0,
    metrics: {
      chartCreateMs: summarize([]),
      chartUpdateMs: summarize([]),
      evaluateMs: summarize([]),
      refreshMs: summarize([]),
      startupMs: summarize([]),
    },
    timings: {
      chartCreateMs: chartCreated - chartStart,
      chartUpdateMs: chartUpdated - chartCreated,
      evaluateMs: evaluated - evaluateStart,
      refreshMs: refreshed - started,
      startupMs: started - evaluateStart,
    },
  };
}

async function measure(mode: "release" | "smoke"): Promise<Measurement> {
  const warmups = mode === "release" ? 5 : 3;
  const samples = mode === "release" ? 40 : 15;
  const durations: Record<Metric, number[]> = {
    chartCreateMs: [],
    chartUpdateMs: [],
    evaluateMs: [],
    refreshMs: [],
    startupMs: [],
  };
  let last: Awaited<ReturnType<typeof sample>> | undefined;
  for (let index = 0; index < warmups + samples; index += 1) {
    const row = await sample();
    last = row;
    if (index < warmups) continue;
    for (const metric of Object.keys(durations) as Metric[]) {
      durations[metric].push(row.timings[metric]);
    }
  }
  if (last === undefined) throw new Error("no browser sample was taken");
  const metrics = Object.fromEntries(
    (Object.keys(durations) as Metric[]).map((metric) => [
      metric,
      summarize(durations[metric]),
    ]),
  ) as Record<Metric, Samples>;
  return {
    assetBytes: last.assetBytes,
    assetGzipBytes: last.assetGzipBytes,
    assetSha256: last.assetSha256,
    behavior: last.behavior,
    chartPoints: last.chartPoints,
    metrics,
  };
}

function assertBehavior(measurement: Measurement): void {
  const { behavior } = measurement;
  const problems: string[] = [];
  if (behavior.fetchCount !== 1) problems.push("fetchCount");
  if (!behavior.authorizationValid) problems.push("authorization");
  if (behavior.tokenLeakedToUrl) problems.push("token in URL");
  if (behavior.tokenLeakedToStorage) problems.push("token in storage");
  if (behavior.storageWrites !== 0) problems.push("storage writes");
  if (behavior.initialRenders !== 1) problems.push("initial renders");
  if (!behavior.renderedCanvas) problems.push("chart canvas");
  if (measurement.chartPoints === 0) problems.push("chart points");
  if (problems.length > 0) {
    throw new Error(`browser behavior regressed: ${problems.join(", ")}`);
  }
}

function compare(measurement: Measurement, baseline: BaselineFile): string[] {
  const failures: string[] = [];
  // Sizes are deterministic: any drift is a real change, not noise.
  if (measurement.assetBytes !== baseline.assetBytes) {
    failures.push(
      `asset bytes ${measurement.assetBytes} != baseline ${baseline.assetBytes}`,
    );
  }
  if (measurement.assetGzipBytes !== baseline.assetGzipBytes) {
    failures.push(
      `asset gzip ${measurement.assetGzipBytes} != baseline ${baseline.assetGzipBytes}`,
    );
  }
  if (measurement.assetSha256 !== baseline.assetSha256) {
    failures.push(
      `asset sha256 ${measurement.assetSha256} != baseline ${baseline.assetSha256}`,
    );
  }
  for (const metric of Object.keys(baseline.metrics) as Metric[]) {
    const allowed = baseline.metrics[metric].median * baseline.toleranceFactor;
    if (measurement.metrics[metric].median > allowed) {
      failures.push(
        `${metric} median ${measurement.metrics[metric].median.toFixed(3)} > ${allowed.toFixed(3)} (baseline ${baseline.metrics[metric].median.toFixed(3)} × ${baseline.toleranceFactor})`,
      );
    }
  }
  return failures;
}

async function main(): Promise<void> {
  const mode = process.argv.includes("--mode=release") ? "release" : "smoke";
  const check = process.argv.includes("--check");
  const writeBaseline = process.argv.includes("--write-baseline");
  const measurement = await measure(mode);
  assertBehavior(measurement);

  const out = process.argv.find((value) => value.startsWith("--out="));
  const report = {
    baselineVersion: 1 as const,
    mode,
    node: process.version,
    fixture: FIXTURE,
    chartPoints: measurement.chartPoints,
    assetBytes: measurement.assetBytes,
    assetGzipBytes: measurement.assetGzipBytes,
    assetSha256: measurement.assetSha256,
    behavior: measurement.behavior,
    metrics: measurement.metrics,
  };

  if (writeBaseline) {
    const baseline: BaselineFile = {
      baselineVersion: 1,
      metrics: measurement.metrics,
      node: process.version,
      recordedAt: new Date().toISOString().slice(0, 10),
      toleranceFactor: 2.5,
      assetBytes: measurement.assetBytes,
      assetGzipBytes: measurement.assetGzipBytes,
      assetSha256: measurement.assetSha256,
    };
    await writeBenchmarkOutput(BASELINE, baseline);
    console.log(`baseline written to ${BASELINE}`);
    return;
  }

  if (check) {
    const baseline = readJson<BaselineFile>(BASELINE);
    const failures = compare(measurement, baseline);
    for (const metric of Object.keys(baseline.metrics) as Metric[]) {
      const now = measurement.metrics[metric].median;
      const then = baseline.metrics[metric].median;
      console.log(
        `${metric.padEnd(14)} ${now.toFixed(3)} ms  (baseline ${then.toFixed(3)}, ${now > then ? "+" : ""}${(now - then).toFixed(3)})`,
      );
    }
    if (failures.length > 0) {
      console.error(`browser benchmark regressed:\n- ${failures.join("\n- ")}`);
      process.exitCode = 1;
      return;
    }
    console.log(`browser benchmark within baseline (${BASELINE})`);
    return;
  }

  console.log(JSON.stringify(report, null, 2));
  if (out !== undefined) {
    await writeBenchmarkOutput(out.slice("--out=".length), report);
  }
}

await main();

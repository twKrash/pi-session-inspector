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
  createChartCanvasStub,
  installChartGlobals,
} from "../tests/helpers/client-harness.ts";
import { summarize, writeBenchmarkOutput, type Samples } from "./output.ts";

/**
 * Interactive browser-asset benchmark.
 *
 * It measures the shipped classic asset the server serves, executed in the same
 * stub-DOM harness the browser tests use, plus the chart adapter on a canvas
 * stub. The point is a maintained, reproducible number for the browser surface:
 * bundle evaluation, first render (startup), a route change that re-renders the
 * loaded view, and chart create/update — the costs the bundled client adds.
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
// the same minimal one the browser integration test uses.
installChartGlobals();

const FIXTURE = "tests/fixtures/bundles/inspector-bundle.json";
const BASELINE = "benchmark/baselines/browser.json";
const TOKEN = "opaque-benchmark-token";

type Metric =
  | "evaluateMs"
  | "startupMs"
  | "rerenderMs"
  | "chartCreateMs"
  | "chartUpdateMs";

/** What one run of the shipped surface produced, before the timings are pooled. */
type Run = {
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
    /** Renders the client performed for the initial load; observed, not assumed. */
    initialRenders: number;
    /** Renders the measured route change caused; must be exactly one. */
    rerenderRenders: number;
    /** The address bar the client applied after the measured route change. */
    appliedRoute: string;
    renderedCanvas: boolean;
  };
  timings: Record<Metric, number>;
};

/** A run with its timings pooled across samples. */
type Measurement = Omit<Run, "timings"> & {
  metrics: Record<Metric, Samples>;
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

async function sample(): Promise<Run> {
  const snapshot = fixture();
  // The shipped asset, exactly the bytes the server serves.
  const asset = WEB_ASSETS.client;
  const sha256 = createHash("sha256").update(asset).digest("hex");

  // The shipped client: evaluation, first render, then one route-change render.
  const evaluateStart = performance.now();
  const client = createWebClient({
    hash: `#token=${TOKEN}`,
    responses: [snapshot],
  });
  const evaluated = performance.now();
  await client.start();
  const started = performance.now();
  const initialRenders = client.renders();
  const renderedCanvas =
    client.element("view").querySelectorAll("canvas").length > 0;

  // A real re-render: another view the loaded snapshot supports. The applied
  // route changes and the client rebuilds the view exactly once, without a
  // request, because the range intent did not change. Firing hashchange() with
  // the already-applied route would measure nothing (the client returns early).
  client.location.hash = "#/current/llm?scope=tree";
  const rerenderStart = performance.now();
  client.hashchange();
  const rerendered = performance.now();
  const rerenderRenders = client.renders() - initialRenders;
  const appliedRoute = client.location.hash;

  // The chart adapter alone, on a canvas of the same size the layout gives it.
  const canvas = createChartCanvasStub();
  const input = chartInput();
  const chartStart = performance.now();
  const chart = createDailyChart(canvas, input);
  const chartCreated = performance.now();
  applyChartTheme(chart, chartTheme(true));
  const chartUpdated = performance.now();
  chart.destroy();

  const fetches = client.fetches();
  return {
    assetBytes: Buffer.byteLength(asset),
    assetGzipBytes: gzipSync(asset, { level: 9 }).length,
    assetSha256: sha256,
    behavior: {
      authorizationValid: fetches[0]?.authorization === `Bearer ${TOKEN}`,
      fetchCount: fetches.length,
      appliedRoute,
      initialRenders,
      renderedCanvas,
      rerenderRenders,
      storageWrites: client.storageWrites().length,
      tokenLeakedToStorage: client
        .storageWrites()
        .some(({ key }) => key.includes(TOKEN)),
      tokenLeakedToUrl: fetches.some(({ url }) => url.includes(TOKEN)),
    },
    chartPoints: chart.data.datasets[0]?.data.length ?? 0,
    timings: {
      chartCreateMs: chartCreated - chartStart,
      chartUpdateMs: chartUpdated - chartCreated,
      evaluateMs: evaluated - evaluateStart,
      rerenderMs: rerendered - rerenderStart,
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
    rerenderMs: [],
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
  const { timings: _pooled, ...rest } = last;
  const metrics = Object.fromEntries(
    (Object.keys(durations) as Metric[]).map((metric) => [
      metric,
      summarize(durations[metric]),
    ]),
  ) as Record<Metric, Samples>;
  return { ...rest, metrics };
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
  // The measured operation must have been a real re-render, exactly one of them.
  if (behavior.rerenderRenders !== 1) {
    // Either the route change did not apply, or the view rendered more than
    // once: in both cases the measured operation is not the re-render it claims.
    problems.push("route-change renders");
  }
  if (!behavior.appliedRoute.includes("/current/llm")) {
    problems.push("route change never applied");
  }
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

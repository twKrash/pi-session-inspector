import assert from "node:assert/strict";
import { test } from "node:test";

import type { Chart } from "chart.js";

import type { ChartPalette } from "../../scripts/web/chart.ts";
import {
  createChartCanvas,
  installChartEnvironment,
} from "../helpers/chart-harness.ts";

/**
 * The chart adapter is the one place the browser asset touches Chart.js. These
 * tests pin what the adapter owns — the configuration it hands the library and
 * the values it lets the library derive — and that it owns no Inspector
 * semantics: labels and values arrive already projected from the DTO, and a gap
 * stays a gap rather than becoming a zero.
 */

installChartEnvironment();

const { applyChartTheme, chartTheme, createDailyChart } = await import(
  "../../scripts/web/chart.ts"
);

/** The chart internals a test reads: Chart.js types them loosely or privately. */
type Inspectable = {
  _animationsDisabled?: boolean;
  data: { datasets: { yAxisID?: string; borderColor?: unknown }[] };
  legend?: { legendItems?: { text: string }[] };
  options: {
    animation?: unknown;
    maintainAspectRatio?: boolean;
    plugins?: {
      legend?: { display?: boolean };
      tooltip?: {
        callbacks?: {
          label?: (item: unknown) => string;
          title?: (items: unknown) => string;
        };
      };
    };
    responsive?: boolean;
    scales?: Record<
      string,
      { display?: boolean; position?: string; right?: number }
    >;
  };
  scales: Record<
    string,
    {
      getLabels?: () => string[];
      right?: number;
      ticks: { label?: string; value?: number }[];
    }
  >;
  destroy(): void;
  getDatasetMeta(index: number): {
    data: { parsed?: { y: number }; skip?: boolean }[];
  };
  resize(width: number, height: number): void;
};

/** SAFETY: these tests read a few internals Chart.js does not publish as types. */
const inspect = (chart: Chart): Inspectable => chart as unknown as Inspectable;

const money = (value: number): string => `$${value.toFixed(2)}`;
const number = (value: number): string =>
  new Intl.NumberFormat("en-US").format(Math.round(value));
const format = (kind: string, value: number): string =>
  kind === "cost" ? money(value) : number(value);

const LABELS = ["2026-01-27", "2026-01-28", "2026-01-29"];

const COST_SERIES = {
  axis: "y" as const,
  format: "cost",
  key: "cost",
  label: "Cost",
  values: [0.42, null, 0.51],
};

function chartOf(theme: ChartPalette = chartTheme(false)): {
  chart: Chart;
  canvas: ReturnType<typeof createChartCanvas>;
} {
  const canvas = createChartCanvas();
  const chart = createDailyChart(canvas, {
    ariaLabel: "Daily cost",
    format,
    labels: LABELS,
    series: [COST_SERIES],
    theme,
  });
  return { canvas, chart };
}

test("the adapter configures the library for deterministic rendering", () => {
  const { chart } = chartOf();
  const view = inspect(chart);
  // No animation is ever created, so the wall clock is unreachable.
  assert.equal(view.options.animation, false);
  assert.equal(view._animationsDisabled, true);
  assert.equal(view.options.responsive, true);
  assert.equal(view.options.maintainAspectRatio, false);
  chart.destroy();
});

test("the adapter renders the DTO's own labels and values, gaps included", () => {
  const { chart } = chartOf();
  assert.deepEqual(chart.scales.x?.getLabels?.(), LABELS);
  assert.deepEqual(
    chart.scales.x?.ticks.map((tick) => tick.label),
    LABELS,
  );
  // The projected values reach the library unchanged: nothing here recomputes,
  // aggregates, or turns a gap into a zero.
  assert.deepEqual(chart.data.datasets[0]?.data, [0.42, null, 0.51]);
  const points = inspect(chart).getDatasetMeta(0).data;
  assert.equal(points[1]?.skip, true);
  assert.equal(points[0]?.skip, false);
  // The axis starts at zero, so a value is never drawn against a truncated one.
  assert.equal(chart.scales.y?.ticks[0]?.value, 0);
  chart.destroy();
});

test("the adapter carries several series onto independent axes", () => {
  const canvas = createChartCanvas();
  const chart = createDailyChart(canvas, {
    ariaLabel: "Daily cost and tokens",
    format,
    labels: LABELS,
    series: [
      {
        axis: "y",
        format: "cost",
        key: "cost",
        label: "Cost",
        values: [0.42, 0.3, 0.51],
      },
      {
        axis: "y1",
        format: "number",
        key: "tokens",
        label: "Tokens",
        values: [120000, 131500, 98000],
      },
    ],
    theme: chartTheme(false),
  });
  const view = inspect(chart);
  assert.equal(view.data.datasets[0]?.yAxisID, "y");
  assert.equal(view.data.datasets[1]?.yAxisID, "y1");
  assert.equal(view.options.scales?.y?.display, true);
  assert.equal(view.options.scales?.y1?.display, true);
  assert.equal(view.options.scales?.y1?.position, "right");
  // Both series are measured, and a legend is offered when there are two.
  assert.equal(view.getDatasetMeta(0).data.length, LABELS.length);
  assert.equal(view.getDatasetMeta(1).data.length, LABELS.length);
  assert.equal(view.options.plugins?.legend?.display, true);
  assert.deepEqual(
    chart.legend?.legendItems?.map((item) => item.text),
    ["Cost", "Tokens"],
  );
  // The right axis is drawn to the right of the left one.
  assert.equal(
    (chart.scales.y1?.right ?? 0) > (chart.scales.y?.right ?? 0),
    true,
  );
  chart.destroy();
});

test("the adapter hides the second axis when no series uses it", () => {
  const { chart } = chartOf();
  const view = inspect(chart);
  assert.equal(view.options.scales?.y1?.display, false);
  assert.equal(view.options.plugins?.legend?.display, false);
  chart.destroy();
});

test("the adapter's tooltip is the caller's formatter, never a raw float", () => {
  const { chart } = chartOf();
  const callbacks = inspect(chart).options.plugins?.tooltip?.callbacks;
  const label = callbacks?.label;
  const title = callbacks?.title;
  assert.equal(typeof label, "function");
  assert.equal(typeof title, "function");
  if (label === undefined || title === undefined) return;
  // The label callback formats through the caller's function.
  assert.equal(
    label({ dataset: { label: "Cost", $format: "cost" }, parsed: { y: 0.42 } }),
    "Cost: $0.42",
  );
  // The title is the DTO's own date label.
  assert.equal(title([{ label: LABELS[0] }]), "2026-01-27");
  chart.destroy();
});

test("a theme switch recolors the drawn chart in place", () => {
  const { chart } = chartOf();
  const before = inspect(chart).data.datasets[0]?.borderColor;
  applyChartTheme(chart, chartTheme(true));
  const after = inspect(chart).data.datasets[0]?.borderColor;
  assert.notEqual(before, after);
  assert.equal(after, chartTheme(true).line.cost);
  assert.equal(
    (
      inspect(chart).options.scales?.x as
        | { ticks?: { color?: string } }
        | undefined
    )?.ticks?.color,
    chartTheme(true).text,
  );
  chart.destroy();
});

test("the canvas carries the caller's accessible summary", () => {
  const { canvas, chart } = chartOf();
  assert.equal(canvas.getAttribute("role"), "img");
  assert.equal(canvas.getAttribute("aria-label"), "Daily cost");
  chart.destroy();
});

test("rendering never reads the wall clock", () => {
  const realNow = Date.now;
  Date.now = () => {
    throw new Error("wall clock read during chart render");
  };
  try {
    const { chart } = chartOf();
    applyChartTheme(chart, chartTheme(true));
    chart.resize(640, 180);
    chart.destroy();
  } finally {
    Date.now = realNow;
  }
});

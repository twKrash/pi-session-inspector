/**
 * The chart adapter: the one file that talks to Chart.js.
 *
 * Inspector owns what a chart *means*. This module owns none of that: the
 * caller has already resolved the range, projected the DTO's daily rows into
 * labels and values, decided that an unavailable value is never a zero, and
 * supplied the copy and the value formatter. What is delegated here is generic
 * representation: canvas drawing, scales and ticks, label collision handling,
 * hover tooltips, the legend, responsive resizing, and point/line rendering.
 *
 * Chart.js is configured with `animation: false`, so no wall-clock read is
 * reachable at runtime: the animation code stays inert. The shipped-asset tests
 * prove that by poisoning `Date.now` and requiring the render to complete. The
 * chart is drawn on a canvas and is therefore not the accessible
 * representation; the exact-value table the caller renders alongside it is.
 */
import {
  CategoryScale,
  Chart,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type ChartConfiguration,
} from "chart.js";

/** One projected series: values are the DTO's, gaps included as `null`. */
export type ChartSeries = {
  axis: "y" | "y1";
  /** The caller's formatter key (`cost` renders as money, anything else as a count). */
  format: string;
  /** The metric key the palette is looked up by. */
  key: string;
  label: string;
  values: (number | null)[];
};

/** One palette for one theme; a canvas cannot read CSS custom properties. */
export type ChartPalette = {
  grid: string;
  line: Record<string, string>;
  surface: string;
  text: string;
};

export type ChartInput = {
  ariaLabel: string;
  /** The caller's own formatter: tick labels and tooltips both use it. */
  format(kind: string, value: number): string;
  labels: string[];
  series: ChartSeries[];
  theme: ChartPalette;
};

/** The slice of a canvas the adapter draws on, so tests need no real DOM one. */
export type ChartCanvasTarget = {
  getContext(type: string): ChartContextLike;
  setAttribute(name: string, value: string): void;
};

/** A 2D context as this module sees it: opaque, and only Chart.js reads it. */
export type ChartContextLike = object | null;

/** A dataset as this module builds it, before Chart.js receives it. */
type DailyDataset = {
  $format: string;
  backgroundColor: string;
  borderColor: string;
  borderWidth: number;
  data: (number | null)[];
  label: string;
  pointBackgroundColor: string;
  pointBorderColor: string;
  pointHoverRadius: number;
  pointRadius: number;
  spanGaps: boolean;
  tension: number;
  yAxisID: "y" | "y1";
};

/** What a tooltip callback receives from Chart.js, narrowed to what is read. */
type TooltipItem = {
  dataset: DailyDataset;
  label?: string;
  parsed: { y: number };
};

/** The option object this module builds, typed by the fields it actually sets. */
type LiveOptions = {
  animation: boolean;
  interaction: { intersect: boolean; mode: "index" };
  layout: { padding: Record<string, number> };
  maintainAspectRatio: boolean;
  normalized: boolean;
  plugins: {
    legend: {
      display: boolean;
      labels: { boxWidth: number; color: string; usePointStyle: boolean };
    };
    tooltip: {
      backgroundColor: string;
      bodyColor: string;
      callbacks: {
        label: (item: TooltipItem) => string;
        title: (items: { label?: string }[]) => string;
      };
      displayColors: boolean;
      titleColor: string;
    };
  };
  responsive: boolean;
  scales: Record<string, LiveScale>;
};

type LiveScale = {
  beginAtZero: boolean;
  border: { display: boolean };
  display: boolean;
  grid: { color: string; drawOnChartArea?: boolean };
  position: "left" | "right";
  ticks: Record<string, unknown>;
  type: "linear" | "category";
};

/** What the adapter remembers per chart so a theme switch can recolor it. */
type LiveChart = {
  datasets: DailyDataset[];
  options: LiveOptions;
  series: ChartSeries[];
};

const THEMES: Record<"dark" | "light", ChartPalette> = {
  dark: {
    grid: "#40493e",
    line: {
      cost: "#ffad80",
      generations: "#9db3e8",
      sessions: "#8fb3a2",
      tokens: "#d8c07a",
      tools: "#c8a2d8",
    },
    surface: "#202521",
    text: "#bdc5b8",
  },
  light: {
    grid: "#dddfd6",
    line: {
      cost: "#aa3e13",
      generations: "#4a5f9e",
      sessions: "#34624b",
      tokens: "#8a6d1f",
      tools: "#7b4a8f",
    },
    surface: "#ffffff",
    text: "#535b4f",
  },
};

const live = new WeakMap<Chart, LiveChart>();
let registered = false;

const register = (): void => {
  if (registered) return;
  Chart.register(
    LineController,
    LineElement,
    PointElement,
    LinearScale,
    CategoryScale,
    Tooltip,
    Legend,
  );
  registered = true;
};

/** The palette for a theme; the caller passes whether the dark theme is on. */
export const chartTheme = (dark: boolean): ChartPalette =>
  dark ? THEMES.dark : THEMES.light;

const datasetFor = (
  series: ChartSeries,
  theme: ChartPalette,
): DailyDataset => ({
  $format: series.format,
  backgroundColor: theme.line[series.key] ?? theme.text,
  borderColor: theme.line[series.key] ?? theme.text,
  borderWidth: 2,
  data: series.values,
  label: series.label,
  pointBackgroundColor: theme.line[series.key] ?? theme.text,
  pointBorderColor: theme.surface,
  pointHoverRadius: 5,
  pointRadius: 3,
  spanGaps: false,
  tension: 0,
  yAxisID: series.axis,
});

const axisFor = (
  position: "left" | "right",
  input: ChartInput,
  series: ChartSeries[],
): LiveScale => ({
  beginAtZero: true,
  border: { display: false },
  display: series.length > 0,
  grid: {
    color: input.theme.grid,
    drawOnChartArea: position === "left",
  },
  position,
  ticks: {
    callback: (value: number | string): string =>
      input.format(series[0]?.format ?? "number", Number(value)),
    color: input.theme.text,
    maxTicksLimit: 6,
  },
  type: "linear",
});

const optionsFor = (input: ChartInput): LiveOptions => ({
  animation: false,
  interaction: { intersect: false, mode: "index" },
  layout: { padding: { bottom: 0, left: 0, right: 4, top: 4 } },
  maintainAspectRatio: false,
  normalized: true,
  plugins: {
    legend: {
      display: input.series.length > 1,
      labels: {
        boxWidth: 12,
        color: input.theme.text,
        usePointStyle: true,
      },
    },
    tooltip: {
      backgroundColor: input.theme.surface,
      bodyColor: input.theme.text,
      callbacks: {
        label: (item) =>
          item.dataset.label +
          ": " +
          input.format(item.dataset.$format, Number(item.parsed.y)),
        title: (items) =>
          items.length > 0 ? String(items[0]?.label ?? "") : "",
      },
      displayColors: input.series.length > 1,
      titleColor: input.theme.text,
    },
  },
  responsive: true,
  scales: {
    x: {
      beginAtZero: false,
      border: { display: false },
      display: true,
      grid: { color: input.theme.grid },
      position: "left",
      ticks: {
        autoSkip: true,
        color: input.theme.text,
        maxRotation: 0,
      },
      type: "category",
    },
    y: axisFor(
      "left",
      input,
      input.series.filter((it) => it.axis === "y"),
    ),
    y1: axisFor(
      "right",
      input,
      input.series.filter((it) => it.axis === "y1"),
    ),
  },
});

const recolor = (remembered: LiveChart, theme: ChartPalette): void => {
  remembered.datasets.forEach((dataset, index) => {
    const color = theme.line[remembered.series[index]?.key ?? ""] ?? theme.text;
    dataset.borderColor = color;
    dataset.backgroundColor = color;
    dataset.pointBackgroundColor = color;
    dataset.pointBorderColor = theme.surface;
  });
  const options = remembered.options;
  options.plugins.legend.labels.color = theme.text;
  options.plugins.tooltip.backgroundColor = theme.surface;
  options.plugins.tooltip.bodyColor = theme.text;
  options.plugins.tooltip.titleColor = theme.text;
  for (const scale of Object.values(options.scales)) {
    scale.grid.color = theme.grid;
    scale.ticks.color = theme.text;
  }
};

/**
 * Creates one chart on `canvas` from projected input:
 *
 * - `labels`: one X label per DTO row, in the DTO's own order;
 * - `series`: `{ key, label, values, axis, format }`, values already projected
 *   (`null` for a gap the DTO reports as unavailable);
 * - `format`: `(format, value) => string` for ticks and tooltips;
 * - `ariaLabel`: the caller's summary of what is drawn.
 */
export const createDailyChart = (
  canvas: ChartCanvasTarget,
  input: ChartInput,
): Chart => {
  register();
  const datasets = input.series.map((series) =>
    datasetFor(series, input.theme),
  );
  const options = optionsFor(input);
  // SAFETY: this module builds the configuration itself; Chart.js's option type
  // is a deep partial union that the concrete object cannot be written back to,
  // and it is the same object kept for later recollection.
  const configuration = {
    data: { datasets: datasets, labels: input.labels },
    options: options,
    type: "line",
  } as unknown as ChartConfiguration<"line", (number | null)[], string>;
  // SAFETY: Chart.js accepts a canvas element or a 2D context; this module
  // accepts the two canvas members it needs so tests can supply a stub.
  const chart = new Chart(
    canvas as unknown as HTMLCanvasElement,
    configuration,
  );
  live.set(chart, { datasets, options, series: input.series });
  canvas.setAttribute("aria-label", input.ariaLabel);
  canvas.setAttribute("role", "img");
  return chart;
};

/** Recolors a live chart for the other theme and redraws it. */
export const applyChartTheme = (chart: Chart, theme: ChartPalette): void => {
  const remembered = live.get(chart);
  if (remembered === undefined) return;
  recolor(remembered, theme);
  chart.update("none");
};

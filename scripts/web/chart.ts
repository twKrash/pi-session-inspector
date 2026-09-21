/**
 * The chart adapter: the one file that talks to Chart.js.
 *
 * Inspector owns what a chart *means*. This module owns none of that: the caller
 * has already resolved the range, projected the DTO's daily rows into labels and
 * values, decided that an unavailable value is never a zero, and supplied the
 * copy and the value formatter. What is delegated is generic representation:
 * canvas drawing, scales and ticks, label collision handling, hover tooltips,
 * the legend, responsive resizing, and point/line rendering.
 *
 * `buildChartConfiguration` is pure — it builds the Chart.js configuration and
 * touches neither the DOM nor the library — so the adapter contract is testable
 * without starting a chart. Chart.js is configured with `animation: false`, which
 * is also why no wall-clock read is reachable: the shipped-asset test proves that
 * by poisoning `Date` in the realm that runs the bundle.
 *
 * The chart is a canvas and therefore not the accessible representation; the
 * exact-value table the caller renders beside it is.
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
  type ChartDataset,
  type ChartOptions,
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

/** The slice of a canvas the adapter draws on; a real canvas satisfies it. */
export type ChartCanvasTarget = {
  getContext(type: string): object | null;
  setAttribute(name: string, value: string): void;
};

type LineConfiguration = ChartConfiguration<"line", (number | null)[], string>;
type LineDataset = ChartDataset<"line", (number | null)[]>;
type LineScales = NonNullable<ChartOptions<"line">["scales"]>;

const THEMES: Record<"dark" | "light", ChartPalette> = {
  dark: {
    grid: "#40493e",
    line: {
      cacheReadTokens: "#b6d7a8",
      cacheWriteTokens: "#f0c987",
      cost: "#ffad80",
      generations: "#9db3e8",
      inputTokens: "#86c5da",
      outputTokens: "#d9a6c2",
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
      cacheReadTokens: "#4f7a3f",
      cacheWriteTokens: "#9a6d16",
      cost: "#aa3e13",
      generations: "#4a5f9e",
      inputTokens: "#276b7d",
      outputTokens: "#8a4569",
      sessions: "#34624b",
      tokens: "#8a6d1f",
      tools: "#7b4a8f",
    },
    surface: "#ffffff",
    text: "#535b4f",
  },
};

/** What a live chart was built from, so a theme switch can recolor it. */
const built = new WeakMap<
  Chart,
  { configuration: LineConfiguration; keys: string[] }
>();

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

const datasetFor = (series: ChartSeries, theme: ChartPalette): LineDataset => {
  const color = theme.line[series.key] ?? theme.text;
  return {
    backgroundColor: color,
    borderColor: color,
    borderWidth: 2,
    data: series.values,
    label: series.label,
    pointBackgroundColor: color,
    pointBorderColor: theme.surface,
    pointHoverRadius: 5,
    pointRadius: 3,
    spanGaps: false,
    tension: 0,
    yAxisID: series.axis,
  };
};

const scaleFor = (
  position: "left" | "right",
  input: ChartInput,
  series: ChartSeries[],
): LineScales[string] => ({
  beginAtZero: true,
  border: { display: false },
  display: series.length > 0,
  grid: { color: input.theme.grid, drawOnChartArea: position === "left" },
  position,
  ticks: {
    // The series' own formatter, so a cost axis and a token axis can differ.
    callback: (value) =>
      input.format(series[0]?.format ?? "number", Number(value)),
    color: input.theme.text,
    maxTicksLimit: 6,
  },
  type: "linear",
});

/**
 * The configuration Inspector hands Chart.js, built from projected input:
 * `labels` in the DTO's own order, `series` values unchanged (`null` stays a
 * gap), and the caller's formatter wired to both ticks and tooltips.
 */
export const buildChartConfiguration = (
  input: ChartInput,
): LineConfiguration => ({
  data: {
    datasets: input.series.map((series) => datasetFor(series, input.theme)),
    labels: input.labels,
  },
  options: {
    animation: false,
    interaction: { intersect: false, mode: "index" },
    layout: { padding: { bottom: 0, left: 0, right: 4, top: 4 } },
    maintainAspectRatio: false,
    normalized: true,
    plugins: {
      legend: {
        display: input.series.length > 1,
        labels: { boxWidth: 12, color: input.theme.text, usePointStyle: true },
      },
      tooltip: {
        backgroundColor: input.theme.surface,
        bodyColor: input.theme.text,
        callbacks: {
          label: (item) => {
            const format = input.series[item.datasetIndex]?.format ?? "number";
            return `${item.dataset.label}: ${input.format(format, Number(item.parsed.y))}`;
          },
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
        border: { display: false },
        grid: { color: input.theme.grid },
        ticks: { autoSkip: true, color: input.theme.text, maxRotation: 0 },
        type: "category",
      },
      y: scaleFor(
        "left",
        input,
        input.series.filter((series) => series.axis === "y"),
      ),
      y1: scaleFor(
        "right",
        input,
        input.series.filter((series) => series.axis === "y1"),
      ),
    },
  },
  type: "line",
});

/** Creates the chart on `canvas` and labels it for assistive technology. */
export const createDailyChart = (
  canvas: ChartCanvasTarget,
  input: ChartInput,
): Chart => {
  register();
  const configuration = buildChartConfiguration(input);
  // SAFETY: Chart.js accepts a canvas element or a rendering context; the
  // adapter accepts the two members it needs so a test can supply a canvas
  // without a DOM.
  const chart = new Chart(
    canvas as unknown as HTMLCanvasElement,
    configuration,
  );
  built.set(chart, {
    configuration,
    keys: input.series.map((series) => series.key),
  });
  canvas.setAttribute("aria-label", input.ariaLabel);
  canvas.setAttribute("role", "img");
  return chart;
};

/**
 * The color a series takes in a theme, by its semantic metric key — `cost`
 * reads `palette.line.cost`. A key the palette does not carry reads the theme's
 * text color; a human label (`"Cost"`) is never a key.
 */
const seriesColor = (theme: ChartPalette, key: string): string =>
  theme.line[key] ?? theme.text;

/**
 * Applies `theme` to the datasets of a built configuration. Pure, so the
 * Inspector-owned recoloring rule is testable without starting the library.
 */
export const recolorDatasets = (
  configuration: LineConfiguration,
  keys: string[],
  theme: ChartPalette,
): void => {
  configuration.data.datasets.forEach((dataset, index) => {
    const color = seriesColor(theme, keys[index] ?? "");
    dataset.borderColor = color;
    dataset.backgroundColor = color;
    dataset.pointBackgroundColor = color;
    dataset.pointBorderColor = theme.surface;
  });
};

/** Recolors a live chart for the other theme and redraws it. */
export const applyChartTheme = (chart: Chart, theme: ChartPalette): void => {
  const entry = built.get(chart);
  if (entry === undefined) return;
  recolorDatasets(entry.configuration, entry.keys, theme);
  // SAFETY: Chart.js types scale options as a union of per-scale shapes, so the
  // two fields this adapter recolors are read through one concrete shape.
  const scales = chart.options.scales as
    | Record<string, { grid?: { color?: string }; ticks?: { color?: string } }>
    | undefined;
  const plugins = chart.options.plugins;
  if (plugins?.legend?.labels !== undefined) {
    plugins.legend.labels.color = theme.text;
  }
  if (plugins?.tooltip !== undefined) {
    plugins.tooltip.backgroundColor = theme.surface;
    plugins.tooltip.bodyColor = theme.text;
    plugins.tooltip.titleColor = theme.text;
  }
  for (const scale of Object.values(scales ?? {})) {
    if (scale.grid !== undefined) scale.grid.color = theme.grid;
    if (scale.ticks !== undefined) scale.ticks.color = theme.text;
  }
  chart.update("none");
};

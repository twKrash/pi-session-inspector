import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildChartConfiguration,
  chartTheme,
  recolorDatasets,
  type ChartInput,
} from "../../scripts/web/chart.ts";

/**
 * The adapter's own contract: what Inspector hands Chart.js. The library is not
 * started and not tested — its scales, ticks, tooltips, and layout are upstream's
 * responsibility. Pinned here is that Inspector's projected values reach the
 * library unchanged, that the axes and formatter are the ones we chose, and that
 * a gap stays a gap.
 */

type Configuration = ReturnType<typeof buildChartConfiguration>;

const money = (value: number): string => `$${value.toFixed(2)}`;
const number = (value: number): string => String(Math.round(value));
const format = (kind: string, value: number): string =>
  kind === "cost" ? money(value) : number(value);

const LABELS = ["2026-01-27", "2026-01-28", "2026-01-29"];

const input: ChartInput = {
  ariaLabel: "Daily cost and tokens",
  format,
  labels: LABELS,
  series: [
    {
      axis: "y",
      format: "cost",
      key: "cost",
      label: "Cost",
      values: [0.42, null, 0.51],
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
};

/** Calls the tooltip label callback the configuration wired up. */
function tooltipLabel(
  config: Configuration,
  seriesIndex: number,
  label: string,
  y: number,
): string {
  const callbacks = config.options?.plugins?.tooltip?.callbacks;
  const callback =
    callbacks === undefined ? undefined : Reflect.get(callbacks, "label");
  if (typeof callback !== "function")
    throw new Error("no tooltip label callback");
  const result: unknown = Reflect.apply(callback, undefined, [
    { dataset: { label }, datasetIndex: seriesIndex, parsed: { y } },
  ]);
  if (typeof result !== "string") throw new Error("tooltip label is not text");
  return result;
}

test("the DTO's own labels and values reach the library unchanged", () => {
  const config = buildChartConfiguration(input);

  assert.equal(config.data.labels, LABELS);
  assert.deepEqual(config.data.datasets[0]?.data, [0.42, null, 0.51]);
  // A value the DTO did not publish stays a gap: never drawn as a zero.
  assert.equal(config.data.datasets[0]?.data?.[1], null);
  assert.equal(config.data.datasets[0]?.spanGaps, false);
});

test("each series carries its own axis and its own formatter", () => {
  const config = buildChartConfiguration(input);

  assert.equal(config.data.datasets[0]?.yAxisID, "y");
  assert.equal(config.data.datasets[1]?.yAxisID, "y1");
  assert.equal(config.options?.scales?.y?.display, true);
  assert.equal(config.options?.scales?.y1?.display, true);
  assert.equal(config.options?.scales?.y1?.position, "right");
  // The caller's formatter, not a raw float, reaches the tooltip.
  assert.equal(tooltipLabel(config, 0, "Cost", 0.42), "Cost: $0.42");
  assert.equal(tooltipLabel(config, 1, "Tokens", 98000), "Tokens: 98000");
});

test("a single series hides the unused axis and the legend", () => {
  const first = input.series[0] as ChartInput["series"][number];
  const config = buildChartConfiguration({ ...input, series: [first] });

  assert.equal(config.options?.scales?.y1?.display, false);
  assert.equal(config.options?.plugins?.legend?.display, false);
});

test("the adapter configures deterministic rendering and the caller's theme", () => {
  const theme = chartTheme(true);
  const config = buildChartConfiguration({ ...input, theme });

  assert.equal(config.options?.animation, false);
  assert.equal(config.data.datasets[0]?.borderColor, theme.line.cost);
  assert.equal(config.data.datasets[1]?.borderColor, theme.line.tokens);
  assert.equal(config.options?.scales?.x?.grid?.color, theme.grid);
  assert.equal(config.options?.scales?.x?.ticks?.color, theme.text);
  assert.equal(config.options?.plugins?.legend?.labels?.color, theme.text);
  assert.equal(config.options?.plugins?.legend?.display, true);
});

test("theme colors are looked up by metric key, not by the series label", () => {
  // Regression: the palette is keyed by metric ("cost"), while a series carries
  // a human label ("Cost"). Recoloring must not fall back to the theme's text
  // color because it looked the label up in the palette.
  const theme = chartTheme(true);
  const config = buildChartConfiguration({
    ...input,
    theme: chartTheme(false),
  });

  recolorDatasets(config, ["cost", "tokens"], theme);

  assert.equal(config.data.datasets[0]?.borderColor, theme.line.cost);
  assert.equal(config.data.datasets[1]?.borderColor, theme.line.tokens);
  assert.notEqual(config.data.datasets[0]?.borderColor, theme.text);
  assert.equal(config.data.datasets[0]?.label, "Cost");
});

test("both themes provide a concrete color for every charted metric", () => {
  const metrics = [
    "sessions",
    "cost",
    "tokens",
    "generations",
    "tools",
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
  ];
  for (const palette of [chartTheme(false), chartTheme(true)]) {
    for (const metric of metrics) {
      assert.match(palette.line[metric] ?? "", /^#[0-9a-f]{6}$/);
    }
  }
});

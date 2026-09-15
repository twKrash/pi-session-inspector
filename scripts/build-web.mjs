/**
 * The build seam (ADR 0018): the authored sources in `scripts/web/`
 * (`route.js`, `range.js`, `client.js`) are concatenated in that order, behind a
 * prelude that installs the shared translator, the shared cost rule, the shared
 * agent-forest projection, and the chart adapter, then bundled into one
 * deterministic classic asset, `src/ui/web/client.bundle.js`.
 *
 * The build does not transform behaviour: it joins the three files the browser
 * used to load separately, then minifies. `--check` rebuilds and compares bytes,
 * so a stale asset fails instead of shipping; `prepack` and the pre-commit hook
 * both run it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildSync } from "esbuild";

const sourceFiles = ["route.js", "range.js", "client.js"];
const outputUrl = new URL("../src/ui/web/client.bundle.js", import.meta.url);
const resolveDir = fileURLToPath(new URL("../", import.meta.url));
// The shared boundaries are installed before the client runs, so the browser
// resolves copy, cost and execution topology through the same modules the
// TypeScript renderers use, rather than through a second implementation.
const prelude = `import { formatCost } from "./src/ui/format.ts";
import { createTranslator } from "./src/ui/i18n.ts";
import { buildAgentForest, filterAgentForest } from "./src/ui/agent-tree.ts";
import { applyChartTheme, chartTheme, createDailyChart } from "./scripts/web/chart.ts";
const web = (globalThis.SessionInspectorWeb = globalThis.SessionInspectorWeb || {});
web.i18n = { t: createTranslator("en") };
web.format = { cost: formatCost };
web.agentTree = { build: buildAgentForest, filter: filterAgentForest };
web.chart = { applyChartTheme, chartTheme, createDailyChart };`;
const input = [
  prelude,
  ...sourceFiles.map((name) =>
    readFileSync(new URL(`./web/${name}`, import.meta.url), "utf8"),
  ),
].join("\n");

const result = buildSync({
  stdin: {
    contents: input,
    loader: "js",
    resolveDir,
    sourcefile: "scripts/web/client-entry.js",
  },
  bundle: true,
  charset: "utf8",
  format: "iife",
  legalComments: "none",
  minify: true,
  platform: "browser",
  target: "es2022",
  write: false,
});
const output = result.outputFiles[0]?.text;
if (output === undefined) throw new Error("esbuild produced no browser asset");

if (process.argv.includes("--check")) {
  const current = readFileSync(outputUrl, "utf8");
  if (current !== output) {
    console.error(
      `${fileURLToPath(outputUrl)} is stale; run npm run build:web`,
    );
    process.exitCode = 1;
  }
} else {
  writeFileSync(outputUrl, output, "utf8");
}

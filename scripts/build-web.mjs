import { buildSync } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const sourceFiles = ["route.js", "range.js", "client.js"];
const outputUrl = new URL("../src/ui/web/client.js", import.meta.url);
const resolveDir = fileURLToPath(new URL("../", import.meta.url));
const prelude = `import { createTranslator } from "./src/ui/i18n.ts";
import { applyChartTheme, chartTheme, createDailyChart } from "./scripts/web/chart.ts";
const web = (globalThis.SessionInspectorWeb = globalThis.SessionInspectorWeb || {});
web.i18n = { t: createTranslator("en") };
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

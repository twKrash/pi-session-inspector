import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

test("package declares Pi extension and ships entrypoint", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));

  assert.equal(pkg.type, "module");
  assert.equal(pkg.engines.node, ">=22.19.0");
  assert.deepEqual(pkg.keywords.includes("pi-package"), true);
  assert.deepEqual(pkg.pi.extensions, ["./src/index.ts"]);
  assert.ok(existsSync("src/index.ts"), "missing Pi extension entrypoint");
});

test("package allowlist includes license and published source", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));

  assert.ok(pkg.files.includes("LICENSE"));
  assert.ok(pkg.files.includes("src"));
  assert.ok(existsSync("LICENSE"), "missing MIT license");
});

test("both commands present a placeholder UI", () => {
  const source = readFileSync("src/index.ts", "utf8");

  assert.match(source, /session-inspector/);
  assert.match(source, /session-ins/);
  assert.match(source, /ctx\.ui\.custom/);
});

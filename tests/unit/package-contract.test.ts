import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/** The released version this branch ships (SemVer, ADR 0018). */
const RELEASE_VERSION = "0.11.0";

/**
 * The three browser assets the server and package share. `client.bundle.js` is
 * generated from the authored sources in `scripts/web/`, which never ship.
 */
const BROWSER_ASSETS = ["shell.html", "style.css", "client.bundle.js"] as const;

/** The producer trees that never ship and must never be required at runtime. */
const DEVELOPMENT_TREES = ["tests/", "benchmark/", "docs/", ".superpowers/"];

/** The published manifest fields this contract pins. */
type PackageManifest = {
  type: string;
  version: string;
  files: string[];
  keywords: string[];
  engines: { node: string };
  pi: { extensions: string[] };
  peerDependencies: Record<string, string>;
  dependencies: Record<string, string>;
};

function packageManifest(): PackageManifest {
  return JSON.parse(readFileSync("package.json", "utf8")) as PackageManifest;
}

/** Every source file of the shipped `src` tree, browser assets included. */
function shippedSourceFiles(directory = "src"): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return shippedSourceFiles(path);
    return [path];
  });
}

test("package declares Pi extension and ships entrypoint", () => {
  const pkg = packageManifest();

  assert.equal(pkg.type, "module");
  assert.equal(pkg.engines.node, ">=22.19.0");
  assert.deepEqual(pkg.keywords.includes("pi-package"), true);
  assert.deepEqual(pkg.pi.extensions, ["./src/index.ts"]);
  assert.equal(pkg.peerDependencies["@earendil-works/pi-tui"], "^0.85.1");
  assert.ok(existsSync("src/index.ts"), "missing Pi extension entrypoint");
});

test("package allowlist includes licenses and published source", () => {
  const pkg = packageManifest();

  assert.ok(pkg.files.includes("LICENSE"));
  assert.ok(pkg.files.includes("THIRD_PARTY_NOTICES.md"));
  assert.ok(pkg.files.includes("src"));
  assert.ok(existsSync("LICENSE"), "missing MIT license");
  assert.ok(
    existsSync("THIRD_PARTY_NOTICES.md"),
    "missing third-party notices",
  );
});

test("both manifests report the released version", () => {
  const pkg = packageManifest();
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as {
    version: string;
    packages: Record<
      string,
      { version: string; dependencies?: unknown; peerDependencies?: unknown }
    >;
  };

  assert.equal(pkg.version, RELEASE_VERSION);
  assert.equal(lock.version, RELEASE_VERSION);
  assert.equal(lock.packages[""].version, RELEASE_VERSION);
  // The dependency floors are unchanged by the release: the same peers and the
  // same runtime dependency set stay declared.
  assert.deepEqual(lock.packages[""].peerDependencies, pkg.peerDependencies);
  assert.deepEqual(lock.packages[""].dependencies, pkg.dependencies);
});

test("the three browser assets ship inside the published tree", () => {
  const pkg = packageManifest();
  assert.ok(pkg.files.includes("src"));

  for (const name of BROWSER_ASSETS) {
    const path = join("src", "ui", "web", name);
    assert.ok(existsSync(path), `missing shipped asset ${path}`);
    assert.equal(statSync(path).isFile(), true, path);
  }
  // The one loader reads exactly those three files, by relative URL only.
  const loader = readFileSync("src/ui/web-assets.ts", "utf8");
  const specifiers = [
    ...loader.matchAll(/new URL\("([^"]+)",\s*import\.meta\.url\)/g),
  ]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(specifiers, [
    "./web/client.bundle.js",
    "./web/shell.html",
    "./web/style.css",
  ]);
});

test("no development-only file is required at runtime", () => {
  for (const path of shippedSourceFiles()) {
    const source = readFileSync(path, "utf8");
    const specifiers = [
      ...source.matchAll(/(?:from|require\(|import\()\s*"([^"]+)"/g),
      ...source.matchAll(
        /(?:readFileSync|readFile|readdirSync)\(\s*"([^"]+)"/g,
      ),
      ...source.matchAll(/new URL\(\s*"([^"]+)"/g),
    ].map((match) => match[1]);
    for (const specifier of specifiers) {
      for (const tree of DEVELOPMENT_TREES) {
        assert.equal(
          specifier.includes(tree),
          false,
          `${path} requires development-only ${specifier}`,
        );
      }
    }
  }
  // The allowlist ships `src` only: no test, benchmark or workspace tree is
  // packed, so none can be a runtime requirement either.
  const pkg = packageManifest();
  for (const entry of pkg.files) {
    assert.equal(
      DEVELOPMENT_TREES.some((tree) => entry.startsWith(tree)),
      false,
      entry,
    );
  }
});

test("both commands present a real UI surface", () => {
  const source = readFileSync("src/index.ts", "utf8");

  assert.match(source, /session-inspector/);
  assert.match(source, /session-ins/);
  assert.match(source, /ctx\.ui\.custom/);
});

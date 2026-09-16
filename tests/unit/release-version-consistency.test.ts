/**
 * Current-release statements must agree with the packaged version.
 *
 * A release is never one edit: the manifest, both lockfile root fields, the
 * CHANGELOG section, the README status line, and the roadmap's
 * `**Current release:**` line all name the shipped version, and
 * `tests/unit/package-contract.test.ts` pins it a second time. Leaving one of
 * them on the previous version is the drift this test exists to stop: the fix
 * is always to update the statement, never to widen the assertion.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string): string => readFileSync(path, "utf8");

const manifest = JSON.parse(read("package.json")) as { version?: unknown };
const version = typeof manifest.version === "string" ? manifest.version : "";

/** Named in every failure, so the message is the checklist. */
const statements: readonly string[] = [
  "package.json",
  "package-lock.json (both root `version` fields)",
  "CHANGELOG.md (new section)",
  "README.md (the `Status` line)",
  "docs/roadmap.md (the `Current release` line)",
  "tests/unit/package-contract.test.ts (`RELEASE_VERSION`)",
];

const remedy = (file: string, found: string): string =>
  `${file} says ${JSON.stringify(found)} but package.json ships ${JSON.stringify(version)}. ` +
  `Update every current-release statement together: ${statements.join(", ")}.`;

test("package.json declares a SemVer version", () => {
  assert.match(
    version,
    /^[0-9]+\.[0-9]+\.[0-9]+$/,
    `package.json version is ${JSON.stringify(version)}`,
  );
});

test("the README status line names the shipped version", () => {
  const match = /^> \*\*Status `([^`]+)`:\*\*/m.exec(read("README.md"));
  assert.ok(match !== null, "README.md has no `> **Status `x.y.z`:**` line");
  assert.equal(match[1] ?? "", version, remedy("README.md", match[1] ?? ""));
});

test("the roadmap current-release line names the shipped version", () => {
  const match = /^\*\*Current release:\*\* `([^`]+)`/m.exec(
    read("docs/roadmap.md"),
  );
  assert.ok(
    match !== null,
    "docs/roadmap.md has no `**Current release:** `x.y.z`` line",
  );
  assert.equal(
    match[1] ?? "",
    version,
    remedy("docs/roadmap.md", match[1] ?? ""),
  );
});

test("the newest CHANGELOG section is the shipped version", () => {
  const headings = [
    ...read("CHANGELOG.md").matchAll(/^## \[([0-9]+\.[0-9]+\.[0-9]+)\]/gm),
  ].map((match) => match[1] ?? "");
  assert.ok(headings.length > 0, "CHANGELOG.md has no `## [x.y.z]` section");
  assert.equal(
    headings[0],
    version,
    remedy("CHANGELOG.md's newest section", headings[0] ?? ""),
  );
});

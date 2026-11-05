/**
 * This package's own `version`, read once from its `package.json`, so a
 * snapshot states which build drew it. The browser bundle carries the same
 * field, embedded at build time (`scripts/build-web.mjs`); both pass it through
 * `versionLabel`, which drops anything that is not plain SemVer.
 */
import { readFileSync } from "node:fs";

function readPackageVersion(): unknown {
  let manifest: unknown;
  try {
    manifest = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    );
  } catch {
    // An unreadable manifest only hides the version line; the report renders.
    return undefined;
  }
  return typeof manifest === "object" && manifest !== null
    ? Reflect.get(manifest, "version")
    : undefined;
}

/** The raw manifest field; render it only through `versionLabel`. */
export const PACKAGE_VERSION: unknown = readPackageVersion();

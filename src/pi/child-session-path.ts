import { isAbsolute, normalize, sep } from "node:path";
import { withoutSessionSuffix } from "../core/child-session-path.ts";

// ADR 0028: which producer-published paths may be followed as a child Pi
// session. Pure policy only; the filesystem is touched elsewhere.
export const MAX_CHILD_PATH_BYTES = 4096;
const SESSION_SUFFIX = ".jsonl";

/**
 * The directory the producer names after the parent session file (the parent
 * path without `.jsonl`), or `undefined` when the parent is not such a file.
 */
export function childSessionRoot(
  parentSessionFile: string,
): string | undefined {
  return isAbsolute(parentSessionFile)
    ? withoutSessionSuffix(parentSessionFile)
    : undefined;
}

/** A bounded, normalized, absolute `.jsonl` strictly beneath `root`. */
export function isConfinedChildPath(
  path: unknown,
  root: string,
): path is string {
  return (
    typeof path === "string" &&
    Buffer.byteLength(path) <= MAX_CHILD_PATH_BYTES &&
    !path.includes("\0") &&
    isAbsolute(path) &&
    normalize(path) === path &&
    path.endsWith(SESSION_SUFFIX) &&
    path.startsWith(root + sep)
  );
}

// ADR 0028: where the producer keeps a parent session's child session files.
// Pure string policy shared by the integration that selects locators and the Pi
// layer that confines the read; core does no path I/O, so absoluteness is
// checked by each caller.
const SESSION_SUFFIX = ".jsonl";

/**
 * The directory the producer names after a parent session file (the path
 * without `.jsonl`), or `undefined` when the path is not such a file.
 */
export function withoutSessionSuffix(
  parentSessionFile: string,
): string | undefined {
  return parentSessionFile.endsWith(SESSION_SUFFIX)
    ? parentSessionFile.slice(0, -SESSION_SUFFIX.length)
    : undefined;
}

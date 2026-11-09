import type {
  ChildSessionLocator,
  ChildSessionParent,
  ChildSessionProjection,
} from "../core/events.ts";
import { parseSessionJsonl } from "./adapter.ts";
import { readChildSessionFile } from "./child-session-file.ts";
import { projectChildSession } from "./child-session.ts";
import { createGate } from "./read-gate.ts";

// ADR 0028: read the child-session locators a parent session may follow within
// a per-session budget. Run identity comes only from the exact persisted notice
// that produced each locator; the file is evidence for a row that already exists.
export type ChildSessionLimits = {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  /** Lines per file, counted before the text is parsed. */
  maxRecords: number;
};

// shortcut: fixed per-session budgets sized from one repository's child files
// (largest 2.4 MiB and 478 lines, p99 1.7 MiB and 423 lines); revisit if History
// load cost becomes a problem on larger histories.
export const CHILD_SESSION_LIMITS: ChildSessionLimits = {
  maxFiles: 64,
  maxFileBytes: 4 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
  maxRecords: 10_000,
};

// History replays every session at once and each reads its own children, so
// per-session budgets alone would multiply. At most this many child files are
// in flight across all of them; the budgets themselves stay per session.
const MAX_CONCURRENT_CHILD_READS = 4;
const withReadSlot = createGate(MAX_CONCURRENT_CHILD_READS);

/**
 * Reads locators serially in order until a file or byte budget is exhausted;
 * what is not reached stays unavailable. Every byte actually read is spent,
 * including those of a file that is then rejected.
 */
export async function readChildSessionProjections(
  locators: readonly ChildSessionLocator[],
  parent: ChildSessionParent,
  limits: ChildSessionLimits = CHILD_SESSION_LIMITS,
): Promise<Map<string, ChildSessionProjection>> {
  const projections = new Map<string, ChildSessionProjection>();
  let remaining = limits.maxTotalBytes;
  for (const { runId, path } of locators.slice(0, limits.maxFiles)) {
    const { bytes, text } = await withReadSlot(() =>
      readChildSessionFile(
        path,
        parent.sessionFile,
        Math.min(limits.maxFileBytes, remaining),
      ),
    );
    remaining -= bytes;
    if (text === undefined || exceedsRecords(text, limits.maxRecords)) continue;
    const projection = projectChildSession(parseSessionJsonl(text), parent);
    if (projection !== undefined) projections.set(runId, projection);
  }
  return projections;
}

/**
 * Counts lines without splitting the text, stopping at the first one past the
 * bound, so a file of millions of tiny records is refused before any record
 * object is built.
 */
export function exceedsRecords(text: string, max: number): boolean {
  let newlines = 0;
  for (
    let at = text.indexOf("\n");
    at !== -1;
    at = text.indexOf("\n", at + 1)
  ) {
    if (++newlines > max) return true;
  }
  const unterminated = text.length > 0 && !text.endsWith("\n") ? 1 : 0;
  return newlines + unterminated > max;
}

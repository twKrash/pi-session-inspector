import type {
  ChildSessionLocator,
  ChildSessionParent,
  ChildSessionProjection,
} from "../core/events.ts";
import { parseSessionJsonl } from "./adapter.ts";
import { readChildSessionFile } from "./child-session-file.ts";
import { projectChildSession } from "./child-session.ts";

// ADR 0028: read the child-session locators a parent session may follow within
// a per-session budget. Run identity comes only from the exact persisted notice
// that produced each locator; the file is evidence for a row that already exists.
export type ChildSessionLimits = {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
};

// shortcut: fixed per-session budgets sized from one repository's child files
// (largest 2.4 MiB, p99 1.7 MiB); revisit after the History load cost is measured.
export const CHILD_SESSION_LIMITS: ChildSessionLimits = {
  maxFiles: 64,
  maxFileBytes: 4 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
};

/**
 * Reads locators serially in order until a file or byte budget is exhausted;
 * what is not reached stays unavailable. A rejected file still spends its bytes.
 */
export async function readChildSessionProjections(
  locators: readonly ChildSessionLocator[],
  parent: ChildSessionParent,
  limits: ChildSessionLimits = CHILD_SESSION_LIMITS,
): Promise<Map<string, ChildSessionProjection>> {
  const projections = new Map<string, ChildSessionProjection>();
  let remaining = limits.maxTotalBytes;
  for (const { runId, path } of locators.slice(0, limits.maxFiles)) {
    const text = await readChildSessionFile(
      path,
      parent.sessionFile,
      Math.min(limits.maxFileBytes, remaining),
    );
    if (text === undefined) continue;
    remaining -= Buffer.byteLength(text);
    const projection = projectChildSession(parseSessionJsonl(text), parent);
    if (projection !== undefined) projections.set(runId, projection);
  }
  return projections;
}

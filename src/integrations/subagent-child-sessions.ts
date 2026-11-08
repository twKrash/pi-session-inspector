import { parseSessionJsonl } from "../pi/adapter.ts";
import { readChildSessionFile } from "./subagent-child-file.ts";
import { MAX_CHILD_PATH_BYTES } from "./subagent-child-path.ts";
import {
  type ChildSessionParent,
  type ChildSessionProjection,
  projectChildSession,
} from "./subagent-child-session.ts";

// ADR 0028: select the child-session locators a parent session may follow, then
// read them within a per-session budget. Run identity comes only from the exact
// persisted notice; the file is evidence for a row that already exists.
const SESSION_FILE_LABEL = "Session file";
/** Above this many published runs the whole selection fails closed. */
const MAX_CLAIMS = 512;

export type ChildSessionLocator = { runId: string; path: string };

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

type Notice = { runId: string; record: Readonly<Record<string, unknown>> };

/**
 * A run keeps its locator only when it published exactly one path and no other
 * run claimed that path: resume reuses a child file under a new run id, so a
 * shared path cannot be attributed to either run. Kept in persisted notice
 * order, which is deterministic for a given session.
 */
export function selectChildSessionLocators(
  notices: Iterable<Notice>,
): ChildSessionLocator[] {
  const claims = collectClaims(notices);
  if (claims === undefined) return [];
  return [...claims.pathOfRun].flatMap(([runId, path]) =>
    path !== null && claims.ownerOfPath.get(path) === runId
      ? [{ runId, path }]
      : [],
  );
}

type Claims = {
  pathOfRun: Map<string, string | null>;
  ownerOfPath: Map<string, string | null>;
};

function collectClaims(notices: Iterable<Notice>): Claims | undefined {
  const claims: Claims = { pathOfRun: new Map(), ownerOfPath: new Map() };
  for (const { runId, record } of notices) {
    const path = publishedPath(record);
    if (path === undefined) continue;
    settle(claims.pathOfRun, runId, path);
    settle(claims.ownerOfPath, path, runId);
    if (claims.pathOfRun.size > MAX_CLAIMS) return undefined;
  }
  return claims;
}

/** Records `value` for `key`; a second, different value marks a conflict (`null`). */
function settle(
  map: Map<string, string | null>,
  key: string,
  value: string,
): void {
  const known = map.get(key);
  map.set(key, known === undefined || known === value ? value : null);
}

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

function publishedPath(
  record: Readonly<Record<string, unknown>>,
): string | undefined {
  const value = record.sessionValue;
  // Share URLs and share errors use other labels, so the exact label is the gate.
  return record.sessionLabel === SESSION_FILE_LABEL &&
    typeof value === "string" &&
    value.length > 0 &&
    Buffer.byteLength(value) <= MAX_CHILD_PATH_BYTES
    ? value
    : undefined;
}

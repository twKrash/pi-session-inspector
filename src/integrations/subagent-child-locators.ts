import { isAbsolute, join } from "node:path";
import { withoutSessionSuffix } from "../core/child-session-path.ts";
import type { ChildSessionLocator } from "../core/events.ts";

// ADR 0028: which child-session locators a parent session may follow. Run
// identity comes only from the exact persisted notice; reading the file is the
// Pi layer's job (`src/pi/child-sessions.ts`), injected by the composition root.
const SESSION_FILE_LABEL = "Session file";
/** Above this many distinct runs or distinct paths the whole selection fails closed. */
const MAX_CLAIMS = 512;

type Notice = {
  runId: string;
  record: Readonly<Record<string, unknown>>;
  /** A path the caller derived (a workflow child publishes none); it replaces the record's. */
  path?: string;
  /** The same notice publishes this run id more than once. */
  repeated?: boolean;
  /** Not a run this session proves (a workflow row, an unmatched launch): it takes no locator but still claims its path. */
  claimOnly?: boolean;
};

/**
 * A run keeps its locator only when it published exactly one path and no other
 * run claimed that path, proven or not: resume reuses a child file under a new
 * run id, so a shared path cannot be attributed to either run. Kept in
 * persisted notice order, which is deterministic for a given session.
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
  for (const { runId, record, path: derived, repeated, claimOnly } of notices) {
    const path = derived === undefined ? publishedPath(record) : derived;
    // A run published twice in one notice is withheld, like the status rule,
    // yet its path stays claimed so no other run can take it. A claim-only row
    // never earns a locator, it only keeps its path from every other run.
    if (claimOnly !== true) {
      if (repeated === true) claims.pathOfRun.set(runId, null);
      else if (path !== undefined) settle(claims.pathOfRun, runId, path);
    }
    if (path !== undefined) settle(claims.ownerOfPath, path, runId);
    // Distinct paths are bounded too: one run can claim many.
    if (
      claims.pathOfRun.size > MAX_CLAIMS ||
      claims.ownerOfPath.size > MAX_CLAIMS
    ) {
      return undefined;
    }
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

function publishedPath(
  record: Readonly<Record<string, unknown>>,
): string | undefined {
  const value = record.sessionValue;
  // Share URLs and share errors use other labels, so the exact label is the
  // gate; the Pi-layer reader bounds and confines the path itself.
  return record.sessionLabel === SESSION_FILE_LABEL &&
    typeof value === "string" &&
    value.length > 0
    ? value
    : undefined;
}

/**
 * Where the producer keeps a workflow child's session: the directory it keys
 * by the child's own run id, inside the parent's directory (pi-subagents
 * `subagent-executor`: one `run-<index>` per step, index 0 for a single agent).
 * `undefined` when the parent is not an absolute `.jsonl` file. The Pi-layer
 * reader still confines the path and the file must prove one dedicated
 * execution, so the convention only names the file, it never vouches for it.
 */
export function workflowChildSessionFile(
  parentSessionFile: string,
  childRunId: string,
): string | undefined {
  const root = isAbsolute(parentSessionFile)
    ? withoutSessionSuffix(parentSessionFile)
    : undefined;
  return root === undefined
    ? undefined
    : join(root, childRunId, "run-0", "session.jsonl");
}

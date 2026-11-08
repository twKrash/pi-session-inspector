import type { ChildSessionLocator } from "../core/events.ts";

// ADR 0028: which child-session locators a parent session may follow. Run
// identity comes only from the exact persisted notice; reading the file is the
// Pi layer's job (`src/pi/child-sessions.ts`), injected by the composition root.
const SESSION_FILE_LABEL = "Session file";
/** Above this many distinct runs or distinct paths the whole selection fails closed. */
const MAX_CLAIMS = 512;

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

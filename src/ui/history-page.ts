import { isBoundedTimestamp } from "../core/canonical.ts";
import { isTrackingSessionId } from "../storage/tracking.ts";
import {
  discoverHistorySessions,
  replayDiscoveredHistorySession,
  type HistoricalSession,
  type HistorySessionLoadOptions,
} from "./load-history.ts";
import type { HistoryDiagnostic, HistorySession } from "../storage/history.ts";

const HISTORY_PAGE_SIZE = 50;
const MAX_HISTORY_CURSOR_LENGTH = 448;
const CURSOR_KEYS = ["version", "direction", "sortAt", "sessionId"] as const;

export type HistoryCursor = {
  version: 1;
  direction: "after" | "before";
  sortAt: string | null;
  sessionId: string;
};

export type HistoryCursorInput = Omit<HistoryCursor, "version">;

export type HistorySessionPage = {
  availability: "available" | "unavailable";
  sessions: HistoricalSession[];
  diagnostics: HistoryDiagnostic[];
  previousCursor: string | null;
  nextCursor: string | null;
};

type OrderedSession = {
  sessionId: string;
  sortAt: string | null;
  discovered: HistorySession;
};

type HistorySortKey = Pick<OrderedSession, "sessionId" | "sortAt">;

export function encodeHistoryCursor(cursor: HistoryCursorInput): string {
  const payload: HistoryCursor = { version: 1, ...cursor };
  if (!isHistoryCursor(payload)) throw new TypeError("invalid history cursor");
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  if (encoded.length > MAX_HISTORY_CURSOR_LENGTH) {
    throw new TypeError("history cursor is too large");
  }
  return encoded;
}

export function decodeHistoryCursor(value: unknown): HistoryCursor | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_HISTORY_CURSOR_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    return undefined;
  }
  try {
    const json = Buffer.from(value, "base64url").toString("utf8");
    if (Buffer.from(json, "utf8").toString("base64url") !== value) {
      return undefined;
    }
    const parsed: unknown = JSON.parse(json);
    if (
      !isHistoryCursor(parsed) ||
      JSON.stringify(parsed) !== json ||
      Object.keys(parsed).some((key, index) => key !== CURSOR_KEYS[index])
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export async function loadHistorySessionPage(
  options: HistorySessionLoadOptions,
  cursor?: string,
): Promise<HistorySessionPage> {
  const decodedCursor =
    cursor === undefined ? undefined : decodeHistoryCursor(cursor);
  if (cursor !== undefined && decodedCursor === undefined) {
    throw new TypeError("invalid history cursor");
  }

  const sortAtBySession = new Map<string, string | null>();
  const discovery = await discoverHistorySessions(
    { ...options, scope: "tree" },
    {
      maxSessions: null,
      observeParsedSession(sessionId, parsed) {
        sortAtBySession.set(sessionId, latestTimestamp(parsed, sessionId));
      },
    },
  );
  const ordered = discovery.sessions
    .map(
      (discovered): OrderedSession => ({
        sessionId: discovered.sessionId,
        sortAt: sortAtBySession.get(discovered.sessionId) ?? null,
        discovered,
      }),
    )
    .sort(compareOrderedSessions);
  const [start, end] = pageBounds(ordered, decodedCursor);
  const selected = ordered.slice(start, end);
  const sessions = await Promise.all(
    selected.map(({ discovered }) =>
      replayDiscoveredHistorySession(options, discovered),
    ),
  );
  const first = selected[0];
  const last = selected[selected.length - 1];
  return {
    availability: discovery.availability,
    sessions,
    diagnostics: discovery.diagnostics,
    previousCursor:
      first !== undefined && start > 0
        ? encodeHistoryCursor({
            direction: "before",
            sortAt: first.sortAt,
            sessionId: first.sessionId,
          })
        : null,
    nextCursor:
      last !== undefined && end < ordered.length
        ? encodeHistoryCursor({
            direction: "after",
            sortAt: last.sortAt,
            sessionId: last.sessionId,
          })
        : null,
  };
}

function latestTimestamp(
  parsed: {
    id: string;
    hasSessionHeader: boolean;
    formatVersion?: number;
    createdAt?: string;
    graphNodes: readonly { timestamp: string | undefined }[];
  },
  sessionId: string,
): string | null {
  if (
    !parsed.hasSessionHeader ||
    parsed.formatVersion !== 3 ||
    parsed.id !== sessionId
  ) {
    return null;
  }
  let latest: string | null = null;
  const values = [parsed.createdAt];
  for (const node of parsed.graphNodes) values.push(node.timestamp);
  for (const value of values) {
    if (
      isBoundedTimestamp(value) &&
      (latest === null || compareTimestamps(value, latest) > 0)
    ) {
      latest = value;
    }
  }
  return latest;
}

function compareTimestamps(left: string, right: string): number {
  const leftMilliseconds = Date.parse(left);
  const rightMilliseconds = Date.parse(right);
  if (leftMilliseconds !== rightMilliseconds) {
    return leftMilliseconds > rightMilliseconds ? 1 : -1;
  }
  const leftFraction = timestampSubMillisecondNanoseconds(left);
  const rightFraction = timestampSubMillisecondNanoseconds(right);
  return leftFraction < rightFraction
    ? -1
    : leftFraction > rightFraction
      ? 1
      : 0;
}

function timestampSubMillisecondNanoseconds(value: string): number {
  const fraction =
    /T\d{2}:\d{2}:\d{2}(?:\.(\d{1,9}))?(?:Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    )?.[1] ?? "";
  return Number(fraction.slice(3).padEnd(6, "0"));
}

function isHistoryCursor(value: unknown): value is HistoryCursor {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false;
  }
  const cursor = value as Partial<HistoryCursor>;
  return (
    Object.keys(cursor).length === CURSOR_KEYS.length &&
    cursor.version === 1 &&
    (cursor.direction === "after" || cursor.direction === "before") &&
    (cursor.sortAt === null || isBoundedTimestamp(cursor.sortAt)) &&
    typeof cursor.sessionId === "string" &&
    isTrackingSessionId(cursor.sessionId)
  );
}

function compareOrderedSessions(
  left: HistorySortKey,
  right: HistorySortKey,
): number {
  if (left.sortAt === null) {
    if (right.sortAt !== null) return 1;
  } else if (right.sortAt === null) {
    return -1;
  } else {
    const byInstant = compareTimestamps(left.sortAt, right.sortAt);
    if (byInstant !== 0) return byInstant > 0 ? -1 : 1;
  }
  return left.sessionId < right.sessionId
    ? -1
    : left.sessionId > right.sessionId
      ? 1
      : 0;
}

function pageBounds(
  sessions: readonly OrderedSession[],
  cursor: HistoryCursor | undefined,
): [number, number] {
  if (cursor === undefined)
    return [0, Math.min(HISTORY_PAGE_SIZE, sessions.length)];
  const boundary: HistorySortKey = {
    sessionId: cursor.sessionId,
    sortAt: cursor.sortAt,
  };
  if (cursor.direction === "after") {
    const start = upperBound(sessions, boundary);
    return [start, Math.min(start + HISTORY_PAGE_SIZE, sessions.length)];
  }
  const end = lowerBound(sessions, boundary);
  return [Math.max(0, end - HISTORY_PAGE_SIZE), end];
}

function lowerBound(
  sessions: readonly OrderedSession[],
  boundary: HistorySortKey,
): number {
  let low = 0;
  let high = sessions.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const session = sessions[middle];
    if (session === undefined)
      throw new Error("history cursor index is out of bounds");
    if (compareOrderedSessions(session, boundary) < 0) low = middle + 1;
    else high = middle;
  }
  return low;
}

function upperBound(
  sessions: readonly OrderedSession[],
  boundary: HistorySortKey,
): number {
  let low = 0;
  let high = sessions.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const session = sessions[middle];
    if (session === undefined)
      throw new Error("history cursor index is out of bounds");
    if (compareOrderedSessions(session, boundary) <= 0) low = middle + 1;
    else high = middle;
  }
  return low;
}

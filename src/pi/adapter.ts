import type { SessionEntry } from "../core/events.ts";
import {
  buildGraphNodes,
  KNOWN_PI_ENTRY_TYPES,
  type PiGraphNode,
} from "./graph.ts";

export type ParsedSession = {
  id: string;
  hasSessionHeader: boolean;
  /** Every `session` record seen; native Pi trusts the first, so more than one is suspect. */
  sessionHeaderCount: number;
  /** Native Pi loads a file only when its first record is the header. */
  headerIsFirstRecord: boolean;
  formatVersion?: number;
  createdAt?: string;
  /** Bounded parent-session path a child Pi session header declares, if any. */
  parentSession?: string;
  entries: SessionEntry[];
  graphNodes: PiGraphNode[];
  unknownEntryCount: number;
  hasMalformedJson: boolean;
};

const MAX_CREATED_AT_BYTES = 64;
const MAX_PARENT_SESSION_BYTES = 4096;
const encoder = new TextEncoder();

export function parseSessionJsonl(source: string): ParsedSession {
  let id = "unknown-session";
  let hasSessionHeader = false;
  let sessionHeaderCount = 0;
  let headerIsFirstRecord = false;
  let seenRecord = false;
  let formatVersion: number | undefined;
  let createdAt: string | undefined;
  let parentSession: string | undefined;
  let unknownEntryCount = 0;
  let hasMalformedJson = false;
  const entries: SessionEntry[] = [];
  const entryRecords: Record<string, unknown>[] = [];

  for (const line of source.split("\n")) {
    if (!line.trim()) continue;
    const firstRecord = !seenRecord;
    seenRecord = true;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      hasMalformedJson = true;
      unknownEntryCount++;
      continue;
    }
    if (!isRecord(value)) {
      unknownEntryCount++;
      continue;
    }
    if (isSessionHeader(value)) {
      id = value.id;
      hasSessionHeader = true;
      sessionHeaderCount++;
      headerIsFirstRecord ||= firstRecord;
      formatVersion = formatVersionOf(value.version);
      createdAt = boundedTimestamp(value.timestamp);
      parentSession = boundedParentSession(value.parentSession);
      continue;
    }
    entryRecords.push(value);
    if (!isEntry(value) || !KNOWN_PI_ENTRY_TYPES.has(value.type)) {
      unknownEntryCount++;
      continue;
    }
    entries.push(value);
  }

  return {
    id,
    hasSessionHeader,
    sessionHeaderCount,
    headerIsFirstRecord,
    formatVersion,
    createdAt,
    ...(parentSession === undefined ? {} : { parentSession }),
    entries,
    graphNodes: buildGraphNodes(entryRecords),
    unknownEntryCount,
    hasMalformedJson,
  };
}

function isSessionHeader(
  value: Record<string, unknown>,
): value is Record<string, unknown> & { id: string } {
  return (
    value.type === "session" &&
    typeof value.id === "string" &&
    value.id.length > 0
  );
}

function formatVersionOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value)
    ? value
    : undefined;
}

function boundedTimestamp(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    encoder.encode(value).byteLength <= MAX_CREATED_AT_BYTES
    ? value
    : undefined;
}

function boundedParentSession(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    encoder.encode(value).byteLength <= MAX_PARENT_SESSION_BYTES
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEntry(value: Record<string, unknown>): value is SessionEntry {
  return (
    typeof value.type === "string" &&
    typeof value.id === "string" &&
    (typeof value.parentId === "string" || value.parentId === null) &&
    typeof value.timestamp === "string"
  );
}

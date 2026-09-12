import type { SessionEntry } from "../core/events.ts";
import {
  buildGraphNodes,
  KNOWN_PI_ENTRY_TYPES,
  type PiGraphNode,
} from "./graph.ts";

export type ParsedSession = {
  id: string;
  hasSessionHeader: boolean;
  formatVersion?: number;
  createdAt?: string;
  entries: SessionEntry[];
  graphNodes: PiGraphNode[];
  unknownEntryCount: number;
  hasMalformedJson: boolean;
};

const MAX_CREATED_AT_BYTES = 64;
const encoder = new TextEncoder();

export function parseSessionJsonl(source: string): ParsedSession {
  let id = "unknown-session";
  let hasSessionHeader = false;
  let formatVersion: number | undefined;
  let createdAt: string | undefined;
  let unknownEntryCount = 0;
  let hasMalformedJson = false;
  const entries: SessionEntry[] = [];
  const entryRecords: Record<string, unknown>[] = [];

  for (const line of source.split("\n")) {
    if (!line.trim()) continue;
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
      formatVersion = formatVersionOf(value.version);
      createdAt = boundedTimestamp(value.timestamp);
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
    formatVersion,
    createdAt,
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

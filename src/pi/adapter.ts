import type { SessionEntry } from "../core/events.ts";

export type ParsedSession = {
  id: string;
  hasSessionHeader: boolean;
  entries: SessionEntry[];
  unknownEntryCount: number;
  hasMalformedJson: boolean;
};

const knownTypes = new Set([
  "message",
  "model_change",
  "thinking_level_change",
  "compaction",
  "branch_summary",
  "custom",
  "custom_message",
  "label",
  "session_info",
]);

export function parseSessionJsonl(source: string): ParsedSession {
  let id = "unknown-session";
  let hasSessionHeader = false;
  let unknownEntryCount = 0;
  let hasMalformedJson = false;
  const entries: SessionEntry[] = [];

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
    if (
      value.type === "session" &&
      typeof value.id === "string" &&
      value.id.length > 0
    ) {
      id = value.id;
      hasSessionHeader = true;
      continue;
    }
    if (!isEntry(value) || !knownTypes.has(value.type)) {
      unknownEntryCount++;
      continue;
    }
    entries.push(value);
  }

  return { id, hasSessionHeader, entries, unknownEntryCount, hasMalformedJson };
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

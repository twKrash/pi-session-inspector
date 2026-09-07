import type { SessionEntry } from "../core/events.ts";

export type ParsedSession = {
  id: string;
  entries: SessionEntry[];
  unknownEntryCount: number;
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
  let unknownEntryCount = 0;
  const entries: SessionEntry[] = [];

  for (const line of source.split("\n")) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      unknownEntryCount++;
      continue;
    }
    if (!isRecord(value)) {
      unknownEntryCount++;
      continue;
    }
    if (value.type === "session" && typeof value.id === "string") {
      id = value.id;
      continue;
    }
    if (!isEntry(value) || !knownTypes.has(value.type)) {
      unknownEntryCount++;
      continue;
    }
    entries.push(value);
  }

  return { id, entries, unknownEntryCount };
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

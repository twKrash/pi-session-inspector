import type { SessionEntry } from "../../core/events.ts";

/** One bounded counter map as produced by an integration before validation. */
export type AdapterCounters = Record<string, number | boolean>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** The versioned schema marker an entry may carry; absent when unusable. */
export function schemaVersion(value: unknown): number | undefined {
  return isRecord(value) && isVersion(value.schemaVersion)
    ? value.schemaVersion
    : undefined;
}

/** A schema marker that is present but unusable, never silently ignored. */
export function hasSchemaVersion(value: unknown): boolean {
  return isRecord(value) && Object.hasOwn(value, "schemaVersion");
}

export function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

export function booleanField(
  value: Record<string, unknown>,
  key: string,
): boolean | undefined {
  return typeof value[key] === "boolean" ? (value[key] as boolean) : undefined;
}

export function toolCallNames(entry: SessionEntry): string[] | undefined {
  if (entry.type !== "message" || !isRecord(entry.message)) return undefined;
  const content = entry.message.content;
  if (!Array.isArray(content)) return undefined;
  const names: string[] = [];
  for (const item of content) {
    if (
      isRecord(item) &&
      item.type === "toolCall" &&
      typeof item.name === "string"
    ) {
      names.push(item.name);
    }
  }
  return names;
}

/**
 * Merges two bounded counter maps: numbers sum, booleans OR, and an unsafe sum
 * yields nothing rather than a truncated total.
 */
export function mergeCounters(
  previous: AdapterCounters | undefined,
  next: AdapterCounters,
): AdapterCounters | undefined {
  if (previous === undefined) return { ...next };
  const counters: AdapterCounters = { ...previous };
  for (const [key, value] of Object.entries(next)) {
    const prior = counters[key];
    if (typeof value === "number" && typeof prior === "number") {
      const total = prior + value;
      if (!Number.isSafeInteger(total)) return undefined;
      counters[key] = total;
    } else {
      counters[key] = value === true || prior === true;
    }
  }
  return counters;
}

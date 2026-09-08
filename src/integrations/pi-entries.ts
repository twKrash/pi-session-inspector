import type {
  IntegrationKey,
  IntegrationObservation,
  SessionEntry,
} from "../core/events.ts";
import {
  createEvidenceRegistry,
  type BoundedEvidenceValue,
  type EvidenceAdapter,
  type EvidenceRegistry,
} from "./evidence.ts";

const SUPPORTED_SCHEMA_VERSION = 1;
const MODE_CUSTOM_TYPES = new Set(["caveman-level", "ponytail-mode"]);
const OBSERVATION_ORDER = [
  "context",
  "rtk",
  "mode",
  "permission",
  "lens",
] as const;
const PERMISSION_CUSTOM_TYPES = new Set([
  "permissions:ready",
  "permissions:ui_prompt",
  "permissions:decision",
]);

/**
 * Reads only versioned, persisted integration metadata from Pi entries. Source
 * custom data and tool payloads are never included in the resulting counters.
 */
export function readPiEntryEvidence(
  entries: readonly SessionEntry[],
): readonly IntegrationObservation[] {
  const evidence = new PiEntryEvidence(createPiEntryEvidenceRegistry());
  for (const entry of entries) evidence.read(entry);
  return evidence.observations();
}

function createPiEntryEvidenceRegistry(): EvidenceRegistry {
  const count =
    (key: string): EvidenceAdapter["read"] =>
    (value) => ({
      counters: { [key]: number(value[key] ?? 0) },
    });

  return createEvidenceRegistry([
    {
      integration: "context",
      version: SUPPORTED_SCHEMA_VERSION,
      read: count("calls"),
    },
    {
      integration: "rtk",
      version: SUPPORTED_SCHEMA_VERSION,
      read: (value) => ({
        counters: {
          compactions: number(value.compactions),
          sourceChars: number(value.sourceChars),
          compactedChars: number(value.compactedChars),
          sourceLines: number(value.sourceLines),
          compactedLines: number(value.compactedLines),
          truncated: value.truncated === true,
        },
      }),
    },
    {
      integration: "mode",
      version: SUPPORTED_SCHEMA_VERSION,
      read: count("changes"),
    },
    {
      integration: "permission",
      version: SUPPORTED_SCHEMA_VERSION,
      read: (value) => ({
        counters: {
          events: number(value.events),
          granted: number(value.granted),
        },
      }),
    },
    {
      integration: "lens",
      version: SUPPORTED_SCHEMA_VERSION,
      read: count("calls"),
    },
  ]);
}

class PiEntryEvidence {
  readonly #rows = new Map<IntegrationKey, IntegrationObservation>();

  constructor(private readonly registry: EvidenceRegistry) {}

  read(entry: SessionEntry): void {
    try {
      this.readCustom(entry);
      this.readRtk(entry);
      this.readLens(entry);
    } catch {
      // Pi input is untrusted; malformed entries provide no integration evidence.
    }
  }

  observations(): readonly IntegrationObservation[] {
    return OBSERVATION_ORDER.flatMap((integration) => {
      const row = this.#rows.get(integration);
      return row === undefined ? [] : [row];
    });
  }

  private readCustom(entry: SessionEntry): void {
    if (entry.type !== "custom" || typeof entry.customType !== "string") {
      return;
    }
    const version = schemaVersion(entry.data);
    if (version === undefined) return;

    if (entry.customType.startsWith("ctx_")) {
      this.add("context", version, { calls: 1 });
    } else if (MODE_CUSTOM_TYPES.has(entry.customType)) {
      this.add("mode", version, { changes: 1 });
    } else if (PERMISSION_CUSTOM_TYPES.has(entry.customType)) {
      const granted = booleanField(entry.data, "granted") === true ? 1 : 0;
      this.add("permission", version, { events: 1, granted });
    }
  }

  private readRtk(entry: SessionEntry): void {
    if (entry.type !== "message" || !isRecord(entry.message)) return;
    const details = entry.message.details;
    if (!isRecord(details) || !isRecord(details.rtkCompaction)) return;

    const compaction = details.rtkCompaction;
    const version = schemaVersion(compaction);
    if (version === undefined) return;
    this.add("rtk", version, {
      compactions: 1,
      sourceChars: nonNegativeNumber(compaction.sourceChars),
      compactedChars: nonNegativeNumber(compaction.compactedChars),
      sourceLines: nonNegativeNumber(compaction.sourceLines),
      compactedLines: nonNegativeNumber(compaction.compactedLines),
      truncated: booleanField(compaction, "truncated") === true,
    });
  }

  private readLens(entry: SessionEntry): void {
    if (entry.type !== "message" || !isRecord(entry.message)) return;
    const content = entry.message.content;
    if (!Array.isArray(content)) return;

    let calls = 0;
    for (const item of content) {
      if (isRecord(item) && item.type === "toolCall" && item.name === "lens") {
        calls++;
      }
    }
    if (calls > 0) this.add("lens", SUPPORTED_SCHEMA_VERSION, { calls });
  }

  private add(
    integration: IntegrationKey,
    version: number,
    counters: BoundedEvidenceValue,
  ): void {
    const prior = this.#rows.get(integration);
    if (prior?.state === "unsupported") return;
    if (prior !== undefined && prior.version !== version) {
      this.#rows.set(integration, unsupported(integration, version));
      return;
    }

    const result = this.registry.read({
      integration,
      version,
      value: counters,
    });
    if (result.state !== "supported") {
      this.#rows.set(integration, unsupported(integration, version));
      return;
    }

    const combined = mergeCounters(prior?.counters, result.counters);
    this.#rows.set(integration, {
      integration,
      version,
      state: "supported",
      ...(combined === undefined ? {} : { counters: combined }),
    });
  }
}

function mergeCounters(
  previous: IntegrationObservation["counters"],
  next: IntegrationObservation["counters"],
): BoundedEvidenceValue | undefined {
  if (previous === undefined) return next;
  if (next === undefined) return previous;

  const counters: Record<string, number | boolean> = { ...previous };
  for (const [key, value] of Object.entries(next)) {
    const prior = counters[key];
    counters[key] =
      typeof value === "number" && typeof prior === "number"
        ? prior + value
        : value === true || prior === true;
  }
  return counters;
}

function unsupported(
  integration: IntegrationKey,
  version: number,
): IntegrationObservation {
  return { integration, version, state: "unsupported" };
}

function schemaVersion(value: unknown): number | undefined {
  return isRecord(value) && isVersion(value.schemaVersion)
    ? value.schemaVersion
    : undefined;
}

function booleanField(value: unknown, key: string): boolean | undefined {
  return isRecord(value) && typeof value[key] === "boolean"
    ? value[key]
    : undefined;
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function number(value: number | boolean | undefined): number {
  return typeof value === "number" ? value : 0;
}

function isVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

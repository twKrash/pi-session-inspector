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
const MODE_CUSTOM_TYPES: Readonly<
  Record<
    string,
    {
      integration: "ponytail" | "caveman";
      field: string;
      values: ReadonlySet<string>;
    }
  >
> = {
  "ponytail-mode": {
    integration: "ponytail",
    field: "mode",
    values: new Set(["off", "lite", "full", "ultra", "review"]),
  },
  "caveman-level": {
    integration: "caveman",
    field: "level",
    values: new Set([
      "off",
      "lite",
      "full",
      "ultra",
      "wenyan-lite",
      "wenyan",
      "wenyan-ultra",
      "micro",
    ]),
  },
};
const OBSERVATION_ORDER = [
  "context",
  "rtk",
  "ponytail",
  "caveman",
  "permission",
  "lens",
] as const;
const PERMISSION_CUSTOM_TYPES = new Set([
  "permissions:ready",
  "permissions:ui_prompt",
  "permissions:decision",
]);

/** The two observation paths that can report one Context Mode invocation. */
type ContextEvidencePath = "custom" | "tool";

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
      read: (value) => {
        const counters = readRtkCounters(value);
        return counters === undefined ? undefined : { counters };
      },
    },
    {
      integration: "ponytail",
      version: SUPPORTED_SCHEMA_VERSION,
      read: count("changes"),
    },
    {
      integration: "caveman",
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
  readonly #contextCalls = new Map<ContextEvidencePath, number>();
  #contextVersion: number | undefined;
  #contextVersionConflict = false;

  constructor(private readonly registry: EvidenceRegistry) {}

  read(entry: SessionEntry): void {
    try {
      this.readCustom(entry);
      this.readRtk(entry);
      this.readToolCallEvidence(entry);
    } catch {
      // Pi input is untrusted; malformed entries provide no integration evidence.
    }
  }

  observations(): readonly IntegrationObservation[] {
    return OBSERVATION_ORDER.flatMap((integration) => {
      const row =
        integration === "context"
          ? this.contextObservation()
          : this.#rows.get(integration);
      return row === undefined ? [] : [row];
    });
  }

  /**
   * One Context Mode invocation can be observed through a `ctx_*` custom entry
   * and its native `ctx_*` tool call. The two paths are folded with a maximum
   * rather than a sum, so the same invocation is never counted twice while a
   * single-path observation keeps its exact count.
   */
  private contextObservation(): IntegrationObservation | undefined {
    const version = this.#contextVersion;
    if (version === undefined) return undefined;
    const calls = Math.max(...this.#contextCalls.values());
    const result = this.#contextVersionConflict
      ? ({ state: "unsupported" } as const)
      : this.registry.read({
          integration: "context",
          version,
          value: { calls },
        });
    if (result.state !== "supported") return unsupported("context", version);
    return {
      integration: "context",
      version,
      state: "supported",
      counters: result.counters,
    };
  }

  private recordContextCall(
    path: ContextEvidencePath,
    version: number,
    calls: number,
  ): void {
    if (this.#contextVersionConflict) return;
    if (this.#contextVersion === undefined) {
      this.#contextVersion = version;
    } else if (this.#contextVersion !== version) {
      this.#contextVersion = version;
      this.#contextVersionConflict = true;
      return;
    }
    this.#contextCalls.set(path, (this.#contextCalls.get(path) ?? 0) + calls);
  }

  private readCustom(entry: SessionEntry): void {
    if (entry.type !== "custom" || typeof entry.customType !== "string") {
      return;
    }
    const modeProducer = MODE_CUSTOM_TYPES[entry.customType];
    if (modeProducer !== undefined) {
      const value = isRecord(entry.data)
        ? entry.data[modeProducer.field]
        : undefined;
      if (typeof value === "string" && modeProducer.values.has(value)) {
        this.add(modeProducer.integration, SUPPORTED_SCHEMA_VERSION, {
          changes: 1,
        });
      }
      return;
    }
    const version = schemaVersion(entry.data);
    if (version === undefined) return;

    if (entry.customType.startsWith("ctx_")) {
      this.recordContextCall("custom", version, 1);
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
    const counters = readPersistedRtkCounters(compaction);
    if (counters === undefined) {
      this.#rows.set("rtk", unsupported("rtk", version));
      return;
    }
    this.add("rtk", version, counters);
  }

  private readToolCallEvidence(entry: SessionEntry): void {
    if (entry.type !== "message" || !isRecord(entry.message)) return;
    const content = entry.message.content;
    if (!Array.isArray(content)) return;

    // Context Mode evidence is native `ctx_*` tool use (never its arguments).
    let contextCalls = 0;
    let lensCalls = 0;
    for (const item of content) {
      if (
        !isRecord(item) ||
        item.type !== "toolCall" ||
        typeof item.name !== "string"
      ) {
        continue;
      }
      if (item.name === "lens") lensCalls++;
      else if (item.name.startsWith("ctx_")) contextCalls++;
    }
    if (contextCalls > 0) {
      this.recordContextCall("tool", SUPPORTED_SCHEMA_VERSION, contextCalls);
    }
    if (lensCalls > 0) {
      this.add("lens", SUPPORTED_SCHEMA_VERSION, { calls: lensCalls });
    }
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
    if (combined === undefined) {
      this.#rows.set(integration, unsupported(integration, version));
      return;
    }

    this.#rows.set(integration, {
      integration,
      version,
      state: "supported",
      counters: combined,
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

function readPersistedRtkCounters(
  value: Record<string, unknown>,
): BoundedEvidenceValue | undefined {
  const sourceChars = nonNegativeNumber(value.sourceChars);
  const compactedChars = nonNegativeNumber(value.compactedChars);
  const sourceLines = nonNegativeNumber(value.sourceLines);
  const compactedLines = nonNegativeNumber(value.compactedLines);
  const truncated = booleanField(value, "truncated");
  if (
    sourceChars === undefined ||
    compactedChars === undefined ||
    sourceLines === undefined ||
    compactedLines === undefined ||
    truncated === undefined
  ) {
    return undefined;
  }
  return {
    compactions: 1,
    sourceChars,
    compactedChars,
    sourceLines,
    compactedLines,
    truncated,
  };
}

function readRtkCounters(
  value: BoundedEvidenceValue,
): BoundedEvidenceValue | undefined {
  const required = [
    "compactions",
    "sourceChars",
    "compactedChars",
    "sourceLines",
    "compactedLines",
  ] as const;
  if (
    !required.every((key) => nonNegativeNumber(value[key]) !== undefined) ||
    typeof value.truncated !== "boolean"
  ) {
    return undefined;
  }
  return {
    compactions: value.compactions as number,
    sourceChars: value.sourceChars as number,
    compactedChars: value.compactedChars as number,
    sourceLines: value.sourceLines as number,
    compactedLines: value.compactedLines as number,
    truncated: value.truncated,
  };
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
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

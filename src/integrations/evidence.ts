import type {
  EvidenceState,
  IntegrationKey,
  IntegrationObservation,
} from "../core/events.ts";

const MAX_COUNTERS = 12;
const MAX_COUNTER_KEY_LENGTH = 48;
const TOKEN = /^[A-Za-z][A-Za-z0-9_-]*$/;

const INTEGRATION_ALIASES = {
  context: "context",
  ctx: "context",
  rtk: "rtk",
  mode: "mode",
  permission: "permission",
  subagents: "subagents",
  lens: "lens",
} as const satisfies Record<string, IntegrationKey>;

export type BoundedEvidenceValue = Readonly<Record<string, number | boolean>>;

export type EvidenceAdapter = {
  integration: IntegrationKey;
  version: number;
  read(
    value: BoundedEvidenceValue,
  ): { counters?: BoundedEvidenceValue } | undefined;
};

export type EvidenceResult =
  | IntegrationObservation
  | { state: "unavailable" }
  | {
      state: "unsupported";
      diagnostic:
        | "invalid-evidence"
        | "unsupported-version"
        | "adapter-rejected";
    };

export type EvidenceRegistry = {
  read(input: unknown): EvidenceResult;
};

/**
 * Validates explicit local integration evidence before a versioned adapter sees it.
 * Values deliberately admit only bounded numeric/boolean state, never producer text.
 */
export function createEvidenceRegistry(
  adapters: readonly EvidenceAdapter[],
): EvidenceRegistry {
  const registered = new Map<string, EvidenceAdapter>();
  for (const adapter of adapters) {
    if (isAdapter(adapter)) {
      registered.set(adapterKey(adapter.integration, adapter.version), adapter);
    }
  }

  return {
    read(input: unknown): EvidenceResult {
      try {
        if (input === undefined || input === null)
          return { state: "unavailable" };
        if (!isEvidenceInput(input)) return invalidEvidence();

        const integration = normalizeIntegration(input.integration);
        if (integration === undefined || !isVersion(input.version)) {
          return invalidEvidence();
        }
        const value = toBoundedValue(input.value);
        if (value === undefined) return invalidEvidence();

        const adapter = registered.get(adapterKey(integration, input.version));
        if (adapter === undefined) {
          return { state: "unsupported", diagnostic: "unsupported-version" };
        }

        const output = adapter.read(value);
        const counters = output?.counters;
        if (
          output === undefined ||
          (counters !== undefined && !isBoundedValue(counters))
        ) {
          return { state: "unsupported", diagnostic: "adapter-rejected" };
        }
        const observation: IntegrationObservation = {
          integration,
          version: input.version,
          state: "supported",
        };
        if (counters !== undefined) observation.counters = counters;
        return observation;
      } catch {
        return { state: "unsupported", diagnostic: "adapter-rejected" };
      }
    },
  };
}

function isAdapter(adapter: EvidenceAdapter): boolean {
  return (
    normalizeIntegration(adapter.integration) === adapter.integration &&
    isVersion(adapter.version) &&
    typeof adapter.read === "function"
  );
}

function isEvidenceInput(value: unknown): value is Record<string, unknown> {
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === 3 &&
    keys.every(
      (key) => key === "integration" || key === "version" || key === "value",
    )
  );
}

function normalizeIntegration(value: unknown): IntegrationKey | undefined {
  return typeof value === "string"
    ? INTEGRATION_ALIASES[value as keyof typeof INTEGRATION_ALIASES]
    : undefined;
}

function toBoundedValue(value: unknown): BoundedEvidenceValue | undefined {
  return isBoundedValue(value) ? value : undefined;
}

function isBoundedValue(value: unknown): value is BoundedEvidenceValue {
  if (!isPlainRecord(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= MAX_COUNTERS &&
    entries.every(
      ([key, counter]) =>
        key.length <= MAX_COUNTER_KEY_LENGTH &&
        TOKEN.test(key) &&
        (typeof counter === "boolean" ||
          (typeof counter === "number" &&
            Number.isFinite(counter) &&
            counter >= 0 &&
            counter <= Number.MAX_SAFE_INTEGER)),
    )
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(Object.getOwnPropertyDescriptors(value)).every(
    (descriptor) => descriptor.enumerable === false || "value" in descriptor,
  );
}

function isVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function adapterKey(integration: IntegrationKey, version: number): string {
  return `${integration}:${version}`;
}

function invalidEvidence(): EvidenceResult {
  return { state: "unsupported", diagnostic: "invalid-evidence" };
}

export type { EvidenceState, IntegrationKey, IntegrationObservation };

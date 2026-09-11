import { isAllowedIntegrationCounter } from "../core/integration-counter-allowlists.ts";
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
  ponytail: "ponytail",
  caveman: "caveman",
  mode: "mode",
  permission: "permission",
  subagents: "subagents",
  lens: "lens",
} as const satisfies Record<string, IntegrationKey | "mode">;

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
        const evidenceInput = materializeOwnDataProperties(input);
        if (evidenceInput === undefined || !isEvidenceInput(evidenceInput)) {
          return invalidEvidence();
        }

        const integration = normalizeIntegration(evidenceInput.integration);
        if (
          integration === undefined ||
          integration === "mode" ||
          !isVersion(evidenceInput.version)
        ) {
          return invalidEvidence();
        }
        const value = toBoundedValue(evidenceInput.value);
        if (value === undefined) return invalidEvidence();

        const adapter = registered.get(
          adapterKey(integration, evidenceInput.version),
        );
        if (adapter === undefined) {
          return { state: "unsupported", diagnostic: "unsupported-version" };
        }

        const output = toAdapterOutput(
          adapter.read(value),
          integration,
          evidenceInput.version,
        );
        if (output === undefined) return adapterRejected();

        const observation: IntegrationObservation = {
          integration,
          version: evidenceInput.version,
          state: "supported",
        };
        if (output.counters !== undefined) {
          observation.counters = snapshotCounters(output.counters);
        }
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

function isEvidenceInput(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === 3 &&
    keys.every(
      (key) => key === "integration" || key === "version" || key === "value",
    )
  );
}

function normalizeIntegration(
  value: unknown,
): IntegrationKey | "mode" | undefined {
  return typeof value === "string"
    ? INTEGRATION_ALIASES[value as keyof typeof INTEGRATION_ALIASES]
    : undefined;
}

function toBoundedValue(value: unknown): BoundedEvidenceValue | undefined {
  const snapshot = materializeOwnDataProperties(value);
  return snapshot !== undefined && isBoundedValue(snapshot)
    ? (snapshot as BoundedEvidenceValue)
    : undefined;
}

function isBoundedValue(value: Record<string, unknown>): boolean {
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

function toAdapterOutput(
  value: unknown,
  integration: IntegrationKey,
  version: number,
): { counters?: BoundedEvidenceValue } | undefined {
  const output = materializeOwnDataProperties(value);
  if (output === undefined) return undefined;
  const keys = Object.keys(output);
  if (keys.length > 1 || !keys.every((key) => key === "counters")) {
    return undefined;
  }
  if (output.counters === undefined) return {};

  const counters = toBoundedValue(output.counters);
  if (
    counters === undefined ||
    !Object.keys(counters).every((key) =>
      isAllowedIntegrationCounter(integration, version, key),
    )
  ) {
    return undefined;
  }
  return { counters };
}

function snapshotCounters(value: BoundedEvidenceValue): BoundedEvidenceValue {
  return Object.freeze({ ...value });
}

/**
 * Takes a single descriptor-based snapshot so a Proxy cannot change values after
 * structural validation but before an adapter or validator consumes them.
 */
function materializeOwnDataProperties(
  value: unknown,
): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const snapshot: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") return undefined;
    const descriptor = descriptors[key];
    if (descriptor?.enumerable !== true || !("value" in descriptor)) {
      return undefined;
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
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

function adapterRejected(): EvidenceResult {
  return { state: "unsupported", diagnostic: "adapter-rejected" };
}

export type { EvidenceState, IntegrationKey, IntegrationObservation };

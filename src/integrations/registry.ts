import type {
  IntegrationObservationInput,
  IntegrationPresence,
  IntegrationRowKey,
} from "../core/events.ts";
import type {
  CanonicalIntegrationContext,
  CanonicalIntegrationContribution,
  IntegrationAdapter,
  IntegrationEvidence,
  IntegrationEvidenceReason,
  IntegrationPresenceReason,
  IntegrationRegistration,
  AppliedTelemetryFold,
  IntegrationTelemetryFold,
  LiveIntegrationContext,
  PersistedEvidenceContext,
  PresenceContext,
} from "./contract.ts";

/** Bounded integration key grammar; a producer value never gets past this. */
const KEY_TOKEN = /^[a-z][a-z0-9-]{0,31}$/;
/** Counter names the evidence and folded-counter boundaries accept. */
const COUNTER_TOKEN = /^[A-Za-z][A-Za-z0-9_-]{0,47}$/;

export type IntegrationPresenceResult<K extends string = string> = {
  presence: Record<K, IntegrationPresence>;
  reasons: Record<K, IntegrationPresenceReason>;
};

export type IntegrationPersistedResult = {
  rows: IntegrationObservationInput[];
  reasons: Record<string, IntegrationEvidenceReason>;
};

export type IntegrationLiveRegistration = IntegrationRegistration & {
  /** Registrations that failed; a failed adapter still leaves the rest live. */
  failures(): number;
};

export type IntegrationContributionResult = {
  contributions: Record<string, CanonicalIntegrationContribution>;
  reasons: Record<string, IntegrationEvidenceReason>;
};

export type IntegrationRegistry<K extends string = string> = {
  /** Non-legacy keys in report order. */
  readonly keys: readonly K[];
  /** Every validated key, legacy-only keys included. */
  readonly rowKeys: readonly string[];
  has(key: string): boolean;
  resolveAlias(value: string): K | undefined;
  isKnownVersion(key: string, version: number): boolean;
  isAllowedCounter(key: string, version: number, counter: string): boolean;
  /** Lowest declared schema version; the version folded counters are published under. */
  primaryVersion(key: string): number | undefined;
  readPresence(context: PresenceContext): IntegrationPresenceResult<K>;
  readPersistedEvidence(
    context: PersistedEvidenceContext,
  ): IntegrationPersistedResult;
  registerLive(context: LiveIntegrationContext): IntegrationLiveRegistration;
  foldTelemetry(envelope: unknown): AppliedTelemetryFold | undefined;
  contributeCanonical(
    context: CanonicalIntegrationContext,
  ): Promise<IntegrationContributionResult>;
};

/** Keys of every non-legacy adapter in the list; legacy keys validate only. */
export type RegisteredIntegrationKeys<T extends readonly IntegrationAdapter[]> =
  T[number] extends infer A
    ? A extends { readonly legacyOnly: true }
      ? never
      : A extends { readonly key: infer K extends string }
        ? K
        : never
    : never;

type RegisteredEntry = {
  adapter: IntegrationAdapter;
  aliases: readonly string[];
};

/**
 * Validates a trusted, statically registered adapter list once and derives
 * every generic view from it: keys, report order, presence defaults, schema and
 * counter validation, aliases, persisted evidence, live registration, telemetry
 * folding, and canonical contribution.
 *
 * Construction rejects defects the developer controls (duplicate key/order,
 * malformed schema, colliding alias). Every per-adapter call is fault-isolated:
 * a throwing adapter degrades only its own row and never aborts the others.
 */
export function createIntegrationRegistry<
  const T extends readonly IntegrationAdapter[],
>(adapters: T): IntegrationRegistry<RegisteredIntegrationKeys<T>> {
  const entries: RegisteredEntry[] = [];
  const keys = new Set<string>();
  const orders = new Set<number>();

  for (const adapter of adapters) {
    if (typeof adapter.key !== "string" || !KEY_TOKEN.test(adapter.key)) {
      throw new Error(`invalid integration key: ${String(adapter.key)}`);
    }
    if (
      !Number.isSafeInteger(adapter.order) ||
      adapter.order < 0 ||
      adapter.order > 4096
    ) {
      throw new Error(
        `invalid integration order: ${String(adapter.order)} for ${adapter.key}`,
      );
    }
    if (keys.has(adapter.key)) {
      throw new Error(`duplicate integration key: ${adapter.key}`);
    }
    if (orders.has(adapter.order)) {
      throw new Error(`duplicate integration order: ${adapter.order}`);
    }
    keys.add(adapter.key);
    orders.add(adapter.order);
    validateSchemas(adapter);
    entries.push({ adapter, aliases: adapter.aliases ?? [] });
  }

  const aliases = new Map<string, string>();
  for (const entry of entries) {
    for (const alias of entry.aliases) {
      if (entry.adapter.legacyOnly === true) {
        throw new Error(
          `legacy-only integration cannot own an alias: ${alias}`,
        );
      }
      if (typeof alias !== "string" || !KEY_TOKEN.test(alias)) {
        throw new Error(`invalid integration alias: ${String(alias)}`);
      }
      if (keys.has(alias)) {
        throw new Error(`alias collides with an integration key: ${alias}`);
      }
      if (aliases.has(alias)) {
        throw new Error(`duplicate integration alias: ${alias}`);
      }
      aliases.set(alias, entry.adapter.key);
    }
  }

  const ordered = [...entries].sort(
    (left, right) => left.adapter.order - right.adapter.order,
  );
  const rowKeys = ordered.map((entry) => entry.adapter.key);
  const reportKeys = ordered
    .filter((entry) => entry.adapter.legacyOnly !== true)
    .map((entry) => entry.adapter.key);
  const byKey = new Map(entries.map((entry) => [entry.adapter.key, entry]));

  const registry: IntegrationRegistry<RegisteredIntegrationKeys<T>> = {
    keys: reportKeys as RegisteredIntegrationKeys<T>[],
    rowKeys,
    has: (key) => byKey.has(key),
    resolveAlias: (value) => {
      const entry = byKey.get(value);
      // A legacy-only key validates rows; it is never a resolvable report key.
      if (entry !== undefined && entry.adapter.legacyOnly !== true) {
        return value as RegisteredIntegrationKeys<T>;
      }
      const target = aliases.get(value);
      return target === undefined
        ? undefined
        : (target as RegisteredIntegrationKeys<T>);
    },
    isKnownVersion: (key, version) =>
      byKey.get(key)?.adapter.schemas[version] !== undefined,
    isAllowedCounter: (key, version, counter) =>
      byKey.get(key)?.adapter.schemas[version]?.counters.includes(counter) ??
      false,
    primaryVersion: (key) => {
      const versions = Object.keys(byKey.get(key)?.adapter.schemas ?? {}).map(
        Number,
      );
      return versions.length === 0 ? undefined : Math.min(...versions);
    },
    readPresence(context) {
      const presence: Record<string, IntegrationPresence> = {};
      const reasons: Record<string, IntegrationPresenceReason> = {};
      // A live or durably folded sighting is generic state: it is the strongest
      // signal because it is an observation, not an inventory inference.
      const observed = new Set(context.observed);
      for (const key of reportKeys) {
        if (observed.has(key)) {
          presence[key] = "present";
          reasons[key] = "live-signal";
          continue;
        }
        const adapter = byKey.get(key)?.adapter;
        if (adapter?.detectPresence === undefined) {
          presence[key] = "unknown";
          reasons[key] = "not-observed";
          continue;
        }
        try {
          const signal = adapter.detectPresence(context);
          // `absent` needs a readable inventory; otherwise the signal is
          // merely unobserved and the row stays `unknown`.
          presence[key] =
            signal === "absent" && !context.inventoryAvailable
              ? "unknown"
              : signal;
          reasons[key] = "inventory-signal";
        } catch {
          presence[key] = "unknown";
          reasons[key] = "presence-failed";
        }
      }
      return { presence, reasons };
    },
    readPersistedEvidence(context) {
      const rows: IntegrationObservationInput[] = [];
      const reasons: Record<string, IntegrationEvidenceReason> = {};
      for (const key of reportKeys) {
        const adapter = byKey.get(key)?.adapter;
        if (adapter?.readPersistedEvidence === undefined) continue;
        let result: IntegrationEvidence | undefined;
        try {
          result = adapter.readPersistedEvidence(context);
        } catch {
          reasons[key] = "evidence-failed";
          continue;
        }
        if (result === undefined) {
          // No persisted evidence is a reason, not a silence: the UAT surface
          // must be able to tell 'no evidence' from 'not read'.
          reasons[key] = "no-persisted-evidence";
          continue;
        }
        const row = toObservationRow(registry, key, result, reasons);
        if (row !== undefined) rows.push(row);
      }
      return { rows, reasons };
    },
    registerLive(context) {
      const disposers: Array<() => void> = [];
      let failures = 0;
      for (const entry of ordered) {
        const register = entry.adapter.registerLive;
        if (register === undefined) continue;
        try {
          const registration = register.call(entry.adapter, context);
          if (registration !== undefined)
            disposers.push(() => registration.dispose());
        } catch {
          failures += 1;
        }
      }
      let disposed = false;
      return {
        failures: () => failures,
        dispose() {
          if (disposed) return;
          disposed = true;
          for (const dispose of disposers.splice(0)) {
            try {
              dispose();
            } catch {
              // Disposal failures are observer-only.
            }
          }
        },
      };
    },
    foldTelemetry(envelope) {
      for (const entry of ordered) {
        const fold = entry.adapter.foldTelemetry;
        if (fold === undefined) continue;
        let value: IntegrationTelemetryFold | undefined;
        try {
          value = fold.call(entry.adapter, envelope);
        } catch {
          // A failing fold yields no counters rather than a partial one, and
          // never blocks the next adapter's fold.
          value = undefined;
        }
        // The registry stamps the identity: a caller never has to guess which
        // integration a folded metric belongs to, and an adapter cannot claim
        // another integration's key.
        if (value !== undefined) {
          return { integration: entry.adapter.key, ...value };
        }
      }
      return undefined;
    },
    async contributeCanonical(context) {
      const contributions: Record<string, CanonicalIntegrationContribution> =
        {};
      const reasons: Record<string, IntegrationEvidenceReason> = {};
      for (const key of reportKeys) {
        const adapter = byKey.get(key)?.adapter;
        if (adapter?.contributeCanonical === undefined) continue;
        try {
          const contribution = await adapter.contributeCanonical(context);
          if (contribution !== undefined) contributions[key] = contribution;
        } catch {
          reasons[key] = "contribution-failed";
        }
      }
      return { contributions, reasons };
    },
  };

  return registry;
}

/** Converts one adapter result into a publishable row, or drops it. */
function toObservationRow(
  registry: IntegrationRegistry,
  key: string,
  result: IntegrationEvidence,
  reasons: Record<string, IntegrationEvidenceReason>,
): IntegrationObservationInput | undefined {
  if (result.integration !== key) {
    reasons[key] = "malformed-evidence";
    return undefined;
  }
  const version = result.version;
  if (version !== undefined && !isVersion(version)) {
    reasons[key] = "malformed-evidence";
    return undefined;
  }
  // `key` was accepted by `registry.has` at the call site, so it is already a
  // registry-validated key. `core/events.ts` still narrows row keys to the
  // shipped union in this commit; the adapters land the open key boundary.
  const rowKey = key as IntegrationRowKey;
  if (result.state === "supported") {
    // A supported result must name a declared version and counters inside that
    // version's allowlist. A violation is reported as `unsupported` (never a
    // silently trimmed counter set), which is what the Pi-entry readers did.
    if (
      version === undefined ||
      !registry.isKnownVersion(key, version) ||
      !hasAllowedCounters(registry, key, version, result.counters)
    ) {
      reasons[key] = "unsupported-schema";
      return {
        integration: rowKey,
        ...(version === undefined ? {} : { version }),
        state: "unsupported",
      };
    }
    reasons[key] = result.reason;
    return {
      integration: rowKey,
      version,
      state: "supported",
      counters: { ...result.counters },
    };
  }
  if (result.state === "unsupported") {
    // An unsupported row may name the version the producer claimed, which can
    // be a version this adapter does not declare: that is the report.
    reasons[key] = result.reason;
    return {
      integration: rowKey,
      ...(version === undefined ? {} : { version }),
      state: "unsupported",
    };
  }
  reasons[key] = result.reason;
  return {
    integration: rowKey,
    ...(version === undefined ? {} : { version }),
    state: "unavailable",
  };
}

function hasAllowedCounters(
  registry: IntegrationRegistry,
  key: string,
  version: number,
  counters: Readonly<Record<string, number | boolean>> | undefined,
): boolean {
  if (counters === undefined) return false;
  const names = Object.keys(counters);
  if (names.length === 0) return false;
  return names.every(
    (name) =>
      registry.isAllowedCounter(key, version, name) &&
      isCounterValue(counters[name]),
  );
}

function isCounterValue(value: unknown): value is number | boolean {
  return (
    typeof value === "boolean" ||
    (typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0 &&
      value <= Number.MAX_SAFE_INTEGER)
  );
}

function validateSchemas(adapter: IntegrationAdapter): void {
  const versions = Object.keys(adapter.schemas ?? {});
  if (versions.length === 0) {
    throw new Error(`${adapter.key} needs at least one schema version`);
  }
  for (const raw of versions) {
    const version = Number(raw);
    if (!isVersion(version)) {
      throw new Error(`invalid schema version: ${raw} for ${adapter.key}`);
    }
    const counters = adapter.schemas[version]?.counters;
    if (!Array.isArray(counters)) {
      throw new Error(`invalid counter list for ${adapter.key} v${version}`);
    }
    const seen = new Set<string>();
    for (const counter of counters) {
      if (typeof counter !== "string" || !COUNTER_TOKEN.test(counter)) {
        throw new Error(
          `invalid counter name: ${String(counter)} for ${adapter.key}`,
        );
      }
      if (seen.has(counter)) {
        throw new Error(`duplicate counter: ${counter} for ${adapter.key}`);
      }
      seen.add(counter);
    }
  }
}

function isVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

import type { Integration } from "./contract.ts";

/**
 * Integration catalog: definition validation and lookup only.
 *
 * The catalog knows what an integration *is*; it never performs an operation
 * on one. Presence, persisted evidence, live registration, telemetry folding,
 * and canonical contributions are each iterated by the subsystem that owns
 * that operation (see `presence.ts`, `persisted.ts`, `live-counters.ts`,
 * `core/live-counter-fold.ts`, `contributions.ts`).
 */

/** Bounded integration key grammar; a producer value never gets past this. */
const KEY_TOKEN = /^[a-z][a-z0-9-]{0,31}$/;
/** Counter names the evidence and folded-counter boundaries accept. */
const COUNTER_TOKEN = /^[A-Za-z][A-Za-z0-9_-]{0,47}$/;

/**
 * Validates one integration definition and preserves its literal key, so a
 * consumer can name a catalog key without a hand-maintained union. The checks
 * are the ones the definition author controls; producer input is validated at
 * the subsystem boundaries instead.
 */
export function defineIntegration<const T extends Integration>(
  integration: T,
): T {
  if (typeof integration.key !== "string" || !KEY_TOKEN.test(integration.key)) {
    throw new Error(`invalid integration key: ${String(integration.key)}`);
  }
  const versions = Object.keys(integration.schemas ?? {});
  if (versions.length === 0) {
    throw new Error(`${integration.key} needs at least one schema version`);
  }
  for (const raw of versions) {
    const version = Number(raw);
    if (!isVersion(version)) {
      throw new Error(`invalid schema version: ${raw} for ${integration.key}`);
    }
    const counters = integration.schemas[version]?.counters;
    if (!Array.isArray(counters)) {
      throw new Error(`invalid counter list for ${integration.key} v${version}`);
    }
    const seen = new Set<string>();
    for (const counter of counters) {
      if (typeof counter !== "string" || !COUNTER_TOKEN.test(counter)) {
        throw new Error(
          `invalid counter name: ${String(counter)} for ${integration.key}`,
        );
      }
      if (seen.has(counter)) {
        throw new Error(
          `duplicate counter: ${counter} for ${integration.key}`,
        );
      }
      seen.add(counter);
    }
  }
  for (const alias of integration.aliases ?? []) {
    if (typeof alias !== "string" || !KEY_TOKEN.test(alias)) {
      throw new Error(`invalid integration alias: ${String(alias)}`);
    }
    if (alias === integration.key) {
      throw new Error(`alias collides with an integration key: ${alias}`);
    }
    if (integration.legacyOnly === true) {
      throw new Error(`legacy-only integration cannot own an alias: ${alias}`);
    }
  }
  return integration;
}

/**
 * Declares which integrations Inspector supports, in report order, and rejects
 * the collection-level defects a definition cannot see: duplicate keys, an
 * alias that collides with another key or alias, and behavior hooks on a
 * legacy-only integration.
 */
export function defineIntegrations<const T extends readonly Integration[]>(
  integrations: T,
): T {
  // Every key is known before any alias is judged, so an alias may not shadow
  // a key that is declared later in the list.
  const keys = new Set<string>();
  for (const integration of integrations) {
    if (keys.has(integration.key)) {
      throw new Error(`duplicate integration key: ${integration.key}`);
    }
    keys.add(integration.key);
    if (integration.legacyOnly === true && integration.hooks !== undefined) {
      throw new Error(
        `legacy-only integration cannot own hooks: ${integration.key}`,
      );
    }
  }
  const aliases = new Set<string>();
  for (const integration of integrations) {
    for (const alias of integration.aliases ?? []) {
      if (keys.has(alias) || aliases.has(alias)) {
        throw new Error(`alias collides with an integration key: ${alias}`);
      }
      aliases.add(alias);
    }
  }
  return Object.freeze(integrations) as T;
}

/** The integrations that own a report row and presence entry, in order. */
export function reportIntegrations(
  integrations: readonly Integration[],
): readonly Integration[] {
  return integrations.filter(
    (integration) => integration.legacyOnly !== true,
  );
}

/**
 * Every key that may validate a row: report keys plus the legacy-only keys that
 * exist only to keep historical evidence readable.
 */
export function rowKeys(integrations: readonly Integration[]): readonly string[] {
  return integrations.map((integration) => integration.key);
}

export function findIntegration(
  integrations: readonly Integration[],
  key: string,
): Integration | undefined {
  return integrations.find((integration) => integration.key === key);
}

/**
 * Resolves a key or one of its registered aliases to a report key. A
 * legacy-only key validates rows but never resolves here, so a historical key
 * can never be reintroduced as a live integration reference.
 */
export function resolveIntegrationKey(
  integrations: readonly Integration[],
  value: string,
): string | undefined {
  const direct = findIntegration(integrations, value);
  if (direct !== undefined) {
    return direct.legacyOnly === true ? undefined : direct.key;
  }
  for (const integration of integrations) {
    if (integration.legacyOnly === true) continue;
    if ((integration.aliases ?? []).includes(value)) return integration.key;
  }
  return undefined;
}

export function isKnownIntegrationVersion(
  integrations: readonly Integration[],
  key: string,
  version: number,
): boolean {
  return findIntegration(integrations, key)?.schemas[version] !== undefined;
}

export function isAllowedIntegrationCounter(
  integrations: readonly Integration[],
  key: string,
  version: number,
  counter: string,
): boolean {
  return (
    findIntegration(integrations, key)?.schemas[version]?.counters.includes(
      counter,
    ) ?? false
  );
}

/** Every counter name a key/version declares; `undefined` when undeclared. */
export function integrationCounters(
  integrations: readonly Integration[],
  key: string,
  version: number,
): readonly string[] | undefined {
  return findIntegration(integrations, key)?.schemas[version]?.counters;
}

/** The lowest declared schema version; the version folded counters use. */
export function primaryVersion(
  integrations: readonly Integration[],
  key: string,
): number | undefined {
  const integration = findIntegration(integrations, key);
  if (integration === undefined) return undefined;
  const versions = Object.keys(integration.schemas).map(Number);
  return versions.length === 0 ? undefined : Math.min(...versions);
}

function isVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

import type { IntegrationPresence } from "../core/events.ts";
import type { FoldedCounters } from "../core/live-counter-fold.ts";
import type { IntegrationKey } from "../integrations/index.ts";
import { integrations } from "../integrations/index.ts";
import type { InventorySnapshot } from "../integrations/inventory.ts";

/**
 * Process-local evidence handed to a report loader. Counters are always the
 * **effective** bucket (`merge(checkpointAggregates, deltaCounters)`) and
 * `presence` always carries the explicit per-key presence model, so a report
 * read never needs to touch (or write) durable state.
 *
 * `inventory` carries the sanitized `InventorySnapshot` read at session start
 * (or on a reload), so the projection has bounded evidence without touching
 * durable state again.
 */
export type SessionObservation = {
  inventory?: InventorySnapshot;
  presence: Readonly<Record<string, IntegrationPresence>>;
  counters?: FoldedCounters;
};

const INTEGRATION_KEYS: readonly IntegrationKey[] = integrations.map(
  (integration) => integration.key,
);

/** No observation yet: every key is explicitly unknown, never absent. */
export function emptyObservation(): SessionObservation {
  const presence: Record<string, IntegrationPresence> = {};
  for (const key of INTEGRATION_KEYS) presence[key] = "unknown";
  return { presence };
}

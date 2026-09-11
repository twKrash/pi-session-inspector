import type { IntegrationKey, IntegrationPresence } from "../core/events.ts";
import type { FoldedCounters } from "../core/live-counter-fold.ts";
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
  presence: Readonly<Record<IntegrationKey, IntegrationPresence>>;
  counters?: FoldedCounters;
};

const INTEGRATION_KEYS: readonly IntegrationKey[] = [
  "context",
  "rtk",
  "ponytail",
  "caveman",
  "permission",
  "subagents",
  "lens",
];

/** No observation yet: every key is explicitly unknown, never absent. */
export function emptyObservation(): SessionObservation {
  const presence = {} as Record<IntegrationKey, IntegrationPresence>;
  for (const key of INTEGRATION_KEYS) presence[key] = "unknown";
  return { presence };
}

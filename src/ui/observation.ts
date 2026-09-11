import type { IntegrationKey, IntegrationPresence } from "../core/events.ts";
import type { FoldedCounters } from "../core/live-counter-fold.ts";

/**
 * Process-local evidence handed to a report loader. Counters are always the
 * **effective** bucket (`merge(checkpointAggregates, deltaCounters)`) and
 * `presence` always carries the explicit per-key presence model, so a report
 * read never needs to touch (or write) durable state.
 *
 * `inventory` is deliberately opaque here: Task 7 defines the sanitized
 * `InventorySnapshot` in `src/integrations/inventory.ts` and later tasks narrow
 * this field to it. Task 6 must not depend on a module that does not exist yet.
 */
export type SessionObservation = {
  inventory?: unknown;
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

import { defineIntegration } from "../catalog.ts";

/**
 * The legacy `mode` row: earlier Inspector versions published one `mode`
 * integration, and persisted WAL/checkpoint aggregates still carry it. The key
 * validates like any other so old data keeps projecting, but it never gets a
 * report row, a presence entry, or behavior hooks.
 */
export const legacyModeIntegration = defineIntegration({
  key: "mode",
  legacyOnly: true,
  schemas: { 1: { counters: ["changes"] } },
});

import {
  cavemanIntegration,
  contextIntegration,
  legacyModeIntegration,
  lensIntegration,
  permissionIntegration,
  ponytailIntegration,
  rtkIntegration,
  subagentsIntegration,
} from "./adapters/index.ts";
import { defineIntegrations } from "./catalog.ts";

/**
 * Which integrations Inspector supports, in report order.
 *
 * This list is the single registration point and the order contract: adding an
 * integration is one definition file, one line here, its tests, and one
 * `docs/integrations.md` row. No hardcoded integration list exists in reports,
 * retention, canonical projection, telemetry folding, observation, or the UI.
 */
export const integrations = defineIntegrations([
  contextIntegration,
  rtkIntegration,
  ponytailIntegration,
  cavemanIntegration,
  permissionIntegration,
  subagentsIntegration,
  lensIntegration,
  legacyModeIntegration,
]);

/** Trusted integration keys, derived from the declaration above. */
export type IntegrationKey = (typeof integrations)[number]["key"];

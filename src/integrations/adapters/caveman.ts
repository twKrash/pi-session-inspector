import { createModeIntegration } from "./mode-custom.ts";

/**
 * Caveman presence is the `caveman` extension command; its evidence is the
 * bounded level value of each `caveman-level` custom entry. Presence and
 * evidence stay independent, exactly as for Ponytail.
 */
export const cavemanIntegration = createModeIntegration({
  key: "caveman",
  customType: "caveman-level",
  field: "level",
  values: [
    "off",
    "lite",
    "full",
    "ultra",
    "wenyan-lite",
    "wenyan",
    "wenyan-ultra",
    "micro",
  ],
  command: "caveman",
});

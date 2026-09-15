import { createModeIntegration } from "./mode-custom.ts";

/**
 * Ponytail presence is the `ponytail` extension command; its evidence is the
 * bounded mode value of each `ponytail-mode` custom entry. Presence and
 * evidence stay independent: a present Ponytail with no mode entry yet is
 * `Present / Unavailable`, never a fabricated count.
 */
export const ponytailIntegration = createModeIntegration({
  key: "ponytail",
  customType: "ponytail-mode",
  field: "mode",
  values: ["off", "lite", "full", "ultra", "review"],
  command: "ponytail",
});

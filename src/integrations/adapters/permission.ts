import { defineIntegration } from "../catalog.ts";

/**
 * Permission has no inventory signal of its own: its presence comes from the
 * generic live/durable observation a `permissions:ready` sighting records, so
 * this adapter declares no `detectPresence` and its row is never inferred
 * `absent` from a missing bus. Its v1 counter contract is the public bus
 * vocabulary.
 */
export const permissionIntegration = defineIntegration({
  key: "permission",
  schemas: {
    1: {
      counters: [
        "decisions",
        "allowed",
        "denied",
        "prompts",
        "promptToolCall",
        "promptSkillInput",
        "promptSkillRead",
        "gateErrors",
      ],
    },
  },
});

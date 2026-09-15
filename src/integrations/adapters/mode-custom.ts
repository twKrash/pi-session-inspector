import { defineIntegration } from "../catalog.ts";
import type { IntegrationEvidence } from "../contract.ts";
import { isRecord } from "./shared.ts";

/**
 * A mode-style integration: presence is the extension command of the same name,
 * and evidence is one custom entry per mode change whose bounded mode value is
 * in the integration's closed vocabulary.
 */
export function createModeIntegration<const K extends string>(options: {
  key: K;
  customType: string;
  field: string;
  values: readonly string[];
  command: string;
}) {
  const vocabulary = new Set(options.values);
  return defineIntegration({
    key: options.key,
    schemas: { 1: { counters: ["changes"] } },
    hooks: {
      presence: ({ extensionCommands }) =>
        extensionCommands.includes(options.command) ? "present" : "absent",
      persisted: ({ entries }) => {
        let changes = 0;
        for (const entry of entries) {
          if (
            entry.type !== "custom" ||
            entry.customType !== options.customType
          ) {
            continue;
          }
          const value = isRecord(entry.data)
            ? entry.data[options.field]
            : undefined;
          if (typeof value === "string" && vocabulary.has(value)) changes += 1;
        }
        if (changes === 0) return undefined;
        return {
          integration: options.key,
          state: "supported",
          version: 1,
          counters: { changes },
          reason: "evidence-supported",
        } satisfies IntegrationEvidence;
      },
    },
  });
}

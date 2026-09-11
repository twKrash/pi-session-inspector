import type { IntegrationKey, IntegrationPresence } from "../core/events.ts";

export type PresenceSignals = {
  /**
   * Names of `source === "extension"` commands only. Skill/prompt rows may
   * share a name with an extension (for example a `skill:ponytail`), so the
   * caller must filter by source before signalling presence.
   */
  extensionCommands: readonly string[];
  tools: readonly string[];
  permissionsReady: boolean;
  inventoryAvailable: boolean;
};

type Signal = (input: PresenceSignals) => boolean;

const SIGNALS: Partial<Record<IntegrationKey, Signal>> = {
  ponytail: ({ extensionCommands }) => extensionCommands.includes("ponytail"),
  caveman: ({ extensionCommands }) => extensionCommands.includes("caveman"),
  context: ({ tools }) => tools.some((tool) => tool.startsWith("ctx_")),
  subagents: ({ tools }) =>
    tools.some((tool) =>
      ["subagent", "subagent_wait", "subagent_supervisor"].includes(tool),
    ),
  lens: ({ tools }) =>
    tools.some(
      (tool) =>
        tool.startsWith("lens_") ||
        tool.startsWith("pi_lens_") ||
        tool.startsWith("lsp_") ||
        tool.startsWith("ast_grep"),
    ),
};

export function readIntegrationPresence(
  input: PresenceSignals,
): Record<IntegrationKey, IntegrationPresence> {
  const keys: IntegrationKey[] = [
    "context",
    "rtk",
    "ponytail",
    "caveman",
    "permission",
    "subagents",
    "lens",
  ];
  const rows = {} as Record<IntegrationKey, IntegrationPresence>;
  for (const key of keys) {
    if (key === "permission") {
      rows[key] = input.permissionsReady ? "present" : "unknown";
      continue;
    }
    const signal = SIGNALS[key];
    if (signal === undefined) {
      rows[key] = "unknown";
      continue;
    }
    if (signal(input)) rows[key] = "present";
    else rows[key] = input.inventoryAvailable ? "absent" : "unknown";
  }
  return rows;
}

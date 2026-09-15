import { defineIntegration } from "../catalog.ts";

/** Native subagent tool names; the presence signal for this integration. */
const SUBAGENT_TOOLS = ["subagent", "subagent_wait", "subagent_supervisor"];

/**
 * Subagents keeps a rich evidence path beside its Integrations row: presence is
 * the native subagent tool names and the row itself carries no counters, so its
 * schema declares none. The rich contribution hook lands with the live/rich
 * slice.
 */
export const subagentsIntegration = defineIntegration({
  key: "subagents",
  schemas: { 1: { counters: [] } },
  hooks: {
    presence: ({ tools }: { tools: readonly string[] }) =>
      tools.some((tool) => SUBAGENT_TOOLS.includes(tool))
        ? "present"
        : "absent",
  },
});

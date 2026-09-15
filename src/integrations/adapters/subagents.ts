import {
  readSubagentEvidenceWithArchives,
  type SubagentEvidence,
} from "../subagents.ts";
import { defineIntegration } from "../catalog.ts";
import type { CanonicalIntegrationContext } from "../contract.ts";

/** Native subagent tool names; the presence signal for this integration. */
const SUBAGENT_TOOLS = ["subagent", "subagent_wait", "subagent_supervisor"];

/**
 * Subagents keeps a rich evidence path beside its Integrations row: presence is
 * the native subagent tool names and the row itself carries no counters, so its
 * schema declares none.
 */
export const subagentsIntegration = defineIntegration({
  key: "subagents",
  schemas: { 1: { counters: [] } },
  hooks: {
    presence: ({ tools }: { tools: readonly string[] }) =>
      tools.some((tool) => SUBAGENT_TOOLS.includes(tool))
        ? "present"
        : "absent",
    /**
     * Archive validation needs the filesystem, so the contribution is async and
     * falls back to the persisted read without archive verdicts when it fails.
     */
    canonical: async ({ entries, sessionId }: CanonicalIntegrationContext) => {
      const evidence: SubagentEvidence =
        await readSubagentEvidenceWithArchives(entries, sessionId);
      return {
        state: evidence.state,
        runs: evidence.runs,
        activity: evidence.activity,
        diagnostics: evidence.diagnostics,
      };
    },
  },
});

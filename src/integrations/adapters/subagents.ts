import {
  readSubagentEvidence,
  readSubagentEvidenceWithArchives,
  type SubagentSourceEvidence,
} from "../subagents.ts";
import { defineIntegration } from "../catalog.ts";
import type {
  CanonicalIntegrationContext,
  PersistedEvidenceContext,
} from "../contract.ts";

/** Native subagent tool names; the presence signal for this integration. */
const SUBAGENT_TOOLS = [
  "subagent",
  "subagent_wait",
  "bg_wait",
  "subagent_supervisor",
];

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
     * The row carries no counters (its schema declares none): the evidence is
     * the run/activity contribution below. A session with native subagent tool
     * calls therefore reports `Present / Supported` from the same persisted
     * evidence the Agents view already shows, rather than
     * `Present / Unavailable`.
     */
    persisted: ({ entries, sessionId }: PersistedEvidenceContext) => {
      const evidence = readSubagentEvidence(entries, sessionId);
      if (evidence.state !== "supported") return undefined;
      return {
        integration: "subagents",
        state: "supported",
        version: 1,
        counters: {},
        reason: "evidence-supported",
      } as const;
    },
    /**
     * Archive validation needs the filesystem, so the contribution is async and
     * falls back to the persisted read without archive verdicts when it fails.
     */
    canonical: async ({ entries, sessionId }: CanonicalIntegrationContext) => {
      const evidence: SubagentSourceEvidence =
        await readSubagentEvidenceWithArchives(entries, sessionId);
      return {
        state: evidence.state,
        observations: evidence.observations,
        ...(evidence.aliases === undefined
          ? {}
          : { aliases: evidence.aliases }),
        activity: evidence.activity,
        diagnostics: evidence.diagnostics,
      };
    },
  },
});

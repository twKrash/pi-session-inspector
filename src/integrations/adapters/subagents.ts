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
    persisted: ({
      entries,
      appendOrder,
      sessionId,
    }: PersistedEvidenceContext) => {
      const orderedEntries = orderPersistedEntries(entries, appendOrder);
      if (orderedEntries === undefined) return undefined;
      const evidence = readSubagentEvidence(orderedEntries, sessionId);
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
        ...(evidence.coverage === "partial" ? { coverage: "partial" } : {}),
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

function orderPersistedEntries(
  entries: PersistedEvidenceContext["entries"],
  appendOrder: PersistedEvidenceContext["appendOrder"],
): PersistedEvidenceContext["entries"] | undefined {
  if (appendOrder === undefined || appendOrder.size !== entries.length) {
    return undefined;
  }

  const seen = new Set<number>();
  const ordered: Array<{
    entry: PersistedEvidenceContext["entries"][number];
    ordinal: number;
  }> = [];
  for (const entry of entries) {
    const ordinal = appendOrder.get(entry);
    if (
      ordinal === undefined ||
      !Number.isSafeInteger(ordinal) ||
      ordinal < 0 ||
      seen.has(ordinal)
    ) {
      return undefined;
    }
    seen.add(ordinal);
    ordered.push({ entry, ordinal });
  }
  return ordered
    .sort((left, right) => left.ordinal - right.ordinal)
    .map(({ entry }) => entry);
}

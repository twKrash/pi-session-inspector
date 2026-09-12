import { readFile } from "node:fs/promises";
import {
  buildCanonicalSession,
  type RetainedWalRecord,
} from "../core/canonical.ts";
import type { L0Evidence } from "../core/evidence.ts";
import type { Scope } from "../core/events.ts";
import { reduceEntries } from "../core/reduce.ts";
import { toSessionReport, type DurationEvidence } from "../core/reports.ts";
import { readPiEntryEvidence } from "../integrations/pi-entries.ts";
import {
  readSubagentEvidence,
  type SubagentEvidence,
} from "../integrations/subagents.ts";
import { parseSessionJsonl } from "../pi/adapter.ts";
import { createCurrentTuiModel, type CurrentTuiModel } from "./current.ts";
import { countersFrom, usageFrom } from "./l2-projection.ts";
import type { SessionObservation } from "./observation.ts";

/**
 * Options for {@link loadCurrentSessionReport}; one object so later wiring
 * cannot mis-bind. Storage never reaches this loader: the composition root
 * supplies the L0 evidence, the WAL-validated retained records and the live
 * overflow count, and the canonical builder (L1) owns scope, folding and
 * health.
 */
export type LoadCurrentSessionReportOptions = {
  leafId: string | null;
  /** Unreconciled L0 evidence built by the composition root (R41/R48). */
  evidence?: L0Evidence;
  /**
   * WAL-validated retained records (R41). They carry the post-cursor counter
   * suffix the builder folds; L2 never parses or folds them itself.
   */
  walRecords?: readonly RetainedWalRecord[];
  /** Saturating dropped-tool-start count from the live registration (R29). */
  liveOverflow?: number;
  /** Process-local presence/inventory observation; never a storage read. */
  observation?: SessionObservation;
  /** Composition-root cooperative archive provider; L2 never performs archive I/O. */
  subagentEvidence?: (
    entries: readonly import("../core/events.ts").SessionEntry[],
    sessionId: string,
  ) => Promise<SubagentEvidence>;
};

const NO_EVIDENCE: L0Evidence = { atomic: [], folded: [] };

/**
 * Replays a persisted current session into the renderer-neutral TUI model
 * through the canonical builder. The builder is the single scope and
 * availability authority: an untracked, unusable, or unsupported session stays
 * unavailable (never an all-zero report), and the report body uses exactly the
 * entries the builder resolved.
 */
export async function loadCurrentSessionReport(
  sessionFile: string | undefined,
  scope: Scope,
  options: LoadCurrentSessionReportOptions,
): Promise<CurrentTuiModel | undefined> {
  if (!sessionFile) return undefined;
  const { leafId, observation } = options;

  try {
    const parsed = parseSessionJsonl(await readFile(sessionFile, "utf8"));
    const buildInput = {
      parsed,
      scope,
      leafId,
      evidence: options.evidence ?? NO_EVIDENCE,
      ...(options.walRecords === undefined
        ? {}
        : { walRecords: options.walRecords }),
      ...(options.liveOverflow === undefined
        ? {}
        : { liveOverflow: options.liveOverflow }),
      ...(observation?.inventory === undefined
        ? {}
        : { inventory: observation.inventory }),
    };
    // The builder is the single scope authority, so its resolution is what the
    // subagent adapter reads. The second (pure, in-memory) build then supplies
    // L1 with the same cooperative evidence class the DTO publishes, so the
    // health and the body cannot contradict each other (P1.2).
    const resolved = buildCanonicalSession(buildInput);
    if (resolved.state !== "ready") return undefined;
    // R49: the entry set is the builder's resolution in order, mapped back to
    // parsed entries; an id without a parsed entry (an unknown-semantic node)
    // is skipped instead of fabricating a node. Scope is never re-derived here.
    const byId = new Map<string, (typeof parsed.entries)[number]>();
    for (const entry of parsed.entries) {
      if (!byId.has(entry.id)) byId.set(entry.id, entry);
    }
    const entries = resolved.session.scopedEntryIds.flatMap((id) => {
      const entry = byId.get(id);
      return entry === undefined ? [] : [entry];
    });
    // Subagent runs are auto-discovered from persisted tool results; the
    // evidence usage stays a child-agent breakdown, never a session total.
    // Only validated published archive references add presence evidence.
    const subagentEvidence =
      (await options.subagentEvidence?.(entries, resolved.session.sessionId)) ??
      readSubagentEvidence(entries, resolved.session.sessionId);
    const built = buildCanonicalSession({
      ...buildInput,
      subagents: subagentEvidence,
    });
    if (built.state !== "ready") return undefined;
    const session = built.session;
    // R47: `expired` keeps its existing meaning — some prune seal exists — so a
    // checkpoint with no pruned detail is never labelled as cold.
    const sealed = Object.values(
      session.retainedAggregates.boundary.sealedThrough,
    ).some((cursor) => cursor > 0);
    return createCurrentTuiModel(
      toSessionReport(reduceEntries(session.sessionId, entries), {
        ...(sealed ? { walDetail: "expired" as const } : {}),
        agents: {
          state: subagentEvidence.state,
          runs: subagentEvidence.runs,
        },
        agentActivity: subagentEvidence.activity,
        presence: observation?.presence,
        ...countersFrom(session),
        ...usageFrom(session),
        inventory: observation?.inventory,
        integrations: readPiEntryEvidence(entries),
        // Task 14 fields: the canonical health and checkpoint-surviving
        // aggregates reach L2 as L1 produced them, never re-derived.
        evidenceHealth: session.health,
        retainedAggregates: session.retainedAggregates,
        // Duration exists only from an exact live subject correlation (L1).
        duration: durationEvidence(session.tools),
      }),
      scope,
    );
  } catch {
    return undefined;
  }
}

/** Only correlated tool rows carry a duration; the projection re-validates. */
function durationEvidence(
  tools: readonly { id: string; durationMs?: number }[],
): DurationEvidence {
  return {
    state: "supported",
    tools: tools.flatMap((tool) =>
      tool.durationMs === undefined
        ? []
        : [{ id: tool.id, durationMs: tool.durationMs }],
    ),
  };
}

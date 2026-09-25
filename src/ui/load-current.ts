import { readFile } from "node:fs/promises";
import {
  attachSubagentEvidence,
  buildCanonicalSession,
  type RetainedWalRecord,
} from "../core/canonical.ts";
import type { L0Evidence } from "../core/evidence.ts";
import type { Scope } from "../core/events.ts";
import { toSessionReport } from "../core/reports.ts";
import {
  readSubagentEvidence,
  type SubagentSourceEvidence,
} from "../integrations/subagents.ts";
import { parseSessionJsonl } from "../pi/adapter.ts";
import { createCurrentTuiModel, type CurrentTuiModel } from "./current.ts";
import { sessionDatedUsage } from "./dated-usage.ts";
import { countersFrom } from "./l2-projection.ts";
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
  ) => Promise<SubagentSourceEvidence>;
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
    // subagent adapter reads. Attach its already-validated cooperative result
    // without replaying native entries or integration adapters (P1.2).
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
    const session = attachSubagentEvidence(resolved.session, subagentEvidence);
    return createCurrentTuiModel(
      toSessionReport(session, {
        agents: {
          state: subagentEvidence.state,
          runs: session.agents,
        },
        agentActivity: subagentEvidence.activity,
        presence: observation?.presence,
        ...countersFrom(session),
      }),
      scope,
      // R19: the already-built canonical session is projected once; no extra
      // parse, no extra build, no walk of the report's timestamps.
      sessionDatedUsage(session),
    );
  } catch {
    return undefined;
  }
}

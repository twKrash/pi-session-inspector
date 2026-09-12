import { readFile } from "node:fs/promises";
import {
  buildCanonicalSession,
  type CanonicalSession,
  type RetainedWalRecord,
} from "../core/canonical.ts";
import type { L0Evidence } from "../core/evidence.ts";
import type { IntegrationKey, Scope } from "../core/events.ts";
import {
  MAX_SKILL_KEYS,
  type FoldedCounters,
} from "../core/live-counter-fold.ts";
import { reduceEntries } from "../core/reduce.ts";
import { toSessionReport, type DurationEvidence } from "../core/reports.ts";
import { isIntegrationKey } from "../core/retained-aggregates.ts";
import { readPiEntryEvidence } from "../integrations/pi-entries.ts";
import { readSubagentEvidenceWithArchives } from "../integrations/subagents.ts";
import { parseSessionJsonl } from "../pi/adapter.ts";
import { createCurrentTuiModel, type CurrentTuiModel } from "./current.ts";
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
    const byId = new Map(parsed.entries.map((entry) => [entry.id, entry]));
    const entries = resolved.session.scopedEntryIds.flatMap((id) => {
      const entry = byId.get(id);
      return entry === undefined ? [] : [entry];
    });
    // Subagent runs are auto-discovered from persisted tool results; the
    // evidence usage stays a child-agent breakdown, never a session total.
    // Only validated published archive references add presence evidence.
    const subagentEvidence = await readSubagentEvidenceWithArchives(
      entries,
      resolved.session.sessionId,
    );
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

/**
 * Projects L1's effective counters into the legacy folded-counter DTO field
 * (spec §11 compatibility). This is a projection, not a fold: L1 already
 * unioned the folded prefix with the post-cursor retained suffix, and L2 never
 * adds a fact on top of a published total (R50c). Absent content stays absent,
 * so a report never claims counters it did not observe.
 */
function countersFrom(session: CanonicalSession): {
  counters?: FoldedCounters;
} {
  const effective = session.effectiveCounters;
  if (effective.state === "unavailable") {
    // R50(b): with no boundary L1 states no total, so per-key integration
    // counts stay unavailable — but the retained explicit skill-invocation
    // detail still reaches the body from the canonical facts (invariant 29),
    // so `skills` agrees with the health that counts those same facts.
    const skills = retainedSkillCounters(session.skillInvocations);
    if (
      Object.keys(skills.skillInvocations).length === 0 &&
      skills.otherInvocations === 0
    ) {
      return {};
    }
    return {
      counters: {
        counters: {},
        skillInvocations: skills.skillInvocations,
        otherInvocations: skills.otherInvocations,
        presence: { permission: false },
      },
    };
  }
  const counters: Partial<Record<IntegrationKey, Record<string, number>>> = {};
  for (const key of Object.keys(effective.integration ?? {}).sort()) {
    if (!isIntegrationKey(key)) continue;
    const value = effective.integration?.[key];
    if (value === undefined) continue;
    counters[key] = { ...value };
  }
  const skillInvocations = { ...(effective.skillInvocations?.named ?? {}) };
  const otherInvocations = effective.skillInvocations?.overflow ?? 0;
  const permission = effective.permissionPresence === true;
  if (
    Object.keys(counters).length === 0 &&
    Object.keys(skillInvocations).length === 0 &&
    otherInvocations === 0 &&
    !permission
  ) {
    return {};
  }
  return {
    counters: {
      counters,
      skillInvocations,
      otherInvocations,
      presence: { permission },
    },
  };
}

/**
 * Exact named counts of the canonical retained skill facts. Names beyond the
 * shared key cap are still counted exactly as `otherInvocations`, mirroring the
 * live fold's contract; the map is prototype-free like every counter map.
 */
function retainedSkillCounters(facts: readonly { skill: string }[]): {
  skillInvocations: Record<string, number>;
  otherInvocations: number;
} {
  const named = Object.create(null) as Record<string, number>;
  let otherInvocations = 0;
  for (const fact of facts) {
    const current = named[fact.skill];
    if (current !== undefined) {
      named[fact.skill] = current + 1;
      continue;
    }
    if (Object.keys(named).length >= MAX_SKILL_KEYS) {
      otherInvocations += 1;
      continue;
    }
    named[fact.skill] = 1;
  }
  return { skillInvocations: named, otherInvocations };
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

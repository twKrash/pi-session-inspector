import type { CanonicalSession } from "../core/canonical.ts";
import type { IntegrationKey } from "../core/events.ts";
import type { FoldedCounters } from "../core/live-counter-fold.ts";
import { isIntegrationKey } from "../core/retained-aggregates.ts";

/** Shared L2 projection of L1-effective counters; it never folds evidence. */
export function countersFrom(session: CanonicalSession): {
  counters?: FoldedCounters;
} {
  const effective = session.effectiveCounters;
  if (effective.state === "unavailable") {
    const retained = session.retainedSkillInvocations;
    if (retained === undefined) return {};
    return {
      counters: {
        counters: {},
        skillInvocations: { ...retained.named },
        otherInvocations: retained.overflow,
        presence: { permission: false },
      },
    };
  }
  const counters: Partial<Record<IntegrationKey, Record<string, number>>> = {};
  for (const key of Object.keys(effective.integration ?? {}).sort()) {
    if (!isIntegrationKey(key)) continue;
    const value = effective.integration?.[key];
    if (value !== undefined) counters[key] = { ...value };
  }
  const skillInvocations = { ...(effective.skillInvocations?.named ?? {}) };
  const otherInvocations = effective.skillInvocations?.overflow ?? 0;
  const permission = effective.permissionPresence === true;
  if (
    Object.keys(counters).length === 0 &&
    Object.keys(skillInvocations).length === 0 &&
    otherInvocations === 0 &&
    !permission
  )
    return {};
  return {
    counters: {
      counters,
      skillInvocations,
      otherInvocations,
      presence: { permission },
    },
  };
}

export function resourceCountsFrom(session: CanonicalSession): {
  resourceCounts?: { commands: number; skills: number };
} {
  const counts = session.retainedAggregates.resources?.counts;
  if (counts?.commands === undefined || counts.skills === undefined) return {};
  return {
    resourceCounts: { commands: counts.commands, skills: counts.skills },
  };
}

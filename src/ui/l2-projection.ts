import type { CanonicalSession } from "../core/canonical.ts";
import type {
  IntegrationKey,
  Usage,
  UsageComposition,
} from "../core/events.ts";
import {
  MAX_SKILL_KEYS,
  type FoldedCounters,
} from "../core/live-counter-fold.ts";
import { isIntegrationKey } from "../core/retained-aggregates.ts";

/** Shared L2 projection of L1-effective counters; it never folds evidence. */
export function countersFrom(session: CanonicalSession): {
  counters?: FoldedCounters;
} {
  const effective = session.effectiveCounters;
  if (effective.state === "unavailable") {
    const skills = retainedSkillCounters(session.skillInvocations);
    if (
      Object.keys(skills.skillInvocations).length === 0 &&
      skills.otherInvocations === 0
    )
      return {};
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

/** Projects only L1's usage verdict; an overflow never republishes raw reduce totals. */
export function usageFrom(
  session: CanonicalSession,
):
  | { usage: { state: "known"; usage: Usage; composition: UsageComposition } }
  | { usage: { state: "unavailable" } } {
  if (session.usage.state === "unavailable")
    return { usage: { state: "unavailable" } };
  return {
    usage: {
      state: "known",
      usage: session.usage.known,
      composition: session.usage.composition,
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

function retainedSkillCounters(facts: readonly { skill: string }[]): {
  skillInvocations: Record<string, number>;
  otherInvocations: number;
} {
  const named = Object.create(null) as Record<string, number>;
  let otherInvocations = 0;
  for (const fact of facts) {
    const current = named[fact.skill];
    if (current !== undefined) named[fact.skill] = current + 1;
    else if (Object.keys(named).length >= MAX_SKILL_KEYS) otherInvocations += 1;
    else named[fact.skill] = 1;
  }
  return { skillInvocations: named, otherInvocations };
}

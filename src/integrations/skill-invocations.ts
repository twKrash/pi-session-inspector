import type { SkillInvocationObservation } from "../core/evidence.ts";
import { SKILL_NAME_PATTERN } from "../core/live-counter-fold.ts";

const SKILL_SOURCE = "pi-input";
const SKILL_METRIC = "skill.invocation";

/**
 * Reads explicit skill invocations out of Inspector's own WAL telemetry.
 *
 * This is a read of live Inspector evidence, not of Pi's session file, so the
 * authority is `live` and the time basis is `wal-observer`. A record becomes a
 * fact only when it is a `pi-input` counter of exactly one `skill.invocation`
 * whose `skill` dimension satisfies the shared bounded skill-name grammar:
 * absent, non-string, oversized, or otherwise invalid names yield no fact
 * (never a fabricated or truncated name, and never a zero count).
 */
export function readSkillInvocations(input: {
  sessionId: string;
  records: readonly {
    eventId: string;
    writerId: string;
    writerSequence: number;
    timestamp: string;
    telemetry?: Record<string, unknown>;
  }[];
}): SkillInvocationObservation[] {
  const facts: SkillInvocationObservation[] = [];
  for (const record of input.records) {
    const telemetry = record.telemetry;
    if (telemetry === undefined) continue;
    if (telemetry.kind !== "counter" || telemetry.value !== 1) continue;
    if (telemetry.source !== SKILL_SOURCE || telemetry.metric !== SKILL_METRIC)
      continue;
    const dimensions = telemetry.dimensions;
    const skill =
      typeof dimensions === "object" && dimensions !== null
        ? (dimensions as Record<string, unknown>).skill
        : undefined;
    if (typeof skill !== "string" || !SKILL_NAME_PATTERN.test(skill)) continue;
    facts.push({
      factId: `skill-invocation:${record.eventId}`,
      sessionId: input.sessionId,
      kind: "skill-invocation",
      skill,
      wal: {
        eventId: record.eventId,
        writerId: record.writerId,
        writerSequence: record.writerSequence,
      },
      provenance: {
        source: "integration-telemetry",
        authority: "live",
        recordId: record.eventId,
        schemaVersion: 1,
      },
      time: { state: "known", at: record.timestamp, basis: "wal-observer" },
    });
  }
  return facts.sort((a, b) =>
    a.wal.writerId === b.wal.writerId
      ? a.wal.writerSequence - b.wal.writerSequence
      : a.wal.writerId.localeCompare(b.wal.writerId),
  );
}

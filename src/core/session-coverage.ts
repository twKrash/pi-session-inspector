import type { EvidenceDiagnosticCode } from "./evidence-health.ts";
import type { CoverageReason, HistoryDiagnostic } from "../storage/history.ts";

export type { CoverageReason };

/** Total projection of the runnability vocabulary onto codes that already exist (spec §3.1.1, R20). */
export const COVERAGE_REASON_CODES: Readonly<
  Record<
    CoverageReason,
    readonly (HistoryDiagnostic | EvidenceDiagnosticCode)[]
  >
> = {
  "no-manifest": ["manifest-unavailable"],
  "manifest-unavailable": ["manifest-unavailable", "source-not-found"],
  "marker-unavailable": ["marker-unavailable", "tracking-marker-missing"],
  "session-unreadable": ["source-malformed", "source-format-unsupported"],
  "replay-failed": [
    "source-format-unsupported",
    "cooperative-evidence-conflict",
  ],
};

export type SessionCoverage = {
  inspected: number;
  available: number;
  unavailable: number;
  /** null when inspected === 0 or discoveryLimited (unknown denominator). */
  sessionRatio: number | null;
  complete: boolean;
  discoveryLimited: boolean;
  reasons: Readonly<Partial<Record<CoverageReason, number>>>;
};

/**
 * Bounded, deterministic coverage of one inspection set: how many discovered
 * sessions became reports, how many did not, and why. An `unavailable`
 * aggregate has no coverage at all — never a fabricated zero pass.
 */
export function buildSessionCoverage(input: {
  availability: "available" | "unavailable";
  discoveryLimited: boolean;
  sessions: readonly {
    availability: "available" | "unavailable";
    reason?: CoverageReason;
  }[];
}): SessionCoverage | undefined {
  if (input.availability !== "available") return undefined;
  const inspected = input.sessions.length;
  const available = input.sessions.filter(
    (session) => session.availability === "available",
  ).length;
  const reasons: Partial<Record<CoverageReason, number>> = {};
  for (const session of input.sessions) {
    if (session.reason === undefined) continue;
    reasons[session.reason] = (reasons[session.reason] ?? 0) + 1;
  }
  return {
    inspected,
    available,
    unavailable: inspected - available,
    sessionRatio:
      inspected === 0 || input.discoveryLimited
        ? null
        : Number((available / inspected).toFixed(4)),
    complete:
      inspected > 0 && available === inspected && !input.discoveryLimited,
    discoveryLimited: input.discoveryLimited,
    reasons,
  };
}

import type { Confidence, ErrorKind } from "./events.ts";
import type { SessionReport } from "./reports.ts";

export type LedgerKind =
  | "generation"
  | "tool"
  | "compaction"
  | "branchSummary"
  | "error";

/** Bounded action tokens; branch summaries are never relabeled as compactions. */
export type LedgerStatus =
  | "completed"
  | "succeeded"
  | "failed"
  | "interrupted"
  | "recorded"
  | ErrorKind;

/** Shared chronological projection; TUI and HTML consume these fields verbatim. */
export type LedgerItem = {
  id: string;
  timestamp: string;
  kind: LedgerKind;
  status: LedgerStatus;
  confidence: Confidence;
};

export function buildLedger(report: SessionReport): LedgerItem[] {
  return [
    ...report.generations.map(
      ({ id, timestamp }): LedgerItem => ({
        id,
        timestamp,
        kind: "generation",
        status: "completed",
        confidence: "native",
      }),
    ),
    ...report.tools.map(
      ({ id, timestamp, status }): LedgerItem => ({
        id,
        timestamp,
        kind: "tool",
        status,
        confidence: "native",
      }),
    ),
    ...report.compactions.map(
      ({ id, timestamp, kind }): LedgerItem => ({
        id,
        timestamp,
        kind: kind === "branch_summary" ? "branchSummary" : "compaction",
        status: "recorded",
        confidence: "native",
      }),
    ),
    ...report.errors.map(
      ({ id, timestamp, kind, confidence }): LedgerItem => ({
        id,
        timestamp,
        kind: "error",
        status: kind,
        confidence,
      }),
    ),
  ].sort(
    (a, b) =>
      a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id),
  );
}

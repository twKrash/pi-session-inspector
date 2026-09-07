import type { SessionReport } from "./reports.ts";

export type LedgerItem = {
  id: string;
  timestamp: string;
  kind: "generation" | "tool" | "compaction";
};

export function buildLedger(report: SessionReport): LedgerItem[] {
  return [
    ...report.generations.map(({ id, timestamp }) => ({
      id,
      timestamp,
      kind: "generation" as const,
    })),
    ...report.tools.map(({ id, timestamp }) => ({
      id,
      timestamp,
      kind: "tool" as const,
    })),
    ...report.compactions.map(({ id, timestamp }) => ({
      id,
      timestamp,
      kind: "compaction" as const,
    })),
  ].sort(
    (a, b) =>
      a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id),
  );
}

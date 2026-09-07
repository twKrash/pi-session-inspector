import type { SessionReport } from "../core/reports.ts";

export function renderJson(report: SessionReport): string {
  return `${JSON.stringify(report)}\n`;
}

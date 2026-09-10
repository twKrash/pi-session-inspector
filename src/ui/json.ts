export function renderJson(report: unknown): string {
  return `${JSON.stringify(report)}\n`;
}

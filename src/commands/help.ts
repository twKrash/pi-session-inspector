import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  matchesKey,
  truncateToWidth,
  type Component,
} from "@earendil-works/pi-tui";

/**
 * Static, width-safe help copy. It advertises only valid combinations, so it can
 * never disagree with the grammar; nothing here derives from session data.
 */
const HELP_LINES: readonly string[] = [
  "Pi Session Inspector - command help",
  "",
  "Usage: /session-inspector [ui|tui|json] [target] [options]",
  "",
  "Modes:",
  "  ui    self-contained HTML report in the browser",
  "  tui   interactive Pi full-screen TUI",
  "  json  deterministic JSON export",
  "",
  "Targets:",
  "  tui   current | ledger",
  "  json  current | history | global",
  "  ui    none; the HTML report carries all views",
  "",
  "Options:",
  "  --scope active|tree   default active; tree for json history|global",
  "  --theme dark|light    ui only",
  "  --output PATH         ui, json",
  "  --no-open             ui only",
  "  help | --help | -h    this panel",
  "",
  "Defaults:",
  "  /session-inspector    tui current",
  "",
  "Examples:",
  "  /session-inspector",
  "  /session-inspector ui --theme dark",
  "  /session-inspector tui ledger",
  "  /session-inspector json history --output report.json",
];

export function inspectorHelpLines(): readonly string[] {
  return HELP_LINES;
}

/**
 * Full-screen help panel. Renders the static copy with theme styling, closes on
 * `esc`/`q`, truncates every line to the viewport, and never throws.
 */
export function createInspectorHelpComponent(input: {
  theme: Pick<Theme, "fg">;
  done(): void;
}): Component {
  return {
    invalidate: () => {},
    handleInput(data): void {
      if (matchesKey(data, "escape") || matchesKey(data, "q")) input.done();
    },
    render(width): string[] {
      const safeWidth = Math.max(0, width);
      return inspectorHelpLines().map((line) =>
        truncateToWidth(input.theme.fg("dim", line), safeWidth, ""),
      );
    },
  };
}

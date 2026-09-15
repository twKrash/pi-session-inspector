import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  matchesKey,
  truncateToWidth,
  type Component,
} from "@earendil-works/pi-tui";
import {
  INSPECTOR_MODES,
  INSPECTOR_OPTIONS,
  INSPECTOR_PRESET_VALUES,
  INSPECTOR_TARGETS,
} from "./grammar.ts";

/**
 * Static, width-safe help copy. It advertises only valid combinations, so it can
 * never disagree with the grammar; nothing here derives from session data.
 */
const HELP_LINES: readonly string[] = Object.freeze([
  "Pi Session Inspector - command help",
  "",
  `Usage: /session-inspector [${INSPECTOR_MODES.join("|")}] [target] [options]`,
  "Modes:",
  "  ui        localhost interactive browser application",
  "  snapshot  immutable self-contained HTML artifact",
  "  tui       interactive Pi full-screen TUI",
  "  json      deterministic JSON export",
  "",
  "Targets:",
  "  ui        none; the application carries its own navigation",
  `  snapshot  ${INSPECTOR_TARGETS.snapshot.join(" | ")}; session <sessionId>`,
  `  tui       ${INSPECTOR_TARGETS.tui.join(" | ")}`,
  `  json      ${INSPECTOR_TARGETS.json.join(" | ")}`,
  "Options:",
  `  ui        ${INSPECTOR_OPTIONS.ui[0]} active|tree; --theme dark|light; --debug; --no-open`,
  `  snapshot  --scope; --preset ${INSPECTOR_PRESET_VALUES.join("|")}; --from DATE --to DATE`,
  "            --theme dark|light; --debug; --output FILE; --no-open",
  "  snapshot current: scope and range; history/global: range only",
  "  snapshot session: theme, output, no-open only",
  `  tui       ${INSPECTOR_OPTIONS.tui.join(" ")}`,
  `  json      ${INSPECTOR_OPTIONS.json.join(" ")}; scope current only`,
  "  help | --help | -h    this panel",
  "Defaults: /session-inspector is tui current",
  "",
  "Examples:",
  "  /session-inspector ui --theme dark",
  "  /session-inspector snapshot current --preset 7",
  "  /session-inspector snapshot session session-a --output report.html",
  "  /session-inspector json history --output report.json",
]);

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

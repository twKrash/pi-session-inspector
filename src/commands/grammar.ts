import type { Scope } from "../core/events.ts";

/** Renderer/consumer mode selected positionally as the first command token. */
export type InspectorMode = "ui" | "tui" | "json";
/** Report target; `ledger` is TUI-only, `history`/`global` are JSON-only. */
export type InspectorTarget = "current" | "ledger" | "history" | "global";

export type InspectorCommand =
  | {
      kind: "report";
      mode: InspectorMode;
      target: InspectorTarget;
      scope: Scope;
      theme?: "dark" | "light";
      output?: string;
      noOpen: boolean;
    }
  | { kind: "help" };

export type InspectorParseResult =
  | { ok: true; command: InspectorCommand }
  | { ok: false; message: string };

/** Positional modes in completion order; the single source of truth. */
export const INSPECTOR_MODES: readonly InspectorMode[] = ["ui", "tui", "json"];
/** `help` is a first-token affordance, not a mode. */
export const INSPECTOR_FIRST_TOKENS: readonly string[] = [
  ...INSPECTOR_MODES,
  "help",
];
/** Valid targets per mode; `ui` carries its own in-page navigation. */
export const INSPECTOR_TARGETS: Readonly<
  Record<InspectorMode, readonly InspectorTarget[]>
> = {
  ui: [],
  tui: ["current", "ledger"],
  json: ["current", "history", "global"],
};
/** Option names valid per mode, in completion order. */
export const INSPECTOR_OPTIONS: Readonly<
  Record<InspectorMode, readonly string[]>
> = {
  ui: ["--scope", "--theme", "--output", "--no-open"],
  tui: ["--scope"],
  json: ["--scope", "--output"],
};
export const INSPECTOR_SCOPE_VALUES: readonly Scope[] = ["active", "tree"];
export const INSPECTOR_THEME_VALUES: readonly ("dark" | "light")[] = [
  "dark",
  "light",
];

/** Legacy positional targets; rejected with a hint, never parsed as targets. */
const LEGACY_TARGETS = new Set(["current", "history", "global", "ledger"]);

const USAGE =
  "Usage: /session-inspector [ui|tui|json] [target] [options]. Run /session-inspector help.";

function reject(): InspectorParseResult {
  return { ok: false, message: USAGE };
}

/**
 * Splits command text the way Pi receives it: whitespace-collapsed tokens with
 * quoted values preserved (quotes stripped, no escape processing). Returns
 * `undefined` for an unterminated quote so callers never partially accept.
 */
export function tokenizeInspectorArgs(
  input: string,
): { tokens: string[]; trailingWhitespace: boolean } | undefined {
  const tokens: string[] = [];
  let token = "";
  let started = false;
  let quote: '"' | "'" | undefined;
  let trailingWhitespace = false;
  for (const character of input) {
    const whitespace = /\s/.test(character);
    trailingWhitespace = whitespace;
    if (quote) {
      if (character === quote) quote = undefined;
      else token += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      started = true;
    } else if (whitespace) {
      if (started) {
        tokens.push(token);
        token = "";
        started = false;
      }
    } else {
      token += character;
      started = true;
    }
  }
  if (quote) return undefined;
  if (started) tokens.push(token);
  return { tokens, trailingWhitespace: input.length > 0 && trailingWhitespace };
}

/**
 * Parses the full `/session-inspector` argument string into a report command or
 * the help panel. Deterministic and side-effect free; every rejection returns
 * the same one-line usage plus a `help` pointer, never the removed generic text.
 */
export function parseInspectorCommand(args: string): InspectorParseResult {
  const tokenized = tokenizeInspectorArgs(args);
  if (!tokenized) return reject();
  const tokens = [...tokenized.tokens];
  if (tokens.length === 0) {
    return {
      ok: true,
      command: {
        kind: "report",
        mode: "tui",
        target: "current",
        scope: "active",
        noOpen: false,
      },
    };
  }

  const first = tokens.shift() as string;
  if (first === "help" || first === "--help" || first === "-h") {
    return { ok: true, command: { kind: "help" } };
  }
  // `--format` and bare legacy targets are removed syntax, not unknown options.
  if (first === "--format" || LEGACY_TARGETS.has(first)) return reject();
  if (!INSPECTOR_MODES.includes(first as InspectorMode)) return reject();
  const mode = first as InspectorMode;

  let target: InspectorTarget = "current";
  const firstTarget = tokens[0];
  if (firstTarget !== undefined && !firstTarget.startsWith("-")) {
    const candidate = tokens.shift() as string;
    if (!INSPECTOR_TARGETS[mode].includes(candidate as InspectorTarget))
      return reject();
    target = candidate as InspectorTarget;
  }

  let scope: Scope | undefined;
  let theme: "dark" | "light" | undefined;
  let output: string | undefined;
  let noOpen = false;

  while (tokens.length > 0) {
    const option = tokens.shift() as string;
    if (option === "--scope") {
      const value = tokens.shift();
      if (!INSPECTOR_SCOPE_VALUES.includes(value as Scope)) return reject();
      scope = value as Scope;
    } else if (option === "--theme") {
      if (mode !== "ui") return reject();
      const value = tokens.shift();
      if (!INSPECTOR_THEME_VALUES.includes(value as "dark" | "light"))
        return reject();
      theme = value as "dark" | "light";
    } else if (option === "--output") {
      if (mode === "tui") return reject();
      const value = tokens.shift();
      if (!value || value.startsWith("-")) return reject();
      output = value;
    } else if (option === "--no-open") {
      if (mode !== "ui") return reject();
      noOpen = true;
    } else {
      return reject();
    }
  }

  if (mode === "json" && (target === "history" || target === "global")) {
    if (scope !== undefined && scope !== "tree") return reject();
    scope = "tree";
  } else {
    scope = scope ?? "active";
  }

  return {
    ok: true,
    command: {
      kind: "report",
      mode,
      target,
      scope,
      ...(theme ? { theme } : {}),
      ...(output !== undefined ? { output } : {}),
      noOpen,
    },
  };
}

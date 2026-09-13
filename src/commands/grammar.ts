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
/**
 * Whether each option consumes the following token (`value`) or stands alone
 * (`flag`). The single source of truth for option arity; every name in
 * `INSPECTOR_OPTIONS` must appear exactly once (guarded by a unit assertion).
 */
export const INSPECTOR_OPTION_ARITY: Readonly<
  Record<string, "value" | "flag">
> = {
  "--scope": "value",
  "--theme": "value",
  "--output": "value",
  "--no-open": "flag",
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
 * One argument token with its original span: `raw` is the source slice
 * (quotes included), `text` the parser value (one layer of quotes stripped),
 * and `quoted` whether a quote toggled anywhere inside the token.
 */
export type RawToken = {
  raw: string;
  text: string;
  start: number;
  end: number;
  quoted: boolean;
};

/**
 * One scanner serves the parser and the completer. It reproduces the parser's
 * tokenization exactly: whitespace splits tokens, `"` and `'` toggle quoting
 * anywhere inside a token, quote characters never enter `text`, no escapes.
 * `raw` is the original span (used for replacement), `text` the parser value
 * (used for matching). Returns `undefined` for an unterminated quote.
 */
export function scanInspectorArgs(
  prefix: string,
): { tokens: RawToken[]; trailingWhitespace: boolean } | undefined {
  const tokens: RawToken[] = [];
  let index = 0;
  let trailingWhitespace = false;
  while (index < prefix.length) {
    if (/\s/.test(prefix[index] as string)) {
      trailingWhitespace = true;
      index += 1;
      continue;
    }
    trailingWhitespace = false;
    const start = index;
    let text = "";
    let quote: string | undefined;
    let quoted = false;
    while (index < prefix.length) {
      const current = prefix[index] as string;
      if (quote !== undefined) {
        if (current === quote) quote = undefined;
        else text += current;
        index += 1;
        continue;
      }
      if (current === '"' || current === "'") {
        quote = current;
        quoted = true;
        index += 1;
        continue;
      }
      if (/\s/.test(current)) break;
      text += current;
      index += 1;
    }
    if (quote !== undefined) return undefined;
    tokens.push({
      raw: prefix.slice(start, index),
      text,
      start,
      end: index,
      quoted,
    });
  }
  return {
    tokens,
    trailingWhitespace: prefix.length > 0 && trailingWhitespace,
  };
}

/**
 * Splits command text the way Pi receives it: whitespace-collapsed tokens with
 * quoted values preserved (quotes stripped, no escape processing). Returns
 * `undefined` for an unterminated quote so callers never partially accept.
 * Now a projection of the scanner, so parsing and completion cannot drift.
 */
export function tokenizeInspectorArgs(
  input: string,
): { tokens: string[]; trailingWhitespace: boolean } | undefined {
  const scanned = scanInspectorArgs(input);
  if (scanned === undefined) return undefined;
  return {
    tokens: scanned.tokens.map((token) => token.text),
    trailingWhitespace: scanned.trailingWhitespace,
  };
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
    // `Object.hasOwn` so a prototype member name (`constructor`, `toString`,
    // `__proto__`, ...) is never mistaken for a declared option.
    const arity = Object.hasOwn(INSPECTOR_OPTION_ARITY, option)
      ? INSPECTOR_OPTION_ARITY[option]
      : undefined;
    if (arity === undefined) return reject();
    // Value-consuming options take the next token; flags never do.
    const value = arity === "value" ? tokens.shift() : undefined;
    if (option === "--scope") {
      if (!INSPECTOR_SCOPE_VALUES.includes(value as Scope)) return reject();
      scope = value as Scope;
    } else if (option === "--theme") {
      if (mode !== "ui") return reject();
      if (!INSPECTOR_THEME_VALUES.includes(value as "dark" | "light"))
        return reject();
      theme = value as "dark" | "light";
    } else if (option === "--output") {
      if (mode === "tui") return reject();
      if (!value || value.startsWith("-")) return reject();
      output = value;
    } else if (option === "--no-open") {
      // The only remaining arity entry is ui-only.
      if (mode !== "ui") return reject();
      noOpen = true;
    } else {
      // Unknown option: reject explicitly, never fall through to `--no-open`.
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

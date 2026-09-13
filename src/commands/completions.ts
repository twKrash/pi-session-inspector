import type { AutocompleteItem } from "@earendil-works/pi-tui";
import {
  INSPECTOR_FIRST_TOKENS,
  INSPECTOR_MODES,
  INSPECTOR_OPTION_ARITY,
  INSPECTOR_OPTIONS,
  INSPECTOR_PRESET_VALUES,
  INSPECTOR_SCOPE_VALUES,
  INSPECTOR_TARGETS,
  INSPECTOR_THEME_VALUES,
  type InspectorMode,
  type InspectorTarget,
  type RawToken,
  scanInspectorArgs,
} from "./grammar.ts";

/** Half-open span of the current token in the raw argument prefix. */
type Span = { start: number; end: number };

/** Fixed value choices for value-consuming options; arity lives in the grammar. */
function valueChoices(option: string): readonly string[] | undefined {
  if (option === "--scope") return INSPECTOR_SCOPE_VALUES;
  if (option === "--preset") return INSPECTOR_PRESET_VALUES.map(String);
  if (option === "--theme") return INSPECTOR_THEME_VALUES;
  return undefined;
}

const HELP_TOKENS = new Set(["help", "--help", "-h"]);

function optionsFor(
  mode: InspectorMode,
  target: InspectorTarget | undefined,
  usedOptions: ReadonlySet<string> = new Set(),
): readonly string[] {
  const hasCustomRange = usedOptions.has("--from") || usedOptions.has("--to");
  return INSPECTOR_OPTIONS[mode].filter(
    (option) =>
      !(
        (target === "history" || target === "global") &&
        option === "--scope"
      ) &&
      !(
        target === "session" &&
        ["--scope", "--preset", "--from", "--to"].includes(option)
      ) &&
      !(usedOptions.has("--preset") && ["--from", "--to"].includes(option)) &&
      !(hasCustomRange && option === "--preset"),
  );
}

/** Replaces only the current raw token span; every preceding character survives. */
function withReplacement(
  prefix: string,
  span: Span,
  replacement: string,
): string {
  return prefix.slice(0, span.start) + replacement + prefix.slice(span.end);
}

/**
 * The span a completion rewrites: the current raw token's span, or — when the
 * prefix ends in whitespace — the empty span at the end of the prefix.
 */
function currentSpan(
  tokens: readonly RawToken[],
  trailingWhitespace: boolean,
  prefix: string,
): Span {
  const last = tokens.at(-1);
  if (trailingWhitespace || last === undefined) {
    return { start: prefix.length, end: prefix.length };
  }
  return { start: last.start, end: last.end };
}

/**
 * Completion items for one candidate set. `current` is the token's parser text
 * (empty for the trailing span after whitespace); `value` is the rewritten raw
 * prefix Pi replaces the whole argument region with, `label` the bare token.
 */
function items(
  values: readonly string[],
  current: string,
  prefix: string,
  span: Span,
): AutocompleteItem[] | null {
  const matches = values.filter((value) => value.startsWith(current));
  if (matches.length === 0) return null;
  return matches.map((value) => ({
    value: withReplacement(prefix, span, value),
    label: value,
  }));
}

/**
 * Token-aware completion for the `/session-inspector` argument stream. Reuses
 * the grammar's tables and scanner so suggestions cannot drift from parsing.
 * `value` is the raw prefix with only the current token span rewritten, which
 * is what Pi's provider replaces the whole argument region with.
 * Returns `null` whenever the context has no valid suggestion; it never
 * fabricates an option or target for the current mode.
 */
export function completeInspectorCommand(
  prefix: string,
): AutocompleteItem[] | null {
  const scanned = scanInspectorArgs(prefix);
  if (!scanned) return null;
  const tokens: string[] = scanned.tokens.map((token) => token.text);
  const current = scanned.trailingWhitespace ? "" : (tokens.pop() ?? "");
  // The current span is the last raw token; when the prefix ends in whitespace
  // it is the empty span at the end, where the next token is inserted.
  const span = currentSpan(scanned.tokens, scanned.trailingWhitespace, prefix);

  // No mode chosen yet: complete the first token.
  if (tokens.length === 0)
    return items(INSPECTOR_FIRST_TOKENS, current, prefix, span);

  const mode = tokens[0] as string;
  if (HELP_TOKENS.has(mode)) return null;
  if (!INSPECTOR_MODES.includes(mode as InspectorMode)) return null;
  const typedMode = mode as InspectorMode;

  let targetChosen = false;
  let chosenTarget: InspectorTarget | undefined;
  let pendingValue: string | undefined;
  let sessionIdChosen = false;
  const usedOptions = new Set<string>();

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index] as string;
    if (token.startsWith("-")) {
      if (typedMode === "snapshot" && !targetChosen) return null;
      if (pendingValue) return null;
      if (!optionsFor(typedMode, chosenTarget, usedOptions).includes(token))
        return null;
      usedOptions.add(token);
      if (INSPECTOR_OPTION_ARITY[token] === "value") pendingValue = token;
      continue;
    }
    if (pendingValue) {
      const choices = valueChoices(pendingValue);
      if (
        pendingValue === "--output" ||
        pendingValue === "--from" ||
        pendingValue === "--to"
      ) {
        if (token.length === 0) return null;
      } else if (!choices || !choices.includes(token)) {
        return null;
      }
      pendingValue = undefined;
      continue;
    }
    if (typedMode === "snapshot" && chosenTarget === "session") {
      if (sessionIdChosen) return null;
      sessionIdChosen = token.length > 0;
      continue;
    }
    if (
      typedMode === "ui" ||
      targetChosen ||
      !INSPECTOR_TARGETS[typedMode].includes(token as InspectorTarget)
    )
      return null;
    targetChosen = true;
    chosenTarget = token as InspectorTarget;
  }

  if (pendingValue) {
    const choices = valueChoices(pendingValue);
    return choices ? items(choices, current, prefix, span) : null;
  }

  if (
    typedMode === "snapshot" &&
    chosenTarget === "session" &&
    !sessionIdChosen
  )
    return null;
  if (typedMode === "snapshot" && !targetChosen && current.startsWith("-"))
    return null;
  // Options already present are never offered again (§10.2).
  const options = optionsFor(typedMode, chosenTarget, usedOptions).filter(
    (option) => !usedOptions.has(option),
  );
  if (current.startsWith("-")) return items(options, current, prefix, span);
  // A target may still be pending; only offer options once it is settled.
  if (typedMode !== "ui" && !targetChosen) {
    const targetItems = items(
      INSPECTOR_TARGETS[typedMode],
      current,
      prefix,
      span,
    );
    if (targetItems) return targetItems;
  }
  if (current === "") return items(options, current, prefix, span);
  return null;
}

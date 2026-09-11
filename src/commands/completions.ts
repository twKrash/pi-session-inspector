import type { AutocompleteItem } from "@earendil-works/pi-tui";
import {
  INSPECTOR_FIRST_TOKENS,
  INSPECTOR_MODES,
  INSPECTOR_OPTION_ARITY,
  INSPECTOR_OPTIONS,
  INSPECTOR_SCOPE_VALUES,
  INSPECTOR_TARGETS,
  INSPECTOR_THEME_VALUES,
  type InspectorMode,
  type InspectorTarget,
  tokenizeInspectorArgs,
} from "./grammar.ts";

/** Fixed value choices for value-consuming options; arity lives in the grammar. */
const VALUE_CHOICES: Readonly<Record<string, readonly string[]>> = {
  "--scope": INSPECTOR_SCOPE_VALUES,
  "--theme": INSPECTOR_THEME_VALUES,
};

const HELP_TOKENS = new Set(["help", "--help", "-h"]);

function items(
  values: readonly string[],
  prefix: string,
): AutocompleteItem[] | null {
  const matches = values.filter((value) => value.startsWith(prefix));
  if (matches.length === 0) return null;
  return matches.map((value) => ({ value, label: value }));
}

/**
 * Token-aware completion for the `/session-inspector` argument stream. Reuses
 * the grammar's tables and tokenizer so suggestions cannot drift from parsing.
 * Returns `null` whenever the context has no valid suggestion; it never
 * fabricates an option or target for the current mode.
 */
export function completeInspectorCommand(
  prefix: string,
): AutocompleteItem[] | null {
  const tokenized = tokenizeInspectorArgs(prefix);
  if (!tokenized) return null;
  const tokens = [...tokenized.tokens];
  const current = tokenized.trailingWhitespace ? "" : (tokens.pop() ?? "");

  // No mode chosen yet: complete the first token.
  if (tokens.length === 0) return items(INSPECTOR_FIRST_TOKENS, current);

  const mode = tokens[0] as string;
  if (HELP_TOKENS.has(mode)) return null;
  if (!INSPECTOR_MODES.includes(mode as InspectorMode)) return null;
  const typedMode = mode as InspectorMode;

  let targetChosen = false;
  let pendingValue: string | undefined;

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index] as string;
    if (token.startsWith("-")) {
      if (pendingValue) return null;
      if (!INSPECTOR_OPTIONS[typedMode].includes(token)) return null;
      if (INSPECTOR_OPTION_ARITY[token] === "value") pendingValue = token;
      continue;
    }
    if (pendingValue) {
      const choices = VALUE_CHOICES[pendingValue];
      if (pendingValue === "--output") {
        if (token.length === 0) return null;
      } else if (!choices || !choices.includes(token)) {
        return null;
      }
      pendingValue = undefined;
      continue;
    }
    if (typedMode === "ui") return null;
    if (
      targetChosen ||
      !INSPECTOR_TARGETS[typedMode].includes(token as InspectorTarget)
    ) {
      return null;
    }
    targetChosen = true;
  }

  if (pendingValue) {
    const choices = VALUE_CHOICES[pendingValue];
    return choices ? items(choices, current) : null;
  }

  if (current.startsWith("-"))
    return items(INSPECTOR_OPTIONS[typedMode], current);
  // A target may still be pending; only offer options once it is settled.
  if (typedMode !== "ui" && !targetChosen) {
    const targetItems = items(INSPECTOR_TARGETS[typedMode], current);
    if (targetItems) return targetItems;
  }
  if (current === "") return items(INSPECTOR_OPTIONS[typedMode], current);
  return null;
}

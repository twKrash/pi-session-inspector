import {
  type AutocompleteSuggestions,
  CombinedAutocompleteProvider,
} from "@earendil-works/pi-tui";
import { completeInspectorCommand } from "../../../src/commands/completions.ts";

/** The two names `src/index.ts` registers for the same completion function. */
const COMMAND_NAMES = ["session-inspector", "session-ins"] as const;

/**
 * The real pinned provider, wired the way the extension registers it: every
 * command name shares one `getArgumentCompletions`.
 */
const provider = new CombinedAutocompleteProvider(
  COMMAND_NAMES.map((name) => ({
    name,
    getArgumentCompletions: (prefix: string) =>
      completeInspectorCommand(prefix),
  })),
  "/tmp",
);

/**
 * `getSuggestions` as the editor calls it for slash-command arguments:
 * `handleSlashCommandCompletion` requests `{ force: false }`, because
 * `force: true` is the file-completion path and skips the command branch.
 */
function suggest(
  line: string,
  cursor: number,
): Promise<AutocompleteSuggestions | null> {
  return provider.getSuggestions([line], 0, cursor, {
    signal: new AbortController().signal,
    force: false,
  });
}

/** The boundary suggestion labels, for filtering assertions. */
export async function suggestionLabelsFor(
  line: string,
  cursor: number,
): Promise<string[] | null> {
  const suggestions = await suggest(line, cursor);
  return suggestions === null
    ? null
    : suggestions.items.map((item) => item.label);
}

/** Drives the real provider: suggest → select → apply, exactly as the editor does. */
export async function applyCompletionFor(
  line: string,
  cursor: number,
  label: string,
): Promise<{ line: string; cursor: number }> {
  const lines = [line];
  const suggestions = await suggest(line, cursor);
  if (suggestions === null) throw new Error("no suggestions");
  const item = suggestions.items.find((candidate) => candidate.label === label);
  if (item === undefined) throw new Error(`no item labelled ${label}`);
  const applied = provider.applyCompletion(
    lines,
    0,
    cursor,
    item,
    suggestions.prefix,
  );
  return { line: applied.lines[0] as string, cursor: applied.cursorCol };
}

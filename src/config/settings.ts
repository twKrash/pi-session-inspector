import { readFileSync, statSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";

/** The Inspector-owned settings schema (ADR 0019); intentionally small. */
export type InspectorSettings = {
  theme?: "dark" | "light";
  debug?: boolean;
};

/**
 * Bounded, closed-enum settings diagnostics; never producer text.
 *
 * `settings-missing` is deliberately absent: no settings file is a normal
 * configuration, not a failure. A file that exists but cannot be read is the
 * failure this vocabulary names.
 */
export type SettingsDiagnostic =
  | "settings-unreadable"
  | "settings-malformed"
  | "settings-oversized";

export type SettingsRead = {
  settings: InspectorSettings;
  diagnostics: readonly SettingsDiagnostic[];
};

/** Upper bound for the whole settings document, in UTF-8 bytes. */
export const MAX_SETTINGS_BYTES = 64 * 1024;

const DEFAULT_SETTINGS: InspectorSettings = {};

/**
 * Parses a settings document. Every failure mode degrades to the product
 * defaults with a bounded diagnostic: malformed settings must never prevent
 * Inspector from starting, and an unknown key is ignored rather than guessed.
 *
 * The bound is measured in UTF-8 bytes, because that is what the file costs and
 * what a multi-byte document would otherwise slip past a code-unit check.
 */
export function parseSettings(text: string): SettingsRead {
  if (Buffer.byteLength(text, "utf8") > MAX_SETTINGS_BYTES) {
    return { settings: DEFAULT_SETTINGS, diagnostics: ["settings-oversized"] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { settings: DEFAULT_SETTINGS, diagnostics: ["settings-malformed"] };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { settings: DEFAULT_SETTINGS, diagnostics: ["settings-malformed"] };
  }
  const record = parsed as Record<string, unknown>;
  const settings: InspectorSettings = {};
  if (record.theme === "dark" || record.theme === "light") {
    settings.theme = record.theme;
  }
  if (typeof record.debug === "boolean") settings.debug = record.debug;
  return { settings, diagnostics: [] };
}

/**
 * Synchronous settings read for the session-start path, which must install the
 * debug sink before any live observation without reordering Pi's lifecycle
 * callbacks. One bounded file read, once per session; every failure degrades to
 * the defaults, and only a genuinely unreadable file is a diagnostic.
 */
export function readSettingsSync(path: string): SettingsRead {
  try {
    const size = statSync(path).size;
    // The size is checked before the read, so an oversized file is never
    // loaded: the bound is on bytes read, not on bytes parsed.
    if (size > MAX_SETTINGS_BYTES) {
      return { settings: DEFAULT_SETTINGS, diagnostics: ["settings-oversized"] };
    }
    return parseSettings(readFileSync(path, "utf8"));
  } catch (error) {
    return readFailure(error);
  }
}

/** Reads and parses the settings file; a missing file is simply no settings. */
export async function readSettings(path: string): Promise<SettingsRead> {
  try {
    const size = (await stat(path)).size;
    if (size > MAX_SETTINGS_BYTES) {
      return { settings: DEFAULT_SETTINGS, diagnostics: ["settings-oversized"] };
    }
    return parseSettings(await readFile(path, "utf8"));
  } catch (error) {
    return readFailure(error);
  }
}

/**
 * A missing settings document is the default configuration; anything else that
 * prevents the read (permissions, a directory, an I/O error) is reported as
 * unreadable so a real failure is never mistaken for "not configured".
 */
function readFailure(error: unknown): SettingsRead {
  const code = (error as { code?: unknown } | undefined)?.code;
  if (code === "ENOENT" || code === "ENOTDIR") {
    return { settings: DEFAULT_SETTINGS, diagnostics: [] };
  }
  return { settings: DEFAULT_SETTINGS, diagnostics: ["settings-unreadable"] };
}

/** Resolved Inspector configuration, with the source of each value. */
export type ResolvedConfig = {
  theme: "light" | "dark";
  debug: boolean;
  themeSource: "cli" | "settings" | "default";
  debugSource: "cli" | "settings" | "default";
};

/**
 * Resolves configuration by precedence: an explicit CLI option wins over
 * `settings.json`, which wins over the product default. A browser-local theme
 * toggle is deliberately not part of this resolution.
 */
export function resolveConfig(input: {
  settings: InspectorSettings;
  cli: { theme?: "dark" | "light"; debug?: boolean };
}): ResolvedConfig {
  const theme = input.cli.theme ?? input.settings.theme ?? "light";
  const debug = input.cli.debug ?? input.settings.debug ?? false;
  return {
    theme,
    debug,
    themeSource:
      input.cli.theme !== undefined
        ? "cli"
        : input.settings.theme !== undefined
          ? "settings"
          : "default",
    debugSource:
      input.cli.debug !== undefined
        ? "cli"
        : input.settings.debug !== undefined
          ? "settings"
          : "default",
  };
}

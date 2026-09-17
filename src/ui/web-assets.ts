/**
 * The one known-asset loader (ADR 0018): the three ordinary browser files under
 * `src/ui/web/`, read once at module load.
 *
 * Two of them are authored bytes; `client.bundle.js` is the generated classic
 * asset that `npm run build:web` produces from the authored sources in
 * `scripts/web/` and that `npm run build:web:check` keeps fresh. Author and
 * generated output are deliberately named apart, so a diff never has to guess
 * which file is source.
 *
 * It is data, not a filesystem surface: there is no path parameter, no directory
 * scan, no lookup by name and no dynamic specifier, so nothing outside these
 * three files can ever be read through it. The server serves exactly these
 * bytes, and the static snapshot inlines the same stylesheet bytes
 * (`snapshot.ts`), so the interactive application and the archived document
 * cannot drift apart.
 */
import { readFileSync } from "node:fs";

export const WEB_ASSETS = {
  shell: readFileSync(new URL("./web/shell.html", import.meta.url), "utf8"),
  style: readFileSync(new URL("./web/style.css", import.meta.url), "utf8"),
  client: readFileSync(
    new URL("./web/client.bundle.js", import.meta.url),
    "utf8",
  ),
} as const;

/** The theme a shell is rendered in; the same closed pair a snapshot takes. */
export type ShellTheme = "light" | "dark";

/**
 * The shell with the resolved theme already in effect, exactly as the static
 * snapshot renders it. The reader's theme is configuration, so it is present in
 * the first paint instead of waiting for a payload to state it; the in-page
 * toggle still switches the document it is on and persists nothing.
 *
 * Presentation only: the one injected value is a closed enum's own class name,
 * so no report, session, evidence, or path value can reach the shell through
 * this seam. The light theme returns the shipped bytes unchanged.
 */
export function renderShell(theme: ShellTheme): string {
  return theme === "dark"
    ? WEB_ASSETS.shell.replace("<body>", '<body class="theme-dark">')
    : WEB_ASSETS.shell;
}

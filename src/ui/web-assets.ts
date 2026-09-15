/**
 * The one known-asset loader (ADR 0018): the three browser assets under
 * `src/ui/web/` (including generated `client.js`), read once at module load.
 *
 * It is data, not a filesystem surface: there is no path parameter, no directory
 * scan, no lookup by name and no dynamic specifier, so nothing outside these
 * three files can ever be read through it. The server serves exactly these
 * bytes, and the static snapshot inlines the same stylesheet bytes (`snapshot.ts`),
 * so the interactive application and the archived document cannot drift apart.
 */
import { readFileSync } from "node:fs";

export const WEB_ASSETS = {
  shell: readFileSync(new URL("./web/shell.html", import.meta.url), "utf8"),
  style: readFileSync(new URL("./web/style.css", import.meta.url), "utf8"),
  client: readFileSync(new URL("./web/client.js", import.meta.url), "utf8"),
} as const;

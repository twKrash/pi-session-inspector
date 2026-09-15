import { defineIntegration } from "../catalog.ts";
import { toolCallNames } from "./shared.ts";

/**
 * The native tool vocabulary the Lens integration owns. `pi-lens` registers
 * `lens_*` (for example `lens_diagnostics`), `pi_lens_*`, `lsp_*`, and
 * `ast_grep*` tools, and older versions registered a bare `lens` tool.
 *
 * Presence and evidence deliberately share this one vocabulary: presence is
 * "a Lens tool is installed" and evidence is "a Lens tool was called". They
 * stay different claims — an installed tool with no call is `Present /
 * Unavailable`, never a fabricated count — but they can no longer disagree
 * about what a Lens tool *is*.
 */
const LENS_TOOL_PREFIXES = ["lens_", "pi_lens_", "lsp_", "ast_grep"];
const LENS_TOOL = "lens";

function isLensTool(name: string): boolean {
  return (
    name === LENS_TOOL ||
    LENS_TOOL_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}

export const lensIntegration = defineIntegration({
  key: "lens",
  schemas: { 1: { counters: ["calls"] } },
  hooks: {
    presence: ({ tools }) => (tools.some(isLensTool) ? "present" : "absent"),
    persisted: ({ entries }) => {
      let calls = 0;
      for (const entry of entries) {
        const names = toolCallNames(entry);
        if (names === undefined) continue;
        calls += names.filter(isLensTool).length;
      }
      if (calls === 0) return undefined;
      return {
        integration: "lens",
        state: "supported",
        version: 1,
        counters: { calls },
        reason: "evidence-supported",
      } as const;
    },
  },
});

import {
  getAgentDir,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { registerSessionStartTracking } from "./pi/session-start.ts";
import { trackPiSession } from "./pi/tracking-pi.ts";

type SessionStartTrackingApi = Parameters<
  typeof registerSessionStartTracking
>[0];
type SessionTracker = Parameters<typeof registerSessionStartTracking>[2];

const description = "Open Pi Session Inspector (placeholder)";

/** Wires Pi session-start observation to the Inspector tracking root. */
export function registerTracking(
  api: SessionStartTrackingApi,
  { agentDir, track }: { agentDir: string; track: SessionTracker },
): void {
  registerSessionStartTracking(
    api,
    join(agentDir, "session-inspector", "v1"),
    track,
  );
}

export default function registerSessionInspector(pi: ExtensionAPI): void {
  registerTracking(pi as unknown as SessionStartTrackingApi, {
    agentDir: getAgentDir(),
    track: trackPiSession,
  });

  for (const name of ["session-inspector", "session-ins"]) {
    pi.registerCommand(name, {
      description,
      handler: async (_args, ctx) => {
        if (ctx.mode !== "tui") {
          ctx.ui.notify("Pi Session Inspector is not implemented yet.", "info");
          return;
        }

        await ctx.ui.custom((_tui, theme, _keybindings, done) => ({
          render: (width) =>
            [
              theme.fg("accent", "Pi Session Inspector"),
              "",
              "Placeholder UI. Replay and tracking arrive in later milestones.",
              "",
              theme.fg("dim", "Press any key to close."),
            ].map((line) => line.slice(0, width)),
          invalidate: () => {},
          handleInput: () => done(undefined),
        }));
      },
    });
  }
}

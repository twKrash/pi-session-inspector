import {
  getAgentDir,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { registerLiveWal, type LiveWalWriter } from "./pi/live-wal.ts";
import type { LiveObserverApi } from "./pi/live.ts";
import { registerSessionStartTracking } from "./pi/session-start.ts";
import { setupSessionWal } from "./pi/session-wal.ts";
import { trackPiSession } from "./pi/tracking-pi.ts";
import { createWalWriter } from "./storage/wal.ts";

type SessionStartTrackingApi = Parameters<
  typeof registerSessionStartTracking
>[0];
type SessionTracker = Parameters<typeof registerSessionStartTracking>[2];
type SessionWalSetup = (input: {
  root: string;
  sessionId: string;
  api: unknown;
}) => Promise<void>;

const description = "Open Pi Session Inspector (placeholder)";

/** Wires Pi session-start observation to the Inspector tracking root. */
export function registerTracking(
  api: SessionStartTrackingApi,
  {
    agentDir,
    track,
    setupSessionWal: setup,
  }: {
    agentDir: string;
    track: SessionTracker;
    setupSessionWal: SessionWalSetup;
  },
): void {
  registerSessionStartTracking(
    api,
    join(agentDir, "session-inspector", "v1"),
    async (input) => {
      const tracked = await track(input);
      if (tracked) {
        await setup({ root: input.root, sessionId: input.sessionId, api });
      }
      return tracked;
    },
  );
}

function setupProductionSessionWal(input: {
  root: string;
  sessionId: string;
  api: unknown;
}): Promise<void> {
  return setupSessionWal(input, {
    createWriter: ({ root }) =>
      createWalWriter({ root, now: () => new Date() }),
    registerLive: (api, writer) =>
      registerLiveWal(api as LiveObserverApi, writer as LiveWalWriter, {
        now: () => new Date(),
        randomId: randomUUID,
      }),
  });
}

export default function registerSessionInspector(pi: ExtensionAPI): void {
  registerTracking(pi as unknown as SessionStartTrackingApi, {
    agentDir: getAgentDir(),
    track: trackPiSession,
    setupSessionWal: setupProductionSessionWal,
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

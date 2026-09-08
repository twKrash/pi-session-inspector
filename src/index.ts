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
import { scheduleMaintenance } from "./storage/maintenance.ts";
import { createCurrentTuiComponent } from "./ui/current-tui.ts";
import { loadCurrentSessionReport } from "./ui/load-current.ts";

type SessionStartTrackingApi = Parameters<
  typeof registerSessionStartTracking
>[0];
type SessionTracker = Parameters<typeof registerSessionStartTracking>[2];
type SessionWalSetup = (input: {
  root: string;
  sessionId: string;
  sessionFile: string;
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
    schedule = scheduleProductionMaintenance,
  }: {
    agentDir: string;
    track: SessionTracker;
    setupSessionWal: SessionWalSetup;
    schedule?(input: {
      root: string;
      sessionId: string;
      sessionFile: string;
    }): void;
  },
): void {
  registerSessionStartTracking(
    api,
    join(agentDir, "session-inspector", "v1"),
    async (input) => {
      const tracked = await track(input);
      if (tracked) {
        try {
          schedule({
            root: input.root,
            sessionId: input.sessionId,
            sessionFile: input.sessionFile,
          });
        } catch {
          // Detached maintenance must not affect tracking or Pi.
        }
        await setup({
          root: input.root,
          sessionId: input.sessionId,
          sessionFile: input.sessionFile,
          api,
        });
      }
      return tracked;
    },
  );
}

function scheduleProductionMaintenance({
  root,
  sessionId,
  sessionFile,
}: {
  root: string;
  sessionId: string;
  sessionFile: string;
}): void {
  scheduleMaintenance({ root, sessionId, sessionFile, writerId: randomUUID() });
}

function setupProductionSessionWal(input: {
  root: string;
  sessionId: string;
  sessionFile: string;
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

function notifyCurrentUnavailable(ctx: {
  ui: { notify(message: string, level: "info"): void };
}): void {
  try {
    ctx.ui.notify("Current session Inspector data is unavailable.", "info");
  } catch {
    // Command-side UI failures must not affect Pi.
  }
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
        try {
          if (ctx.mode !== "tui") {
            notifyCurrentUnavailable(ctx);
            return;
          }

          const model = await loadCurrentSessionReport(
            ctx.sessionManager.getSessionFile(),
            "active",
            ctx.sessionManager.getLeafId(),
          );
          if (!model) {
            notifyCurrentUnavailable(ctx);
            return;
          }

          await ctx.ui.custom((tui, theme, _keybindings, done) =>
            createCurrentTuiComponent({
              model,
              theme,
              requestRender: () => tui.requestRender(),
              done: () => done(undefined),
            }),
          );
        } catch {
          notifyCurrentUnavailable(ctx);
        }
      },
    });
  }
}

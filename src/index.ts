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
import { readPublicSubagentArtifact } from "./integrations/subagents.ts";
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

const description = "Open current Pi Session Inspector";
const SUBAGENTS_ARTIFACT_OPTION = "--subagents-artifact";

type CurrentCommandOptions = { subagentArtifactPath?: string };

/** Parses only the current-view command and its one documented local option. */
function parseCurrentCommand(args: string): CurrentCommandOptions | undefined {
  const tokens = tokenizeCommand(args);
  if (tokens === undefined) return undefined;
  if (tokens.length === 0 || (tokens.length === 1 && tokens[0] === "current")) {
    return {};
  }

  const offset = tokens[0] === "current" ? 1 : 0;
  if (
    tokens.length === offset + 2 &&
    tokens[offset] === SUBAGENTS_ARTIFACT_OPTION &&
    tokens[offset + 1]
  ) {
    return { subagentArtifactPath: tokens[offset + 1] };
  }
  return undefined;
}

/** Splits command text while preserving local path characters. */
function tokenizeCommand(input: string): string[] | undefined {
  const tokens: string[] = [];
  let token = "";
  let quote: '"' | "'" | undefined;

  for (const character of input.trim()) {
    if (quote) {
      if (character === quote) quote = undefined;
      else token += character;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (/\s/.test(character)) {
      if (token) {
        tokens.push(token);
        token = "";
      }
    } else {
      token += character;
    }
  }

  if (quote) return undefined;
  if (token) tokens.push(token);
  return tokens;
}

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
  notifyInfo(ctx, "Current session Inspector data is unavailable.");
}

function notifyUnsupportedCurrentArgument(ctx: {
  ui: { notify(message: string, level: "info"): void };
}): void {
  notifyInfo(ctx, "Only the current session Inspector view is available.");
}

function notifyInfo(
  ctx: { ui: { notify(message: string, level: "info"): void } },
  message: string,
): void {
  try {
    ctx.ui.notify(message, "info");
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
          const options = parseCurrentCommand(_args);
          if (!options) {
            notifyUnsupportedCurrentArgument(ctx);
            return;
          }
          if (ctx.mode !== "tui") {
            notifyCurrentUnavailable(ctx);
            return;
          }

          const sessionFile = ctx.sessionManager.getSessionFile();
          const leafId = ctx.sessionManager.getLeafId();
          const subagentArtifact = await readPublicSubagentArtifact(
            options.subagentArtifactPath,
          );
          const model = await loadCurrentSessionReport(
            sessionFile,
            "active",
            leafId,
            subagentArtifact,
          );
          if (!model) {
            notifyCurrentUnavailable(ctx);
            return;
          }

          await ctx.ui.custom((tui, theme, _keybindings, done) =>
            createCurrentTuiComponent({
              model,
              load: (scope) =>
                loadCurrentSessionReport(
                  sessionFile,
                  scope,
                  leafId,
                  subagentArtifact,
                ),
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

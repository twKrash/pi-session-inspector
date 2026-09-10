import {
  getAgentDir,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Scope } from "./core/events.ts";
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
import { loadGlobalReport, loadHistoryReports } from "./ui/load-history.ts";
import { renderHtml } from "./ui/html.ts";
import { renderJson } from "./ui/json.ts";
import { generatedReportPath, writeReportOutput } from "./ui/report-output.ts";

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

const description = "Open Pi Session Inspector reports";
const SUBAGENTS_ARTIFACT_OPTION = "--subagents-artifact";

type ReportKind = "current" | "history" | "global" | "ledger";
type ReportFormat = "tui" | "html" | "json";
type CommandOptions = {
  kind: ReportKind;
  scope: Scope;
  format: ReportFormat;
  output?: string;
  noOpen: boolean;
  subagentArtifactPath?: string;
};

/** Parses documented command options without accepting unknown or partial input. */
export function parseReportCommand(args: string): CommandOptions | undefined {
  const tokens = tokenizeCommand(args);
  if (tokens === undefined) return undefined;
  let kind: ReportKind = "current";
  if (["current", "history", "global", "ledger"].includes(tokens[0] ?? ""))
    kind = tokens.shift() as ReportKind;
  let scope: Scope =
    kind === "current" || kind === "ledger" ? "active" : "tree";
  let format: ReportFormat = kind === "global" ? "html" : "tui";
  let output: string | undefined;
  let noOpen = false;
  let subagentArtifactPath: string | undefined;
  while (tokens.length > 0) {
    const option = tokens.shift();
    if (option === "--scope") {
      const value = tokens.shift();
      if (value !== "active" && value !== "tree") return undefined;
      scope = value;
    } else if (option === "--format") {
      const value = tokens.shift();
      if (value !== "tui" && value !== "html" && value !== "json")
        return undefined;
      format = value;
    } else if (option === "--output") {
      const value = tokens.shift();
      if (!value) return undefined;
      output = value;
    } else if (option === "--no-open") {
      noOpen = true;
    } else if (option === SUBAGENTS_ARTIFACT_OPTION) {
      const value = tokens.shift();
      if (!value) return undefined;
      subagentArtifactPath = value;
    } else return undefined;
  }
  if ((kind === "history" || kind === "global") && scope === "active") {
    return undefined;
  }
  return {
    kind,
    scope,
    format,
    ...(output ? { output } : {}),
    noOpen,
    ...(subagentArtifactPath ? { subagentArtifactPath } : {}),
  };
}

/** Splits command text while preserving quoted local path characters. */
function tokenizeCommand(input: string): string[] | undefined {
  const tokens: string[] = [];
  let token = "";
  let quote: '"' | "'" | undefined;
  for (const character of input.trim()) {
    if (quote) {
      if (character === quote) quote = undefined;
      else token += character;
    } else if (character === '"' || character === "'") quote = character;
    else if (/\s/.test(character)) {
      if (token) {
        tokens.push(token);
        token = "";
      }
    } else token += character;
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

function notifyUnsupportedCommand(ctx: {
  ui: { notify(message: string, level: "info"): void };
}): void {
  notifyInfo(ctx, "Inspector command options are unavailable.");
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

async function loadCommandReport(
  options: CommandOptions,
  input: {
    root: string;
    sessionFile: string | undefined;
    leafId: string | null;
    sessionDirectory: () => string;
    subagentArtifact?: unknown;
  },
): Promise<
  | { dto: unknown; html: Parameters<typeof renderHtml>[0]; name: string }
  | undefined
> {
  const maintenance = {
    writerId: randomUUID(),
    now: () => new Date(),
    isPidAlive: () => false,
  };
  if (options.kind === "current" || options.kind === "ledger") {
    const model = await loadCurrentSessionReport(
      input.sessionFile,
      options.scope,
      input.leafId,
      input.subagentArtifact,
    );
    return model
      ? {
          dto: model.report,
          html: { kind: "current", report: model.report, scope: options.scope },
          name: model.report.sessionId,
        }
      : undefined;
  }
  const common = {
    root: input.root,
    sessionDirectory: input.sessionDirectory,
    scope: options.scope,
    maintenance,
  };
  if (options.kind === "history") {
    const report = await loadHistoryReports(common);
    return { dto: report, html: { kind: "history", report }, name: "history" };
  }
  const report = await loadGlobalReport(common);
  return { dto: report, html: { kind: "global", report }, name: "global" };
}

export async function openReport(
  ctx: { exec(command: string, args: string[]): Promise<unknown> },
  output: string,
): Promise<void> {
  if (process.platform === "darwin")
    return void (await ctx.exec("open", [output]));
  if (process.platform === "win32")
    return void (await ctx.exec("rundll32", [
      "url.dll,FileProtocolHandler",
      output,
    ]));
  await ctx.exec("xdg-open", [output]);
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
      handler: async (args, ctx) => {
        try {
          const options = parseReportCommand(args);
          if (!options) return notifyUnsupportedCommand(ctx);
          const sessionManager = ctx.sessionManager;
          const root = join(getAgentDir(), "session-inspector", "v1");
          const cacheDirectory = join(root, "reports");
          if (options.format === "tui") {
            if (options.kind !== "current" && options.kind !== "ledger") {
              notifyCurrentUnavailable(ctx);
              return;
            }
            if (ctx.mode !== "tui") return notifyCurrentUnavailable(ctx);
            const sessionFile = sessionManager.getSessionFile();
            const leafId = sessionManager.getLeafId();
            const subagentArtifact = await readPublicSubagentArtifact(
              options.subagentArtifactPath,
            );
            const model = await loadCurrentSessionReport(
              sessionFile,
              options.scope,
              leafId,
              subagentArtifact,
            );
            if (!model) return notifyCurrentUnavailable(ctx);
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
                initialTab: options.kind === "ledger" ? "ledger" : "overview",
              }),
            );
            return;
          }
          const subagentArtifact = await readPublicSubagentArtifact(
            options.subagentArtifactPath,
          );
          const report = await loadCommandReport(options, {
            root,
            sessionFile: sessionManager.getSessionFile(),
            leafId: sessionManager.getLeafId(),
            sessionDirectory: () => sessionManager.getSessionDir(),
            subagentArtifact,
          });
          if (!report) return notifyCurrentUnavailable(ctx);
          const content =
            options.format === "json"
              ? renderJson(report.dto)
              : renderHtml(report.html);
          const extension = options.format === "json" ? "json" : "html";
          const generated = generatedReportPath(
            cacheDirectory,
            report.name,
            extension,
          );
          const output = await writeReportOutput({
            path: options.output ?? generated,
            content,
            cacheDirectory,
            explicit: options.output !== undefined,
          });
          if (!output) return notifyCurrentUnavailable(ctx);
          notifyInfo(ctx, `Inspector report written: ${output}`);
          if (options.format === "html" && !options.noOpen) {
            try {
              await openReport(
                ctx as unknown as {
                  exec(command: string, args: string[]): Promise<unknown>;
                },
                output,
              );
            } catch {
              notifyInfo(ctx, `Inspector report available at: ${output}`);
            }
          }
        } catch {
          notifyCurrentUnavailable(ctx);
        }
      },
    });
  }
}

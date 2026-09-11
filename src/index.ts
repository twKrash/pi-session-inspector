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
      if (!value || value.startsWith("--")) return undefined;
      output = value;
    } else if (option === "--no-open") {
      noOpen = true;
    } else if (option === SUBAGENTS_ARTIFACT_OPTION) {
      const value = tokens.shift();
      if (!value || value.startsWith("--")) return undefined;
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
  let started = false;
  let quote: '"' | "'" | undefined;
  for (const character of input.trim()) {
    if (!/\s/.test(character) || quote) started = true;
    if (quote) {
      if (character === quote) quote = undefined;
      else token += character;
    } else if (character === '"' || character === "'") quote = character;
    else if (/\s/.test(character)) {
      if (started) {
        tokens.push(token);
        token = "";
        started = false;
      }
    } else token += character;
  }
  if (quote) return undefined;
  if (started) tokens.push(token);
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
    createWriter: ({ root, onSegmentRotation }) =>
      createWalWriter({ root, now: () => new Date(), onSegmentRotation }),
    registerLive: (api, writer) =>
      registerLiveWal(api as LiveObserverApi, writer as LiveWalWriter, {
        now: () => new Date(),
        randomId: randomUUID,
      }),
    scheduleMaintenance: scheduleProductionMaintenance,
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
    isPidAlive: (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        return !(
          error instanceof Error &&
          "code" in error &&
          error.code === "ESRCH"
        );
      }
    },
  };
  if (options.kind === "current" || options.kind === "ledger") {
    const model = await loadCurrentSessionReport(
      input.sessionFile,
      options.scope,
      input.leafId,
      input.subagentArtifact,
      input.root,
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

/** Opens only via Pi's public argv-based execution API; diagnostics omit process output. */
export async function openReport(
  pi: Pick<ExtensionAPI, "exec">,
  output: string,
): Promise<void> {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "rundll32"
        : "xdg-open";
  const args =
    process.platform === "win32"
      ? ["url.dll,FileProtocolHandler", output]
      : [output];
  const result = await pi.exec(command, args);
  if (result.code !== 0 || result.killed)
    throw new Error("Report opener unavailable");
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
              notifyInfo(
                ctx,
                "History/global TUI is unavailable; use --format html or --format json.",
              );
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
              root,
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
                    root,
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
            options.kind,
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
              await openReport(pi, output);
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

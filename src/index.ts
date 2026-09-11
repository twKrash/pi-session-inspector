import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  type ExtensionAPI,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { completeInspectorCommand } from "./commands/completions.ts";
import { parseInspectorCommand } from "./commands/grammar.ts";
import { createInspectorHelpComponent } from "./commands/help.ts";
import {
  foldedFromCheckpointAggregates,
  mergeFoldedCounters,
} from "./core/live-counter-fold.ts";
import type { InventorySnapshot } from "./integrations/inventory.ts";
import {
  type LiveCounterApi,
  type LiveCounterWriter,
  registerLiveCounters as registerLiveCounterProducers,
} from "./integrations/live-counters.ts";
import { readIntegrationPresence } from "./integrations/presence.ts";
import type { LiveObserverApi } from "./pi/live.ts";
import { type LiveWalWriter, registerLiveWal } from "./pi/live-wal.ts";
import {
  readSessionInventory,
  refreshSessionInventory,
  registerSessionStartTracking,
} from "./pi/session-start.ts";
import { setupSessionWal } from "./pi/session-wal.ts";
import { trackPiSession } from "./pi/tracking-pi.ts";
import { readCheckpoint } from "./storage/checkpoint.ts";
import { refreshInventorySnapshot } from "./storage/inventory-snapshot.ts";
import { scheduleMaintenance } from "./storage/maintenance.ts";
import { recoverSession } from "./storage/recovery.ts";
import { createWalWriter } from "./storage/wal.ts";
import { loadInspectorBundle } from "./ui/bundle.ts";
import { createCurrentTuiComponent } from "./ui/current-tui.ts";
import { renderInspectorBundle } from "./ui/html.ts";
import { renderJson } from "./ui/json.ts";
import { loadCurrentSessionReport } from "./ui/load-current.ts";
import { loadGlobalReport, loadHistoryReports } from "./ui/load-history.ts";
import type { SessionObservation } from "./ui/observation.ts";
import { generatedReportPath, writeReportOutput } from "./ui/report-output.ts";

type SessionStartTrackingApi = Parameters<
  typeof registerSessionStartTracking
>[0];
type ReportInventoryApi = Parameters<typeof refreshSessionInventory>[0]["api"];
type SessionTracker = Parameters<typeof registerSessionStartTracking>[2];
type SessionWalSetup = (input: {
  root: string;
  sessionId: string;
  sessionFile: string;
  api: unknown;
}) => Promise<void>;

const description = "Open Pi Session Inspector reports";

/**
 * Live observer handle for the active session. Report reads flush it first so
 * the WAL contains every already-observed event before counters are computed.
 */
let liveWriter: LiveWalWriter | undefined;
/** Live `permissions:ready` sighting in this process; durable presence is folded. */
let liveReady = false;
/** Sanitized inventory of the active tracked session, read after promotion. */
let liveInventory: InventorySnapshot | undefined;
/** Bounded skill names the live counter producers may count. */
let liveInventoryNames: ReadonlySet<string> = new Set<string>();
/** Active tracked session location, used to refresh the snapshot on reload. */
let liveInventoryScope: { root: string; sessionId: string } | undefined;

function rememberInventory(
  inventory: InventorySnapshot,
  scope: { root: string; sessionId: string },
): void {
  liveInventory = inventory;
  liveInventoryNames = new Set(inventory.skills.map((skill) => skill.name));
  liveInventoryScope = scope;
}

/** Flushes live evidence before a report read; failures never affect Pi. */
export async function flushLiveEvidence(): Promise<void> {
  try {
    await liveWriter?.flush();
  } catch {
    // Flush failures must not affect reports or Pi.
  }
}

const NO_PI_SOURCE_CURSOR = { lineCount: 0, revision: "0".repeat(64) };

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
        // Build synchronously so the counter allowlist is ready before WAL
        // setup; persistence is detached and observer-only. An unreadable
        // inventory stays absent so no fabricated zero counts are reported.
        const scope = { root: input.root, sessionId: input.sessionId };
        liveInventoryScope = scope;
        const snapshot = readSessionInventory(api);
        if (snapshot === undefined) {
          liveInventory = undefined;
          liveInventoryNames = new Set<string>();
        } else {
          rememberInventory(snapshot, scope);
          void refreshInventorySnapshot({
            directory: join(input.root, "sessions", input.sessionId),
            snapshot,
          }).catch(() => undefined);
        }
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
  const inventory = liveInventory;
  scheduleMaintenance({
    root,
    sessionId,
    sessionFile,
    writerId: randomUUID(),
    ...(inventory === undefined
      ? {}
      : {
          inventoryCounts: {
            commands: inventory.commands.length,
            skills: inventory.skills.length,
          },
        }),
  });
}

function setupProductionSessionWal(input: {
  root: string;
  sessionId: string;
  sessionFile: string;
  api: unknown;
}): Promise<void> {
  return setupSessionWal(input, {
    createWriter: async ({ root, onSegmentRotation }) => {
      const writer = await createWalWriter({
        root,
        now: () => new Date(),
        onSegmentRotation,
      });
      liveWriter = writer;
      return writer;
    },
    registerLive: (api, writer) =>
      registerLiveWal(api as LiveObserverApi, writer as LiveWalWriter, {
        now: () => new Date(),
        randomId: randomUUID,
      }),
    registerLiveCounters: (api, writer, context) => {
      registerLiveCounterProducers(
        api as LiveCounterApi,
        writer as LiveCounterWriter,
        { inventoryNames: context.inventoryNames, now: () => new Date() },
      );
      observePermissionsReady(api);
    },
    readInventoryNames: () => liveInventoryNames,
    scheduleMaintenance: scheduleProductionMaintenance,
  });
}

type PermissionBusApi = {
  events?: { on?(channel: string, handler: () => void): unknown };
};

/** Records a live `permissions:ready` sighting; presence only, never a counter. */
function observePermissionsReady(api: unknown): void {
  try {
    (api as PermissionBusApi).events?.on?.("permissions:ready", () => {
      liveReady = true;
    });
  } catch {
    // Live presence observation is observer-only.
  }
}

function readSessionId(sessionManager: unknown): string | undefined {
  try {
    const id = (
      sessionManager as { getSessionId?(): unknown } | undefined
    )?.getSessionId?.();
    return typeof id === "string" && id.length > 0 ? id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Re-reads the sanitized inventory when a report is loaded, the third refresh
 * trigger, so runtime registrations (commands/agents added after start, a
 * late-connecting MCP server) are captured at the next report load at the
 * latest. `refreshSessionInventory` hash-compares against the persisted
 * snapshot, so an unchanged row set writes nothing. Observer-only: an
 * unreadable producer keeps the last readable in-memory snapshot instead of
 * fabricating an empty one, and no failure reaches the report path or Pi.
 */
async function refreshReportInventory(
  api: ReportInventoryApi,
  scope: { root: string; sessionId: string },
): Promise<void> {
  try {
    const snapshot = await refreshSessionInventory({
      api,
      root: scope.root,
      sessionId: scope.sessionId,
    });
    if (snapshot !== undefined) rememberInventory(snapshot, scope);
  } catch {
    // Inventory refresh must never affect reports or Pi.
  }
}

/**
 * Builds the process-local observation the report loader consumes. Counters are
 * the effective `merge(on-disk checkpoint aggregates, post-cursor WAL delta)`;
 * the checkpoint read here is never written back. Presence is durable because
 * `counters.presence.permission` ORs every folded `permissions:ready` from
 * earlier processes, and derives from the current in-memory inventory; without
 * a readable inventory every non-permission key stays `unknown`, never a
 * guessed `absent`. The inventory snapshot is refreshed here before use.
 */
async function readSessionObservation(input: {
  api: ReportInventoryApi;
  root: string;
  sessionId: string | undefined;
}): Promise<SessionObservation | undefined> {
  if (input.sessionId === undefined) return undefined;
  try {
    // Report-load refresh before any snapshot is read or projected.
    await refreshReportInventory(input.api, {
      root: input.root,
      sessionId: input.sessionId,
    });
    const directory = join(input.root, "sessions", input.sessionId);
    const checkpoint = await readCheckpoint({ directory });
    const recovered = await recoverSession({
      directory,
      // Only the WAL-derived delta is consumed below; the checkpoint is its own
      // Pi-source baseline and `recovered.aggregates` is deliberately ignored.
      piCursor: checkpoint?.cursors.pi ?? NO_PI_SOURCE_CURSOR,
    });
    const counters = mergeFoldedCounters(
      foldedFromCheckpointAggregates(checkpoint?.aggregates),
      recovered.deltaCounters,
    );
    const inventory = liveInventory;
    return {
      presence: readIntegrationPresence({
        commands:
          inventory === undefined
            ? []
            : inventory.commands.map((row) => row.name),
        tools:
          inventory === undefined ? [] : Object.keys(inventory.toolSources),
        // Durable presence: the bus may have been observed in a previous process.
        permissionsReady: liveReady || counters.presence.permission,
        inventoryAvailable: inventory !== undefined,
      }),
      counters,
      ...(inventory === undefined ? {} : { inventory }),
    };
  } catch {
    return undefined;
  }
}

function notifyCurrentUnavailable(ctx: {
  ui: { notify(message: string, level: "info"): void };
}): void {
  notifyInfo(ctx, "Current session Inspector data is unavailable.");
}

function notifyWarning(
  ctx: { ui: { notify(message: string, level: "warning"): void } },
  message: string,
): void {
  try {
    ctx.ui.notify(message, "warning");
  } catch {
    // Command-side UI failures must not affect Pi.
  }
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

/** Maintenance options every report loader shares; the pid check never throws. */
function productionMaintenance(): {
  writerId: string;
  now: () => Date;
  isPidAlive: (pid: number) => boolean;
} {
  return {
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

  try {
    pi.on("resources_discover", (event) => {
      try {
        if (event.reason !== "reload") return;
        const scope = liveInventoryScope;
        if (scope === undefined) return;
        void refreshSessionInventory({
          api: pi,
          root: scope.root,
          sessionId: scope.sessionId,
        })
          .then((snapshot) => {
            // A failed refresh keeps the last readable snapshot rather than
            // substituting an empty one.
            if (snapshot !== undefined) rememberInventory(snapshot, scope);
          })
          .catch(() => undefined);
      } catch {
        // Inventory refresh is observer-only and must not alter Pi execution.
      }
    });
  } catch {
    // Resource-discovery registration is best-effort.
  }

  for (const name of ["session-inspector", "session-ins"]) {
    pi.registerCommand(name, {
      description,
      getArgumentCompletions: (prefix: string) =>
        completeInspectorCommand(prefix),
      handler: async (args, ctx) => {
        try {
          const parsed = parseInspectorCommand(args);
          if (!parsed.ok) {
            // Invalid syntax never guesses: surface the grammar's usage text.
            notifyWarning(ctx, parsed.message);
            return;
          }
          const command = parsed.command;
          if (command.kind === "help") {
            if (ctx.mode !== "tui") {
              notifyInfo(
                ctx,
                "Session Inspector help is available in the Pi TUI.",
              );
              return;
            }
            await ctx.ui.custom((_tui, theme, _keybindings, done) =>
              createInspectorHelpComponent({
                theme,
                done: () => done(undefined),
              }),
            );
            return;
          }
          const sessionManager = ctx.sessionManager;
          const root = join(getAgentDir(), "session-inspector", "v1");
          const cacheDirectory = join(root, "reports");
          // Flush live evidence before any report read so no observed event is
          // missing from the counters this command renders.
          await flushLiveEvidence();
          const sessionFile = sessionManager.getSessionFile();
          const leafId = sessionManager.getLeafId();
          const target = command.mode === "ui" ? "current" : command.target;
          const observation =
            command.mode === "ui" || target === "current" || target === "ledger"
              ? await readSessionObservation({
                  api: pi,
                  root,
                  sessionId: readSessionId(sessionManager),
                })
              : undefined;
          if (command.mode === "tui") {
            if (target !== "current" && target !== "ledger") {
              notifyInfo(
                ctx,
                "History/global TUI is unavailable; use `session-inspector ui` or `session-inspector json`.",
              );
              return;
            }
            if (ctx.mode !== "tui") return notifyCurrentUnavailable(ctx);
            const model = await loadCurrentSessionReport(
              sessionFile,
              command.scope,
              { leafId, observation, inspectorRoot: root },
            );
            if (!model) return notifyCurrentUnavailable(ctx);
            await ctx.ui.custom((tui, theme, _keybindings, done) =>
              createCurrentTuiComponent({
                model,
                load: (scope) =>
                  loadCurrentSessionReport(sessionFile, scope, {
                    leafId,
                    observation,
                    inspectorRoot: root,
                  }),
                theme,
                requestRender: () => tui.requestRender(),
                done: () => done(undefined),
                initialTab: target === "ledger" ? "ledger" : "overview",
              }),
            );
            return;
          }
          const maintenance = productionMaintenance();
          if (command.mode === "ui") {
            const bundle = await loadInspectorBundle({
              theme: command.theme ?? "light",
              initialScope: command.scope,
              root,
              sessionDirectory: () => sessionManager.getSessionDir(),
              current: { sessionFile, leafId },
              ...(observation === undefined ? {} : { observation }),
              maintenance,
            });
            const generated = generatedReportPath(
              cacheDirectory,
              "inspector",
              "html",
              "global",
            );
            const output = await writeReportOutput({
              path: command.output ?? generated,
              content: renderInspectorBundle(bundle),
              cacheDirectory,
              explicit: command.output !== undefined,
            });
            if (!output) return notifyCurrentUnavailable(ctx);
            notifyInfo(ctx, `Inspector report written: ${output}`);
            if (!command.noOpen) {
              try {
                await openReport(pi, output);
              } catch {
                notifyInfo(ctx, `Inspector report available at: ${output}`);
              }
            }
            return;
          }
          // json: deterministic export, never opens a browser.
          const common = {
            root,
            sessionDirectory: () => sessionManager.getSessionDir(),
            scope: "tree" as const,
            maintenance,
          };
          let dto: unknown;
          let reportName: string;
          if (target === "history") {
            dto = await loadHistoryReports(common);
            reportName = "history";
          } else if (target === "global") {
            dto = await loadGlobalReport(common);
            reportName = "global";
          } else {
            const model = await loadCurrentSessionReport(
              sessionFile,
              command.scope,
              { leafId, observation, inspectorRoot: root },
            );
            if (!model) return notifyCurrentUnavailable(ctx);
            dto = model.report;
            reportName = model.report.sessionId;
          }
          const generated = generatedReportPath(
            cacheDirectory,
            reportName,
            "json",
            target,
          );
          const output = await writeReportOutput({
            path: command.output ?? generated,
            content: renderJson(dto),
            cacheDirectory,
            explicit: command.output !== undefined,
          });
          if (!output) return notifyCurrentUnavailable(ctx);
          notifyInfo(ctx, `Inspector report written: ${output}`);
        } catch {
          notifyCurrentUnavailable(ctx);
        }
      },
    });
  }
}

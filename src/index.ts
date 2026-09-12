import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  type ExtensionAPI,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { completeInspectorCommand } from "./commands/completions.ts";
import { parseInspectorCommand } from "./commands/grammar.ts";
import { createInspectorHelpComponent } from "./commands/help.ts";
import type {
  FoldedAggregateEvidence,
  L0Evidence,
  LiveTimingObservation,
} from "./core/evidence.ts";
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
import { readSkillInvocations } from "./integrations/skill-invocations.ts";
import type { LiveObserverApi } from "./pi/live.ts";
import {
  type LiveWalRegistration,
  type LiveWalWriter,
  registerLiveWal,
} from "./pi/live-wal.ts";
import {
  readSessionInventory,
  refreshSessionInventory,
  registerSessionStartTracking,
} from "./pi/session-start.ts";
import { setupSessionWal } from "./pi/session-wal.ts";
import { trackPiSession } from "./pi/tracking-pi.ts";
import { readCheckpoint, type Checkpoint } from "./storage/checkpoint.ts";
import {
  boundInventorySnapshot,
  refreshInventorySnapshot,
} from "./storage/inventory-snapshot.ts";
import { scheduleMaintenance } from "./storage/maintenance.ts";
import { recoverSession, type RecoveredWalRecord } from "./storage/recovery.ts";
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
 * Live observer state kept per tracked session so a repeated promotion cannot
 * overwrite another session's writer/readiness/inventory, and so a second
 * registration for the same session never adds a duplicate listener set.
 */
type LiveSessionState = {
  writer?: LiveWalWriter;
  /** Bounded live-producer state (R29); its overflow count reaches L1. */
  live?: LiveWalRegistration;
  ready: boolean;
  inventory?: InventorySnapshot;
  inventoryNames: ReadonlySet<string>;
};
const liveSessions = new Map<string, LiveSessionState>();
/** Latest promoted session location, used to refresh the snapshot on reload. */
let liveInventoryScope: { root: string; sessionId: string } | undefined;

function liveSession(sessionId: string): LiveSessionState {
  let state = liveSessions.get(sessionId);
  if (state === undefined) {
    state = { ready: false, inventoryNames: new Set<string>() };
    liveSessions.set(sessionId, state);
  }
  return state;
}

function rememberInventory(
  inventory: InventorySnapshot,
  scope: { root: string; sessionId: string },
): void {
  // The persisted bound is applied once, at capture: every consumer of the
  // in-memory snapshot (reports, presence, counter allowlists) then sees the
  // same bounded rows the writer publishes, never the unbounded producer read.
  const bounded = boundInventorySnapshot(inventory);
  const state = liveSession(scope.sessionId);
  state.inventory = bounded;
  state.inventoryNames = new Set(bounded.skills.map((skill) => skill.name));
  liveInventoryScope = scope;
}

/** Flushes live evidence before a report read; failures never affect Pi. */
export async function flushLiveEvidence(): Promise<void> {
  const writers = [...liveSessions.values()]
    .map((state) => state.writer)
    .filter((writer): writer is LiveWalWriter => writer !== undefined);
  for (const writer of writers) {
    try {
      await writer.flush();
    } catch {
      // Flush failures must not affect reports or Pi.
    }
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
  const promotedSessions = new Set<string>();
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
          liveSession(input.sessionId).inventory = undefined;
          liveSession(input.sessionId).inventoryNames = new Set<string>();
        } else {
          rememberInventory(snapshot, scope);
          // R37: the session-start capture is a successful observation, so it
          // carries the observation time the retention/§14.2 contract needs.
          void refreshInventorySnapshot({
            directory: join(input.root, "sessions", input.sessionId),
            snapshot,
            observedAt: new Date().toISOString(),
          }).catch(() => undefined);
        }
        // Promotions are idempotent per session: a second `session_start` for
        // the same session must never register a second writer/listener set
        // (which would double-count the same bus events in the cursor fold).
        if (!promotedSessions.has(input.sessionId)) {
          promotedSessions.add(input.sessionId);
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
  const inventory = liveSessions.get(sessionId)?.inventory;
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
      // Keyed by session so a concurrent/repeated promotion never clobbers
      // another session's writer handle.
      liveSession(input.sessionId).writer = writer;
      return writer;
    },
    registerLive: (api, writer) => {
      // Keep the bounded registration: its saturating overflow count is the
      // live-source partiality signal L0 threads into L1 (R29).
      liveSession(input.sessionId).live = registerLiveWal(
        api as LiveObserverApi,
        writer as LiveWalWriter,
        {
          sessionId: input.sessionId,
          now: () => new Date(),
          randomId: randomUUID,
        },
      );
    },
    registerLiveCounters: (api, writer, context) => {
      registerLiveCounterProducers(
        api as LiveCounterApi,
        writer as LiveCounterWriter,
        {
          sessionId: context.sessionId,
          inventoryNames: context.inventoryNames,
          now: () => new Date(),
        },
      );
      observePermissionsReady(api, context.sessionId);
    },
    readInventoryNames: () => liveSession(input.sessionId).inventoryNames,
    scheduleMaintenance: scheduleProductionMaintenance,
  });
}

type PermissionBusApi = {
  events?: { on?(channel: string, handler: () => void): unknown };
};

/** Records a live `permissions:ready` sighting; presence only, never a counter. */
function observePermissionsReady(api: unknown, sessionId: string): void {
  try {
    (api as PermissionBusApi).events?.on?.("permissions:ready", () => {
      liveSession(sessionId).ready = true;
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
 * One session read's evidence: the unreconciled L0 bundle the canonical
 * builder consumes, the process-local observation older call sites still use,
 * and the live signals L1 needs (R29/R41).
 */
type SessionEvidenceRead = {
  evidence: L0Evidence;
  observation: SessionObservation;
  walRecords: RecoveredWalRecord[];
  liveOverflow: number;
};

/**
 * Reads one session's Inspector-owned evidence exactly once: the sanitized
 * inventory is refreshed, the checkpoint and WAL are read through their
 * validated readers, and the result is the *unreconciled* L0 bundle (atomic
 * skill invocations + live timings, folded checkpoint aggregates/resources)
 * plus the process-local observation and the retained WAL records. L1 owns
 * every merge, join and fold; nothing here reconciles, and no prompt, response,
 * tool payload, path, or secret can enter a fact. The checkpoint read is never
 * written back.
 */
async function readSessionEvidence(input: {
  api: ReportInventoryApi;
  root: string;
  sessionId: string | undefined;
}): Promise<SessionEvidenceRead | undefined> {
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
    const state = liveSessions.get(input.sessionId);
    const inventory = state?.inventory;
    // The observation keeps its documented contract (`counters` is always the
    // effective folded bucket, so durable permission presence survives a
    // previous process); the report DTO's counters come from L1's retained
    // aggregates instead, and only the L0 evidence below is unreconciled.
    const counters = mergeFoldedCounters(
      foldedFromCheckpointAggregates(checkpoint?.aggregates),
      recovered.deltaCounters,
    );
    return {
      evidence: {
        atomic: [
          ...readSkillInvocations({
            sessionId: input.sessionId,
            records: recovered.records,
          }),
          ...readLiveTimings({
            sessionId: input.sessionId,
            records: recovered.records,
            running: recovered.running,
          }),
        ],
        folded: foldedCheckpointEvidence(input.sessionId, checkpoint),
      },
      observation: {
        presence: readIntegrationPresence({
          // Only `source === "extension"` rows may signal extension presence; a
          // skill sharing the name must never be reported as the extension.
          extensionCommands:
            inventory === undefined
              ? []
              : inventory.commands
                  .filter((row) => row.source === "extension")
                  .map((row) => row.name),
          tools:
            inventory === undefined ? [] : Object.keys(inventory.toolSources),
          // Durable presence: the bus may have been observed in a previous
          // process, so the folded permission flag is ORed in.
          permissionsReady:
            (state?.ready ?? false) || counters.presence.permission,
          inventoryAvailable: inventory !== undefined,
        }),
        counters,
        ...(inventory === undefined ? {} : { inventory }),
      },
      walRecords: recovered.records,
      liveOverflow: state?.live?.liveOverflow() ?? 0,
    };
  } catch {
    return undefined;
  }
}

/**
 * Derives the L0 live-timing family from recovery's validated retained records
 * (R48) at the composition root, so no L2 module reads storage for it. Each
 * validated record yields at most one fact: the WAL's paired `unknown` status
 * is the completed state, `unsupported` categories stay unsupported, and any
 * record without a validated timing yields nothing — never a fabricated fact.
 *
 * P1.3/design §15.1 rule 6: a start boundary is `running` evidence only while it
 * has no complete partner, which is exactly what `recovery.running` reports; a
 * paired start's boundary is already carried by its complete record, so
 * re-emitting it as `running` would mark a fully paired WAL incomplete forever.
 */
function readLiveTimings(input: {
  sessionId: string;
  records: readonly RecoveredWalRecord[];
  running: readonly { eventId: string }[];
}): LiveTimingObservation[] {
  const open = new Set(input.running.map((record) => record.eventId));
  const facts: LiveTimingObservation[] = [];
  for (const record of input.records) {
    const timing = record.kind === "live_timing" ? record.timing : undefined;
    if (timing === undefined) continue;
    if (timing.status === "running" && !open.has(record.eventId)) continue;
    facts.push({
      factId: `live-timing:${record.eventId}`,
      sessionId: input.sessionId,
      kind: "live-timing",
      category: timing.category,
      status: timing.status === "unknown" ? "complete" : timing.status,
      ...(timing.subjectId === undefined
        ? {}
        : { subjectId: timing.subjectId }),
      ...(timing.startedAt === undefined
        ? {}
        : { startedAt: timing.startedAt }),
      ...(timing.endedAt === undefined ? {} : { endedAt: timing.endedAt }),
      ...(timing.durationMs === undefined
        ? {}
        : { durationMs: timing.durationMs }),
      provenance: {
        source: "inspector-wal",
        authority: "live",
        recordId: record.eventId,
        schemaVersion: 1,
      },
      time: { state: "known", at: record.timestamp, basis: "wal-observer" },
    });
  }
  return facts;
}

/**
 * Translates a validated checkpoint into folded L0 evidence: the aggregates
 * plus their exact cursor/seal boundary and observation times. A checkpoint is
 * its own Pi-source baseline, so the read never advances or rewrites it, and a
 * session without one carries no folded evidence (absence is never zero).
 */
function foldedCheckpointEvidence(
  sessionId: string,
  checkpoint: Checkpoint | undefined,
): FoldedAggregateEvidence[] {
  if (checkpoint === undefined) return [];
  const at = checkpoint.evidence?.checkpointedAt;
  const sealedThrough =
    checkpoint.sealingVersion === 1 ? { ...(checkpoint.sealedWal ?? {}) } : {};
  const detailExpiredBefore =
    checkpoint.evidence?.detailCoverage?.walDetailExpiredBefore;
  const time: FoldedAggregateEvidence["checkpointedAt"] =
    at === undefined
      ? { state: "unavailable" }
      : { state: "known", at, basis: "checkpoint-observer" };
  const evidence: FoldedAggregateEvidence[] = [
    {
      kind: "checkpoint-wal-aggregates",
      sessionId,
      foldedThrough: { ...checkpoint.cursors.wal },
      sealedThrough,
      ...(checkpoint.aggregates.integrationCounters === undefined
        ? {}
        : { integrationCounters: checkpoint.aggregates.integrationCounters }),
      ...(checkpoint.aggregates.skillInvocations === undefined
        ? {}
        : { skillInvocations: checkpoint.aggregates.skillInvocations }),
      ...(checkpoint.aggregates.skillOverflowInvocations === undefined
        ? {}
        : {
            skillOverflowInvocations:
              checkpoint.aggregates.skillOverflowInvocations,
          }),
      ...(checkpoint.aggregates.presence?.permission === true
        ? { presence: { permission: true } }
        : {}),
      ...(detailExpiredBefore === undefined ? {} : { detailExpiredBefore }),
      checkpointedAt: time,
      provenance: {
        source: "checkpoint",
        authority: "derived",
        schemaVersion: 1,
      },
    },
  ];
  const counts = checkpoint.aggregates.resourceCounts;
  if (counts !== undefined) {
    const observedAt = counts.observedAt;
    evidence.push({
      kind: "checkpoint-resource-aggregates",
      sessionId,
      resourceCounts: {
        commands: counts.commands,
        skills: counts.skills,
        ...(counts.resources === undefined
          ? {}
          : { resources: counts.resources }),
        ...(counts.toolSources === undefined
          ? {}
          : { toolSources: counts.toolSources }),
      },
      observedAt:
        observedAt === undefined
          ? { state: "unavailable" }
          : { state: "known", at: observedAt, basis: "inventory-observer" },
      checkpointedAt: time,
      provenance: {
        source: "checkpoint",
        authority: "derived",
        schemaVersion: 1,
      },
    });
  }
  return evidence;
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
          const evidenceRead =
            command.mode === "ui" || target === "current" || target === "ledger"
              ? await readSessionEvidence({
                  api: pi,
                  root,
                  sessionId: readSessionId(sessionManager),
                })
              : undefined;
          // One read serves both the L0 evidence bundle and the existing
          // observation, so every current-session call site stays consistent.
          const currentSession = {
            observation: evidenceRead?.observation,
            ...(evidenceRead === undefined
              ? {}
              : {
                  evidence: evidenceRead.evidence,
                  walRecords: evidenceRead.walRecords,
                  liveOverflow: evidenceRead.liveOverflow,
                }),
          };
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
              { leafId, ...currentSession },
            );
            if (!model) return notifyCurrentUnavailable(ctx);
            await ctx.ui.custom((tui, theme, _keybindings, done) =>
              createCurrentTuiComponent({
                model,
                load: (scope) =>
                  loadCurrentSessionReport(sessionFile, scope, {
                    leafId,
                    ...currentSession,
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
              ...(evidenceRead === undefined
                ? {}
                : {
                    observation: evidenceRead.observation,
                    currentEvidence: {
                      evidence: evidenceRead.evidence,
                      walRecords: evidenceRead.walRecords,
                      liveOverflow: evidenceRead.liveOverflow,
                    },
                  }),
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
              { leafId, ...currentSession },
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

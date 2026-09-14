import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  type ExtensionAPI,
  type ExtensionCommandContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { completeInspectorCommand } from "./commands/completions.ts";
import {
  parseInspectorCommand,
  type InspectorCommand,
} from "./commands/grammar.ts";
import { createInspectorHelpComponent } from "./commands/help.ts";
import type { Scope } from "./core/events.ts";
import {
  type FoldedAggregateEvidence,
  isBoundedIsoInstant,
  type L0Evidence,
  type LiveTimingObservation,
} from "./core/evidence.ts";
import {
  foldedFromCheckpointAggregates,
  mergeFoldedCounters,
} from "./core/live-counter-fold.ts";
import type { InventorySnapshot } from "./integrations/inventory.ts";
import { readSubagentEvidenceWithArchives } from "./integrations/subagents.ts";
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
  readInventorySnapshot,
  refreshInventorySnapshot,
} from "./storage/inventory-snapshot.ts";
import { scheduleMaintenance } from "./storage/maintenance.ts";
import { recoverSession, type RecoveredWalRecord } from "./storage/recovery.ts";
import { createWalWriter } from "./storage/wal.ts";
import { loadInspectorBundle, loadCurrentView } from "./ui/bundle.ts";
import { createCurrentTuiComponent } from "./ui/current-tui.ts";
import { renderJson } from "./ui/json.ts";
import { loadCurrentSessionReport } from "./ui/load-current.ts";
import {
  loadGlobalReport,
  loadHistoryReports,
  loadHistorySessionReport,
  type SessionEvidenceProvider,
} from "./ui/load-history.ts";
import type { SessionObservation } from "./ui/observation.ts";
import {
  generatedReportPath,
  generatedSnapshotPath,
  isExplicitSnapshotOutput,
  writeReportOutput,
} from "./ui/report-output.ts";
import type { InspectorServerContext } from "./ui/server.ts";
import type { SnapshotDto } from "./ui/snapshot.ts";
import {
  projectCurrentView,
  projectGlobalReport,
  projectHistoricalSession,
  projectHistoryReport,
  projectInspectorUi,
} from "./ui/ui-projection.ts";

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

/** Bounded refusal for a snapshot of a session no manifest declares. */
const SESSION_SNAPSHOT_UNAVAILABLE =
  "Inspector session snapshot is unavailable.";

/**
 * Bounded refusal for an explicit snapshot destination that is not a
 * user-owned HTML export outside Pi's session directory. It names the
 * constraint, never the rejected path.
 */
const SNAPSHOT_OUTPUT_REFUSED =
  "Inspector snapshot output must be a user-owned .html file outside the Pi session directory.";

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
  /**
   * The observation instant of `inventory`, captured once per successful
   * observation (spec §14.2). Threaded into checkpoint `resourceCounts` so the
   * counts' observation time is never the checkpoint write clock (R52).
   */
  inventoryObservedAt?: string;
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
  observedAt: string,
): void {
  // The persisted bound is applied once, at capture: every consumer of the
  // in-memory snapshot (reports, presence, counter allowlists) then sees the
  // same bounded rows the writer publishes, never the unbounded producer read.
  const bounded = boundInventorySnapshot(inventory);
  const state = liveSession(scope.sessionId);
  // R57: the in-memory snapshot carries the same observation instant its
  // persisted sibling is stamped with, so the report's inventory observation
  // time is the instant these rows were observed rather than absent. The
  // producer read stays payload-only (`readSessionInventory` never infers a
  // time); only a capture that genuinely observed the inventory stamps one.
  state.inventory = { ...bounded, observedAt };
  // The counts and their observation time stay paired in one state update, so
  // maintenance can never stamp the counts with another observation's clock.
  state.inventoryObservedAt = observedAt;
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
          liveSession(input.sessionId).inventoryObservedAt = undefined;
          liveSession(input.sessionId).inventoryNames = new Set<string>();
        } else {
          // R52: the observation instant is captured once and shared by the
          // persisted snapshot and the in-memory counts, so checkpoint
          // `resourceCounts.observedAt` is this snapshot's own observation
          // time, never a later maintenance write clock.
          const observedAt = new Date().toISOString();
          rememberInventory(snapshot, scope, observedAt);
          // R37: the session-start capture is a successful observation, so it
          // carries the observation time the retention/§14.2 contract needs.
          void refreshInventorySnapshot({
            directory: join(input.root, "sessions", input.sessionId),
            snapshot,
            observedAt,
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
  const state = liveSessions.get(sessionId);
  const inventory = state?.inventory;
  const observedAt = state?.inventoryObservedAt;
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
            // R52: the snapshot's own observation time or nothing - never the
            // maintenance/checkpoint write time.
            ...(observedAt === undefined ? {} : { observedAt }),
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
    // One instant serves both the persisted snapshot and the in-memory counts,
    // so the observation time and the rows it produced never disagree (R52).
    const observedAt = new Date().toISOString();
    const snapshot = await refreshSessionInventory({
      api,
      root: scope.root,
      sessionId: scope.sessionId,
      now: () => new Date(observedAt),
    });
    if (snapshot !== undefined) rememberInventory(snapshot, scope, observedAt);
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
 *
 * Exported for its L0 derivation test; production calls it from the read path.
 */
export function readLiveTimings(input: {
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
      // Recovery accepted this timestamp with `Date.parse` + a length bound,
      // which also admits non-ISO forms. An L0 time is a normative instant, so
      // a value outside the ISO grammar yields `unavailable` rather than an
      // invalid instant (the fact itself is still real live evidence).
      time: isBoundedIsoInstant(record.timestamp)
        ? { state: "known", at: record.timestamp, basis: "wal-observer" }
        : { state: "unavailable" },
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

/**
 * Builds one history/global session's L0 evidence plus its sanitized
 * observation (R51). A history session has no live process state, so the live
 * WAL records/overflow stay absent and counters/aggregates come from the
 * checkpoint alone; the inventory snapshot and its presence model are read
 * here, never by the loader. Observer-only: any failure returns `undefined`,
 * which degrades exactly that session to `unavailable`, never a fabricated
 * zero.
 */
const readHistorySessionEvidence: SessionEvidenceProvider = async ({
  sessionId,
  directory,
  entries,
}) => {
  try {
    const checkpoint = await readCheckpoint({ directory });
    const inventory = await readInventorySnapshot(directory);
    // Retained WAL is durable evidence even when no process is live (R60).
    // Recovery validates and caps it before L1 receives it; no live overflow
    // exists for history because no live registration is consulted here.
    const recovered = await recoverSession({
      directory,
      piCursor: checkpoint?.cursors.pi ?? NO_PI_SOURCE_CURSOR,
    });
    const permission = checkpoint?.aggregates.presence?.permission === true;
    return {
      evidence: {
        atomic: [
          ...readSkillInvocations({ sessionId, records: recovered.records }),
          ...readLiveTimings({
            sessionId,
            records: recovered.records,
            running: recovered.running,
          }),
        ],
        folded: foldedCheckpointEvidence(sessionId, checkpoint),
      },
      walRecords: recovered.records,
      subagents: await readSubagentEvidenceWithArchives(entries, sessionId),
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
          // Durable presence: the checkpoint may have folded a previously
          // observed `permissions:ready`; absence is `unknown`, not `absent`.
          permissionsReady: permission,
          inventoryAvailable: inventory !== undefined,
        }),
        ...(inventory === undefined ? {} : { inventory }),
      },
    };
  } catch {
    return undefined;
  }
};

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

/**
 * Runs the `ui` command: the one lazy loopback server, whose only output is the
 * tokenized bootstrap URL. A repeated invocation reuses the running server and
 * token while replacing its request-time context, and opening the browser is
 * best effort so a failed opener never hides the URL.
 */
async function startInspectorUi(
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
  command: Extract<InspectorCommand, { kind: "report" }>,
  root: string,
): Promise<void> {
  try {
    // Loaded only for `ui`: the server module owns the browser assets, so no
    // other command loads them.
    const { getInspectorServer } = await import("./ui/server.ts");
    const server = await getInspectorServer(
      createUiServerContext({
        api: pi,
        sessionManager: ctx.sessionManager,
        root,
        theme: command.theme ?? "light",
        initialScope: command.scope,
      }),
    );
    const url = server.bootstrapUrl();
    // Notified before opening: the URL is the output whether or not a browser
    // is available to receive it.
    notifyInfo(ctx, `Inspector UI available at: ${url}`);
    if (command.noOpen) return;
    try {
      await openReport(pi, url);
    } catch {
      // The URL is already notified; opening is best effort.
    }
  } catch {
    notifyInfo(ctx, "Inspector UI is unavailable.");
  }
}

/**
 * The loopback server's request-time composition. Every callback reads the
 * *current* session-manager values and flushes live evidence before its read,
 * so one long-lived server serves the session as it is now rather than as it
 * was when `ui` ran. All L0 storage/provider reads stay here in the composition
 * root, and the projections receive only their inputs. A callback failure
 * carries no identifier outward: the loaders and the providers degrade
 * internally, so the server's bounded diagnostics never see one.
 */
function createUiServerContext(input: {
  api: ExtensionAPI;
  sessionManager: ExtensionCommandContext["sessionManager"];
  root: string;
  theme: "light" | "dark";
  initialScope: Scope;
}): InspectorServerContext {
  const { api, root, sessionManager } = input;
  // Rebuilt per read so each history/global read gets its own maintenance seam.
  const historyRead = () => ({
    root,
    sessionDirectory: () => sessionManager.getSessionDir(),
    maintenance: productionMaintenance(),
    sessionEvidence: readHistorySessionEvidence,
  });
  return {
    async loadUi(intent) {
      await flushLiveEvidence();
      // One synchronous observation of the live session, taken as soon as the
      // required evidence flush resolves: the whole request then reads this one
      // session id, directory, file and leaf, even if Pi replaces the session
      // while the evidence below is being read. No response mixes two.
      const sessionId = readSessionId(sessionManager);
      const sessionDirectory = sessionManager.getSessionDir();
      const sessionFile = sessionManager.getSessionFile();
      const leafId = sessionManager.getLeafId();
      const evidence = await readSessionEvidence({ api, root, sessionId });
      // One bundle load serves the whole request: both current views, history
      // and global, each read from the values captured above.
      const bundle = await loadInspectorBundle({
        theme: input.theme,
        initialScope: input.initialScope,
        root,
        sessionDirectory: () => sessionDirectory,
        current: {
          sessionFile,
          leafId,
        },
        subagentEvidence: readSubagentEvidenceWithArchives,
        ...(evidence === undefined
          ? {}
          : {
              observation: evidence.observation,
              currentEvidence: {
                evidence: evidence.evidence,
                walRecords: evidence.walRecords,
                liveOverflow: evidence.liveOverflow,
              },
            }),
        historyEvidence: readHistorySessionEvidence,
        maintenance: productionMaintenance(),
      });
      return projectInspectorUi({ bundle, intent });
    },
    async loadSession(sessionId) {
      await flushLiveEvidence();
      // Atomic: one requested session through the bounded discovery/replay
      // path, with no caller scope or range to widen it.
      const session = await loadHistorySessionReport(sessionId, historyRead());
      return session?.availability === "available" ? session.report : undefined;
    },
    async loadGlobal(intent) {
      await flushLiveEvidence();
      // The range-projected aggregate needs this request's own bounded session
      // windows to decide whether a contribution is partial.
      const report = await loadGlobalReport({
        ...historyRead(),
        scope: "tree",
        includeSessionWindows: true,
      });
      return projectGlobalReport(report, intent, report.sessionWindows);
    },
  };
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
        const observedAt = new Date().toISOString();
        void refreshSessionInventory({
          api: pi,
          root: scope.root,
          sessionId: scope.sessionId,
          now: () => new Date(observedAt),
        })
          .then((snapshot) => {
            // A failed refresh keeps the last readable snapshot rather than
            // substituting an empty one.
            if (snapshot !== undefined)
              rememberInventory(snapshot, scope, observedAt);
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
          if (command.mode === "ui") {
            await startInspectorUi(ctx, pi, command, root);
            return;
          }
          // Flush live evidence before any report read so no observed event is
          // missing from the counters this command renders.
          await flushLiveEvidence();
          const sessionFile = sessionManager.getSessionFile();
          const leafId = sessionManager.getLeafId();
          const target = command.target;
          const evidenceRead =
            target === "current" || target === "ledger"
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
              {
                leafId,
                ...currentSession,
                subagentEvidence: readSubagentEvidenceWithArchives,
              },
            );
            if (!model) return notifyCurrentUnavailable(ctx);
            await ctx.ui.custom((tui, theme, _keybindings, done) =>
              createCurrentTuiComponent({
                model,
                load: (scope) =>
                  loadCurrentSessionReport(sessionFile, scope, {
                    leafId,
                    ...currentSession,
                    subagentEvidence: readSubagentEvidenceWithArchives,
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
          const historyRead = {
            root,
            sessionDirectory: () => sessionManager.getSessionDir(),
            maintenance,
            // L2 reads no storage: the composition root supplies each history
            // session's L0 evidence (R51).
            sessionEvidence: readHistorySessionEvidence,
          };
          if (command.mode === "snapshot") {
            // An explicit destination is the user's own HTML export: refusing
            // anything else before any read keeps a snapshot command unable to
            // truncate Pi's session JSONL (AGENTS.md invariant 1). Generated
            // cache paths never take this guard.
            if (
              command.output !== undefined &&
              !isExplicitSnapshotOutput(
                command.output,
                sessionManager.getSessionDir(),
              )
            )
              return notifyWarning(ctx, SNAPSHOT_OUTPUT_REFUSED);
            // The renderer (and the ordinary browser assets it shares with the
            // server) is loaded only for a snapshot command.
            const { renderSnapshot } = await import("./ui/snapshot.ts");
            const theme = command.theme ?? "light";
            let dto: SnapshotDto;
            if (target === "current") {
              // One scope, loaded exactly for the target being rendered.
              const view = await loadCurrentView(
                (scope) =>
                  loadCurrentSessionReport(sessionFile, scope, {
                    leafId,
                    ...currentSession,
                    subagentEvidence: readSubagentEvidenceWithArchives,
                  }),
                command.scope,
              );
              dto = {
                kind: "current",
                schemaVersion: 1,
                theme,
                projection: projectCurrentView(
                  view,
                  command.scope,
                  command.range,
                ),
              };
            } else if (target === "history") {
              dto = {
                kind: "history",
                schemaVersion: 1,
                theme,
                projection: projectHistoryReport(
                  await loadHistoryReports({ ...historyRead, scope: "tree" }),
                  command.range,
                ),
              };
            } else if (target === "global") {
              // The aggregate's partiality verdict needs this request's bounded
              // session windows; ordinary JSON never asks for them.
              const report = await loadGlobalReport({
                ...historyRead,
                scope: "tree",
                includeSessionWindows: true,
              });
              dto = {
                kind: "global",
                schemaVersion: 1,
                theme,
                projection: projectGlobalReport(
                  report,
                  command.range,
                  report.sessionWindows,
                ),
              };
            } else {
              // Atomic: one requested session, no caller scope or range.
              const sessionId = command.sessionId;
              if (sessionId === undefined)
                return notifyInfo(ctx, SESSION_SNAPSHOT_UNAVAILABLE);
              const session = await loadHistorySessionReport(
                sessionId,
                historyRead,
              );
              if (session === undefined)
                return notifyInfo(ctx, SESSION_SNAPSHOT_UNAVAILABLE);
              dto = {
                kind: "session",
                schemaVersion: 1,
                theme,
                projection: projectHistoricalSession(session, command.range),
              };
            }
            const output = await writeReportOutput({
              path:
                command.output ??
                generatedSnapshotPath(cacheDirectory, {
                  target: dto.kind,
                  ...(dto.kind === "session" && command.sessionId !== undefined
                    ? { sessionId: command.sessionId }
                    : {}),
                  ...(dto.kind === "current" ? { scope: command.scope } : {}),
                  ...(command.range === undefined
                    ? {}
                    : { range: command.range }),
                  theme,
                }),
              content: renderSnapshot(dto),
              cacheDirectory,
              explicit: command.output !== undefined,
            });
            if (!output) return notifyCurrentUnavailable(ctx);
            // The artifact path is the output and is notified before opening,
            // so a failed opener can never hide where the document was written.
            notifyInfo(ctx, `Inspector report written: ${output}`);
            if (command.noOpen) return;
            try {
              await openReport(pi, output);
            } catch {
              // Opening is best effort; the artifact is already written.
            }
            return;
          }
          // json: deterministic export, never opens a browser.
          const common = { ...historyRead, scope: "tree" as const };
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
              {
                leafId,
                ...currentSession,
                subagentEvidence: readSubagentEvidenceWithArchives,
              },
            );
            if (!model) return notifyCurrentUnavailable(ctx);
            dto = model.report;
            reportName = model.report.sessionId;
          }
          const generated = generatedReportPath(
            cacheDirectory,
            reportName,
            "json",
            target === "history" || target === "global" ? target : "current",
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

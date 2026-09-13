import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  buildCanonicalSession,
  type CanonicalSession,
  type RetainedWalRecord,
} from "../core/canonical.ts";
import type { L0Evidence } from "../core/evidence.ts";
import type { Scope, SessionEntry, Usage } from "../core/events.ts";
import { addUsage, reduceEntries } from "../core/reduce.ts";
import { toSessionReport, type SessionReport } from "../core/reports.ts";
import {
  buildSessionCoverage,
  type SessionCoverage,
} from "../core/session-coverage.ts";
import { readPiEntryEvidence } from "../integrations/pi-entries.ts";
import {
  readSubagentEvidence,
  type SubagentEvidence,
} from "../integrations/subagents.ts";
import { parseSessionJsonl, type ParsedSession } from "../pi/adapter.ts";
import { hasTrackingStartMarker } from "../pi/sessions.ts";
import {
  discoverHistory,
  resolveManifestSourceFile,
  type CoverageReason,
  type HistoryDiagnostic,
} from "../storage/history.ts";
import {
  sessionDatedUsage,
  type DatedModelRow,
  type DateUsageRow,
} from "./dated-usage.ts";
import type { SessionObservation } from "./observation.ts";
import {
  countersFrom,
  resourceCountsFrom,
  usageFrom,
} from "./l2-projection.ts";

type MaintenanceOptions = {
  writerId: string;
  now: () => Date;
  isPidAlive: (pid: number) => boolean;
};

/** One session's evidence request; the provider owns every durable read. */
export type SessionEvidenceRequest = {
  sessionId: string;
  /** Inspector root (`root/sessions/<sessionId>` lives under it). */
  root: string;
  /** `root/sessions/<sessionId>`, already resolved by the loader. */
  directory: string;
  /** Already parsed Pi entries selected by L1; never a producer-storage read. */
  entries: readonly SessionEntry[];
};

/**
 * The per-session L0 evidence the composition root assembles (R51): the
 * unreconciled checkpoint folded aggregates plus the process-local observation.
 * A history session normally has no live WAL evidence of its own, so the
 * optional live signals stay absent unless a provider has them.
 */
export type HistorySessionEvidence = {
  evidence: L0Evidence;
  /** WAL-validated retained records (R41/R46); absent for a historical read. */
  walRecords?: readonly RetainedWalRecord[];
  /** Process-local dropped-tool-start overflow (R29); absent for history. */
  liveOverflow?: number;
  /** Sanitized inventory snapshot plus the explicit presence model. */
  observation?: SessionObservation;
  /** Cooperative evidence assembled by the composition-root provider. */
  subagents?: SubagentEvidence;
};

/**
 * Async evidence provider injected by the composition root. It is the only
 * path from durable storage into a history/global report; a throw or an
 * `undefined` result degrades exactly that session to `unavailable` and never
 * fabricates a zero (R51).
 */
export type SessionEvidenceProvider = (
  request: SessionEvidenceRequest,
) => Promise<HistorySessionEvidence | undefined>;

export type HistoricalSession =
  | {
      availability: "available";
      sessionId: string;
      /**
       * Bounded per-session dated evidence (spec §5.6), projected from the
       * builder's own attribution: the newest `MAX_DATED_DATES` observed dates.
       */
      usageByDate: readonly DateUsageRow[];
      /** True when `usageByDate` cannot represent the session's whole native usage. */
      usageByDateTruncated: boolean;
      /**
       * The same projection's per-date model rows, so a history session detail
       * ranges its Models tab exactly like the current section (one projection,
       * no second timestamp walk).
       */
      datedModels: readonly DatedModelRow[];
      /** True when the model cap dropped a row from `datedModels`. */
      modelsTruncated: boolean;
      report: SessionReport;
    }
  | {
      availability: "unavailable";
      sessionId: string;
      /**
       * Bounded cause of the unavailable row; never a producer string. Absent
       * only for older reports, where renderers show "Unavailable".
       */
      reason?: CoverageReason;
    };

export type HistoryReport = {
  availability: "available" | "unavailable";
  sessions: HistoricalSession[];
  diagnostics: HistoryDiagnostic[];
  coverage?: SessionCoverage;
};

/**
 * One global aggregate row: the session's identity plus, for an available
 * session, whether its dated window can represent its whole native usage. The
 * per-session dated rows themselves stay on the history report; the aggregate
 * only needs the partiality of each contribution (spec §5.6, ADR-level honesty
 * carry-forward: a partial contribution makes the aggregate visibly partial).
 */
export type GlobalSessionRow =
  | {
      availability: "available";
      sessionId: string;
      /** True when this session's dated window cannot represent its whole native usage. */
      usageByDateTruncated: boolean;
    }
  | { availability: "unavailable"; sessionId: string };

export type DateRange = { from?: string; to?: string };

export type DateUsage = {
  date: string;
  sessions: number;
  usage: Usage;
};

export type GlobalReport = {
  availability: "available" | "unavailable";
  sessions: GlobalSessionRow[];
  usage: Usage;
  dates: DateUsage[];
  diagnostics: HistoryDiagnostic[];
  coverage?: SessionCoverage;
  inventory: {
    commands: number | null;
    skills: number | null;
    resources: number | null;
  };
};

type LoadHistoryOptions = {
  root: string;
  sessionDirectory(): string;
  scope: Scope;
  activeLeafId?: (sessionId: string) => string | null;
  maintenance: MaintenanceOptions;
  /**
   * Per-session L0 evidence (R51). The loader never reads storage for it; an
   * absent provider means "no Inspector evidence", a failing provider means
   * that session is `unavailable`.
   */
  sessionEvidence?: SessionEvidenceProvider;
  /** Test seam only; production uses `defaultReplay`. */
  replay?: (input: HistoryReplayInput) => SessionReport;
};

/**
 * Per-session scan result. History and global reads share this so a session is
 * replayed exactly once and every global value comes from the same report.
 */
type SessionScan =
  | {
      availability: "available";
      sessionId: string;
      usageByDate: readonly DateUsageRow[];
      usageByDateTruncated: boolean;
      datedModels: readonly DatedModelRow[];
      modelsTruncated: boolean;
      report: SessionReport;
    }
  | { availability: "unavailable"; sessionId: string; reason: CoverageReason };

/** One session's report inputs; the same values the builder received. */
export type HistoryReplayInput = {
  session: CanonicalSession;
  entries: readonly SessionEntry[];
  observation: SessionObservation | undefined;
  subagentEvidence: SubagentEvidence;
  sealed: boolean;
};

type HistoryScan = {
  availability: "available" | "unavailable";
  sessions: SessionScan[];
  diagnostics: HistoryDiagnostic[];
  discoveryLimited: boolean;
  coverage: SessionCoverage | undefined;
};

/** No Inspector evidence observed; never a fabricated zero. */
const NO_EVIDENCE: L0Evidence = { atomic: [], folded: [] };

/** Replays only manifest-discovered Pi sources into renderer-neutral reports. */
export async function loadHistoryReports(
  options: LoadHistoryOptions,
): Promise<HistoryReport> {
  const scan = await scanHistory(options);
  return {
    availability: scan.availability,
    sessions: scan.sessions.map(toHistoricalSession),
    diagnostics: scan.diagnostics,
    ...(scan.coverage === undefined ? {} : { coverage: scan.coverage }),
  };
}

async function scanHistory(options: LoadHistoryOptions): Promise<HistoryScan> {
  if (options.scope !== "tree") {
    return {
      availability: "unavailable",
      sessions: [],
      diagnostics: [],
      discoveryLimited: false,
      coverage: undefined,
    };
  }
  const discovery = await discoverHistory({
    ...options,
    // Promotion evidence is the tracking marker itself; whether the source can
    // be replayed is the loader's re-check below (`sourceReadFailure`).
    markerEvidence: async (_sessionId, sourceFile) => {
      const source = await resolveManifestSourceFile({
        sourceFile,
        sessionDirectory: options.sessionDirectory(),
      });
      if (source === undefined) return false;
      const parsed = parseSessionJsonl(await readFile(source, "utf8"));
      return hasTrackingStartMarker(parsed.entries);
    },
  });
  const sessions = await Promise.all(
    discovery.sessions.map(
      async ({
        sessionId,
        availability,
        sourceFile,
        reason,
      }): Promise<SessionScan> => {
        // Discovery already named why this manifest never became a session; a
        // row without a named reason is an unresolvable manifest.
        if (availability !== "available" || sourceFile === undefined) {
          return {
            availability: "unavailable",
            sessionId,
            reason: reason ?? "manifest-unavailable",
          };
        }
        // (a)+(b) The source read phase: resolution, parse, header/id/marker.
        // Every failure it can name is one bounded reason, and a source that
        // changed since discovery is never replayed.
        let parsed: ParsedSession;
        try {
          const source = await resolveManifestSourceFile({
            sourceFile,
            sessionDirectory: options.sessionDirectory(),
          });
          if (source === undefined)
            return {
              availability: "unavailable",
              sessionId,
              reason: "manifest-unavailable",
            };
          parsed = parseSessionJsonl(await readFile(source, "utf8"));
          const readFailure = sourceReadFailure(parsed, sessionId);
          if (
            readFailure !== undefined ||
            !hasTrackingStartMarker(parsed.entries)
          ) {
            return {
              availability: "unavailable",
              sessionId,
              reason: readFailure ?? "marker-unavailable",
            };
          }
        } catch {
          return {
            availability: "unavailable",
            sessionId,
            reason: "session-unreadable",
          };
        }
        // (c)+(d)+(e) The replay phase: evidence, canonical build, projection.
        // A failure here degrades exactly this session, never the report.
        try {
          const directory = join(options.root, "sessions", sessionId);
          // R51: the per-session L0 evidence is injected. A provider that
          // throws or cannot supply this session is an unavailable session,
          // never a report with fabricated zeros.
          const supplied =
            options.sessionEvidence === undefined
              ? undefined
              : await options.sessionEvidence({
                  sessionId,
                  root: options.root,
                  directory,
                  entries: parsed.entries,
                });
          if (options.sessionEvidence !== undefined && supplied === undefined) {
            return {
              availability: "unavailable",
              sessionId,
              reason: "replay-failed",
            };
          }
          const observation = supplied?.observation;
          const buildInput = {
            parsed,
            // `tree` only: `active` was rejected above, and active ancestry is
            // a live concept the builder owns elsewhere.
            scope: options.scope,
            leafId: null,
            evidence: supplied?.evidence ?? NO_EVIDENCE,
            ...(supplied?.walRecords === undefined
              ? {}
              : { walRecords: supplied.walRecords }),
            ...(supplied?.liveOverflow === undefined
              ? {}
              : { liveOverflow: supplied.liveOverflow }),
            ...(observation?.inventory === undefined
              ? {}
              : { inventory: observation.inventory }),
          };
          // The builder is the single scope authority (R49) and the single
          // health/availability authority for the session.
          const resolved = buildCanonicalSession(buildInput);
          if (resolved.state !== "ready")
            return {
              availability: "unavailable",
              sessionId,
              reason: "replay-failed",
            };
          // R49: the entry set is the builder's resolution in order, mapped
          // back to parsed entries; an id without a parsed entry (an
          // unknown-semantic node) is skipped instead of fabricating a node.
          const byId = new Map<string, SessionEntry>();
          for (const entry of parsed.entries) {
            if (!byId.has(entry.id)) byId.set(entry.id, entry);
          }
          const entries = resolved.session.scopedEntryIds.flatMap((id) => {
            const entry = byId.get(id);
            return entry === undefined ? [] : [entry];
          });
          // Subagent runs are auto-discovered from persisted tool results;
          // their usage is a breakdown of this session's toolResult usage.
          // Published archive presence is validated, bounded, and never a path.
          const subagentEvidence =
            supplied?.subagents ?? readSubagentEvidence(entries, sessionId);
          // Task 15 discipline: the builder receives the same cooperative
          // evidence the DTO publishes, so health and body cannot contradict
          // each other (`joins.agentRuns === report.agents.length`).
          const built = buildCanonicalSession({
            ...buildInput,
            subagents: subagentEvidence,
          });
          if (built.state !== "ready")
            return {
              availability: "unavailable",
              sessionId,
              reason: "replay-failed",
            };
          const session = built.session;
          // R47: `expired` keeps its existing meaning — some prune seal exists.
          const sealed = Object.values(
            session.retainedAggregates.boundary.sealedThrough,
          ).some((cursor) => cursor > 0);
          return {
            availability: "available",
            sessionId,
            // R19: the one dated projection of the canonical session reaches
            // the DTO here; nothing downstream re-walks report timestamps.
            ...datedFields(session),
            report: (options.replay ?? defaultReplay)({
              session,
              entries,
              observation,
              subagentEvidence,
              sealed,
            }),
          };
        } catch {
          // (c)+(e) A provider or report projection that threw is this one
          // session's replay failure, never a guessed report.
          return {
            availability: "unavailable",
            sessionId,
            reason: "replay-failed",
          };
        }
      },
    ),
  );
  return {
    availability: discovery.availability,
    sessions,
    diagnostics: discovery.diagnostics,
    discoveryLimited: discovery.discoveryLimited,
    coverage: buildSessionCoverage({
      availability: discovery.availability,
      discoveryLimited: discovery.discoveryLimited,
      sessions,
    }),
  };
}

/** Deterministic source-read validation; every failure it can name maps to ONE reason. */
export function sourceReadFailure(
  parsed: {
    id?: unknown;
    hasMalformedJson?: unknown;
    hasSessionHeader?: unknown;
  },
  sessionId: string,
): CoverageReason | undefined {
  if (parsed.hasMalformedJson === true) return "session-unreadable";
  if (parsed.hasSessionHeader !== true) return "session-unreadable";
  if (parsed.id !== sessionId) return "session-unreadable";
  return undefined;
}

/**
 * The production projection: the L2 report of the builder's resolution. It is
 * a pure function of the replay inputs, so a failure is bounded to the one
 * session being replayed.
 */
function defaultReplay(input: HistoryReplayInput): SessionReport {
  return toSessionReport(
    reduceEntries(input.session.sessionId, input.entries),
    {
      ...(input.sealed ? { walDetail: "expired" as const } : {}),
      agents: {
        state: input.subagentEvidence.state,
        runs: input.subagentEvidence.runs,
      },
      agentActivity: input.subagentEvidence.activity,
      presence: input.observation?.presence,
      ...countersFrom(input.session),
      ...usageFrom(input.session),
      ...resourceCountsFrom(input.session),
      ...(input.observation?.inventory === undefined
        ? {}
        : { inventory: input.observation.inventory }),
      integrations: readPiEntryEvidence(input.entries),
      // Task 14 fields: canonical health and checkpoint-surviving aggregates
      // reach L2 as L1 produced them, never re-derived.
      evidenceHealth: input.session.health,
      retainedAggregates: input.session.retainedAggregates,
    },
  );
}

function toGlobalSessionRow(session: SessionScan): GlobalSessionRow {
  return session.availability === "available"
    ? {
        availability: "available",
        sessionId: session.sessionId,
        usageByDateTruncated: session.usageByDateTruncated,
      }
    : { availability: "unavailable", sessionId: session.sessionId };
}

function toHistoricalSession(session: SessionScan): HistoricalSession {
  return session.availability === "available"
    ? {
        availability: "available",
        sessionId: session.sessionId,
        usageByDate: session.usageByDate,
        usageByDateTruncated: session.usageByDateTruncated,
        datedModels: session.datedModels,
        modelsTruncated: session.modelsTruncated,
        report: session.report,
      }
    : {
        availability: "unavailable",
        sessionId: session.sessionId,
        reason: session.reason,
      };
}

/** Folds shared session reports without adding child-agent breakdown usage. */
export async function loadGlobalReport(
  options: LoadHistoryOptions & { dateRange?: DateRange },
): Promise<GlobalReport> {
  const history = await scanHistory(options);
  const rows = new Map<string, { sessionIds: Set<string>; usage: Usage }>();
  for (const session of history.sessions) {
    if (session.availability !== "available") continue;
    // R19: the aggregate folds the very rows the session's own projection
    // produced; no report timestamp is walked a second time.
    for (const dated of session.usageByDate) {
      if (!inRange(dated.date, options.dateRange)) continue;
      const row = rows.get(dated.date) ?? {
        sessionIds: new Set<string>(),
        usage: zeroUsage(),
      };
      row.sessionIds.add(session.sessionId);
      row.usage = addUsage(row.usage, datedUsage(dated));
      rows.set(dated.date, row);
    }
  }
  const dates = [...rows]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, row]) => ({
      date,
      sessions: row.sessionIds.size,
      usage: row.usage,
    }));
  return {
    availability: history.availability,
    sessions: history.sessions.map(toGlobalSessionRow),
    usage: dates.reduce(
      (total, row) => addUsage(total, row.usage),
      zeroUsage(),
    ),
    dates,
    inventory: globalInventory(history.sessions),
    diagnostics: history.diagnostics,
    ...(history.coverage === undefined ? {} : { coverage: history.coverage }),
  };
}

/**
 * Sums the canonical resource counts of the same reports. `null` means no
 * discovered session carried evidence for that field, never a fabricated zero;
 * a session that is `unavailable` contributes nothing.
 */
function globalInventory(
  sessions: readonly SessionScan[],
): GlobalReport["inventory"] {
  let commands: number | null = null;
  let skills: number | null = null;
  let resources: number | null = null;
  for (const session of sessions) {
    if (session.availability !== "available") continue;
    const counts = session.report.retainedAggregates?.resources?.counts;
    if (counts?.commands !== undefined) {
      commands = (commands ?? 0) + counts.commands;
    }
    if (counts?.skills !== undefined) {
      skills = (skills ?? 0) + counts.skills;
    }
    // The persisted resource-count aggregate is the canonical count when it
    // exists; otherwise the retained inventory rows are the observed detail.
    if (counts?.resources !== undefined) {
      resources = (resources ?? 0) + counts.resources;
    } else if (session.report.resources.state !== "unavailable") {
      resources = (resources ?? 0) + session.report.resources.items.length;
    }
  }
  return { commands, skills, resources };
}

/**
 * The date rows the canonical session projects, with the truncation verdict R16
 * pairs with them. Both loaders and every renderer read this one projection.
 */
function datedFields(session: CanonicalSession): {
  usageByDate: readonly DateUsageRow[];
  usageByDateTruncated: boolean;
  datedModels: readonly DatedModelRow[];
  modelsTruncated: boolean;
} {
  const dated = sessionDatedUsage(session);
  return {
    usageByDate: dated.dates,
    usageByDateTruncated: dated.truncated,
    datedModels: dated.models,
    modelsTruncated: dated.modelsTruncated,
  };
}

function inRange(date: string, range: DateRange | undefined): boolean {
  return (
    (!range?.from || date >= range.from) && (!range?.to || date <= range.to)
  );
}

/**
 * The usage one dated row carries. The optional producer token breakdown is
 * re-folded here so an aggregate keeps exactly the fields the deleted
 * per-record fold kept, while the dates still come from the one projection.
 */
function datedUsage(row: DateUsageRow): Usage {
  return {
    totalTokens: row.totalTokens,
    cost: row.cost,
    ...(row.inputTokens === undefined ? {} : { inputTokens: row.inputTokens }),
    ...(row.outputTokens === undefined
      ? {}
      : { outputTokens: row.outputTokens }),
    ...(row.cacheReadTokens === undefined
      ? {}
      : { cacheReadTokens: row.cacheReadTokens }),
    ...(row.cacheWriteTokens === undefined
      ? {}
      : { cacheWriteTokens: row.cacheWriteTokens }),
  };
}

function zeroUsage(): Usage {
  return { totalTokens: 0, cost: 0 };
}

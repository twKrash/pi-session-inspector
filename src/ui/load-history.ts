import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  buildCanonicalSession,
  type RetainedWalRecord,
} from "../core/canonical.ts";
import type { L0Evidence } from "../core/evidence.ts";
import type { Scope, SessionEntry, Usage } from "../core/events.ts";
import { addUsage, reduceEntries } from "../core/reduce.ts";
import { toSessionReport, type SessionReport } from "../core/reports.ts";
import { readPiEntryEvidence } from "../integrations/pi-entries.ts";
import {
  readSubagentEvidence,
  type SubagentEvidence,
} from "../integrations/subagents.ts";
import { parseSessionJsonl } from "../pi/adapter.ts";
import { hasTrackingStartMarker } from "../pi/sessions.ts";
import {
  discoverHistory,
  resolveManifestSourceFile,
  type HistoryDiagnostic,
} from "../storage/history.ts";
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
  | { availability: "available"; sessionId: string; report: SessionReport }
  | { availability: "unavailable"; sessionId: string };

export type HistoryReport = {
  availability: "available" | "unavailable";
  sessions: HistoricalSession[];
  diagnostics: HistoryDiagnostic[];
};

export type DateRange = { from?: string; to?: string };

export type DateUsage = {
  date: string;
  sessions: number;
  usage: Usage;
};

export type GlobalReport = {
  availability: "available" | "unavailable";
  sessions: Array<Omit<HistoricalSession, "report">>;
  usage: Usage;
  dates: DateUsage[];
  diagnostics: HistoryDiagnostic[];
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
};

/**
 * Per-session scan result. History and global reads share this so a session is
 * replayed exactly once and every global value comes from the same report.
 */
type SessionScan =
  | { availability: "available"; sessionId: string; report: SessionReport }
  | { availability: "unavailable"; sessionId: string };

type HistoryScan = {
  availability: "available" | "unavailable";
  sessions: SessionScan[];
  diagnostics: HistoryDiagnostic[];
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
  };
}

async function scanHistory(options: LoadHistoryOptions): Promise<HistoryScan> {
  if (options.scope !== "tree") {
    return { availability: "unavailable", sessions: [], diagnostics: [] };
  }
  const discovery = await discoverHistory({
    ...options,
    markerEvidence: async (sessionId, sourceFile) => {
      const source = await resolveManifestSourceFile({
        sourceFile,
        sessionDirectory: options.sessionDirectory(),
      });
      if (source === undefined) return false;
      const parsed = parseSessionJsonl(await readFile(source, "utf8"));
      return (
        parsed.id === sessionId &&
        !parsed.hasMalformedJson &&
        parsed.hasSessionHeader &&
        hasTrackingStartMarker(parsed.entries)
      );
    },
  });
  const sessions = await Promise.all(
    discovery.sessions.map(
      async ({ sessionId, availability, sourceFile }): Promise<SessionScan> => {
        if (availability !== "available" || sourceFile === undefined) {
          return { availability: "unavailable", sessionId };
        }
        try {
          const source = await resolveManifestSourceFile({
            sourceFile,
            sessionDirectory: options.sessionDirectory(),
          });
          if (source === undefined)
            return { availability: "unavailable", sessionId };
          const parsed = parseSessionJsonl(await readFile(source, "utf8"));
          if (
            parsed.id !== sessionId ||
            parsed.hasMalformedJson ||
            !parsed.hasSessionHeader ||
            !hasTrackingStartMarker(parsed.entries)
          ) {
            return { availability: "unavailable", sessionId };
          }
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
            return { availability: "unavailable", sessionId };
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
            return { availability: "unavailable", sessionId };
          // R49: the entry set is the builder's resolution in order, mapped
          // back to parsed entries; an id without a parsed entry (an
          // unknown-semantic node) is skipped instead of fabricating a node.
          const byId = new Map(
            parsed.entries.map((entry) => [entry.id, entry]),
          );
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
            return { availability: "unavailable", sessionId };
          const session = built.session;
          // R47: `expired` keeps its existing meaning — some prune seal exists.
          const sealed = Object.values(
            session.retainedAggregates.boundary.sealedThrough,
          ).some((cursor) => cursor > 0);
          return {
            availability: "available",
            sessionId,
            report: toSessionReport(reduceEntries(session.sessionId, entries), {
              ...(sealed ? { walDetail: "expired" as const } : {}),
              agents: {
                state: subagentEvidence.state,
                runs: subagentEvidence.runs,
              },
              agentActivity: subagentEvidence.activity,
              presence: observation?.presence,
              ...countersFrom(session),
              ...usageFrom(session),
              ...resourceCountsFrom(session),
              ...(observation?.inventory === undefined
                ? {}
                : { inventory: observation.inventory }),
              integrations: readPiEntryEvidence(entries),
              // Task 14 fields: canonical health and checkpoint-surviving
              // aggregates reach L2 as L1 produced them, never re-derived.
              evidenceHealth: session.health,
              retainedAggregates: session.retainedAggregates,
            }),
          };
        } catch {
          return { availability: "unavailable", sessionId };
        }
      },
    ),
  );
  return { ...discovery, sessions };
}

function toHistoricalSession(session: SessionScan): HistoricalSession {
  return session.availability === "available"
    ? {
        availability: "available",
        sessionId: session.sessionId,
        report: session.report,
      }
    : { availability: "unavailable", sessionId: session.sessionId };
}

/** Folds shared session reports without adding child-agent breakdown usage. */
export async function loadGlobalReport(
  options: LoadHistoryOptions & { dateRange?: DateRange },
): Promise<GlobalReport> {
  const history = await scanHistory(options);
  const rows = new Map<string, { sessionIds: Set<string>; usage: Usage }>();
  for (const session of history.sessions) {
    if (session.availability !== "available") continue;
    for (const event of usageEvents(session.report)) {
      const date = event.timestamp.slice(0, 10);
      if (!isDate(date) || !inRange(date, options.dateRange)) continue;
      const row = rows.get(date) ?? {
        sessionIds: new Set(),
        usage: zeroUsage(),
      };
      row.sessionIds.add(session.sessionId);
      row.usage = addUsage(row.usage, event.usage);
      rows.set(date, row);
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
    sessions: history.sessions.map(({ availability, sessionId }) => ({
      availability,
      sessionId,
    })),
    usage: dates.reduce(
      (total, row) => addUsage(total, row.usage),
      zeroUsage(),
    ),
    dates,
    inventory: globalInventory(history.sessions),
    diagnostics: history.diagnostics,
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

function usageEvents(
  report: SessionReport,
): Array<{ timestamp: string; usage: Usage }> {
  return [
    ...report.generations,
    ...report.tools.flatMap((tool) =>
      tool.usage === undefined
        ? []
        : [{ timestamp: tool.timestamp, usage: tool.usage }],
    ),
    ...report.compactions,
  ];
}

function inRange(date: string, range: DateRange | undefined): boolean {
  return (
    (!range?.from || date >= range.from) && (!range?.to || date <= range.to)
  );
}

function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function zeroUsage(): Usage {
  return { totalTokens: 0, cost: 0 };
}

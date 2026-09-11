import { join } from "node:path";
import { readCheckpoint } from "../storage/checkpoint.ts";
import { readFile } from "node:fs/promises";

import type { Scope, Usage } from "../core/events.ts";
import { foldedFromCheckpointAggregates } from "../core/live-counter-fold.ts";
import { addUsage, reduceEntries } from "../core/reduce.ts";
import { toSessionReport, type SessionReport } from "../core/reports.ts";
import { readPiEntryEvidence } from "../integrations/pi-entries.ts";
import { readSubagentEvidenceWithArchives } from "../integrations/subagents.ts";
import { readIntegrationPresence } from "../integrations/presence.ts";
import type { InventorySnapshot } from "../integrations/inventory.ts";
import { parseSessionJsonl } from "../pi/adapter.ts";
import { hasTrackingStartMarker, selectScope } from "../pi/sessions.ts";
import { readInventorySnapshot } from "../storage/inventory-snapshot.ts";
import {
  discoverHistory,
  resolveManifestSourceFile,
  type HistoryDiagnostic,
} from "../storage/history.ts";

type MaintenanceOptions = {
  writerId: string;
  now: () => Date;
  isPidAlive: (pid: number) => boolean;
};

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
};

/**
 * Per-session scan result. History and global reads share this so a session is
 * replayed and its bounded snapshot read exactly once.
 */
type SessionScan =
  | {
      availability: "available";
      sessionId: string;
      report: SessionReport;
      inventory: InventorySnapshot | undefined;
      resourceCounts: { commands: number; skills: number } | undefined;
    }
  | { availability: "unavailable"; sessionId: string };

type HistoryScan = {
  availability: "available" | "unavailable";
  sessions: SessionScan[];
  diagnostics: HistoryDiagnostic[];
};

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
          const checkpoint = await readCheckpoint({ directory });
          // History/global counters come from the checkpoint aggregates only
          // (never WAL), so a read can never double count or mutate state.
          const counters =
            checkpoint === undefined
              ? undefined
              : foldedFromCheckpointAggregates(checkpoint.aggregates);
          // The bounded snapshot may already have expired; absence is unknown.
          const inventory = await readInventorySnapshot(directory);
          const presence =
            inventory === undefined
              ? undefined
              : readIntegrationPresence({
                  commands: inventory.commands.map((row) => row.name),
                  tools: Object.keys(inventory.toolSources),
                  permissionsReady: counters?.presence.permission ?? false,
                  inventoryAvailable: true,
                });
          const resourceCounts = checkpoint?.aggregates.resourceCounts;
          const entries = selectScope(
            parsed.entries,
            options.scope === "active"
              ? (options.activeLeafId?.(sessionId) ?? null)
              : null,
            options.scope,
          );
          // Subagent runs are auto-discovered from persisted tool results;
          // their usage is a breakdown of this session's toolResult usage.
          // Published archive presence is validated, bounded, and never a path.
          const subagentEvidence =
            await readSubagentEvidenceWithArchives(entries);
          return {
            availability: "available",
            sessionId,
            report: toSessionReport(reduceEntries(sessionId, entries), {
              ...(Object.values(
                checkpoint?.sealingVersion === 1
                  ? (checkpoint.sealedWal ?? {})
                  : {},
              ).some((cursor) => cursor > 0)
                ? { walDetail: "expired" as const }
                : {}),
              integrations: readPiEntryEvidence(entries),
              agents: {
                state: subagentEvidence.state,
                runs: subagentEvidence.runs,
              },
              ...(counters === undefined ? {} : { counters }),
              ...(inventory === undefined ? {} : { inventory }),
              ...(presence === undefined ? {} : { presence }),
              ...(resourceCounts === undefined ? {} : { resourceCounts }),
            }),
            inventory,
            resourceCounts,
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
 * Sums each known per-session inventory count. `null` means no discovered
 * session carried evidence for that field, never a fabricated zero.
 */
function globalInventory(
  sessions: readonly SessionScan[],
): GlobalReport["inventory"] {
  let commands: number | null = null;
  let skills: number | null = null;
  let resources: number | null = null;
  for (const session of sessions) {
    if (session.availability !== "available") continue;
    if (session.resourceCounts !== undefined) {
      commands = (commands ?? 0) + session.resourceCounts.commands;
      skills = (skills ?? 0) + session.resourceCounts.skills;
    }
    if (session.inventory !== undefined) {
      resources = (resources ?? 0) + session.inventory.resources.length;
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

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { join } from "node:path";

import type { EvidenceState, SessionEntry } from "../core/events.js";
import {
  foldedFromCheckpointAggregates,
  type FoldedCounters,
  mergeFoldedCounters,
} from "../core/live-counter-fold.js";
import { reduceEntries } from "../core/reduce.js";
import { hasTrackingStartMarker, selectScope } from "../pi/sessions.js";
import { acquireMaintenanceLease } from "./lease.js";
import { recoverSession, type RecoveredRunningRecord } from "./recovery.js";
import {
  type Checkpoint,
  readCheckpoint,
  writeCheckpoint,
} from "./checkpoint.js";
import { pruneExpiredWalSegments } from "./retention.js";

const MAX_SOURCE_LINE_BYTES = 1024 * 1024;
const MAX_SOURCE_RECORDS = 1_000_000;

export type MaintenanceStatus = "available" | "unavailable";

export type MaintenanceResult = {
  status: MaintenanceStatus;
  /**
   * Live WAL timing is anonymous, so correlated duration is unavailable until a
   * native Pi tool-call ID can join a recovered run to a persisted record.
   */
  durationEvidence: EvidenceState;
};

/**
 * Reconciles derived state from Pi's current JSONL and durable WAL while the
 * maintenance lease is held. Source content is reduced in memory only.
 */
export async function maintainSession({
  root,
  sessionId,
  sessionFile,
  writerId,
  now = () => new Date(),
}: {
  root: string;
  sessionId: string;
  sessionFile: string;
  writerId: string;
  now?: () => Date;
}): Promise<MaintenanceResult> {
  const directory = join(root, "sessions", sessionId);
  const lease = await acquireMaintenanceLease({
    directory,
    writerId,
    now,
    isPidAlive,
  });
  if (lease === undefined) return unavailableMaintenance();
  try {
    const source = await readPiSource(sessionFile);
    if (source === undefined || !hasTrackingStartMarker(source.entries))
      return unavailableMaintenance();
    const recovered = await recoverSession({
      directory,
      piCursor: source.cursor,
    });
    const existing = await readCheckpoint({ directory });
    // Checkpoint aggregates are already folded, so this is the counter base:
    // it is cursor-consistent with `deltaCounters`. `recovered.aggregates` is
    // deliberately not used because recovery zeroes it when the Pi source no
    // longer matches, which would silently drop folded live counters.
    const folded = mergeFoldedCounters(
      foldedFromCheckpointAggregates(existing?.aggregates),
      recovered.deltaCounters,
    );
    const resourceCounts = existing?.aggregates.resourceCounts;
    const reduced = reduceEntries(
      sessionId,
      selectScope(source.entries, null, "tree"),
    );
    const sourceStillCurrent = async (): Promise<boolean> => {
      const current = await readPiSource(sessionFile);
      return (
        current !== undefined &&
        hasTrackingStartMarker(current.entries) &&
        current.cursor.lineCount === source.cursor.lineCount &&
        current.cursor.revision === source.cursor.revision
      );
    };
    // A source rewrite cannot be sealed from a stale reduction.
    if (!(await sourceStillCurrent())) return unavailableMaintenance();
    const checkpointWritten = await writeCheckpoint({
      directory,
      lease,
      checkpoint: {
        schemaVersion: 1,
        cursors: {
          pi: source.cursor,
          wal:
            recovered.availability === "available"
              ? recovered.cursors.wal
              : (existing?.cursors.wal ?? {}),
        },
        ...(existing?.sealingVersion !== 1 || existing.sealedWal === undefined
          ? {}
          : { sealedWal: existing.sealedWal, sealingVersion: 1 }),
        aggregates: {
          totalTokens: reduced.usage.totalTokens,
          totalCost: reduced.usage.cost,
          generations: reduced.generations.length,
          tools: reduced.tools.length,
          compactions: reduced.compactions.length,
          ...foldedAggregateFields(folded),
          ...(resourceCounts === undefined
            ? {}
            : { resourceCounts: { ...resourceCounts } }),
        },
      },
    });
    if (!checkpointWritten) return unavailableMaintenance();
    const deleted = await pruneExpiredWalSegments({
      directory,
      lease,
      now,
      validate: sourceStillCurrent,
    });
    return {
      status:
        recovered.availability === "available" || deleted > 0
          ? "available"
          : "unavailable",
      durationEvidence: durationEvidenceFromRecoveredRuns(recovered.running),
    };
  } catch {
    return unavailableMaintenance();
  } finally {
    await lease.release();
  }
}

function unavailableMaintenance(): MaintenanceResult {
  return { status: "unavailable", durationEvidence: "unavailable" };
}

/**
 * Serializes only the folded fields that carry information: empty maps and
 * zero counts are omitted rather than written as `{}`/`0` filler, so repeated
 * passes with no new telemetry stay byte-identical. `resourceCounts` is owned
 * by inventory maintenance and is not part of the counter fold.
 */
function foldedAggregateFields(
  folded: FoldedCounters,
): Pick<
  Checkpoint["aggregates"],
  | "integrationCounters"
  | "skillInvocations"
  | "skillOverflowInvocations"
  | "presence"
> {
  const integrationCounters: [string, Record<string, number>][] = [];
  for (const [integration, counters] of Object.entries(folded.counters)) {
    if (counters !== undefined && Object.keys(counters).length > 0) {
      integrationCounters.push([integration, { ...counters }]);
    }
  }
  return {
    ...(integrationCounters.length === 0
      ? {}
      : { integrationCounters: Object.fromEntries(integrationCounters) }),
    ...(Object.keys(folded.skillInvocations).length === 0
      ? {}
      : { skillInvocations: { ...folded.skillInvocations } }),
    ...(folded.otherInvocations > 0
      ? { skillOverflowInvocations: folded.otherInvocations }
      : {}),
    ...(folded.presence.permission ? { presence: { permission: true } } : {}),
  };
}

/**
 * Live timing records are anonymous WAL event IDs, never Pi-native tool-call
 * IDs, so no recovered run can be joined to a persisted tool. Duration stays
 * unavailable rather than guessed or aggregated across unrelated runs.
 */
export function durationEvidenceFromRecoveredRuns(
  running: readonly RecoveredRunningRecord[],
): EvidenceState {
  void running;
  return "unavailable";
}

/** Schedules maintenance after tracking without delaying or surfacing to Pi. */
export function scheduleMaintenance(
  input: Parameters<typeof maintainSession>[0],
): void {
  try {
    void Promise.resolve()
      .then(() => maintainSession(input))
      .catch(() => undefined);
  } catch {
    // Inspector maintenance is observer-only.
  }
}

async function readPiSource(path: string): Promise<
  | {
      cursor: { lineCount: number; revision: string };
      entries: SessionEntry[];
    }
  | undefined
> {
  const entries: SessionEntry[] = [];
  let lineCount = 0;
  const revision = createHash("sha256");
  let partial = Buffer.alloc(0);
  try {
    for await (const chunk of createReadStream(path)) {
      const data = Buffer.concat([partial, chunk]);
      let start = 0;
      for (;;) {
        const end = data.indexOf(0x0a, start);
        if (end === -1) break;
        const line = data.subarray(start, end);
        start = end + 1;
        revision.update(line);
        revision.update("\n");
        if (line.length === 0) continue;
        if (
          ++lineCount > MAX_SOURCE_RECORDS ||
          line.length > MAX_SOURCE_LINE_BYTES
        )
          return undefined;
        const entry = parseEntry(line.toString("utf8"));
        if (entry !== undefined) entries.push(entry);
      }
      partial = data.subarray(start);
      if (partial.length > MAX_SOURCE_LINE_BYTES) return undefined;
    }
    // Pi's own incomplete final JSONL record is not source authority.
    return {
      cursor: { lineCount, revision: revision.digest("hex") },
      entries,
    };
  } catch {
    return undefined;
  }
}

function parseEntry(line: string): SessionEntry | undefined {
  try {
    const value: unknown = JSON.parse(line);
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return undefined;
    const entry = value as Record<string, unknown>;
    if (
      typeof entry.id !== "string" ||
      typeof entry.timestamp !== "string" ||
      typeof entry.type !== "string"
    )
      return undefined;
    return {
      ...entry,
      id: entry.id,
      timestamp: entry.timestamp,
      type: entry.type,
      parentId: typeof entry.parentId === "string" ? entry.parentId : null,
    };
  } catch {
    return undefined;
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM and every other failure are indeterminate, not proof the owner
    // exited. Only ESRCH permits stale-lease takeover.
    return !(
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ESRCH"
    );
  }
}

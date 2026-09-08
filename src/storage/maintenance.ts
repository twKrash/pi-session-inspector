import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { join } from "node:path";

import type { SessionEntry } from "../core/events.js";
import { reduceEntries } from "../core/reduce.js";
import { selectScope } from "../pi/sessions.js";
import { acquireMaintenanceLease } from "./lease.js";
import { recoverSession } from "./recovery.js";
import { writeCheckpoint } from "./checkpoint.js";

const MAX_SOURCE_LINE_BYTES = 1024 * 1024;
const MAX_SOURCE_RECORDS = 1_000_000;

export type MaintenanceStatus = "available" | "unavailable";

/**
 * Reconciles derived state from Pi's current JSONL and durable WAL while the
 * maintenance lease is held. Source content is reduced in memory only.
 */
export async function maintainSession({
  root,
  sessionId,
  sessionFile,
  writerId,
}: {
  root: string;
  sessionId: string;
  sessionFile: string;
  writerId: string;
}): Promise<MaintenanceStatus> {
  const directory = join(root, "sessions", sessionId);
  const lease = await acquireMaintenanceLease({
    directory,
    writerId,
    now: () => new Date(),
    isPidAlive,
  });
  if (lease === undefined) return "unavailable";
  try {
    const source = await readPiSource(sessionFile);
    if (source === undefined) return "unavailable";
    const recovered = await recoverSession({
      directory,
      piCursor: source.cursor,
    });
    if (recovered.availability !== "available") return "unavailable";
    const reduced = reduceEntries(
      sessionId,
      selectScope(source.entries, null, "tree"),
    );
    return (await writeCheckpoint({
      directory,
      lease,
      checkpoint: {
        schemaVersion: 1,
        cursors: recovered.cursors,
        aggregates: {
          totalTokens: reduced.usage.totalTokens,
          totalCost: reduced.usage.cost,
          generations: reduced.generations.length,
          tools: reduced.tools.length,
          compactions: reduced.compactions.length,
        },
      },
    }))
      ? "available"
      : "unavailable";
  } catch {
    return "unavailable";
  } finally {
    await lease.release();
  }
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
  } catch {
    return false;
  }
}

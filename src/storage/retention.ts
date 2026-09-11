import { createReadStream, type Dir } from "node:fs";
import { opendir, open, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { parseWalRecord } from "./recovery.js";
import { readCheckpoint, writeCheckpoint } from "./checkpoint.js";
import { isMaintenanceLeaseHeld, type MaintenanceLease } from "./lease.js";

const DATE_SEGMENT = /^(\d{4}-\d{2}-\d{2})(?:\.\d{4})?\.jsonl$/;
const MAX_WAL_LINE_BYTES = 64 * 1024;
const RETENTION_DAYS = 14;

/**
 * Removes only expired, checkpointed Inspector WAL segments while the
 * per-session maintenance lease is held. Each deletion is sealed into the
 * checkpoint and source-validated first; failed validation leaves the segment
 * in place for a later maintenance pass.
 */
export async function pruneExpiredWalSegments({
  directory,
  lease,
  now,
  validate,
  remove = (path) => rm(path, { force: false }),
}: {
  directory: string;
  lease: MaintenanceLease;
  now: () => Date;
  /** Rechecks Pi source immediately before a WAL segment is sealed/deleted. */
  validate: () => Promise<boolean>;
  remove?: (path: string) => Promise<void>;
}): Promise<number> {
  if (!isMaintenanceLeaseHeld(lease, directory)) return 0;

  const checkpoint = await readCheckpoint({ directory });
  if (checkpoint === undefined) return 0;
  const cutoff = cutoffDate(now());
  if (cutoff === undefined) return 0;

  let writers: Dir;
  try {
    writers = await opendir(join(directory, "wal"), { encoding: "utf8" });
  } catch {
    return 0;
  }

  let deleted = 0;
  try {
    for await (const writer of writers) {
      if (!writer.isDirectory()) continue;
      const cursor = checkpoint.cursors.wal[writer.name];

      deleted += await pruneWriter({
        shardDirectory: join(directory, "wal", writer.name),
        writerId: writer.name,
        cursor: cursor ?? 0,
        cutoff,
        directory,
        lease,
        checkpoint,
        validate,
        remove,
      });
    }
  } catch {
    // A directory race leaves unvisited segments for the next maintenance pass.
  }
  return deleted;
}

async function pruneWriter({
  directory,
  lease,
  checkpoint,
  shardDirectory,
  writerId,
  cursor,
  cutoff,
  validate,
  remove,
}: {
  directory: string;
  lease: MaintenanceLease;
  checkpoint: NonNullable<Awaited<ReturnType<typeof readCheckpoint>>>;
  shardDirectory: string;
  writerId: string;
  cursor: number;
  cutoff: string;
  validate: () => Promise<boolean>;
  remove: (path: string) => Promise<void>;
}): Promise<number> {
  // Discover only the next contiguous prefix. Date order is not sequence order.
  // Scanning headers is bounded-memory even when durable input exceeds replay limits.
  let deleted = 0;
  let bytes = 0;
  for (let count = 0; count < 64; count += 1) {
    let candidate: { path: string; first: number } | undefined;
    try {
      for await (const entry of await opendir(shardDirectory)) {
        if (!entry.isFile() || !DATE_SEGMENT.test(entry.name)) continue;
        const path = join(shardDirectory, entry.name);
        const first = await firstSequence(path, writerId);
        if (first === undefined) return deleted;
        if (candidate === undefined || first < candidate.first)
          candidate = { path, first };
      }
      if (candidate === undefined) break;
      const sealed =
        checkpoint.sealingVersion === 1
          ? (checkpoint.sealedWal?.[writerId] ?? 0)
          : 0;
      if (candidate.first > sealed + 1) break;
      if (!(await isClosed(candidate.path, shardDirectory))) break;
      const size = (await stat(candidate.path)).size;
      if (bytes > 0 && bytes + size > 64 * 1024 * 1024) break;
      bytes += size;
      const segment = await readSegmentBoundary(candidate.path, writerId);
      if (segment === undefined || segment.newestDate >= cutoff) break;
      if (!(await validate())) break;
      // Full record validation and a closed contiguous prefix, not an ordinary
      // checkpoint cursor, authorizes missing detail. Never undo publication:
      // unlink may succeed before reporting an error or the process may exit.
      const last = Math.max(sealed, segment.lastSequence);
      const next = {
        ...checkpoint,
        cursors: {
          ...checkpoint.cursors,
          wal: {
            ...checkpoint.cursors.wal,
            [writerId]: Math.max(cursor, last),
          },
        },
        sealingVersion: 1 as const,
        sealedWal: {
          ...(checkpoint.sealingVersion === 1 ? checkpoint.sealedWal : {}),
          [writerId]: last,
        },
      };
      if (!(await writeCheckpoint({ directory, lease, checkpoint: next })))
        break;
      Object.assign(checkpoint, next);
      if (!(await validate())) break;
      await remove(candidate.path);
      await rm(`${candidate.path}.closed`, { force: true });
      deleted += 1;
    } catch {
      break;
    }
  }
  return deleted;
}

async function isClosed(path: string, shard: string): Promise<boolean> {
  try {
    if ((await readFile(`${path}.closed`, "utf8")) === "1\n") return true;
  } catch {
    /* Legacy writers have no closure marker. */
  }
  try {
    const owner = await readFile(join(shard, ".owner"), "utf8");
    if (!/^[1-9][0-9]{0,9}\n$/.test(owner)) return false;
    process.kill(Number(owner.trim()), 0);
  } catch (error) {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ESRCH"
    );
  }
  return false;
}

async function firstSequence(
  path: string,
  writerId: string,
): Promise<number | undefined> {
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(MAX_WAL_LINE_BYTES + 1);
    const { bytesRead } = await file.read(buffer);
    const end = buffer.subarray(0, bytesRead).indexOf(10);
    if (end < 0) return undefined;
    const record = parseWalRecord(buffer.subarray(0, end).toString("utf8"));
    return record?.writerId === writerId ? record.writerSequence : undefined;
  } finally {
    await file.close();
  }
}

async function readSegmentBoundary(
  path: string,
  writerId: string,
): Promise<{ newestDate: string; lastSequence: number } | undefined> {
  let partial = Buffer.alloc(0);
  let newestDate = "";
  let lastSequence: number | undefined;
  for await (const chunk of createReadStream(path)) {
    const data = Buffer.concat([partial, chunk]);
    let start = 0;
    for (;;) {
      const end = data.indexOf(10, start);
      if (end < 0) break;
      const line = data.subarray(start, end);
      start = end + 1;
      if (line.length === 0) continue;
      if (line.length > MAX_WAL_LINE_BYTES) return undefined;
      const record = parseWalRecord(line.toString("utf8"));
      if (
        record === undefined ||
        record.writerId !== writerId ||
        (lastSequence !== undefined &&
          record.writerSequence !== lastSequence + 1)
      )
        return undefined;
      lastSequence = record.writerSequence;
      const date = new Date(record.timestamp).toISOString().slice(0, 10);
      if (date > newestDate) newestDate = date;
    }
    partial = data.subarray(start);
    if (partial.length > MAX_WAL_LINE_BYTES) return undefined;
  }
  return partial.length > 0 || lastSequence === undefined
    ? undefined
    : { newestDate, lastSequence };
}

function cutoffDate(now: Date): string | undefined {
  const milliseconds = now.getTime();
  if (!Number.isFinite(milliseconds)) return undefined;
  const date = new Date(milliseconds);
  date.setUTCDate(date.getUTCDate() - (RETENTION_DAYS - 1));
  return date.toISOString().slice(0, 10);
}

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
  killProcess = (pid: number): void => {
    process.kill(pid, 0);
  },
}: {
  directory: string;
  lease: MaintenanceLease;
  now: () => Date;
  /** Rechecks Pi source immediately before a WAL segment is sealed/deleted. */
  validate: () => Promise<boolean>;
  remove?: (path: string) => Promise<void>;
  /** Liveness probe for a shard's `.owner` PID; injected in tests. */
  killProcess?: (pid: number) => void;
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
        killProcess,
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
  killProcess,
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
  killProcess: (pid: number) => void;
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
      const quiescence = await segmentQuiescence(
        candidate.path,
        shardDirectory,
        cutoff,
        killProcess,
      );
      if (quiescence === undefined) break;
      if (bytes > 0 && bytes + quiescence.size > 64 * 1024 * 1024) break;
      bytes += quiescence.size;
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
      // Mtime-only quiescence can be invalidated by a delayed append or a path
      // swap. Recheck the exact size/time/identity immediately before unlink so
      // a change aborts the deletion. This is not atomic with the unlink: a
      // write landing inside that final window can still be lost, but the
      // published seal still covers only the validated prefix.
      if (
        quiescence.revalidate &&
        !(await unchangedSince(candidate.path, quiescence))
      )
        break;
      await remove(candidate.path);
      await rm(`${candidate.path}.closed`, { force: true });
      deleted += 1;
    } catch {
      break;
    }
  }
  return deleted;
}

type SegmentQuiescence = {
  size: number;
  mtimeMs: number;
  dev: number;
  ino: number;
  /**
   * True when eligibility rests on legacy mtime evidence alone rather than a
   * `.closed` marker or an owner PID proven dead. The exact size/mtime/dev/ino
   * must be rechecked immediately before unlink.
   */
  revalidate: boolean;
};

/**
 * Decides whether a candidate segment can no longer be appended to. A `.closed`
 * marker or an owner PID proven dead (`ESRCH`) is direct proof. For a legacy
 * shard whose `.owner` record is genuinely missing, empty, or unparseable, only
 * file quiescence dated strictly before the cutoff authorizes deletion. Any
 * owner that cannot be proven dead - a live PID, a non-`ESRCH` probe failure
 * such as `EPERM`, or an owner record that exists but cannot be read - is
 * refused. Leaving this evidence unproven preserves detail.
 */
async function segmentQuiescence(
  path: string,
  shard: string,
  cutoff: string,
  killProcess: (pid: number) => void,
): Promise<SegmentQuiescence | undefined> {
  const metadata = await stat(path);
  const observed = {
    size: metadata.size,
    mtimeMs: metadata.mtimeMs,
    dev: metadata.dev,
    ino: metadata.ino,
  };
  if (await isClosed(path)) return { ...observed, revalidate: false };
  const owner = await ownerLiveness(join(shard, ".owner"), killProcess);
  if (owner === "dead") return { ...observed, revalidate: false };
  if (owner === "alive") return undefined;
  // Genuinely ownerless legacy shard: local mtime is the only evidence left.
  if (metadata.mtime.toISOString().slice(0, 10) >= cutoff) return undefined;
  return { ...observed, revalidate: true };
}

async function isClosed(path: string): Promise<boolean> {
  try {
    return (await readFile(`${path}.closed`, "utf8")) === "1\n";
  } catch {
    /* Legacy writers have no closure marker. */
  }
  return false;
}

type OwnerLiveness = "dead" | "alive" | "absent";

/**
 * Classifies a shard's writer from its `.owner` record. Only `ESRCH` proves the
 * recorded owner exited; `EPERM` and every other kill failure mean the process
 * may still be running (for example under another OS user) and must be treated
 * as alive. A `.owner` read that fails for any reason other than a genuinely
 * missing file is treated the same way: a failed read never proves
 * ownerlessness. An empty or unparseable record carries no PID to check, so it
 * stays on the legacy quiescence path.
 */
async function ownerLiveness(
  ownerPath: string,
  killProcess: (pid: number) => void,
): Promise<OwnerLiveness> {
  let owner: string;
  try {
    owner = await readFile(ownerPath, "utf8");
  } catch (error) {
    return hasErrorCode(error, "ENOENT") ? "absent" : "alive";
  }
  if (!/^[1-9][0-9]{0,9}\n$/.test(owner)) return "absent";
  try {
    killProcess(Number(owner.trim()));
    return "alive";
  } catch (error) {
    return hasErrorCode(error, "ESRCH") ? "dead" : "alive";
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

async function unchangedSince(
  path: string,
  expected: SegmentQuiescence,
): Promise<boolean> {
  try {
    const metadata = await stat(path);
    // Device+inode also catch a path swapped for a same-size, same-mtime copy.
    return (
      metadata.size === expected.size &&
      metadata.mtimeMs === expected.mtimeMs &&
      metadata.dev === expected.dev &&
      metadata.ino === expected.ino
    );
  } catch {
    return false;
  }
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

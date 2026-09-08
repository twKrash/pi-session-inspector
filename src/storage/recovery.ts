import { createReadStream } from "node:fs";
import { opendir, stat } from "node:fs/promises";
import { join } from "node:path";

import { validateTelemetry } from "../pi/telemetry.js";
import {
  readCheckpoint,
  type Checkpoint,
  type PiSourceCursor,
} from "./checkpoint.js";

const MAX_WAL_FILE_BYTES = 16 * 1024 * 1024;
const MAX_WAL_LINE_BYTES = 64 * 1024;
const MAX_WAL_WRITERS = 256;
const MAX_WAL_SEGMENTS = 1024;
const MAX_WAL_BYTES = 64 * 1024 * 1024;
const MAX_WAL_RECORDS = 100_000;
const MAX_OPEN_RECORDS = 320;
const ASCII_TOKEN = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const DATE_SEGMENT = /^\d{4}-\d{2}-\d{2}\.jsonl$/;

export type RecoveryDiagnostic =
  | "checkpoint-unavailable"
  | "wal-partial-line"
  | "wal-unavailable";

export type RecoveredRunningRecord = {
  eventId: string;
  category: "agent" | "turn" | "tool";
  startedAt: string;
  status: "running";
};

export type RecoveryResult = {
  availability: "available" | "unavailable";
  aggregates: Checkpoint["aggregates"];
  cursors: Checkpoint["cursors"];
  running: RecoveredRunningRecord[];
  diagnostics: RecoveryDiagnostic[];
};

type WalRecord = {
  eventId: string;
  timestamp: string;
  writerId: string;
  writerSequence: number;
  kind: "live_timing" | "telemetry";
  timing?: {
    category: "agent" | "turn" | "tool" | "provider" | "model";
    status: "running" | "unknown" | "unsupported";
    confidence: "live" | "unsupported";
    startedAt?: string;
    endedAt?: string;
    durationMs?: number;
  };
};

type ReplayBudget = { segments: number; bytes: number; records: number };

const zeroAggregates: Checkpoint["aggregates"] = {
  totalTokens: 0,
  totalCost: 0,
  generations: 0,
  tools: 0,
  compactions: 0,
};

/** Replays bounded Inspector WAL state without trusting derived state as Pi authority. */
export async function recoverSession({
  directory,
  piCursor,
}: {
  directory: string;
  piCursor: PiSourceCursor;
}): Promise<RecoveryResult> {
  const diagnostics = new Set<RecoveryDiagnostic>();
  if (!isPiSourceCursor(piCursor)) return unavailableResult(diagnostics);

  const replay = await readWal(directory, diagnostics);
  const checkpoint = await readCheckpoint({ directory });
  const usableCheckpoint =
    !replay.unavailable &&
    checkpoint !== undefined &&
    checkpointMatches(checkpoint, piCursor, replay);
  if (!usableCheckpoint) diagnostics.add("checkpoint-unavailable");

  return {
    availability: replay.unavailable ? "unavailable" : "available",
    aggregates: usableCheckpoint
      ? checkpoint.aggregates
      : { ...zeroAggregates },
    cursors: {
      pi: piCursor,
      wal: Object.fromEntries(Object.entries(replay.cursors)),
    },
    running: recoverRunning(replay.records),
    diagnostics: [...diagnostics].sort(),
  };
}

async function readWal(
  directory: string,
  diagnostics: Set<RecoveryDiagnostic>,
): Promise<{
  records: WalRecord[];
  cursors: Record<string, number>;
  unavailable: boolean;
}> {
  const records: WalRecord[] = [];
  const cursors: Record<string, number> = Object.create(null);
  const budget: ReplayBudget = { segments: 0, bytes: 0, records: 0 };
  let writers: string[];
  try {
    writers = await readDirectoryNames(
      join(directory, "wal"),
      (entry) => entry.isDirectory() && isToken(entry.name),
    );
  } catch (error) {
    if (isMissing(error)) return { records, cursors, unavailable: false };
    diagnostics.add("wal-unavailable");
    return { records, cursors, unavailable: true };
  }
  if (writers.length > MAX_WAL_WRITERS)
    return unavailableWal(diagnostics, records, cursors);

  let unavailable = false;
  for (const writerId of writers) {
    const shard = await readShard(directory, writerId, diagnostics, budget);
    records.push(...shard.records);
    if (shard.cursor !== undefined) cursors[writerId] = shard.cursor;
    unavailable ||= shard.unavailable;
    if (unavailable) break;
  }
  return { records, cursors, unavailable };
}

async function readDirectoryNames(
  path: string,
  select: (entry: {
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
  }) => boolean,
): Promise<string[]> {
  const directory = await opendir(path, { encoding: "utf8" });
  const names: string[] = [];
  for await (const entry of directory)
    if (select(entry)) names.push(entry.name);
  return names.sort();
}

async function readShard(
  directory: string,
  writerId: string,
  diagnostics: Set<RecoveryDiagnostic>,
  budget: ReplayBudget,
): Promise<{ records: WalRecord[]; cursor?: number; unavailable: boolean }> {
  const records: WalRecord[] = [];
  try {
    const shardDirectory = join(directory, "wal", writerId);
    const segments = await readDirectoryNames(
      shardDirectory,
      (entry) => entry.isFile() && DATE_SEGMENT.test(entry.name),
    );
    let cursor: number | undefined;
    let expectedSequence = 1;
    for (const segment of segments) {
      const parsed = await readSegment(
        join(shardDirectory, segment),
        diagnostics,
        budget,
      );
      if (parsed.unavailable) {
        records.push(...parsed.records);
        return { records, cursor, unavailable: true };
      }
      for (const record of parsed.records) {
        if (
          record.writerId !== writerId ||
          record.writerSequence !== expectedSequence
        ) {
          diagnostics.add("wal-unavailable");
          return { records, cursor, unavailable: true };
        }
        expectedSequence += 1;
        records.push(record);
        cursor = record.writerSequence;
      }
    }
    return { records, cursor, unavailable: false };
  } catch {
    diagnostics.add("wal-unavailable");
    return { records: [], unavailable: true };
  }
}

async function readSegment(
  path: string,
  diagnostics: Set<RecoveryDiagnostic>,
  budget: ReplayBudget,
): Promise<{ records: WalRecord[]; unavailable: boolean }> {
  try {
    const metadata = await stat(path);
    budget.segments += 1;
    budget.bytes += metadata.size;
    if (
      !metadata.isFile() ||
      metadata.size > MAX_WAL_FILE_BYTES ||
      budget.segments > MAX_WAL_SEGMENTS ||
      budget.bytes > MAX_WAL_BYTES
    ) {
      diagnostics.add("wal-unavailable");
      return { records: [], unavailable: true };
    }

    const records: WalRecord[] = [];
    let unavailable = false;
    let partial = Buffer.alloc(0);
    for await (const chunk of createReadStream(path)) {
      const data = Buffer.concat([partial, chunk]);
      let start = 0;
      for (;;) {
        const end = data.indexOf(0x0a, start);
        if (end === -1) break;
        const line = data.subarray(start, end);
        start = end + 1;
        if (line.length === 0) continue;
        if (
          ++budget.records > MAX_WAL_RECORDS ||
          line.length > MAX_WAL_LINE_BYTES
        ) {
          unavailable = true;
          break;
        }
        const record = parseWalRecord(line.toString("utf8"));
        if (record === undefined) unavailable = true;
        else records.push(record);
      }
      if (unavailable) break;
      partial = data.subarray(start);
      if (partial.length > MAX_WAL_LINE_BYTES) {
        unavailable = true;
        break;
      }
    }
    if (!unavailable && partial.length > 0) diagnostics.add("wal-partial-line");
    if (unavailable) diagnostics.add("wal-unavailable");
    return { records, unavailable };
  } catch {
    diagnostics.add("wal-unavailable");
    return { records: [], unavailable: true };
  }
}

function unavailableWal(
  diagnostics: Set<RecoveryDiagnostic>,
  records: WalRecord[],
  cursors: Record<string, number>,
) {
  diagnostics.add("wal-unavailable");
  return { records, cursors, unavailable: true };
}

function checkpointMatches(
  checkpoint: Checkpoint,
  piCursor: PiSourceCursor,
  replay: { cursors: Record<string, number> },
): boolean {
  if (
    checkpoint.cursors.pi.lineCount !== piCursor.lineCount ||
    checkpoint.cursors.pi.revision !== piCursor.revision
  )
    return false;
  return Object.entries(checkpoint.cursors.wal).every(
    ([writerId, cursor]) => (replay.cursors[writerId] ?? -1) >= cursor,
  );
}

function recoverRunning(
  records: readonly WalRecord[],
): RecoveredRunningRecord[] {
  const starts = new Map<string, RecoveredRunningRecord[]>();
  // Timestamps are presentation data and may move backwards. WAL ownership
  // makes writerSequence the authoritative lifecycle order within a writer.
  for (const record of [...records].sort(compareLifecycleRecords)) {
    if (record.kind !== "live_timing" || record.timing === undefined) continue;
    const timing = record.timing;
    if (
      timing.category !== "agent" &&
      timing.category !== "turn" &&
      timing.category !== "tool"
    )
      continue;
    const key = `${record.writerId}\u0000${timing.category}`;
    if (timing.status === "running" && timing.startedAt !== undefined) {
      const open = starts.get(key) ?? [];
      if (open.length < MAX_OPEN_RECORDS)
        open.push({
          eventId: record.eventId,
          category: timing.category,
          startedAt: timing.startedAt,
          status: "running",
        });
      starts.set(key, open);
    } else if (timing.endedAt !== undefined) starts.get(key)?.shift();
  }
  return [...starts.values()]
    .flat()
    .sort(
      (left, right) =>
        left.startedAt.localeCompare(right.startedAt) ||
        left.eventId.localeCompare(right.eventId),
    );
}

function compareLifecycleRecords(left: WalRecord, right: WalRecord): number {
  return (
    left.writerId.localeCompare(right.writerId) ||
    left.writerSequence - right.writerSequence ||
    left.eventId.localeCompare(right.eventId)
  );
}

function parseWalRecord(line: string): WalRecord | undefined {
  try {
    const value: unknown = JSON.parse(line);
    if (
      !isRecord(value) ||
      !isToken(value.eventId) ||
      !isTimestamp(value.timestamp) ||
      !isToken(value.writerId) ||
      !isCursor(value.writerSequence) ||
      (value.kind !== "live_timing" && value.kind !== "telemetry")
    )
      return undefined;
    if (value.kind === "telemetry")
      return validateTelemetry(value.telemetry).ok
        ? { ...baseRecord(value), kind: "telemetry" }
        : undefined;
    const timing = parseTiming(value.timing);
    return timing === undefined
      ? undefined
      : { ...baseRecord(value), kind: "live_timing", timing };
  } catch {
    return undefined;
  }
}

function baseRecord(
  value: Record<string, unknown>,
): Omit<WalRecord, "kind" | "timing"> {
  return {
    eventId: value.eventId as string,
    timestamp: value.timestamp as string,
    writerId: value.writerId as string,
    writerSequence: value.writerSequence as number,
  };
}

function parseTiming(value: unknown): WalRecord["timing"] | undefined {
  if (!isRecord(value)) return undefined;
  if (
    value.status === "running" &&
    value.confidence === "live" &&
    isActiveCategory(value.category) &&
    isTimestamp(value.startedAt) &&
    value.endedAt === undefined &&
    value.durationMs === undefined
  )
    return {
      category: value.category,
      status: "running",
      confidence: "live",
      startedAt: value.startedAt,
    };
  if (
    value.status === "unknown" &&
    value.confidence === "live" &&
    isActiveCategory(value.category) &&
    isTimestamp(value.startedAt) &&
    isTimestamp(value.endedAt) &&
    isDuration(value.durationMs)
  )
    return {
      category: value.category,
      status: "unknown",
      confidence: "live",
      startedAt: value.startedAt,
      endedAt: value.endedAt,
      durationMs: value.durationMs,
    };
  if (
    value.status === "unsupported" &&
    value.confidence === "unsupported" &&
    isUnsupportedCategory(value.category) &&
    value.startedAt === undefined &&
    value.endedAt === undefined &&
    value.durationMs === undefined
  )
    return {
      category: value.category,
      status: "unsupported",
      confidence: "unsupported",
    };
  return undefined;
}

function unavailableResult(
  diagnostics: Set<RecoveryDiagnostic>,
): RecoveryResult {
  diagnostics.add("wal-unavailable");
  return {
    availability: "unavailable",
    aggregates: { ...zeroAggregates },
    cursors: {
      pi: { lineCount: 0, revision: "0".repeat(64) },
      wal: Object.create(null),
    },
    running: [],
    diagnostics: [...diagnostics].sort(),
  };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function isToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    ASCII_TOKEN.test(value)
  );
}
function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    !Number.isNaN(Date.parse(value))
  );
}
function isCursor(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function isPiSourceCursor(value: unknown): value is PiSourceCursor {
  return (
    isRecord(value) &&
    isCursor(value.lineCount) &&
    typeof value.revision === "string" &&
    /^[a-f0-9]{64}$/.test(value.revision)
  );
}
function isDuration(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function isActiveCategory(value: unknown): value is "agent" | "turn" | "tool" {
  return value === "agent" || value === "turn" || value === "tool";
}
function isUnsupportedCategory(value: unknown): value is "provider" | "model" {
  return value === "provider" || value === "model";
}
function isMissing(error: unknown): error is { code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

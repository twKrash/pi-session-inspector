import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { isMaintenanceLeaseHeld, type MaintenanceLease } from "./lease.js";

const CHECKPOINT_FILE_NAME = "checkpoint.json";
const MAX_CHECKPOINT_BYTES = 64 * 1024;
const MAX_WAL_WRITERS = 256;
const MAX_WRITER_ID_LENGTH = 128;
const SHA256_HEX_LENGTH = 64;
const MAX_TOTAL_TOKENS = Number.MAX_SAFE_INTEGER;
const MAX_TOTAL_COST = Number.MAX_SAFE_INTEGER;
const MAX_AGGREGATE_COUNT = Number.MAX_SAFE_INTEGER;
const ASCII_TOKEN = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;

export type PiSourceCursor = {
  lineCount: number;
  /** SHA-256 of complete Pi JSONL lines; raw Pi content is never persisted. */
  revision: string;
};

export type Checkpoint = {
  schemaVersion: 1;
  cursors: {
    pi: PiSourceCursor;
    wal: Record<string, number>;
  };
  aggregates: {
    totalTokens: number;
    totalCost: number;
    generations: number;
    tools: number;
    compactions: number;
  };
  /** Cursors whose analyzer-owned detail was safely expired after sealing. */
  sealedWal?: Record<string, number>;
  sealingVersion?: 1;
};

/**
 * Reads a derived checkpoint. Missing, malformed, or unsupported state is
 * unavailable so callers can replay durable Pi and WAL sources instead.
 */
export async function readCheckpoint({
  directory,
}: {
  directory: string;
}): Promise<Checkpoint | undefined> {
  return readCheckpointFile(join(directory, CHECKPOINT_FILE_NAME));
}

/**
 * Atomically publishes a validated derived checkpoint without allowing a
 * cursor regression. A held per-session maintenance lease is required.
 */
export async function writeCheckpoint({
  directory,
  checkpoint,
  lease,
}: {
  directory: string;
  checkpoint: unknown;
  lease: MaintenanceLease;
}): Promise<boolean> {
  if (!isMaintenanceLeaseHeld(lease, directory)) {
    return false;
  }

  const candidate = parseCheckpoint(checkpoint);
  if (candidate === undefined) {
    return false;
  }

  const checkpointPath = join(directory, CHECKPOINT_FILE_NAME);
  const existing = await readCheckpointFile(checkpointPath);
  if (existing !== undefined && !hasNoOlderCursors(candidate, existing)) {
    return false;
  }

  const temporaryPath = join(
    directory,
    `.${CHECKPOINT_FILE_NAME}.${randomUUID()}.tmp`,
  );
  try {
    const serialized = `${JSON.stringify(candidate)}\n`;
    await writeFile(temporaryPath, serialized, {
      encoding: "utf8",
      mode: 0o600,
    });
    if ((await readCheckpointFile(temporaryPath)) === undefined) {
      return false;
    }

    // Re-read directly before publication. The maintenance lease makes this
    // check authoritative; without a lease it still prevents stale sequential
    // maintainers from replacing a newer durable checkpoint.
    const latest = await readCheckpointFile(checkpointPath);
    if (latest !== undefined && !hasNoOlderCursors(candidate, latest)) {
      return false;
    }
    await rename(temporaryPath, checkpointPath);
    return true;
  } catch {
    return false;
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function readCheckpointFile(
  path: string,
): Promise<Checkpoint | undefined> {
  try {
    const text = await readFile(path, "utf8");
    if (Buffer.byteLength(text, "utf8") > MAX_CHECKPOINT_BYTES) {
      return undefined;
    }
    return parseCheckpoint(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function parseCheckpoint(value: unknown): Checkpoint | undefined {
  try {
    if (
      !isPlainRecord(value) ||
      !hasRequiredKeys(value, ["schemaVersion", "cursors", "aggregates"])
    ) {
      return undefined;
    }
    if (
      value.schemaVersion !== 1 ||
      !isPlainRecord(value.cursors) ||
      !isPlainRecord(value.aggregates)
    ) {
      return undefined;
    }
    const cursors = value.cursors;
    const aggregates = value.aggregates;
    if (
      !hasRequiredKeys(cursors, ["pi", "wal"]) ||
      !isPiSourceCursor(cursors.pi) ||
      !isPlainRecord(cursors.wal)
    ) {
      return undefined;
    }
    const wal = parseWalCursors(cursors.wal);
    if (wal === undefined || !hasRequiredKeys(aggregates, aggregateKeys)) {
      return undefined;
    }
    if (
      !isSafeCount(aggregates.totalTokens, MAX_TOTAL_TOKENS) ||
      !isBoundedFinite(aggregates.totalCost, MAX_TOTAL_COST) ||
      !isSafeCount(aggregates.generations, MAX_AGGREGATE_COUNT) ||
      !isSafeCount(aggregates.tools, MAX_AGGREGATE_COUNT) ||
      !isSafeCount(aggregates.compactions, MAX_AGGREGATE_COUNT)
    ) {
      return undefined;
    }

    if (value.sealingVersion !== undefined && value.sealingVersion !== 1)
      return undefined;
    const sealedWal =
      value.sealedWal === undefined || !isPlainRecord(value.sealedWal)
        ? undefined
        : parseWalCursors(value.sealedWal);
    if (
      (value.sealedWal !== undefined && sealedWal === undefined) ||
      (sealedWal !== undefined &&
        !Object.entries(sealedWal).every(
          ([writerId, cursor]) => (wal[writerId] ?? -1) >= cursor,
        ))
    ) {
      return undefined;
    }

    return {
      schemaVersion: 1,
      cursors: {
        pi: { ...cursors.pi },
        wal,
      },
      aggregates: {
        totalTokens: aggregates.totalTokens,
        totalCost: aggregates.totalCost,
        generations: aggregates.generations,
        tools: aggregates.tools,
        compactions: aggregates.compactions,
      },
      ...(sealedWal === undefined ? {} : { sealedWal }),
      ...(value.sealingVersion === 1 ? { sealingVersion: 1 } : {}),
    };
  } catch {
    return undefined;
  }
}

const aggregateKeys = [
  "totalTokens",
  "totalCost",
  "generations",
  "tools",
  "compactions",
];

function parseWalCursors(
  value: Record<string, unknown>,
): Record<string, number> | undefined {
  const entries = Object.entries(value);
  if (entries.length > MAX_WAL_WRITERS) {
    return undefined;
  }

  const wal: Record<string, number> = Object.create(null);
  for (const [writerId, cursor] of entries) {
    if (!isWriterId(writerId) || !isCursor(cursor)) {
      return undefined;
    }
    Object.defineProperty(wal, writerId, {
      value: cursor,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return wal;
}

function hasNoOlderCursors(
  candidate: Checkpoint,
  existing: Checkpoint,
): boolean {
  if (candidate.cursors.pi.lineCount < existing.cursors.pi.lineCount) {
    return false;
  }
  if (existing.sealingVersion === 1 && candidate.sealingVersion !== 1)
    return false;
  if (
    !Object.entries(
      existing.sealingVersion === 1 ? (existing.sealedWal ?? {}) : {},
    ).every(([id, cursor]) => (candidate.sealedWal?.[id] ?? 0) >= cursor)
  )
    return false;
  return Object.entries(existing.cursors.wal).every(
    ([writerId, cursor]) => (candidate.cursors.wal[writerId] ?? 0) >= cursor,
  );
}

function hasRequiredKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return keys.every((key) => Object.hasOwn(value, key));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isCursor(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPiSourceCursor(value: unknown): value is PiSourceCursor {
  return (
    isPlainRecord(value) &&
    hasRequiredKeys(value, ["lineCount", "revision"]) &&
    isCursor(value.lineCount) &&
    typeof value.revision === "string" &&
    value.revision.length === SHA256_HEX_LENGTH &&
    SHA256_HEX.test(value.revision)
  );
}

function isSafeCount(value: unknown, maximum: number): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= maximum
  );
}

function isBoundedFinite(value: unknown, maximum: number): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= maximum
  );
}

function isWriterId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_WRITER_ID_LENGTH &&
    ASCII_TOKEN.test(value)
  );
}

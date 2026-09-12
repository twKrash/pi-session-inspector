import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  MAX_COUNTER_KEYS,
  MAX_FOLDED_COUNT,
  MAX_SKILL_KEYS,
  SKILL_NAME_PATTERN,
} from "../core/live-counter-fold.js";
import { isMaintenanceLeaseHeld, type MaintenanceLease } from "./lease.js";

const CHECKPOINT_FILE_NAME = "checkpoint.json";
const MAX_CHECKPOINT_BYTES = 64 * 1024;
const MAX_WAL_WRITERS = 256;
const MAX_WRITER_ID_LENGTH = 128;
const MAX_COUNTER_KEY_LENGTH = 128;
const SHA256_HEX_LENGTH = 64;
const MAX_TOTAL_TOKENS = Number.MAX_SAFE_INTEGER;
const MAX_TOTAL_COST = Number.MAX_SAFE_INTEGER;
const MAX_AGGREGATE_COUNT = Number.MAX_SAFE_INTEGER;
const ASCII_TOKEN = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
// Bounded ISO-8601 instant; observation/materialization times are never
// free-form producer strings.
const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_TIMESTAMP_LENGTH = 35;
const USAGE_COVERAGE_STATES = new Set(["complete", "partial", "unavailable"]);

export type PiSourceCursor = {
  lineCount: number;
  /** SHA-256 of complete Pi JSONL lines; raw Pi content is never persisted. */
  revision: string;
};

/** Bounded usage-bucket coverage states carried by `Checkpoint.evidence`. */
export type UsageCoverageState = "complete" | "partial" | "unavailable";

/**
 * Extended in place; never duplicated elsewhere. `commands`/`skills` stay
 * required when present; `resources`/`toolSources`/`observedAt` are additive.
 * `observedAt` is the inventory snapshot's observation time, never the
 * checkpoint write time.
 */
export type CheckpointResourceCounts = {
  commands: number;
  skills: number;
  resources?: number;
  toolSources?: number;
  observedAt?: string;
};

/**
 * The single additive metadata sibling on a checkpoint. No second metadata
 * object exists; `resourceCounts` is never mirrored into it.
 */
export type CheckpointEvidence = {
  checkpointedAt?: string;
  detailCoverage?: {
    walDetailExpiredBefore?: string;
    inventoryDetailExpiredAt?: string;
  };
  usageCoverage?: {
    generations: UsageCoverageState;
    toolResults: UsageCoverageState;
    compactions: UsageCoverageState;
    branchSummaries: UsageCoverageState;
  };
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
    /**
     * Already-folded live counters. Absence means "not folded", never zero:
     * maintenance adds only post-cursor telemetry to whatever is stored here.
     */
    integrationCounters?: Record<string, Record<string, number>>;
    skillInvocations?: Record<string, number>;
    skillOverflowInvocations?: number;
    presence?: { permission?: boolean };
    /** Owned by inventory maintenance; carried across counter folds unchanged. */
    resourceCounts?: CheckpointResourceCounts;
  };
  /** Cursors whose analyzer-owned detail was safely expired after sealing. */
  sealedWal?: Record<string, number>;
  sealingVersion?: 1;
  /** Single additive metadata sibling; no other metadata object exists. */
  evidence?: CheckpointEvidence;
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
    // Optional folded aggregates: absent is omitted, present-but-invalid makes
    // the whole checkpoint unavailable so no wrong number is ever reported.
    const integrationCounters =
      aggregates.integrationCounters === undefined
        ? undefined
        : parseIntCounterMap(aggregates.integrationCounters);
    const skillInvocations =
      aggregates.skillInvocations === undefined
        ? undefined
        : parseSkillInvocations(aggregates.skillInvocations);
    const skillOverflowInvocations = isSafeCount(
      aggregates.skillOverflowInvocations,
      MAX_FOLDED_COUNT,
    )
      ? aggregates.skillOverflowInvocations
      : undefined;
    const presence =
      aggregates.presence === undefined
        ? undefined
        : parsePresence(aggregates.presence);
    const resourceCounts =
      aggregates.resourceCounts === undefined
        ? undefined
        : parseResourceCounts(aggregates.resourceCounts);
    if (
      (aggregates.integrationCounters !== undefined &&
        integrationCounters === undefined) ||
      (aggregates.skillInvocations !== undefined &&
        skillInvocations === undefined) ||
      (aggregates.skillOverflowInvocations !== undefined &&
        skillOverflowInvocations === undefined) ||
      (aggregates.presence !== undefined && presence === undefined) ||
      (aggregates.resourceCounts !== undefined && resourceCounts === undefined)
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

    // The single additive metadata sibling. Absent keys stay omitted; a
    // present-but-invalid declared key rejects the whole checkpoint so health
    // is never reported from a value that cannot be trusted.
    const evidence =
      value.evidence === undefined ? undefined : parseEvidence(value.evidence);
    if (value.evidence !== undefined && evidence === undefined) {
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
        ...(integrationCounters === undefined ? {} : { integrationCounters }),
        ...(skillInvocations === undefined ? {} : { skillInvocations }),
        ...(skillOverflowInvocations === undefined
          ? {}
          : { skillOverflowInvocations }),
        ...(presence === undefined || presence.permission === undefined
          ? {}
          : { presence }),
        ...(resourceCounts === undefined ? {} : { resourceCounts }),
      },
      ...(sealedWal === undefined ? {} : { sealedWal }),
      ...(value.sealingVersion === 1 ? { sealingVersion: 1 } : {}),
      ...(evidence === undefined ? {} : { evidence }),
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

function parseIntCounterMap(
  value: unknown,
): Record<string, Record<string, number>> | undefined {
  if (!isPlainRecord(value)) return undefined;
  const rows = Object.entries(value);
  if (rows.length > MAX_COUNTER_KEYS) return undefined;
  const parsed: [string, Record<string, number>][] = [];
  for (const [integration, counterValue] of rows) {
    if (!isCounterKey(integration) || !isPlainRecord(counterValue))
      return undefined;
    const counterRows = Object.entries(counterValue);
    if (counterRows.length > MAX_COUNTER_KEYS) return undefined;
    const counters: [string, number][] = [];
    for (const [key, count] of counterRows) {
      if (!isCounterKey(key) || !isSafeCount(count, MAX_FOLDED_COUNT))
        return undefined;
      counters.push([key, count]);
    }
    parsed.push([integration, Object.fromEntries(counters)]);
  }
  return Object.fromEntries(parsed);
}

function parseSkillInvocations(
  value: unknown,
): Record<string, number> | undefined {
  if (!isPlainRecord(value)) return undefined;
  const rows = Object.entries(value);
  if (rows.length > MAX_SKILL_KEYS) return undefined;
  const parsed: [string, number][] = [];
  for (const [name, count] of rows) {
    if (!SKILL_NAME_PATTERN.test(name) || !isSafeCount(count, MAX_FOLDED_COUNT))
      return undefined;
    parsed.push([name, count]);
  }
  return Object.fromEntries(parsed);
}

function parsePresence(value: unknown): { permission?: boolean } | undefined {
  if (!isPlainRecord(value)) return undefined;
  if (Object.keys(value).some((key) => key !== "permission")) return undefined;
  const permission = value.permission;
  if (permission !== undefined && typeof permission !== "boolean")
    return undefined;
  return permission === undefined ? {} : { permission };
}

function parseResourceCounts(
  value: unknown,
): CheckpointResourceCounts | undefined {
  if (!isPlainRecord(value) || !hasRequiredKeys(value, ["commands", "skills"]))
    return undefined;
  if (
    !isSafeCount(value.commands, MAX_FOLDED_COUNT) ||
    !isSafeCount(value.skills, MAX_FOLDED_COUNT)
  )
    return undefined;
  // Additive optional keys: absent is omitted, present-but-invalid rejects.
  const resources = value.resources;
  const toolSources = value.toolSources;
  const observedAt = value.observedAt;
  if (
    (resources !== undefined && !isSafeCount(resources, MAX_FOLDED_COUNT)) ||
    (toolSources !== undefined &&
      !isSafeCount(toolSources, MAX_FOLDED_COUNT)) ||
    (observedAt !== undefined && !isBoundedTimestamp(observedAt))
  ) {
    return undefined;
  }
  return {
    commands: value.commands,
    skills: value.skills,
    ...(resources === undefined ? {} : { resources }),
    ...(toolSources === undefined ? {} : { toolSources }),
    ...(observedAt === undefined ? {} : { observedAt }),
  };
}

/**
 * Reconstructs only the declared additive evidence keys. Unknown keys are
 * ignored (readers tolerate future additions); a declared key with an invalid
 * value rejects the checkpoint.
 */
function parseEvidence(value: unknown): CheckpointEvidence | undefined {
  if (!isPlainRecord(value)) return undefined;

  const checkpointedAt = value.checkpointedAt;
  if (checkpointedAt !== undefined && !isBoundedTimestamp(checkpointedAt)) {
    return undefined;
  }

  let detailCoverage: CheckpointEvidence["detailCoverage"];
  if (value.detailCoverage !== undefined) {
    if (!isPlainRecord(value.detailCoverage)) return undefined;
    const walDetailExpiredBefore = value.detailCoverage.walDetailExpiredBefore;
    const inventoryDetailExpiredAt =
      value.detailCoverage.inventoryDetailExpiredAt;
    if (
      (walDetailExpiredBefore !== undefined &&
        !isBoundedTimestamp(walDetailExpiredBefore)) ||
      (inventoryDetailExpiredAt !== undefined &&
        !isBoundedTimestamp(inventoryDetailExpiredAt))
    ) {
      return undefined;
    }
    detailCoverage = {
      ...(walDetailExpiredBefore === undefined
        ? {}
        : { walDetailExpiredBefore }),
      ...(inventoryDetailExpiredAt === undefined
        ? {}
        : { inventoryDetailExpiredAt }),
    };
  }

  let usageCoverage: CheckpointEvidence["usageCoverage"];
  if (value.usageCoverage !== undefined) {
    if (
      !isPlainRecord(value.usageCoverage) ||
      !hasRequiredKeys(value.usageCoverage, [
        "generations",
        "toolResults",
        "compactions",
        "branchSummaries",
      ])
    ) {
      return undefined;
    }
    const { generations, toolResults, compactions, branchSummaries } =
      value.usageCoverage;
    if (
      !isUsageCoverageState(generations) ||
      !isUsageCoverageState(toolResults) ||
      !isUsageCoverageState(compactions) ||
      !isUsageCoverageState(branchSummaries)
    ) {
      return undefined;
    }
    usageCoverage = {
      generations,
      toolResults,
      compactions,
      branchSummaries,
    };
  }

  return {
    ...(checkpointedAt === undefined ? {} : { checkpointedAt }),
    ...(detailCoverage === undefined ? {} : { detailCoverage }),
    ...(usageCoverage === undefined ? {} : { usageCoverage }),
  };
}

function isBoundedTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_TIMESTAMP_LENGTH &&
    ISO_INSTANT.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function isUsageCoverageState(value: unknown): value is UsageCoverageState {
  return typeof value === "string" && USAGE_COVERAGE_STATES.has(value);
}

function isCounterKey(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_COUNTER_KEY_LENGTH &&
    ASCII_TOKEN.test(value)
  );
}

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

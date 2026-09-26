import { Buffer } from "node:buffer";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, normalize, parse, sep } from "node:path";

const MAX_METADATA_BYTES = 256 * 1024;
const MAX_METADATA_PATH_BYTES = 4096;
const MAX_EXIT_CODE = 2_147_483_647;
/** Bounded token shape; the exact POSIX vocabulary is owned by the adapter. */
const PROCESS_SIGNAL_TOKEN = /^[A-Z][A-Z0-9]{1,15}$/;
const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;

/**
 * Bounded terminal fields consumed from one documented per-child metadata file.
 * Never serialized: the adapter maps these into existing Inspector status.
 */
export type ForegroundTerminalFields = {
  exitCode?: number;
  processSignal?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedExitCode(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    Math.abs(value) <= MAX_EXIT_CODE
    ? value
    : undefined;
}

/**
 * A malformed allowlisted field invalidates the whole record, never part of it.
 * Absent or `null` optional fields stay absent.
 */
function readTerminalFields(
  record: Record<string, unknown>,
): ForegroundTerminalFields | undefined {
  let exitCode: number | undefined;
  if (record.exitCode !== undefined && record.exitCode !== null) {
    exitCode = boundedExitCode(record.exitCode);
    if (exitCode === undefined) return undefined;
  }
  let processSignal: string | undefined;
  if (record.processSignal !== undefined && record.processSignal !== null) {
    if (
      typeof record.processSignal !== "string" ||
      !PROCESS_SIGNAL_TOKEN.test(record.processSignal)
    ) {
      return undefined;
    }
    processSignal = record.processSignal;
  }
  if (exitCode === undefined && processSignal === undefined) return undefined;
  return {
    ...(exitCode === undefined ? {} : { exitCode }),
    ...(processSignal === undefined ? {} : { processSignal }),
  };
}

/**
 * Reads the documented pi-subagents per-child metadata artifact named by the
 * `artifactPaths.metadataPath` of an already-proven persisted result (upstream
 * issue #2485: a detached foreground child writes a provisional record and
 * overwrites it with the terminal result).
 *
 * Only `runId`, `exitCode`, and `processSignal` are consumed; additive producer
 * fields are ignored and nothing is retained. No directory is scanned and no
 * filename is inferred: the reference must be an exact absolute path. Every
 * malformed value, identity mismatch, symlink, non-regular, oversized, changed,
 * or missing file is no enrichment, and the proven AgentRun is never altered.
 */
export async function readForegroundTerminalFields(
  metadataPath: unknown,
  runId: string,
): Promise<ForegroundTerminalFields | undefined> {
  try {
    if (
      typeof metadataPath !== "string" ||
      metadataPath.length === 0 ||
      metadataPath.includes("\0") ||
      Buffer.byteLength(metadataPath) > MAX_METADATA_PATH_BYTES ||
      !isAbsolute(metadataPath) ||
      normalize(metadataPath) !== metadataPath
    ) {
      return undefined;
    }

    // realpath plus lstat of every component rejects symlinks anywhere in the
    // published reference, not only at the final metadata file.
    if ((await realpath(metadataPath)) !== metadataPath) return undefined;
    const { root } = parse(metadataPath);
    let component = root;
    for (const part of metadataPath
      .slice(root.length)
      .split(sep)
      .filter(Boolean)) {
      component = normalize(
        `${component}${component.endsWith(sep) ? "" : sep}${part}`,
      );
      const info = await lstat(component);
      if (info.isSymbolicLink()) return undefined;
      if (component !== metadataPath && !info.isDirectory()) return undefined;
    }

    const before = await lstat(metadataPath);
    if (
      before.isSymbolicLink() ||
      !before.isFile() ||
      !Number.isSafeInteger(before.size) ||
      before.size < 0 ||
      before.size > MAX_METADATA_BYTES
    ) {
      return undefined;
    }

    const handle = await open(
      metadataPath,
      constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | O_NOFOLLOW,
    );
    try {
      const opened = await handle.stat();
      if (
        !opened.isFile() ||
        opened.dev !== before.dev ||
        opened.ino !== before.ino ||
        opened.size !== before.size ||
        opened.size > MAX_METADATA_BYTES
      ) {
        return undefined;
      }
      const buffer = Buffer.alloc(opened.size);
      const { bytesRead } = await handle.read(buffer, 0, opened.size, 0);
      const after = await handle.stat();
      const pathAfter = await lstat(metadataPath);
      if (
        bytesRead !== opened.size ||
        after.size !== opened.size ||
        pathAfter.isSymbolicLink() ||
        pathAfter.dev !== opened.dev ||
        pathAfter.ino !== opened.ino
      ) {
        return undefined;
      }

      const value: unknown = JSON.parse(buffer.toString("utf8"));
      if (!isRecord(value) || value.runId !== runId) return undefined;
      return readTerminalFields(value);
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
}

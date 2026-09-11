import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { isAbsolute } from "node:path";

/**
 * A published pi-subagents archive is a bounded presence/identity reference
 * only. Validation is strictly ordered and every failure is `"missing"`: a
 * throw, a retained path, or any parsed field would violate ADR 0010 and the
 * adapter boundary. Nothing beyond the `"available" | "missing"` verdict
 * leaves this module.
 */
const MAX_ARCHIVE_BYTES = 128 * 1024;
/** Absent where the platform lacks it; the `lstat` symlink check is the guard. */
const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;

/**
 * Validates one published archive reference and reports presence only.
 *
 * `path` is producer-controlled untrusted input; the archive is read once, at
 * most 128 KiB, with no directory traversal and no symlink following. The
 * expected `runId` must match the archive's own `runId` exactly, and the JSON
 * must be a plain `version: 1` object. Any failure — type, stat, open, read,
 * parse, or identity — is `"missing"`, never a throw and never `"available"`.
 */
export async function readPublishedArchiveState(
  path: unknown,
  runId: string,
): Promise<"available" | "missing"> {
  try {
    // 1. Only a non-empty absolute string names a candidate archive.
    if (typeof path !== "string" || path.length === 0 || !isAbsolute(path)) {
      return "missing";
    }

    // 2. Reject symlinks, non-regular files, and oversize targets before open.
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile()) return "missing";
    const size = info.size;
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_ARCHIVE_BYTES) {
      return "missing";
    }

    // 3. Open without following links and re-verify the bound on the handle.
    const handle = await open(
      path,
      constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | O_NOFOLLOW,
    );
    try {
      const opened = await handle.stat();
      if (
        !opened.isFile() ||
        opened.size > MAX_ARCHIVE_BYTES ||
        opened.size !== size
      ) {
        return "missing";
      }

      // 4. Read exactly the validated size, then require a stable size.
      const buffer = Buffer.alloc(size);
      const { bytesRead } = await handle.read(buffer, 0, size, 0);
      if (bytesRead !== size) return "missing";
      const after = await handle.stat();
      if (after.size !== size) return "missing";

      // 5. Identity is the only field retained: a plain version-1 object whose
      // `runId` matches the run the reference was published for.
      const parsed: unknown = JSON.parse(buffer.toString("utf8"));
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed) ||
        (parsed as { version?: unknown }).version !== 1 ||
        (parsed as { runId?: unknown }).runId !== runId
      ) {
        return "missing";
      }
      return "available";
    } finally {
      await handle.close();
    }
  } catch {
    // Observer-only: a read/parse/stat error is absence, never a report failure.
    return "missing";
  }
}

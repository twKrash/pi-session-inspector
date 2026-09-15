import { appendFile, chmod, mkdir, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { MAX_DEBUG_LINE_BYTES } from "./events.ts";
import type { DebugSink } from "./log.ts";

/**
 * Rotation bound: the debug directory holds at most the current file plus one
 * rotated file, each below this size, so debug mode can never grow without
 * limit. One extra bounded line can be in flight, per {@link MAX_DEBUG_LINE_BYTES}.
 */
export const MAX_DEBUG_BYTES = 1_000_000;

/**
 * A bounded, local-only JSONL debug sink.
 *
 * - the directory is `0o700` and every file is `0o600`, enforced on a
 *   pre-existing directory or file too, not only on newly created ones;
 * - the file rotates to `<path>.1` once the next line would cross
 *   {@link MAX_DEBUG_BYTES}, so the on-disk footprint stays under
 *   `2 * MAX_DEBUG_BYTES + MAX_DEBUG_LINE_BYTES`; if rotation fails the line is
 *   dropped, because the storage bound is never traded for a log line;
 * - an oversized line is dropped rather than written, so one hostile event can
 *   never breach the file bound;
 * - appends are chained to preserve order and every failure is swallowed, so a
 *   full or unwritable disk degrades debug logging alone;
 * - nothing is ever sent over the network.
 */
export function createDebugFileSink(path: string): DebugSink {
  let pending = Promise.resolve();
  // Bytes currently in the live file. Tracked rather than re-stat'ed so the
  // bound holds even when `stat` is unavailable, and primed once from disk so a
  // pre-existing file is accounted for.
  let written = 0;
  let primed = false;
  let disabled = false;

  const write = (line: string): void => {
    if (disabled) return;
    const bytes = Buffer.byteLength(line, "utf8");
    if (bytes === 0 || bytes > MAX_DEBUG_LINE_BYTES) return;
    pending = pending
      .then(async () => {
        const directory = dirname(path);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        if (!primed) {
          // A pre-existing directory or file must not keep a wider mode than
          // the Inspector storage contract allows. If the mode cannot be
          // enforced, this sink fails closed: it stops writing rather than
          // persisting private diagnostics at a wider mode.
          if (!(await enforceModes(directory, path))) {
            disabled = true;
            return;
          }
          written = await currentSize(path);
          primed = true;
        }
        if (disabled) return;
        if (written > 0 && written + bytes > MAX_DEBUG_BYTES) {
          try {
            await rename(path, `${path}.1`);
            written = 0;
          } catch {
            // Rotation failed: drop this line rather than append past the
            // bound. The next line retries the rotation.
            return;
          }
        }
        await appendFile(path, line, { encoding: "utf8", mode: 0o600 });
        written += bytes;
      })
      .catch(() => {
        // Debug logging never affects Inspector or Pi execution.
      });
  };

  return write;
}

/**
 * Tightens a pre-existing debug directory/file to the Inspector storage modes.
 * Returns false (and the sink stops writing) when the modes cannot be
 * enforced, so private diagnostics are never persisted at a wider mode.
 */
async function enforceModes(directory: string, path: string): Promise<boolean> {
  try {
    await chmod(directory, 0o700);
    await chmod(path, 0o600);
    return true;
  } catch (error) {
    // A missing log file is fine: it is created at 0o600 on the next append.
    return (error as { code?: unknown } | undefined)?.code === "ENOENT";
  }
}

async function currentSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import {
  childSessionRoot,
  isConfinedChildPath,
} from "./subagent-child-path.ts";

// ADR 0028: one producer-published child Pi session file, read as text. This
// module owns filesystem safety only; path policy, parsing, and attribution
// live elsewhere.

/** The two handle operations the stability check needs. */
export type StatReadHandle = {
  stat(): Promise<{ isFile(): boolean; size: number }>;
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }>;
};

/**
 * `path` is producer-controlled untrusted input. It must pass the path policy,
 * have no symlinked component below the parent's own directory, and be a
 * regular file of at most `maxBytes`. Every failure is `undefined`; this never
 * throws and never reads the parent file.
 */
export async function readChildSessionFile(
  path: unknown,
  parentSessionFile: string,
  maxBytes: number,
): Promise<string | undefined> {
  try {
    const root = childSessionRoot(parentSessionFile);
    if (root === undefined) return undefined;
    if (!isConfinedChildPath(path, root)) return undefined;
    if ((await lstat(root)).isSymbolicLink()) return undefined;
    // A symlinked component below `root` makes the resolved path differ.
    if (
      (await realpath(path)) !==
      (await realpath(root)) + path.slice(root.length)
    ) {
      return undefined;
    }
    const info = await lstat(path);
    if (!info.isFile() || info.size > maxBytes) return undefined;
    return await readStable(path, info.size);
  } catch {
    // Observer-only: an I/O error is absence, never a report failure.
    return undefined;
  }
}

async function readStable(
  path: string,
  size: number,
): Promise<string | undefined> {
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
  );
  try {
    return await readExactly(handle, size);
  } finally {
    await handle.close();
  }
}

/** Reads `size` bytes only when the open file still is a file of that size. */
export async function readExactly(
  handle: StatReadHandle,
  size: number,
): Promise<string | undefined> {
  const opened = await handle.stat();
  if (!opened.isFile() || opened.size !== size) return undefined;
  const buffer = Buffer.alloc(size);
  const { bytesRead } = await handle.read(buffer, 0, size, 0);
  // A file that grows or shrinks while being read is not one stable run.
  if (bytesRead !== size || (await handle.stat()).size !== size) {
    return undefined;
  }
  return buffer.toString("utf8");
}

import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { childSessionRoot, isConfinedChildPath } from "./child-session-path.ts";

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

/** `bytes` is what was actually read, even when the file is then rejected. */
export type ChildFileRead = { bytes: number; text?: string };

/**
 * `path` is producer-controlled untrusted input. It must pass the path policy
 * and, once opened, still name the opened regular file of at most `maxBytes`
 * inside the parent's own directory. Every failure leaves `text` undefined;
 * this never throws and never reads the parent file.
 */
export async function readChildSessionFile(
  path: unknown,
  parentSessionFile: string,
  maxBytes: number,
): Promise<ChildFileRead> {
  let bytes = 0;
  try {
    const root = childSessionRoot(parentSessionFile);
    if (root === undefined || !isConfinedChildPath(path, root))
      return { bytes };
    const rootReal = await canonicalRoot(root);
    if (rootReal === undefined) return { bytes };
    const handle = await open(
      path,
      constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
    );
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.size > maxBytes) return { bytes };
      if (!(await namesOpenedFile(path, root, rootReal, opened))) {
        return { bytes };
      }
      bytes = opened.size;
      return { bytes, text: await readExactly(handle, opened.size) };
    } finally {
      await handle.close();
    }
  } catch {
    // Observer-only: an I/O error is absence, never a report failure.
    return { bytes };
  }
}

/**
 * The root's real path, or `undefined` when the root itself is a symlink. A
 * symlinked ancestor is fine: the root must be what its parent directory
 * resolves to plus its own name.
 */
async function canonicalRoot(root: string): Promise<string | undefined> {
  const canonical = await realpath(root);
  const expected = join(await realpath(dirname(root)), basename(root));
  return canonical === expected ? canonical : undefined;
}

/**
 * Opening follows every directory component, and only the last one is guarded
 * by O_NOFOLLOW, so a directory swapped in after earlier checks could make the
 * open land outside the root. Verifying after the open binds the check to the
 * descriptor: the path must now resolve inside the root and name the very
 * inode that was opened.
 */
async function namesOpenedFile(
  path: string,
  root: string,
  rootReal: string,
  opened: { dev: number; ino: number },
): Promise<boolean> {
  const canonical = await realpath(path);
  if (canonical !== rootReal + path.slice(root.length)) return false;
  const named = await lstat(canonical);
  return named.isFile() && named.dev === opened.dev && named.ino === opened.ino;
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

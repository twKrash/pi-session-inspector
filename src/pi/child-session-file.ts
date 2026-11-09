import { constants } from "node:fs";
import { open, readlink, realpath } from "node:fs/promises";
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

/** `bytes` is what the read call returned, even when the file is then rejected. */
export type ChildFileRead = { bytes: number; text?: string };

const NOTHING_READ: ChildFileRead = { bytes: 0 };

/**
 * `path` is producer-controlled untrusted input. It must pass the path policy
 * and, once opened, be a regular file of at most `maxBytes` that the kernel
 * itself places at that path inside the parent's own directory. Every failure
 * leaves `text` undefined; this never throws and never reads the parent file.
 */
export async function readChildSessionFile(
  path: unknown,
  parentSessionFile: string,
  maxBytes: number,
): Promise<ChildFileRead> {
  try {
    const root = childSessionRoot(parentSessionFile);
    if (root === undefined || !isConfinedChildPath(path, root)) {
      return NOTHING_READ;
    }
    const rootReal = await canonicalRoot(root);
    if (rootReal === undefined) return NOTHING_READ;
    const handle = await open(
      path,
      constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
    );
    try {
      if (!(await sitsAt(handle.fd, rootReal + path.slice(root.length)))) {
        return NOTHING_READ;
      }
      const opened = await handle.stat();
      if (!opened.isFile() || opened.size > maxBytes) return NOTHING_READ;
      return await readExactly(handle, opened.size);
    } finally {
      await handle.close();
    }
  } catch {
    // Observer-only: an I/O error is absence, never a report failure.
    return NOTHING_READ;
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
 * Opening follows every directory component and only the last is guarded by
 * O_NOFOLLOW, so a directory swapped in meanwhile can make the open land
 * elsewhere. Resolving the path again (realpath, lstat) would be a second,
 * separate lookup that the same swap can answer differently. The kernel's own
 * record of where the open file lives (`/proc/self/fd`) involves no second
 * lookup: it must equal the expected canonical path, with no symlinked
 * component and no "(deleted)" suffix. Where procfs is missing the read fails
 * closed, because no portable equivalent exists in Node.
 */
async function sitsAt(fd: number, expected: string): Promise<boolean> {
  return (await readlink(`/proc/self/fd/${fd}`)) === expected;
}

/** Reads `size` bytes only when the open file still is a file of that size. */
export async function readExactly(
  handle: StatReadHandle,
  size: number,
): Promise<ChildFileRead> {
  const opened = await handle.stat();
  if (!opened.isFile() || opened.size !== size) return NOTHING_READ;
  const buffer = Buffer.alloc(size);
  const { bytesRead } = await handle.read(buffer, 0, size, 0);
  // A file that grows or shrinks while being read is not one stable run, but
  // what the read already returned stays spent.
  if (bytesRead !== size || (await handle.stat()).size !== size) {
    return { bytes: bytesRead };
  }
  return { bytes: bytesRead, text: buffer.toString("utf8") };
}

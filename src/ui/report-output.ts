import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const MAX_CACHE_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_CACHE_BYTES = 100 * 1024 * 1024;
const EXPLICIT_OUTPUTS_FILE = ".explicit-outputs";
const CACHE_LOCK_DIRECTORY = ".report-output.lock";
const CACHE_LOCK_OWNER_FILE = "owner.json";
const CACHE_LOCK_STALE_MS = 30_000;
const CACHE_LOCK_RETRY_MS = 10;
const CACHE_LOCK_RETRIES = 100;

type CacheLockOwner = {
  schemaVersion: 1;
  lockId: string;
  pid: number;
  acquiredAt: number;
};

/** Removes only generated cache files, oldest-first, never caller-owned exports. */
export async function cleanReportCache(
  directory: string,
  now = new Date(),
): Promise<void> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const explicitNames = await readExplicitOutputNames(directory);
    const files = await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isFile() &&
            entry.name !== EXPLICIT_OUTPUTS_FILE &&
            !explicitNames.has(entry.name),
        )
        .map(async (entry) => {
          const path = join(directory, entry.name);
          const info = await stat(path);
          return { path, mtimeMs: info.mtimeMs, size: info.size };
        }),
    );
    files.sort(
      (left, right) =>
        left.mtimeMs - right.mtimeMs || left.path.localeCompare(right.path),
    );
    let total = files.reduce((sum, file) => sum + file.size, 0);
    for (const file of files) {
      if (
        now.getTime() - file.mtimeMs > MAX_CACHE_AGE_MS ||
        total > MAX_CACHE_BYTES
      ) {
        await unlink(file.path);
        total -= file.size;
      }
    }
  } catch {
    // Generated-report maintenance is best effort and must not affect Pi commands.
  }
}

/** Maps report identity to an opaque basename, never a producer-controlled path. */
export function generatedReportPath(
  cacheDirectory: string,
  reportIdentity: string,
  extension: "html" | "json",
): string {
  const digest = createHash("sha256").update(reportIdentity).digest("hex");
  return join(cacheDirectory, `session-${digest}.${extension}`);
}

/** Writes a generated cache or explicit user-owned export and returns its path. */
export async function writeReportOutput({
  path,
  content,
  cacheDirectory,
  explicit,
}: {
  path: string;
  content: string;
  cacheDirectory: string;
  explicit: boolean;
}): Promise<string | undefined> {
  try {
    const resolvedCacheDirectory = resolve(cacheDirectory);
    const resolvedPath = resolve(path);
    const isCacheFile = dirname(resolvedPath) === resolvedCacheDirectory;
    if (isCacheFile && basename(resolvedPath) === EXPLICIT_OUTPUTS_FILE)
      return undefined;
    if (
      !explicit &&
      (!isCacheFile || !isSafeFileName(basename(resolvedPath)))
    ) {
      return undefined;
    }

    const write = async (): Promise<string | undefined> => {
      if (!explicit) {
        if (
          (await readExplicitOutputNames(cacheDirectory)).has(basename(path))
        ) {
          return undefined;
        }
      }
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      if (explicit && isCacheFile)
        await rememberExplicitOutput(cacheDirectory, path);
      await writeFile(path, content, { encoding: "utf8", mode: 0o600 });
      if (!explicit) await cleanReportCache(cacheDirectory);
      return path;
    };

    if (!isCacheFile) return await write();
    return await withCacheLock(cacheDirectory, write);
  } catch {
    return undefined;
  }
}

async function readExplicitOutputNames(
  directory: string,
): Promise<Set<string>> {
  try {
    const source = await readFile(
      join(directory, EXPLICIT_OUTPUTS_FILE),
      "utf8",
    );
    return new Set(source.split("\n").filter(isSafeFileName));
  } catch {
    return new Set();
  }
}

async function rememberExplicitOutput(
  directory: string,
  path: string,
): Promise<void> {
  const names = await readExplicitOutputNames(directory);
  names.add(basename(path));
  const registry = join(directory, EXPLICIT_OUTPUTS_FILE);
  const temporary = `${registry}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${[...names].sort().join("\n")}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, registry);
}

/** Serializes registry reads and writes across Inspector processes. */
async function withCacheLock<T>(
  directory: string,
  operation: () => Promise<T>,
): Promise<T | undefined> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockDirectory = join(directory, CACHE_LOCK_DIRECTORY);
  for (let attempt = 0; attempt < CACHE_LOCK_RETRIES; attempt += 1) {
    const owner = createCacheLockOwner();
    if (owner === undefined) return undefined;
    if (await publishCacheLock(lockDirectory, owner)) {
      try {
        return await operation();
      } finally {
        await removeOwnedCacheLock(lockDirectory, owner);
      }
    }

    await recoverStaleCacheLock(directory, lockDirectory);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, CACHE_LOCK_RETRY_MS);
    });
  }
  return undefined;
}

function createCacheLockOwner(): CacheLockOwner | undefined {
  const acquiredAt = Date.now();
  if (!Number.isSafeInteger(acquiredAt) || acquiredAt < 0) return undefined;
  return {
    schemaVersion: 1,
    lockId: randomUUID(),
    pid: process.pid,
    acquiredAt,
  };
}

/** Publishes a complete owner record with a single atomic directory rename. */
async function publishCacheLock(
  lockDirectory: string,
  owner: CacheLockOwner,
): Promise<boolean> {
  const stagingDirectory = `${lockDirectory}.pending-${randomUUID()}`;
  let published = false;
  try {
    await mkdir(stagingDirectory, { mode: 0o700 });
    await writeFile(
      join(stagingDirectory, CACHE_LOCK_OWNER_FILE),
      JSON.stringify(owner),
      { encoding: "utf8", mode: 0o600 },
    );
    await rename(stagingDirectory, lockDirectory);
    published = true;
    return true;
  } catch {
    return false;
  } finally {
    if (!published) {
      await rm(stagingDirectory, { force: true, recursive: true }).catch(
        () => undefined,
      );
    }
  }
}

/** Reclaims only an old lock whose recorded PID is conclusively dead. */
async function recoverStaleCacheLock(
  directory: string,
  lockDirectory: string,
): Promise<void> {
  const ownerPath = join(lockDirectory, CACHE_LOCK_OWNER_FILE);
  let observedOwner: string;
  let owner: CacheLockOwner;
  try {
    observedOwner = await readFile(ownerPath, "utf8");
    owner = parseCacheLockOwner(observedOwner);
  } catch {
    return;
  }
  if (!isStaleDeadCacheLock(owner)) return;

  const claimDirectory = join(
    directory,
    `.report-output.reclaim-${createHash("sha256").update(observedOwner).digest("hex")}`,
  );
  const ownedClaimDirectory = await acquireCacheReclaimClaim(
    claimDirectory,
    claimDirectory,
  );
  if (ownedClaimDirectory === undefined) return;

  try {
    if ((await readFile(ownerPath, "utf8")) !== observedOwner) return;
    if (!isStaleDeadCacheLock(parseCacheLockOwner(observedOwner))) return;
    const staleDirectory = `${lockDirectory}.stale-${randomUUID()}`;
    await rename(lockDirectory, staleDirectory);
    await rm(staleDirectory, { force: true, recursive: true });
  } catch {
    // A changed, malformed, or inaccessible lock is never removed.
  } finally {
    await rm(ownedClaimDirectory, { force: true, recursive: true }).catch(
      () => undefined,
    );
  }
}

/** Claims reclamation atomically; a live claimant is never displaced. */
async function acquireCacheReclaimClaim(
  claimDirectory: string,
  claimRootDirectory: string,
): Promise<string | undefined> {
  const claimant = createCacheLockOwner();
  if (claimant === undefined) return undefined;
  if (await publishCacheLock(claimDirectory, claimant)) return claimDirectory;

  try {
    const existing = parseCacheLockOwner(
      await readFile(join(claimDirectory, CACHE_LOCK_OWNER_FILE), "utf8"),
    );
    if (!isStaleDeadCacheLock(existing)) return undefined;
    return await acquireCacheReclaimClaim(
      `${claimRootDirectory}.handoff-${createHash("sha256")
        .update(JSON.stringify(existing))
        .digest("hex")}`,
      claimRootDirectory,
    );
  } catch {
    return undefined;
  }
}

async function removeOwnedCacheLock(
  lockDirectory: string,
  owner: CacheLockOwner,
): Promise<void> {
  try {
    const ownerPath = join(lockDirectory, CACHE_LOCK_OWNER_FILE);
    if ((await readFile(ownerPath, "utf8")) !== JSON.stringify(owner)) return;
    await rm(lockDirectory, { force: true, recursive: true });
  } catch {
    // Cache cleanup is best effort and must never surface through a Pi command.
  }
}

function isStaleDeadCacheLock(owner: CacheLockOwner): boolean {
  return (
    Date.now() - owner.acquiredAt >= CACHE_LOCK_STALE_MS &&
    !isPidAlive(owner.pid)
  );
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isPidMissing(error);
  }
}

function parseCacheLockOwner(value: string): CacheLockOwner {
  const parsed: unknown = JSON.parse(value);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("invalid cache lock owner");
  }
  const owner = parsed as Partial<CacheLockOwner>;
  if (
    owner.schemaVersion !== 1 ||
    typeof owner.lockId !== "string" ||
    owner.lockId.length === 0 ||
    !isPid(owner.pid) ||
    !isTimestamp(owner.acquiredAt)
  ) {
    throw new TypeError("invalid cache lock owner");
  }
  return owner as CacheLockOwner;
}

function isPid(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPidMissing(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ESRCH"
  );
}

function isSafeFileName(value: string): boolean {
  return value.length > 0 && !value.includes("/") && !value.includes("\\");
}

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const LEASE_DIRECTORY_NAME = "maintenance.lease";
const OWNER_FILE_NAME = "owner.json";
const CLAIM_FILE_NAME = "claim.json";
const LEASE_DURATION_MS = 30_000;
const ASCII_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_WRITER_ID_LENGTH = 128;

type LeaseOwner = {
  schemaVersion: 1;
  writerId: string;
  pid: number;
  acquiredAt: number;
  expiresAt: number;
};

export type MaintenanceLease = {
  release(): Promise<void>;
};

const heldLeases = new WeakMap<MaintenanceLease, string>();

/** Returns whether this opaque lease capability is still held for a session. */
export function isMaintenanceLeaseHeld(
  lease: unknown,
  directory: string,
): lease is MaintenanceLease {
  return (
    lease !== null &&
    (typeof lease === "object" || typeof lease === "function") &&
    heldLeases.get(lease as MaintenanceLease) === directory
  );
}

/**
 * Acquires the short-lived, Inspector-only maintenance lease for one session.
 * Storage and ownership-check failures skip maintenance so they cannot affect Pi.
 */
export async function acquireMaintenanceLease({
  directory,
  writerId,
  now,
  isPidAlive,
}: {
  directory: string;
  writerId: string;
  now: () => Date;
  isPidAlive: (pid: number) => boolean;
}): Promise<MaintenanceLease | undefined> {
  if (!isWriterId(writerId)) {
    return undefined;
  }

  let acquiredAt: number;
  try {
    acquiredAt = now().getTime();
  } catch {
    return undefined;
  }
  if (!Number.isSafeInteger(acquiredAt) || acquiredAt < 0) {
    return undefined;
  }

  const leaseDirectory = join(directory, LEASE_DIRECTORY_NAME);
  const ownerPath = join(leaseDirectory, OWNER_FILE_NAME);
  const owner: LeaseOwner = {
    schemaVersion: 1,
    writerId,
    pid: process.pid,
    acquiredAt,
    expiresAt: acquiredAt + LEASE_DURATION_MS,
  };
  const serializedOwner = JSON.stringify(owner);

  if (!(await publishLease(leaseDirectory, serializedOwner))) {
    const recovered = await recoverLease({
      leaseDirectory,
      candidate: owner,
      now: acquiredAt,
      isPidAlive,
    });
    if (!recovered || !(await publishLease(leaseDirectory, serializedOwner))) {
      return undefined;
    }
  }

  let released = false;
  const lease: MaintenanceLease = {
    async release(): Promise<void> {
      if (released) {
        return;
      }
      released = true;
      heldLeases.delete(lease);
      await removeOwnedLease(leaseDirectory, ownerPath, serializedOwner);
    },
  };
  heldLeases.set(lease, directory);
  return lease;
}

/** Publishes only a complete owner record; crashed staging directories are inert. */
async function publishLease(
  leaseDirectory: string,
  serializedOwner: string,
): Promise<boolean> {
  const stagingDirectory = `${leaseDirectory}.pending-${randomUUID()}`;
  const stagingOwnerPath = join(stagingDirectory, OWNER_FILE_NAME);
  let published = false;
  try {
    await mkdir(stagingDirectory, { mode: 0o700 });
    await writeFile(stagingOwnerPath, serializedOwner, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(stagingDirectory, leaseDirectory);
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

async function recoverLease({
  leaseDirectory,
  candidate,
  now,
  isPidAlive,
}: {
  leaseDirectory: string;
  candidate: LeaseOwner;
  now: number;
  isPidAlive: (pid: number) => boolean;
}): Promise<boolean> {
  const ownerPath = join(leaseDirectory, OWNER_FILE_NAME);
  let observedOwner: string;
  try {
    observedOwner = await readFile(ownerPath, "utf8");
  } catch (error) {
    if (!isMissing(error)) {
      return false;
    }
    return recoverOwnerlessLease({
      leaseDirectory,
      candidate,
      now,
      isPidAlive,
    });
  }

  let owner: LeaseOwner;
  try {
    owner = parseOwner(observedOwner);
  } catch {
    return false;
  }
  if (now < owner.expiresAt || !isDead(owner.pid, isPidAlive)) {
    return false;
  }

  return claimAndRemoveLease({
    leaseDirectory,
    claimDirectory: reclaimDirectory(leaseDirectory, observedOwner),
    claim: candidate,
    now,
    isPidAlive,
    stillObserved: async () =>
      (await readFile(ownerPath, "utf8")) === observedOwner,
  });
}

async function recoverOwnerlessLease({
  leaseDirectory,
  candidate,
  now,
  isPidAlive,
}: {
  leaseDirectory: string;
  candidate: LeaseOwner;
  now: number;
  isPidAlive: (pid: number) => boolean;
}): Promise<boolean> {
  return claimAndRemoveLease({
    leaseDirectory,
    claimDirectory: join(leaseDirectory, ".reclaim-ownerless"),
    claim: candidate,
    now,
    isPidAlive,
    stillObserved: async () => {
      try {
        await readFile(join(leaseDirectory, OWNER_FILE_NAME), "utf8");
        return false;
      } catch (error) {
        return isMissing(error);
      }
    },
  });
}

async function claimAndRemoveLease({
  leaseDirectory,
  claimDirectory,
  claim,
  now,
  isPidAlive,
  stillObserved,
}: {
  leaseDirectory: string;
  claimDirectory: string;
  claim: LeaseOwner;
  now: number;
  isPidAlive: (pid: number) => boolean;
  stillObserved(): Promise<boolean>;
}): Promise<boolean> {
  const ownedClaimDirectory = await acquireReclaimClaim(
    claimDirectory,
    claim,
    now,
    isPidAlive,
  );
  if (ownedClaimDirectory === undefined) {
    return false;
  }

  let removed = false;
  try {
    if (!(await stillObserved())) {
      return false;
    }
    const staleDirectory = `${leaseDirectory}.stale-${randomUUID()}`;
    await rename(leaseDirectory, staleDirectory);
    await rm(staleDirectory, { force: true, recursive: true });
    removed = true;
    return true;
  } catch {
    return false;
  } finally {
    if (!removed) {
      await rm(ownedClaimDirectory, { force: true, recursive: true }).catch(
        () => undefined,
      );
    }
  }
}

/** A complete claim lets a future dead-PID contender recover a crashed reclaimer. */
async function acquireReclaimClaim(
  claimDirectory: string,
  claim: LeaseOwner,
  now: number,
  isPidAlive: (pid: number) => boolean,
): Promise<string | undefined> {
  const serializedClaim = JSON.stringify(claim);
  if (await publishClaim(claimDirectory, serializedClaim)) {
    return claimDirectory;
  }

  let previousClaimText: string;
  let previousClaim: LeaseOwner;
  try {
    previousClaimText = await readFile(
      join(claimDirectory, CLAIM_FILE_NAME),
      "utf8",
    );
    previousClaim = parseOwner(previousClaimText);
  } catch {
    return undefined;
  }
  if (now < previousClaim.expiresAt || !isDead(previousClaim.pid, isPidAlive)) {
    return undefined;
  }

  // Never delete an observed claim: its immutable successor is a fresh atomic
  // handoff, so a delayed crashed-claim cleaner cannot erase a new holder.
  return acquireReclaimClaim(
    handoffClaimDirectory(claimDirectory, previousClaimText),
    claim,
    now,
    isPidAlive,
  );
}

async function publishClaim(
  claimDirectory: string,
  serializedClaim: string,
): Promise<boolean> {
  const stagingDirectory = `${claimDirectory}.pending-${randomUUID()}`;
  let published = false;
  try {
    await mkdir(stagingDirectory, { mode: 0o700 });
    await writeFile(join(stagingDirectory, CLAIM_FILE_NAME), serializedClaim, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(stagingDirectory, claimDirectory);
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

async function removeOwnedLease(
  leaseDirectory: string,
  ownerPath: string,
  serializedOwner: string,
): Promise<void> {
  try {
    if ((await readFile(ownerPath, "utf8")) !== serializedOwner) {
      return;
    }
    await rm(leaseDirectory, { force: true, recursive: true });
  } catch {
    // Lease cleanup is best-effort and must never surface through maintenance.
  }
}

function reclaimDirectory(leaseDirectory: string, owner: string): string {
  return join(
    leaseDirectory,
    `.reclaim-${createHash("sha256").update(owner).digest("hex")}`,
  );
}

function handoffClaimDirectory(
  claimDirectory: string,
  previousClaim: string,
): string {
  return `${claimDirectory}.handoff-${createHash("sha256")
    .update(previousClaim)
    .digest("hex")}`;
}

function isDead(pid: number, isPidAlive: (pid: number) => boolean): boolean {
  try {
    return !isPidAlive(pid);
  } catch {
    return false;
  }
}

function isMissing(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function parseOwner(value: string): LeaseOwner {
  const parsed: unknown = JSON.parse(value);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("invalid lease owner");
  }

  const owner = parsed as Partial<LeaseOwner>;
  if (
    owner.schemaVersion !== 1 ||
    !isWriterId(owner.writerId) ||
    !isPid(owner.pid) ||
    !isTimestamp(owner.acquiredAt) ||
    !isTimestamp(owner.expiresAt) ||
    owner.expiresAt - owner.acquiredAt !== LEASE_DURATION_MS
  ) {
    throw new TypeError("invalid lease owner");
  }
  return owner as LeaseOwner;
}

function isWriterId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_WRITER_ID_LENGTH &&
    ASCII_TOKEN.test(value)
  );
}

function isPid(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

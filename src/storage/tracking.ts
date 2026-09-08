import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { TrackingStorage } from "../pi/tracking.ts";

const ASCII_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_SESSION_ID_LENGTH = 128;

export type TrackingMetadata = {
  schemaVersion: 1;
  sessionId: string;
  state: "tracking";
};

/** Returns whether a session ID can safely name an Inspector-owned directory. */
export function isTrackingSessionId(sessionId: string): boolean {
  return (
    sessionId.length > 0 &&
    sessionId.length <= MAX_SESSION_ID_LENGTH &&
    ASCII_TOKEN.test(sessionId)
  );
}

/** Parses only the current bounded Inspector tracking manifest format. */
export function parseTrackingMetadata(
  value: unknown,
  sessionId: string,
): TrackingMetadata | undefined {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return undefined;
  }
  const metadata = value as Partial<TrackingMetadata>;
  if (
    metadata.schemaVersion !== 1 ||
    metadata.sessionId !== sessionId ||
    metadata.state !== "tracking" ||
    !isTrackingSessionId(sessionId)
  ) {
    return undefined;
  }
  return { schemaVersion: 1, sessionId, state: "tracking" };
}

/** Returns the Inspector-owned manifest paths for a validated session ID. */
export function trackingMetadataPaths(
  root: string,
  sessionId: string,
): {
  sessionDirectory: string;
  pendingPath: string;
  metadataPath: string;
} {
  validateSessionId(sessionId);
  const sessionDirectory = join(root, "sessions", sessionId);
  return {
    sessionDirectory,
    pendingPath: join(sessionDirectory, "meta.json.pending"),
    metadataPath: join(sessionDirectory, "meta.json"),
  };
}

function validateSessionId(sessionId: string): void {
  if (!isTrackingSessionId(sessionId)) {
    throw new TypeError("sessionId must be a path-safe ASCII token");
  }
}

/** Creates Inspector-owned metadata storage for one Pi session. */
export function createTrackingStorage({
  root,
  sessionId,
  appendEntry,
}: {
  root: string;
  sessionId: string;
  appendEntry(type: string, data: unknown): void;
}): TrackingStorage {
  const { sessionDirectory, pendingPath, metadataPath } = trackingMetadataPaths(
    root,
    sessionId,
  );
  const metadata = `${JSON.stringify({
    schemaVersion: 1,
    sessionId,
    state: "tracking",
  } satisfies TrackingMetadata)}\n`;

  const validateBoundSessionId = (candidate: string): void => {
    validateSessionId(candidate);
    if (candidate !== sessionId) {
      throw new TypeError("sessionId does not match this tracking storage");
    }
  };

  return {
    async writePending(candidateSessionId): Promise<void> {
      validateBoundSessionId(candidateSessionId);
      await mkdir(sessionDirectory, { recursive: true, mode: 0o700 });
      await writeFile(pendingPath, metadata, { encoding: "utf8", mode: 0o600 });
    },
    appendMarker(): void {
      appendEntry("session-inspector:tracking-start", { schemaVersion: 1 });
    },
    async promote(candidateSessionId): Promise<void> {
      validateBoundSessionId(candidateSessionId);
      await rename(pendingPath, metadataPath);
    },
  };
}

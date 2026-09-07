import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { TrackingStorage } from "../pi/tracking.ts";

const ASCII_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_SESSION_ID_LENGTH = 128;

function validateSessionId(sessionId: string): void {
  if (
    sessionId.length === 0 ||
    sessionId.length > MAX_SESSION_ID_LENGTH ||
    !ASCII_TOKEN.test(sessionId)
  ) {
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
  validateSessionId(sessionId);

  const sessionDirectory = join(root, "sessions", sessionId);
  const pendingPath = join(sessionDirectory, "meta.json.pending");
  const metadataPath = join(sessionDirectory, "meta.json");
  const metadata = `${JSON.stringify({
    schemaVersion: 1,
    sessionId,
    state: "tracking",
  })}\n`;

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

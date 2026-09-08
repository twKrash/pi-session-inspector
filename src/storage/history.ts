import { opendir, readFile, rename, stat } from "node:fs/promises";
import { join } from "node:path";

import { acquireMaintenanceLease } from "./lease.js";
import {
  isTrackingSessionId,
  parseTrackingMetadata,
  trackingMetadataPaths,
} from "./tracking.js";

const MAX_HISTORY_SESSIONS = 206;

export type HistoryDiagnostic =
  | "history-limit-reached"
  | "history-unavailable"
  | "manifest-unavailable"
  | "marker-unavailable";

export type HistorySession = {
  sessionId: string;
  availability: "available" | "unavailable";
};

export type HistoryDiscoveryResult = {
  availability: "available" | "unavailable";
  sessions: HistorySession[];
  diagnostics: HistoryDiagnostic[];
};

type MaintenanceOptions = {
  writerId: string;
  now: () => Date;
  isPidAlive: (pid: number) => boolean;
};

/**
 * Discovers only Inspector-owned manifests. Pending metadata is promoted only
 * after the caller supplies positive native marker evidence while holding the
 * session maintenance lease.
 */
export async function discoverHistory({
  root,
  markerEvidence,
  maintenance,
}: {
  root: string;
  markerEvidence(sessionId: string): Promise<boolean>;
  maintenance: MaintenanceOptions;
}): Promise<HistoryDiscoveryResult> {
  const diagnostics = new Set<HistoryDiagnostic>();
  const sessionsDirectory = join(root, "sessions");
  const sessionIds = await readSessionIds(sessionsDirectory);
  if (sessionIds === undefined) {
    return {
      availability: "unavailable",
      sessions: [],
      diagnostics: ["history-unavailable"],
    };
  }
  if (sessionIds.length > MAX_HISTORY_SESSIONS) {
    diagnostics.add("history-limit-reached");
    sessionIds.length = MAX_HISTORY_SESSIONS;
  }

  const sessions: HistorySession[] = [];
  for (const sessionId of sessionIds) {
    const availability = await inspectManifest({
      root,
      sessionId,
      markerEvidence,
      maintenance,
      diagnostics,
    });
    sessions.push({ sessionId, availability });
  }
  return {
    availability: "available",
    sessions,
    diagnostics: [...diagnostics].sort(),
  };
}

async function inspectManifest({
  root,
  sessionId,
  markerEvidence,
  maintenance,
  diagnostics,
}: {
  root: string;
  sessionId: string;
  markerEvidence(sessionId: string): Promise<boolean>;
  maintenance: MaintenanceOptions;
  diagnostics: Set<HistoryDiagnostic>;
}): Promise<HistorySession["availability"]> {
  const paths = trackingMetadataPaths(root, sessionId);
  const metadata = await readMetadata(paths.metadataPath, sessionId);
  if (metadata !== undefined) {
    return (await hasMarkerEvidence(sessionId, markerEvidence, diagnostics))
      ? "available"
      : "unavailable";
  }

  const pending = await readMetadata(paths.pendingPath, sessionId);
  if (pending === undefined) {
    diagnostics.add("manifest-unavailable");
    return "unavailable";
  }
  if (!(await hasMarkerEvidence(sessionId, markerEvidence, diagnostics))) {
    return "unavailable";
  }

  const lease = await acquireMaintenanceLease({
    directory: paths.sessionDirectory,
    ...maintenance,
  });
  if (lease === undefined) {
    return "unavailable";
  }
  try {
    // Re-read the pending manifest after taking the lease; another maintainer
    // may have safely promoted it while this contender waited.
    if ((await readMetadata(paths.metadataPath, sessionId)) !== undefined) {
      return "available";
    }
    if ((await readMetadata(paths.pendingPath, sessionId)) === undefined) {
      diagnostics.add("manifest-unavailable");
      return "unavailable";
    }
    // Pi source state may have changed while the maintenance lease was being
    // acquired. Verify the native marker again immediately before promotion.
    if (!(await hasMarkerEvidence(sessionId, markerEvidence, diagnostics))) {
      return "unavailable";
    }
    await rename(paths.pendingPath, paths.metadataPath);
    return "available";
  } catch {
    return "unavailable";
  } finally {
    await lease.release();
  }
}

async function readSessionIds(
  sessionsDirectory: string,
): Promise<string[] | undefined> {
  try {
    const directory = await opendir(sessionsDirectory, { encoding: "utf8" });
    const sessionIds: string[] = [];
    for await (const entry of directory) {
      if (!entry.isDirectory() || !isTrackingSessionId(entry.name)) continue;
      sessionIds.push(entry.name);
      if (sessionIds.length > MAX_HISTORY_SESSIONS) break;
    }
    return sessionIds.sort();
  } catch {
    return undefined;
  }
}

async function readMetadata(
  path: string,
  sessionId: string,
): Promise<ReturnType<typeof parseTrackingMetadata> | undefined> {
  try {
    const metadata = await stat(path);
    if (!metadata.isFile() || metadata.size > 1024) return undefined;
    const text = await readFile(path, "utf8");
    if (Buffer.byteLength(text, "utf8") > 1024) return undefined;
    return parseTrackingMetadata(JSON.parse(text), sessionId);
  } catch {
    return undefined;
  }
}

async function hasMarkerEvidence(
  sessionId: string,
  markerEvidence: (sessionId: string) => Promise<boolean>,
  diagnostics: Set<HistoryDiagnostic>,
): Promise<boolean> {
  try {
    return (await markerEvidence(sessionId)) === true;
  } catch {
    diagnostics.add("marker-unavailable");
    return false;
  }
}

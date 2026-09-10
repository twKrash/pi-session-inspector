import {
  lstat,
  opendir,
  readFile,
  realpath,
  rename,
  stat,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { acquireMaintenanceLease } from "./lease.js";
import {
  isTrackingSessionId,
  isTrackingSourceFile,
  parseTrackingMetadata,
  trackingMetadataPaths,
  type TrackingMetadata,
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
  /** Internal manifest locator; deliberately non-enumerable on returned rows. */
  sourceFile?: string;
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
 * Resolves an Inspector manifest's source basename only within Pi's public
 * session directory. A source symlink or a non-direct/non-file source is not
 * trusted for history replay.
 */
export async function resolveManifestSourceFile({
  sourceFile,
  sessionDirectory,
}: {
  sourceFile: string;
  sessionDirectory: string;
}): Promise<string | undefined> {
  if (!isTrackingSourceFile(sourceFile)) return undefined;
  try {
    const resolvedDirectory = await realpath(sessionDirectory);
    const candidate = join(sessionDirectory, sourceFile);
    const candidateInfo = await lstat(candidate, { bigint: false });
    if (!candidateInfo.isFile()) return undefined;
    const resolvedCandidate = await realpath(candidate);
    if (dirname(resolvedCandidate) !== resolvedDirectory) return undefined;
    return resolvedCandidate;
  } catch {
    return undefined;
  }
}

/**
 * Discovers only Inspector-owned manifests. Pending metadata is promoted only
 * after the caller supplies positive native marker evidence while holding the
 * session maintenance lease. Source filenames remain internal to discovery.
 */
export async function discoverHistory({
  root,
  sessionDirectory,
  markerEvidence,
  maintenance,
}: {
  root: string;
  sessionDirectory(): string;
  markerEvidence(sessionId: string, sourceFile: string): Promise<boolean>;
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
    const inspected = await inspectManifest({
      root,
      sessionId,
      sessionDirectory,
      markerEvidence,
      maintenance,
      diagnostics,
    });
    const row: HistorySession = {
      sessionId,
      availability: inspected.availability,
    };
    if (inspected.sourceFile !== undefined) {
      Object.defineProperty(row, "sourceFile", {
        value: inspected.sourceFile,
        enumerable: false,
      });
    }
    sessions.push(row);
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
  sessionDirectory,
  markerEvidence,
  maintenance,
  diagnostics,
}: {
  root: string;
  sessionId: string;
  sessionDirectory(): string;
  markerEvidence(sessionId: string, sourceFile: string): Promise<boolean>;
  maintenance: MaintenanceOptions;
  diagnostics: Set<HistoryDiagnostic>;
}): Promise<Pick<HistorySession, "availability" | "sourceFile">> {
  const paths = trackingMetadataPaths(root, sessionId);
  const metadata = await readMetadata(paths.metadataPath, sessionId);
  if (metadata !== undefined) {
    return availableManifest(
      metadata,
      sessionDirectory,
      sessionId,
      markerEvidence,
      diagnostics,
    );
  }

  const pending = await readMetadata(paths.pendingPath, sessionId);
  if (pending === undefined) {
    diagnostics.add("manifest-unavailable");
    return { availability: "unavailable" };
  }
  const pendingSource = await availableManifest(
    pending,
    sessionDirectory,
    sessionId,
    markerEvidence,
    diagnostics,
  );
  if (pendingSource.availability !== "available") return pendingSource;

  const lease = await acquireMaintenanceLease({
    directory: paths.sessionDirectory,
    ...maintenance,
  });
  if (lease === undefined) return { availability: "unavailable" };
  try {
    const promoted = await readMetadata(paths.metadataPath, sessionId);
    if (promoted !== undefined) {
      return availableManifest(
        promoted,
        sessionDirectory,
        sessionId,
        markerEvidence,
        diagnostics,
      );
    }
    const currentPending = await readMetadata(paths.pendingPath, sessionId);
    if (currentPending === undefined) {
      diagnostics.add("manifest-unavailable");
      return { availability: "unavailable" };
    }
    const current = await availableManifest(
      currentPending,
      sessionDirectory,
      sessionId,
      markerEvidence,
      diagnostics,
    );
    if (current.availability !== "available") return current;
    await rename(paths.pendingPath, paths.metadataPath);
    return current;
  } catch {
    return { availability: "unavailable" };
  } finally {
    await lease.release();
  }
}

async function availableManifest(
  metadata: TrackingMetadata,
  sessionDirectory: () => string,
  sessionId: string,
  markerEvidence: (sessionId: string, sourceFile: string) => Promise<boolean>,
  diagnostics: Set<HistoryDiagnostic>,
): Promise<Pick<HistorySession, "availability" | "sourceFile">> {
  if (!(await hasAvailableSource(metadata, sessionDirectory, diagnostics))) {
    return { availability: "unavailable" };
  }
  if (
    !(await hasMarkerEvidence(
      sessionId,
      metadata.sourceFile,
      markerEvidence,
      diagnostics,
    ))
  ) {
    return { availability: "unavailable" };
  }
  return { availability: "available", sourceFile: metadata.sourceFile };
}

async function hasAvailableSource(
  metadata: TrackingMetadata,
  sessionDirectory: () => string,
  diagnostics: Set<HistoryDiagnostic>,
): Promise<boolean> {
  try {
    if (
      (await resolveManifestSourceFile({
        sourceFile: metadata.sourceFile,
        sessionDirectory: sessionDirectory(),
      })) !== undefined
    ) {
      return true;
    }
  } catch {
    // Public session directory access is best-effort.
  }
  diagnostics.add("manifest-unavailable");
  return false;
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
  sourceFile: string,
  markerEvidence: (sessionId: string, sourceFile: string) => Promise<boolean>,
  diagnostics: Set<HistoryDiagnostic>,
): Promise<boolean> {
  try {
    return (await markerEvidence(sessionId, sourceFile)) === true;
  } catch {
    diagnostics.add("marker-unavailable");
    return false;
  }
}

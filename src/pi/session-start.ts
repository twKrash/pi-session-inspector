import { basename, dirname, join } from "node:path";

import {
  readInventory,
  type InventorySnapshot,
} from "../integrations/inventory.ts";
import { refreshInventorySnapshot } from "../storage/inventory-snapshot.ts";
import { isTrackingSourceFile } from "../storage/tracking.ts";

/** Structural subset of the public Pi API used to read the inventory. */
type InventoryApi = {
  getCommands?(): readonly unknown[];
  getAllTools?(): readonly unknown[];
};

/** Structural subset of the public Pi API used to start Inspector tracking. */
type SessionStartHandler = (
  event: unknown,
  context: {
    sessionManager: {
      getSessionId(): string;
      getSessionFile(): string | undefined;
      getSessionDir(): string;
    };
  },
) => Promise<void>;

/**
 * Structural subset of the public Pi API used for session lifecycle tracking.
 * Pi emits `session_shutdown` for the outgoing extension runtime before it
 * reloads and rebinds extensions for the replacement session, so it is the
 * runtime-termination signal for every reason (`quit`, `reload`, `new`,
 * `resume`, `fork`).
 */
type SessionTrackingApi = {
  on: {
    (event: "session_start", handler: SessionStartHandler): void;
    (event: "session_shutdown", handler: (event: unknown) => void): void;
  };
  appendEntry(type: string, data: unknown): void;
} & InventoryApi;

type SessionTracker = (input: {
  root: string;
  sessionId: string;
  sessionFile: string;
  sourceFile: string;
  appendEntry(type: string, data: unknown): void;
  revalidateSession(): boolean;
}) => Promise<boolean>;

/**
 * Reads the current sanitized inventory. Observer-only: a producer API that is
 * missing, throws, or returns non-array input yields `undefined` (unreadable),
 * never an empty fallback that could be mistaken for a genuine count of zero.
 */
export function readSessionInventory(
  api: InventoryApi,
): InventorySnapshot | undefined {
  try {
    if (
      typeof api.getCommands !== "function" ||
      typeof api.getAllTools !== "function"
    )
      return undefined;
    const commands = api.getCommands();
    const tools = api.getAllTools();
    if (!Array.isArray(commands) || !Array.isArray(tools)) return undefined;
    return readInventory(commands, tools);
  } catch {
    return undefined;
  }
}

/**
 * Builds and persists the active session's inventory snapshot. The persisted
 * snapshot is stamped with the observation time from `now` (the latest
 * successful observation, spec §14.2.1); the returned in-memory snapshot stays
 * payload-only. Failures are swallowed and yield `undefined` so callers never
 * substitute fabricated zero counts. Snapshot maintenance can never alter Pi
 * execution.
 */
export async function refreshSessionInventory({
  api,
  root,
  sessionId,
  now = () => new Date(),
}: {
  api: InventoryApi;
  root: string;
  sessionId: string;
  now?: () => Date;
}): Promise<InventorySnapshot | undefined> {
  const snapshot = readSessionInventory(api);
  if (snapshot === undefined) return undefined;
  try {
    await refreshInventorySnapshot({
      directory: join(root, "sessions", sessionId),
      snapshot,
      observedAt: now().toISOString(),
    });
  } catch {
    // Inventory persistence is observer-only.
  }
  return snapshot;
}

/** Registers best-effort tracking when Pi starts a session. */
export function registerSessionStartTracking(
  api: SessionTrackingApi,
  root: string,
  track: SessionTracker,
): void {
  try {
    api.on("session_start", (_event, context): Promise<void> => {
      let sessionId: string;
      let sessionFile: string;
      let sourceFile: string;
      let sessionDirectory: string;
      try {
        const capturedFile = context.sessionManager.getSessionFile();
        if (capturedFile === undefined) {
          // Ephemeral --no-session runs have no durable Inspector state.
          return Promise.resolve();
        }
        sessionFile = capturedFile;
        sessionDirectory = context.sessionManager.getSessionDir();
        sourceFile = basename(sessionFile);
        if (
          dirname(sessionFile) !== sessionDirectory ||
          !isTrackingSourceFile(sourceFile)
        ) {
          return Promise.resolve();
        }
        sessionId = context.sessionManager.getSessionId();
      } catch {
        // Session lookup must never alter Pi execution.
        return Promise.resolve();
      }

      try {
        void track({
          root,
          sessionId,
          sessionFile,
          sourceFile,
          appendEntry: api.appendEntry,
          revalidateSession: () => {
            try {
              return (
                context.sessionManager.getSessionId() === sessionId &&
                context.sessionManager.getSessionFile() === sessionFile &&
                context.sessionManager.getSessionDir() === sessionDirectory
              );
            } catch {
              return false;
            }
          },
        }).catch(() => {
          // Tracking must never alter Pi execution.
        });
      } catch {
        // Tracking must never alter Pi execution.
      }
      return Promise.resolve();
    });
  } catch {
    // Registration is best-effort and must never alter Pi execution.
  }
}

/**
 * Registers best-effort cleanup for the end of the current session runtime.
 * `session_shutdown` is emitted for the outgoing extension runtime before Pi
 * reloads and rebinds extensions, so it is where a runtime gives up the live
 * registrations it owns; without it a replacement runtime could inherit an
 * inert registration whose listeners Pi already removed.
 */
export function registerSessionShutdown(
  api: SessionTrackingApi,
  handler: (event: unknown) => void,
): void {
  try {
    api.on("session_shutdown", handler);
  } catch {
    // Lifecycle observation is best-effort and must never alter Pi execution.
  }
}

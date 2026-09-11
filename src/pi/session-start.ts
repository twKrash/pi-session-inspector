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
type SessionStartApi = {
  on(
    event: "session_start",
    handler: (
      event: unknown,
      context: {
        sessionManager: {
          getSessionId(): string;
          getSessionFile(): string | undefined;
          getSessionDir(): string;
        };
      },
    ) => Promise<void>,
  ): void;
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
 * Builds and persists the active session's inventory snapshot. Failures are
 * swallowed and yield `undefined` so callers never substitute fabricated zero
 * counts. Snapshot maintenance can never alter Pi execution.
 */
export async function refreshSessionInventory({
  api,
  root,
  sessionId,
}: {
  api: InventoryApi;
  root: string;
  sessionId: string;
}): Promise<InventorySnapshot | undefined> {
  const snapshot = readSessionInventory(api);
  if (snapshot === undefined) return undefined;
  try {
    await refreshInventorySnapshot({
      directory: join(root, "sessions", sessionId),
      snapshot,
    });
  } catch {
    // Inventory persistence is observer-only.
  }
  return snapshot;
}

/** Registers best-effort tracking when Pi starts a session. */
export function registerSessionStartTracking(
  api: SessionStartApi,
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

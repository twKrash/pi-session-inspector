import { join } from "node:path";

export type SessionWalDependencies = {
  createWriter(options: {
    root: string;
    onSegmentRotation(): void;
  }): Promise<unknown>;
  registerLive(api: unknown, writer: unknown): void | Promise<void>;
  scheduleMaintenance(input: {
    root: string;
    sessionId: string;
    sessionFile: string;
  }): void;
};

/** Starts payload-free live WAL observation for a promoted tracked session. */
export async function setupSessionWal(
  {
    root,
    sessionId,
    sessionFile,
    api,
  }: {
    root: string;
    sessionId: string;
    sessionFile: string;
    api: unknown;
  },
  { createWriter, registerLive, scheduleMaintenance }: SessionWalDependencies,
): Promise<void> {
  let maintenanceQueued = false;
  const scheduleRotationMaintenance = (): void => {
    if (maintenanceQueued) return;
    maintenanceQueued = true;
    queueMicrotask(() => {
      maintenanceQueued = false;
      try {
        scheduleMaintenance({ root, sessionId, sessionFile });
      } catch {
        // Rotation maintenance is observer-only and best-effort.
      }
    });
  };
  try {
    const writer = await createWriter({
      root: join(root, "sessions", sessionId),
      onSegmentRotation: scheduleRotationMaintenance,
    });
    await registerLive(api, writer);
  } catch {
    // WAL setup is observer-only and must not alter Pi execution.
  }
}

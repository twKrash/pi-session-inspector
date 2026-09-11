import { join } from "node:path";

export type SessionWalDependencies = {
  createWriter(options: {
    root: string;
    onSegmentRotation(): void;
  }): Promise<unknown>;
  registerLive(api: unknown, writer: unknown): void | Promise<void>;
  registerLiveCounters?(
    api: unknown,
    writer: unknown,
    context: { sessionId: string; inventoryNames(): ReadonlySet<string> },
  ): void;
  /** Bounded skill names the live counter producers may count (Task 8). */
  readInventoryNames?(): ReadonlySet<string>;
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
  {
    createWriter,
    registerLive,
    registerLiveCounters,
    readInventoryNames,
    scheduleMaintenance,
  }: SessionWalDependencies,
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
    try {
      registerLiveCounters?.(api, writer, {
        sessionId,
        // Until Task 8 supplies the real inventory the producer may count no
        // skill names, so no unknown name can ever be persisted.
        inventoryNames: () => readInventoryNames?.() ?? new Set<string>(),
      });
    } catch {
      // Counter registration is observer-only and must not alter Pi execution.
    }
  } catch {
    // WAL setup is observer-only and must not alter Pi execution.
  }
}

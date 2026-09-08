/** Storage operations required to start tracking a Pi session. */
export type TrackingStorage = {
  writePending(sessionId: string): Promise<void>;
  appendMarker(): void;
  promote(sessionId: string): Promise<void>;
};

/** Starts tracking only after pending metadata, the Pi marker, and promotion succeed. */
export async function startTracking(
  storage: TrackingStorage,
  sessionId: string,
  revalidateSession: () => boolean = () => true,
): Promise<boolean> {
  try {
    await storage.writePending(sessionId);
    if (!revalidateSession()) {
      return false;
    }
    storage.appendMarker();
    await storage.promote(sessionId);
    return true;
  } catch {
    return false;
  }
}

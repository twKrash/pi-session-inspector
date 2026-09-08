import { createTrackingStorage } from "../storage/tracking.ts";
import { startTracking } from "./tracking.ts";

/** Starts Inspector tracking through Pi's public marker append seam. */
export async function trackPiSession({
  root,
  sessionId,
  appendEntry,
  revalidateSession,
}: {
  root: string;
  sessionId: string;
  appendEntry(type: string, data: unknown): void;
  revalidateSession(): boolean;
}): Promise<boolean> {
  try {
    return await startTracking(
      createTrackingStorage({ root, sessionId, appendEntry }),
      sessionId,
      revalidateSession,
    );
  } catch {
    return false;
  }
}

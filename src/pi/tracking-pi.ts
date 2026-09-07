import { createTrackingStorage } from "../storage/tracking.ts";
import { startTracking } from "./tracking.ts";

/** Starts Inspector tracking through Pi's public marker append seam. */
export async function trackPiSession({
  root,
  sessionId,
  appendEntry,
}: {
  root: string;
  sessionId: string;
  appendEntry(type: string, data: unknown): void;
}): Promise<boolean> {
  try {
    return await startTracking(
      createTrackingStorage({ root, sessionId, appendEntry }),
      sessionId,
    );
  } catch {
    return false;
  }
}

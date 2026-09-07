/** Structural subset of the public Pi API used to start Inspector tracking. */
type SessionStartApi = {
  on(
    event: "session_start",
    handler: (
      event: unknown,
      context: { sessionManager: { getSessionId(): string } },
    ) => Promise<void>,
  ): void;
  appendEntry(type: string, data: unknown): void;
};

type SessionTracker = (input: {
  root: string;
  sessionId: string;
  appendEntry(type: string, data: unknown): void;
}) => Promise<boolean>;

/** Registers best-effort tracking when Pi starts a session. */
export function registerSessionStartTracking(
  api: SessionStartApi,
  root: string,
  track: SessionTracker,
): void {
  try {
    api.on("session_start", (_event, context): Promise<void> => {
      let sessionId: string;
      try {
        sessionId = context.sessionManager.getSessionId();
      } catch {
        // Session lookup must never alter Pi execution.
        return Promise.resolve();
      }

      try {
        void track({ root, sessionId, appendEntry: api.appendEntry }).catch(
          () => {
            // Tracking must never alter Pi execution.
          },
        );
      } catch {
        // Tracking must never alter Pi execution.
      }
      return Promise.resolve();
    });
  } catch {
    // Registration is best-effort and must never alter Pi execution.
  }
}

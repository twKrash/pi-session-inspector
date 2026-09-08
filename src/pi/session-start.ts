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
        };
      },
    ) => Promise<void>,
  ): void;
  appendEntry(type: string, data: unknown): void;
};

type SessionTracker = (input: {
  root: string;
  sessionId: string;
  appendEntry(type: string, data: unknown): void;
  revalidateSession(): boolean;
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
      let sessionFile: string;
      try {
        const capturedFile = context.sessionManager.getSessionFile();
        if (capturedFile === undefined) {
          // Ephemeral --no-session runs have no durable Inspector state.
          return Promise.resolve();
        }
        sessionFile = capturedFile;
        sessionId = context.sessionManager.getSessionId();
      } catch {
        // Session lookup must never alter Pi execution.
        return Promise.resolve();
      }

      try {
        void track({
          root,
          sessionId,
          appendEntry: api.appendEntry,
          revalidateSession: () => {
            try {
              return (
                context.sessionManager.getSessionId() === sessionId &&
                context.sessionManager.getSessionFile() === sessionFile
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

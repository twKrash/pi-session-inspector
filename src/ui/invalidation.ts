/** In-process invalidation identifying only the runtime and session. */
export type SessionInvalidation = {
  runtimeId: string;
  sessionId: string;
};

/** In-process, payload-free signal emitted after Inspector WAL persistence. */
export class SessionInvalidationSignal {
  private readonly listeners = new Set<(event: SessionInvalidation) => void>();

  subscribe(listener: (event: SessionInvalidation) => void): () => void {
    this.listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.listeners.delete(listener);
    };
  }

  notify(event: SessionInvalidation): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // UI observers must never affect persistence or Pi execution.
      }
    }
  }
}

export const sessionInvalidationSignal = new SessionInvalidationSignal();

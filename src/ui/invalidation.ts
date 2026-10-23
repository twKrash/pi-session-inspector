/** In-process, payload-free signal emitted after Inspector WAL persistence. */
export class SessionInvalidationSignal {
  private readonly listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.listeners.delete(listener);
    };
  }

  notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // UI observers must never affect persistence or Pi execution.
      }
    }
  }
}

export const sessionInvalidationSignal = new SessionInvalidationSignal();

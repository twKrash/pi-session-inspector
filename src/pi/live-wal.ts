import {
  registerLiveObserver,
  type LiveObserverApi,
  type LiveObserverEvent,
} from "./live.js";

export type LiveWalWriter = {
  append(event: {
    eventId: string;
    timestamp: string;
    kind: string;
  }): void | Promise<void>;
  flush(): Promise<void>;
};

export type LiveWalOptions = {
  now(): Date;
  randomId(): string;
};

/** Records payload-free lifecycle boundaries through the observer-only hook adapter. */
export function registerLiveWal(
  api: LiveObserverApi,
  writer: LiveWalWriter,
  { now, randomId }: LiveWalOptions,
): void {
  registerLiveObserver(api, (event) => {
    appendLifecycleRecord(event, writer, now, randomId);
  });
}

function appendLifecycleRecord(
  event: LiveObserverEvent,
  writer: LiveWalWriter,
  now: () => Date,
  randomId: () => string,
): void {
  const kind = event.kind;
  void Promise.resolve()
    .then(() =>
      writer.append({
        eventId: randomId(),
        timestamp: now().toISOString(),
        kind,
      }),
    )
    .catch(() => {
      // Clock, ID, and append failures must not alter Pi execution.
    });

  if (kind === "session_shutdown") {
    void Promise.resolve()
      .then(() => writer.flush())
      .catch(() => {
        // Storage failures must not alter Pi execution.
      });
  }
}

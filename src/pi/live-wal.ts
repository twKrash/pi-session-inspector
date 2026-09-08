import {
  registerLiveObserver,
  type LiveObserverApi,
  type LiveObserverEvent,
} from "./live.js";

const MAX_OPEN_TIMINGS_PER_CATEGORY = 64;

type TimingCategory = "agent" | "turn" | "tool" | "provider" | "model";
type TimingStatus = "running" | "unknown" | "unsupported";
type TimingConfidence = "live" | "unsupported";

export type LiveTiming = {
  category: TimingCategory;
  status: TimingStatus;
  confidence: TimingConfidence;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
};

export type LiveWalWriter = {
  append(event: {
    eventId: string;
    timestamp: string;
    kind: "live_timing";
    timing: LiveTiming;
  }): void | Promise<void>;
  flush(): Promise<void>;
};

export type LiveWalOptions = {
  now(): Date;
  randomId(): string;
};

type OpenTiming = { startedAt: string; startedMs: number };

/**
 * Records anonymous, payload-free lifecycle timing. Pi does not expose a safe
 * provider/model timing boundary, so those categories are persisted only as
 * explicitly unsupported rather than inferred from lifecycle payloads.
 */
export function registerLiveWal(
  api: LiveObserverApi,
  writer: LiveWalWriter,
  { now, randomId }: LiveWalOptions,
): void {
  const open = new Map<TimingCategory, OpenTiming[]>([
    ["agent", []],
    ["turn", []],
    ["tool", []],
  ]);

  appendUnsupported("provider", writer, now, randomId);
  appendUnsupported("model", writer, now, randomId);
  registerLiveObserver(api, (event) => {
    appendLifecycleTiming(event, open, writer, now, randomId);
  });
}

function appendUnsupported(
  category: "provider" | "model",
  writer: LiveWalWriter,
  now: () => Date,
  randomId: () => string,
): void {
  append(writer, randomId, now().toISOString(), {
    category,
    status: "unsupported",
    confidence: "unsupported",
  });
}

function appendLifecycleTiming(
  event: LiveObserverEvent,
  open: Map<TimingCategory, OpenTiming[]>,
  writer: LiveWalWriter,
  now: () => Date,
  randomId: () => string,
): void {
  const boundary = timingBoundary(event.kind);
  if (boundary === undefined) {
    if (event.kind === "session_shutdown") {
      scheduleFlush(writer);
    }
    return;
  }

  const current = now();
  const timestamp = current.toISOString();
  const queue = open.get(boundary.category);
  if (queue === undefined) return;

  if (boundary.start) {
    if (queue.length >= MAX_OPEN_TIMINGS_PER_CATEGORY) return;
    queue.push({ startedAt: timestamp, startedMs: current.getTime() });
    append(writer, randomId, timestamp, {
      category: boundary.category,
      status: "running",
      confidence: "live",
      startedAt: timestamp,
    });
    scheduleFlush(writer);
    return;
  }

  const started = queue.shift();
  if (started === undefined) return;
  append(writer, randomId, timestamp, {
    category: boundary.category,
    status: "unknown",
    confidence: "live",
    startedAt: started.startedAt,
    endedAt: timestamp,
    durationMs: Math.max(0, current.getTime() - started.startedMs),
  });
  scheduleFlush(writer);
}

function scheduleFlush(writer: LiveWalWriter): void {
  void Promise.resolve()
    .then(() => writer.flush())
    .catch(() => {
      // Storage failures must not alter Pi execution.
    });
}

function append(
  writer: LiveWalWriter,
  randomId: () => string,
  timestamp: string,
  timing: LiveTiming,
): void {
  void Promise.resolve()
    .then(() =>
      writer.append({
        eventId: randomId(),
        timestamp,
        kind: "live_timing",
        timing,
      }),
    )
    .catch(() => {
      // Clock, ID, and append failures must not alter Pi execution.
    });
}

function timingBoundary(
  kind: LiveObserverEvent["kind"],
): { category: "agent" | "turn" | "tool"; start: boolean } | undefined {
  switch (kind) {
    case "agent_start":
      return { category: "agent", start: true };
    case "agent_end":
      return { category: "agent", start: false };
    case "turn_start":
      return { category: "turn", start: true };
    case "turn_end":
      return { category: "turn", start: false };
    case "tool_execution_start":
      return { category: "tool", start: true };
    case "tool_execution_end":
      return { category: "tool", start: false };
    default:
      return undefined;
  }
}

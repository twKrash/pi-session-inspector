import { debugLog } from "../debug/log.ts";
import { canonicalOpaqueDigest } from "../core/opaque-id.ts";
import {
  registerLiveObserver,
  type LiveObserverApi,
  type LiveObserverEvent,
} from "./live.ts";

const MAX_OPEN_TIMINGS_PER_CATEGORY = 64;
const MAX_LIVE_OVERFLOW = Number.MAX_SAFE_INTEGER;

type TimingCategory = "agent" | "turn" | "tool" | "provider" | "model";
type TimingStatus = "running" | "unknown" | "unsupported";
type TimingConfidence = "live" | "unsupported";

export type LiveTiming = {
  category: TimingCategory;
  status: TimingStatus;
  confidence: TimingConfidence;
  subjectId?: string;
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
  sessionId: string;
  now(): Date;
  randomId(): string;
};

/** Bounded live-producer observation state. */
export type LiveWalRegistration = {
  /**
   * Saturating count of tool starts dropped because the session hit the
   * open-subject bound. A non-zero value marks live timing as partial.
   */
  liveOverflow(): number;
};

type OpenTiming = { startedAt: string; startedMs: number };

type LiveTimingContext = {
  sessionId: string;
  open: Map<TimingCategory, OpenTiming[]>;
  openTools: Map<string, OpenTiming>;
  writer: LiveWalWriter;
  now: () => Date;
  randomId: () => string;
  onOverflow: () => void;
};

/**
 * Records bounded, payload-free lifecycle timing. Pi does not expose a safe
 * provider/model timing boundary, so those categories are not persisted at all.
 * Tool boundaries pair through a subject id derived from the native tool-call
 * id; agent/turn boundaries stay anonymous FIFO.
 */
export function registerLiveWal(
  api: LiveObserverApi,
  writer: LiveWalWriter,
  { sessionId, now, randomId }: LiveWalOptions,
): LiveWalRegistration {
  const open = new Map<TimingCategory, OpenTiming[]>([
    ["agent", []],
    ["turn", []],
  ]);
  const openTools = new Map<string, OpenTiming>();
  let liveOverflow = 0;

  registerLiveObserver(api, (event) => {
    appendLifecycleTiming(event, {
      sessionId,
      open,
      openTools,
      writer,
      now,
      randomId,
      onOverflow: () => {
        if (liveOverflow < MAX_LIVE_OVERFLOW) liveOverflow += 1;
      },
    });
  });

  return { liveOverflow: () => liveOverflow };
}

function appendLifecycleTiming(
  event: LiveObserverEvent,
  context: LiveTimingContext,
): void {
  const boundary = timingBoundary(event.kind);
  if (boundary === undefined) {
    if (event.kind === "session_shutdown") {
      scheduleFlush(context.writer);
    }
    return;
  }

  const current = context.now();
  const timestamp = current.toISOString();

  if (boundary.category === "tool") {
    appendToolBoundary(event, boundary.start, current, timestamp, context);
    return;
  }

  const queue = context.open.get(boundary.category);
  if (queue === undefined) return;

  if (boundary.start) {
    if (queue.length >= MAX_OPEN_TIMINGS_PER_CATEGORY) return;
    queue.push({ startedAt: timestamp, startedMs: current.getTime() });
    append(context.writer, context.randomId, timestamp, {
      category: boundary.category,
      status: "running",
      confidence: "live",
      startedAt: timestamp,
    });
    scheduleFlush(context.writer);
    return;
  }

  const started = queue.shift();
  if (started === undefined) return;
  append(context.writer, context.randomId, timestamp, {
    category: boundary.category,
    status: "unknown",
    confidence: "live",
    startedAt: started.startedAt,
    endedAt: timestamp,
    durationMs: Math.max(0, current.getTime() - started.startedMs),
  });
  scheduleFlush(context.writer);
}

/**
 * Tool starts live in a subject-keyed map, never a FIFO queue, so two
 * overlapping tools pair correctly and an out-of-order completion cannot close
 * a different run. Overflow drops the new start and never evicts an older
 * subject that may still receive an end.
 */
function appendToolBoundary(
  event: LiveObserverEvent,
  start: boolean,
  current: Date,
  timestamp: string,
  context: LiveTimingContext,
): void {
  const subjectId = toolSubjectId(context.sessionId, event.toolCallId);
  if (subjectId === undefined) {
    debugLog("tool-timing", "subject-unavailable", {
      source: start ? "start" : "end",
      found: event.toolCallId !== undefined,
    });
    return;
  }

  if (start) {
    debugLog("tool-timing", "start-observed", {
      subject: subjectId,
      startedAtMs: current.getTime(),
    });
    if (context.openTools.has(subjectId)) {
      debugLog("tool-timing", "start-dropped", {
        subject: subjectId,
        reason: "already-open",
      });
      return;
    }
    if (context.openTools.size >= MAX_OPEN_TIMINGS_PER_CATEGORY) {
      context.onOverflow();
      debugLog("tool-timing", "start-dropped", {
        subject: subjectId,
        reason: "overflow",
      });
      return;
    }
    context.openTools.set(subjectId, {
      startedAt: timestamp,
      startedMs: current.getTime(),
    });
    debugLog("tool-timing", "start-stored", {
      subject: subjectId,
      startedAtMs: current.getTime(),
    });
    append(context.writer, context.randomId, timestamp, {
      category: "tool",
      status: "running",
      confidence: "live",
      subjectId,
      startedAt: timestamp,
    });
    scheduleFlush(context.writer);
    return;
  }

  debugLog("tool-timing", "end-observed", {
    subject: subjectId,
    endedAtMs: current.getTime(),
  });
  const started = context.openTools.get(subjectId);
  if (started === undefined) {
    debugLog("tool-timing", "pair-missing", {
      subject: subjectId,
      endedAtMs: current.getTime(),
    });
    return;
  }
  context.openTools.delete(subjectId);
  const durationMs = Math.max(0, current.getTime() - started.startedMs);
  debugLog("tool-timing", "pair-matched", {
    subject: subjectId,
    startedAtMs: started.startedMs,
    endedAtMs: current.getTime(),
    durationMs,
  });
  debugLog("tool-timing", "duration-computed", {
    subject: subjectId,
    durationMs,
    found: true,
  });
  append(context.writer, context.randomId, timestamp, {
    category: "tool",
    status: "unknown",
    confidence: "live",
    subjectId,
    startedAt: started.startedAt,
    endedAt: timestamp,
    durationMs,
  });
  scheduleFlush(context.writer);
}

function toolSubjectId(
  sessionId: string,
  toolCallId: string | undefined,
): string | undefined {
  if (toolCallId === undefined) return undefined;
  try {
    return `live-tool-${canonicalOpaqueDigest("live-tool", sessionId, toolCallId)}`;
  } catch {
    return undefined;
  }
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
    .then(async () => {
      const eventId = randomId();
      await writer.append({
        eventId,
        timestamp,
        kind: "live_timing",
        timing,
      });
      debugLog("tool-timing", "wal-append", {
        source: timing.category,
        status: timing.status,
        found: true,
        recordId: eventId,
        ...(timing.durationMs === undefined
          ? {}
          : { durationMs: timing.durationMs }),
      });
    })
    .catch(() => {
      // Clock, ID, and append failures must not alter Pi execution.
      debugLog("tool-timing", "wal-append", {
        source: timing.category,
        status: timing.status,
        found: false,
      });
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

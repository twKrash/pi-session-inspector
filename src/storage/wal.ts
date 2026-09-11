import { randomUUID } from "node:crypto";
import { appendFile, mkdir, open, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { validateTelemetry } from "../pi/telemetry.js";

const ASCII_TOKEN = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const MAX_TOKEN_LENGTH = 128;
const MAX_PENDING_BYTES = 1024 * 1024;
const MAX_PENDING_EVENTS = 64;
const MAX_PENDING_FLUSH_BYTES = 256 * 1024;
const FLUSH_INTERVAL_MS = 200;
const DATE_ROTATION_SKEW_MS = 50;
const MAX_TELEMETRY_MAP_ENTRIES = 12;
const MAX_WAL_SEGMENT_BYTES = 16 * 1024 * 1024;
const MAX_SEGMENT_FRAGMENTS_PER_DAY = 1_024;

type LiveTiming = {
  category: "agent" | "turn" | "tool" | "provider" | "model";
  status: "running" | "unknown" | "unsupported";
  confidence: "live" | "unsupported";
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
};

type WalEvent = {
  eventId: string;
  timestamp: string;
  kind: string;
  timing?: LiveTiming;
};

type StoredWalEvent = WalEvent & {
  writerId: string;
  writerSequence: number;
};

type StoredTelemetryEvent = StoredWalEvent & {
  kind: "telemetry";
  telemetry: Record<string, unknown>;
};

type PendingEvent = {
  event: StoredWalEvent | StoredTelemetryEvent;
  bytes: number;
  segmentDate: string;
};

type WalWriter = {
  append(event: WalEvent): void;
  appendTelemetry(envelope: unknown): void;
  flush(): Promise<void>;
};

function isAsciiToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_TOKEN_LENGTH &&
    ASCII_TOKEN.test(value)
  );
}

function isSupportedEvent(event: WalEvent): boolean {
  return (
    isAsciiToken(event.eventId) &&
    isAsciiToken(event.kind) &&
    typeof event.timestamp === "string" &&
    event.timestamp.length <= 64 &&
    !Number.isNaN(Date.parse(event.timestamp)) &&
    (event.timing === undefined || isLiveTiming(event.timing))
  );
}

function isLiveTiming(value: LiveTiming): boolean {
  return (
    (value.category === "agent" ||
      value.category === "turn" ||
      value.category === "tool" ||
      value.category === "provider" ||
      value.category === "model") &&
    (value.status === "running" ||
      value.status === "unknown" ||
      value.status === "unsupported") &&
    (value.confidence === "live" || value.confidence === "unsupported") &&
    (value.startedAt === undefined || isTimestamp(value.startedAt)) &&
    (value.endedAt === undefined || isTimestamp(value.endedAt)) &&
    (value.durationMs === undefined ||
      (Number.isFinite(value.durationMs) && value.durationMs >= 0))
  );
}

function isTimestamp(value: string): boolean {
  return value.length <= 64 && !Number.isNaN(Date.parse(value));
}

function utcDate(value: Date): string | undefined {
  const milliseconds = value.getTime();
  if (!Number.isFinite(milliseconds)) return undefined;
  return new Date(milliseconds).toISOString().slice(0, 10);
}

export async function createWalWriter({
  root,
  writerId,
  now,
  write = (path, data) => appendFile(path, data, "utf8"),
  onSegmentRotation,
}: {
  root: string;
  writerId?: string;
  now: () => Date;
  write?: (path: string, data: string) => Promise<void>;
  onSegmentRotation?: () => void;
}): Promise<WalWriter> {
  const immutableWriterId = writerId ?? randomUUID();
  if (!isAsciiToken(immutableWriterId)) {
    throw new TypeError("writerId must be an ASCII token");
  }

  const shardDirectory = join(root, "wal", immutableWriterId);
  await mkdir(shardDirectory, { recursive: true });
  const owner = await open(join(shardDirectory, ".owner"), "wx");
  await owner.writeFile(`${process.pid}\n`);
  await owner.close();

  let disabled = false;
  let sequence = 0;
  let pending: PendingEvent[] = [];
  let pendingBytes = 0;
  let flushing: Promise<void> | undefined;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let thresholdFlushQueued = false;
  let activeSegment:
    | { date: string; fragment: number; bytes: number }
    | undefined;
  let dateRotationTimer: ReturnType<typeof setTimeout> | undefined;
  const fragmentCounts = new Map<string, number>();

  const clearScheduledFlushes = (): void => {
    if (flushTimer !== undefined) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    if (dateRotationTimer !== undefined) {
      clearTimeout(dateRotationTimer);
      dateRotationTimer = undefined;
    }
    thresholdFlushQueued = false;
  };

  const scheduleDateRotation = (): void => {
    if (dateRotationTimer !== undefined) {
      clearTimeout(dateRotationTimer);
      dateRotationTimer = undefined;
    }
    if (disabled || activeSegment === undefined) return;
    let milliseconds: number;
    try {
      milliseconds = now().getTime();
    } catch {
      return;
    }
    if (!Number.isFinite(milliseconds)) return;
    const nextUtcDay = new Date(milliseconds);
    nextUtcDay.setUTCHours(24, 0, 0, 0);
    dateRotationTimer = setTimeout(
      () => {
        dateRotationTimer = undefined;
        void flush();
      },
      nextUtcDay.getTime() - milliseconds + DATE_ROTATION_SKEW_MS,
    );
    dateRotationTimer.unref?.();
  };

  const closeExpiredActiveSegment = async (): Promise<void> => {
    if (disabled) return;
    const active = activeSegment;
    if (active === undefined) return;
    let currentDate: string | undefined;
    try {
      currentDate = utcDate(now());
    } catch {
      return;
    }
    if (currentDate === undefined || active.date >= currentDate) return;
    try {
      await writeFile(
        join(
          shardDirectory,
          `${segmentName(active.date, active.fragment)}.closed`,
        ),
        "1\n",
        { flag: "wx", mode: 0o600 },
      );
    } catch {
      // Never re-append a fragment whose open state cannot be proven.
      activeSegment = undefined;
      return;
    }
    activeSegment = undefined;
    scheduleRotation(onSegmentRotation);
  };

  const flush = (): Promise<void> => {
    clearScheduledFlushes();
    if (disabled || flushing) {
      return flushing ?? Promise.resolve();
    }

    flushing = (async () => {
      while (!disabled && pending.length > 0) {
        const batch = pending.splice(0, MAX_PENDING_EVENTS);
        pendingBytes -= batch.reduce((total, { bytes }) => total + bytes, 0);
        for (const group of groupByCreationDate(batch)) {
          if (disabled) break;
          const data = group.events
            .map(({ event }) => `${JSON.stringify(event)}\n`)
            .join("");
          const dataBytes = Buffer.byteLength(data, "utf8");
          const next = nextSegment(group.date, dataBytes);
          if (next === undefined) {
            disabled = true;
            pending = [];
            pendingBytes = 0;
            clearScheduledFlushes();
            break;
          }
          try {
            const previous = activeSegment;
            const rotated =
              previous !== undefined &&
              (previous.date !== next.date ||
                previous.fragment !== next.fragment);
            // Once published closed, this path is never used for append again.
            if (rotated) {
              await writeFile(
                join(
                  shardDirectory,
                  `${segmentName(previous.date, previous.fragment)}.closed`,
                ),
                "1\n",
                { flag: "wx", mode: 0o600 },
              );
            }
            await write(
              join(shardDirectory, segmentName(next.date, next.fragment)),
              data,
            );

            activeSegment = next;
            if (rotated) scheduleRotation(onSegmentRotation);
          } catch {
            disabled = true;
            pending = [];
            pendingBytes = 0;
            clearScheduledFlushes();
            break;
          }
        }
      }
      await closeExpiredActiveSegment();
    })().finally(() => {
      flushing = undefined;
      scheduleDateRotation();
      if (!disabled && pending.length > 0) {
        void flush();
      }
    });

    return flushing;
  };

  return {
    append(event): void {
      if (disabled) {
        return;
      }

      let snapshot: WalEvent;
      try {
        snapshot = {
          eventId: event.eventId,
          timestamp: event.timestamp,
          kind: event.kind,
          ...(event.timing === undefined
            ? {}
            : { timing: { ...event.timing } }),
        };
      } catch {
        return;
      }
      if (!isSupportedEvent(snapshot)) {
        return;
      }

      enqueue(
        {
          eventId: snapshot.eventId,
          timestamp: snapshot.timestamp,
          kind: snapshot.kind,
          ...(snapshot.timing === undefined
            ? {}
            : { timing: { ...snapshot.timing } }),
          writerId: immutableWriterId,
          writerSequence: sequence + 1,
        },
        snapshot.timestamp,
      );
    },
    appendTelemetry(envelope): void {
      if (disabled) {
        return;
      }

      try {
        const snapshot = snapshotTelemetry(envelope);
        if (snapshot === undefined) {
          return;
        }
        const result = validateTelemetry(snapshot);
        if (!result.ok) {
          return;
        }

        const timestamp = now().toISOString();
        enqueue(
          {
            eventId: randomUUID(),
            timestamp,
            kind: "telemetry",
            telemetry: result.envelope,
            writerId: immutableWriterId,
            writerSequence: sequence + 1,
          },
          timestamp,
        );
      } catch {
        // Telemetry is observer-only; malformed local sink input is discarded.
      }
    },
    flush,
  };

  function nextSegment(
    date: string,
    dataBytes: number,
  ): { date: string; fragment: number; bytes: number } | undefined {
    const active = activeSegment;
    const reuse =
      active !== undefined &&
      active.date === date &&
      active.bytes + dataBytes <= MAX_WAL_SEGMENT_BYTES;
    if (reuse && active !== undefined) {
      return {
        date,
        fragment: active.fragment,
        bytes: active.bytes + dataBytes,
      };
    }
    const fragment = (fragmentCounts.get(date) ?? -1) + 1;
    if (fragment >= MAX_SEGMENT_FRAGMENTS_PER_DAY) return undefined;
    fragmentCounts.set(date, fragment);
    return { date, fragment, bytes: dataBytes };
  }

  function enqueue(
    event: StoredWalEvent | StoredTelemetryEvent,
    createdAt: string,
  ): void {
    if (disabled) {
      return;
    }

    const recordBytes = Buffer.byteLength(`${JSON.stringify(event)}\n`, "utf8");
    if (pendingBytes + recordBytes > MAX_PENDING_BYTES) {
      disabled = true;
      pending = [];
      pendingBytes = 0;
      clearScheduledFlushes();
      return;
    }

    sequence += 1;
    pending.push({
      event,
      bytes: recordBytes,
      segmentDate: new Date(createdAt).toISOString().slice(0, 10),
    });
    pendingBytes += recordBytes;
    if (
      (pending.length >= MAX_PENDING_EVENTS ||
        pendingBytes >= MAX_PENDING_FLUSH_BYTES) &&
      !thresholdFlushQueued
    ) {
      thresholdFlushQueued = true;
      queueMicrotask(() => {
        if (!thresholdFlushQueued) {
          return;
        }
        thresholdFlushQueued = false;
        void flush();
      });
      return;
    }

    if (pending.length === 1 && !flushing && flushTimer === undefined) {
      flushTimer = setTimeout(() => {
        flushTimer = undefined;
        void flush();
      }, FLUSH_INTERVAL_MS);
      flushTimer.unref?.();
    }
  }
}

function scheduleRotation(callback: (() => void) | undefined): void {
  if (callback === undefined) return;
  queueMicrotask(() => {
    try {
      callback();
    } catch {
      // Maintenance notification must not affect writer flush or Pi.
    }
  });
}

function groupByCreationDate(
  batch: readonly PendingEvent[],
): Array<{ date: string; events: PendingEvent[] }> {
  const groups: Array<{ date: string; events: PendingEvent[] }> = [];
  for (const pending of batch) {
    const current = groups.at(-1);
    if (current?.date === pending.segmentDate) current.events.push(pending);
    else groups.push({ date: pending.segmentDate, events: [pending] });
  }
  return groups;
}

function segmentName(date: string, fragment: number): string {
  return fragment === 0
    ? `${date}.jsonl`
    : `${date}.${String(fragment).padStart(4, "0")}.jsonl`;
}

function snapshotTelemetry(
  envelope: unknown,
): Record<string, unknown> | undefined {
  if (envelope === null || typeof envelope !== "object") {
    return undefined;
  }

  try {
    if (!isPlainTelemetryRecord(envelope)) {
      return undefined;
    }

    const input = envelope;
    const schemaVersion = input.schemaVersion;
    const source = input.source;
    const metric = input.metric;
    const value = input.value;
    const unit = input.unit;
    const kind = input.kind;
    const dimensions = input.dimensions;
    const timestamp = input.timestamp;
    const attribution = input.attribution;
    const snapshot: Record<string, unknown> = {
      schemaVersion,
      source,
      metric,
      value,
      kind,
    };

    if (unit !== undefined) snapshot.unit = unit;
    if (timestamp !== undefined) snapshot.timestamp = timestamp;
    if (dimensions !== undefined) {
      const copiedDimensions = snapshotTelemetryMap(dimensions);
      if (copiedDimensions === undefined) return undefined;
      snapshot.dimensions = copiedDimensions;
    }
    if (attribution !== undefined) {
      const copiedAttribution = snapshotTelemetryMap(attribution);
      if (copiedAttribution === undefined) return undefined;
      snapshot.attribution = copiedAttribution;
    }
    return snapshot;
  } catch {
    return undefined;
  }
}

function snapshotTelemetryMap(
  input: unknown,
): Record<string, string | number | boolean> | undefined {
  try {
    if (!isPlainTelemetryRecord(input)) {
      return undefined;
    }

    const snapshot: Record<string, string | number | boolean> =
      Object.create(null);
    let entries = 0;
    for (const key in input) {
      if (!Object.hasOwn(input, key)) {
        continue;
      }
      if (entries >= MAX_TELEMETRY_MAP_ENTRIES) {
        return undefined;
      }

      const value = input[key];
      if (
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean"
      ) {
        return undefined;
      }
      snapshot[key] = value;
      entries += 1;
    }
    return snapshot;
  } catch {
    return undefined;
  }
}

function isPlainTelemetryRecord(
  value: unknown,
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

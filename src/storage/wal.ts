import { randomUUID } from "node:crypto";
import { appendFile, mkdir, open } from "node:fs/promises";
import { join } from "node:path";

import { validateTelemetry } from "../pi/telemetry.js";

const ASCII_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_TOKEN_LENGTH = 128;
const MAX_PENDING_BYTES = 1024 * 1024;
const MAX_PENDING_EVENTS = 64;
const MAX_PENDING_FLUSH_BYTES = 256 * 1024;
const FLUSH_INTERVAL_MS = 200;
const MAX_TELEMETRY_MAP_ENTRIES = 12;

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

export async function createWalWriter({
  root,
  writerId,
  now,
  write = (path, data) => appendFile(path, data, "utf8"),
}: {
  root: string;
  writerId?: string;
  now: () => Date;
  write?: (path: string, data: string) => Promise<void>;
}): Promise<WalWriter> {
  const immutableWriterId = writerId ?? randomUUID();
  if (!isAsciiToken(immutableWriterId)) {
    throw new TypeError("writerId must be an ASCII token");
  }

  const shardDirectory = join(root, "wal", immutableWriterId);
  await mkdir(shardDirectory, { recursive: true });
  const owner = await open(join(shardDirectory, ".owner"), "wx");
  await owner.close();

  let disabled = false;
  let sequence = 0;
  let pending: PendingEvent[] = [];
  let pendingBytes = 0;
  let flushing: Promise<void> | undefined;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let thresholdFlushQueued = false;

  const clearScheduledFlushes = (): void => {
    if (flushTimer !== undefined) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    thresholdFlushQueued = false;
  };

  const flush = (): Promise<void> => {
    clearScheduledFlushes();
    if (disabled || flushing) {
      return flushing ?? Promise.resolve();
    }

    flushing = (async () => {
      while (!disabled && pending.length > 0) {
        const batch = pending.splice(0, MAX_PENDING_EVENTS);
        const events = batch.map(({ event }) => event);
        pendingBytes -= batch.reduce((total, { bytes }) => total + bytes, 0);
        const date = now().toISOString().slice(0, 10);
        const destination = join(shardDirectory, `${date}.jsonl`);

        try {
          await write(
            destination,
            events.map((event) => `${JSON.stringify(event)}\n`).join(""),
          );
        } catch {
          disabled = true;
          pending = [];
          pendingBytes = 0;
          clearScheduledFlushes();
        }
      }
    })().finally(() => {
      flushing = undefined;
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

      enqueue({
        eventId: snapshot.eventId,
        timestamp: snapshot.timestamp,
        kind: snapshot.kind,
        ...(snapshot.timing === undefined
          ? {}
          : { timing: { ...snapshot.timing } }),
        writerId: immutableWriterId,
        writerSequence: sequence + 1,
      });
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

        enqueue({
          eventId: randomUUID(),
          timestamp: now().toISOString(),
          kind: "telemetry",
          telemetry: result.envelope,
          writerId: immutableWriterId,
          writerSequence: sequence + 1,
        });
      } catch {
        // Telemetry is observer-only; malformed local sink input is discarded.
      }
    },
    flush,
  };

  function enqueue(event: StoredWalEvent | StoredTelemetryEvent): void {
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
    pending.push({ event, bytes: recordBytes });
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

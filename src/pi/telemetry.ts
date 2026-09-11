import { REDACTED, secretLikeValue } from "../core/redact.ts";

const MAX_ENVELOPE_BYTES = 8 * 1024;
const MAX_SOURCE_BYTES = 64;
const MAX_METRIC_BYTES = 96;
const MAX_UNIT_BYTES = 24;
const MAX_STRING_VALUE_BYTES = 128;
const MAX_DIMENSIONS = 12;
const MAX_DIMENSION_KEY_BYTES = 48;
const MAX_DIMENSION_STRING_VALUE_BYTES = 128;
const MAX_ATTRIBUTION_ID_BYTES = 128;

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const encoder = new TextEncoder();

type TelemetryValue = number | string | boolean;
type TelemetryMapValue = string | number | boolean;

export type TelemetryEnvelope = {
  schemaVersion: 1;
  source: string;
  metric: string;
  value: TelemetryValue;
  unit?: string;
  kind: "event" | "counter" | "gauge";
  dimensions?: Record<string, TelemetryMapValue>;
  timestamp?: number;
  attribution?: Record<string, string>;
};

export type TelemetryValidationResult =
  | { ok: true; envelope: TelemetryEnvelope }
  | { ok: false; code: "invalid" };

type TelemetrySink = {
  appendTelemetry(envelope: TelemetryEnvelope): void;
};

/** Validates and redacts a telemetry envelope before it can reach aggregation or storage. */
export function consumeTelemetry(input: unknown, sink: TelemetrySink): void {
  try {
    const result = validateTelemetry(input);
    if (result.ok) sink.appendTelemetry(result.envelope);
  } catch {
    // Telemetry is observer-only; sink failures must not affect Pi execution.
  }
}

export function validateTelemetry(input: unknown): TelemetryValidationResult {
  try {
    if (!isPlainRecord(input) || jsonBytes(input) > MAX_ENVELOPE_BYTES) {
      return invalid();
    }

    const schemaVersion = input.schemaVersion;
    const source = input.source;
    const metric = input.metric;
    const value = input.value;
    const kind = input.kind;

    if (
      schemaVersion !== 1 ||
      !isToken(source, MAX_SOURCE_BYTES) ||
      !isToken(metric, MAX_METRIC_BYTES) ||
      !isValue(value, MAX_STRING_VALUE_BYTES) ||
      !isKind(kind) ||
      (kind === "counter" && typeof value !== "number")
    ) {
      return invalid();
    }

    const unit = input.unit;
    if (unit !== undefined && !isToken(unit, MAX_UNIT_BYTES)) {
      return invalid();
    }

    const timestamp = input.timestamp;
    if (timestamp !== undefined && !isFiniteNumber(timestamp)) {
      return invalid();
    }

    const dimensions = sanitizeDimensions(input.dimensions);
    if (dimensions === undefined && input.dimensions !== undefined) {
      return invalid();
    }

    const attribution = sanitizeAttribution(input.attribution);
    if (attribution === undefined && input.attribution !== undefined) {
      return invalid();
    }

    const envelope: TelemetryEnvelope = {
      schemaVersion: 1,
      source: redact(source),
      metric: redact(metric),
      value: typeof value === "string" ? redact(value) : value,
      kind,
    };
    if (unit !== undefined) envelope.unit = redact(unit);
    if (timestamp !== undefined) envelope.timestamp = timestamp;
    if (dimensions !== undefined) envelope.dimensions = dimensions;
    if (attribution !== undefined) envelope.attribution = attribution;

    return { ok: true, envelope };
  } catch {
    return invalid();
  }
}

function invalid(): TelemetryValidationResult {
  return { ok: false, code: "invalid" };
}

function sanitizeDimensions(
  input: unknown,
): Record<string, TelemetryMapValue> | undefined {
  if (!isPlainRecord(input)) return undefined;
  const entries = Object.entries(input);
  if (entries.length > MAX_DIMENSIONS) return undefined;

  const dimensions: Record<string, TelemetryMapValue> = Object.create(null);
  for (const [key, value] of entries) {
    if (
      !isToken(key, MAX_DIMENSION_KEY_BYTES) ||
      !isValue(value, MAX_DIMENSION_STRING_VALUE_BYTES)
    ) {
      return undefined;
    }
    dimensions[key] =
      typeof value === "string" ? redactForKey(key, value) : value;
  }
  return dimensions;
}

function sanitizeAttribution(
  input: unknown,
): Record<string, string> | undefined {
  if (!isPlainRecord(input)) return undefined;

  const attribution: Record<string, string> = Object.create(null);
  for (const [key, value] of Object.entries(input)) {
    if (
      !isToken(key, MAX_DIMENSION_KEY_BYTES) ||
      typeof value !== "string" ||
      byteLength(value) > MAX_ATTRIBUTION_ID_BYTES
    ) {
      return undefined;
    }
    attribution[key] = redactForKey(key, value);
  }
  return attribution;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(Object.getOwnPropertyDescriptors(value)).every(
    (descriptor) => descriptor.enumerable === false || "value" in descriptor,
  );
}

function isToken(value: unknown, maximumBytes: number): value is string {
  return (
    typeof value === "string" &&
    byteLength(value) <= maximumBytes &&
    TOKEN.test(value)
  );
}

function isValue(
  value: unknown,
  maximumStringBytes: number,
): value is TelemetryValue {
  return (
    typeof value === "boolean" ||
    isFiniteNumber(value) ||
    (typeof value === "string" && byteLength(value) <= maximumStringBytes)
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isKind(value: unknown): value is TelemetryEnvelope["kind"] {
  return value === "event" || value === "counter" || value === "gauge";
}

function redactForKey(key: string, value: string): string {
  return secretLikeKey(key) ? REDACTED : redact(value);
}

function redact(value: string): string {
  return secretLikeValue(value) ? REDACTED : value;
}

function secretLikeKey(key: string): boolean {
  return /(?:authorization|bearer|credential|password|private.?key|secret|token)/i.test(
    key,
  );
}

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

function jsonBytes(value: unknown): number {
  const serialized = jsonSize(value, new Set<object>());
  return serialized === undefined ? Number.POSITIVE_INFINITY : serialized;
}

function jsonSize(value: unknown, ancestors: Set<object>): number | undefined {
  if (value === null) return 4;
  if (typeof value === "string") return byteLength(JSON.stringify(value));
  if (typeof value === "boolean") return value ? 4 : 5;
  if (typeof value === "number")
    return Number.isFinite(value) ? byteLength(JSON.stringify(value)) : 4;
  if (
    typeof value !== "object" ||
    !isPlainRecord(value) ||
    ancestors.has(value)
  )
    return undefined;

  ancestors.add(value);
  let size = 2;
  let count = 0;
  for (const key of Object.keys(value)) {
    const child = jsonSize(value[key], ancestors);
    if (child === undefined) {
      ancestors.delete(value);
      return undefined;
    }
    size +=
      (count++ === 0 ? 0 : 1) + byteLength(JSON.stringify(key)) + 1 + child;
    if (size > MAX_ENVELOPE_BYTES) {
      ancestors.delete(value);
      return size;
    }
  }
  ancestors.delete(value);
  return size;
}

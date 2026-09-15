import {
  boundedDebugFields,
  DEBUG_COMPONENTS,
  DEBUG_EVENTS,
  MAX_DEBUG_LINE_BYTES,
  type DebugComponent,
} from "./events.ts";

/** One already-serialized JSONL line; the sink owns durability. */
export type DebugSink = (line: string) => void;

let enabled = false;
let sink: DebugSink | undefined;

/**
 * Configures the process-local debug sink. Debug logging is off until this is
 * called with `enabled: true` from resolved configuration (ADR 0019), and a
 * sink failure is always swallowed: the facility is diagnostic and must never
 * alter Inspector or Pi execution.
 */
export function configureDebugLog(options: {
  enabled: boolean;
  sink?: DebugSink;
}): void {
  enabled = options.enabled === true && options.sink !== undefined;
  sink = options.sink;
}

/** Current debug state, so callers can skip building events they cannot emit. */
export function debugLogEnabled(): boolean {
  return enabled;
}

/** Restores the default: no sink, no events. */
export function resetDebugLog(): void {
  enabled = false;
  sink = undefined;
}

/**
 * Writes one bounded debug event. Unknown components, unknown event names, and
 * non-allowlisted or unbounded fields are dropped rather than logged.
 */
export function debugLog(
  component: DebugComponent,
  event: string,
  fields?: Readonly<Record<string, unknown>>,
): void {
  if (!enabled || sink === undefined) return;
  try {
    if (!DEBUG_COMPONENTS.includes(component)) return;
    if (!DEBUG_EVENTS[component].includes(event)) return;
    const bounded = boundedDebugFields(fields);
    const line = `${JSON.stringify({
      schemaVersion: 1,
      component,
      event,
      ...bounded,
    })}\n`;
    // The allowlisted vocabulary keeps an event tiny; this is the hard stop
    // that keeps one event from ever breaching the file bound.
    if (Buffer.byteLength(line, "utf8") > MAX_DEBUG_LINE_BYTES) return;
    sink(line);
  } catch {
    // Debug logging never affects Inspector or Pi execution.
  }
}

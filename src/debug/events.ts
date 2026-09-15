/**
 * Bounded debug-event vocabulary (ADR 0019). A debug event carries only
 * explicitly allowlisted field names whose values are numbers, booleans, or
 * bounded tokens: never prompts, tool arguments, tool results, environment
 * values, producer payloads, unrestricted paths, or free text.
 */

/** The Inspector components that may emit debug events. */
export const DEBUG_COMPONENTS = [
  "registry",
  "integration",
  "tool-timing",
  "settings",
] as const;

export type DebugComponent = (typeof DEBUG_COMPONENTS)[number];

/** Event names per component; an unlisted name is dropped, never written. */
export const DEBUG_EVENTS: Readonly<Record<DebugComponent, readonly string[]>> =
  {
    registry: ["initialized", "adapter-registered", "adapter-rejected"],
    integration: [
      "presence-evaluated",
      "persisted-evidence",
      "evidence-rejected",
      "live-registered",
      "live-registration-failed",
      "live-disposed",
      "observation-produced",
    ],
    "tool-timing": [
      "start-observed",
      "subject-created",
      "subject-unavailable",
      "start-stored",
      "start-dropped",
      "end-observed",
      "pair-matched",
      "pair-missing",
      "duration-computed",
      "wal-append",
      "wal-replayed",
      "timing-fact",
      "canonical-accepted",
      "canonical-rejected",
      "canonical-correlated",
      "canonical-uncorrelated",
    ],
    settings: ["loaded", "malformed", "resolved"],
  };

/**
 * The field allowlist, by name. A field outside this set is dropped: the
 * vocabulary is closed so no future caller can accidentally log a payload.
 */
const DEBUG_FIELDS: Readonly<Record<string, "number" | "boolean" | "token">> = {
  adapter: "token",
  code: "token",
  counters: "number",
  durationMs: "number",
  endedAtMs: "number",
  found: "boolean",
  integration: "token",
  match: "token",
  presence: "token",
  reason: "token",
  recordId: "token",
  source: "token",
  startedAtMs: "number",
  status: "token",
  subject: "token",
  version: "number",
};

/** Bounded token: a plain name or one canonical `<domain>-<64hex>` digest. */
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;

/**
 * One serialized debug line is bounded: the allowlisted vocabulary makes an
 * event far smaller than this, and the bound is what lets the file sink
 * guarantee its rotation limit.
 */
export const MAX_DEBUG_LINE_BYTES = 8_192;

/** Copies only allowlisted, bounded fields; anything else is dropped. */
export function boundedDebugFields(
  fields: Readonly<Record<string, unknown>> | undefined,
): Record<string, number | boolean | string> {
  const bounded: Record<string, number | boolean | string> = {};
  if (fields === undefined) return bounded;
  for (const [key, value] of Object.entries(fields)) {
    const kind = DEBUG_FIELDS[key];
    if (kind === undefined) continue;
    if (kind === "number") {
      if (typeof value === "number" && Number.isFinite(value)) {
        bounded[key] = value;
      }
      continue;
    }
    if (kind === "boolean") {
      if (typeof value === "boolean") bounded[key] = value;
      continue;
    }
    if (typeof value === "string" && TOKEN.test(value)) bounded[key] = value;
  }
  return bounded;
}

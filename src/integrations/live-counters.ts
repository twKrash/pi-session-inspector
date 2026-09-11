import { SKILL_NAME_PATTERN } from "../core/live-counter-fold.ts";

const SKILL_PREFIX = "/skill:";

/**
 * Permission resolution classes are a closed vocabulary. Any producer value
 * outside this set is retained only as the bounded placeholder "other"; raw
 * producer text never reaches the WAL.
 */
const PERMISSION_RESOLUTIONS: ReadonlySet<string> = new Set([
  "policy_allow",
  "policy_deny",
  "session_approved",
  "infrastructure_auto_allowed",
  "user_approved",
  "user_approved_for_session",
  "user_denied",
  "auto_approved",
  "confirmation_unavailable",
  "authorizer_allowed",
  "authorizer_denied",
  "gate_error",
]);

function readResolution(value: unknown): string {
  return typeof value === "string" && PERMISSION_RESOLUTIONS.has(value)
    ? value
    : "other";
}

/** Extracts only a bounded skill identity; the remainder is never retained. */
export function readSkillCommandName(text: string): string | undefined {
  if (!text.startsWith(SKILL_PREFIX)) return undefined;
  const rest = text.slice(SKILL_PREFIX.length);
  const end = rest.search(/\s/);
  const name = end === -1 ? rest : rest.slice(0, end);
  return SKILL_NAME_PATTERN.test(name) ? name : undefined;
}

export type LiveCounterWriter = {
  appendTelemetry(envelope: unknown): void;
  flush(): Promise<void>;
};

export type LiveCounterApi = {
  events: { on(channel: string, handler: (data: unknown) => void): () => void };
  on(
    event: "input",
    handler: (event: { text: string }, ctx?: unknown) => void,
  ): unknown;
};

export type LiveCounterRegistration = {
  /** Removes every retained listener; safe to call repeatedly. */
  dispose(): void;
};

/**
 * Exactly one live registration per session. A repeated `session_start` for a
 * session that already has listeners returns the existing registration instead
 * of attaching a second set, which would append every event twice and double
 * the cursor-fold counters.
 */
const activeRegistrations = new Map<string, LiveCounterRegistration>();

export function registerLiveCounters(
  api: LiveCounterApi,
  writer: LiveCounterWriter,
  options: {
    sessionId: string;
    inventoryNames(): ReadonlySet<string>;
    now(): Date;
  },
): LiveCounterRegistration {
  const existing = activeRegistrations.get(options.sessionId);
  if (existing !== undefined) return existing;

  const append = (envelope: unknown): void => {
    try {
      writer.appendTelemetry(envelope);
    } catch {
      // Producer failures are observer-only.
    }
  };
  const decision = (data: unknown): void => {
    try {
      const row = asRecord(data);
      const result = row?.result;
      if (result !== "allow" && result !== "deny") return;
      append({
        schemaVersion: 1,
        source: "permission-system",
        metric: "permission.decision",
        kind: "counter",
        value: 1,
        dimensions: { result, resolution: readResolution(row?.resolution) },
        timestamp: options.now().getTime(),
      });
    } catch {}
  };
  const prompt = (data: unknown): void => {
    try {
      const source = asRecord(data)?.source;
      if (
        source !== "tool_call" &&
        source !== "skill_input" &&
        source !== "skill_read"
      )
        return;
      append({
        schemaVersion: 1,
        source: "permission-system",
        metric: "permission.prompt",
        kind: "counter",
        value: 1,
        dimensions: { promptSource: source },
        timestamp: options.now().getTime(),
      });
    } catch {}
  };
  const ready = (): void => {
    try {
      append({
        schemaVersion: 1,
        source: "permission-system",
        metric: "permission.ready",
        kind: "counter",
        value: 1,
        timestamp: options.now().getTime(),
      });
    } catch {}
  };
  // Bus `on` returns an unsubscribe function; retain it so the registration can
  // be disposed. Pi's `on` may return a disposer too, which is retained when
  // present (its public type is `void`).
  const disposers: Array<() => void> = [];
  const subscribe = (register: () => unknown): void => {
    try {
      const dispose = register();
      if (typeof dispose === "function") disposers.push(dispose as () => void);
    } catch {
      // Subscription failures are observer-only.
    }
  };
  subscribe(() => api.events.on("permissions:ready", ready));
  subscribe(() => api.events.on("permissions:ui_prompt", prompt));
  subscribe(() => api.events.on("permissions:decision", decision));
  subscribe(() =>
    api.on("input", (event) => {
      try {
        const name = readSkillCommandName(
          typeof event?.text === "string" ? event.text : "",
        );
        if (name === undefined || !options.inventoryNames().has(name)) return;
        append({
          schemaVersion: 1,
          source: "pi-input",
          metric: "skill.invocation",
          kind: "counter",
          value: 1,
          dimensions: { skill: name },
          timestamp: options.now().getTime(),
        });
      } catch {
        // Input observation must never affect Pi execution.
      }
    }),
  );

  const registration: LiveCounterRegistration = {
    dispose() {
      for (const dispose of disposers.splice(0)) {
        try {
          dispose();
        } catch {
          // Disposal failures are observer-only.
        }
      }
      if (activeRegistrations.get(options.sessionId) === registration) {
        activeRegistrations.delete(options.sessionId);
      }
    },
  };
  activeRegistrations.set(options.sessionId, registration);
  return registration;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

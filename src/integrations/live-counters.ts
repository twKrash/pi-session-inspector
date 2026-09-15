import { SKILL_NAME_PATTERN } from "../core/live-counter-fold.ts";
import { integrations } from "./index.ts";
import type {
  Integration,
  LiveIntegrationContext,
} from "./contract.ts";

const SKILL_PREFIX = "/skill:";

/**
 * Extracts only a bounded skill identity; the remainder is never retained.
 * Skill invocation counting is generic skill infrastructure: a discovered
 * `/skill:<name>` invocation is not an integration adapter, because every
 * discovered skill would otherwise need a registry entry.
 */
function readSkillCommandName(text: string): string | undefined {
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
  ): (() => void) | undefined;
};

/**
 * The live subsystem's iteration: invoke each declared integration's `live`
 * hook, retain a disposer for every registration, and isolate failures so one
 * integration cannot stop another (or the generic producers) from registering.
 */
export function registerIntegrationLive(
  context: LiveIntegrationContext,
  list: readonly Integration[] = integrations,
): readonly (() => void)[] {
  const disposers: Array<() => void> = [];
  for (const integration of list) {
    if (integration.legacyOnly === true) continue;
    const hook = integration.hooks?.live;
    if (hook === undefined) continue;
    try {
      const registration = hook(context);
      if (registration !== undefined) {
        disposers.push(() => registration.dispose());
      }
    } catch {
      // Registration failures are observer-only.
    }
  }
  return disposers;
}

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
    /** Records an integration observed live in this process (presence only). */
    markPresence?(integration: string): void;
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

  const disposers: Array<() => void> = [];
  const subscribe = (register: () => unknown): void => {
    try {
      const dispose = register();
      if (typeof dispose === "function") disposers.push(dispose as () => void);
    } catch {
      // Subscription failures are observer-only.
    }
  };

  // Generic skill invocation producer: bounded name, allowlisted by inventory.
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

  // Integration-owned live subscriptions (the permission bus today): one
  // iterated list, one disposer per registration, and no registry object.
  for (const dispose of registerIntegrationLive({
    api,
    appendTelemetry: append,
    sessionId: options.sessionId,
    now: options.now,
    inventoryNames: options.inventoryNames,
    markPresence: (key) => options.markPresence?.(key),
  })) {
    disposers.push(dispose);
  }

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

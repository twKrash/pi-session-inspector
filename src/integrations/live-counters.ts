import { SKILL_NAME_PATTERN } from "../core/live-counter-fold.ts";
import { debugLog } from "../debug/log.ts";
import { integrations } from "./index.ts";
import type { Integration, LiveIntegrationContext } from "./contract.ts";

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
        debugLog("integration", "live-registered", {
          integration: integration.key,
        });
        disposers.push(() => {
          debugLog("integration", "live-disposed", {
            integration: integration.key,
          });
          registration.dispose();
        });
      }
    } catch {
      debugLog("integration", "live-registration-failed", {
        integration: integration.key,
        reason: "registration-failed",
      });
    }
  }
  return disposers;
}

export type LiveCounterRegistration = {
  /** Removes every retained listener; safe to call repeatedly. */
  dispose(): void;
};

type ActiveRegistration = {
  /** The runtime that owns this registration; it can never serve another. */
  runtimeId: string;
  registration: LiveCounterRegistration;
};

/**
 * Exactly one live registration per session identity (root plus session) per
 * runtime. Two rules together keep a replaced runtime from poisoning the next
 * one: a repeated `session_start` inside the same runtime returns the existing
 * registration instead of attaching a second listener set (which would append
 * every event twice and double the cursor-fold counters), and a registration
 * owned by a different runtime is disposed rather than returned, because Pi
 * removed that runtime's listeners when it replaced the runtime.
 */
const activeRegistrations = new Map<string, ActiveRegistration>();

function registrationKey(root: string, sessionId: string): string {
  return `${root}\u0000${sessionId}`;
}

/**
 * The identity a live registration and its runtime ownership share: the
 * Inspector root plus the session id, so the same session id under two roots
 * never collides. Exported so a runtime-scoped owner keys its own state
 * identically instead of re-deriving the format.
 */
export function liveCounterIdentity(root: string, sessionId: string): string {
  return registrationKey(root, sessionId);
}

export function registerLiveCounters(
  api: LiveCounterApi,
  writer: LiveCounterWriter,
  options: {
    /** Inspector root; part of the identity so two roots never collide. */
    root: string;
    sessionId: string;
    /** Identity of the session runtime that owns the registration. */
    runtimeId: string;
    inventoryNames(): ReadonlySet<string>;
    now(): Date;
    /** Records an integration observed live in this process (presence only). */
    markPresence?(integration: string): void;
  },
): LiveCounterRegistration {
  const key = registrationKey(options.root, options.sessionId);
  const existing = activeRegistrations.get(key);
  if (existing !== undefined) {
    if (existing.runtimeId === options.runtimeId) return existing.registration;
    // A registration owned by a replaced runtime holds listeners Pi already
    // removed, so it is disposed instead of reused and this runtime registers
    // its own set.
    activeRegistrations.delete(key);
    try {
      existing.registration.dispose();
    } catch {
      // Disposal failures are observer-only.
    }
  }

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
      if (activeRegistrations.get(key)?.registration === registration) {
        activeRegistrations.delete(key);
      }
    },
  };
  activeRegistrations.set(key, { runtimeId: options.runtimeId, registration });
  return registration;
}

import type {
  AgentRun,
  AgentToolActivity,
  EvidenceState,
  IntegrationPresence,
  SessionEntry,
  SubagentEvidenceDiagnostic,
} from "../core/events.ts";

/**
 * Closed vocabulary explaining why an integration row carries the state it
 * does. Every value is canonical Inspector vocabulary: a producer value never
 * becomes a reason, so a reason is always safe to log and render.
 */
export type IntegrationEvidenceReason =
  | "evidence-supported"
  | "presence-only"
  | "not-present"
  | "no-persisted-evidence"
  | "no-live-evidence"
  | "unsupported-schema"
  | "malformed-evidence"
  | "registration-failed"
  | "presence-failed"
  | "evidence-failed"
  | "fold-failed"
  | "contribution-failed";

/** Why a presence row carries the value it does (debug/diagnostic only). */
export type IntegrationPresenceReason =
  | "inventory-signal"
  | "live-signal"
  | "not-observed"
  | "presence-failed";

/** One versioned counter contract declared by an adapter. */
export type IntegrationSchema = {
  counters: readonly string[];
};

export type IntegrationSchemas = Readonly<Record<number, IntegrationSchema>>;

export type PresenceContext = {
  /**
   * Names of `source === "extension"` commands only. Skill/prompt rows may
   * share a name with an extension (for example a `skill:ponytail`), so the
   * caller must filter by source before signalling presence.
   */
  extensionCommands: readonly string[];
  tools: readonly string[];
  /**
   * Integration keys observed live in this process or durably folded from an
   * earlier one. This is generic infrastructure state keyed by registry key:
   * the caller records sightings, and no adapter has to name another
   * integration's presence signal.
   */
  observed: readonly string[];
  inventoryAvailable: boolean;
};

export type PersistedEvidenceContext = {
  entries: readonly SessionEntry[];
};

/**
 * One adapter's persisted result. `integration` echoes the adapter key so the
 * registry can reject a result that returns evidence for another integration,
 * and `reason` is always a closed-enum value.
 */
export type IntegrationEvidence = {
  integration: string;
  state: EvidenceState;
  version?: number;
  counters?: Readonly<Record<string, number | boolean>>;
  reason: IntegrationEvidenceReason;
};

export type LiveIntegrationContext = {
  api: unknown;
  /** Appends one bounded telemetry envelope; failures are the caller's to swallow. */
  appendTelemetry(envelope: unknown): void;
  sessionId: string;
  now(): Date;
  /** Bounded skill names the generic live counter producers may count. */
  inventoryNames(): ReadonlySet<string>;
  /** Records that the given integration was observed live in this process. */
  markPresence(integration: string): void;
};

export type IntegrationRegistration = {
  /** Removes every retained listener; safe to call repeatedly. */
  dispose(): void;
};

/**
 * Telemetry envelope translation contributed by one integration adapter. The
 * adapter never names itself: the registry stamps the key it applied, so an
 * applied fold always carries its own identity.
 */
export type IntegrationTelemetryFold = {
  counters?: Readonly<Record<string, number>>;
  /** Durable presence-only sighting; never a counter. */
  presence?: true;
};

/** One applied fold: the registry key that produced it plus its contribution. */
export type AppliedTelemetryFold = IntegrationTelemetryFold & {
  integration: string;
};

export type CanonicalIntegrationContext = {
  entries: readonly SessionEntry[];
  sessionId: string;
};

/**
 * Rich canonical contribution of an adapter that carries more than counters.
 * Every field is a canonical core DTO shape (`src/core/events.ts`), so an
 * adapter contributes evidence without the generic contract depending on any
 * adapter implementation. Subagent runs and native subagent activity are the
 * only current producers; they are deliberately not flattened into counters.
 */
export type CanonicalIntegrationContribution = {
  state: EvidenceState;
  runs?: readonly AgentRun[];
  activity?: AgentToolActivity;
  diagnostics?: readonly SubagentEvidenceDiagnostic[];
  reason?: IntegrationEvidenceReason;
};

/**
 * One integration's knowledge, owned in exactly one place. Only `key`, `order`,
 * and `schemas` are mandatory: an adapter implements the capabilities its
 * integration actually has instead of stubbing the ones it does not.
 */
export interface IntegrationAdapter {
  /** Bounded token; the integration's identity and evidence-stream key. */
  readonly key: string;
  /** Report order; unique across the registry. */
  readonly order: number;
  /** Versioned counter contracts; at least one version. */
  readonly schemas: IntegrationSchemas;
  /** Additional accepted evidence key spellings (for example `ctx`). */
  readonly aliases?: readonly string[];
  /** The key validates evidence but never gets a row or presence entry. */
  readonly legacyOnly?: boolean;

  detectPresence?(context: PresenceContext): IntegrationPresence;

  readPersistedEvidence?(
    context: PersistedEvidenceContext,
  ): IntegrationEvidence | undefined;

  registerLive?(
    context: LiveIntegrationContext,
  ): IntegrationRegistration | undefined;

  /** Translates one telemetry envelope into this integration's counters. */
  foldTelemetry?(envelope: unknown): IntegrationTelemetryFold | undefined;

  contributeCanonical?(
    context: CanonicalIntegrationContext,
  ):
    | CanonicalIntegrationContribution
    | undefined
    | Promise<CanonicalIntegrationContribution | undefined>;
}

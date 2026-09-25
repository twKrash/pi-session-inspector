import type {
  AgentRunSourceObservation,
  AgentToolActivity,
  EvidenceState,
  IntegrationPresence,
  SessionEntry,
  SubagentEvidenceDiagnostic,
} from "../core/events.ts";

/**
 * The integration descriptor contract.
 *
 * An integration describes itself: identity, evidence vocabulary, and the
 * optional typed behavior hooks it actually has. Which integrations Inspector
 * supports is declared once, explicitly, in `src/integrations/index.ts`; the
 * catalog there validates and indexes them, and each subsystem iterates that
 * list and invokes the hook it owns.
 *
 * There is deliberately no runtime "registry" object: registration is data,
 * orchestration belongs to the subsystem performing the operation.
 */

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

/** One versioned counter contract declared by an integration. */
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
   * earlier one. This is generic infrastructure state keyed by integration:
   * the caller records sightings, and no integration has to name another
   * integration's presence signal.
   */
  observed: readonly string[];
  inventoryAvailable: boolean;
};

export type PersistedEvidenceContext = {
  entries: readonly SessionEntry[];
  /**
   * The Inspector session identity. It is Inspector's own opaque id (never
   * producer text) and it is what an integration needs to hash a producer id
   * into a canonical subject before matching evidence.
   */
  sessionId: string;
};

/**
 * One integration's persisted result. `integration` echoes the integration key
 * so the persisted-evidence subsystem can reject a result that returns evidence
 * for another integration, and `reason` is always a closed-enum value.
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
 * Telemetry envelope translation contributed by one integration. The
 * integration never names itself: the telemetry subsystem stamps the key it
 * applied, so an applied fold always carries its own identity.
 */
export type IntegrationTelemetryFold = {
  counters?: Readonly<Record<string, number>>;
  /** Durable presence-only sighting; never a counter. */
  presence?: true;
};

/** One applied fold: the integration key that produced it plus its contribution. */
export type AppliedTelemetryFold = IntegrationTelemetryFold & {
  integration: string;
};

export type CanonicalIntegrationContext = {
  entries: readonly SessionEntry[];
  sessionId: string;
};

/**
 * Rich canonical contribution of an integration that carries more than
 * counters. Every field is a canonical core DTO shape (`src/core/events.ts`),
 * so an integration contributes evidence without the generic contract
 * depending on an integration implementation. Subagent runs and native subagent
 * activity are the only current producers; they are deliberately not flattened
 * into counters.
 */
export type CanonicalIntegrationContribution = {
  state: EvidenceState;
  observations?: Iterable<AgentRunSourceObservation>;
  activity?: AgentToolActivity;
  diagnostics?: readonly SubagentEvidenceDiagnostic[];
  reason?: IntegrationEvidenceReason;
};

/**
 * The optional typed behavior hooks. Each subsystem invokes the one hook it
 * owns; an integration implements only the hooks its protocol actually has, so
 * nothing has to stub the rest and no generic callback has to switch on a
 * capability name.
 */
export type IntegrationHooks = {
  presence?(context: PresenceContext): IntegrationPresence;

  persisted?(
    context: PersistedEvidenceContext,
  ): IntegrationEvidence | undefined;

  live?(context: LiveIntegrationContext): IntegrationRegistration | undefined;

  /** Translates one telemetry envelope into this integration's contributions. */
  telemetry?(envelope: unknown): IntegrationTelemetryFold | undefined;

  canonical?(
    context: CanonicalIntegrationContext,
  ):
    | CanonicalIntegrationContribution
    | undefined
    | Promise<CanonicalIntegrationContribution | undefined>;
};

/**
 * One integration's whole knowledge. `key` and `schemas` are mandatory;
 * `legacyOnly` marks a key that exists only to validate historical evidence
 * (it never gets a report row, presence entry, or behavior hook).
 *
 * Report order is the declaration order in `src/integrations/index.ts`; there
 * is no numeric order metadata to keep in sync with the array.
 */
export type Integration = {
  /** Bounded token; the integration's identity and evidence-stream key. */
  key: string;
  /** Additional accepted evidence key spellings (for example `ctx`). */
  aliases?: readonly string[];
  /** Versioned counter contracts; at least one version. */
  schemas: IntegrationSchemas;
  /** The key validates evidence but never gets a row or presence entry. */
  legacyOnly?: boolean;
  hooks?: IntegrationHooks;
};

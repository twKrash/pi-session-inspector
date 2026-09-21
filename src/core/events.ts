export type Scope = "active" | "tree";

export type EvidenceState = "supported" | "unavailable" | "unsupported";

export type Confidence =
  | "native"
  | "live"
  | "cooperative"
  | "inferred"
  | "unavailable"
  | "unsupported";

export type IntegrationPresence = "present" | "absent" | "unknown";

/**
 * Integration row identity. The trusted key set is the declared integration
 * catalog (`src/integrations/index.ts`), not a union duplicated here: producer
 * values are untrusted, so every boundary re-validates a key against that
 * declaration instead of trusting a type annotation.
 */
export type IntegrationRowKey = string;

/** Adapter/report-input row; presence is resolved during report projection. */
export type IntegrationObservationInput = {
  integration: IntegrationRowKey;
  presence?: IntegrationPresence;
  state: EvidenceState;
  version?: number;
  counters?: Readonly<Record<string, number | boolean>>;
};

/** Emitted report row: presence is always explicit. */
export type IntegrationObservation = IntegrationObservationInput & {
  presence: IntegrationPresence;
};

/**
 * Bounded failure classification for one cooperative run. `reason` is a closed
 * enum and `detail` is a bounded exit code or signal token; free text is never
 * carried.
 */
export type AgentFailure = {
  reason:
    | "exit-nonzero"
    | "process-signal"
    | "completion-failed"
    | "output-absent";
  detail?: number | string;
};

export type AgentRun = {
  id: string;
  parentId?: string;
  /** Bounded agent label token; absent when the producer value is unusable. */
  agent?: string;
  status: "running" | "succeeded" | "failed" | "interrupted" | "unknown";
  confidence: Confidence;
  /**
   * Presence of the run's published archive, validated against the opaque run
   * identity. Absent when the run published no reference; never a path.
   */
  artifacts?: "available" | "missing";
  /**
   * Publication time of the persisted result that observed this run. This is
   * observation time only: it is never a run start, end, or duration claim.
   */
  observedAt?: string;
  /**
   * Canonical `tool:<toolCallId>` of the persisted result that published the
   * row. One result may publish many runs; the relation is one-to-many.
   */
  evidenceToolId?: string;
  /** Bounded model label; absent when the producer value is unusable. */
  model?: string;
  /** Bounded thinking/reasoning-effort label. */
  thinking?: string;
  failure?: AgentFailure;
  usage?: Usage;
};

/** Native subagent tool activity; usage is a breakdown, never a session total. */
export type AgentToolActivity = {
  state: EvidenceState;
  calls: number;
  succeeded: number;
  failed: number;
  interrupted: number;
  tools: readonly { name: string; calls: number }[];
  usage?: Usage;
};

/** Only a closed conflict code is emitted; a count carries the occurrence. */
export type SubagentEvidenceDiagnostic = {
  code: "cooperative-evidence-conflict";
  count: number;
};

/**
 * Rich cooperative subagent evidence: native tool activity plus the validated
 * runs read from persisted tool results. It is a canonical DTO (see ADR 0007),
 * not an adapter-private shape, so the composition root and the report seams can
 * name it without importing an adapter implementation.
 */
export type SubagentEvidence = {
  activity: AgentToolActivity;
  runs: readonly AgentRun[];
  state: EvidenceState;
  /**
   * Bounded, closed-code diagnostics. Repeated observations of one run that
   * disagree on identity or regress a terminal status are counted here.
   */
  diagnostics: readonly SubagentEvidenceDiagnostic[];
};

export type UsageCoverageState = "complete" | "partial" | "unavailable";

export type UsageField =
  | "inputTokens"
  | "outputTokens"
  | "cacheReadTokens"
  | "cacheWriteTokens"
  | "reasoningTokens"
  | "inputCost"
  | "outputCost"
  | "cacheReadCost"
  | "cacheWriteCost";

export type UsageFieldCoverage = {
  state: UsageCoverageState;
  owners: number;
  ownersWithValue: number;
};

export type UsageFieldCoverageMap = Record<UsageField, UsageFieldCoverage>;

export type Usage = {
  totalTokens: number;
  cost: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  inputCost?: number;
  outputCost?: number;
  cacheReadCost?: number;
  cacheWriteCost?: number;
};

const USAGE_FIELDS: readonly UsageField[] = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "reasoningTokens",
  "inputCost",
  "outputCost",
  "cacheReadCost",
  "cacheWriteCost",
];

export function usageFieldCoverage(
  owners: readonly (Usage | undefined)[],
): UsageFieldCoverageMap {
  return Object.fromEntries(
    USAGE_FIELDS.map((field) => {
      const ownersWithValue = owners.filter(
        (usage) => usage?.[field] !== undefined,
      ).length;
      const state: UsageCoverageState =
        ownersWithValue === 0
          ? "unavailable"
          : ownersWithValue === owners.length
            ? "complete"
            : "partial";
      return [field, { state, owners: owners.length, ownersWithValue }];
    }),
  ) as UsageFieldCoverageMap;
}

/** Bounded token/cost subtotals whose parts sum to the session total. */
export type UsageComposition = {
  generations: Usage;
  toolResults: Usage;
  compactions: Usage;
  branchSummaries: Usage;
};

export type SessionEntry = {
  id: string;
  parentId: string | null;
  timestamp: string;
  type: string;
  message?: Record<string, unknown>;
  provider?: string;
  modelId?: string;
  usage?: unknown;
  [key: string]: unknown;
};

export type Generation = {
  id: string;
  timestamp: string;
  provider: string;
  model: string;
  usage: Usage;
};

export type Tool = {
  id: string;
  timestamp: string;
  name: string;
  status: "succeeded" | "failed" | "interrupted";
  /** Absent until a matching tool result supplies usage evidence. */
  usage?: Usage;
  /** Present only when live timing correlates to this native tool-call ID. */
  durationMs?: number;
};

export type Compaction = {
  id: string;
  timestamp: string;
  kind: "compaction" | "branch_summary";
  usage: Usage;
};

/** Bounded error classification; never a raw stop reason or payload. */
export type ErrorKind =
  | "generation-error"
  | "generation-aborted"
  | "generation-length"
  | "tool-error"
  | "unknown";

export type ErrorRecord = {
  id: string;
  timestamp: string;
  kind: ErrorKind;
  confidence: Confidence;
  /**
   * Bounded, single-line, path/URL/secret-redacted persisted assistant
   * `errorMessage` or text from an errored tool result. Absent for older data
   * or when nothing safe remains.
   */
  message?: string;
};

export type ReducedSession = {
  sessionId: string;
  usage: Usage;
  usageComposition: UsageComposition;
  usageFieldCoverage?: UsageFieldCoverageMap;
  generations: Generation[];
  tools: Tool[];
  compactions: Compaction[];
  errors: ErrorRecord[];
};

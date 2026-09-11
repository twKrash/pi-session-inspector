export type Scope = "active" | "tree";

export type EvidenceState = "supported" | "unavailable" | "unsupported";

export type Confidence =
  | "native"
  | "live"
  | "cooperative"
  | "inferred"
  | "unavailable"
  | "unsupported";

export type IntegrationKey =
  | "context"
  | "rtk"
  | "ponytail"
  | "caveman"
  | "permission"
  | "subagents"
  | "lens";

export type IntegrationPresence = "present" | "absent" | "unknown";

/** Integration keys accepted by the report projection, including legacy `mode`. */
export type IntegrationRowKey = IntegrationKey | "mode";

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
  usage?: Usage;
};

export type Usage = {
  totalTokens: number;
  cost: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

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

/** Bounded error classification; never a raw stop reason, message, or payload. */
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
};

export type ReducedSession = {
  sessionId: string;
  usage: Usage;
  usageComposition: UsageComposition;
  generations: Generation[];
  tools: Tool[];
  compactions: Compaction[];
  errors: ErrorRecord[];
};

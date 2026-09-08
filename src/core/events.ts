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
  | "mode"
  | "permission"
  | "subagents"
  | "lens";

export type IntegrationObservation = {
  integration: IntegrationKey;
  version: number;
  state: EvidenceState;
  counters?: Readonly<Record<string, number | boolean>>;
};

export type AgentRun = {
  id: string;
  parentId?: string;
  status: "running" | "succeeded" | "failed" | "interrupted" | "unknown";
  confidence: Confidence;
  usage?: Usage;
};

export type Usage = {
  totalTokens: number;
  cost: number;
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
  usage: Usage;
};

export type Compaction = {
  id: string;
  timestamp: string;
  usage: Usage;
};

export type ReducedSession = {
  sessionId: string;
  usage: Usage;
  generations: Generation[];
  tools: Tool[];
  compactions: Compaction[];
};

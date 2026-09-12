import { boundedDescription, secretLikeValue } from "./redact.ts";

const LABEL_MAX_BYTES = 96;
const TOKEN = /^[A-Za-z0-9_][A-Za-z0-9._:-]*$/;
// Bounded ISO-8601 instant; L0 evidence times are normative instants, never
// free-form text. Shared by every derivation that turns a producer timestamp
// into an L0 fact time.
const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_TIMESTAMP_LENGTH = 35;
const encoder = new TextEncoder();

export type EvidenceAuthority =
  | "native"
  | "live"
  | "cooperative"
  | "observed"
  | "derived";

export type EvidenceSource =
  | "pi-jsonl"
  | "inspector-wal"
  | "checkpoint"
  | "inventory"
  | "subagent-result"
  | "subagent-archive"
  | "integration-telemetry"
  | "current-environment";

export type TimeEvidence =
  | {
      state: "known";
      at: string;
      basis:
        | "pi-session-header"
        | "pi-entry"
        | "pi-publication-entry"
        | "wal-observer"
        | "inventory-observer"
        | "current-observer"
        | "checkpoint-observer";
    }
  | { state: "unavailable" };

export type FactProvenance = {
  source: EvidenceSource;
  authority: EvidenceAuthority;
  recordId?: string;
  schemaVersion?: number;
};

export type L0FactBase = {
  factId: string;
  sessionId: string;
  provenance: FactProvenance;
  time: TimeEvidence;
};

export type SkillInvocationObservation = L0FactBase & {
  kind: "skill-invocation";
  skill: string;
  wal: { eventId: string; writerId: string; writerSequence: number };
  provenance: FactProvenance & {
    source: "integration-telemetry";
    authority: "live";
    schemaVersion: 1;
  };
  time: { state: "known"; at: string; basis: "wal-observer" };
};

export type FoldedAggregateEvidence =
  | {
      kind: "checkpoint-wal-aggregates";
      sessionId: string;
      foldedThrough: Record<string, number>;
      sealedThrough: Record<string, number>;
      integrationCounters?: Record<string, Record<string, number>>;
      skillInvocations?: Record<string, number>;
      skillOverflowInvocations?: number;
      presence?: { permission?: true };
      /** UTC instant before which pruned live detail no longer exists. */
      detailExpiredBefore?: string;
      checkpointedAt: TimeEvidence;
      provenance: {
        source: "checkpoint";
        authority: "derived";
        schemaVersion: 1;
      };
    }
  | {
      kind: "checkpoint-resource-aggregates";
      sessionId: string;
      resourceCounts: {
        commands?: number;
        skills?: number;
        resources?: number;
        toolSources?: number;
      };
      observedAt: TimeEvidence;
      checkpointedAt: TimeEvidence;
      provenance: {
        source: "checkpoint";
        authority: "derived";
        schemaVersion: 1;
      };
    };

export type LiveTimingObservation = L0FactBase & {
  kind: "live-timing";
  category: "agent" | "turn" | "tool" | "provider" | "model";
  status: "running" | "complete" | "unsupported";
  /** Safe Inspector subject id; `live-tool-<64hex>` for tool boundaries. */
  subjectId?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  provenance: FactProvenance & {
    source: "inspector-wal";
    authority: "live";
    schemaVersion: 1;
  };
};

/**
 * Atomic facts carry exactly one source observation; graphs are built in L1.
 *
 * This union is deliberately narrow in this milestone: it carries only the
 * families whose producer sits outside the Pi adapter (Inspector WAL telemetry
 * and live timing). Native families (entry nodes, generations, tools, results,
 * transitions, compactions, agent runs) stay on the Pi-adapter path and join
 * this union only when a later task needs them.
 */
export type AtomicEvidence = SkillInvocationObservation | LiveTimingObservation;

export type L0Evidence = {
  atomic: AtomicEvidence[];
  folded: FoldedAggregateEvidence[];
};

export function isBoundedToken(
  value: unknown,
  maxBytes: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    encoder.encode(value).byteLength <= maxBytes &&
    TOKEN.test(value)
  );
}

/**
 * A bounded, parseable ISO-8601 instant. Producer timestamps reach a WAL
 * record through `Date.parse` + a length bound (which also accepts non-ISO
 * forms), so a derivation must re-validate with this grammar before publishing
 * the value as an L0 fact time.
 */
export function isBoundedIsoInstant(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_TIMESTAMP_LENGTH &&
    ISO_INSTANT.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

export function boundedProducerLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (encoder.encode(value).byteLength > LABEL_MAX_BYTES) return undefined;
  if (secretLikeValue(value)) return undefined;
  return boundedDescription(value, LABEL_MAX_BYTES);
}

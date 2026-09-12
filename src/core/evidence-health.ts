import type { EvidenceAuthority, EvidenceSource } from "./evidence.ts";

/**
 * Bounded, deterministic evidence health (design §12). Health is
 * machine-readable and free of producer text: it carries closed enums,
 * saturating counts, and `source`/`code` diagnostics. Nothing here reads a
 * prompt, response, tool payload, path, raw producer id, or error string.
 */

export type EvidenceHealthState =
  | "supported"
  | "partial"
  | "unavailable"
  | "unsupported"
  | "expired";

export type EvidenceDiagnosticCode =
  | "source-not-found"
  | "source-format-unsupported"
  | "source-malformed"
  | "unknown-entry"
  | "duplicate-entry-id"
  | "missing-entry-parent"
  | "tracking-marker-missing"
  | "tracking-marker-duplicate"
  | "active-leaf-unavailable"
  | "tool-call-id-duplicate"
  | "tool-result-orphan"
  | "tool-result-duplicate"
  | "usage-invalid"
  | "usage-overflow"
  | "usage-reconciliation-mismatch"
  | "wal-record-legacy"
  | "wal-record-invalid"
  | "wal-sequence-gap"
  | "wal-detail-expired"
  | "live-correlation-missing"
  | "inventory-observation-time-missing"
  | "aggregate-supplement-applied"
  | "aggregate-only-fallback"
  | "checkpoint-aggregate-invalid"
  | "parent-session-unavailable"
  | "integration-contract-unsupported"
  | "cooperative-evidence-conflict"
  | "archive-unavailable"
  | "archive-invalid"
  | "clock-regression";

export type EvidenceDiagnosticSeverity = "info" | "warning" | "error";

export type SourceEvidenceHealth = {
  source: EvidenceSource;
  authority: EvidenceAuthority;
  state: EvidenceHealthState;
  schemaVersion?: number;
  recordsSeen: number;
  factsAccepted: number;
  recordsRejected: number;
  detail: "full" | "aggregate-only" | "not-observed" | "unsupported";
  observedAt?: string;
  expiredBefore?: string;
};

export type EvidenceDiagnostic = {
  code: EvidenceDiagnosticCode;
  severity: EvidenceDiagnosticSeverity;
  count: number;
  source: EvidenceSource;
};

export type SessionEvidenceHealth = {
  schemaVersion: 1;
  core: EvidenceHealthState;
  sources: SourceEvidenceHealth[];
  joins: {
    toolCalls: number;
    toolResults: number;
    matchedToolResults: number;
    matchedLiveToolTimings: number;
    agentRuns: number;
    knownAgentParents: number;
  };
  usage: {
    nativeLines: number;
    childLines: number;
    compositionReconciled: boolean;
    dated: EvidenceHealthState;
  };
  aggregates: {
    detail: "full" | "aggregate-only" | "expired";
    integrationCounters: number;
    skillInvocations: {
      names: number;
      overflow: number;
      retainedInvocations: number;
    };
    permissionPresence: EvidenceHealthState;
    resources: EvidenceHealthState;
  };
  diagnostics: EvidenceDiagnostic[];
  truncated?: boolean;
};

/**
 * Fixed source order (design §12). Reporters sort by this order so two builds
 * of identical evidence serialize identically.
 */
export const EVIDENCE_SOURCE_ORDER: readonly EvidenceSource[] = [
  "pi-jsonl",
  "inspector-wal",
  "checkpoint",
  "inventory",
  "subagent-result",
  "subagent-archive",
  "integration-telemetry",
  "current-environment",
];

/** Counts saturate at the project safe-integer bound and never wrap. */
export const MAX_EVIDENCE_COUNT = Number.MAX_SAFE_INTEGER;

/**
 * Source time fields are re-validated at the health boundary (P2.6): a caller
 * cannot republish a non-instant, oversized, or secret-like string through
 * `observedAt`/`expiredBefore`. The spec labels `expiredBefore` an
 * instant/date policy boundary, so a date-only form is also accepted.
 */
const ISO_INSTANT_OR_DATE =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2}))?$/;
const MAX_TIMESTAMP_LENGTH = 35;

function boundedSourceTime(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_TIMESTAMP_LENGTH &&
    ISO_INSTANT_OR_DATE.test(value) &&
    !Number.isNaN(Date.parse(value))
    ? value
    : undefined;
}

/** A diagnostic without a severity resolves to this closed, per-code default. */
const ERROR_CODES: ReadonlySet<EvidenceDiagnosticCode> = new Set([
  "source-not-found",
  "source-format-unsupported",
  "usage-overflow",
  "usage-reconciliation-mismatch",
  "checkpoint-aggregate-invalid",
  "archive-invalid",
]);

const INFO_CODES: ReadonlySet<EvidenceDiagnosticCode> = new Set([
  "unknown-entry",
  "wal-record-legacy",
  "wal-detail-expired",
  "aggregate-supplement-applied",
  "aggregate-only-fallback",
]);

export function defaultDiagnosticSeverity(
  code: EvidenceDiagnosticCode,
): EvidenceDiagnosticSeverity {
  if (ERROR_CODES.has(code)) return "error";
  if (INFO_CODES.has(code)) return "info";
  return "warning";
}

export type BuildEvidenceHealthInput = {
  core: EvidenceHealthState;
  sources: readonly SourceEvidenceHealth[];
  joins: SessionEvidenceHealth["joins"];
  usage: SessionEvidenceHealth["usage"];
  aggregates: SessionEvidenceHealth["aggregates"];
  diagnostics: readonly EvidenceDiagnostic[];
};

type Saturation = { value: boolean };

/**
 * Normalizes and freezes the health DTO: fixed source order, diagnostics
 * sorted by source then code, and every count saturated at the safe-integer
 * bound. Saturation sets `truncated`; nothing else does.
 */
export function buildEvidenceHealth(
  input: BuildEvidenceHealthInput,
): SessionEvidenceHealth {
  const saturation: Saturation = { value: false };
  const sources = normalizeSources(input.sources, saturation);
  const diagnostics = normalizeDiagnostics(input.diagnostics, saturation);
  const health: SessionEvidenceHealth = {
    schemaVersion: 1,
    core: input.core,
    sources,
    joins: {
      toolCalls: saturate(input.joins.toolCalls, saturation),
      toolResults: saturate(input.joins.toolResults, saturation),
      matchedToolResults: saturate(input.joins.matchedToolResults, saturation),
      matchedLiveToolTimings: saturate(
        input.joins.matchedLiveToolTimings,
        saturation,
      ),
      agentRuns: saturate(input.joins.agentRuns, saturation),
      knownAgentParents: saturate(input.joins.knownAgentParents, saturation),
    },
    usage: {
      nativeLines: saturate(input.usage.nativeLines, saturation),
      childLines: saturate(input.usage.childLines, saturation),
      compositionReconciled: input.usage.compositionReconciled === true,
      dated: input.usage.dated,
    },
    aggregates: {
      detail: input.aggregates.detail,
      integrationCounters: saturate(
        input.aggregates.integrationCounters,
        saturation,
      ),
      skillInvocations: {
        names: saturate(input.aggregates.skillInvocations.names, saturation),
        overflow: saturate(
          input.aggregates.skillInvocations.overflow,
          saturation,
        ),
        retainedInvocations: saturate(
          input.aggregates.skillInvocations.retainedInvocations,
          saturation,
        ),
      },
      permissionPresence: input.aggregates.permissionPresence,
      resources: input.aggregates.resources,
    },
    diagnostics,
  };
  return saturation.value ? { ...health, truncated: true } : health;
}

function normalizeSources(
  sources: readonly SourceEvidenceHealth[],
  saturation: Saturation,
): SourceEvidenceHealth[] {
  const bySource = new Map<EvidenceSource, SourceEvidenceHealth>();
  for (const source of sources) {
    const observedAt = boundedSourceTime(source.observedAt);
    const expiredBefore = boundedSourceTime(source.expiredBefore);
    // A later row for one source replaces an earlier one; the fixed enum order
    // below is the only ordering that leaves this function.
    bySource.set(source.source, {
      source: source.source,
      authority: source.authority,
      state: source.state,
      ...(source.schemaVersion === undefined
        ? {}
        : { schemaVersion: saturate(source.schemaVersion, saturation) }),
      recordsSeen: saturate(source.recordsSeen, saturation),
      factsAccepted: saturate(source.factsAccepted, saturation),
      recordsRejected: saturate(source.recordsRejected, saturation),
      detail: source.detail,
      ...(observedAt === undefined ? {} : { observedAt }),
      ...(expiredBefore === undefined ? {} : { expiredBefore }),
    });
  }
  return EVIDENCE_SOURCE_ORDER.flatMap((source) => {
    const row = bySource.get(source);
    return row === undefined ? [] : [row];
  });
}

function normalizeDiagnostics(
  diagnostics: readonly EvidenceDiagnostic[],
  saturation: Saturation,
): EvidenceDiagnostic[] {
  const merged = new Map<string, EvidenceDiagnostic>();
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.source}\u0000${diagnostic.code}`;
    const prior = merged.get(key);
    const severity =
      diagnostic.severity ?? defaultDiagnosticSeverity(diagnostic.code);
    const count = Math.max(1, saturate(diagnostic.count, saturation));
    if (prior === undefined) {
      merged.set(key, {
        code: diagnostic.code,
        severity,
        count,
        source: diagnostic.source,
      });
      continue;
    }
    merged.set(key, {
      ...prior,
      severity: higherSeverity(prior.severity, severity),
      count: saturate(prior.count + count, saturation),
    });
  }
  return [...merged.values()].sort(
    (left, right) =>
      sourceRank(left.source) - sourceRank(right.source) ||
      left.code.localeCompare(right.code),
  );
}

const SEVERITY_RANK: Readonly<Record<EvidenceDiagnosticSeverity, number>> = {
  info: 0,
  warning: 1,
  error: 2,
};

function higherSeverity(
  left: EvidenceDiagnosticSeverity,
  right: EvidenceDiagnosticSeverity,
): EvidenceDiagnosticSeverity {
  return SEVERITY_RANK[right] > SEVERITY_RANK[left] ? right : left;
}

function sourceRank(source: EvidenceSource): number {
  const rank = EVIDENCE_SOURCE_ORDER.indexOf(source);
  return rank === -1 ? EVIDENCE_SOURCE_ORDER.length : rank;
}

/**
 * Saturation is the only reason a count changes value. A non-finite or
 * negative programming error normalizes to zero without claiming truncation.
 */
function saturate(value: number, saturation: Saturation): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  const floored = Math.floor(value);
  if (floored > MAX_EVIDENCE_COUNT) {
    saturation.value = true;
    return MAX_EVIDENCE_COUNT;
  }
  return floored;
}

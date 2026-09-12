import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildEvidenceHealth,
  defaultDiagnosticSeverity,
  MAX_EVIDENCE_COUNT,
  type BuildEvidenceHealthInput,
  type EvidenceDiagnostic,
  type SourceEvidenceHealth,
} from "../../src/core/evidence-health.ts";

function source(
  overrides: Partial<SourceEvidenceHealth> & {
    source: SourceEvidenceHealth["source"];
  },
): SourceEvidenceHealth {
  return {
    authority: "native",
    state: "supported",
    recordsSeen: 1,
    factsAccepted: 1,
    recordsRejected: 0,
    detail: "full",
    ...overrides,
  };
}

function input(
  overrides: Partial<BuildEvidenceHealthInput> = {},
): BuildEvidenceHealthInput {
  return {
    core: "supported",
    sources: [source({ source: "pi-jsonl", schemaVersion: 3 })],
    joins: {
      toolCalls: 0,
      toolResults: 0,
      matchedToolResults: 0,
      matchedLiveToolTimings: 0,
      agentRuns: 0,
      knownAgentParents: 0,
    },
    usage: {
      nativeLines: 0,
      childLines: 0,
      compositionReconciled: true,
      dated: "supported",
    },
    aggregates: {
      detail: "full",
      integrationCounters: 0,
      skillInvocations: { names: 0, overflow: 0, retainedInvocations: 0 },
      permissionPresence: "unavailable",
      resources: "unavailable",
    },
    diagnostics: [],
    ...overrides,
  };
}

test("counts saturate at the safe-integer bound and set truncated", () => {
  const health = buildEvidenceHealth(
    input({
      sources: [
        source({
          source: "pi-jsonl",
          schemaVersion: 3,
          recordsSeen: Number.MAX_SAFE_INTEGER + 1000,
          factsAccepted: 2,
        }),
      ],
    }),
  );
  assert.equal(health.sources[0]?.recordsSeen, MAX_EVIDENCE_COUNT);
  assert.equal(health.truncated, true);
});

test("an in-range build never sets truncated", () => {
  const health = buildEvidenceHealth(input());
  assert.equal(health.truncated, undefined);
  assert.equal("truncated" in health, false);
});

test("sources follow the fixed enum order regardless of input order", () => {
  const health = buildEvidenceHealth(
    input({
      sources: [
        source({ source: "checkpoint", authority: "derived" }),
        source({ source: "pi-jsonl", schemaVersion: 3 }),
        source({ source: "inspector-wal", authority: "live" }),
      ],
    }),
  );
  assert.deepEqual(
    health.sources.map((entry) => entry.source),
    ["pi-jsonl", "inspector-wal", "checkpoint"],
  );
});

test("diagnostics sort by source then code and merge duplicates", () => {
  const diagnostics: EvidenceDiagnostic[] = [
    {
      code: "usage-invalid",
      severity: "warning",
      count: 1,
      source: "inspector-wal",
    },
    { code: "unknown-entry", severity: "info", count: 2, source: "pi-jsonl" },
    {
      code: "missing-entry-parent",
      severity: "warning",
      count: 1,
      source: "pi-jsonl",
    },
    { code: "unknown-entry", severity: "info", count: 3, source: "pi-jsonl" },
  ];
  const health = buildEvidenceHealth(input({ diagnostics }));
  assert.deepEqual(
    health.diagnostics.map((entry) => `${entry.source}:${entry.code}`),
    [
      "pi-jsonl:missing-entry-parent",
      "pi-jsonl:unknown-entry",
      "inspector-wal:usage-invalid",
    ],
  );
  const unknown = health.diagnostics.find(
    (entry) => entry.code === "unknown-entry",
  );
  assert.equal(unknown?.count, 5);
});

test("unavailable/unsupported/expired states are preserved, never zeroed", () => {
  const health = buildEvidenceHealth(
    input({
      core: "unavailable",
      sources: [
        source({
          source: "pi-jsonl",
          state: "unsupported",
          recordsRejected: 4,
          detail: "unsupported",
        }),
        source({
          source: "inspector-wal",
          authority: "live",
          state: "expired",
          detail: "aggregate-only",
          expiredBefore: "2026-09-01",
        }),
      ],
      aggregates: {
        detail: "expired",
        integrationCounters: 0,
        skillInvocations: { names: 0, overflow: 0, retainedInvocations: 1 },
        permissionPresence: "expired",
        resources: "expired",
      },
    }),
  );
  assert.equal(health.sources[0]?.state, "unsupported");
  assert.equal(health.sources[0]?.recordsRejected, 4);
  assert.equal(health.sources[1]?.state, "expired");
  assert.equal(health.sources[1]?.expiredBefore, "2026-09-01");
  assert.equal(health.aggregates.permissionPresence, "expired");
  assert.equal(health.aggregates.skillInvocations.retainedInvocations, 1);
});

test("the schema and every bounded field are present", () => {
  const health = buildEvidenceHealth(input());
  assert.equal(health.schemaVersion, 1);
  assert.equal(health.usage.compositionReconciled, true);
  assert.equal(health.joins.toolCalls, 0);
  assert.equal(defaultDiagnosticSeverity("source-not-found"), "error");
  assert.equal(defaultDiagnosticSeverity("unknown-entry"), "info");
  assert.equal(defaultDiagnosticSeverity("tracking-marker-missing"), "warning");
});

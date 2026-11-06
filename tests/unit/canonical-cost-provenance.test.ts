import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  buildCanonicalSession,
  type CanonicalSession,
} from "../../src/core/canonical.ts";
import type { SessionEntry } from "../../src/core/events.ts";
import { toSessionReport } from "../../src/core/reports.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";
import { buildDailyRows } from "../../src/ui/daily.ts";
import { sessionDatedUsage } from "../../src/ui/dated-usage.ts";

const fixture = readFileSync(
  "tests/fixtures/pi/1.5.0/usage-cost-provenance.jsonl",
  "utf8",
);
const marker: SessionEntry = {
  type: "custom",
  id: "tracking-marker",
  parentId: null,
  timestamp: "2026-11-02T00:00:00.000Z",
  customType: "session-inspector:tracking-start",
  data: { schemaVersion: 1 },
};

function buildSession(generationIds: readonly string[]): CanonicalSession {
  const lines = fixture.trimEnd().split("\n");
  const records = lines
    .slice(1)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const byId = new Map(
    records.map((record) => [record.id as string, record] as const),
  );
  const selectedRecords = generationIds.map((id) => {
    const record = byId.get(id);
    assert.ok(record, `missing fixture record ${id}`);
    return record;
  });
  const parsed = parseSessionJsonl(
    `${[
      lines[0],
      JSON.stringify(marker),
      ...selectedRecords.map((record) => JSON.stringify(record)),
    ].join("\n")}\n`,
  );
  const result = buildCanonicalSession({
    parsed,
    scope: "tree",
    leafId: null,
    evidence: { atomic: [], folded: [] },
  });
  assert.equal(result.state, "ready");
  if (result.state !== "ready") throw new Error("unreachable");
  return result.session;
}

const provenanceCases = [
  { name: "provider-reported", ids: ["provider-cost"], expected: "provider" },
  {
    name: "catalog-estimated",
    ids: ["catalog-cost"],
    expected: "catalog-estimate",
  },
  { name: "unmarked historical", ids: ["unmarked-cost"], expected: undefined },
  {
    name: "provider-reported zero",
    ids: ["provider-zero"],
    expected: "provider",
  },
  {
    name: "catalog-estimated zero",
    ids: ["catalog-zero"],
    expected: "catalog-estimate",
  },
  { name: "unknown zero", ids: ["unknown-zero"], expected: undefined },
  {
    name: "mixed sources",
    ids: ["provider-cost", "catalog-cost"],
    expected: "mixed",
  },
  {
    name: "unmarked cost followed by provider",
    ids: ["unmarked-cost", "provider-cost"],
    expected: "mixed",
  },
  {
    name: "provider followed by unmarked cost",
    ids: ["provider-cost", "unmarked-cost"],
    expected: "mixed",
  },
  {
    name: "provider zero followed by catalog cost",
    ids: ["provider-zero", "catalog-cost"],
    expected: "catalog-estimate",
  },
  {
    name: "catalog cost followed by provider zero",
    ids: ["catalog-cost", "provider-zero"],
    expected: "catalog-estimate",
  },
  {
    name: "provider zero beside catalog zero",
    ids: ["provider-zero", "catalog-zero"],
    expected: "mixed",
  },
  {
    name: "zero-only provider and catalog aggregate, then provider cost",
    ids: ["provider-zero", "catalog-zero", "provider-cost"],
    expected: "provider",
  },
  {
    // A zero-amount record has nothing to qualify, so it adds no evidence.
    name: "unmarked zero followed by provider",
    ids: ["unknown-zero", "provider-cost"],
    expected: "provider",
  },
] as const;

for (const { name, ids, expected } of provenanceCases) {
  test(`canonical, dated, and daily usage preserve ${name} cost provenance`, () => {
    const session = buildSession(ids);
    const report = toSessionReport(session);
    const dated = sessionDatedUsage(session);
    const daily = buildDailyRows([
      {
        sessionId: session.sessionId,
        rows: dated.dates,
        truncated: dated.truncated,
      },
    ]);

    assert.equal(report.usage?.costProvenance, expected);
    assert.equal(session.usage.state, "known");
    if (session.usage.state !== "known") throw new Error("unreachable");
    assert.equal(
      session.usage.composition.generations.costProvenance,
      expected,
    );
    assert.equal(dated.dates[0]?.costProvenance, expected);
    assert.equal(
      dated.dates[0]?.composition.generations.costProvenance,
      expected,
    );
    assert.equal(dated.models[0]?.costProvenance, expected);
    assert.equal(daily.rows[0]?.costProvenance, expected);
    assert.equal(
      daily.rows[0]?.composition.generations.costProvenance,
      expected,
    );
  });
}

test("global daily usage combines provenance across sessions", () => {
  const provider = buildSession(["provider-cost"]);
  const catalog = buildSession(["catalog-cost"]);
  const providerDated = sessionDatedUsage(provider);
  const catalogDated = sessionDatedUsage(catalog);
  const daily = buildDailyRows([
    {
      sessionId: provider.sessionId,
      rows: providerDated.dates,
      truncated: providerDated.truncated,
    },
    {
      sessionId: catalog.sessionId,
      rows: catalogDated.dates,
      truncated: catalogDated.truncated,
    },
  ]);

  assert.equal(daily.rows[0]?.costProvenance, "mixed");
  assert.equal(daily.rows[0]?.composition.generations.costProvenance, "mixed");
});

test("copied or serialized dated rows keep unmarked-versus-empty cost evidence", () => {
  // Nonzero unmarked usage: a historical record that spent something.
  const unmarked = buildSession(["unmarked-cost"]);
  const provider = buildSession(["provider-cost"]);
  const contribution = (session: CanonicalSession) => {
    const dated = sessionDatedUsage(session);
    return {
      sessionId: session.sessionId,
      rows: JSON.parse(JSON.stringify(dated.dates)) as typeof dated.dates,
      truncated: dated.truncated,
    };
  };
  const daily = buildDailyRows([
    contribution(unmarked),
    contribution(provider),
  ]);
  const row = daily.rows[0];

  assert.equal(row?.costProvenance, "mixed");
  assert.equal(row?.composition.generations.costProvenance, "mixed");
  // A part that never saw usage stays unknown, not mixed.
  assert.equal(row?.composition.toolResults.costProvenance, undefined);

  // Unmarked alone stays unknown after a copy.
  assert.equal(
    buildDailyRows([contribution(unmarked)]).rows[0]?.costProvenance,
    undefined,
  );
});

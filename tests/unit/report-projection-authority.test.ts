import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  attachSubagentEvidence,
  buildCanonicalSession,
  type CanonicalSession,
} from "../../src/core/canonical.ts";
import type { SessionEntry } from "../../src/core/events.ts";
import { reduceEntries } from "../../src/core/reduce.ts";
import { toSessionReport } from "../../src/core/reports.ts";
import { readSubagentEvidence } from "../../src/integrations/subagents.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";
import { countersFrom } from "../../src/ui/l2-projection.ts";
import { loadCurrentSessionReport } from "../../src/ui/load-current.ts";
import { loadHistorySessionReport } from "../../src/ui/load-history.ts";

const FIXTURE = "tests/fixtures/pi/0.85.1/mixed-usage.jsonl";

/**
 * The report projection keeps a `ReducedSession` branch for pre-0.8
 * reducer-shaped fixtures and the benchmark harness. These tests pin the
 * production contract of that branch: production always hands L1 a
 * `CanonicalSession`, and the legacy branch stays a compatibility surface
 * rather than a second report authority.
 */

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

/** The builder input the production loaders use for the tracked fixture. */
function canonicalOf(fixture: string): CanonicalSession {
  const parsed = parseSessionJsonl(readFileSync(fixture, "utf8"));
  const built = buildCanonicalSession({
    parsed,
    scope: "tree",
    leafId: null,
    evidence: { atomic: [], folded: [] },
  });
  assert.equal(built.state, "ready");
  if (built.state !== "ready") throw new Error("unreachable");
  return built.session;
}

/** Mirrors `load-current.ts`: first-win id map, then the builder's scope order. */
function scopedEntries(session: CanonicalSession): SessionEntry[] {
  const parsed = parseSessionJsonl(readFileSync(FIXTURE, "utf8"));
  const byId = new Map<string, SessionEntry>();
  for (const entry of parsed.entries) {
    if (!byId.has(entry.id)) byId.set(entry.id, entry);
  }
  return session.scopedEntryIds.flatMap((id) => {
    const entry = byId.get(id);
    return entry === undefined ? [] : [entry];
  });
}

test("production report call sites are the two canonical loaders", () => {
  const referencing = sourceFiles("src")
    .filter((file) => /\btoSessionReport\b/.test(readFileSync(file, "utf8")))
    .sort();

  assert.deepEqual(referencing, [
    "src/core/reports.ts",
    "src/ui/load-current.ts",
    "src/ui/load-history.ts",
  ]);

  // The ReducedSession branch is only reachable from a caller that builds or
  // accepts a ReducedSession. No production module may do either.
  for (const loader of ["src/ui/load-current.ts", "src/ui/load-history.ts"]) {
    const source = readFileSync(loader, "utf8");
    assert.equal(
      /reduceEntries|ReducedSession/.test(source),
      false,
      `${loader} must project a CanonicalSession, not a ReducedSession`,
    );
  }
});

test("the current report path projects the CanonicalSession branch", async () => {
  const session = canonicalOf(FIXTURE);
  const subagents = readSubagentEvidence(
    scopedEntries(session),
    session.sessionId,
  );
  const attached = attachSubagentEvidence(session, subagents);
  const expected = toSessionReport(attached, {
    agents: { state: subagents.state, runs: subagents.runs },
    agentActivity: subagents.activity,
    ...countersFrom(attached),
  });

  const model = await loadCurrentSessionReport(FIXTURE, "tree", {
    leafId: null,
  });

  assert.ok(model, "the tracked fixture must load");
  assert.deepEqual(model.report, expected);
  // The legacy branch cannot produce L1 health: it would project
  // `unavailable` and this assertion would fail.
  assert.notEqual(model.report.evidenceHealth.core, "unavailable");
});

test("the history report path hands the projection a CanonicalSession", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-report-authority-"));
  const sessionDirectory = join(root, "public-sessions");
  await mkdir(sessionDirectory);
  await cp(
    "tests/fixtures/reports/history-session.jsonl",
    join(sessionDirectory, "history-session.jsonl"),
  );
  await mkdir(join(root, "sessions", "history-session"), { recursive: true });
  await writeFile(
    join(root, "sessions", "history-session", "meta.json"),
    '{"schemaVersion":2,"sessionId":"history-session","sourceFile":"history-session.jsonl","state":"tracking"}\n',
  );
  const options = {
    root,
    sessionDirectory: () => sessionDirectory,
    maintenance: {
      writerId: "maintainer-1",
      now: () => new Date("2026-02-03T12:00:00.000Z"),
      isPidAlive: () => false,
    },
  };

  let captured: CanonicalSession | undefined;
  const viaSeam = await loadHistorySessionReport("history-session", {
    ...options,
    replay: (input) => {
      captured = input.session;
      return toSessionReport(input.session);
    },
  });
  const viaDefault = await loadHistorySessionReport("history-session", options);

  assert.ok(captured, "the replay seam must observe the production input");
  // `schemaVersion`/`scopedEntryIds` only exist on L1, so their presence proves
  // the loader handed the projection a CanonicalSession.
  assert.equal(captured.schemaVersion, 1);
  assert.ok(captured.scopedEntryIds.length > 0);
  assert.equal(viaSeam?.availability, "available");
  assert.equal(viaDefault?.availability, "available");
  assert.ok(viaDefault.availability === "available");
  // The default replay's health is the builder's health; the legacy branch
  // would project `unavailable` evidence instead.
  assert.deepEqual(
    viaDefault.report.evidenceHealth,
    (captured as CanonicalSession).health,
  );
});

test("the ReducedSession branch stays a non-production compatibility input", () => {
  const parsed = parseSessionJsonl(readFileSync(FIXTURE, "utf8"));
  const legacy = toSessionReport(
    reduceEntries(parsed.id ?? "fixture", parsed.entries),
  );
  const canonical = toSessionReport(canonicalOf(FIXTURE));

  // Shared semantic projection is unchanged by the input shape.
  for (const key of [
    "sessionId",
    "usage",
    "usageComposition",
    "generations",
    "compactions",
    "errors",
    "tools",
    "models",
  ] as const) {
    assert.deepEqual(legacy[key], canonical[key], `${key} must project alike`);
  }
  // The observable discriminator guard tests rely on: only the L1 input
  // carries canonical health.
  assert.equal(legacy.evidenceHealth.core, "unavailable");
  assert.notEqual(canonical.evidenceHealth.core, "unavailable");
});

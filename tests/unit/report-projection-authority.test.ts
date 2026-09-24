import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { test } from "node:test";
import ts from "typescript";

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
import { sessionView } from "../../src/ui/report-projection.ts";

const FIXTURE = "tests/fixtures/pi/0.85.1/mixed-usage.jsonl";
const EFFORT_FIXTURE =
  "tests/fixtures/pi/0.85.1/subagent-agent-run-effort.jsonl";

/**
 * The report projection keeps a `ReducedSession` branch for pre-0.8
 * reducer-shaped fixtures and the benchmark harness. These tests pin the
 * production contract of that branch: production always hands L1 a
 * `CanonicalSession`, and the legacy branch stays a compatibility surface
 * rather than a second report authority.
 *
 * The production-authority check is reference-based (TypeScript symbols, not
 * source text), so aliased imports, re-exports, and formatting stay invisible
 * to it.
 */

let program: ts.Program | undefined;

/** The `src/` files parsed with the repository compiler options. */
function sourceProgram(): ts.Program {
  if (program !== undefined) return program;
  const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
  assert.equal(config.error, undefined, "tsconfig.json must be readable");
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    ".",
    undefined,
    "tsconfig.json",
  );
  program = ts.createProgram(
    parsed.fileNames.filter((file) => projectPath(file).startsWith("src/")),
    parsed.options,
  );
  return program;
}

function projectPath(fileName: string): string {
  return relative(process.cwd(), fileName).split(sep).join("/");
}

type Declaration = { file: string; name: string };

/**
 * Every `src/` reference to an exported declaration, keyed by file, resolved
 * through aliases and re-exports by the type checker.
 */
function referencesTo(declaration: Declaration): Map<string, ts.Node[]> {
  const checker = sourceProgram().getTypeChecker();
  const found = new Map<string, ts.Node[]>();
  for (const source of sourceProgram().getSourceFiles()) {
    const file = projectPath(source.fileName);
    if (!file.startsWith("src/")) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) {
        const raw = checker.getSymbolAtLocation(node);
        const symbol =
          raw !== undefined && (raw.flags & ts.SymbolFlags.Alias) !== 0
            ? checker.getAliasedSymbol(raw)
            : raw;
        if (
          symbol?.getName() === declaration.name &&
          symbol.declarations?.some(
            (entry) =>
              projectPath(entry.getSourceFile().fileName) === declaration.file,
          )
        ) {
          found.set(file, [...(found.get(file) ?? []), node]);
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(source, visit);
  }
  return found;
}

/** References that are the callee of a call, not an import or type position. */
function callSites(references: Map<string, ts.Node[]>): string[] {
  return [...references]
    .filter(([, nodes]) =>
      nodes.some(
        (node) =>
          ts.isCallExpression(node.parent) && node.parent.expression === node,
      ),
    )
    .map(([file]) => file)
    .sort();
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
  const projection = referencesTo({
    file: "src/core/reports.ts",
    name: "toSessionReport",
  });
  const production = [...projection.keys()].filter(
    (file) => file !== "src/core/reports.ts",
  );
  const loaders = ["src/ui/load-current.ts", "src/ui/load-history.ts"];

  // Exactly the two loaders call the projection; a third production caller
  // would have to be a reviewed decision, not an accident.
  assert.deepEqual(callSites(projection), loaders);
  // Referencing it without calling is allowed only inside those loaders, so a
  // future re-export module cannot smuggle a caller past this guard.
  for (const file of production) {
    assert.ok(
      loaders.includes(file),
      `${file} references the report projection`,
    );
  }

  // The ReducedSession branch is only reachable from a module that builds or
  // names a ReducedSession. No production loader may do either.
  const reducedBuilder = referencesTo({
    file: "src/core/reduce.ts",
    name: "reduceEntries",
  });
  const legacyShape = referencesTo({
    file: "src/core/events.ts",
    name: "ReducedSession",
  });
  for (const loader of loaders) {
    assert.equal(
      reducedBuilder.has(loader),
      false,
      `${loader} must project a CanonicalSession, not a ReducedSession`,
    );
    assert.equal(
      legacyShape.has(loader),
      false,
      `${loader} must not name the legacy ReducedSession shape`,
    );
  }
});

test("the effort fixture projects one agent set and matching health counts", () => {
  const parsed = parseSessionJsonl(readFileSync(EFFORT_FIXTURE, "utf8"));
  const evidence = readSubagentEvidence(parsed.entries, parsed.id);
  const built = buildCanonicalSession({
    parsed,
    scope: "tree",
    leafId: null,
    evidence: { atomic: [], folded: [] },
    subagents: evidence,
  });
  assert.equal(built.state, "ready");
  if (built.state !== "ready") throw new Error("unreachable");

  const report = toSessionReport(built.session);
  const foreground = report.agents.find((run) => run.agent === "agent-a");
  const projected = sessionView(report);
  const projectedForeground = projected.agents.find(
    (run) => run.agent === "agent-a",
  );
  assert.equal(foreground?.durationMs, 1234);
  assert.equal(foreground?.toolCalls, 3);
  assert.equal(foreground?.effortCoverage.duration, "partial");
  assert.equal(foreground?.effortCoverage.tools, "partial");
  assert.equal(projectedForeground?.durationMs, 1234);
  assert.equal(projectedForeground?.durationLabel, "1.2 s");
  assert.equal(projectedForeground?.toolCalls, 3);
  assert.deepEqual(
    projectedForeground?.effortCoverage,
    foreground?.effortCoverage,
  );
  const withoutDuration = report.agents.find(
    (run) => run.durationMs === undefined,
  );
  assert.ok(withoutDuration);
  assert.equal(
    projected.agents.find((run) => run.id === withoutDuration.id)?.durationMs,
    null,
  );
  const withoutToolCalls = report.agents.find(
    (run) => run.toolCalls === undefined,
  );
  assert.ok(withoutToolCalls);
  assert.equal(
    projected.agents.find((run) => run.id === withoutToolCalls.id)?.toolCalls,
    null,
  );
  assert.equal(
    report.agents.filter((run) => run.durationMs !== undefined).length,
    2,
  );
  assert.equal(
    report.agents.filter((run) => run.toolCalls !== undefined).length,
    2,
  );
  assert.deepEqual(report.agentUsage, { runsTotal: 10, runsWithUsage: 4 });
  assert.equal(report.evidenceHealth.joins.agentRuns, 10);
  assert.equal(report.evidenceHealth.usage.childLines, 3);
  const serialized = JSON.stringify(report);
  assert.match(serialized, /"durationMs":1234/);
  assert.match(serialized, /"toolCalls":3/);
  assert.match(serialized, /"effortCoverage"/);
  assert.equal(serialized.includes("fg-container"), false);
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

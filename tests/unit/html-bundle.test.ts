import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type { SessionCoverage } from "../../src/core/session-coverage.ts";
import {
  loadInspectorBundle,
  type InspectorBundle,
} from "../../src/ui/bundle.ts";
import {
  aggregateUsageLabels,
  renderInspectorBundle,
} from "../../src/ui/html.ts";
import {
  bundleInput,
  currentModelWithAgents,
  embedOf,
  modelWithActivityAndRuns,
  modelWithOrphanChild,
  modelWithOrphanChildAndParent,
  modelWithStatuses,
  modelWithToolError,
  modelWithToolErrorAndTwoChildren,
} from "../helpers/bundle-scenarios.ts";

function bundleFixture(): InspectorBundle {
  return JSON.parse(
    readFileSync(
      new URL("../fixtures/bundles/inspector-bundle.json", import.meta.url),
      "utf8",
    ),
  ) as InspectorBundle;
}

test("renders one offline document with both current views and initial theme", () => {
  const html = renderInspectorBundle(bundleFixture());
  const data = embedOf(html);

  assert.match(html, /class="[^"]*theme-dark/);
  assert.equal(data.initialScope, "tree");
  assert.equal(data.current.active.report.sessionId, "session-a");
  assert.equal(data.current.tree.report.sessionId, "session-a");
  assert.equal(data.history.sessions.length, 2);
  assert.equal(data.global.daily.length > 0, true);
  assert.equal(renderInspectorBundle(bundleFixture()), html);

  // No network surface and no raw records.
  for (const leak of [
    "http://",
    "https://",
    "<script src",
    "PRIVATE",
    "promptGuidelines",
  ]) {
    assert.equal(html.includes(leak), false, leak);
  }
});

test("renders inventory, resources, agent activity, integration presence, and error messages", () => {
  const html = renderInspectorBundle(bundleFixture());
  const data = embedOf(html);

  assert.equal(data.current.tree.report.commands.items.length, 1);
  assert.equal(data.current.tree.report.resources.items.length, 2);
  assert.equal(data.current.tree.report.agentActivity.calls, 3);
  assert.equal(
    data.current.tree.report.integrations.some(
      (row: { presence: string }) => row.presence === "absent",
    ),
    true,
  );
  assert.equal(
    data.current.tree.report.errors[0].message,
    "429 rate limit from [URL]",
  );
  assert.equal(data.current.tree.report.skills.otherInvocations, 1);
  assert.equal(html.includes("inventory ≠ invocations"), true);
});

test("switches precomputed current views offline without host calls", () => {
  const html = renderInspectorBundle(bundleFixture());

  for (const fragment of ["data.current[state.scope]", "state.scope="]) {
    assert.equal(html.includes(fragment), true, fragment);
  }
  // No host round-trip, no fetch, no client-side replay of raw records.
  assert.equal(
    /fetch\(|XMLHttpRequest|WebSocket|EventSource/.test(html),
    false,
  );
  assert.equal(
    /data\.(report\.)?(generations|compactions)\b/.test(html),
    false,
  );
});

test("disables an unavailable current view with its bounded diagnostic", () => {
  const bundle = bundleFixture();
  bundle.current.active = {
    availability: "unavailable",
    diagnostic: "current-unavailable",
  };
  const html = renderInspectorBundle(bundle);
  const data = embedOf(html);

  assert.equal(data.current.active.availability, "unavailable");
  assert.equal(data.current.active.report, undefined);
  assert.equal(data.current.tree.availability, "available");
  assert.equal(html.includes("button.disabled=unavailable"), true);
});

test("fills the evidence tabs with reviewed copy and columns", () => {
  const html = renderInspectorBundle(bundleFixture());

  for (const fragment of [
    'tr("commands.note")',
    'tr("skills.note")',
    'tr("table.invocations")',
    'tr("skills.otherInvocations"',
    'tr("panel.resources")',
    'tr("agents.activity.note")',
    "PRESENCE_LABELS",
    'tr("table.message")',
    "orUnavailable(row.source)",
    "orUnavailable(row.sourceLabel||row.source||null)",
  ]) {
    assert.equal(html.includes(fragment), true, fragment);
  }
});

test("renders a bounded truncation notice only when the active view was capped", () => {
  const untruncated = renderInspectorBundle(bundleFixture());

  // An uncapped view ships no notice element at all; the copy still lives in
  // the translated catalog, but nothing renders it.
  assert.equal(
    untruncated.includes('<p class="range-note" id="range-truncated"'),
    false,
  );

  const bundle = bundleFixture();
  bundle.current.tree.dailyTruncated = true;
  const html = renderInspectorBundle(bundle);
  const data = embedOf(html);

  assert.equal(data.current.tree.dailyTruncated, true);
  assert.match(
    html,
    /<p class="range-note" id="range-truncated">Older days beyond the retained window are not shown\.<\/p>/,
  );
  // The notice is the only change: no rows are fabricated to fill the window.
  assert.deepEqual(
    data.current.tree.daily,
    embedOf(untruncated).current.tree.daily,
  );
  assert.equal(
    /id="range-truncated"[^>]*\shidden/.test(html),
    false,
    "a capped view shows the notice",
  );
});

test("escapes hostile session ids and command names in the bundle payload", () => {
  const hostileSessionId = "session</script><& \u2028 ";
  const hostileCommand = "</script><b>&\u2028 cmd";
  const bundle = bundleFixture();
  const active = bundle.current.active.report;
  const tree = bundle.current.tree.report;
  if (active === undefined || tree === undefined) {
    throw new Error("bundle fixture must carry both current view reports");
  }
  active.sessionId = hostileSessionId;
  tree.sessionId = hostileSessionId;
  tree.commands.items[0].name = hostileCommand;

  const html = renderInspectorBundle(bundle);
  const match =
    /<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/.exec(
      html,
    );
  const payload = match?.[1] ?? "";

  // The payload is valid JSON (it parsed) and every hostile value round-trips.
  const data = embedOf(html);
  assert.equal(data.current.active.report.sessionId, hostileSessionId);
  assert.equal(data.current.tree.report.sessionId, hostileSessionId);
  assert.equal(data.current.tree.report.commands.items[0].name, hostileCommand);

  for (const raw of ["<", ">", "&", "\u2028"]) {
    assert.equal(payload.includes(raw), false, `raw ${JSON.stringify(raw)}`);
  }
  assert.equal(payload.includes("</script"), false);
});

// Clones the fixture bundle and sets/removes coverage on both aggregates.
function withAggregateCoverage(
  coverage: SessionCoverage | undefined,
): InspectorBundle {
  const bundle = bundleFixture();
  for (const section of [bundle.history, bundle.global] as Record<
    string,
    unknown
  >[]) {
    if (coverage === undefined) delete section.coverage;
    else section.coverage = coverage;
  }
  return bundle;
}

test("a partial aggregate renders Known wording and never an unqualified total", () => {
  const html = renderInspectorBundle(
    withAggregateCoverage({
      inspected: 27,
      available: 5,
      unavailable: 22,
      sessionRatio: 0.1852,
      complete: false,
      discoveryLimited: false,
      reasons: { "manifest-unavailable": 22 },
    }),
  );
  assert.match(html, /Known native cost/);
  assert.match(html, /Known tokens/);
  assert.match(html, /5 \/ 27 sessions · 22 unavailable/);
  assert.equal(/"cost":"metric\.cost"/.test(html), false);
});

test("legacy aggregates show their value qualified as completeness-unknown", () => {
  const html = renderInspectorBundle(withAggregateCoverage(undefined));
  assert.match(html, /Known native cost — completeness unknown/);
  assert.equal(/"cost":"metric\.costUnavailable"/.test(html), false);
});

test("a capped discovery shows counts and never a ratio", () => {
  const html = renderInspectorBundle(
    withAggregateCoverage({
      inspected: 206,
      available: 206,
      unavailable: 0,
      sessionRatio: null,
      complete: false,
      discoveryLimited: true,
      reasons: {},
    }),
  );
  assert.match(
    html,
    /206 sessions inspected · additional sessions not inspected/,
  );
  // Excludes the inline stylesheet: its layout `100%` declarations are presentation, not coverage.
  assert.equal(
    /206 \/ 206 sessions|100%/.test(
      html.replace(/<style>[\s\S]*?<\/style>/g, ""),
    ),
    false,
  );
});

test("an empty inspection set is unavailable, never zero", () => {
  const html = renderInspectorBundle(
    withAggregateCoverage({
      inspected: 0,
      available: 0,
      unavailable: 0,
      sessionRatio: null,
      complete: false,
      discoveryLimited: false,
      reasons: {},
    }),
  );
  assert.match(html, /No tracked sessions/);
  assert.equal(/\$0\.00/.test(html), false);
});

test("client range wiring replaced the per-section period and the clamp", () => {
  const html = renderInspectorBundle(bundleFixture());
  for (const fragment of [
    "function filterView",
    "function historyRowRange",
    "const parseRangeQuery",
    "Range could not be restored; showing the default range.",
  ]) {
    assert.equal(html.includes(fragment), true, fragment);
  }
  assert.equal(/1970-01-01/.test(html), false);
  assert.equal(html.includes("periods[state.section]"), false);
});

test("a document with no tracked sessions carries no period sentinel", () => {
  const bundle = bundleFixture();
  bundle.history.sessions = [];
  bundle.global.sessions = [];
  bundle.global.dates = [];
  const html = renderInspectorBundle(bundle);
  const data = embedOf(html);

  for (const section of [data.history, data.global]) {
    assert.equal("period" in section, false);
    assert.equal("latestDate" in section, false);
  }
  assert.equal(html.includes("1970-01-01"), false);
});

test("scope copy names the ancestry and claims only report equality", () => {
  const html = renderInspectorBundle(bundleFixture());
  for (const fragment of [
    "Active path",
    "Full session tree",
    "Selected entry and its parent ancestry",
    "All tracked branches in this session",
  ]) {
    assert.equal(html.includes(fragment), true, fragment);
  }
  assert.equal(/children/.test(html), false);
});

test("the label resolver separates value availability from coverage availability", () => {
  assert.deepEqual(
    aggregateUsageLabels({ availability: "available", coverage: undefined }),
    {
      cost: "coverage.unknownCompletenessCost",
      tokens: "coverage.unknownCompletenessTokens",
      usageUnavailable: false,
      sessions: "coverage.unknown",
    },
  );
  assert.equal(
    aggregateUsageLabels({ availability: "unavailable", coverage: undefined })
      .usageUnavailable,
    true,
  );
  const empty = aggregateUsageLabels({
    availability: "available",
    coverage: {
      inspected: 0,
      available: 0,
      unavailable: 0,
      sessionRatio: null,
      complete: false,
      discoveryLimited: false,
      reasons: {},
    },
  });
  assert.deepEqual(
    [empty.usageUnavailable, empty.sessions],
    [true, "coverage.none"],
  );
});

test("tool and agent rows keep time, role and identity", async () => {
  const html = renderInspectorBundle(
    await loadInspectorBundle({
      ...bundleInput,
      loadCurrent: async () => currentModelWithAgents(),
    }),
  );
  const report = (
    embedOf(html).current.active as {
      report: {
        tools: Record<string, unknown>[];
        agents: Record<string, unknown>[];
      };
    }
  ).report;
  assert.ok("timestamp" in report.tools[0]);
  assert.equal(report.tools[0].timestamp, "2026-02-01T09:00:00.000Z");
  const keys = [
    "agent",
    "artifacts",
    "observedAt",
    "model",
    "thinking",
    "failure",
    "evidenceToolId",
  ];
  const agent = report.agents[0];
  for (const key of keys) assert.ok(key in agent, key);
  assert.deepEqual(
    [
      agent.agent,
      agent.artifacts,
      agent.observedAt,
      agent.model,
      agent.thinking,
      agent.failure,
      agent.evidenceToolId,
    ],
    [
      "reviewer",
      "available",
      "2026-02-02T00:01:00.000Z",
      "alpha",
      "high",
      { reason: "exit-nonzero", detail: 1 },
      "tool:call_subagent",
    ],
  );
  // An absent optional field is null: never "", never a placeholder entity.
  const bare = report.agents[1];
  for (const key of keys) assert.equal(bare[key], null, key);
});

test("an error row is joined to its tool and to every child run that published through it", async () => {
  const html = renderInspectorBundle(
    await loadInspectorBundle({
      ...bundleInput,
      loadCurrent: async () => modelWithToolErrorAndTwoChildren(),
    }),
  );
  const report = (
    embedOf(html).current.active as {
      report: {
        errors: Record<string, unknown>[];
        agents: Record<string, unknown>[];
      };
    }
  ).report;
  const error = report.errors[0];
  assert.deepEqual(
    [
      error.toolName,
      error.toolSource,
      (error.relatedChildIds as unknown[]).length,
    ],
    ["bash", null, 2],
  );
  // One publishing result may observe many runs: the join is one-to-many and
  // names none of them as the cause.
  assert.deepEqual(
    error.relatedChildIds,
    report.agents.map((run) => run.id),
  );
});

test("an error with no publishing result joins no child run", async () => {
  const html = renderInspectorBundle(
    await loadInspectorBundle({
      ...bundleInput,
      loadCurrent: async () => modelWithToolError(),
    }),
  );
  const error = (
    embedOf(html).current.active as {
      report: { errors: Record<string, unknown>[] };
    }
  ).report.errors[0];
  assert.deepEqual(
    [error.toolName, error.toolSource, error.relatedChildIds],
    ["bash", null, []],
  );
  // A generation error carries no tool id at all, so it joins nothing either.
  const unmatched = (
    embedOf(renderInspectorBundle(bundleFixture())).current.tree as {
      report: { errors: Record<string, unknown>[] };
    }
  ).report.errors[0];
  assert.deepEqual(
    [unmatched.toolName, unmatched.toolSource, unmatched.relatedChildIds],
    [null, null, []],
  );
});

test("the browser payload never carries producer text or paths", () => {
  const html = renderInspectorBundle(bundleFixture());
  for (const forbidden of [
    "task",
    "finalOutput",
    "progressSummary",
    "transcriptPath",
    "artifactPaths",
    "sessionFile",
  ]) {
    assert.equal(html.includes(`"${forbidden}"`), false, forbidden);
  }
});

test("tables render the projected rows only, never a report array", () => {
  const html = renderInspectorBundle(bundleFixture());
  const script =
    /<script>\n([\s\S]*)\n<\/script><\/body>/.exec(html)?.[1] ?? "";
  assert.equal(script.length > 0, true);
  assert.equal(
    /report\.(tools|agents|errors|models|generations|compactions)/.test(script),
    false,
  );
});

test("the history projection carries each session's dated model rows", () => {
  const bundle = bundleFixture();
  const session = bundle.history.sessions[0];
  if (session?.availability !== "available") {
    throw new Error("the fixture's first history session must be available");
  }
  session.datedModels = [
    {
      date: "2026-02-02",
      provider: "acme",
      model: "alpha",
      generations: 1,
      totalTokens: 800,
      cost: 0.16,
    },
  ];
  session.modelsTruncated = true;
  const projected = embedOf(renderInspectorBundle(bundle)).history.sessions[0];

  assert.deepEqual(projected.datedModels, session.datedModels);
  assert.equal(projected.modelsTruncated, true);
  // A payload without the dated projection keeps the keys absent, so the
  // legacy adapter still renders its labelled aggregate model table.
  const legacy = embedOf(renderInspectorBundle(bundleFixture())).history
    .sessions[0];
  assert.equal("datedModels" in legacy, false);
  assert.equal("modelsTruncated" in legacy, false);
});

test("the agents panel separates child runs from native agent tool activity", async () => {
  const html = renderInspectorBundle(
    await loadInspectorBundle({
      ...bundleInput,
      loadCurrent: async () =>
        modelWithActivityAndRuns({ calls: 174, runs: 23, runsWithUsage: 18 }),
    }),
  );
  assert.match(html, /Child runs/);
  assert.match(html, /Agent tool activity/);
  assert.match(html, /18 of 23 runs reported usage/);
  assert.equal(/"label":"Agent calls"/.test(html), false);
});

test("child run statuses each keep their own bucket", async () => {
  const html = renderInspectorBundle(
    await loadInspectorBundle({
      ...bundleInput,
      loadCurrent: async () =>
        modelWithStatuses([
          "succeeded",
          "failed",
          "interrupted",
          "running",
          "unknown",
        ]),
    }),
  );
  for (const label of [
    "Child runs",
    "Succeeded",
    "Failed",
    "Interrupted",
    "Running",
    "Unknown",
  ]) {
    assert.match(html, new RegExp(label));
  }
});

test("a parent outside the selected projection is labelled, not linked", async () => {
  const html = renderInspectorBundle(
    await loadInspectorBundle({
      ...bundleInput,
      loadCurrent: async (scope) =>
        scope === "active"
          ? modelWithOrphanChild()
          : modelWithOrphanChildAndParent(),
    }),
  );
  assert.match(
    html,
    /Parent: outside selected scope|agents\.parentOutsideScope/,
  );
});

test("the agents panel reads the rows it renders, never a stored fraction", () => {
  const html = renderInspectorBundle(bundleFixture());
  for (const fragment of [
    'tr("panel.agentActivity")',
    'tr("agents.childRuns")',
    'tr("agents.knownTokens")',
    'tr("agents.knownCost")',
    'tr("agents.knownFailedCost")',
    'tr("agents.usageFraction"',
    'tr("agents.parentOutsideScope")',
    'tr("agents.parentUnknown")',
    'tr("agents.undated")',
  ]) {
    assert.equal(html.includes(fragment), true, fragment);
  }
  // The fraction is recomputed from the rendered rows, so a range filter can
  // never reuse a full-session count: no derived fraction travels in the
  // payload at all.
  assert.equal(/"agentUsage"/.test(html), false);
});

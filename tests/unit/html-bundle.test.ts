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
  ENGLISH_CATALOG,
  errorHeadline,
  errorMessage,
  inlineModuleSource,
  renderInspectorBundle,
  toolCalls,
  toolDuration,
  toolSummary,
  type ToolCallRow,
} from "../../src/ui/html.ts";
import {
  bundleInput,
  currentModelWithAgents,
  currentModelWithHostileToolArguments,
  currentModelWithOutOfOrderToolCalls,
  currentModelWithPartialToolUsage,
  currentModelWithTools,
  embedOf,
  hostileToolArgumentEntries,
  modelWithActivityAndRuns,
  modelWithAbsentDetectedTelemetry,
  modelWithCounterOnlySkill,
  modelWithErrorAndThreeChildren,
  modelWithGenerationError,
  modelWithIntegrations,
  modelWithInventory,
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

/** The tool rows the document projects for its initially shown view. */
function toolPayload(html: string): ToolCallRow[] {
  const data = embedOf(html);
  return (data.current.active as { report: { tools: ToolCallRow[] } }).report
    .tools;
}

test("the summary's last used instant is the newest call, not the last row", async () => {
  const html = renderInspectorBundle(
    await loadInspectorBundle({
      ...bundleInput,
      loadCurrent: async () => currentModelWithOutOfOrderToolCalls(),
    }),
  );
  const rows = toolPayload(html);
  // The projection keeps entry order and this session persisted the name's older
  // call after its newer one, so "the last row wins" would report the older.
  assert.deepEqual(
    rows.map((row) => row.timestamp),
    ["2026-02-01T10:00:09.000Z", "2026-02-01T10:00:00.000Z"],
  );
  assert.deepEqual(
    toolSummary({ tools: rows }).map((row) => [
      row.name,
      row.calls,
      row.lastUsed,
    ]),
    [["read", 2, "2026-02-01T10:00:09.000Z"]],
  );
});

test("tools summary aggregates and the calls view keeps real timestamps", async () => {
  const html = renderInspectorBundle(
    await loadInspectorBundle({
      ...bundleInput,
      loadCurrent: async () => currentModelWithTools(),
    }),
  );
  assert.match(html, /tools\.summary|Tools summary/);
  assert.match(html, /2026-03-01T10:00:00\.000Z/);
  assert.match(html, /tools\.lastUsed|Last used/);

  // Both views read the one projection: the summary groups the same calls the
  // timeline lists, one row per tool name, sorted by name, with the maximum
  // persisted call timestamp as last used.
  const rows = toolPayload(html);
  const summary = toolSummary({ tools: rows });
  assert.deepEqual(
    summary.map((row) => [
      row.name,
      row.calls,
      row.succeeded,
      row.failed,
      row.interrupted,
      row.lastUsed,
    ]),
    [
      ["bash", 1, 0, 1, 0, "2026-02-01T23:59:00.000Z"],
      ["read", 1, 1, 0, 0, "2026-03-01T10:00:00.000Z"],
    ],
  );
  // The first known source label of a name survives, even when only a later
  // call of that name attributed one.
  assert.equal(
    toolSummary({
      tools: [
        {
          name: "read",
          status: "succeeded",
          timestamp: "2026-02-01T10:00:00.000Z",
          usage: null,
        },
        {
          name: "read",
          source: "extension",
          status: "succeeded",
          timestamp: "2026-02-01T10:00:01.000Z",
          usage: null,
        },
      ],
    })[0].source,
    "extension",
  );
  // Newest first, from the persisted call timestamps only.
  assert.deepEqual(
    toolCalls({ tools: rows }, null).map((row) => row.timestamp),
    ["2026-03-01T10:00:00.000Z", "2026-02-01T23:59:00.000Z"],
  );
  // Selecting a summary row narrows the calls view to that tool name; `null` is
  // the cleared state the clear-filter control restores.
  assert.deepEqual(
    toolCalls({ tools: rows }, "bash").map((row) => row.name),
    ["bash"],
  );

  // Duration is live-correlated evidence only: without supported timing a row
  // renders Unavailable, and no value is ever estimated from call timestamps.
  assert.equal(toolDuration({ durationLabel: "42 ms" }, "unavailable"), null);
  assert.equal(toolDuration({ durationLabel: "42 ms" }, "supported"), "42 ms");
  assert.equal(toolDuration({ durationLabel: null }, "supported"), null);

  // The document runs this same derivation: the copied source is callable with
  // no module scope, so the browser cannot drift from the tested function.
  assert.equal(inlineModuleSource().includes("const toolSummary="), true);
  const inlined = new Function(
    `${inlineModuleSource()}\nreturn {toolSummary};`,
  )() as { toolSummary: typeof toolSummary };
  assert.deepEqual(inlined.toolSummary({ tools: rows }), summary);
});

test("partial tool usage is stated, never extrapolated", async () => {
  const html = renderInspectorBundle(
    await loadInspectorBundle({
      ...bundleInput,
      loadCurrent: async () => currentModelWithPartialToolUsage(),
    }),
  );
  const [row] = toolSummary({ tools: toolPayload(html) });
  // The known value is the usage the one reporting call persisted, never that
  // value projected onto the whole call set.
  assert.deepEqual(
    [
      row.name,
      row.calls,
      row.succeeded,
      row.failed,
      row.interrupted,
      row.tokens,
      row.cost,
      row.withUsage,
    ],
    ["read", 3, 2, 1, 0, 180, 0.04, 1],
  );
  // The row's own partial sentence is asserted as rendered markup through the
  // client harness in `tests/unit/report-range.test.ts`: a sentence computed
  // here from the catalog template cannot fail for a client that renders none.
  assert.match(html, /Known tokens/);
  // The browser states that sentence from the catalog key over the rows it
  // renders, and a call set whose calls reported no usage is Unavailable.
  assert.match(html, /tr\("tools\.usageFraction",\{withUsage:/);
  assert.match(html, /withUsage===0\?tr\("evidence\.unavailable"\)/);
  // Two of the three calls persisted no usage, so both render Unavailable.
  assert.equal(
    toolCalls({ tools: toolPayload(html) }, null).filter(
      (call) => call.usage === null,
    ).length,
    2,
  );
});

test("tool tables never render arguments or result bodies", async () => {
  const html = renderInspectorBundle(
    await loadInspectorBundle({
      ...bundleInput,
      loadCurrent: async () => currentModelWithHostileToolArguments(),
    }),
  );
  assert.equal(/SECRET_ARGUMENT|SECRET_RESULT/.test(html), false);

  // The persisted entries really carry both sentinels, so the absence above is
  // the projection dropping them and not the scenario failing to plant them.
  const entries = JSON.stringify(hostileToolArgumentEntries());
  assert.equal(entries.includes("SECRET_ARGUMENT"), true);
  assert.equal(entries.includes("SECRET_RESULT"), true);

  // The scenario still renders its call, so the absence above is not vacuous,
  // and the row carries named bounded fields only: a persisted argument or
  // result body has no path into either tools view.
  const rows = toolPayload(html);
  assert.deepEqual(
    toolSummary({ tools: rows }).map((row) => row.name),
    ["read"],
  );
  assert.deepEqual(Object.keys(rows[0]).sort(), [
    "durationLabel",
    "durationMs",
    "id",
    "name",
    "status",
    "timestamp",
    "usage",
  ]);
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

test("an error row's headline is the joined tool's name, never its id", async () => {
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
  // The join Task 8 resolved in Node is what the headline reads: the raw id
  // stays a detail of the row, and the tool's own status travels with it so the
  // row never has to re-join in the browser.
  assert.deepEqual(
    [error.id, error.toolName, error.toolSource, error.toolStatus],
    ["tool:call_bash", "bash", null, "failed"],
  );

  // One headline rule, and the document runs it: the browser cannot drift from
  // the function these assertions exercise.
  assert.equal(inlineModuleSource().includes("const errorHeadline="), true);
  const inlined = new Function(
    `${inlineModuleSource()}\nreturn {errorHeadline};`,
  )() as { errorHeadline: typeof errorHeadline };
  const cases = [
    { kind: "tool-error", toolName: "bash" },
    { kind: "tool-error", toolName: null },
    { kind: "generation-error", toolName: null },
  ];
  assert.deepEqual(
    inlined.errorHeadline(cases[0]),
    errorHeadline(cases[0]),
    "the inlined source must be the tested source",
  );
  assert.deepEqual(errorHeadline(cases[0]), {
    key: "errors.toolFailed",
    values: { tool: "bash" },
  });
  // A tool error with no joined tool has no name to lead with, so the bounded
  // classification label takes the headline instead of a fabricated name.
  assert.deepEqual(errorHeadline(cases[1]), {
    key: "errors.failed",
    values: null,
  });
  // A generation error never joins a tool at all.
  assert.deepEqual(errorHeadline(cases[2]), {
    key: "errors.generation",
    values: null,
  });
  // The template fills to the headline the design pins, from the one catalog.
  assert.equal(
    ENGLISH_CATALOG["errors.toolFailed"].replace("{tool}", "bash"),
    "bash failed",
  );
});

test("a tool error's message is always Unavailable", async () => {
  const html = renderInspectorBundle(
    await loadInspectorBundle({
      ...bundleInput,
      loadCurrent: async () => modelWithToolError(),
    }),
  );
  assert.equal(ENGLISH_CATALOG["errors.messageUnavailable"], "Unavailable");

  // A tool error has no safe structured message at all (design §7.5-4): the
  // rule holds even for a forged row, so no path can render text from
  // `content`, tool output, arguments, or child output.
  assert.equal(errorMessage({ kind: "tool-error", message: "SECRET" }), null);
  // A generation error keeps the bounded redacted message the reducer kept.
  assert.equal(
    errorMessage({ kind: "generation-error", message: "429 rate limit" }),
    "429 rate limit",
  );
  // An absent message is Unavailable, never an empty string or a guess.
  assert.equal(errorMessage({ kind: "generation-error" }), null);
  assert.equal(inlineModuleSource().includes("const errorMessage="), true);
  // The Unavailable value is catalog copy the rule selects, never text
  // reconstructed from a persisted field: the client reads the key, not the row.
  assert.equal(html.includes('tr("errors.messageUnavailable")'), true);

  // The rendered document carries no persisted error text beyond the bounded
  // `message` field, so an error row's only copy source is the catalog.
  const generation = renderInspectorBundle(
    await loadInspectorBundle({
      ...bundleInput,
      loadCurrent: async () =>
        modelWithGenerationError("Request failed at [URL]"),
    }),
  );
  const errors = (
    embedOf(generation).current.active as {
      report: { errors: Record<string, unknown>[] };
    }
  ).report.errors;
  assert.deepEqual(
    errors.map((row) => [row.id, row.kind, row.message]),
    [["generation:g-error", "generation-error", "Request failed at [URL]"]],
  );
  // The same scenario without a persisted message carries no message at all.
  const silent = renderInspectorBundle(
    await loadInspectorBundle({
      ...bundleInput,
      loadCurrent: async () => modelWithGenerationError(),
    }),
  );
  const silentErrors = (
    embedOf(silent).current.active as {
      report: { errors: Record<string, unknown>[] };
    }
  ).report.errors;
  assert.deepEqual(
    silentErrors.map((row) => [row.kind, "message" in row]),
    [["generation-error", false]],
  );
});

test("related child runs are one-to-many and never causal", async () => {
  const html = renderInspectorBundle(
    await loadInspectorBundle({
      ...bundleInput,
      loadCurrent: async () => modelWithErrorAndThreeChildren(),
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
  // One publishing result, three candidates: every run is listed and no run is
  // singled out as the cause.
  assert.deepEqual(
    report.errors[0].relatedChildIds,
    report.agents.map((run) => run.id),
  );
  assert.equal((report.errors[0].relatedChildIds as unknown[]).length, 3);
  assert.deepEqual(
    report.agents.map((run) => run.agent),
    ["reviewer", "researcher", "validator"],
  );

  // The rendered list is one anchor per candidate, and zero candidates omit the
  // section entirely rather than padding it or inferring one.
  for (const fragment of [
    "dataset.childLink",
    'tr("errors.relatedChildren")',
    "row.relatedChildIds.length===0)return null",
  ]) {
    assert.equal(html.includes(fragment), true, fragment);
  }
  // Explicit refusal: no copy in the document may attribute the failure to a
  // child run.
  assert.equal(/caused by|cause of|blame/i.test(html), false);
});

test("inventory projects as environment state, never as activity", async () => {
  const html = renderInspectorBundle(
    await loadInspectorBundle({
      ...bundleInput,
      loadCurrent: async () => modelWithInventory(),
    }),
  );
  const report = (
    embedOf(html).current.active as {
      report: {
        commands: { state: string; count: number | null; items: unknown[] };
        skills: {
          state: string;
          invocationCount: number | null;
          count: number | null;
          items: unknown[];
        };
        resources: { state: string; items: unknown[] };
      };
    }
  ).report;

  assert.deepEqual(
    [
      report.commands.state,
      report.commands.count,
      report.commands.items.length,
      report.skills.state,
      report.skills.count,
      report.skills.invocationCount,
      report.resources.state,
      report.resources.items.length,
    ],
    ["supported", 119, 119, "supported", 42, 3, "supported", 11],
  );

  // The folded counters can name a skill the snapshot does not carry: that name
  // is one more row in `items` while the projected count stays the inventory's
  // own rows, so availability can never be inflated by activity.
  const counted = renderInspectorBundle(
    await loadInspectorBundle({
      ...bundleInput,
      loadCurrent: async () => modelWithCounterOnlySkill(),
    }),
  );
  const countedSkills = (
    embedOf(counted).current.active as {
      report: {
        skills: { count: number | null; items: { name: string }[] };
      };
    }
  ).report.skills;
  assert.deepEqual([countedSkills.count, countedSkills.items.length], [2, 3]);
  assert.equal(
    countedSkills.items.some((row) => row.name === "retired-mode"),
    true,
  );

  // The browser groups the inventory under one Environment entry: commands and
  // skills are no longer primary tabs, and every environment view stays out of
  // the range-filtered tab strip.
  assert.equal(
    html.includes(
      'const TABS=["overview","models","tools","environment","agents","integrations","errors","ledger"]',
    ),
    true,
  );
  for (const fragment of [
    'state.tab==="environment"',
    'tr("env.available"',
    'tr("env.observed"',
    'tr("env.invocationsObserved"',
    'tr("env.invocationsUnavailable"',
    'tr("env.sources"',
    'tr("env.note")',
  ]) {
    assert.equal(html.includes(fragment), true, fragment);
  }

  // The closed copy the panel renders: availability and the explicit folded
  // counters, with the period label that marks inventory as environment state.
  assert.equal(ENGLISH_CATALOG["env.available"], "Available: {count}");
  assert.equal(
    ENGLISH_CATALOG["env.observed"],
    "Observed invocations: {value}",
  );
  assert.equal(
    ENGLISH_CATALOG["env.invocationsObserved"],
    "Explicit invocations observed: {count}",
  );
  assert.equal(
    ENGLISH_CATALOG["env.invocationsUnavailable"],
    "Explicit invocations observed: Unavailable",
  );
  assert.equal(ENGLISH_CATALOG["env.sources"], "Sources: {count}");
  assert.match(ENGLISH_CATALOG["env.note"], /^Current environment/);
});

test("detection and telemetry stay independent in the integration projection", async () => {
  const html = renderInspectorBundle(
    await loadInspectorBundle({
      ...bundleInput,
      loadCurrent: async () => modelWithAbsentDetectedTelemetry(),
    }),
  );
  const integrations = (
    embedOf(html).current.active as {
      report: {
        integrations: {
          integration: string;
          presence: string;
          state: string;
          version: number | null;
          counters: string[];
        }[];
      };
    }
  ).report.integrations;

  // A row whose presence is absent and whose telemetry is supported is carried
  // through unchanged: neither column is derived from the other, and the row is
  // never dropped for the contradiction.
  assert.deepEqual(
    integrations.map((row) => [
      row.integration,
      row.presence,
      row.state,
      row.version,
    ]),
    [
      ["ponytail", "absent", "supported", 1],
      ["caveman", "absent", "unavailable", null],
    ],
  );
  assert.deepEqual(integrations[0]?.counters, ["changes: 0"]);

  // The same four columns over a definite, an unknown and an unsupported row:
  // every value is the row's own, and none is derived from another column.
  const columns = (
    embedOf(
      renderInspectorBundle(
        await loadInspectorBundle({
          ...bundleInput,
          loadCurrent: async () => modelWithIntegrations(),
        }),
      ),
    ).current.active as {
      report: {
        integrations: {
          integration: string;
          presence: string;
          state: string;
          version: number | null;
        }[];
      };
    }
  ).report.integrations;
  assert.deepEqual(
    columns.map((row) => [
      row.integration,
      row.presence,
      row.state,
      row.version,
    ]),
    [
      ["context", "present", "supported", 1],
      ["rtk", "unknown", "supported", 1],
      ["ponytail", "absent", "unsupported", 1],
      ["caveman", "absent", "unavailable", null],
      ["lens", "present", "unavailable", null],
    ],
  );

  for (const fragment of [
    'tr("integration.detected")',
    'tr("integration.telemetry")',
    'tr("integration.activity")',
    'tr("integration.version")',
    'tr("integration.sessionTotal")',
    'tr("integration.reasonUnsupported")',
    'tr("integration.reasonMissing")',
    'tr("integration.noteNotDetected")',
  ]) {
    assert.equal(html.includes(fragment), true, fragment);
  }

  // The closed telemetry vocabulary and the non-state note, verbatim.
  assert.equal(
    ENGLISH_CATALOG["integration.reasonUnsupported"],
    "no compatible telemetry evidence",
  );
  assert.equal(
    ENGLISH_CATALOG["integration.reasonMissing"],
    "no telemetry observed in this session",
  );
  assert.equal(
    ENGLISH_CATALOG["integration.noteNotDetected"],
    "producer not detected in current inventory",
  );
  assert.equal(ENGLISH_CATALOG["integration.sessionTotal"], "Session total");
  assert.equal(ENGLISH_CATALOG["integration.detected"], "Detected");
  assert.equal(ENGLISH_CATALOG["integration.telemetry"], "Telemetry");
  assert.equal(ENGLISH_CATALOG["integration.activity"], "Activity");
  assert.equal(ENGLISH_CATALOG["integration.version"], "Version");
  assert.equal(ENGLISH_CATALOG["tab.environment"], "Environment");
});

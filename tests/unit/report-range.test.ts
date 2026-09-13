import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { reduceEntries } from "../../src/core/reduce.ts";
import { toSessionReport } from "../../src/core/reports.ts";
import type { SessionCoverage } from "../../src/core/session-coverage.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";
import {
  loadInspectorBundle,
  type InspectorBundle,
} from "../../src/ui/bundle.ts";
import {
  inlineModuleSource,
  renderInspectorBundle,
} from "../../src/ui/html.ts";
import {
  filterView,
  parseRangeQuery,
  resolveRange,
  type RangeState,
} from "../../src/ui/range.ts";
import {
  bundleInput,
  currentModelWithAgents,
  currentModelWithMixedToolUsage,
  currentModelWithOutOfOrderToolCalls,
  currentModelWithPartialToolUsage,
  currentModelWithTools,
  modelWithAbsentDetectedTelemetry,
  modelWithCounterOnlySkill,
  modelWithCounterOnlySkillAfterExpiry,
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
import { runClient, type StubElement } from "../helpers/client-harness.ts";

function bundleFixture(): InspectorBundle {
  return JSON.parse(
    readFileSync(
      new URL("../fixtures/bundles/inspector-bundle.json", import.meta.url),
      "utf8",
    ),
  ) as InspectorBundle;
}

test("tool usage stays on the call day while its error is observed the next day", () => {
  const entries = parseSessionJsonl(
    readFileSync("tests/fixtures/pi/0.85.1/cross-midnight.jsonl", "utf8"),
  ).entries;
  const report = toSessionReport(
    reduceEntries("cross-midnight-session", entries),
  );
  assert.deepEqual(
    [
      report.tools[0]?.timestamp,
      report.tools[0]?.usage?.totalTokens,
      report.errors[0]?.timestamp,
      report.errors[0]?.kind,
    ],
    ["2026-09-11T23:59:00.000Z", 2, "2026-09-12T00:01:00.000Z", "tool-error"],
  );
  const callDay = filterView(
    {
      rows: [],
      models: [],
      tools: report.tools,
      agents: [],
      errors: report.errors,
    },
    { preset: null, from: "2026-09-11", to: "2026-09-11" },
  );
  const nextDay = filterView(
    {
      rows: [],
      models: [],
      tools: report.tools,
      agents: [],
      errors: report.errors,
    },
    { preset: null, from: "2026-09-12", to: "2026-09-12" },
  );
  assert.deepEqual(
    [
      callDay.tools.length,
      callDay.errors.length,
      nextDay.tools.length,
      nextDay.errors.length,
    ],
    [1, 0, 0, 1],
  );
});

/**
 * The generated document must run the very function source the tests import,
 * with no module scope: the inlined block is evaluated standalone and then
 * exercised, so a `__name(...)` wrapper or a module-scope reference fails here
 * instead of silently in a browser.
 */
test("the inlined range module evaluates and runs with no module scope", () => {
  const source = inlineModuleSource();
  for (const fragment of [
    "const latestObservedDate=",
    "const resolveRange=",
    "const isInRange=",
    "const parseRangeQuery=",
    "const filterView=",
    "const historyRowRange=",
  ]) {
    assert.equal(source.includes(fragment), true, fragment);
  }
  // The document ships no helper it never calls: the range functions with no call
  // site in the emitted script are not inlined (`presetRange`'s preset math is
  // written inline in `resolveRange`, which the client does call — Task 14 review,
  // P2-3).
  for (const fragment of [
    "const shiftUtcDay=",
    "const serializeRangeQuery=",
    "const presetRange=",
  ]) {
    assert.equal(source.includes(fragment), false, fragment);
  }
  assert.equal(/__name\(/.test(source), false);

  // The evaluated block returns the same bindings the tests import, so every
  // expectation below is checked against the module's own result too.
  const evaluate = new Function(
    `${source}
return {filterView, parseRangeQuery, resolveRange};`,
  ) as () => {
    filterView: typeof filterView;
    parseRangeQuery: typeof parseRangeQuery;
    resolveRange: typeof resolveRange;
  };
  const inlined = evaluate();
  // A preset intent is the client's own path, and the inlined math is the module's:
  // same anchor date, same inclusive span.
  assert.deepEqual(
    inlined.resolveRange(
      { kind: "preset", preset: 7 },
      ["2026-09-11", "2026-09-12"],
      "current",
    ),
    { preset: 7, from: "2026-09-06", to: "2026-09-12" },
  );
  assert.deepEqual(
    inlined.parseRangeQuery("from=2026-09-01&to=2026-09-12"),
    parseRangeQuery("from=2026-09-01&to=2026-09-12"),
  );
  assert.deepEqual(
    inlined.resolveRange(undefined, ["2026-09-11"], "aggregate"),
    resolveRange(undefined, ["2026-09-11"], "aggregate"),
  );
  assert.deepEqual(
    inlined.resolveRange(
      { kind: "preset", preset: 30 },
      ["2026-09-11", "2026-09-12"],
      "current",
    ),
    resolveRange(
      { kind: "preset", preset: 30 },
      ["2026-09-11", "2026-09-12"],
      "current",
    ),
  );
  const range: RangeState = {
    preset: null,
    from: "2026-09-11",
    to: "2026-09-11",
  };
  const filtered = inlined.filterView(
    {
      rows: [],
      models: [],
      tools: [{ timestamp: "2026-09-11T23:59:00.000Z" }],
      agents: [],
      errors: [{ timestamp: "2026-09-12T00:01:00.000Z" }],
    },
    range,
  );
  assert.deepEqual([filtered.tools.length, filtered.errors.length], [1, 0]);
});

/**
 * The emitted client is one classic script: it must parse standalone, keep its
 * directive prologue first, and carry the range wiring the brief requires. No
 * test runs the DOM, so parsing is the guard against a broken client.
 */
test("the emitted client script parses and wires the one range", () => {
  const html = renderInspectorBundle(bundleFixture());
  const script =
    /<script>\n([\s\S]*)\n<\/script><\/body>/.exec(html)?.[1] ?? "";
  assert.equal(script.length > 0, true);
  assert.equal(script.startsWith('"use strict";'), true);
  new Function(script);
  for (const fragment of [
    "const rangeIntents=",
    "history:aggregate",
    "event.target.closest",
    'group:"member"',
    'group:"unknown"',
    // The one derivation resolves the active view's own intent, so the range and
    // every rendered value come from the same place (design §9.2).
    "deriveView(state,stateCapabilities(state),rangeDates())",
  ]) {
    assert.equal(script.includes(fragment), true, fragment);
  }
  assert.equal(/__name\(/.test(script), false);
  assert.equal(/Date\.now|Math\.random|new Date\(\)/.test(script), false);
});

test("the client renders every section and tab from the one active range", () => {
  const harness = runClient(bundleFixture());
  const { client, element, texts } = harness;
  const view = () => texts(element("view"));

  // The initial render is the fixture's tree scope over its whole span.
  assert.equal(client.state.section, "current");
  assert.equal(element("range-dates").textContent, "2026-02-01 → 2026-02-02");
  assert.equal(
    view().some((value) => value === "2026-02-01"),
    true,
  );
  assert.equal(view()[view().indexOf("Total tokens") + 1], "1,200");
  assert.equal(
    element("scope-sub").textContent,
    "All tracked branches in this session",
  );

  // A preset is anchored on this view's own latest observed date, not a clock.
  client.state.range = { kind: "preset", preset: 7 };
  client.render();
  assert.equal(element("range-dates").textContent, "2026-01-27 → 2026-02-02");

  // A custom single day narrows every range-filtered metric to that day.
  client.state.range = {
    kind: "custom",
    from: "2026-02-02",
    to: "2026-02-02",
  };
  client.render();
  assert.equal(element("range-dates").textContent, "2026-02-02 → 2026-02-02");
  const narrow = view();
  assert.equal(narrow[narrow.indexOf("Total tokens") + 1], "800");
  assert.equal(
    narrow.some((value) => value === "2026-02-01"),
    false,
  );
  assert.equal(
    narrow.some((value) => value === "2026-02-02"),
    true,
  );
  // The projected dated composition is the range's own fold: the selected day's
  // split stands on its own and is never labelled as all report dates.
  assert.deepEqual(
    narrow.filter((value) => value.startsWith("Generations, tool results")),
    [
      "Generations, tool results, compactions, and branch summaries are persisted native usage, counted once.",
    ],
  );
  // A payload without a dated composition keeps the session's own split, which
  // must then carry the all-report-dates label instead of passing as the range.
  const undated = bundleFixture();
  for (const currentView of [undated.current.active, undated.current.tree]) {
    for (const row of currentView.daily ?? []) {
      delete (row as { composition?: unknown }).composition;
    }
  }
  const legacy = runClient(undated);
  legacy.client.state.range = {
    kind: "custom",
    from: "2026-02-02",
    to: "2026-02-02",
  };
  legacy.client.render();
  assert.equal(
    legacy
      .texts(legacy.element("view"))
      .some(
        (value) =>
          value.startsWith("Generations, tool results") &&
          value.endsWith("All report dates"),
      ),
    true,
  );

  // The scope sub-label follows the pressed scope; the range survives it.
  client.state.scope = "active";
  client.render();
  assert.equal(
    element("scope-sub").textContent,
    "Selected entry and its parent ancestry",
  );
  assert.equal(element("range-dates").textContent, "2026-02-02 → 2026-02-02");

  // Every section and tab renders without a broken reference or a throw.
  // The preset buttons re-anchor this view's range on its own latest day.
  harness.preset("14");
  assert.equal(element("range-dates").textContent, "2026-01-20 → 2026-02-02");

  // The dialog refuses a missing or inverted pair, keeps no state change, and
  // never clamps: a range outside the observed data is accepted as it stands.
  element("date-from").value = "2026-02-05";
  element("date-to").value = "2026-02-01";
  harness.submit();
  assert.equal(
    element("date-error").textContent,
    "From must be on or before To.",
  );
  assert.equal(element("range-dates").textContent, "2026-01-20 → 2026-02-02");
  element("date-from").value = "";
  harness.submit();
  assert.equal(
    element("date-error").textContent,
    "From must be on or before To.",
  );
  assert.equal(element("range-dates").textContent, "2026-01-20 → 2026-02-02");
  element("date-from").value = "2020-01-01";
  element("date-to").value = "2020-12-31";
  harness.submit();
  assert.equal(element("range-dates").textContent, "2020-01-01 → 2020-12-31");
  const outside = view();
  assert.equal(
    outside.includes("No daily observations match the selected range."),
    true,
  );
  assert.equal(outside.includes("$0.00"), false);

  client.state.range = {
    kind: "custom",
    from: "2026-02-02",
    to: "2026-02-02",
  };
  client.render();

  for (const section of ["current", "history", "global"]) {
    for (const session of section === "history"
      ? [null, "session-a"]
      : [null]) {
      for (const tab of [
        "overview",
        "models",
        "tools",
        "commands",
        "agents",
        "skills",
        "integrations",
        "errors",
        "ledger",
      ]) {
        client.state.section = section;
        client.state.session = session;
        client.state.tab = tab;
        client.render();
      }
    }
  }
});

test("the client groups unattributable history rows and never shows them as zero", () => {
  const bundle = bundleFixture();
  const session = bundle.history.sessions[0];
  if (session?.availability !== "available") throw new Error("fixture session");
  session.usageByDate = [
    {
      date: "2029-06-21",
      totalTokens: 5,
      cost: 0.05,
      generations: 1,
      tools: 0,
      errors: 0,
      composition: {
        generations: { totalTokens: 5, cost: 0.05 },
        toolResults: { totalTokens: 0, cost: 0 },
        compactions: { totalTokens: 0, cost: 0 },
        branchSummaries: { totalTokens: 0, cost: 0 },
      },
    },
  ];
  session.usageByDateTruncated = true;
  const harness = runClient(bundle);
  const { client, element, texts } = harness;
  client.state.section = "history";
  client.state.session = null;
  client.state.tab = "overview";

  // A range entirely inside the omitted history is unknown, never a zero row.
  client.state.range = {
    kind: "custom",
    from: "2020-01-01",
    to: "2020-12-31",
  };
  client.render();
  const unknown = texts(element("view"));
  assert.equal(unknown.includes("Unavailable · dates unknown"), true);
  assert.equal(unknown.includes("$0.00"), false);
  assert.equal(element("range-truncated").hidden, false);
  assert.equal(
    element("range-truncated").textContent,
    "Older days beyond the retained window are not shown.",
  );

  // A range that reaches before the retained window is in range and Known.
  client.state.range = {
    kind: "custom",
    from: "2020-01-01",
    to: "2029-06-21",
  };
  client.render();
  const partial = texts(element("view"));
  assert.equal(partial.includes("Known tokens"), true);
  assert.equal(partial.includes("Known native cost"), true);
  assert.equal(partial.includes("Unavailable · dates unknown"), true);
});

test("the same-projection note follows the bundle flag and the active view", () => {
  const off = runClient(bundleFixture());
  assert.equal(off.element("scope").parentNode?.children.length, 0);

  const bundle = bundleFixture();
  bundle.current.sameReportProjection = true;
  const on = runClient(bundle);
  const scopeGroup = on.element("scope").parentNode as StubElement;
  const note = scopeGroup.children.find((child) => child.id === "scope-same");
  assert.equal(
    note?.textContent,
    "Active path and Full session tree produce the same report data for this session.",
  );
});

test("an aggregate range with no in-range observation renders the empty state", () => {
  const harness = runClient(bundleFixture());
  const { client, element, texts } = harness;
  const outside = { kind: "custom", from: "2020-01-01", to: "2020-12-31" };

  client.state.range = outside;
  client.state.section = "global";
  client.state.tab = "overview";
  client.render();
  const global = texts(element("view"));
  assert.equal(
    global.includes("No daily observations match the selected range."),
    true,
  );
  // Neither a fabricated $0.00 nor a fabricated zero metric.
  assert.equal(global.includes("$0.00"), false);
  assert.equal(global.includes("0"), false);
  assert.equal(global.includes("Observed days"), false);

  client.state.range = outside;
  client.state.section = "history";
  client.state.session = null;
  client.render();
  const history = texts(element("view"));
  assert.equal(
    history.includes("No daily observations match the selected range."),
    true,
  );
  assert.equal(history.includes("$0.00"), false);
  assert.equal(history.includes("0"), false);
  assert.equal(history.includes("Known tokens"), false);
  assert.equal(history.includes("Known native cost"), false);
});

test("a truncated session outside the range still qualifies the aggregate as Known", () => {
  const bundle = bundleFixture();
  const template = bundle.history.sessions[0];
  if (template?.availability !== "available")
    throw new Error("fixture session");
  // Two replayed sessions: one in range, one whose retained window is later and
  // truncated, so the aggregate is fully covered yet cannot reach the range.
  bundle.history.sessions = [
    template,
    {
      ...template,
      sessionId: "session-c",
      usageByDate: [
        {
          date: "2029-06-21",
          totalTokens: 5,
          cost: 0.05,
          generations: 1,
          tools: 0,
          errors: 0,
          composition: {
            generations: { totalTokens: 5, cost: 0.05 },
            toolResults: { totalTokens: 0, cost: 0 },
            compactions: { totalTokens: 0, cost: 0 },
            branchSummaries: { totalTokens: 0, cost: 0 },
          },
        },
      ],
      usageByDateTruncated: true,
    },
  ];
  bundle.history.coverage = {
    inspected: 2,
    available: 2,
    unavailable: 0,
    sessionRatio: 1,
    complete: true,
    discoveryLimited: false,
    reasons: {},
  };
  const harness = runClient(bundle);
  const { client, element, texts } = harness;
  client.state.section = "history";
  client.state.session = null;
  client.state.tab = "overview";

  // The range is inside session-a's retained window and entirely before
  // session-c's: the aggregate value is still only Known, and the excluded
  // session contributes nothing to the in-range sums.
  client.state.range = {
    kind: "custom",
    from: "2026-02-01",
    to: "2026-02-02",
  };
  client.render();
  const outside = texts(element("view"));
  assert.equal(outside.includes("Known native cost"), true);
  assert.equal(outside.includes("Known tokens"), true);
  assert.equal(outside.includes("$0.24"), true);
  assert.equal(outside.includes("$0.05"), false);

  // A range inside that session's own retained window is not partial.
  client.state.range = {
    kind: "custom",
    from: "2029-06-21",
    to: "2029-06-21",
  };
  client.render();
  const inside = texts(element("view"));
  assert.equal(inside.includes("Known native cost"), false);
  assert.equal(inside.includes("Known tokens"), false);
  assert.equal(inside.includes("$0.05"), true);
});

test("scope copy renders the fixed note once, next to the disabled control", () => {
  const harness = runClient(bundleFixture());
  const { client, element, texts } = harness;
  const fixed = "History & Global use full tree.";

  client.state.section = "history";
  client.render();
  assert.equal(element("scope-fixed").hidden, false);
  assert.equal(element("scope-sub").textContent, "");
  assert.equal(element("scope-note").textContent, "2026-01-20 → 2026-02-02");
  const scopeGroup = element("scope").parentNode as StubElement;
  assert.equal(texts(scopeGroup).includes(fixed), false);

  client.state.section = "global";
  client.render();
  assert.equal(element("scope-fixed").hidden, false);
  assert.equal(element("scope-sub").textContent, "");
  assert.equal(element("scope-note").textContent.includes(fixed), false);

  // The current section keeps the pressed scope's own sub-label.
  client.state.section = "current";
  client.render();
  assert.equal(element("scope-fixed").hidden, true);
  assert.equal(
    element("scope-sub").textContent,
    "All tracked branches in this session",
  );
});

test("the current truncation notice fires only for a range inside the retained window", () => {
  const bundle = bundleFixture();
  bundle.current.tree.dailyTruncated = true;
  const harness = runClient(bundle);
  const { client, element } = harness;
  client.state.section = "current";

  // The default range is the retained window itself: nothing is being omitted.
  client.render();
  assert.equal(element("range-dates").textContent, "2026-02-01 → 2026-02-02");
  assert.equal(element("range-truncated").hidden, true);

  // A range reaching before the retained window is flagged.
  client.state.range = {
    kind: "custom",
    from: "2020-01-01",
    to: "2020-12-31",
  };
  client.render();
  assert.equal(element("range-truncated").hidden, false);
  assert.equal(
    element("range-truncated").textContent,
    "Older days beyond the retained window are not shown.",
  );
});

test("the restore notice fires only when a range could fall back to a default", () => {
  // A view with no observed date has no default range to fall back to.
  const unobserved = bundleFixture();
  unobserved.current.tree.daily = [];
  unobserved.current.tree.dailyTruncated = true;
  const withoutDates = runClient(unobserved);
  withoutDates.client.state.range = { kind: "preset", preset: 7 };
  withoutDates.client.render();
  assert.equal(withoutDates.element("range-name").textContent, "Unavailable");
  assert.equal(withoutDates.element("range-dates").textContent, "Unavailable");
  assert.equal(withoutDates.element("range-truncated").hidden, true);

  // A view with observed dates still says when the chosen range did not apply.
  const withDates = runClient(bundleFixture());
  withDates.client.state.range = {
    kind: "custom",
    from: "2026-02-05",
    to: "2026-02-01",
  };
  withDates.client.render();
  assert.equal(withDates.element("range-name").textContent, "Unavailable");
  assert.equal(withDates.element("range-truncated").hidden, false);
  assert.equal(
    withDates.element("range-truncated").textContent,
    "Range could not be restored; showing the default range.",
  );
});

/**
 * The fixture bundle predates the dated model projection, so this builds the
 * tree view a real bundle carries: three model days inside a 14-day span and
 * only two inside a 7-day one.
 */
function datedTreeBundle(): InspectorBundle {
  const bundle = bundleFixture();
  const trees = bundle.current.tree;
  trees.daily = ["2026-01-20", "2026-01-27", "2026-02-02"].map((date) => ({
    date,
    sessions: 1,
    totalTokens:
      date === "2026-01-20" ? 100 : date === "2026-01-27" ? 200 : 800,
    cost: date === "2026-01-20" ? 0.01 : date === "2026-01-27" ? 0.02 : 0.16,
    generations: 1,
    tools: 1,
    composition: {
      generations: {
        totalTokens:
          date === "2026-01-20" ? 100 : date === "2026-01-27" ? 200 : 800,
        cost:
          date === "2026-01-20" ? 0.01 : date === "2026-01-27" ? 0.02 : 0.16,
      },
      toolResults: { totalTokens: 0, cost: 0 },
      compactions: { totalTokens: 0, cost: 0 },
      branchSummaries: { totalTokens: 0, cost: 0 },
    },
  }));
  trees.datedModels = [
    {
      date: "2026-01-20",
      provider: "acme",
      model: "legacy",
      generations: 1,
      totalTokens: 100,
      cost: 0.01,
    },
    {
      date: "2026-01-27",
      provider: "acme",
      model: "alpha",
      generations: 1,
      totalTokens: 200,
      cost: 0.02,
    },
    {
      date: "2026-02-02",
      provider: "acme",
      model: "beta",
      generations: 1,
      totalTokens: 800,
      cost: 0.16,
    },
  ];
  trees.modelsTruncated = false;
  return bundle;
}

/** True when any rendered text node contains the fragment. */
function has(values: string[], fragment: string): boolean {
  return values.some((value) => value.includes(fragment));
}

/** Every node whose own text is exactly the value, so it can be located in the tree. */
function nodesWithText(view: StubElement, value: string): StubElement[] {
  const found: StubElement[] = [];
  const walk = (node: StubElement): void => {
    if (node.textContent === value) found.push(node);
    for (const child of node.children) walk(child);
  };
  walk(view);
  return found;
}

/** The rendered entity anchors naming one entity kind, in document order. */
function anchorsWith(view: StubElement, kind: string): StubElement[] {
  return view
    .querySelectorAll("a")
    .filter((node) => (node.dataset.entity ?? "").startsWith(`${kind}:`));
}

/**
 * One rendered card, found by the title its heading renders. The tools panel is
 * two cards over one projection, so an assertion about the summary must not
 * read the calls timeline's texts and vice versa.
 */
function cardOf(
  view: StubElement,
  texts: (node: StubElement) => string[],
  title: string,
): StubElement {
  const found = view
    .querySelectorAll("section")
    .find((node) => has(texts(node), title));
  if (found === undefined) throw new Error(`no rendered card titled ${title}`);
  return found;
}

/** The cells of one model row, counted from its model name. */
function modelCells(values: string[], model: string, count = 3): string[] {
  const at = values.indexOf(model);
  return at < 0 ? [] : values.slice(at + 1, at + 1 + count);
}

test("the current Models tab renders the dated rows in range, not the aggregate", () => {
  const harness = runClient(datedTreeBundle());
  const { client, element, texts } = harness;
  client.state.section = "current";
  client.state.tab = "models";

  // 7D anchors on this view's latest observed day, so the older model day drops.
  client.state.range = { kind: "preset", preset: 7 };
  client.render();
  assert.equal(element("range-dates").textContent, "2026-01-27 → 2026-02-02");
  const seven = texts(element("view"));
  assert.deepEqual(modelCells(seven, "alpha"), ["1", "200", "$0.02"]);
  assert.deepEqual(modelCells(seven, "beta"), ["1", "800", "$0.16"]);
  assert.deepEqual(modelCells(seven, "legacy"), []);
  assert.equal(has(seven, "All report dates"), false);

  // 14D reaches the older day, so the same tab shows one more model row.
  client.state.range = { kind: "preset", preset: 14 };
  client.render();
  assert.equal(element("range-dates").textContent, "2026-01-20 → 2026-02-02");
  const fourteen = texts(element("view"));
  assert.deepEqual(modelCells(fourteen, "legacy"), ["1", "100", "$0.01"]);
  assert.notDeepEqual(fourteen, seven);
});

test("the current Models tab stays range-scoped and never falls back to an aggregate", () => {
  const harness = runClient(datedTreeBundle());
  const { client, element, texts } = harness;
  client.state.section = "current";
  client.state.tab = "models";

  // The default range is the whole observed span: every dated row is in range.
  client.render();
  const whole = texts(element("view"));
  assert.deepEqual(modelCells(whole, "legacy"), ["1", "100", "$0.01"]);
  assert.equal(has(whole, "All report dates"), false);
  assert.equal(has(whole, "No native generations recorded."), false);

  // A range with no in-range model day is a range statement, never the
  // session-wide "no generations" card and never the aggregate rows.
  client.state.range = {
    kind: "custom",
    from: "2020-01-01",
    to: "2020-12-31",
  };
  client.render();
  const outside = texts(element("view"));
  assert.equal(
    has(outside, "No daily observations match the selected range."),
    true,
  );
  assert.equal(has(outside, "No native generations recorded."), false);
  assert.equal(has(outside, "All report dates"), false);
  assert.equal(has(outside, "acme"), false);

  // A capped dated source says so instead of passing as complete.
  const truncated = datedTreeBundle();
  truncated.current.tree.modelsTruncated = true;
  const capped = runClient(truncated);
  capped.client.state.section = "current";
  capped.client.state.tab = "models";
  capped.client.render();
  assert.equal(
    has(
      capped.texts(capped.element("view")),
      "Older dates' model rows beyond the retained window are not shown.",
    ),
    true,
  );
});

/**
 * The fixture with every dated model projection removed: the payload shape a
 * pre-Task-8 generator and the legacy single-section adapter emit.
 */
function undatedBundleFixture(): InspectorBundle {
  const bundle = bundleFixture();
  for (const view of [bundle.current.active, bundle.current.tree]) {
    delete view.datedModels;
    delete view.modelsTruncated;
  }
  for (const session of bundle.history.sessions) {
    if (session.availability !== "available") continue;
    const legacy = session as {
      datedModels?: unknown;
      modelsTruncated?: unknown;
    };
    delete legacy.datedModels;
    delete legacy.modelsTruncated;
  }
  return bundle;
}

test("a history session detail ranges its own dated models like the current view", () => {
  const harness = runClient(bundleFixture());
  const { client, element, texts } = harness;
  client.state.section = "history";
  client.state.session = "session-a";
  client.state.tab = "models";

  // A history session carries its own dated model rows (R13), so the selected
  // day's figures stand on their own rather than as an all-report-dates table.
  client.state.range = {
    kind: "custom",
    from: "2026-02-02",
    to: "2026-02-02",
  };
  client.render();
  const day = texts(element("view"));
  assert.equal(has(day, "All report dates"), false);
  assert.deepEqual(modelCells(day, "alpha"), ["1", "600", "$0.12"]);

  // A range with no dated model day is a range statement, never the aggregate
  // rows and never a fabricated zero.
  client.state.range = {
    kind: "custom",
    from: "2020-01-01",
    to: "2020-12-31",
  };
  client.render();
  const outside = texts(element("view"));
  assert.equal(
    has(outside, "No daily observations match the selected range."),
    true,
  );
  assert.equal(has(outside, "acme"), false);
});

test("a payload without the dated projection keeps the aggregate model table labelled", () => {
  // No dated model rows at all (the legacy adapter's shape), so the table is
  // the aggregate one, labelled, and it is never emptied by the range.
  const harness = runClient(undatedBundleFixture());
  const { client, element, texts } = harness;
  client.state.section = "history";
  client.state.session = "session-a";
  client.state.tab = "models";
  client.state.range = {
    kind: "custom",
    from: "2020-01-01",
    to: "2020-12-31",
  };
  client.render();
  const values = texts(element("view"));
  assert.equal(has(values, "All report dates"), true);
  assert.deepEqual(modelCells(values, "alpha", 7), [
    "2",
    "Unavailable",
    "Unavailable",
    "Unavailable",
    "Unavailable",
    "1,000",
    "$0.20",
  ]);
  assert.equal(has(values, "No native generations recorded."), false);
  assert.equal(
    has(values, "No daily observations match the selected range."),
    false,
  );

  // A current view without a dated projection keeps the same aggregate table,
  // and the range never empties it either.
  const legacy = runClient(undatedBundleFixture());
  legacy.client.state.section = "current";
  legacy.client.state.tab = "models";
  legacy.client.state.range = {
    kind: "custom",
    from: "2020-01-01",
    to: "2020-12-31",
  };
  legacy.client.render();
  const aggregate = legacy.texts(legacy.element("view"));
  assert.equal(has(aggregate, "All report dates"), true);
  assert.deepEqual(modelCells(aggregate, "alpha", 7), [
    "2",
    "800",
    "150",
    "40",
    "10",
    "1,000",
    "$0.20",
  ]);
  assert.equal(has(aggregate, "No native generations recorded."), false);
});

test("range-scoped empty tabs carry the range-qualified line", () => {
  const harness = runClient(bundleFixture());
  const { client, element, texts } = harness;
  client.state.section = "current";
  client.state.range = {
    kind: "custom",
    from: "2020-01-01",
    to: "2020-12-31",
  };

  // The fixture's Errors tab is range-filtered (the rows carry a timestamp), so
  // an empty range is a range statement, not a session-wide one.
  client.state.tab = "errors";
  client.render();
  const errors = texts(element("view"));
  assert.equal(
    errors.includes("No daily observations match the selected range."),
    true,
  );
  assert.equal(
    errors.includes("No persisted error records. An observed zero stays zero."),
    false,
  );
});

test("the Errors tab leads with the failed tool's identity and keeps its record id in the details", async () => {
  const harness = runClient(
    await loadInspectorBundle({
      ...bundleInput,
      loadCurrent: async () => modelWithToolError(),
    }),
  );
  const { client, element, texts } = harness;
  client.state.tab = "errors";
  client.render();
  const view = element("view");
  const rendered = texts(view);

  // The headline is the joined tool, with the bounded classification and the
  // persisted time beside it.
  assert.equal(rendered.includes("bash failed"), true);
  assert.equal(rendered.includes("tool-error"), true);
  assert.equal(rendered.includes("2026-02-02T00:01:00.000Z"), true);
  // A tool error has no safe structured message at all, so the row states
  // Unavailable rather than text from `content`, arguments, or child output.
  assert.equal(rendered.includes("Message"), true);
  assert.equal(rendered.includes("Unavailable"), true);

  // The internal `tool:call_…` id is rendered once and only inside the row's
  // details panel, never as a column's own value.
  const ids = nodesWithText(view, "tool:call_bash");
  assert.equal(ids.length, 1);
  assert.notEqual(ids[0]?.closest("details"), null);
  // No child run published through this call, so the section is omitted
  // entirely: never padded, never inferred from a timestamp.
  assert.equal(rendered.includes("Related child run(s)"), false);
});

test("the Errors tab lists every related child run and names none as the cause", async () => {
  const harness = runClient(
    await loadInspectorBundle({
      ...bundleInput,
      loadCurrent: async () => modelWithErrorAndThreeChildren(),
    }),
  );
  const { client, element, texts } = harness;
  client.state.tab = "errors";
  client.render();
  const view = element("view");

  // One anchor per candidate, labelled with that candidate's own role: the
  // relation is one-to-many and no candidate is named as the cause. Each anchor
  // is a Task 15 entity link, so following it lands on that run's own row.
  assert.equal(texts(view).includes("Related child run(s)"), true);
  assert.deepEqual(
    anchorsWith(view, "agent").map((anchor) => anchor.textContent),
    ["reviewer", "researcher", "validator"],
  );
  assert.equal(has(texts(view), "caused by"), false);
  assert.equal(has(texts(view), "cause of"), false);
  // The tool-call reference is an entity link to the call it joins: the route it
  // carries names the call's canonical id, so the join is not re-derived.
  assert.deepEqual(
    anchorsWith(view, "tool").map((anchor) => [
      anchor.textContent,
      anchor.dataset.entity,
    ]),
    [["bash", "tool:tool:call_bash"]],
  );

  // A candidate whose run carries no role is labelled Unavailable: a role is
  // never invented and the raw run id is never rendered as the label.
  const roleless = runClient(
    await loadInspectorBundle({
      ...bundleInput,
      loadCurrent: async () => modelWithToolErrorAndTwoChildren(),
    }),
  );
  roleless.client.state.tab = "errors";
  roleless.client.render();
  assert.deepEqual(
    anchorsWith(roleless.element("view"), "agent").map(
      (anchor) => anchor.textContent,
    ),
    ["Unavailable", "Unavailable"],
  );
});

test("a generation error renders its bounded message and Unavailable without one", async () => {
  const kept = runClient(
    await loadInspectorBundle({
      ...bundleInput,
      loadCurrent: async () =>
        modelWithGenerationError("Request failed at [URL]"),
    }),
  );
  kept.client.state.tab = "errors";
  kept.client.render();
  const rendered = kept.texts(kept.element("view"));
  assert.equal(rendered.includes("Request failed at [URL]"), true);
  // The generation error has no tool to lead with, so its bounded
  // classification family is the headline and the exact kind stays beside it.
  assert.equal(rendered.includes("Generation error"), true);
  assert.equal(rendered.includes("generation-error"), true);
  assert.equal(
    kept.texts(kept.element("view")).includes("Related tool"),
    false,
  );
  assert.equal(
    kept.texts(kept.element("view")).includes("Related child run(s)"),
    false,
  );

  // The same scenario with no usable persisted message says Unavailable.
  const silent = runClient(
    await loadInspectorBundle({
      ...bundleInput,
      loadCurrent: async () => modelWithGenerationError(),
    }),
  );
  silent.client.state.tab = "errors";
  silent.client.render();
  const silentTexts = silent.texts(silent.element("view"));
  assert.equal(silentTexts.includes("Request failed at [URL]"), false);
  assert.equal(silentTexts.includes("generation-error"), true);
  assert.equal(silentTexts.includes("Unavailable"), true);
});

test("the Tools and Agents tabs filter their canonical rows and drop the label in range", () => {
  const bundle = bundleFixture();
  const report = bundle.current.tree.report;
  if (report === undefined) throw new Error("the fixture tree report");
  report.agents[0].observedAt = "2026-02-02T11:00:00.000Z";
  const harness = runClient(bundle);
  const { client, element, texts } = harness;
  client.state.section = "current";

  // The default range is the whole observed span, so both calls and the observed
  // run are in range: the tables are range rows, not "all report dates" rows.
  client.state.tab = "tools";
  client.render();
  const whole = texts(element("view"));
  assert.equal(whole.includes("read"), true);
  assert.equal(whole.includes("bash"), true);
  assert.equal(has(whole, "All report dates"), false);

  // Only the call made on the selected day survives the filter.
  client.state.range = {
    kind: "custom",
    from: "2026-02-02",
    to: "2026-02-02",
  };
  client.render();
  const day = texts(element("view"));
  assert.equal(day.includes("read"), true);
  assert.equal(day.includes("bash"), false);

  // A range with no in-range call is a range statement, never the session-wide
  // "no native calls" card and never the labelled aggregate rows.
  client.state.range = {
    kind: "custom",
    from: "2020-01-01",
    to: "2020-12-31",
  };
  client.render();
  const outside = texts(element("view"));
  assert.equal(
    outside.includes("No daily observations match the selected range."),
    true,
  );
  assert.equal(outside.includes("No native tool calls recorded."), false);
  assert.equal(has(outside, "All report dates"), false);

  // The Agents tab filters AgentRow.observedAt through the same one filter: the
  // fixture's run is observed on the selected day, so its summary and its row
  // render for that day and neither renders for a range it cannot be placed in.
  client.state.tab = "agents";
  client.state.range = {
    kind: "custom",
    from: "2026-02-02",
    to: "2026-02-02",
  };
  client.render();
  const observed = texts(element("view"));
  assert.equal(observed.includes("Child runs"), true);
  assert.equal(observed.includes("1 of 1 runs reported usage"), true);
  client.state.range = {
    kind: "custom",
    from: "2020-01-01",
    to: "2020-12-31",
  };
  client.render();
  const unknown = texts(element("view"));
  assert.equal(unknown.includes("Child runs"), false);
  assert.equal(unknown.includes("1 of 1 runs reported usage"), false);
  // The undated/out-of-range cause is stated, never blamed on a daily data gap.
  assert.equal(
    unknown.includes("No child run falls inside the selected range."),
    true,
  );
  assert.equal(
    unknown.includes("No daily observations match the selected range."),
    false,
  );
});

test("a Tools summary row narrows the calls timeline and the clear control restores it", () => {
  const harness = runClient(bundleFixture());
  const { client, element, texts } = harness;
  client.state.section = "current";
  client.state.tab = "tools";
  client.render();

  // Both persisted calls are inside the default range: the timeline lists the
  // whole call set before any filter is chosen.
  const calls = (): StubElement =>
    cardOf(element("view"), texts, "Calls timeline");
  assert.equal(has(texts(calls()), "read"), true);
  assert.equal(has(texts(calls()), "bash"), true);

  // The summary row's own name is the anchor: selecting `bash` narrows the
  // timeline to that tool's calls and states which filter is active.
  const anchor = cardOf(element("view"), texts, "Tools summary")
    .querySelectorAll("button")
    .find((button) => button.dataset.toolFilter === "bash");
  if (anchor === undefined) throw new Error("no bash filter anchor");
  harness.click(anchor);
  const filtered = texts(calls());
  assert.equal(has(filtered, "bash"), true);
  assert.equal(has(filtered, "read"), false);
  assert.equal(has(filtered, "Filtered by bash"), true);

  // The clear control returns this view's whole call list, so the filter is a
  // state a reader can always leave.
  const clear = calls()
    .querySelectorAll("button")
    .find((button) => button.dataset.clearFilter !== undefined);
  if (clear === undefined) throw new Error("no clear-filter control");
  harness.click(clear);
  const restored = texts(calls());
  assert.equal(has(restored, "read"), true);
  assert.equal(has(restored, "bash"), true);
  assert.equal(has(restored, "Filtered by"), false);
});

test("the rendered tools panel states the partial row's own usage sentence", async () => {
  const harness = runClient(
    await loadInspectorBundle({
      ...bundleInput,
      loadCurrent: async () => currentModelWithPartialToolUsage(),
    }),
  );
  harness.client.state.tab = "tools";
  harness.client.render();

  // The sentence sits on the row whose calls were partial, in the cell carrying
  // the Known value — not only in the panel's own metric note.
  const summary = cardOf(
    harness.element("view"),
    harness.texts,
    "Tools summary",
  );
  const tokensCell = summary
    .querySelectorAll("td")
    .find((cell) => has(harness.texts(cell), "180"));
  if (tokensCell === undefined) throw new Error("no rendered tokens cell");
  assert.equal(
    has(harness.texts(tokensCell), "1 of 3 calls reported usage"),
    true,
  );
  assert.equal(has(harness.texts(tokensCell), "Known tokens"), true);
});

test("a partial tool row states its own fraction, never the panel's aggregate", async () => {
  const harness = runClient(
    await loadInspectorBundle({
      ...bundleInput,
      loadCurrent: async () => currentModelWithMixedToolUsage(),
    }),
  );
  harness.client.state.tab = "tools";
  harness.client.render();
  const summary = cardOf(
    harness.element("view"),
    harness.texts,
    "Tools summary",
  );
  // `read` reported usage once in three calls while `bash` reported it in its
  // only call, so the panel groups four calls with two reporting: the panel's
  // sentence cannot be read as the partial row's.
  assert.equal(
    has(harness.texts(summary), "2 of 4 calls reported usage"),
    true,
  );
  const readCell = summary
    .querySelectorAll("td")
    .find((cell) => has(harness.texts(cell), "180"));
  if (readCell === undefined) throw new Error("no rendered read tokens cell");
  assert.equal(
    has(harness.texts(readCell), "1 of 3 calls reported usage"),
    true,
  );
});

test("the tools panel states no usage fraction while no row is partial", async () => {
  const harness = runClient(
    await loadInspectorBundle({
      ...bundleInput,
      loadCurrent: async () => currentModelWithTools(),
    }),
  );
  harness.client.state.tab = "tools";
  harness.client.render();
  const summary = cardOf(
    harness.element("view"),
    harness.texts,
    "Tools summary",
  );
  const rendered = harness.texts(summary);
  // `read`'s only call reported usage while `bash` reported none at all, so no
  // row is partial: the unknown side is Unavailable and the Known totals carry
  // no fraction sentence anywhere in the card.
  assert.equal(has(harness.texts(summary), "bash"), true);
  assert.equal(
    /[0-9]+ of [0-9]+ calls reported usage/.test(rendered.join(" ")),
    false,
  );
});

test("a history session detail filters its dated model rows like the current section", () => {
  const bundle = bundleFixture();
  const session = bundle.history.sessions[0];
  if (session?.availability !== "available") {
    throw new Error("the fixture's first history session");
  }
  session.datedModels = [
    {
      date: "2026-01-20",
      provider: "acme",
      model: "legacy",
      generations: 1,
      totalTokens: 100,
      cost: 0.01,
    },
    {
      date: "2026-01-27",
      provider: "acme",
      model: "alpha",
      generations: 1,
      totalTokens: 200,
      cost: 0.02,
    },
    {
      date: "2026-02-02",
      provider: "acme",
      model: "beta",
      generations: 1,
      totalTokens: 800,
      cost: 0.16,
    },
  ];
  session.modelsTruncated = false;
  const harness = runClient(bundle);
  const { client, element, texts } = harness;
  client.state.section = "history";
  client.state.session = "session-a";
  client.state.tab = "models";

  // 7D anchors on this session's own latest observed day, so the older row drops.
  client.state.range = { kind: "preset", preset: 7 };
  client.render();
  assert.equal(element("range-dates").textContent, "2026-01-27 → 2026-02-02");
  const seven = texts(element("view"));
  assert.deepEqual(modelCells(seven, "alpha"), ["1", "200", "$0.02"]);
  assert.deepEqual(modelCells(seven, "beta"), ["1", "800", "$0.16"]);
  assert.deepEqual(modelCells(seven, "legacy"), []);
  assert.equal(has(seven, "All report dates"), false);

  // 14D reaches the older day, so the same detail shows one more model row.
  client.state.range = { kind: "preset", preset: 14 };
  client.render();
  assert.equal(element("range-dates").textContent, "2026-01-20 → 2026-02-02");
  assert.deepEqual(modelCells(texts(element("view")), "legacy"), [
    "1",
    "100",
    "$0.01",
  ]);

  // The range never falls back to the aggregate rows of the same session detail.
  client.state.range = {
    kind: "custom",
    from: "2020-01-01",
    to: "2020-12-31",
  };
  client.render();
  const outside = texts(element("view"));
  assert.equal(
    has(outside, "No daily observations match the selected range."),
    true,
  );
  assert.equal(has(outside, "All report dates"), false);
  assert.equal(has(outside, "acme"), false);
});

test("a dated model source with no rows is Unavailable, never a range statement", () => {
  // An unattributable dated window: daily observations exist, no model row can
  // be attributed to a date. That is the honest Unavailable state.
  const bundle = datedTreeBundle();
  bundle.current.tree.datedModels = [];
  const harness = runClient(bundle);
  const { client, element, texts } = harness;
  client.state.section = "current";
  client.state.tab = "models";
  client.render();
  const current = texts(element("view"));
  assert.equal(has(current, "No native generations recorded."), true);
  assert.equal(has(current, "Unavailable"), true);
  assert.equal(
    has(current, "No daily observations match the selected range."),
    false,
  );
  assert.equal(has(current, "All report dates"), false);
  assert.equal(has(current, "acme"), false);

  // The same rule holds for a history session detail's dated source.
  const history = bundleFixture();
  const session = history.history.sessions[0];
  if (session?.availability !== "available") {
    throw new Error("the fixture's first history session");
  }
  session.datedModels = [];
  session.modelsTruncated = false;
  const detail = runClient(history);
  detail.client.state.section = "history";
  detail.client.state.session = "session-a";
  detail.client.state.tab = "models";
  detail.client.render();
  const values = detail.texts(detail.element("view"));
  assert.equal(has(values, "No native generations recorded."), true);
  assert.equal(
    has(values, "No daily observations match the selected range."),
    false,
  );
  assert.equal(has(values, "All report dates"), false);
});

test("the global truncation notice fires only for a range before the retained window", () => {
  const bundle = bundleFixture();
  const partial = bundle.global.sessions[0];
  if (partial?.availability !== "available") {
    throw new Error("the fixture's first global session");
  }
  partial.usageByDateTruncated = true;
  // The server renders the notice for a capped initial view; the client owns it
  // from then on, exactly as for the current and history sections.
  bundle.current.tree.dailyTruncated = true;
  const harness = runClient(bundle);
  const { client, element } = harness;
  client.state.section = "global";
  client.state.tab = "overview";

  // The default 14-day range starts before the oldest retained day, so the
  // aggregate is flagged as partial.
  client.render();
  assert.equal(element("range-dates").textContent, "2026-01-20 → 2026-02-02");
  assert.equal(element("range-truncated").hidden, false);

  // A range inside the retained window is not reaching before it: no notice.
  client.state.range = {
    kind: "custom",
    from: "2026-02-01",
    to: "2026-02-02",
  };
  client.render();
  assert.equal(element("range-truncated").hidden, true);

  // A range reaching before it is flagged again, with the one bounded sentence.
  client.state.range = {
    kind: "custom",
    from: "2020-01-01",
    to: "2020-12-31",
  };
  client.render();
  assert.equal(element("range-truncated").hidden, false);
  assert.equal(
    element("range-truncated").textContent,
    "Older days beyond the retained window are not shown.",
  );
});

test("a complete-coverage global headline qualifies a range before the retained window", () => {
  const bundle = bundleFixture();
  const partial = bundle.global.sessions[0];
  if (partial?.availability !== "available") {
    throw new Error("the fixture's first global session");
  }
  partial.usageByDateTruncated = true;
  // Coverage is complete, so the range's own verdict is the only qualifier the
  // headline can read: every tracked session replayed.
  bundle.global.coverage = {
    inspected: 2,
    available: 2,
    unavailable: 0,
    sessionRatio: 1,
    complete: true,
    discoveryLimited: false,
    reasons: {},
  };
  const harness = runClient(bundle);
  const { client, element, texts } = harness;
  client.state.section = "global";
  client.state.tab = "overview";

  // The range reaches before the retained window, so the aggregate cannot
  // represent the spend: the headline is Known, never Total (design §5.6).
  client.state.range = {
    kind: "custom",
    from: "2020-01-01",
    to: "2026-02-02",
  };
  client.render();
  const reached = texts(element("view"));
  assert.equal(reached.includes("Known tokens"), true);
  assert.equal(reached.includes("Known native cost"), true);
  assert.equal(reached.includes("Total tokens"), false);
  assert.equal(reached.includes("Native cost"), false);

  // A range inside the retained window is exact, so the same headline stays
  // unqualified even though a tracked session is truncated.
  client.state.range = {
    kind: "custom",
    from: "2026-02-01",
    to: "2026-02-02",
  };
  client.render();
  const inside = texts(element("view"));
  assert.equal(inside.includes("Total tokens"), true);
  assert.equal(inside.includes("Native cost"), true);
  assert.equal(inside.includes("Known tokens"), false);
  assert.equal(inside.includes("Known native cost"), false);
});

test("an agent row resolves its parent to one of the three verdicts", async () => {
  const orphan = await loadInspectorBundle({
    ...bundleInput,
    initialScope: "active",
    loadCurrent: async (scope) =>
      scope === "active"
        ? modelWithOrphanChild()
        : modelWithOrphanChildAndParent(),
  });
  const orphanHarness = runClient(orphan);
  orphanHarness.client.state.tab = "agents";
  orphanHarness.client.render();
  const outsider = orphanHarness.texts(orphanHarness.element("view"));
  // The parent is known to the session but excluded from this projection: it is
  // labelled, and no id is shown for it.
  assert.equal(outsider.includes("Parent: outside selected scope"), true);
  assert.equal(outsider.includes("reviewer"), false);

  // The same projection without the parent anywhere is the unknown verdict.
  const unknown = await loadInspectorBundle({
    ...bundleInput,
    loadCurrent: async () => modelWithOrphanChild(),
  });
  const unknownHarness = runClient(unknown);
  unknownHarness.client.state.tab = "agents";
  unknownHarness.client.render();
  assert.equal(
    unknownHarness
      .texts(unknownHarness.element("view"))
      .includes("Parent: Unavailable"),
    true,
  );

  // Both runs in the same projection: the parent is in scope, so the parent cell
  // names its role instead of a verdict.
  const both = await loadInspectorBundle({
    ...bundleInput,
    loadCurrent: async () => modelWithOrphanChildAndParent(),
  });
  const bothHarness = runClient(both);
  bothHarness.client.state.tab = "agents";
  bothHarness.client.render();
  const inScope = bothHarness.texts(bothHarness.element("view"));
  assert.equal(inScope.includes("reviewer"), true);
  assert.equal(inScope.includes("Parent: outside selected scope"), false);
  assert.equal(inScope.includes("Parent: Unavailable"), false);
});

/** One rendered sub-navigation control, by the inventory it selects. */
function envSubNav(view: StubElement, envTab: string): StubElement {
  const button = view
    .querySelectorAll("button")
    .find((candidate) => candidate.dataset.envTab === envTab);
  if (button === undefined) {
    throw new Error(`no environment sub-navigation control for ${envTab}`);
  }
  return button;
}

/** The Environment sub-section the rendered sub-navigation has pressed. */
function pressedEnvTab(view: StubElement): string {
  for (const button of view.querySelectorAll("button")) {
    if (
      button.dataset.envTab !== undefined &&
      button.attributes["aria-pressed"] === "true"
    ) {
      return button.dataset.envTab;
    }
  }
  throw new Error("no pressed environment sub-navigation control");
}

/** One rendered table row, by a text its cells render exactly. */
function rowOf(
  view: StubElement,
  texts: (node: StubElement) => string[],
  label: string,
): StubElement {
  const row = view
    .querySelectorAll("tr")
    .find((candidate) => texts(candidate).includes(label));
  if (row === undefined) throw new Error(`no rendered row named ${label}`);
  return row;
}

test("inventory renders as environment with no activity claim", async () => {
  const harness = runClient(
    await loadInspectorBundle({
      ...bundleInput,
      loadCurrent: async () => modelWithInventory(),
    }),
  );
  const { client, element, texts } = harness;
  client.state.tab = "environment";
  client.render();
  const environment = cardOf(element("view"), texts, "Environment");
  const rendered = texts(environment);

  // The design's three summary lines: availability, and for skills only the
  // explicit folded invocation counters (commands have no counter evidence).
  assert.equal(
    has(
      rendered,
      "Commands Available: 119 · Observed invocations: Unavailable",
    ),
    true,
  );
  assert.equal(
    has(rendered, "Skills Available: 42 · Explicit invocations observed: 3"),
    true,
  );
  assert.equal(has(rendered, "Resources Sources: 11"), true);
  // 119 is availability: no inventory count may be spoken of as a call or an
  // invocation, and the one invocation figure is the explicit counter above.
  assert.equal(/119 (used|invoked|calls)/.test(rendered.join(" ")), false);
  assert.equal(rendered.join(" ").includes("119 calls"), false);
  // Inventory is environment state, so the panel carries the explicit period
  // label and never the selected range's dates.
  assert.equal(has(rendered, "Current environment"), true);
  assert.equal(has(rendered, "→"), false);

  // The selected range filters session activity, not inventory: a range with no
  // observations leaves every environment line exactly as it was.
  client.state.range = {
    kind: "custom",
    from: "2020-01-01",
    to: "2020-12-31",
  };
  client.render();
  assert.equal(element("range-dates").textContent, "2020-01-01 → 2020-12-31");
  assert.deepEqual(
    texts(cardOf(element("view"), texts, "Environment")),
    rendered,
  );
});

test("skills availability is the inventory count, never a counter-only name", async () => {
  const harness = runClient(
    await loadInspectorBundle({
      ...bundleInput,
      loadCurrent: async () => modelWithCounterOnlySkill(),
    }),
  );
  const { client, element, texts } = harness;
  client.state.tab = "environment";
  client.render();
  const environment = cardOf(element("view"), texts, "Environment");
  const rendered = texts(environment);

  // The inventory holds two skills and its counters name one of them twice plus
  // an absent `retired-mode` five times, so the skills table has three rows. The
  // availability line is the inventory's two, and the folded counters stay the
  // one invocation figure: a counter-only name is activity, never availability.
  assert.equal(
    has(rendered, "Skills Available: 2 · Explicit invocations observed: 8"),
    true,
  );
  assert.equal(has(rendered, "Skills Available: 3"), false);

  // The counter-only name is still an activity row in the skills inventory, and
  // the panel-level summary above the table is unchanged by the sub-section.
  harness.click(envSubNav(element("view"), "skills"));
  const retired = texts(rowOf(element("view"), texts, "retired-mode"));
  assert.equal(has(retired, "retired-mode"), true);
  assert.equal(has(retired, "5"), true);
  assert.equal(
    has(
      texts(element("view")),
      "Skills Available: 2 · Explicit invocations observed: 8",
    ),
    true,
  );
});

test("skills availability is unavailable without an inventory snapshot", async () => {
  const harness = runClient(
    await loadInspectorBundle({
      ...bundleInput,
      loadCurrent: async () => modelWithCounterOnlySkillAfterExpiry(),
    }),
  );
  const { client, element, texts } = harness;
  client.state.tab = "environment";
  client.render();
  const rendered = texts(cardOf(element("view"), texts, "Environment"));

  // No snapshot means no inventory count: the counted names survive as rows, so
  // the availability line is Unavailable and never their row count.
  assert.equal(
    has(
      rendered,
      "Skills Available: Unavailable · Explicit invocations observed: 8",
    ),
    true,
  );
  assert.equal(/Skills Available: \d/.test(rendered.join(" ")), false);

  // The rows are activity that outlived the inventory; they are still listed.
  harness.click(envSubNav(element("view"), "skills"));
  assert.equal(
    has(texts(rowOf(element("view"), texts, "retired-mode")), "5"),
    true,
  );
  assert.equal(
    has(texts(rowOf(element("view"), texts, "council-mode")), "2"),
    true,
  );
});

test("the Environment sub-navigation swaps inventory tables and keeps search", async () => {
  const harness = runClient(
    await loadInspectorBundle({
      ...bundleInput,
      loadCurrent: async () => modelWithInventory(),
    }),
  );
  const { client, element, texts } = harness;
  client.state.tab = "environment";
  client.render();
  const view = (): StubElement => element("view");
  const rendered = (): string[] => texts(view());

  // Commands is the default sub-section, and its inventory table keeps the
  // table-local search control beside its rows.
  assert.equal(pressedEnvTab(view()), "commands");
  assert.equal(has(rendered(), "cmd-1"), true);
  assert.equal(element("search").placeholder, "Filter this table…");

  // A sub-navigation control swaps the table inside the same Environment panel.
  harness.click(envSubNav(view(), "skills"));
  assert.equal(pressedEnvTab(view()), "skills");
  assert.equal(has(rendered(), "council-mode"), true);
  assert.equal(has(rendered(), "cmd-1"), false);
  assert.equal(element("search").placeholder, "Filter this table…");
  // The skills inventory keeps its own explicit-invocation column, and the
  // summary above it is unchanged by the sub-section.
  assert.equal(has(rendered(), "Explicit invocations observed: 3"), true);
  assert.equal(
    has(
      rendered(),
      "Commands Available: 119 · Observed invocations: Unavailable",
    ),
    true,
  );

  harness.click(envSubNav(view(), "resources"));
  assert.equal(pressedEnvTab(view()), "resources");
  assert.equal(has(rendered(), "Sources"), true);
  assert.equal(has(rendered(), "council-mode"), false);

  // The retained search still narrows the visible inventory table.
  client.state.table = { query: "cmd-99" };
  harness.click(envSubNav(view(), "commands"));
  assert.equal(has(rendered(), "cmd-99"), true);
  assert.equal(has(rendered(), "cmd-1"), false);
});

test("integrations render four independent columns", async () => {
  const harness = runClient(
    await loadInspectorBundle({
      ...bundleInput,
      loadCurrent: async () => modelWithIntegrations(),
    }),
  );
  const { client, element, texts } = harness;
  client.state.tab = "integrations";
  client.render();
  const view = element("view");
  const rendered = texts(view);

  for (const label of [
    "Integration",
    "Detected",
    "Telemetry",
    "Activity",
    "Version",
  ]) {
    assert.equal(has(rendered, label), true, label);
  }

  // §8.3-1: unknown detection with supported telemetry keeps every column, and
  // the counters are verbatim `key: value` pairs under the session-scope label.
  const rtk = texts(rowOf(view, texts, "rtk"));
  assert.equal(has(rtk, "Unknown"), true);
  assert.equal(has(rtk, "Supported"), true);
  assert.equal(
    has(rtk, "Session total · compactions: 4 · truncated: false"),
    true,
  );
  assert.equal(has(rtk, "1"), true);

  // A definite detection keeps its own counters under the same session label,
  // which states the counters are not a range figure.
  const context = texts(rowOf(view, texts, "context"));
  assert.equal(has(context, "Present"), true);
  assert.equal(has(context, "Session total · calls: 2"), true);

  // §8.3-4: unsupported telemetry states its closed-vocabulary reason, and a
  // row with no counter object says Unavailable for activity — never zero.
  const ponytail = texts(rowOf(view, texts, "ponytail"));
  assert.equal(has(ponytail, "Unsupported"), true);
  assert.equal(has(ponytail, "no compatible telemetry evidence"), true);
  // No counter object was persisted, so the activity column is Unavailable and
  // the session-scope label is absent rather than rendered over an empty set.
  assert.equal(has(ponytail, "Session total"), false);
  assert.equal(has(ponytail, "Unavailable"), true);

  // An unavailable row with no counters says Unavailable for telemetry,
  // activity and version: never a fabricated zero.
  const lens = texts(rowOf(view, texts, "lens"));
  assert.equal(has(lens, "no telemetry observed in this session"), true);
  assert.equal(has(lens, "Session total"), false);
  assert.equal(lens.filter((value) => value === "Unavailable").length, 3);
  assert.equal(/\b0\b/.test(lens.join(" ")), false);
});

test("an absent producer with persisted telemetry stays a valid row", async () => {
  const harness = runClient(
    await loadInspectorBundle({
      ...bundleInput,
      loadCurrent: async () => modelWithAbsentDetectedTelemetry(),
    }),
  );
  const { client, element, texts } = harness;
  client.state.tab = "integrations";
  client.render();
  const view = element("view");

  // Detection and telemetry are independent (ADR 0009/0014): the persisted
  // counters still show, the version stays its validated integer, and the
  // absence is a note that never changes the telemetry value.
  const ponytail = texts(rowOf(view, texts, "ponytail"));
  assert.equal(has(ponytail, "Not observed"), true);
  assert.equal(has(ponytail, "Supported"), true);
  assert.equal(
    has(ponytail, "producer not detected in current inventory"),
    true,
  );
  assert.equal(has(ponytail, "Session total · changes: 0"), true);
  assert.equal(has(ponytail, "1"), true);

  // The same non-state note renders on a row with no telemetry evidence at all,
  // beside that row's own closed-vocabulary reason.
  const caveman = texts(rowOf(view, texts, "caveman"));
  assert.equal(
    has(caveman, "producer not detected in current inventory"),
    true,
  );
  assert.equal(has(caveman, "no telemetry observed in this session"), true);
  assert.equal(has(caveman, "Unavailable"), true);

  // Nothing is reconciled: both verdicts stand side by side and no copy claims
  // the contradiction was resolved.
  assert.equal(has(texts(view), "reconcil"), false);
});

/** One metric card's rendered value, matched by its exact title. */
function metricValue(view: StubElement, title: string): string {
  const metric = view
    .querySelectorAll(".metric")
    .find((node) => node.children[0]?.textContent === title);
  if (metric === undefined) throw new Error(`no metric titled ${title}`);
  return metric.children[1]?.textContent ?? "";
}

/**
 * One rendered cell under a column header of the table row named `label`. It
 * indexes the row's own cells, so the assertion cannot be satisfied by the same
 * text appearing anywhere else on the row.
 */
function cellUnder(
  harness: { texts(node: StubElement): string[] },
  view: StubElement,
  header: string,
  label: string,
): StubElement {
  const row = rowOf(view, harness.texts, label);
  const body = row.parentNode;
  const table = body?.parentNode ?? null;
  if (body === null || table === null) {
    throw new Error(`row ${label} is not inside a table`);
  }
  const head = table.querySelectorAll("tr")[0];
  if (head === undefined) throw new Error(`table of ${label} has no header`);
  const column = head.children.findIndex((cell) => cell.textContent === header);
  if (column < 0)
    throw new Error(`no column ${header} in the table of ${label}`);
  const cell = row.children[column];
  if (cell === undefined) throw new Error(`row ${label} has no ${header} cell`);
  return cell;
}

test("a complete coverage set renders its own complete line and unqualified labels", () => {
  const complete: SessionCoverage = {
    inspected: 2,
    available: 2,
    unavailable: 0,
    sessionRatio: 1,
    complete: true,
    discoveryLimited: false,
    reasons: {},
  };
  const bundle = bundleFixture();
  bundle.history.coverage = complete;
  bundle.global.coverage = complete;
  const harness = runClient(bundle);
  const { client, element, texts } = harness;
  client.state.section = "history";
  client.state.session = null;
  client.state.tab = "overview";
  client.render();
  const rendered = texts(element("view"));

  // The complete set states its own line and drops the Known qualifier from the
  // headline (the partial fixture's ladder would render both). The unavailable
  // session's own row still renders Unavailable, so the coverage line is what
  // is asserted here, never the absence of the word in the whole view.
  assert.equal(rendered.includes("2 / 2 sessions"), true);
  assert.equal(
    rendered.some((value) => value.includes("sessions ·")),
    false,
  );
  assert.equal(rendered.includes("Native cost"), true);
  assert.equal(rendered.includes("Known native cost"), false);

  // The same payload's ladder is what the panel reads: a partial set says so.
  const partial = runClient(bundleFixture());
  partial.client.state.section = "history";
  partial.client.state.session = null;
  partial.client.state.tab = "overview";
  partial.client.render();
  const partialView = partial.texts(partial.element("view"));
  assert.equal(
    partialView.some((value) => value.includes("1 / 2 sessions")),
    true,
  );
  assert.equal(partialView.includes("Known native cost"), true);
});

test("the agents panel metric cards are the per-status buckets of the rows it renders", async () => {
  const harness = runClient(
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
  harness.client.state.scope = "tree";
  harness.client.state.tab = "agents";
  harness.client.render();
  const view = harness.element("view");

  // One bucket metric per non-zero status, counted from the rows this panel
  // renders, beside the total.
  assert.deepEqual(
    [
      "Child runs",
      "Succeeded",
      "Failed",
      "Interrupted",
      "Running",
      "Unknown",
    ].map((title) => metricValue(view, title)),
    ["5", "1", "1", "1", "1", "1"],
  );
  // A bucket with no row is omitted rather than rendered as a zero.
  assert.equal(
    view
      .querySelectorAll(".metric")
      .some((node) => node.children[0]?.textContent === "Zero"),
    false,
  );
});

test("an agents tab whose runs carry no observed time names that cause", async () => {
  // The fixture's only run carries no observedAt, so no range can place it.
  const undated = runClient(bundleFixture());
  undated.client.state.scope = "tree";
  undated.client.state.tab = "agents";
  undated.client.state.range = {
    kind: "custom",
    from: "2026-02-01",
    to: "2026-02-02",
  };
  undated.client.render();
  const undatedText = undated.texts(undated.element("view"));
  assert.equal(
    undatedText.includes(
      "Child runs carry no observed time, so none can be placed in the selected range.",
    ),
    true,
  );
  assert.equal(
    undatedText.includes("No child run falls inside the selected range."),
    false,
  );

  // A partly dated set states both causes instead of blaming the range alone.
  const mixed = runClient(
    await loadInspectorBundle({
      ...bundleInput,
      loadCurrent: async () => currentModelWithAgents(),
    }),
  );
  mixed.client.state.scope = "tree";
  mixed.client.state.tab = "agents";
  mixed.client.state.range = {
    kind: "custom",
    from: "2020-01-01",
    to: "2020-12-31",
  };
  mixed.client.render();
  assert.equal(
    mixed
      .texts(mixed.element("view"))
      .includes(
        "No child run falls inside the selected range, and runs without an observed time cannot be placed in one.",
      ),
    true,
  );
});

test("a tools summary row states its own partial fraction in the cell it qualifies", async () => {
  const harness = runClient(
    await loadInspectorBundle({
      ...bundleInput,
      loadCurrent: async () => currentModelWithPartialToolUsage(),
    }),
  );
  harness.client.state.scope = "tree";
  harness.client.state.tab = "tools";
  harness.client.render();
  const view = harness.element("view");

  // The row's Known tokens cell carries the row's own sentence (`1 of 3`), not
  // the panel's fraction over every call.
  const tokens = cellUnder(harness, view, "Tokens", "read");
  assert.equal(
    harness.texts(tokens).includes("1 of 3 calls reported usage"),
    true,
  );
  assert.equal(harness.texts(tokens).includes("Known tokens"), true);
});

test("the tools summary's Last used cell is the newest call of that name", async () => {
  const harness = runClient(
    await loadInspectorBundle({
      ...bundleInput,
      loadCurrent: async () => currentModelWithOutOfOrderToolCalls(),
    }),
  );
  harness.client.state.scope = "tree";
  harness.client.state.tab = "tools";
  harness.client.render();
  const view = harness.element("view");

  // The name's older call is persisted after its newer one, so the cell can only
  // be the maximum timestamp: the last row's timestamp would be the older one.
  assert.equal(
    cellUnder(harness, view, "Last used", "read").textContent,
    "2026-02-01T10:00:09.000Z",
  );
});

test("a tool error's Message CELL says Unavailable, not just its row", async () => {
  const harness = runClient(
    await loadInspectorBundle({
      ...bundleInput,
      loadCurrent: async () => modelWithToolError(),
    }),
  );
  harness.client.state.tab = "errors";
  harness.client.render();
  const view = harness.element("view");
  const row = rowOf(view, harness.texts, "bash failed");

  // The row states Unavailable in more than one place (its Source line), so a
  // row-level "any Unavailable" assertion cannot name the message column.
  assert.ok(
    harness.texts(row).filter((value) => value === "Unavailable").length > 1,
  );
  assert.equal(
    cellUnder(harness, view, "Message", "bash failed").textContent,
    "Unavailable",
  );
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { reduceEntries } from "../../src/core/reduce.ts";
import { toSessionReport } from "../../src/core/reports.ts";
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
  presetRange,
  resolveRange,
  type RangeState,
} from "../../src/ui/range.ts";
import {
  bundleInput,
  currentModelWithMixedToolUsage,
  currentModelWithPartialToolUsage,
  currentModelWithTools,
  modelWithErrorAndThreeChildren,
  modelWithGenerationError,
  modelWithOrphanChild,
  modelWithOrphanChildAndParent,
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
    "const shiftUtcDay=",
    "const latestObservedDate=",
    "const presetRange=",
    "const resolveRange=",
    "const isInRange=",
    "const serializeRangeQuery=",
    "const parseRangeQuery=",
    "const filterView=",
    "const historyRowRange=",
  ]) {
    assert.equal(source.includes(fragment), true, fragment);
  }
  assert.equal(/__name\(/.test(source), false);

  // The evaluated block returns the same bindings the tests import, so every
  // expectation below is checked against the module's own result too.
  const evaluate = new Function(
    `${source}
return {filterView, parseRangeQuery, resolveRange, presetRange};`,
  ) as () => {
    filterView: typeof filterView;
    parseRangeQuery: typeof parseRangeQuery;
    resolveRange: typeof resolveRange;
    presetRange: typeof presetRange;
  };
  const inlined = evaluate();
  assert.deepEqual(inlined.presetRange(7, ["2026-09-11", "2026-09-12"]), {
    preset: 7,
    from: "2026-09-06",
    to: "2026-09-12",
  });
  assert.deepEqual(
    inlined.parseRangeQuery("from=2026-09-01&to=2026-09-12"),
    parseRangeQuery("from=2026-09-01&to=2026-09-12"),
  );
  assert.deepEqual(
    inlined.resolveRange(undefined, ["2026-09-11"], "aggregate"),
    resolveRange(undefined, ["2026-09-11"], "aggregate"),
  );
  assert.deepEqual(
    inlined.presetRange(30, ["2026-09-11", "2026-09-12"]),
    presetRange(30, ["2026-09-11", "2026-09-12"]),
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
    "resolveRange(activeIntent()",
  ]) {
    assert.equal(script.includes(fragment), true, fragment);
  }
  assert.equal(/__name\(/.test(script), false);
  assert.equal(/Date\.now|Math\.random|new Date\(\)/.test(script), false);
});

type StubElement = HarnessNode & {
  id: string;
  tagName: string;
  className: string;
  textContent: string;
  hidden: boolean;
  value: string;
  dataset: Record<string, string>;
  style: Record<string, string>;
  attributes: Record<string, string>;
  children: StubElement[];
  parentNode: StubElement | null;
  listeners: Record<string, ((event: unknown) => void)[]>;
  append(...nodes: unknown[]): void;
  replaceChildren(...nodes: unknown[]): void;
  setAttribute(name: string, value: unknown): void;
  removeAttribute(name: string): void;
  querySelector(selector: string): StubElement | null;
  querySelectorAll(selector: string): StubElement[];
  closest(selector: string): StubElement | null;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  classList: { add(value: string): void; toggle(value: string): boolean };
  focus(): void;
  setSelectionRange(): void;
  showModal(): void;
  close(): void;
};

/** The client is a classic script; its `instanceof Node` checks need a class. */
class HarnessNode {}

function descendant(node: StubElement, selector: string): StubElement | null {
  for (const child of node.children) {
    const matches = selector.startsWith(".")
      ? child.className.split(" ").includes(selector.slice(1))
      : child.tagName === selector;
    if (matches) return child;
    const nested = descendant(child, selector);
    if (nested !== null) return nested;
  }
  return null;
}

function stubElement(
  tagName: string,
  onAppend?: (element: StubElement) => void,
): StubElement {
  const element = new HarnessNode() as StubElement;
  element.id = "";
  element.tagName = tagName;
  element.className = "";
  element.textContent = "";
  element.hidden = false;
  element.value = "";
  element.dataset = {};
  element.style = {};
  element.attributes = {};
  element.children = [];
  element.parentNode = null;
  element.listeners = {};
  element.append = (...nodes) => {
    for (const node of nodes) {
      if (node instanceof HarnessNode) {
        (node as StubElement).parentNode = element;
        element.children.push(node as StubElement);
        onAppend?.(node as StubElement);
      }
    }
  };
  element.replaceChildren = (...nodes) => {
    element.children = [];
    element.append(...nodes);
  };
  element.setAttribute = (name, value) => {
    element.attributes[name] = String(value);
    if (name === "id") element.id = String(value);
    if (name === "class") element.className = String(value);
  };
  element.removeAttribute = (name) => {
    delete element.attributes[name];
  };
  element.querySelector = (selector) => descendant(element, selector);
  element.querySelectorAll = (selector) => {
    const found: StubElement[] = [];
    for (const child of element.children) {
      if (
        selector.startsWith(".")
          ? child.className.split(" ").includes(selector.slice(1))
          : child.tagName === selector
      ) {
        found.push(child);
      }
      found.push(...child.querySelectorAll(selector));
    }
    return found;
  };
  element.closest = (selector) => {
    let node: StubElement | null = element;
    while (node !== null) {
      const matches = selector.startsWith(".")
        ? node.className.split(" ").includes(selector.slice(1))
        : node.tagName === selector;
      if (matches) return node;
      node = node.parentNode;
    }
    return null;
  };
  element.addEventListener = (type, listener) => {
    if (element.listeners[type] === undefined) element.listeners[type] = [];
    element.listeners[type].push(listener);
  };
  element.classList = { add: () => {}, toggle: () => false };
  element.focus = () => {};
  element.setSelectionRange = () => {};
  element.showModal = () => {};
  element.close = () => {};
  return element;
}

type ClientInternals = {
  state: {
    section: string;
    scope: string;
    tab: string;
    session: number | null;
  };
  rangeIntents: Record<string, unknown>;
  render(): void;
};

/**
 * Runs the emitted client against a stub document. The generated document is
 * 40 KB of client code that no other test executes, so at least one test has to
 * render it for real: the store below is what the client's own `q(id)` reads.
 */
function runClient(bundle: InspectorBundle): {
  client: ClientInternals;
  preset(days: string): void;
  submit(): void;
  click(node: StubElement): void;
  element(id: string): StubElement;
  texts(node: StubElement): string[];
} {
  const html = renderInspectorBundle(bundle);
  const payload =
    /<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/.exec(
      html,
    )?.[1] ?? "";
  const catalog =
    /<script type="application\/json" id="catalog-data">([\s\S]*?)<\/script>/.exec(
      html,
    )?.[1] ?? "";
  const script =
    /<script>\n([\s\S]*)\n<\/script><\/body>/.exec(html)?.[1] ?? "";
  // Every id the server-rendered markup carries; anything else is absent, so
  // the client's create-on-demand paths (and any stale id) behave as in a browser.
  const markupIds = [
    "navigation",
    "breadcrumb",
    "kicker",
    "title",
    "subtitle",
    "theme",
    "session-label",
    "scope-note",
    "wal-detail",
    "scope",
    "scope-sub",
    "scope-fixed",
    "time-range",
    "range-name",
    "range-dates",
    "custom-range",
    "date-dialog",
    "date-form",
    "date-title",
    "date-from",
    "date-to",
    "date-error",
    "date-cancel",
    "tabs",
    "view",
    "announcement",
    "report-data",
    "catalog-data",
    // The server renders the truncation notice only for a capped view.
    ...(html.includes('id="range-truncated"') ? ["range-truncated"] : []),
  ];
  const store = new Map<string, StubElement>();
  const register = (element: StubElement): void => {
    if (element.id !== "") store.set(element.id, element);
  };
  const dayButtons = ["7", "14", "30"].map((days) => {
    const button = stubElement("button", register);
    button.dataset.days = days;
    return button;
  });
  const documentStub = {
    body: stubElement("body"),
    activeElement: null,
    listeners: {} as Record<string, (event: unknown) => void>,
    getElementById: (id: string): StubElement | null => {
      const existing = store.get(id);
      if (existing !== undefined) return existing;
      if (!markupIds.includes(id)) return null;
      const created = stubElement(id === "tabs" ? "nav" : "div", register);
      created.id = id;
      created.parentNode = stubElement("div");
      created.textContent =
        id === "report-data" ? payload : id === "catalog-data" ? catalog : "";
      store.set(id, created);
      return created;
    },
    createElement: (name: string): StubElement => stubElement(name, register),
    createElementNS: (_namespace: string, name: string): StubElement =>
      stubElement(name, register),
    querySelectorAll: (selector: string): StubElement[] =>
      selector === "[data-days]" ? dayButtons : [],
    addEventListener: (
      type: string,
      listener: (event: unknown) => void,
    ): void => {
      documentStub.listeners[type] = listener;
    },
  };
  const windowStub = { scrollX: 0, scrollY: 0, scrollTo: () => {} };
  const factory = new Function(
    "document",
    "window",
    "Node",
    `${script}\nreturn {state:state,rangeIntents:rangeIntents,render:render};`,
  ) as (document: unknown, window: unknown, node: unknown) => ClientInternals;
  const client = factory(documentStub, windowStub, HarnessNode);
  const texts = (node: StubElement): string[] => {
    const collected = node.textContent === "" ? [] : [node.textContent];
    for (const child of node.children) collected.push(...texts(child));
    return collected;
  };
  return {
    client,
    preset: (days) => {
      const button = dayButtons.find(
        (candidate) => candidate.dataset.days === days,
      );
      if (button === undefined) throw new Error(`no preset ${days}`);
      for (const listener of button.listeners.click ?? []) {
        listener({ currentTarget: button });
      }
    },
    submit: () => {
      for (const listener of documentStub.getElementById("date-form")?.listeners
        .submit ?? []) {
        listener({ preventDefault: () => {} });
      }
    },
    // The client delegates every button to one document-level click handler, so
    // a rendered control is exercised through that handler, not by calling the
    // state logic the handler would have reached.
    click: (node) => {
      const listener = documentStub.listeners.click;
      if (listener === undefined) throw new Error("no document click handler");
      listener({ target: node });
    },
    element: (id) => {
      const found = documentStub.getElementById(id);
      if (found === null) throw new Error(`no element #${id}`);
      return found;
    },
    texts,
  };
}

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
  client.rangeIntents.current = { kind: "preset", preset: 7 };
  client.render();
  assert.equal(element("range-dates").textContent, "2026-01-27 → 2026-02-02");

  // A custom single day narrows every range-filtered metric to that day.
  client.rangeIntents.current = {
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
  // A payload without a dated composition keeps the session's own split, which
  // must then carry the all-report-dates label instead of passing as the range.
  assert.equal(
    narrow.some(
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

  client.rangeIntents.current = {
    kind: "custom",
    from: "2026-02-02",
    to: "2026-02-02",
  };
  client.render();

  for (const section of ["current", "history", "global"]) {
    for (const session of section === "history" ? [null, 0] : [null]) {
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
  client.rangeIntents["history:aggregate"] = {
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
  client.rangeIntents["history:aggregate"] = {
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

  client.rangeIntents.global = outside;
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

  client.rangeIntents["history:aggregate"] = outside;
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
  client.rangeIntents["history:aggregate"] = {
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
  client.rangeIntents["history:aggregate"] = {
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
  client.rangeIntents.current = {
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
  withoutDates.client.rangeIntents.current = { kind: "preset", preset: 7 };
  withoutDates.client.render();
  assert.equal(withoutDates.element("range-name").textContent, "Unavailable");
  assert.equal(withoutDates.element("range-dates").textContent, "Unavailable");
  assert.equal(withoutDates.element("range-truncated").hidden, true);

  // A view with observed dates still says when the chosen range did not apply.
  const withDates = runClient(bundleFixture());
  withDates.client.rangeIntents.current = {
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

/** The rendered anchors carrying one reference attribute. */
function anchorsWith(
  view: StubElement,
  attribute: "childLink" | "toolLink",
): StubElement[] {
  return view
    .querySelectorAll("a")
    .filter((node) => node.dataset[attribute] !== undefined);
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
  client.rangeIntents.current = { kind: "preset", preset: 7 };
  client.render();
  assert.equal(element("range-dates").textContent, "2026-01-27 → 2026-02-02");
  const seven = texts(element("view"));
  assert.deepEqual(modelCells(seven, "alpha"), ["1", "200", "$0.02"]);
  assert.deepEqual(modelCells(seven, "beta"), ["1", "800", "$0.16"]);
  assert.deepEqual(modelCells(seven, "legacy"), []);
  assert.equal(has(seven, "All report dates"), false);

  // 14D reaches the older day, so the same tab shows one more model row.
  client.rangeIntents.current = { kind: "preset", preset: 14 };
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
  client.rangeIntents.current = {
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

test("a history session detail keeps the aggregate model table labelled for all report dates", () => {
  const harness = runClient(bundleFixture());
  const { client, element, texts } = harness;
  client.state.section = "history";
  client.state.session = 0;
  client.state.tab = "models";

  // This payload carries no dated model rows for its history sessions (the
  // pre-Task-8 shape and the legacy adapter), so its table is the aggregate
  // one, labelled, and it is never emptied by the range.
  client.rangeIntents["history:session-a"] = {
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

  // A current view without a dated projection (the fixture's shape, and what
  // the legacy adapter emits) keeps the same aggregate table, and the range
  // never empties it either.
  const legacy = runClient(bundleFixture());
  legacy.client.state.section = "current";
  legacy.client.state.tab = "models";
  legacy.client.rangeIntents.current = {
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
  client.rangeIntents.current = {
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
  // relation is one-to-many and no candidate is named as the cause.
  assert.equal(texts(view).includes("Related child run(s)"), true);
  assert.deepEqual(
    anchorsWith(view, "childLink").map((anchor) => anchor.textContent),
    ["reviewer", "researcher", "validator"],
  );
  assert.equal(has(texts(view), "caused by"), false);
  assert.equal(has(texts(view), "cause of"), false);
  // The tool-call reference carries the call's canonical id, so Task 15 can
  // point it at the calls route without re-deriving the join.
  assert.deepEqual(
    anchorsWith(view, "toolLink").map((anchor) => [
      anchor.textContent,
      anchor.dataset.toolLink,
    ]),
    [["bash", "tool:call_bash"]],
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
    anchorsWith(roleless.element("view"), "childLink").map(
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
  client.rangeIntents.current = {
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
  client.rangeIntents.current = {
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
  client.rangeIntents.current = {
    kind: "custom",
    from: "2026-02-02",
    to: "2026-02-02",
  };
  client.render();
  const observed = texts(element("view"));
  assert.equal(observed.includes("Child runs"), true);
  assert.equal(observed.includes("1 of 1 runs reported usage"), true);
  client.rangeIntents.current = {
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
  client.state.session = 0;
  client.state.tab = "models";

  // 7D anchors on this session's own latest observed day, so the older row drops.
  client.rangeIntents["history:session-a"] = { kind: "preset", preset: 7 };
  client.render();
  assert.equal(element("range-dates").textContent, "2026-01-27 → 2026-02-02");
  const seven = texts(element("view"));
  assert.deepEqual(modelCells(seven, "alpha"), ["1", "200", "$0.02"]);
  assert.deepEqual(modelCells(seven, "beta"), ["1", "800", "$0.16"]);
  assert.deepEqual(modelCells(seven, "legacy"), []);
  assert.equal(has(seven, "All report dates"), false);

  // 14D reaches the older day, so the same detail shows one more model row.
  client.rangeIntents["history:session-a"] = { kind: "preset", preset: 14 };
  client.render();
  assert.equal(element("range-dates").textContent, "2026-01-20 → 2026-02-02");
  assert.deepEqual(modelCells(texts(element("view")), "legacy"), [
    "1",
    "100",
    "$0.01",
  ]);

  // The range never falls back to the aggregate rows of the same session detail.
  client.rangeIntents["history:session-a"] = {
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
  detail.client.state.session = 0;
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
  client.rangeIntents.global = {
    kind: "custom",
    from: "2026-02-01",
    to: "2026-02-02",
  };
  client.render();
  assert.equal(element("range-truncated").hidden, true);

  // A range reaching before it is flagged again, with the one bounded sentence.
  client.rangeIntents.global = {
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

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { reduceEntries } from "../../src/core/reduce.ts";
import { toSessionReport } from "../../src/core/reports.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";
import type { InspectorBundle } from "../../src/ui/bundle.ts";
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

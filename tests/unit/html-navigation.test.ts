import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  loadInspectorBundle,
  type InspectorBundle,
} from "../../src/ui/bundle.ts";
import {
  assertInlinedModulesEvaluate,
  renderInspectorBundle,
} from "../../src/ui/html.ts";
import {
  bundleInput,
  modelWithErrorAndThreeChildren,
  modelWithOrphanChildAndParent,
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

test("the document inlines the same pure modules the tests import", () => {
  const html = renderInspectorBundle(bundleFixture());
  for (const fragment of [
    "const parseRoute=",
    "const serializeRoute=",
    "const filterView=",
    "const deriveView=",
  ]) {
    assert.equal(html.includes(fragment), true, fragment);
  }
});

test("no active-state attribute is hardcoded in the initial markup", () => {
  const body = renderInspectorBundle(bundleFixture()).split("<body")[1] ?? "";
  for (const attribute of ["aria-current=", "aria-selected="]) {
    assert.equal(body.includes(attribute), false, attribute);
  }
});

test("the document embeds the capability table", () => {
  const parsed = JSON.parse(
    /"capabilities":(\{.*?\})/.exec(
      renderInspectorBundle(bundleFixture()),
    )?.[1] as string,
  ) as Record<string, string[]>;
  assert.deepEqual(
    [parsed.global, parsed.current.includes("environment")],
    [["overview"], true],
  );
  // A selected history session carries a full SessionReport, so its route offers
  // every tab (design §9.3); the aggregate offers what it computes (Task 13 R15).
  assert.equal(parsed.history.includes("models"), false);
  assert.equal(parsed.historySession.includes("models"), true);
});

test("one event path handles hashchange and popstate without double rendering", () => {
  const html = renderInspectorBundle(bundleFixture());
  assert.match(html, /function applyLocation\(/);
  assert.equal((html.match(/addEventListener\("hashchange"/g) ?? []).length, 1);
  assert.equal((html.match(/addEventListener\("popstate"/g) ?? []).length, 1);
  assert.match(html, /if\(key===lastAppliedKey\)return/);
});

test("the emitted script is complete and callable without a DOM", () => {
  assert.doesNotThrow(() => assertInlinedModulesEvaluate());
});

/** One sidebar anchor, by the section it navigates to. */
function navLink(navigation: StubElement, section: string): StubElement {
  const link = navigation
    .querySelectorAll("a")
    .find((candidate) => candidate.dataset.range === section);
  if (link === undefined) throw new Error(`no sidebar link for ${section}`);
  return link;
}

/** One tab anchor, by the tab it navigates to. */
function tabLink(tabs: StubElement, tab: string): StubElement {
  const link = tabs
    .querySelectorAll("a")
    .find((candidate) => candidate.dataset.tab === tab);
  if (link === undefined) throw new Error(`no tab link for ${tab}`);
  return link;
}

/** The visible tab set, in the order the document renders it. */
function visibleTabs(tabs: StubElement): (string | undefined)[] {
  return tabs.querySelectorAll("a").map((link) => link.dataset.tab);
}

/** The tab the derived view marked current; `aria-current` is render output. */
function currentTab(tabs: StubElement): string | undefined {
  const link = tabs
    .querySelectorAll("a")
    .find((candidate) => candidate.attributes["aria-current"] === "page");
  return link?.dataset.tab;
}

/**
 * Every rendered element carrying the one entity vocabulary, in document order.
 * The walk reads `children` directly, because the stub DOM resolves a selector
 * against a tag or a class and the vocabulary is an attribute.
 */
function entityNodes(node: StubElement): StubElement[] {
  const found: StubElement[] = [];
  const walk = (current: StubElement): void => {
    if (current.dataset.entity !== undefined) found.push(current);
    for (const child of current.children) walk(child);
  };
  walk(node);
  return found;
}

/** One rendered entity element, by the id its route carries. */
function entityNode(node: StubElement, entity: string): StubElement {
  const found = entityNodes(node).find(
    (candidate) => candidate.dataset.entity === entity,
  );
  if (found === undefined) throw new Error(`no rendered entity ${entity}`);
  return found;
}

test("a deep link opens the exact view, and a selected session offers every tab", () => {
  // The aggregate offers only what it computes: the requested tab is coerced to
  // the section default and the one-line notice says so (design §9.3).
  const aggregate = runClient(bundleFixture(), "#/history/models");
  assert.deepEqual(visibleTabs(aggregate.element("tabs")), ["overview"]);
  assert.equal(currentTab(aggregate.element("tabs")), "overview");
  assert.equal(
    aggregate.element("route-notice").textContent,
    "That view isn't available here.",
  );

  // The same deep link against a selected session is honoured: a session detail
  // carries a full report, so Models is a real destination (R15).
  const session = runClient(
    bundleFixture(),
    "#/history/models?session=session-a",
  );
  assert.deepEqual(visibleTabs(session.element("tabs")), [
    "overview",
    "models",
    "tools",
    "environment",
    "agents",
    "integrations",
    "errors",
    "ledger",
  ]);
  assert.equal(currentTab(session.element("tabs")), "models");
  assert.equal(session.element("breadcrumb").textContent, "session-a");
  assert.equal(session.element("route-notice").hidden, true);
  // The tab strip is derived state: exactly one sidebar link is current, and it
  // is the section the route names.
  assert.equal(
    session
      .element("navigation")
      .querySelectorAll("a")
      .filter((link) => link.attributes["aria-current"] === "page").length,
    1,
  );
  assert.equal(
    navLink(session.element("navigation"), "history").attributes[
      "aria-current"
    ],
    "page",
  );
  assert.equal(
    navLink(session.element("navigation"), "current").attributes[
      "aria-current"
    ],
    undefined,
  );
});

test("one navigation renders once, however many events report it", () => {
  const harness = runClient(bundleFixture());
  const { element, click, renders, hashchange } = harness;
  const before = renders();

  click(navLink(element("navigation"), "history"));
  assert.equal(element("title").textContent, "Pick up the trail.");
  assert.equal(renders() - before, 1);

  // The browser reports the hash it just changed (and, for a link, popstate too):
  // the canonical key is unchanged, so neither event renders again.
  hashchange();
  assert.equal(renders() - before, 1);
});

test("focus moves to the heading on a section change only", () => {
  const harness = runClient(bundleFixture());
  const { element, click, preset } = harness;
  const heading = element("title");
  let focused = 0;
  heading.focus = () => {
    focused += 1;
  };

  click(navLink(element("navigation"), "history"));
  assert.equal(focused, 1);
  // A range change re-renders the same section without stealing focus.
  preset("14");
  assert.equal(focused, 1);
  click(navLink(element("navigation"), "current"));
  assert.equal(focused, 2);
});

test("a view's range and table settings are remembered, never linked", () => {
  const harness = runClient(bundleFixture());
  const { client, element, click, location, preset } = harness;

  // The active view's range is route state, so the hash carries it.
  preset("7");
  assert.equal(element("range-dates").textContent, "2026-01-27 → 2026-02-02");
  assert.equal(location.hash, "#/current/overview?scope=tree&preset=7");

  // The aggregate keeps a range of its own...
  click(navLink(element("navigation"), "history"));
  preset("14");
  assert.equal(location.hash, "#/history/overview?preset=14");

  // ...and returning to the current view restores that view's remembered range.
  // The link itself carries no range (the entering view's memory is what
  // restores it), and the address bar is then canonicalized to the route the
  // document actually applied (R16), so the hash and the render cannot drift.
  click(navLink(element("navigation"), "current"));
  assert.equal(location.hash, "#/current/overview?scope=tree&preset=7");
  assert.equal(element("range-dates").textContent, "2026-01-27 → 2026-02-02");

  // A table's own query follows the same rule: the active table's is the route's
  // (so the hash carries it), the inactive one's lives in the ephemeral cache.
  click(tabLink(element("tabs"), "models"));
  assert.equal(location.hash, "#/current/models?scope=tree&preset=7");
  client.state.table = { query: "acme" };
  client.render();
  assert.equal(element("search").value, "acme");

  click(tabLink(element("tabs"), "tools"));
  assert.equal(element("search").value, "");
  click(tabLink(element("tabs"), "models"));
  assert.equal(element("search").value, "acme");
});

test("a view that cannot replay offers no tab and stays silent about its default", () => {
  const bundle = bundleFixture();
  bundle.current.active = {
    availability: "unavailable",
    diagnostic: "current-unavailable",
  };

  // The route names the default tab of a view with no tabs: the client renders
  // the bounded diagnostic and raises no `tab-unavailable` claim about the tab
  // the route did not ask for (Task 13 review).
  const silent = runClient(bundle, "#/current/overview?scope=active");
  assert.deepEqual(visibleTabs(silent.element("tabs")), []);
  assert.equal(silent.element("route-notice").hidden, true);
  assert.equal(
    silent
      .texts(silent.element("view"))
      .some((value) =>
        value.startsWith("This current view could not be replayed offline."),
      ),
    true,
  );

  // A tab that view cannot render at all is a real degradation, and says so.
  const asked = runClient(bundle, "#/current/models?scope=active");
  assert.deepEqual(visibleTabs(asked.element("tabs")), []);
  assert.equal(
    asked.element("route-notice").textContent,
    "That view isn't available here.",
  );

  // The same deep link on the other scope is served: that view replays.
  const served = runClient(bundle, "#/current/models?scope=tree");
  assert.equal(currentTab(served.element("tabs")), "models");
});

test("the chart metric is a per-view setting written from the view", () => {
  const harness = runClient(bundleFixture());
  const { element, change } = harness;
  const chartLabel = () =>
    element("view").querySelectorAll("svg")[0]?.attributes["aria-label"];

  assert.match(
    chartLabel() ?? "",
    /^Daily Sessions across 2 observed UTC days/,
  );
  const select = element("chart-metric");
  select.value = "cost";
  change(select);
  assert.match(chartLabel() ?? "", /^Daily Cost across 2 observed UTC days/);
  // The re-render writes the control back from that same setting.
  const options = element("chart-metric").querySelectorAll(
    "option",
  ) as (StubElement & {
    selected?: boolean;
  })[];
  assert.deepEqual(
    options
      .filter((option) => option.selected === true)
      .map((option) => option.value),
    ["cost"],
  );
});

test("a hash naming an unknown id or an unsupported tab degrades without echoing it", () => {
  const harness = runClient(bundleFixture());
  const { client, element, location, hashchange } = harness;

  location.hash = "#/history/models?session=SECRET&entity=tool%3ASECRET-CALL";
  hashchange();
  // Neither an unknown session nor an unknown entity id is carried into the route.
  assert.equal("session" in client.state, false);
  assert.equal("entity" in client.state, false);
  assert.deepEqual(visibleTabs(element("tabs")), ["overview"]);
  assert.equal(element("breadcrumb").textContent, "Session history");

  // A known id is kept: the deep link names a session and an id the payload
  // already exposes, so the destination is real.
  location.hash =
    "#/history/overview?session=session-a&entity=tool%3Atool%3Acall-a";
  hashchange();
  assert.equal(client.state.session, "session-a");
  assert.equal(client.state.entity?.id, "tool:call-a");
  assert.equal(element("breadcrumb").textContent, "session-a");
});
test("a hash whose range cannot be restored falls back with the notice", () => {
  // A lone endpoint is not a range: nothing is partially applied (design §9.1),
  // and the document loads the default span with the one-line notice.
  const harness = runClient(
    bundleFixture(),
    "#/current/overview?scope=tree&from=2026-02-01",
  );
  const { element, location, hashchange } = harness;
  assert.equal(
    element("route-notice").textContent,
    "Range could not be restored; showing the default range.",
  );
  assert.equal(element("range-dates").textContent, "2026-02-01 → 2026-02-02");

  // A validated pair restores exactly itself and the notice clears.
  location.hash = "#/current/overview?scope=tree&from=2026-02-02&to=2026-02-02";
  hashchange();
  assert.equal(element("route-notice").hidden, true);
  assert.equal(element("range-dates").textContent, "2026-02-02 → 2026-02-02");
});

test("clearing a table search returns every row and never throws", () => {
  const harness = runClient(bundleFixture(), "#/current/models?scope=tree");
  const { element, input, location, texts } = harness;
  const rows = (): number => element("view").querySelectorAll("tr").length;
  const rendersModel = (): boolean => texts(element("view")).includes("acme");
  const all = rows();
  assert.equal(all, 2); // the header row plus the one model row the fixture has
  assert.equal(rendersModel(), true);

  // Typing narrows the table and the active table's query is the route's.
  const typed = element("search");
  typed.value = "acme";
  assert.doesNotThrow(() => input(typed));
  assert.equal(rows(), all);
  assert.equal(location.hash, "#/current/models?scope=tree&q=acme");

  const narrowed = element("search");
  narrowed.value = "zzz";
  assert.doesNotThrow(() => input(narrowed));
  assert.equal(rows(), 1);
  assert.equal(rendersModel(), false);

  // Clearing the box empties the active table's state. It must be a route with
  // no `q` at all — not a null table — and the table renders every row again.
  const cleared = element("search");
  cleared.value = "";
  assert.doesNotThrow(() => input(cleared));
  assert.equal(rows(), all);
  assert.equal(rendersModel(), true);
  assert.equal(location.hash, "#/current/models?scope=tree");
});

test("clearing a sort selection, and sorting, never throws", () => {
  const harness = runClient(bundleFixture(), "#/current/models?scope=tree");
  const { element, change, location } = harness;

  const sort = element("sort");
  sort.value = "name";
  assert.doesNotThrow(() => change(sort));
  assert.equal(location.hash, "#/current/models?scope=tree&sort=name");

  // "Default" clears the sort: the table state empties and no `sort` is left.
  const cleared = element("sort");
  cleared.value = "default";
  assert.doesNotThrow(() => change(cleared));
  assert.equal(location.hash, "#/current/models?scope=tree");
  assert.equal(element("sort").querySelectorAll("option").length, 3);
});

test("a restored range is canonicalized into the address bar, so one navigation renders once", () => {
  const harness = runClient(bundleFixture());
  const { element, click, location, hashchange, preset, renders } = harness;

  preset("7");
  assert.equal(element("range-dates").textContent, "2026-01-27 → 2026-02-02");

  const before = renders();
  click(navLink(element("navigation"), "history"));
  assert.equal(renders() - before, 1);

  // Back to the current view: its remembered 7D range is restored, and the
  // address bar now names the route that was applied — exactly one render.
  click(navLink(element("navigation"), "current"));
  assert.equal(renders() - before, 2);
  assert.equal(location.hash, "#/current/overview?scope=tree&preset=7");
  assert.equal(element("range-dates").textContent, "2026-01-27 → 2026-02-02");

  // The event the browser fires for the hash navigate() wrote re-parses to the
  // applied route, so it renders nothing and the restored range stays put.
  hashchange();
  assert.equal(renders() - before, 2);
  assert.equal(element("range-dates").textContent, "2026-01-27 → 2026-02-02");
});

test("an address bar that refuses canonicalization never suppresses the render", () => {
  // The design chose hash routing so the document also works from `file://`
  // (design R5), where a browser may reject `history.replaceState`. The bootstrap
  // rewrite must not take the first render with it: the route stays applied in
  // memory, so the whole view renders and the applied key still dedupes.
  const harness = runClient(bundleFixture(), "", { replaceStateFails: true });
  const { element, hashchange, location, renders } = harness;

  assert.equal(renders(), 1);
  assert.equal(element("title").textContent, "A session, in focus.");
  assert.equal(element("range-dates").textContent, "2026-02-01 → 2026-02-02");
  assert.deepEqual(visibleTabs(element("tabs")), [
    "overview",
    "models",
    "tools",
    "environment",
    "agents",
    "integrations",
    "errors",
    "ledger",
  ]);
  assert.equal(currentTab(element("tabs")), "overview");

  // The address bar could not be canonicalized, so it is still empty — and the
  // event the browser sends for it re-parses to the route already applied: the
  // dedupe runs on the applied key, not on the hash, so nothing re-renders.
  assert.equal(location.hash, "");
  hashchange();
  assert.equal(renders(), 1);

  // Navigation still works: a real hash change is applied and rendered.
  location.hash = "#/history/overview";
  hashchange();
  assert.equal(renders(), 2);
  assert.equal(element("title").textContent, "Pick up the trail.");
});

test("a refused replacement on the search path still applies the typed query", () => {
  // The same file:// rejection reaches the in-progress search path: a keystroke
  // replaces the current entry, so a refused replacement must not throw out of
  // the input listener. The fallback is the hash itself, so the document still
  // renders the query the user just typed.
  const harness = runClient(bundleFixture(), "#/current/models?scope=tree", {
    replaceStateFails: true,
  });
  const { element, input, location, renders, texts } = harness;
  const rows = (): number => element("view").querySelectorAll("tr").length;
  const before = renders();
  assert.equal(rows(), 2); // the header row plus the one model row

  const typed = element("search");
  typed.value = "zzz";
  assert.doesNotThrow(() => input(typed));
  assert.equal(renders() - before, 1);
  assert.equal(location.hash, "#/current/models?scope=tree&q=zzz");
  assert.equal(rows(), 1);
  assert.equal(texts(element("view")).includes("acme"), false);
  // The typed state is in the route, so the re-render writes the box back.
  assert.equal(element("search").value, "zzz");
});

test("a discrete change pushes a history entry; only search typing replaces", () => {
  const harness = runClient(bundleFixture());
  const { element, click, change, input, location, preset, replacements } =
    harness;
  const start = replacements(); // the bootstrap canonicalization

  // Selecting a preset is a discrete navigation, so it may not overwrite the
  // entry it came from (design §9.2, R16b).
  preset("7");
  assert.equal(replacements() - start, 0);
  assert.equal(location.hash, "#/current/overview?scope=tree&preset=7");

  // Back restores the previous entry's range, because the preset change is its
  // own entry: the browser restores that hash and reports it.
  location.hash = "#/current/overview?scope=tree";
  harness.hashchange();
  assert.equal(element("range-dates").textContent, "2026-02-01 → 2026-02-02");

  // A sort change is discrete too.
  click(tabLink(element("tabs"), "models"));
  const sort = element("sort");
  sort.value = "name";
  change(sort);
  assert.equal(replacements() - start, 0);
  assert.equal(location.hash, "#/current/models?scope=tree&sort=name");

  // Typing in a search box is in progress, not a destination: it replaces.
  const search = element("search");
  search.value = "acme";
  input(search);
  assert.equal(replacements() - start, 1);
  assert.equal(location.hash, "#/current/models?scope=tree&q=acme&sort=name");
});

test("the Back and Inspect controls are real hash links", () => {
  const aggregate = runClient(bundleFixture(), "#/history/overview");
  // Only a session whose detail this document carries offers the control (the
  // fixture's second session is unavailable), and it is an anchor, not a bare
  // script-only element: Enter, middle-click and copy-link all work.
  const inspect = aggregate
    .element("view")
    .querySelectorAll("a")
    .filter((link) => link.dataset.session !== undefined);
  assert.equal(inspect.length, 1);
  assert.match(inspect[0]?.attributes.href ?? "", /^#\//);
  assert.equal(
    inspect[0]?.attributes.href,
    "#/history/overview?session=session-a",
  );

  // A selected session's detail carries the Back control, pointed at the
  // aggregate it came from.
  const detail = runClient(
    bundleFixture(),
    "#/history/models?session=session-a",
  );
  const back = detail
    .element("view")
    .querySelectorAll("a")
    .find((link) => link.dataset.back !== undefined);
  assert.match(back?.attributes.href ?? "", /^#\//);
  assert.equal(back?.attributes.href, "#/history/overview");

  // The href and the delegated click handler are the same destination.
  detail.click(back as StubElement);
  assert.equal(detail.location.hash, "#/history/overview");
});

test("every declared entity kind has an id space the route can name", () => {
  const harness = runClient(bundleFixture());
  const { client, location, hashchange } = harness;
  const ids: [string, string][] = [
    ["model", "acme/alpha"],
    ["tool", "tool:call-a"],
    [
      "agent",
      "subagent-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    ],
    ["error", "generation:g2"],
    ["integration", "context"],
    ["command", "review"],
    ["skill", "build"],
    ["resource", "local"],
  ];
  for (const [kind, id] of ids) {
    location.hash = `#/current/overview?scope=tree&entity=${encodeURIComponent(`${kind}:${id}`)}`;
    hashchange();
    assert.deepEqual(client.state.entity, { kind, id }, kind);
  }

  // A resource label the payload does not carry is still dropped, never echoed.
  location.hash =
    "#/current/overview?scope=tree&entity=resource%3A%2Fhome%2Fsecret";
  hashchange();
  assert.equal(client.state.entity, undefined);
});

test("a tab that had keyboard focus keeps it across a re-render", () => {
  const harness = runClient(bundleFixture());
  const { activeElement, click, element, preset } = harness;
  const tabs = element("tabs");

  tabLink(tabs, "models").focus();
  assert.equal(activeElement()?.dataset.tab, "models");

  // A range change rebuilds the strip: the focused tab is put back, not dropped.
  preset("7");
  assert.equal(activeElement()?.dataset.tab, "models");

  // Activating a tab by keyboard (Enter on the focused anchor) keeps focus on it.
  click(tabLink(tabs, "models"));
  assert.equal(currentTab(tabs), "models");
  assert.equal(activeElement()?.dataset.tab, "models");

  // A section change belongs to the heading: the strip does not take that focus.
  click(navLink(element("navigation"), "history"));
  assert.equal(activeElement()?.id, "title");
});

test("rows link to their destination with the route context preserved", () => {
  const html = renderInspectorBundle(bundleFixture());
  // Document-level: the highlight rule and its one writer are the document's own.
  assert.match(html, /\.entity-focus\{/);
  assert.match(html, /classList\.add\("entity-focus"\)/);
  assert.match(html, /"nav\.entityFocus":/);

  const harness = runClient(bundleFixture());
  const { activeElement, click, element, location, preset } = harness;
  preset("7");

  // The Overview's model row is an anchor aimed at the Models tab: it keeps the
  // active scope and range and names the model's own id in the route.
  const model = entityNode(element("view"), "model:acme/alpha");
  assert.equal(model.tagName, "a");
  assert.equal(
    model.attributes.href,
    "#/current/models?scope=tree&preset=7&entity=model%3Aacme%2Falpha",
  );

  click(model);
  assert.equal(location.hash, model.attributes.href);
  assert.equal(currentTab(element("tabs")), "models");
  // The destination row is what received the focus effect, and the range the
  // link was built with is the range the destination renders.
  assert.equal(activeElement()?.dataset.entity, "model:acme/alpha");
  assert.equal(element("range-dates").textContent, "2026-01-27 → 2026-02-02");
});

test("an Overview tool row links to the tools summary focused on that tool", () => {
  const harness = runClient(bundleFixture());
  const { activeElement, click, element, location } = harness;

  const tool = entityNode(element("view"), "tool:read");
  assert.equal(tool.tagName, "a");
  assert.equal(tool.textContent, "read");
  assert.equal(
    tool.attributes.href,
    "#/current/tools?scope=tree&entity=tool%3Aread",
  );

  click(tool);
  assert.equal(location.hash, tool.attributes.href);
  assert.equal(currentTab(element("tabs")), "tools");
  // The focused row is the tool's own summary row, which is also the filter
  // control that narrows the calls timeline in place (design §9.4, §9.5).
  assert.equal(activeElement()?.dataset.entity, "tool:read");
  assert.equal(activeElement()?.dataset.toolFilter, "read");
});

test("there is no Agent to Models link", () => {
  const html = renderInspectorBundle(bundleFixture());
  // The agent row's own code builds no model destination at all: child model and
  // thinking stay agent-detail metadata (design §9.4, R17).
  const agents = html.slice(
    html.indexOf("function parentCell"),
    html.indexOf("function agentSummary"),
  );
  assert.equal(/linkRow\("model"|tabFor\("model"|"models"/.test(agents), false);

  const harness = runClient(bundleFixture(), "#/current/agents?scope=tree");
  const view = harness.element("view");
  assert.equal(
    view
      .querySelectorAll("a")
      .filter((link) => (link.attributes.href ?? "").includes("models")).length,
    0,
  );
  assert.equal(
    entityNodes(view).filter((node) =>
      (node.dataset.entity ?? "").startsWith("model:"),
    ).length,
    0,
  );
});

test("an entity anchor carries an id already present in the payload", () => {
  const harness = runClient(bundleFixture());
  const { click, client, element, location } = harness;
  const followed: string[] = [];

  // Every entity link every tab renders is followed: the document's own
  // validation keeps the id in the route, and an id the payload does not expose
  // would be dropped (and canonicalized out of the address bar) instead.
  for (const tab of [
    "overview",
    "models",
    "tools",
    "environment",
    "agents",
    "integrations",
    "errors",
  ]) {
    client.state.section = "current";
    client.state.tab = tab;
    client.state.scope = "tree";
    client.render();
    const links = entityNodes(element("view")).filter(
      (node) => node.tagName === "a",
    );
    for (const link of links) {
      const entity = link.dataset.entity as string;
      const separator = entity.indexOf(":");
      followed.push(entity);
      click(link);
      assert.deepEqual(
        client.state.entity,
        { kind: entity.slice(0, separator), id: entity.slice(separator + 1) },
        entity,
      );
      assert.equal(
        location.hash.includes(`entity=${encodeURIComponent(entity)}`),
        true,
        entity,
      );
    }
  }

  // The links the fixture can render are actually covered by the loop above.
  assert.equal(followed.includes("command:review"), true);
  assert.equal(followed.includes("integration:context"), true);
  assert.equal(followed.includes("model:acme/alpha"), true);
});

test("the error join links a failed call to its error and the error row back", async () => {
  const harness = runClient(
    await loadInspectorBundle({
      ...bundleInput,
      loadCurrent: async () => modelWithErrorAndThreeChildren(),
    }),
    "#/current/tools?scope=tree",
  );
  const { activeElement, click, element } = harness;

  // The failed call is joined to its error by the canonical tool id (§7.5-1).
  const failed = entityNode(element("view"), "error:tool:call_bash");
  assert.equal(failed.tagName, "a");
  assert.equal(failed.textContent, "Failed");
  assert.equal(
    failed.attributes.href,
    "#/current/errors?scope=tree&entity=error%3Atool%3Acall_bash",
  );
  click(failed);
  assert.equal(currentTab(element("tabs")), "errors");
  assert.equal(activeElement()?.dataset.entity, "error:tool:call_bash");

  // The error row's own references: its tool call, and every candidate child run
  // labelled with that run's own role (one-to-many, none named as the cause).
  const tool = entityNode(element("view"), "tool:tool:call_bash");
  assert.equal(tool.textContent, "bash");
  const runs = entityNodes(element("view")).filter((node) =>
    (node.dataset.entity ?? "").startsWith("agent:"),
  );
  assert.deepEqual(
    runs.map((node) => node.textContent),
    ["reviewer", "researcher", "validator"],
  );

  click(tool);
  assert.equal(currentTab(element("tabs")), "tools");
  assert.equal(activeElement()?.dataset.entity, "tool:tool:call_bash");
  assert.equal(activeElement()?.textContent, "bash");

  const last = runs[2] as StubElement;
  click(last);
  assert.equal(currentTab(element("tabs")), "agents");
  assert.equal(activeElement()?.dataset.entity, last.dataset.entity);
  assert.equal(activeElement()?.textContent, "validator");
});

test("an agent row links its resolved parent run", async () => {
  const harness = runClient(
    await loadInspectorBundle({
      ...bundleInput,
      loadCurrent: async () => modelWithOrphanChildAndParent(),
    }),
    "#/current/agents?scope=tree",
  );
  const { activeElement, click, element } = harness;
  const view = element("view");

  // Exactly one parent is resolved in this projection, and it is a real anchor
  // labelled with that run's own role — never the bare opaque id.
  const links = entityNodes(view).filter(
    (node) =>
      node.tagName === "a" && (node.dataset.entity ?? "").startsWith("agent:"),
  );
  assert.equal(links.length, 1);
  const parent = links[0] as StubElement;
  assert.equal(parent.textContent, "reviewer");
  assert.equal(
    parent.attributes.href,
    `#/current/agents?scope=tree&entity=${encodeURIComponent(parent.dataset.entity as string)}`,
  );

  click(parent);
  assert.equal(activeElement()?.dataset.entity, parent.dataset.entity);
  assert.equal(activeElement()?.textContent, "reviewer");

  // The parent verdicts that are not resolved stay plain text.
  assert.equal(
    view
      .querySelectorAll("a")
      .filter((link) => link.textContent === "Unavailable").length,
    0,
  );
});

test("an in-scope parent whose role is unknown is a real anchor, not a bare id", async () => {
  const model = modelWithOrphanChildAndParent();
  const parent = model.report.agents.find((run) => run.agent === "reviewer");
  if (parent === undefined)
    throw new Error("the fixture carries no parent run");
  const parentId = parent.id;
  // The producer published no role for the parent: the row is still in scope.
  delete parent.agent;

  const harness = runClient(
    await loadInspectorBundle({
      ...bundleInput,
      loadCurrent: async () => model,
    }),
    "#/current/agents?scope=tree",
  );
  const links = entityNodes(harness.element("view")).filter(
    (node) =>
      node.tagName === "a" && node.dataset.entity === `agent:${parentId}`,
  );
  assert.equal(links.length, 1);
  const link = links[0] as StubElement;
  assert.equal(link.textContent, "Unavailable");
  assert.equal(link.textContent.includes(parentId), false);
  assert.equal(
    link.attributes.href,
    `#/current/agents?scope=tree&entity=${encodeURIComponent(`agent:${parentId}`)}`,
  );
});

test("integration and inventory rows link to their own detail", () => {
  const integrations = runClient(
    bundleFixture(),
    "#/current/integrations?scope=tree",
  );
  const integration = entityNode(
    integrations.element("view"),
    "integration:context",
  );
  assert.equal(integration.tagName, "a");
  assert.equal(
    integration.attributes.href,
    "#/current/integrations?scope=tree&entity=integration%3Acontext",
  );
  integrations.click(integration);
  assert.equal(
    integrations.activeElement()?.dataset.entity,
    "integration:context",
  );

  const commands = runClient(
    bundleFixture(),
    "#/current/environment?scope=tree",
  );
  const command = entityNode(commands.element("view"), "command:review");
  assert.equal(
    command.attributes.href,
    "#/current/environment?scope=tree&entity=command%3Areview",
  );
  commands.click(command);
  assert.equal(commands.activeElement()?.dataset.entity, "command:review");
});

test("an inventory destination opens the Environment sub-section that lists it", () => {
  const skills = runClient(
    bundleFixture(),
    "#/current/environment?scope=tree&entity=skill%3Abuild",
  );
  // The entity kind selects the sub-section, so the destination renders the row
  // the link named and that row is the one focused.
  assert.equal(
    skills.texts(skills.element("view")).includes("Invocations"),
    true,
  );
  assert.equal(skills.activeElement()?.dataset.entity, "skill:build");

  const resources = runClient(
    bundleFixture(),
    "#/current/environment?scope=tree&entity=resource%3Alocal",
  );
  assert.equal(
    resources.texts(resources.element("view")).includes("Prompts"),
    true,
  );
  assert.equal(resources.activeElement()?.dataset.entity, "resource:local");

  // The default sub-section is still the first one when no inventory is named.
  const plain = runClient(bundleFixture(), "#/current/environment?scope=tree");
  assert.equal(
    plain.texts(plain.element("view")).includes("Description"),
    true,
  );
});

test("the entity focus effect fires on a navigation, never on a range or table change", () => {
  const harness = runClient(
    bundleFixture(),
    "#/current/models?scope=tree&entity=model%3Aacme%2Falpha",
  );
  const { activeElement, element, input, preset } = harness;

  // The deep link lands on the row it named.
  assert.equal(activeElement()?.dataset.entity, "model:acme/alpha");

  // A range change re-renders the same view without stealing focus.
  preset("7");
  assert.equal(activeElement()?.dataset.entity, undefined);
  assert.equal(element("range-dates").textContent, "2026-01-27 → 2026-02-02");

  // A table-only change keeps the caret where the reader put it, even though the
  // route still carries the entity: the stub input models a real caret here.
  const search = element("search") as StubElement & { selectionStart?: number };
  search.selectionStart = 0;
  search.focus();
  search.value = "acme";
  input(search);
  assert.equal(activeElement()?.id, "search");
  assert.equal(activeElement()?.dataset.entity, undefined);
});

test("an entity link inside a history session keeps the session, not the scope", () => {
  const harness = runClient(
    bundleFixture(),
    "#/history/overview?session=session-a",
  );
  const { activeElement, click, element, location } = harness;

  const model = entityNode(element("view"), "model:acme/alpha");
  assert.equal(
    model.attributes.href,
    "#/history/models?session=session-a&entity=model%3Aacme%2Falpha",
  );

  click(model);
  assert.equal(location.hash, model.attributes.href);
  assert.equal(element("breadcrumb").textContent, "session-a");
  assert.equal(activeElement()?.dataset.entity, "model:acme/alpha");
});

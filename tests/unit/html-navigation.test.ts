import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type { InspectorBundle } from "../../src/ui/bundle.ts";
import {
  assertInlinedModulesEvaluate,
  renderInspectorBundle,
} from "../../src/ui/html.ts";
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

  // ...and returning to the current view restores that view's remembered range
  // without the entering view's memory riding in the hash (design §5.3).
  click(navLink(element("navigation"), "current"));
  assert.equal(location.hash, "#/current/overview?scope=tree");
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

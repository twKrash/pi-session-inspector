import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type { InspectorBundle } from "../../src/ui/bundle.ts";
import { ENGLISH_CATALOG } from "../../src/ui/report-projection.ts";
import {
  projectInspectorUi,
  type InspectorUiSnapshot,
} from "../../src/ui/ui-projection.ts";
import { WEB_ASSETS } from "../../src/ui/web-assets.ts";
import {
  createWebClient,
  type StubElement,
} from "../helpers/client-harness.ts";

/**
 * The ordinary browser assets (`src/ui/web/`) are the interactive application:
 * route, range intent, navigation, HTTP bootstrap and DOM rendering. These tests
 * execute the shipped bytes in a `vm` context with a stub DOM, so what they pin
 * is what a browser runs. Report semantics stay pinned in `ui-projection.test.ts`
 * and `snapshot.test.ts`; nothing here recomputes them.
 */

const ASSET_PATHS = {
  shell: "src/ui/web/shell.html",
  style: "src/ui/web/style.css",
  route: "src/ui/web/route.js",
  range: "src/ui/web/range.js",
  client: "src/ui/web/client.js",
} as const;

const SCRIPTS: readonly (keyof typeof ASSET_PATHS)[] = [
  "route",
  "range",
  "client",
];

const PROJECT_ROOT = new URL("../../", import.meta.url);

/**
 * A value that crossed the `vm` realm, as its plain test-realm structure: the
 * scripts' objects have their own `Object.prototype`, which strict deep equality
 * would otherwise report as a difference.
 */
function plain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function assetText(name: keyof typeof ASSET_PATHS): string {
  return readFileSync(new URL(ASSET_PATHS[name], PROJECT_ROOT), "utf8");
}

/** The fixture bundle, projected by L2 exactly as the API returns it. */
function uiSnapshot(): InspectorUiSnapshot {
  const bundle = JSON.parse(
    readFileSync(
      new URL("../fixtures/bundles/inspector-bundle.json", import.meta.url),
      "utf8",
    ),
  ) as InspectorBundle;
  return projectInspectorUi({ bundle });
}

const ALL_TABS = [
  "overview",
  "models",
  "tools",
  "environment",
  "agents",
  "integrations",
  "errors",
  "ledger",
];

// ---------------------------------------------------------------------------
// The asset boundary
// ---------------------------------------------------------------------------

test("the loader reads exactly the five known files and serves their bytes", () => {
  assert.deepEqual(Object.keys(WEB_ASSETS).sort(), [
    "client",
    "range",
    "route",
    "shell",
    "style",
  ]);
  for (const name of Object.keys(ASSET_PATHS) as (keyof typeof ASSET_PATHS)[]) {
    assert.equal(typeof WEB_ASSETS[name], "string", name);
    assert.equal(WEB_ASSETS[name].length > 0, true, name);
    assert.equal(WEB_ASSETS[name], assetText(name), name);
  }
  // The record is data: no path lookup, no function, no locator surface.
  assert.deepEqual(
    Object.values(WEB_ASSETS).map((value) => typeof value),
    ["string", "string", "string", "string", "string"],
  );
});

test("the stylesheet is the one source for the asset and the snapshot", () => {
  // The snapshot hashes the shipped bytes, so the bytes cannot drift apart.
  const snapshot = readFileSync(
    new URL("src/ui/snapshot.ts", PROJECT_ROOT),
    "utf8",
  );
  assert.equal(snapshot.includes("WEB_ASSETS"), true);
  assert.equal(
    WEB_ASSETS.style.startsWith("\n\n:root{color-scheme:light"),
    true,
  );
  assert.equal(WEB_ASSETS.style.trimEnd().endsWith("}"), true);
  assert.equal(WEB_ASSETS.style.includes("<"), false);
});

test("the shell is report-free and loads the known assets in explicit order", () => {
  const shell = WEB_ASSETS.shell;
  // No report payload, no catalog blob, no attribute a report could arrive in.
  for (const forbidden of [
    "report-data",
    "catalog-data",
    "application/json",
    "data-session=",
    "data-metric=",
    "sessionId",
    "aria-current=",
  ]) {
    assert.equal(shell.includes(forbidden), false, forbidden);
  }
  // Classic scripts only: every script tag names a file, and nothing is inline.
  const scriptTags = shell.match(/<script[^>]*>/g) ?? [];
  assert.equal(scriptTags.length, 3);
  for (const tag of scriptTags) {
    assert.match(tag, /^<script src="\/[a-z]+\.js">$/);
  }
  assert.deepEqual(
    [...shell.matchAll(/(?:href|src)="(\/[^"]+)"/g)].map((match) => match[1]),
    ["/style.css", "/route.js", "/range.js", "/client.js"],
  );
  // The fixed landmarks the client renders into.
  for (const landmark of [
    "loading",
    "error",
    "navigation",
    "scope",
    "range",
    "tabs",
    "view",
    "announcement",
  ]) {
    assert.equal(shell.includes(`id="${landmark}"`), true, landmark);
  }
});

test("no shipped asset carries a storage, socket, or html sink", () => {
  for (const name of [...SCRIPTS, "shell"] as const) {
    const source = WEB_ASSETS[name];
    for (const forbidden of [
      "innerHTML",
      "outerHTML",
      "insertAdjacentHTML",
      "document.write",
      "localStorage",
      "sessionStorage",
      "document.cookie",
      "WebSocket",
      "EventSource",
      "XMLHttpRequest",
      "eval(",
      "new Function",
    ]) {
      assert.equal(source.includes(forbidden), false, `${name}: ${forbidden}`);
    }
  }
  // Classic scripts: no module syntax, no bundler, no filesystem access.
  for (const name of SCRIPTS) {
    const source = WEB_ASSETS[name];
    for (const forbidden of [
      "import ",
      "export ",
      "require(",
      "node:fs",
      "process.",
    ]) {
      assert.equal(source.includes(forbidden), false, `${name}: ${forbidden}`);
    }
  }
});

test("the shipped scripts contain no L2 range, aggregation, or verdict function", () => {
  // Names L2 owns. An asset that mentions one is implementing report semantics
  // a second time, whatever its call site intended.
  const l2Names = [
    "resolveRange",
    "filterView",
    "historyRowRange",
    "periodTotals",
    "periodComposition",
    "isInRange",
    "latestObservedDate",
    "shiftUtcDay",
    "presetRange",
    "parseRangeOptions",
    "sessionView",
    "projectReport",
    "projectInspectorUi",
    "aggregateUsageLabels",
    "toolSummary(",
    "toolCalls(",
    "toolDuration(",
    "errorHeadline",
    "modelRangeRows",
    "reachesBeforeRetained",
    "partialContribution",
  ];
  for (const name of SCRIPTS) {
    const source = WEB_ASSETS[name];
    for (const forbidden of l2Names) {
      assert.equal(source.includes(forbidden), false, `${name}: ${forbidden}`);
    }
    // No date arithmetic at all: a range is an intent, never a computed span.
    assert.equal(
      /new Date|Date\.parse|Date\.now|Date\.UTC|Date\.\(/.test(source),
      false,
      `${name}: date arithmetic`,
    );
  }
});

test("no raw producer field name or host path reaches a browser asset", () => {
  for (const name of [...SCRIPTS, "shell"] as const) {
    const source = WEB_ASSETS[name];
    for (const forbidden of [
      "tool_result",
      "tool_use",
      "input_tokens",
      "output_tokens",
      "cache_read_tokens",
      "cache_write_tokens",
      "usage_lines",
      "session_file",
      "filePath",
      "rawMessage",
      "assistant_text",
      "/home/",
    ]) {
      assert.equal(source.includes(forbidden), false, `${name}: ${forbidden}`);
    }
  }
});

test("the browser copy is the server catalog, not a second set of strings", () => {
  const literal = /const COPY = (\{[\s\S]*?\n\s*\})/.exec(WEB_ASSETS.client);
  assert.notEqual(literal, null, "client.js must declare its copy literal");
  const copy = JSON.parse(literal?.[1] as string) as Record<string, string>;
  assert.equal(Object.keys(copy).length > 40, true);
  const catalog: Readonly<Record<string, string>> = ENGLISH_CATALOG;
  for (const [key, value] of Object.entries(copy)) {
    assert.equal(catalog[key], value, key);
  }
});

test("the assets own one namespace with route, range, and start", async () => {
  const harness = createWebClient({ responses: [uiSnapshot()] });
  await harness.start();
  const injected = [
    "document",
    "window",
    "location",
    "history",
    "navigator",
    "fetch",
    "console",
    "setTimeout",
  ];
  const added = Object.keys(harness.context).filter(
    (key) => !injected.includes(key) && key !== "globalThis",
  );
  assert.deepEqual(added, ["SessionInspectorWeb"]);
  const namespace = harness.context.SessionInspectorWeb as Record<
    string,
    unknown
  >;
  assert.deepEqual(Object.keys(namespace).sort(), ["range", "route", "start"]);
  assert.equal(typeof namespace.start, "function");
  // The route module owns the closed vocabularies and the four route behaviors.
  const route = namespace.route as Record<string, unknown>;
  assert.deepEqual(Object.keys(route).sort(), [
    "derive",
    "entityKinds",
    "key",
    "parse",
    "rangeQuery",
    "sections",
    "serialize",
    "tabs",
  ]);
  assert.deepEqual(plain(route.sections), ["current", "history", "global"]);
  assert.deepEqual(plain(route.entityKinds), [
    "model",
    "tool",
    "agent",
    "error",
    "integration",
    "command",
    "skill",
    "resource",
  ]);
  // The range module owns the intent grammar and the bounded preset vocabulary.
  const range = namespace.range as Record<string, unknown>;
  assert.deepEqual(Object.keys(range).sort(), [
    "parse",
    "presets",
    "query",
    "serialize",
  ]);
  assert.deepEqual(plain(range.presets), [7, 14, 30]);
});

// ---------------------------------------------------------------------------
// route.js
// ---------------------------------------------------------------------------

type ParsedRoute = {
  route: {
    section: string;
    tab: string;
    scope: string;
    session?: string;
    range?: { kind: string; preset?: number; from?: string; to?: string };
    entity?: { kind: string; id: string };
    table?: { query?: string; sort?: string };
  };
  notice?: string;
};

type RouteNamespace = {
  parse(
    hash: string,
    options: {
      scope: string;
      capabilities: Record<string, string[]>;
      knownIds: readonly string[];
    },
  ): ParsedRoute;
  serialize(route: unknown): string;
  key(route: unknown): string;
  derive(
    route: unknown,
    capabilities: Record<string, string[]>,
  ): {
    activeSection: string;
    activeTab: string;
    visibleTabs: string[];
    scope: string;
    notice?: string;
    focusTarget: string;
  };
};

type RangeNamespace = {
  parse(
    query: string,
  ): { ok: true; intent?: unknown } | { ok: false; code: string };
  serialize(intent: unknown): [string, string][];
  query(intent: unknown): string;
};

/** The namespaces exactly as the shipped scripts expose them. */
function namespaces(): { route: RouteNamespace; range: RangeNamespace } {
  const namespace = createWebClient({}).context.SessionInspectorWeb as {
    route: RouteNamespace;
    range: RangeNamespace;
  };
  return { route: namespace.route, range: namespace.range };
}

const CAPABILITIES = {
  current: ALL_TABS,
  history: ["overview"],
  global: ["overview"],
};

test("the route round-trips the canonical parameter order", () => {
  const { route } = namespaces();
  const cases: [Record<string, unknown>, string][] = [
    [
      { section: "current", tab: "overview", scope: "tree" },
      "#/current/overview?scope=tree",
    ],
    [
      {
        section: "current",
        tab: "models",
        scope: "active",
        range: { kind: "preset", preset: 7 },
      },
      "#/current/models?scope=active&preset=7",
    ],
    [
      {
        section: "history",
        tab: "overview",
        scope: "tree",
        range: { kind: "custom", from: "2026-01-01", to: "2026-01-31" },
      },
      "#/history/overview?from=2026-01-01&to=2026-01-31",
    ],
    [
      {
        section: "history",
        tab: "overview",
        scope: "tree",
        session: "session-a",
        entity: { kind: "model", id: "acme/alpha" },
        table: { query: "acme", sort: "name" },
      },
      "#/history/overview?session=session-a&entity=model%3Aacme%2Falpha&q=acme&sort=name",
    ],
  ];
  for (const [input, expected] of cases) {
    assert.equal(route.serialize(input), expected);
    assert.equal(route.key(input), expected);
    const parsed = route.parse(expected, {
      scope: "active",
      capabilities: CAPABILITIES,
      knownIds: ["session-a", "acme/alpha"],
    });
    assert.equal(parsed.notice, undefined, expected);
    assert.equal(route.serialize(parsed.route), expected, expected);
  }
});

test("the route coerces its closed vocabularies and never echoes an unknown id", () => {
  const { route } = namespaces();
  const parsed = route.parse(
    "#/nope/sideways?scope=sideways&session=SECRET&entity=tool%3ASECRET&q=kept",
    { scope: "active", capabilities: CAPABILITIES, knownIds: ["session-a"] },
  );
  assert.equal(parsed.route.section, "current");
  assert.equal(parsed.route.tab, "overview");
  assert.equal(parsed.route.scope, "active");
  assert.equal("session" in parsed.route, false);
  assert.equal("entity" in parsed.route, false);
  assert.equal(parsed.notice, "section-unavailable");
  assert.equal(route.serialize(parsed.route).includes("SECRET"), false);
  // The one table field the grammar accepts is carried through as given.
  assert.equal(parsed.route.table?.query, "kept");

  // A known session and a known entity id are kept: the payload exposes them.
  const kept = route.parse(
    "#/history/overview?session=session-a&entity=tool%3Acall-a",
    {
      scope: "tree",
      capabilities: CAPABILITIES,
      knownIds: ["session-a", "call-a"],
    },
  );
  assert.equal(kept.route.session, "session-a");
  assert.deepEqual(plain(kept.route.entity), { kind: "tool", id: "call-a" });
  assert.equal(kept.notice, undefined);
});

test("the route parses a range intent and refuses to resolve one", () => {
  const { route, range } = namespaces();
  const options = {
    scope: "active",
    capabilities: CAPABILITIES,
    knownIds: [],
  };
  assert.deepEqual(
    plain(
      route.parse("#/current/overview?scope=tree&preset=14", options).route
        .range,
    ),
    {
      kind: "preset",
      preset: 14,
    },
  );
  assert.deepEqual(
    plain(
      route.parse(
        "#/current/overview?scope=tree&from=2026-01-01&to=2026-01-02",
        options,
      ).route.range,
    ),
    { kind: "custom", from: "2026-01-01", to: "2026-01-02" },
  );
  // A lone endpoint is not a range: nothing is applied, and the code is bounded.
  const lone = route.parse(
    "#/current/overview?scope=tree&from=2026-01-01",
    options,
  );
  assert.equal("range" in lone.route, false);
  assert.equal(lone.notice, "range-restored");
  // The intent vocabulary has no resolvable form in the browser.
  for (const name of [
    "resolveRange",
    "filterView",
    "historyRowRange",
    "isInRange",
    "latestObservedDate",
    "parseRangeOptions",
  ]) {
    assert.equal(
      (range as unknown as Record<string, unknown>)[name],
      undefined,
      name,
    );
  }
});

test("the derived view coerces a tab the section cannot render", () => {
  const { route } = namespaces();
  const derived = route.derive(
    { section: "history", tab: "models", scope: "tree" },
    CAPABILITIES,
  );
  assert.equal(derived.activeSection, "history");
  assert.deepEqual(derived.visibleTabs, ["overview"]);
  assert.equal(derived.activeTab, "overview");
  assert.equal(derived.notice, "tab-unavailable");
  assert.equal(derived.focusTarget, "section-heading");
  assert.equal("range" in derived, false);

  // A section that can render nothing is silent about its own default tab.
  const nothing = route.derive(
    { section: "current", tab: "overview", scope: "active" },
    { current: [], history: ["overview"], global: ["overview"] },
  );
  assert.deepEqual(nothing.visibleTabs, []);
  assert.equal(nothing.notice, undefined);
});

// ---------------------------------------------------------------------------
// range.js
// ---------------------------------------------------------------------------

test("the range module parses and serializes intent, and rejects the rest", () => {
  const { range } = namespaces();
  assert.deepEqual(plain(range.parse("preset=7")), {
    ok: true,
    intent: { kind: "preset", preset: 7 },
  });
  assert.deepEqual(plain(range.parse("")), { ok: true });
  assert.deepEqual(plain(range.parse("from=2026-01-01&to=2026-01-02")), {
    ok: true,
    intent: { kind: "custom", from: "2026-01-01", to: "2026-01-02" },
  });
  assert.deepEqual(plain(range.serialize({ kind: "preset", preset: 30 })), [
    ["preset", "30"],
  ]);
  assert.deepEqual(
    plain(
      range.serialize({ kind: "custom", from: "2026-01-01", to: "2026-01-02" }),
    ),
    [
      ["from", "2026-01-01"],
      ["to", "2026-01-02"],
    ],
  );
  assert.equal(range.query({ kind: "preset", preset: 7 }), "preset=7");
  assert.equal(
    range.query({ kind: "custom", from: "2026-01-01", to: "2026-01-02" }),
    "from=2026-01-01&to=2026-01-02",
  );
  for (const invalid of [
    "preset=7&from=2026-01-01",
    "from=2026-01-01",
    "to=2026-01-02",
    "from=2026-01-02&to=2026-01-01",
    "from=2026-1-1&to=2026-01-02",
    "preset=9",
    "preset=",
    "preset=7&preset=7",
    "scope=tree",
    `preset=${"7".repeat(600)}`,
  ]) {
    assert.deepEqual(
      plain(range.parse(invalid)),
      { ok: false, code: "invalid-range" },
      invalid,
    );
  }
});

// ---------------------------------------------------------------------------
// client.js: bootstrap and requests
// ---------------------------------------------------------------------------

const TOKEN = "Kq3Zt0m3Yc4v6b8n1m2Q4w5E6r7T8y9U0iO1p2A3s4D";

/** The kinds of the first events, in the order the client performed them. */
function kinds(events: readonly { kind: string }[]): string[] {
  return events.map((event) => event.kind);
}

test("the bootstrap consumes the token fragment before parsing or requesting", async () => {
  const harness = createWebClient({
    responses: [uiSnapshot()],
    hash: `#token=${TOKEN}`,
  });
  await harness.start();

  // The fragment is replaced first, then the request is made, then the address
  // bar is parsed: the token cannot reach either step.
  assert.deepEqual(kinds(harness.events).slice(0, 3), [
    "replaceState",
    "fetch",
    "parse",
  ]);
  assert.equal(kinds(harness.events).includes("hashAssign"), false);
  for (const hash of harness.routeParses()) {
    assert.equal(hash.includes("token"), false, hash);
  }
  assert.equal(harness.location.hash.includes("token"), false);
  assert.equal(harness.replacements() > 0, true);

  // The token travels as the bearer credential and nowhere else.
  assert.deepEqual(harness.fetches(), [
    { url: "/api/v1/ui", authorization: `Bearer ${TOKEN}` },
  ]);
  // The applied route is canonical, and its scope is the DTO's own initial scope.
  assert.equal(harness.location.hash, "#/current/overview?scope=tree");
  assert.equal(harness.element("title").textContent, "A session, in focus.");
});

test("a token is never accepted from a query, storage, or a cookie", async () => {
  const harness = createWebClient({
    responses: [uiSnapshot()],
    hash: "#/current/overview?scope=tree&token=SECRET",
  });
  await harness.start();
  // A token in the fragment's query parameters authenticates nothing, and the
  // unknown parameter is not echoed into the address bar either.
  assert.deepEqual(harness.fetches(), [
    { url: "/api/v1/ui", authorization: "" },
  ]);
  assert.equal(harness.location.hash, "#/current/overview?scope=tree");
  // The page's own scratch space carries no credential surface at all.
  assert.equal("localStorage" in harness.context, false);
  assert.equal("sessionStorage" in harness.context, false);
});

test("a range intent is the only query the client sends", async () => {
  const harness = createWebClient({
    responses: [uiSnapshot()],
    hash: "#/current/models?scope=tree&preset=7&q=acme",
  });
  await harness.start();
  assert.deepEqual(harness.fetches(), [
    { url: "/api/v1/ui?preset=7", authorization: "" },
  ]);
  // The route names the tab, the scope and the table query; the request does not.
  assert.equal(
    harness.location.hash,
    "#/current/models?scope=tree&preset=7&q=acme",
  );
  assert.equal(harness.element("title").textContent, "A session, in focus.");
  assert.equal(tabLink(harness, "models").attributes["aria-current"], "page");
});

test("the loading and error landmarks report the request state", async () => {
  const deferred = createWebClient({
    responses: [uiSnapshot()],
    deferFetch: true,
  });
  const started = deferred.start();
  assert.equal(deferred.element("loading").hidden, false);
  assert.equal(deferred.element("error").hidden, true);
  deferred.releaseFetch();
  await started;
  assert.equal(deferred.element("loading").hidden, true);
  assert.equal(deferred.element("error").hidden, true);
  assert.equal(deferred.element("title").textContent, "A session, in focus.");

  // A boundary failure renders bounded copy, never the transport's own text.
  const failed = createWebClient({
    responses: [uiSnapshot()],
    fetchFailure: "http",
  });
  await failed.start();
  assert.equal(failed.element("error").hidden, false);
  assert.equal(failed.element("loading").hidden, true);
  assert.equal(failed.element("view").children.length, 0);
  const detail = failed.element("error-detail").textContent;
  assert.equal(detail.length > 0, true);
  assert.equal(
    /TypeError|Failed to fetch|401|Unauthorized/.test(detail),
    false,
  );

  // Retry is a real request, and a still-failing boundary keeps the state.
  failed.click(failed.element("retry"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(failed.fetches().length, 2);
  assert.equal(failed.element("error").hidden, false);
});

/**
 * One turn of the event loop: a range change is a request, so the render that
 * follows it lands after the response the harness already has in hand.
 */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// client.js: state, navigation, and rendering
// ---------------------------------------------------------------------------

/** One sidebar link, by the section it navigates to. */
function navLink(harness: Harness, section: string): StubElement {
  const link = harness
    .element("navigation")
    .querySelectorAll("a")
    .find((candidate) => candidate.dataset.section === section);
  if (link === undefined) throw new Error(`no sidebar link for ${section}`);
  return link;
}

/** One tab link, by the tab it navigates to. */
function tabLink(harness: Harness, tab: string): StubElement {
  const link = harness
    .element("tabs")
    .querySelectorAll("a")
    .find((candidate) => candidate.dataset.tab === tab);
  if (link === undefined) throw new Error(`no tab link for ${tab}`);
  return link;
}

/** The visible tab set, in the order the client renders it. */
function visibleTabs(harness: Harness): (string | undefined)[] {
  return harness
    .element("tabs")
    .querySelectorAll("a")
    .map((link) => link.dataset.tab);
}

/** The tab the client marked current; `aria-current` is render output. */
function currentTab(harness: Harness): string | undefined {
  return harness
    .element("tabs")
    .querySelectorAll("a")
    .find((link) => link.attributes["aria-current"] === "page")?.dataset.tab;
}

/** One control of a rendered group, by the data attribute it carries. */
function control(
  harness: Harness,
  group: string,
  attribute: string,
  value: string,
): StubElement {
  const found = harness
    .element(group)
    .querySelectorAll("button")
    .find((button) => button.dataset[attribute] === value);
  if (found === undefined) throw new Error(`no ${attribute}=${value} control`);
  return found;
}

/** The overview metric cards, as the text a reader sees. */
function metrics(harness: Harness): string[] {
  return harness
    .element("view")
    .querySelectorAll(".metric")
    .map((metric) => harness.texts(metric).join(" "));
}

type Harness = ReturnType<typeof createWebClient>;

test("one navigation renders once, however many events report it", async () => {
  const harness = createWebClient({ responses: [uiSnapshot()] });
  await harness.start();
  const before = harness.renders();

  harness.click(navLink(harness, "history"));
  assert.equal(harness.element("title").textContent, "Pick up the trail.");
  assert.equal(harness.location.hash, "#/history/overview");
  assert.equal(harness.renders() - before, 1);

  // The browser reports the hash it just changed, and popstate too: the applied
  // key is unchanged, so neither event renders again (or asks the API again).
  harness.hashchange();
  harness.popstate();
  assert.equal(harness.renders() - before, 1);
  assert.equal(harness.fetches().length, 1);
});

test("a deep link coerces a tab the section cannot render", async () => {
  const snapshot = uiSnapshot();
  const aggregate = createWebClient({
    responses: [snapshot],
    hash: "#/history/models",
  });
  await aggregate.start();
  assert.deepEqual(visibleTabs(aggregate), ["overview"]);
  assert.equal(currentTab(aggregate), "overview");
  assert.equal(
    aggregate.element("route-notice").textContent,
    "That view isn't available here.",
  );

  // The same deep link against a selected session is honoured: a session detail
  // carries a full report, so Models is a real destination.
  const detail = createWebClient({
    responses: [snapshot],
    hash: "#/history/models?session=session-a",
  });
  await detail.start();
  assert.deepEqual(visibleTabs(detail), ALL_TABS);
  assert.equal(currentTab(detail), "models");
  assert.equal(detail.element("breadcrumb").textContent, "session-a");
  assert.equal(detail.element("route-notice").hidden, true);
  // Exactly one sidebar link is current, and it is the section the route names.
  assert.equal(
    detail
      .element("navigation")
      .querySelectorAll("a")
      .filter((link) => link.attributes["aria-current"] === "page").length,
    1,
  );
  assert.equal(navLink(detail, "history").attributes["aria-current"], "page");
});

test("the current scope buttons select the DTO's own views", async () => {
  const snapshot = uiSnapshot();
  const harness = createWebClient({ responses: [snapshot], hash: "" });
  await harness.start();
  // The two scopes are distinct projections, with their own resolved ranges.
  const activeRange = snapshot.current.active.range?.resolved;
  const treeRange = snapshot.current.tree.range?.resolved;
  assert.notEqual(activeRange?.from, treeRange?.from);
  const dates = (): string => harness.element("range-dates").textContent;
  const scopeControl = (scope: string): StubElement =>
    control(harness, "scope", "scope", scope);

  // The bootstrap applies the DTO's own initial scope (tree for this fixture).
  assert.equal(harness.location.hash, "#/current/overview?scope=tree");
  assert.equal(dates(), `${treeRange?.from} → ${treeRange?.to}`);

  const active = scopeControl("active");
  harness.click(active);
  assert.equal(harness.location.hash, "#/current/overview?scope=active");
  assert.equal(dates(), `${activeRange?.from} → ${activeRange?.to}`);
  assert.equal(active.attributes["aria-pressed"], "true");

  const tree = scopeControl("tree");
  harness.click(tree);
  assert.equal(harness.location.hash, "#/current/overview?scope=tree");
  assert.equal(dates(), `${treeRange?.from} → ${treeRange?.to}`);
  assert.equal(tree.attributes["aria-pressed"], "true");
  assert.equal(active.attributes["aria-pressed"], "false");
});

test("a range selection is a request, and the range controls read the DTO", async () => {
  const first = uiSnapshot();
  const second = uiSnapshot();
  if (second.current.tree.range?.resolved === undefined) {
    throw new Error("fixture must resolve a tree range");
  }
  second.current.tree.range.resolved = {
    preset: 7,
    from: "2026-01-27",
    to: "2026-02-02",
  };
  const harness = createWebClient({ responses: [first, second], hash: "" });
  await harness.start();
  assert.equal(
    harness.element("range-dates").textContent,
    "2026-02-01 → 2026-02-02",
  );

  const seven = control(harness, "range", "days", "7");
  harness.click(seven);
  assert.equal(harness.location.hash, "#/current/overview?scope=tree&preset=7");
  assert.deepEqual(
    harness.fetches().map((fetch) => fetch.url),
    ["/api/v1/ui", "/api/v1/ui?preset=7"],
  );
  await settle();
  // The figures are the second DTO's: the client resolved nothing itself.
  assert.equal(
    harness.element("range-dates").textContent,
    "2026-01-27 → 2026-02-02",
  );
  assert.equal(seven.attributes["aria-pressed"], "true");
});

test("an unparsable range intent asks for the default and says so", async () => {
  const harness = createWebClient({
    responses: [uiSnapshot()],
    hash: "#/current/overview?scope=tree&from=2026-01-01",
  });
  await harness.start();
  assert.deepEqual(harness.fetches(), [
    { url: "/api/v1/ui", authorization: "" },
  ]);
  assert.equal(
    harness.element("route-notice").textContent,
    "Range could not be restored; showing the default range.",
  );
  assert.equal(harness.element("range-notice").hidden, true);
});

test("back and forward apply the route the address bar names", async () => {
  const harness = createWebClient({ responses: [uiSnapshot()], hash: "" });
  await harness.start();
  const before = harness.renders();

  harness.click(tabLink(harness, "models"));
  assert.equal(harness.location.hash, "#/current/models?scope=tree");
  assert.equal(currentTab(harness), "models");
  assert.equal(harness.renders() - before, 1);

  // Back: the browser restores the previous entry and reports it. No second
  // request is made, because the range intent did not change.
  harness.location.hash = "#/current/overview?scope=tree";
  harness.popstate();
  assert.equal(currentTab(harness), "overview");
  assert.equal(harness.renders() - before, 2);
  assert.equal(harness.fetches().length, 1);

  // Forward: the tab entry is restored as an entry of its own.
  harness.location.hash = "#/current/models?scope=tree";
  harness.hashchange();
  assert.equal(currentTab(harness), "models");
  assert.equal(harness.renders() - before, 3);
});

test("a discrete change pushes an entry; only search typing replaces", async () => {
  const harness = createWebClient({ responses: [uiSnapshot()], hash: "" });
  await harness.start();
  const start = harness.replacements();

  // A tab is a destination, so it may not overwrite the entry it came from.
  harness.click(tabLink(harness, "models"));
  assert.equal(harness.replacements() - start, 0);

  // Typing in a search box is in progress, not a destination: it replaces.
  const search = harness.element("search");
  search.value = "acme";
  harness.input(search);
  assert.equal(harness.replacements() - start, 1);
  assert.equal(harness.location.hash, "#/current/models?scope=tree&q=acme");

  const sort = harness.element("sort");
  sort.value = "name";
  harness.change(sort);
  assert.equal(harness.replacements() - start, 1);
  assert.equal(
    harness.location.hash,
    "#/current/models?scope=tree&q=acme&sort=name",
  );

  // Clearing the sort empties the table state rather than naming "default".
  const cleared = harness.element("sort");
  cleared.value = "default";
  harness.change(cleared);
  assert.equal(harness.location.hash, "#/current/models?scope=tree&q=acme");
});

test("a table's search and sort reorder only the rows it already renders", async () => {
  const harness = createWebClient({
    responses: [uiSnapshot()],
    hash: "#/current/models?scope=tree",
  });
  await harness.start();
  const rows = (): number =>
    harness.element("view").querySelectorAll("tr").length;
  const all = rows();
  assert.equal(all, 2); // the header row plus the one model row the fixture has

  const search = harness.element("search");
  search.value = "zzz";
  harness.input(search);
  assert.equal(rows(), 1);
  assert.equal(harness.texts(harness.element("view")).includes("acme"), false);

  const cleared = harness.element("search");
  cleared.value = "";
  harness.input(cleared);
  assert.equal(rows(), all);
  assert.equal(harness.texts(harness.element("view")).includes("acme"), true);

  // A sort is a per-table setting, and it is route state while its table is active.
  const sort = harness.element("sort");
  assert.equal(sort.querySelectorAll("option").length, 3);
  sort.value = "reverse";
  harness.change(sort);
  assert.equal(
    harness.location.hash,
    "#/current/models?scope=tree&sort=reverse",
  );
});

test("a view's range and table settings are remembered, never linked", async () => {
  const harness = createWebClient({ responses: [uiSnapshot()], hash: "" });
  await harness.start();
  harness.click(control(harness, "range", "days", "7"));
  await settle();

  // The active view's range is route state, so the hash carries it.
  assert.equal(harness.location.hash, "#/current/overview?scope=tree&preset=7");

  // A link to another view carries no range: the entering view decides, and the
  // aggregate starts on its own default.
  harness.click(navLink(harness, "history"));
  assert.equal(harness.location.hash, "#/history/overview");
  harness.click(control(harness, "range", "days", "14"));
  await settle();
  assert.equal(harness.location.hash, "#/history/overview?preset=14");

  // ...and returning to the current view restores that view's remembered range,
  // canonicalized into the address bar so the hash and the render cannot drift.
  harness.click(navLink(harness, "current"));
  await settle();
  assert.equal(harness.location.hash, "#/current/overview?scope=tree&preset=7");

  // A table's own query follows the same rule: the active table's is the route's
  // (so the hash carries it), the inactive one's lives in memory.
  harness.click(tabLink(harness, "models"));
  assert.equal(harness.location.hash, "#/current/models?scope=tree&preset=7");
  const search = harness.element("search");
  search.value = "acme";
  harness.input(search);
  assert.equal(harness.element("search").value, "acme");

  harness.click(tabLink(harness, "tools"));
  assert.equal(harness.element("search").value, "");
  harness.click(tabLink(harness, "models"));
  assert.equal(harness.element("search").value, "acme");
});

test("focus moves to the section heading on a section change only", async () => {
  const harness = createWebClient({ responses: [uiSnapshot()], hash: "" });
  await harness.start();
  const heading = harness.element("title");
  let focused = 0;
  heading.focus = () => {
    focused += 1;
  };

  harness.click(navLink(harness, "history"));
  assert.equal(focused, 1);
  // A range change re-renders the same section without stealing focus.
  harness.click(control(harness, "range", "days", "14"));
  assert.equal(focused, 1);
  harness.click(navLink(harness, "current"));
  assert.equal(focused, 2);
});

test("an address bar that refuses canonicalization never suppresses the render", async () => {
  const harness = createWebClient({
    responses: [uiSnapshot()],
    replaceStateFails: true,
  });
  await harness.start();
  assert.equal(harness.renders(), 1);
  assert.equal(harness.element("title").textContent, "A session, in focus.");
  assert.deepEqual(visibleTabs(harness), ALL_TABS);
  assert.deepEqual(harness.fetches(), [
    { url: "/api/v1/ui", authorization: "" },
  ]);

  // The address bar reached the applied route through the fallback assignment,
  // and the event the browser sends for it re-parses to the applied key.
  assert.equal(harness.location.hash, "#/current/overview?scope=tree");
  harness.hashchange();
  assert.equal(harness.renders(), 1);

  // Navigation still works: a real hash change is applied and rendered.
  harness.location.hash = "#/history/overview";
  harness.hashchange();
  assert.equal(harness.renders(), 2);
  assert.equal(harness.element("title").textContent, "Pick up the trail.");
});

test("the theme control toggles the DTO's theme in memory only", async () => {
  const harness = createWebClient({ responses: [uiSnapshot()], hash: "" });
  await harness.start();
  const theme = harness.element("theme");
  // The DTO's own theme is the initial one (dark for this fixture).
  assert.equal(harness.body().className.includes("theme-dark"), true);
  assert.equal(theme.attributes["aria-pressed"], "true");
  assert.equal(theme.textContent, "Light theme");
  harness.click(theme);
  assert.equal(harness.body().className.includes("theme-dark"), false);
  assert.equal(theme.attributes["aria-pressed"], "false");
  assert.equal(theme.textContent, "Dark theme");
  harness.click(theme);
  assert.equal(harness.body().className.includes("theme-dark"), true);
});

test("the history table carries an opaque id column with a copy control", async () => {
  const harness = createWebClient({
    responses: [uiSnapshot()],
    hash: "#/history/overview",
  });
  await harness.start();
  const view = harness.element("view");
  const headers = view
    .querySelectorAll("th")
    .filter((header) => header.className === "id-cell");
  assert.equal(headers.length, 1);
  const cells = view
    .querySelectorAll("td")
    .filter((cell) => cell.className === "id-cell");
  assert.equal(cells.length, 2); // both fixture sessions, available or not
  for (const cell of cells) {
    assert.equal(typeof cell.attributes["data-full-id"], "string");
    assert.equal((cell.attributes["data-full-id"] ?? "").length > 0, true);
    assert.notEqual(cell.querySelector(".copy-id"), null);
  }
  // Membership is the DTO's own verdict, carried as row state, never re-derived.
  const rows = view
    .querySelectorAll("tr")
    .filter((row) => row.dataset.membership !== undefined);
  assert.deepEqual(
    rows.map((row) => row.dataset.membership),
    ["member", "unknown"],
  );
  // The session with no replayable detail publishes no figure at all.
  const unavailable = cells.find(
    (cell) => cell.attributes["data-full-id"] === "session-b",
  );
  const values = harness
    .texts(unavailable?.parentNode as StubElement)
    .join(" ");
  assert.equal(values.includes("Unavailable"), true);
  assert.equal(/\b0\b/.test(values), false);
});

// ---------------------------------------------------------------------------
// client.js: the presentation the legacy document rendered
// ---------------------------------------------------------------------------

test("the overview renders the DTO's compaction count and cache hit", async () => {
  const harness = createWebClient({ responses: [uiSnapshot()], hash: "" });
  await harness.start();
  const cards = metrics(harness);
  assert.equal(
    cards.some((card) => card.includes("Compactions") && card.includes("1")),
    true,
  );
  assert.equal(
    cards.some((card) => card.includes("Cache hit") && card.includes("6.1%")),
    true,
  );
});

test("the overview renders Cache hit as Unavailable without a denominator", async () => {
  const snapshot = uiSnapshot();
  const usage = snapshot.current.tree.report?.usage;
  if (usage === undefined) throw new Error("fixture must carry a tree usage");
  delete (usage as { cacheReadTokens?: number }).cacheReadTokens;
  const harness = createWebClient({ responses: [snapshot], hash: "" });
  await harness.start();
  assert.equal(
    metrics(harness).some(
      (card) => card.includes("Cache hit") && card.includes("Unavailable"),
    ),
    true,
  );
});

test("the overview compacts the breakdown and keeps the total precise", async () => {
  const snapshot = uiSnapshot();
  const view = snapshot.current.tree;
  const report = view.report;
  if (report?.usage === undefined || view.range === undefined) {
    throw new Error("fixture must carry a tree usage and range");
  }
  report.usage = {
    ...report.usage,
    inputTokens: 1_000,
    outputTokens: 1_250,
    cacheReadTokens: 1_000_000,
    cacheWriteTokens: 1_500_000,
  };
  view.range.totals = { ...view.range.totals, totalTokens: 1_234_567 };

  const harness = createWebClient({ responses: [snapshot], hash: "" });
  await harness.start();
  const total = metrics(harness).find((card) => card.includes("Total tokens"));
  assert.ok(total);
  assert.equal(total.includes("Input") && total.includes("1K"), true);
  assert.equal(total.includes("Output") && total.includes("1.3K"), true);
  assert.equal(total.includes("Cache read") && total.includes("1M"), true);
  assert.equal(total.includes("Cache write") && total.includes("1.5M"), true);
  assert.equal(total.includes("Total") && total.includes("1,234,567"), true);
  assert.equal(total.includes("1.2M"), false);
});

test("every session tab renders from the DTO's own published rows", async () => {
  const harness = createWebClient({
    responses: [uiSnapshot()],
    hash: "#/current/overview?scope=tree",
  });
  await harness.start();
  for (const tab of ALL_TABS) {
    harness.click(tabLink(harness, tab));
    assert.equal(currentTab(harness), tab, tab);
    assert.equal(harness.element("view").children.length > 0, true, tab);
    assert.match(
      harness.element("announcement").textContent,
      /^Current session, /,
      tab,
    );
  }
  const rendered = (): string =>
    harness.texts(harness.element("view")).join(" ");
  harness.click(tabLink(harness, "models"));
  assert.equal(rendered().includes("acme"), true);
  harness.click(tabLink(harness, "tools"));
  assert.equal(rendered().includes("bash"), true);
  harness.click(tabLink(harness, "errors"));
  assert.equal(rendered().includes("generation-error"), true);
  harness.click(tabLink(harness, "ledger"));
  assert.equal(harness.element("view").querySelectorAll("tr").length > 1, true);
  harness.click(tabLink(harness, "environment"));
  assert.equal(rendered().includes("Description"), true);
  harness.click(tabLink(harness, "integrations"));
  assert.equal(rendered().includes("context"), true);
  // The fixture publishes no child runs, so the Agents tab states that published
  // emptiness instead of inventing a zero or a row.
  harness.click(tabLink(harness, "agents"));
  assert.equal(
    rendered().includes("No observations in the selected scope."),
    true,
  );
  // The evidence tab is always present and carries the DTO's own rows.
  harness.click(tabLink(harness, "overview"));
  assert.equal(rendered().includes("Evidence, not estimates."), true);
});

test("a tools row narrows the calls list in place, and the clear control restores it", async () => {
  const harness = createWebClient({
    responses: [uiSnapshot()],
    hash: "#/current/tools?scope=tree",
  });
  await harness.start();
  const view = (): StubElement => harness.element("view");
  // The summary table comes first, the calls timeline second.
  const calls = (): StubElement => view().querySelectorAll("table")[1] as StubElement;
  const rows = (): number => calls().querySelectorAll("tr").length;
  assert.equal(rows(), 3); // the header row plus the fixture's two calls

  const filter = view()
    .querySelectorAll("button")
    .find((button) => button.dataset.toolFilter === "read");
  assert.notEqual(filter, undefined);
  // The button names the tool it narrows to, and it is not a route of its own.
  assert.match((filter as StubElement).attributes["aria-label"] ?? "", /read/);
  harness.click(filter as StubElement);
  assert.equal(rows(), 2);
  assert.equal(harness.location.hash, "#/current/tools?scope=tree");

  const clear = view()
    .querySelectorAll("button")
    .find((button) => button.dataset.clearFilter !== undefined);
  assert.notEqual(clear, undefined);
  harness.click(clear as StubElement);
  assert.equal(rows(), 3);
});

test("a row link is a real route that keeps the context and focuses its row", async () => {
  const harness = createWebClient({
    responses: [uiSnapshot()],
    hash: "#/current/models?scope=tree&preset=7",
  });
  await harness.start();
  const link = harness
    .element("view")
    .querySelectorAll("a")
    .find((anchor) => anchor.dataset.entity === "model:acme/alpha");
  assert.notEqual(link, undefined);
  const row = link as StubElement;
  // The destination keeps the active scope and range and names the row's id.
  assert.equal(
    row.attributes["href"],
    "#/current/models?scope=tree&preset=7&entity=model%3Aacme%2Falpha",
  );
  harness.click(row);
  assert.equal(harness.location.hash, row.attributes["href"]);
  // No new request: the destination renders the projection already in hand.
  assert.equal(harness.fetches().length, 1);
  assert.equal(harness.activeElement()?.dataset.entity, "model:acme/alpha");
  assert.equal(
    harness.activeElement()?.className.includes("entity-focus"),
    true,
  );
});

test("the history aggregate renders coverage, membership, and its own rows", async () => {
  const harness = createWebClient({
    responses: [uiSnapshot()],
    hash: "#/history/overview",
  });
  await harness.start();
  const texts = harness.texts(harness.element("view")).join(" ");
  assert.equal(texts.includes("Coverage"), true);
  assert.equal(harness.element("title").textContent, "Pick up the trail.");
  assert.equal(texts.includes("session-a"), true);
  // The member row publishes its own membership and its own usage figures; the
  // session with nothing published states Unavailable instead of a zero.
  const view = harness.element("view");
  const rows = view
    .querySelectorAll("tr")
    .filter((row) => row.dataset.membership !== undefined);
  const member = rows.find((row) => row.dataset.membership === "member");
  const unknown = rows.find((row) => row.dataset.membership === "unknown");
  assert.notEqual(member, undefined);
  assert.notEqual(unknown, undefined);
  const memberText = harness.texts(member as StubElement).join(" ");
  assert.equal(memberText.includes("1,200"), true);
  assert.equal(memberText.includes("$0.24"), true);
  const unknownText = harness.texts(unknown as StubElement).join(" ");
  assert.equal(unknownText.includes("Unavailable"), true);
  assert.equal(/\b0\b|\$0\.00/.test(unknownText), false);
});

test("the global aggregate renders the DTO's own totals and inventory", async () => {
  const harness = createWebClient({
    responses: [uiSnapshot()],
    hash: "#/global/overview",
  });
  await harness.start();
  const texts = harness.texts(harness.element("view")).join(" ");
  assert.equal(texts.includes("Coverage"), true);
  assert.equal(texts.includes("Observed days"), true);
  assert.equal(texts.includes("Commands"), true);
  assert.equal(harness.element("tabs").querySelectorAll("a").length, 1);
});

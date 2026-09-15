import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { InspectorBundle } from "../../src/ui/bundle.ts";
import { createTranslator } from "../../src/ui/i18n.ts";
import { SNAPSHOT_STYLESHEET } from "../../src/ui/snapshot.ts";
import {
  type InspectorUiSnapshot,
  projectInspectorUi,
  type UiAgentParent,
  type UiAgentRow,
} from "../../src/ui/ui-projection.ts";
import { WEB_ASSETS } from "../../src/ui/web-assets.ts";
import { calendarFree, forbiddenCapabilities } from "../helpers/asset-gate.ts";
import {
  createWebClient,
  type StubElement,
} from "../helpers/client-harness.ts";

/**
 * The readable browser sources (`scripts/web/`) implement route, range intent,
 * navigation, HTTP bootstrap and DOM rendering. These tests execute generated
 * shipped bytes in a `vm` context with a stub DOM, so what they pin is what a
 * browser runs. Report semantics stay pinned in `ui-projection.test.ts` and
 * `snapshot.test.ts`; nothing here recomputes them.
 */

const ASSET_PATHS = {
  shell: "src/ui/web/shell.html",
  style: "src/ui/web/style.css",
  client: "src/ui/web/client.bundle.js",
} as const;

const SCRIPTS: readonly (keyof typeof ASSET_PATHS)[] = ["client"];

const PROJECT_ROOT = new URL("../../", import.meta.url);
const PROJECT_ROOT_PATH = fileURLToPath(PROJECT_ROOT);

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
  "llm",
  "tools",
  "skills",
  "integrations",
  "environment",
  "errors",
  "ledger",
];

// ---------------------------------------------------------------------------
// The asset boundary
// ---------------------------------------------------------------------------

test("the generated client asset is fresh", () => {
  execFileSync(process.execPath, ["scripts/build-web.mjs", "--check"], {
    cwd: PROJECT_ROOT_PATH,
    stdio: "pipe",
  });
});

test("the loader reads exactly the three known files and serves their bytes", () => {
  assert.deepEqual(Object.keys(WEB_ASSETS).sort(), [
    "client",
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
    ["string", "string", "string"],
  );
});

test("the stylesheet is the one source for the asset and the snapshot", () => {
  // The snapshot inlines and hashes the shipped bytes themselves, so the two
  // cannot drift apart.
  assert.equal(SNAPSHOT_STYLESHEET, WEB_ASSETS.style);
  assert.equal(
    WEB_ASSETS.style.startsWith("\n\n:root{color-scheme:light"),
    true,
  );
  assert.equal(WEB_ASSETS.style.trimEnd().endsWith("}"), true);
  assert.equal(WEB_ASSETS.style.includes("<"), false);
});

test("the shell is report-free and loads the generated client asset", () => {
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
  // One external script only: the bundle is loaded after the fixed landmarks.
  const scriptTags = shell.match(/<script[^>]*>/g) ?? [];
  assert.deepEqual(scriptTags, ['<script src="/client.js">']);
  assert.equal(
    shell.indexOf('<script src="/client.js">') >
      shell.indexOf('id="announcement"'),
    true,
  );
  assert.deepEqual(
    [...shell.matchAll(/(?:href|src)="(\/[^"]+)"/g)].map((match) => match[1]),
    ["/style.css", "/client.js"],
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
  for (const name of SCRIPTS) {
    // Classic scripts: no module loading, no host access, no runtime code
    // evaluation. This parses the shipped bytes instead of scanning for the
    // substrings `import ` / `export `, which is only a proxy for the rule and
    // which library diagnostics (a message telling a developer which plugin to
    // import) can trip without any capability being present.
    assert.deepEqual(
      forbiddenCapabilities(WEB_ASSETS[name], name),
      [],
      `${name} must not load modules or evaluate code`,
    );
  }
});

test("the capability gate detects every capability it names", () => {
  // A gate that cannot fail is not a gate: these synthetic sources must each be
  // reported, and inert text must not be.
  const samples: [string, string][] = [
    ['import x from "mod";', "static-module-syntax"],
    ['export { x } from "mod";', "static-module-syntax"],
    ['import("mod");', "dynamic-import"],
    ["import.meta.url;", "import-meta"],
    ['require("node:fs");', "host-loader-call"],
    ["eval('1');", "dynamic-code-eval"],
    ["new Function('return 1');", "dynamic-code-eval"],
  ];
  for (const [source, kind] of samples) {
    assert.equal(
      forbiddenCapabilities(source, "synthetic.js").some(
        (finding) => finding.kind === kind,
      ),
      true,
      `${kind} in ${source}`,
    );
  }
  // The false positive that blocked the chart library: a diagnostic naming the
  // word import is not module loading.
  assert.deepEqual(
    forbiddenCapabilities(
      'console.warn("Please import and register the plugin");',
      "synthetic.js",
    ),
    [],
  );
  // Nor is a comment, or a string that quotes module syntax.
  assert.deepEqual(
    forbiddenCapabilities(
      '// import x from "mod";\nconst text = "export { x }";\nconst y = 1;\n',
      "synthetic.js",
    ),
    [],
  );
});

test("the calendar gate reports calls, not mentions", () => {
  assert.equal(calendarFree("const x = 1;", "synthetic.js"), true);
  assert.equal(
    calendarFree(
      "// Date.now is never called here\nconst x = 1;",
      "synthetic.js",
    ),
    true,
  );
  assert.equal(calendarFree("Date.now();", "synthetic.js"), false);
  assert.equal(calendarFree("new Date();", "synthetic.js"), false);
  assert.equal(calendarFree("Date.parse(value);", "synthetic.js"), false);
  assert.equal(calendarFree("Date.UTC(2026, 0, 1);", "synthetic.js"), false);
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
  }
});

test("Inspector's own browser sources do no calendar arithmetic", () => {
  // A range is an intent, never a computed span, and no Inspector figure may
  // depend on the wall clock. This is scoped to the sources Inspector writes:
  // the shipped asset also carries vendored library code whose date calls are
  // inert in this configuration, and which the behavioural test below pins.
  for (const name of ["route.js", "range.js", "client.js", "chart.ts"]) {
    const source = readFileSync(
      new URL(`../../scripts/web/${name}`, import.meta.url),
      "utf8",
    );
    for (const forbidden of [
      "resolveRange",
      "filterView",
      "historyRowRange",
      "periodTotals",
      "isInRange",
      "latestObservedDate",
      "shiftUtcDay",
      "presetRange",
      "parseRangeOptions",
      "projectInspectorUi",
    ]) {
      assert.equal(source.includes(forbidden), false, `${name}: ${forbidden}`);
    }
    assert.equal(calendarFree(source, name), true, `${name}: date arithmetic`);
  }
});

test("the shipped client renders without reading the current wall clock", async () => {
  // The runtime contract is narrower than "no Date at all": an uncontrolled
  // read of the *current* time is what must not happen. `new Date()` with no
  // argument and `Date.now()` are those reads; deterministic conversions such
  // as `Date.parse(explicitValue)` and `Date.UTC(...)` stay allowed, and the
  // separate calendarFree() rule keeps Inspector's own browser sources free of
  // calendar arithmetic.
  class ClockProbe extends Date {
    constructor(...args: unknown[]) {
      if (args.length === 0) throw new Error("wall clock read: new Date()");
      // SAFETY: the probe only needs the inherited Date behaviour for explicit
      // values, which this suite never constructs.
      super(...(args as [number]));
    }

    static override now(): number {
      throw new Error("wall clock read: Date.now()");
    }
  }
  const harness = createWebClient({
    globals: { Date: ClockProbe },
    hash: "#/current/overview?scope=tree",
    responses: [uiSnapshot()],
  });
  await harness.start();
  assert.equal(harness.element("title").textContent, "A session, in focus.");
  // The chart is drawn — the canvas is sized by the renderer, not by the clock.
  const canvases = harness.element("view").querySelectorAll("canvas");
  assert.equal(canvases.length, 1);
  assert.equal((canvases[0]?.width ?? 0) > 0, true);
  // A second render (a range change) goes through the same path.
  const seven = control(harness, "range", "days", "7");
  harness.click(seven);
  await settle();
  assert.equal(harness.fetches().length, 2);
  assert.equal(harness.element("view").querySelectorAll("canvas").length, 1);
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

test("the browser renders the shared catalog's copy", async () => {
  // One plain key and one interpolation, read from the same catalog the
  // TypeScript renderers use. The browser carries no table of its own to
  // compare against; what it renders is the catalog's own text.
  const catalog = createTranslator("en");
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
    harness.element("title").textContent,
    catalog("heading.current"),
  );
  assert.equal(
    harness.element("range-name").textContent,
    catalog("range.custom"),
  );
  harness.click(control(harness, "range", "days", "7"));
  await settle();
  assert.equal(
    harness.element("range-name").textContent,
    catalog("range.last", { days: 7 }),
  );
});

test("the assets own one namespace with route, range, i18n, format, and start", async () => {
  const harness = createWebClient({ responses: [uiSnapshot()] });
  await harness.start();
  const injected = [
    "document",
    "window",
    "location",
    "history",
    "localStorage",
    "sessionStorage",
    "navigator",
    "fetch",
    "console",
    "setTimeout",
    "getComputedStyle",
    "ResizeObserver",
    "MutationObserver",
  ];
  const added = Object.keys(harness.context).filter(
    (key) => !injected.includes(key) && key !== "globalThis",
  );
  assert.deepEqual(added, ["SessionInspectorWeb"]);
  const namespace = harness.context.SessionInspectorWeb as Record<
    string,
    unknown
  >;
  assert.deepEqual(Object.keys(namespace).sort(), [
    "agentTree",
    "chart",
    "format",
    "i18n",
    "range",
    "route",
    "start",
  ]);
  assert.equal(typeof namespace.start, "function");
  // The cost rule is the shared one, not a second implementation.
  const format = namespace.format as Record<string, unknown>;
  assert.deepEqual(Object.keys(format).sort(), ["cost"]);
  assert.equal(typeof format.cost, "function");
  assert.equal((format.cost as (value: number) => string)(0.0049), "$0.0049");
  assert.equal((format.cost as (value: number) => string)(0), "$0.00");
  // The execution topology is the shared projection too.
  const agentTree = namespace.agentTree as Record<string, unknown>;
  assert.deepEqual(Object.keys(agentTree).sort(), ["build", "filter"]);
  // The chart namespace is the adapter: create, recolor, palette.
  const chart = namespace.chart as Record<string, unknown>;
  assert.deepEqual(Object.keys(chart).sort(), [
    "applyChartTheme",
    "chartTheme",
    "createDailyChart",
  ]);
  const i18n = namespace.i18n as Record<string, unknown>;
  assert.equal(typeof i18n.t, "function");
  assert.equal(
    (i18n.t as (key: string, values?: Record<string, number>) => string)(
      "range.last",
      { days: 7 },
    ),
    "Last 7 days",
  );
  // The route module owns the closed vocabularies and the four route behaviors.
  const route = namespace.route as Record<string, unknown>;
  assert.deepEqual(Object.keys(route).sort(), [
    "agentViews",
    "defaultAgentView",
    "derive",
    "entityKinds",
    "key",
    "parse",
    "rangeQuery",
    "sections",
    "serialize",
    "tabs",
  ]);
  // The Agents presentation is a closed vocabulary whose default is the tree.
  assert.deepEqual(plain(route.agentViews), ["tree", "table"]);
  assert.equal(route.defaultAgentView, "tree");
  assert.deepEqual(plain(route.sections), ["current", "history", "global"]);
  assert.deepEqual(plain(route.entityKinds), [
    "model",
    "tool",
    "agent",
    "error",
    "integration",
    "command",
    "skill",
    "source",
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
  sections: readonly string[];
  tabs: readonly string[];
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
        tab: "llm",
        scope: "active",
        range: { kind: "preset", preset: 7 },
      },
      "#/current/llm?scope=active&preset=7",
    ],
    [
      {
        section: "current",
        tab: "llm",
        scope: "tree",
        view: "table",
        range: { kind: "preset", preset: 7 },
        entity: { kind: "agent", id: "acme/alpha" },
      },
      "#/current/llm?scope=tree&view=table&preset=7&entity=agent%3Aacme%2Falpha",
    ],
    [
      {
        section: "current",
        tab: "llm",
        scope: "active",
        // The default presentation is not serialized: the tree is what a route
        // that names no view renders, so one presentation still has one string.
        view: "tree",
      },
      "#/current/llm?scope=active",
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
    { section: "history", tab: "llm", scope: "tree" },
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

test("the route parses anything, keeps no null field, and derives only render state", () => {
  const { route } = namespaces();
  const options = {
    scope: "active",
    capabilities: CAPABILITIES,
    knownIds: [],
  };
  // Parsing is total: a hostile or malformed hash degrades to a section default
  // and at most a bounded notice code, and nothing from the input is echoed.
  for (const hash of [
    "",
    "#",
    "#/",
    "#/current",
    "#/current/tools?",
    "#/%E0%A4%A/overview",
    "#/current/tools?q=%E0%A4%A",
    "#/current/tools?entity=%E0%A4%A&q=ok",
    "https://example.test/#/current/tools?scope=tree",
    "#/current/tools?scope",
    "#/current/tools?=value",
    "#/current/tools?entity=tool:call-abc",
    undefined as unknown as string,
    null as unknown as string,
  ]) {
    const parsed = route.parse(hash, options);
    assert.equal(
      ["current", "history", "global"].includes(parsed.route.section),
      true,
      String(hash),
    );
    assert.equal(typeof parsed.route.tab, "string", String(hash));
    assert.equal(
      /"|%E0|SECRET/.test(route.serialize(parsed.route)),
      false,
      String(hash),
    );
  }
  // A malformed escape is not a value: the parameter is dropped, never echoed,
  // and a full URL contributes only its fragment.
  assert.deepEqual(
    plain(
      route.parse("#/current/tools?q=%E0%A4%A&sort=cost", options).route.table,
    ),
    { sort: "cost" },
  );
  assert.equal(
    route.serialize(
      route.parse(
        "https://example.test/secret/path#/current/tools?scope=tree",
        options,
      ).route,
    ),
    "#/current/tools?scope=tree",
  );
  // An optional field that is absent or null serializes and keys as absent.
  const absent = { section: "current", tab: "llm", scope: "tree" };
  const nulled = {
    ...absent,
    range: null,
    entity: null,
    table: null,
  };
  assert.equal(route.key(nulled), "#/current/llm?scope=tree");
  assert.equal(route.key(nulled), route.key(absent));
  // Deriving exposes exactly the state that drives rendering: the resolved
  // range is not the browser's to know.
  const derived = route.derive(
    {
      section: "global",
      tab: "llm",
      scope: "tree",
      range: { kind: "preset", preset: 30 },
    },
    CAPABILITIES,
  );
  assert.deepEqual(Object.keys(derived).sort(), [
    "activeSection",
    "activeTab",
    "focusTarget",
    "notice",
    "scope",
    "visibleTabs",
  ]);
  assert.deepEqual(
    [
      derived.activeSection,
      derived.activeTab,
      derived.notice,
      derived.focusTarget,
    ],
    ["global", "overview", "tab-unavailable", "section-heading"],
  );
  // An untrusted capability table is no tabs, never a throw.
  const untrusted = {
    current: null,
    history: 7,
    global: ["overview"],
  } as unknown as Record<string, string[]>;
  assert.deepEqual(
    plain(
      route.derive(
        { section: "current", tab: "overview", scope: "active" },
        untrusted,
      ).visibleTabs,
    ),
    [],
  );
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

test("the loaded browser scripts bootstrap data and wire the theme control", async () => {
  const harness = createWebClient({
    responses: [uiSnapshot()],
    hash: `#token=${TOKEN}`,
  });
  // A browser evaluates classic scripts from shell.html without a host calling
  // an exported entry point.
  await settle();

  assert.deepEqual(harness.fetches(), [
    { url: "/api/v1/ui", authorization: `Bearer ${TOKEN}` },
  ]);
  assert.equal(harness.element("title").textContent, "A session, in focus.");
  const theme = harness.element("theme");
  assert.equal(harness.body().className.includes("theme-dark"), true);
  harness.click(theme);
  assert.equal(harness.body().className.includes("theme-dark"), false);
  assert.equal(theme.textContent, "Dark theme");
});

test("the bootstrap consumes the token fragment before parsing or requesting", async () => {
  const harness = createWebClient({
    responses: [uiSnapshot()],
    hash: `#token=${TOKEN}`,
  });
  await harness.start();

  // The fragment is replaced first, then the request is made, then the address
  // bar is parsed, then the canonical scope is installed on the same entry: the
  // token cannot reach either step, and the bootstrap adds no history entry.
  assert.deepEqual(kinds(harness.events), [
    "replaceState",
    "fetch",
    "parse",
    "replaceState",
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
  // Both storages exist and recorded nothing: the page's own scratch space
  // carries no credential surface at all.
  assert.deepEqual(harness.storageWrites(), []);
});

test("a range intent is the only query the client sends", async () => {
  const harness = createWebClient({
    responses: [uiSnapshot()],
    hash: "#/current/llm?scope=tree&preset=7&q=acme",
  });
  await harness.start();
  assert.deepEqual(harness.fetches(), [
    { url: "/api/v1/ui?preset=7", authorization: "" },
  ]);
  // The route names the tab, the scope and the table query; the request does not.
  assert.equal(
    harness.location.hash,
    "#/current/llm?scope=tree&preset=7&q=acme",
  );
  assert.equal(harness.element("title").textContent, "A session, in focus.");
  assert.equal(tabLink(harness, "llm").attributes["aria-current"], "page");
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

test("the header refresh re-reads the report without moving the reader", async () => {
  const first = uiSnapshot();
  const second = uiSnapshot();
  if (second.current.tree.range?.resolved === undefined) {
    throw new Error("fixture must carry a tree range");
  }
  second.current.tree.range.resolved = {
    preset: 7,
    from: "2026-01-27",
    to: "2026-02-02",
  };
  const harness = createWebClient({
    responses: [first, second],
    hash: "#/current/llm?scope=tree&q=acme",
  });
  await harness.start();
  assert.equal(harness.element("range-name").textContent, "Custom range");
  const refresh = harness.element("refresh");
  // The control names itself, and it is a request rather than a route.
  assert.equal(refresh.attributes["aria-label"], "Refresh");
  harness.click(refresh);
  await settle();

  // The one request the route already makes, with the range the address bar
  // already carries: a refresh sends no new intent.
  assert.deepEqual(harness.fetches(), [
    { url: "/api/v1/ui", authorization: "" },
    { url: "/api/v1/ui", authorization: "" },
  ]);
  // The new payload is what the page now shows, and the reader is still on the
  // same tab, table query and scope.
  assert.equal(harness.element("range-name").textContent, "Last 7 days");
  assert.equal(
    harness.element("range-dates").textContent,
    "2026-01-27 → 2026-02-02",
  );
  assert.equal(harness.location.hash, "#/current/llm?scope=tree&q=acme");
  assert.equal(currentTab(harness), "llm");
  assert.equal(harness.element("search").value, "acme");

  // A refresh the boundary fails reports the failure rather than inventing an
  // empty report, and it stays a request the page survived.
  const broken = createWebClient({
    responses: [uiSnapshot()],
    hash: "",
    fetchFailure: "http",
  });
  await broken.start();
  assert.equal(broken.element("error").hidden, false);
  broken.click(broken.element("refresh"));
  await settle();
  assert.equal(broken.fetches().length, 2);
  assert.equal(broken.element("error").hidden, false);
  assert.equal(broken.element("view").children.length, 0);
});

test("a superseded refresh never publishes its older payload", async () => {
  const older = uiSnapshot();
  const newer = uiSnapshot();
  if (newer.current.tree.range?.resolved === undefined) {
    throw new Error("fixture must carry a tree range");
  }
  newer.current.tree.range.resolved = {
    preset: 7,
    from: "2026-01-27",
    to: "2026-02-02",
  };
  // Two requests the test answers itself, so the first click's answer can be
  // delivered after the second click's.
  const answers: ((snapshot: InspectorUiSnapshot) => void)[] = [];
  const harness = createWebClient({
    hash: "",
    globals: {
      fetch: () =>
        new Promise((resolve) => {
          answers.push((snapshot) =>
            resolve({ ok: true, status: 200, json: async () => snapshot }),
          );
        }),
    },
  });
  const started = harness.start();
  assert.equal(answers.length, 1);
  harness.click(harness.element("refresh"));
  assert.equal(answers.length, 2);

  // The second click answers first. It is the newest request, so it publishes
  // and renders.
  answers[1](newer);
  await settle();
  assert.equal(harness.element("range-name").textContent, "Last 7 days");
  const renders = harness.renders();

  // The first click answers late. A newer payload is already on the page, so
  // the older one is dropped instead of overwriting it.
  answers[0](older);
  await settle();
  assert.equal(harness.element("range-name").textContent, "Last 7 days");
  assert.equal(harness.renders(), renders);
  await started;
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

/** The sort option the client marked selected; `selected` is render output. */
function selectedSort(harness: Harness): string | undefined {
  return harness
    .element("sort")
    .querySelectorAll("option")
    .find((option) => option.selected)?.value;
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

test("tab navigation supports browser DOM collections", async () => {
  const harness = createWebClient({ responses: [uiSnapshot()] });
  await harness.start();
  const tabs = harness.element("tabs");
  const querySelectorAll = tabs.querySelectorAll.bind(tabs);
  tabs.querySelectorAll = (selector) => {
    const result = querySelectorAll(selector);
    if (selector === "a") {
      // NodeList has forEach but does not inherit Array.prototype.filter.
      Object.defineProperty(result, "filter", { value: undefined });
    }
    return result;
  };
  // A native click focuses its link before the delegated navigation handler
  // rebuilds the tab strip.
  tabLink(harness, "overview").focus();
  harness.click(tabLink(harness, "llm"));
  assert.equal(currentTab(harness), "llm");
});

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

test("a retired tab id coerces to the section default with one bounded notice", async () => {
  // The LLM merge retired two route ids. A link or bookmark that still names
  // one lands on the section default, with the same bounded notice any other
  // capability this document cannot honour gets.
  for (const retired of ["models", "agents"]) {
    const harness = createWebClient({
      responses: [uiSnapshot()],
      hash: `#/current/${retired}?scope=tree`,
    });
    await harness.start();
    assert.equal(harness.location.hash, "#/current/overview?scope=tree");
    assert.equal(currentTab(harness), "overview");
    assert.equal(harness.element("route-notice").hidden, false);
    assert.equal(
      harness.element("route-notice").textContent,
      "That view isn't available here.",
    );
  }
});

test("a deep link coerces a tab the section cannot render", async () => {
  const snapshot = uiSnapshot();
  const aggregate = createWebClient({
    responses: [snapshot],
    hash: "#/history/llm",
  });
  await aggregate.start();
  assert.deepEqual(visibleTabs(aggregate), ["overview"]);
  assert.equal(currentTab(aggregate), "overview");
  assert.equal(
    aggregate.element("route-notice").textContent,
    "That view isn't available here.",
  );

  // The same deep link against a selected session is honoured: a session detail
  // carries a full report, so LLM is a real destination.
  const detail = createWebClient({
    responses: [snapshot],
    hash: "#/history/llm?session=session-a",
  });
  await detail.start();
  assert.deepEqual(visibleTabs(detail), ALL_TABS);
  assert.equal(currentTab(detail), "llm");
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

  harness.click(tabLink(harness, "llm"));
  assert.equal(harness.location.hash, "#/current/llm?scope=tree");
  assert.equal(currentTab(harness), "llm");
  assert.equal(harness.renders() - before, 1);

  // Back: the browser restores the previous entry and reports it. No second
  // request is made, because the range intent did not change.
  harness.location.hash = "#/current/overview?scope=tree";
  harness.popstate();
  assert.equal(currentTab(harness), "overview");
  assert.equal(harness.renders() - before, 2);
  assert.equal(harness.fetches().length, 1);

  // Forward: the tab entry is restored as an entry of its own.
  harness.location.hash = "#/current/llm?scope=tree";
  harness.hashchange();
  assert.equal(currentTab(harness), "llm");
  assert.equal(harness.renders() - before, 3);
});

test("a discrete change pushes an entry; only search typing replaces", async () => {
  const harness = createWebClient({ responses: [uiSnapshot()], hash: "" });
  await harness.start();
  const start = harness.replacements();

  // A tab is a destination, so it may not overwrite the entry it came from.
  harness.click(tabLink(harness, "llm"));
  assert.equal(harness.replacements() - start, 0);

  // Typing in a search box is in progress, not a destination: it replaces.
  const search = harness.element("search");
  search.value = "acme";
  harness.input(search);
  assert.equal(harness.replacements() - start, 1);
  assert.equal(harness.location.hash, "#/current/llm?scope=tree&q=acme");

  const sort = harness.element("sort");
  sort.value = "name";
  harness.change(sort);
  assert.equal(harness.replacements() - start, 1);
  assert.equal(
    harness.location.hash,
    "#/current/llm?scope=tree&q=acme&sort=name",
  );

  // Clearing the sort empties the table state rather than naming "default".
  const cleared = harness.element("sort");
  cleared.value = "default";
  harness.change(cleared);
  assert.equal(harness.location.hash, "#/current/llm?scope=tree&q=acme");
});

test("a table's search and sort reorder only the rows it already renders", async () => {
  const harness = createWebClient({
    responses: [uiSnapshot()],
    hash: "#/current/llm?scope=tree",
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
  assert.equal(harness.location.hash, "#/current/llm?scope=tree&sort=reverse");
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
  harness.click(tabLink(harness, "llm"));
  assert.equal(harness.location.hash, "#/current/llm?scope=tree&preset=7");
  const search = harness.element("search");
  search.value = "acme";
  harness.input(search);
  assert.equal(harness.element("search").value, "acme");

  harness.click(tabLink(harness, "tools"));
  assert.equal(harness.element("search").value, "");
  harness.click(tabLink(harness, "llm"));
  assert.equal(harness.element("search").value, "acme");
});

test("a table's sort is remembered across a tab switch", async () => {
  const harness = createWebClient({
    responses: [uiSnapshot()],
    hash: "#/current/llm?scope=tree",
  });
  await harness.start();
  const sort = harness.element("sort");
  sort.value = "name";
  harness.change(sort);
  assert.equal(harness.location.hash, "#/current/llm?scope=tree&sort=name");

  // The leaving table's sort is not the next table's; it is remembered for the
  // table it belongs to and restored when that table comes back.
  harness.click(tabLink(harness, "tools"));
  assert.equal(selectedSort(harness), "default");
  harness.click(tabLink(harness, "llm"));
  assert.equal(selectedSort(harness), "name");
  assert.equal(harness.location.hash, "#/current/llm?scope=tree&sort=name");
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

test("a tab that held keyboard focus keeps it across a re-render", async () => {
  const harness = createWebClient({ responses: [uiSnapshot()], hash: "" });
  await harness.start();
  harness.click(tabLink(harness, "llm"));
  const models = tabLink(harness, "llm");
  models.focus();
  assert.equal(harness.activeElement(), models);

  // A range change rebuilds the strip: the focused tab gets its focus back.
  harness.click(control(harness, "range", "days", "14"));
  await settle();
  assert.equal(currentTab(harness), "llm");
  assert.equal(harness.activeElement()?.dataset.tab, "llm");

  // A section change leaves focus to the heading instead.
  harness.click(navLink(harness, "history"));
  await settle();
  assert.equal(harness.activeElement(), harness.element("title"));
});

test("the search box keeps its focus and caret across its own re-render", async () => {
  const harness = createWebClient({
    responses: [uiSnapshot()],
    hash: "#/current/llm?scope=tree",
  });
  await harness.start();
  const search = harness.element("search");
  search.focus();
  search.value = "ac";
  search.selectionStart = 1;
  harness.input(search);
  // Typing rebuilds the table, so the box is a new node: both the focus and the
  // caret came back to it, at the position the typing left.
  const rebuilt = harness.element("search");
  assert.notEqual(rebuilt, search);
  assert.equal(harness.activeElement(), rebuilt);
  assert.equal(rebuilt.value, "ac");
  assert.equal(rebuilt.selectionStart, 1);

  // A re-render the search box did not ask for leaves focus where it was.
  harness.body().focus();
  const cleared = harness.element("search");
  cleared.value = "";
  harness.input(cleared);
  assert.equal(harness.activeElement(), harness.body());
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

test("a refused replacement applies the search route through one hash assignment", async () => {
  const harness = createWebClient({
    responses: [uiSnapshot()],
    hash: "#/current/llm?scope=tree",
    replaceStateFails: true,
  });
  await harness.start();
  const renders = harness.renders();
  const before = harness.events.length;
  const search = harness.element("search");
  search.value = "acme";
  harness.input(search);
  // The replacement was refused, so the fallback assignment carried the route
  // once: one history entry, no request, and the render still happened.
  assert.deepEqual(kinds(harness.events.slice(before)), [
    "hashAssign",
    "parse",
  ]);
  assert.deepEqual(harness.events.slice(before, before + 1), [
    { kind: "hashAssign", hash: "#/current/llm?scope=tree&q=acme" },
  ]);
  assert.equal(harness.location.hash, "#/current/llm?scope=tree&q=acme");
  assert.equal(harness.element("search").value, "acme");
  assert.equal(harness.renders(), renders + 1);
  assert.equal(harness.fetches().length, 1);
  // The event the browser sends for that assignment re-parses to the applied
  // key, so it renders nothing a second time.
  harness.hashchange();
  assert.equal(harness.renders(), renders + 1);
  assert.equal(harness.element("search").value, "acme");
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
  // Unavailable sessions are hidden by default (the History view's own
  // predicate), so the reveal control is what makes every row reachable.
  const reveal = view
    .querySelectorAll("button")
    .find((button) => button.dataset.filter === "availableOnly");
  assert.notEqual(reveal, undefined);
  harness.click(reveal as StubElement);
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
  // The one LLM tab renders both halves of the same scope: the model table
  // first, then the child-run breakdown. The fixture publishes no child runs,
  // so the second half states that published emptiness instead of inventing a
  // zero or a row.
  harness.click(tabLink(harness, "llm"));
  assert.equal(rendered().includes("acme"), true);
  assert.equal(
    rendered().includes("No observations in the selected scope."),
    true,
  );
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
  const calls = (): StubElement =>
    view().querySelectorAll("table")[1] as StubElement;
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
    hash: "#/current/llm?scope=tree&preset=7",
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
    row.attributes.href,
    "#/current/llm?scope=tree&preset=7&entity=model%3Aacme%2Falpha",
  );
  const view = harness.element("view");
  const querySelectorAll = view.querySelectorAll.bind(view);
  view.querySelectorAll = (selector) => {
    const result = querySelectorAll(selector);
    if (selector === ".entity") {
      // NodeList has no Array.prototype.filter method.
      Object.defineProperty(result, "filter", { value: undefined });
    }
    return result;
  };
  harness.click(row);
  assert.equal(harness.location.hash, row.attributes.href);
  // No new request: the destination renders the projection already in hand.
  assert.equal(harness.fetches().length, 1);
  assert.equal(harness.activeElement()?.dataset.entity, "model:acme/alpha");
  assert.equal(
    harness.activeElement()?.className.includes("entity-focus"),
    true,
  );
});

test("an in-range parent link navigates, and back and forward restore its focus", async () => {
  const snapshot = uiSnapshot();
  const range = snapshot.current.tree.range;
  if (range === undefined) throw new Error("fixture must carry a tree range");
  const parentId = `subagent-${"b".repeat(64)}`;
  const childId = `subagent-${"c".repeat(64)}`;
  const agentRow = (input: {
    id: string;
    parentId: string | null;
    agent: string;
    parent: UiAgentParent;
  }): UiAgentRow => ({
    id: input.id,
    parentId: input.parentId,
    agent: input.agent,
    status: "succeeded",
    confidence: "native",
    artifacts: null,
    observedAt: null,
    evidenceToolId: null,
    model: null,
    thinking: null,
    failure: null,
    usage: null,
    parent: input.parent,
  });
  range.agents = [
    agentRow({
      id: parentId,
      parentId: null,
      agent: "orchestrator",
      parent: "none",
    }),
    agentRow({ id: childId, parentId, agent: "worker", parent: "in-range" }),
  ];
  range.childUsage = {
    runsTotal: 2,
    runsWithUsage: 0,
    totalTokens: null,
    cost: null,
    failedCost: null,
    failedRunsWithUsage: 0,
    byStatus: {
      succeeded: 2,
      failed: 0,
      interrupted: 0,
      running: 0,
      unknown: 0,
    },
  };

  const harness = createWebClient({
    responses: [snapshot],
    // The parent column is the table's own presentation of the relation; the
    // tree expresses the same in-range verdict by nesting the row instead.
    hash: "#/current/llm?scope=tree&view=table",
  });
  await harness.start();
  const link = harness
    .element("view")
    .querySelectorAll("a")
    .find((anchor) => anchor.dataset.entity === `agent:${parentId}`);
  assert.notEqual(link, undefined);
  const parentLink = link as StubElement;
  assert.equal(parentLink.textContent, "orchestrator");
  assert.equal(
    parentLink.attributes.href,
    `#/current/llm?scope=tree&view=table&entity=agent%3A${parentId}`,
  );

  // Following it stays in the same view and focuses the parent's own row.
  harness.click(parentLink);
  assert.equal(harness.location.hash, parentLink.attributes.href);
  assert.equal(harness.fetches().length, 1);
  assert.equal(harness.activeElement()?.dataset.entity, `agent:${parentId}`);
  assert.equal(
    harness.activeElement()?.className.includes("entity-focus"),
    true,
  );

  // Back: the entity leaves the route, so the focus effect is not applied and
  // the replaced subtree leaves nothing pinned or filtered.
  harness.location.hash = "#/current/llm?scope=tree&view=table";
  harness.popstate();
  assert.equal(
    harness.element("view").querySelectorAll(".entity-focus").length,
    0,
  );
  assert.equal(harness.activeElement()?.dataset.entity, undefined);
  assert.equal(harness.fetches().length, 1);

  // Forward: the same route focuses the same row again.
  harness.location.hash = parentLink.attributes.href;
  harness.hashchange();
  assert.equal(harness.activeElement()?.dataset.entity, `agent:${parentId}`);
  assert.equal(
    harness.element("view").querySelectorAll(".entity-focus").length,
    1,
  );
});

test("a known parent with no materialized row never renders as Unavailable", async () => {
  const snapshot = uiSnapshot();
  const range = snapshot.current.tree.range;
  if (range === undefined) throw new Error("fixture must carry a tree range");
  const containerId = `subagent-${"b".repeat(64)}`;
  const childId = `subagent-${"c".repeat(64)}`;
  const rootlessId = `subagent-${"d".repeat(64)}`;
  const malformedId = `subagent-${"e".repeat(64)}`;
  const agentRow = (input: {
    id: string;
    parentId: string | null;
    agent: string;
    parent: UiAgentParent;
  }): UiAgentRow => ({
    id: input.id,
    parentId: input.parentId,
    agent: input.agent,
    status: "succeeded",
    confidence: "native",
    artifacts: null,
    observedAt: null,
    evidenceToolId: null,
    model: null,
    thinking: null,
    failure: null,
    usage: null,
    parent: input.parent,
  });
  range.agents = [
    agentRow({
      id: childId,
      parentId: containerId,
      agent: "worker",
      parent: "orchestration-run",
    }),
    agentRow({
      id: rootlessId,
      parentId: null,
      agent: "rootless",
      parent: "none",
    }),
    agentRow({
      id: malformedId,
      parentId: "not-an-opaque-id",
      agent: "malformed",
      parent: "unknown",
    }),
  ];
  range.childUsage = {
    runsTotal: 3,
    runsWithUsage: 0,
    totalTokens: null,
    cost: null,
    failedCost: null,
    failedRunsWithUsage: 0,
    byStatus: {
      succeeded: 3,
      failed: 0,
      interrupted: 0,
      running: 0,
      unknown: 0,
    },
  };

  const harness = createWebClient({
    responses: [snapshot],
    hash: "#/current/llm?scope=tree&view=table",
  });
  await harness.start();
  const view = harness.element("view");
  const parentCell = (id: string): StubElement => {
    const mark = view
      .querySelectorAll("span")
      .find((element) => element.dataset.entity === `agent:${id}`);
    const row = mark?.closest("tr") ?? null;
    if (row === null) throw new Error(`no row for ${id}`);
    const cell = row.children[row.children.length - 1];
    if (cell === undefined) throw new Error(`no parent cell for ${id}`);
    return cell;
  };
  // The known-but-unmaterialized parent states the run container, never the
  // Unavailable wording and never a link to a row that does not exist.
  assert.equal(parentCell(childId).textContent, "Parent: orchestration run");
  assert.equal(parentCell(rootlessId).textContent, "Parent: none");
  assert.equal(parentCell(malformedId).textContent, "Parent: Unavailable");
  assert.equal(
    view
      .querySelectorAll("a")
      .some((anchor) => anchor.dataset.entity === `agent:${containerId}`),
    false,
  );
});

test("ErrorRow references are entity links wherever the DTO publishes an id", async () => {
  const snapshot = uiSnapshot();
  const range = snapshot.current.tree.range;
  if (range === undefined) throw new Error("fixture must carry a tree range");
  // Two runs of the same session: an in-range parent and its child. L2 decides
  // the parent verdicts; the fixture rows carry them already.
  range.agents = [
    {
      id: "parent-run",
      parentId: null,
      agent: "orchestrator",
      status: "succeeded",
      confidence: "native",
      artifacts: null,
      observedAt: null,
      evidenceToolId: null,
      model: null,
      thinking: null,
      failure: null,
      usage: null,
      parent: "none",
    },
    {
      id: "child-run",
      parentId: "parent-run",
      agent: "worker",
      status: "failed",
      confidence: "native",
      artifacts: null,
      observedAt: null,
      evidenceToolId: null,
      model: null,
      thinking: null,
      failure: null,
      usage: null,
      parent: "in-range",
    },
  ];
  range.childUsage = {
    runsTotal: 2,
    runsWithUsage: 0,
    totalTokens: null,
    cost: null,
    failedCost: null,
    failedRunsWithUsage: 0,
    byStatus: {
      succeeded: 1,
      failed: 1,
      interrupted: 0,
      running: 0,
      unknown: 0,
    },
  };
  const error = range.errors[0];
  if (error === undefined) throw new Error("fixture must carry an error row");
  range.errors = [
    {
      ...error,
      toolName: "read",
      toolSource: "builtin",
      toolStatus: "succeeded",
      relatedChildIds: ["child-run", "missing-run"],
    },
  ];

  const errors = createWebClient({
    responses: [snapshot],
    hash: "#/current/errors?scope=tree",
  });
  await errors.start();
  const view = errors.element("view");
  const tool = view
    .querySelectorAll("a")
    .find((link) => link.dataset.entity === "tool:read");
  assert.notEqual(tool, undefined);
  assert.equal(
    (tool as StubElement).attributes.href,
    "#/current/tools?scope=tree&entity=tool%3Aread",
  );
  assert.equal((tool as StubElement).textContent, "read · builtin");

  const child = view
    .querySelectorAll("a")
    .find((link) => link.dataset.entity === "agent:child-run");
  assert.notEqual(child, undefined);
  assert.equal((child as StubElement).textContent, "worker");
  assert.equal(
    (child as StubElement).attributes.href,
    "#/current/llm?scope=tree&entity=agent%3Achild-run",
  );
  // A candidate the payload does not carry is the catalog's Unavailable wording,
  // never the raw run id.
  const texts = errors.texts(view).join(" ");
  assert.equal(texts.includes("missing-run"), false);
  assert.equal(texts.includes("Unavailable"), true);

  // The Agent row whose parent L2 calls in-range links to the parent's own row,
  // and following it focuses that row.
  const agents = createWebClient({
    responses: [snapshot],
    hash: "#/current/llm?scope=tree&view=table",
  });
  await agents.start();
  const parent = agents
    .element("view")
    .querySelectorAll("a")
    .find((link) => link.dataset.entity === "agent:parent-run");
  assert.notEqual(parent, undefined);
  assert.equal((parent as StubElement).textContent, "orchestrator");
  agents.click(parent as StubElement);
  assert.equal(agents.activeElement()?.dataset.entity, "agent:parent-run");
});

test("the history aggregate renders coverage, membership, and its own rows", async () => {
  const harness = createWebClient({
    responses: [uiSnapshot()],
    hash: "#/history/overview",
  });
  await harness.start();
  // The membership claims below include the session the view hides by default,
  // so reveal it through the view's own control first.
  const reveal = harness
    .element("view")
    .querySelectorAll("button")
    .find((button) => button.dataset.filter === "availableOnly");
  assert.notEqual(reveal, undefined);
  harness.click(reveal as StubElement);
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

// ---------------------------------------------------------------------------
// client.js: the chart and the table read the section's own daily rows
// ---------------------------------------------------------------------------

/** The chart metric select of the rendered view. */
function chartSelect(harness: Harness): StubElement {
  const select = harness
    .element("view")
    .querySelectorAll("select")
    .find((node) => node.id === "chart-metric");
  if (select === undefined) throw new Error("no chart metric select");
  return select;
}

/** The chart data table's headers, in render order. */
function chartDataHeaders(harness: Harness): (string | undefined)[] {
  const details = harness.element("view").querySelectorAll("details")[0];
  if (details === undefined) throw new Error("no chart data table");
  return details.querySelectorAll("th").map((header) => header.textContent);
}

test("the global chart offers only the metrics its daily rows publish", async () => {
  const harness = createWebClient({
    responses: [uiSnapshot()],
    hash: "#/global/overview",
  });
  await harness.start();
  const select = chartSelect(harness);
  assert.deepEqual(
    select.querySelectorAll("option").map((option) => option.value),
    ["sessions", "cost", "tokens"],
  );
  assert.deepEqual(
    select.querySelectorAll("option").map((option) => option.textContent),
    ["Sessions", "Cost", "Tokens"],
  );
  // One column per published field: a global daily row carries no generation or
  // tool count, so the table has no cell to fill with a fabricated zero.
  assert.deepEqual(chartDataHeaders(harness), [
    "Date",
    "Sessions",
    "Tokens",
    "Cost (USD)",
  ]);
  const rows = harness
    .element("view")
    .querySelectorAll("details")[0] as StubElement;
  assert.deepEqual(
    rows
      .querySelectorAll("tr")[1]
      ?.querySelectorAll("td")
      .map((cell) => cell.textContent),
    ["2026-02-01", "1", "400", "$0.08"],
  );
  const rendered = harness.texts(harness.element("view")).join(" ");
  assert.equal(rendered.includes("NaN"), false);
  assert.equal(rendered.includes("undefined"), false);
});

test("a session view still charts every metric its own daily rows publish", async () => {
  const harness = createWebClient({
    responses: [uiSnapshot()],
    hash: "#/current/overview?scope=tree",
  });
  await harness.start();
  assert.deepEqual(
    chartSelect(harness)
      .querySelectorAll("option")
      .map((option) => option.value),
    ["sessions", "cost", "tokens", "generations", "tools"],
  );
  assert.deepEqual(chartDataHeaders(harness), [
    "Date",
    "Sessions",
    "Tokens",
    "Cost (USD)",
    "Generations",
    "Tool calls",
  ]);
});

test("a chart row without the selected metric is unavailable, never a zero", async () => {
  const snapshot = uiSnapshot();
  const day = snapshot.global.daily[0];
  if (day === undefined) throw new Error("fixture must carry global days");
  delete (day as { sessions?: number }).sessions;
  const harness = createWebClient({
    responses: [snapshot],
    hash: "#/global/overview",
  });
  await harness.start();
  const view = harness.element("view");
  // Nothing is plotted and no cell is written for a value the row never had.
  assert.equal(view.querySelectorAll("polyline").length, 0);
  assert.equal(view.querySelectorAll("details").length, 0);
  assert.equal(harness.texts(view).join(" ").includes("NaN"), false);
});

// ---------------------------------------------------------------------------
// client.js: the four copy lookups the renderer performs
// ---------------------------------------------------------------------------

test("the renderer's words are catalog words, including at its four lookups", async () => {
  // The history Status column: L2's status verdict key is a catalog key.
  const history = createWebClient({
    responses: [uiSnapshot()],
    hash: "#/history/overview",
  });
  await history.start();
  const member = history
    .element("view")
    .querySelectorAll("tr")
    .find((row) => row.dataset.membership === "member");
  assert.notEqual(member, undefined);
  assert.equal(
    history
      .texts(member as StubElement)
      .join(" ")
      .includes("No error records"),
    true,
  );

  // The Ledger's ID column header.
  const ledger = createWebClient({
    responses: [uiSnapshot()],
    hash: "#/current/ledger?scope=tree",
  });
  await ledger.start();
  assert.equal(
    ledger
      .element("view")
      .querySelectorAll("th")
      .some((header) => header.textContent === "ID"),
    true,
  );

  // The Global aggregate's tracked-sessions card.
  const global = createWebClient({
    responses: [uiSnapshot()],
    hash: "#/global/overview",
  });
  await global.start();
  assert.equal(
    global
      .element("view")
      .querySelectorAll(".metric")
      .some((card) =>
        global.texts(card).join(" ").includes("Tracked sessions"),
      ),
    true,
  );

  // The live region: an entity focus is announced with the catalog's wording.
  const entity = createWebClient({
    responses: [uiSnapshot()],
    hash: "#/current/llm?scope=tree",
  });
  await entity.start();
  const link = entity
    .element("view")
    .querySelectorAll("a")
    .find((anchor) => anchor.dataset.entity === "model:acme/alpha");
  assert.notEqual(link, undefined);
  entity.click(link as StubElement);
  assert.match(entity.element("announcement").textContent, /· Focused entity$/);
  assert.equal(
    entity.element("announcement").textContent.includes("undefined"),
    false,
  );
});

// ---------------------------------------------------------------------------
// client.js: the promoted IA, real navigation, and the availability filters
// ---------------------------------------------------------------------------

test("the route round-trips the Skills tab and the source entity kind", () => {
  const { route } = namespaces();
  assert.deepEqual(plain(route.tabs), ALL_TABS);
  const expected = "#/current/skills?scope=tree&entity=source%3Anpm%3Api-lens";
  assert.equal(
    route.serialize({
      section: "current",
      tab: "skills",
      scope: "tree",
      entity: { kind: "source", id: "npm:pi-lens" },
    }),
    expected,
  );
  const parsed = route.parse(expected, {
    scope: "tree",
    capabilities: CAPABILITIES,
    knownIds: ["npm:pi-lens", "build"],
  });
  assert.equal(parsed.notice, undefined);
  assert.deepEqual(plain(parsed.route.entity), {
    kind: "source",
    id: "npm:pi-lens",
  });
  assert.equal(route.serialize(parsed.route), expected);
  // A skill id round-trips the same way; an unknown kind is dropped, not echoed.
  const skill = route.parse(
    "#/current/skills?scope=tree&entity=skill%3Abuild",
    {
      scope: "tree",
      capabilities: CAPABILITIES,
      knownIds: ["build"],
    },
  );
  assert.deepEqual(plain(skill.route.entity), { kind: "skill", id: "build" });
  const unknown = route.parse(
    "#/current/skills?scope=tree&entity=widget%3Abuild",
    {
      scope: "tree",
      capabilities: CAPABILITIES,
      knownIds: ["build"],
    },
  );
  assert.equal("entity" in unknown.route, false);
  assert.equal(unknown.notice, undefined);
});

test("the tab strip carries the promoted information architecture", async () => {
  const harness = createWebClient({
    responses: [uiSnapshot()],
    hash: "#/current/overview?scope=tree",
  });
  await harness.start();
  assert.deepEqual(visibleTabs(harness), ALL_TABS);
  // Environment keeps Commands and Sources; Skills is a tab of its own.
  harness.click(tabLink(harness, "environment"));
  const subnav = harness
    .element("view")
    .querySelectorAll("button")
    .filter((button) => button.dataset.envTab !== undefined)
    .map((button) => button.dataset.envTab);
  assert.deepEqual(subnav, ["commands", "sources"]);
  harness.click(tabLink(harness, "skills"));
  assert.equal(
    harness.texts(harness.element("view")).join(" ").includes("build"),
    true,
  );
});

test("the Sources table labels the supplied tools, not observed calls", async () => {
  const harness = createWebClient({
    responses: [uiSnapshot()],
    hash: "#/current/environment?scope=tree",
  });
  await harness.start();
  const sources = harness
    .element("view")
    .querySelectorAll("button")
    .find((button) => button.dataset.envTab === "sources");
  assert.notEqual(sources, undefined);
  harness.click(sources as StubElement);
  const view = harness.element("view");
  const headers = view
    .querySelectorAll("th")
    .map((header) => header.textContent);
  assert.equal(headers.includes("Tools"), true);
  assert.equal(headers.includes("Tool calls"), false);
  const texts = harness.texts(view).join(" ");
  assert.equal(texts.includes("Sources"), true);
  assert.equal(texts.includes("Resource sources"), false);
});

test("no rendered control promises a route it does not have", async () => {
  const snapshot = uiSnapshot();
  for (const hash of [
    "#/current/overview?scope=tree",
    "#/current/llm?scope=tree",
    "#/current/tools?scope=tree",
    "#/current/skills?scope=tree",
    "#/current/integrations?scope=tree",
    "#/current/environment?scope=tree",
    "#/current/errors?scope=tree",
    "#/current/ledger?scope=tree",
    "#/history/overview",
    "#/global/overview",
  ]) {
    const harness = createWebClient({ responses: [snapshot], hash });
    await harness.start();
    const anchors = ["navigation", "tabs", "view"].flatMap((id) =>
      harness.element(id).querySelectorAll("a"),
    );
    assert.equal(anchors.length > 0, true, hash);
    for (const anchor of anchors) {
      const href = anchor.attributes.href ?? "";
      assert.match(href, /^#\/(current|history|global)\//, `${hash} ${href}`);
    }
  }
});

test("the Integrations view hides rows without telemetry evidence by default", async () => {
  const harness = createWebClient({
    responses: [uiSnapshot()],
    hash: "#/current/integrations?scope=tree",
  });
  await harness.start();
  const view = (): StubElement => harness.element("view");
  const texts = (): string => harness.texts(view()).join(" ");
  // The header row plus the two producers whose telemetry was observed.
  assert.equal(view().querySelectorAll("tr").length, 3);
  assert.equal(texts().includes("rtk"), false);
  assert.equal(texts().includes("2 shown · 1 hidden/unavailable"), true);
  const toggle = view()
    .querySelectorAll("button")
    .find((button) => button.dataset.filter === "withEvidence");
  assert.notEqual(toggle, undefined);
  assert.equal((toggle as StubElement).attributes["aria-pressed"], "true");
  harness.click(toggle as StubElement);
  assert.equal(view().querySelectorAll("tr").length, 4);
  assert.equal(texts().includes("rtk"), true);
  // Revealing a hidden row is view state: no route changes.
  assert.equal(harness.location.hash, "#/current/integrations?scope=tree");
  assert.equal(harness.fetches().length, 1);
});

test("the Skills view filters to invoked skills and never calls the rest unavailable", async () => {
  const harness = createWebClient({
    responses: [uiSnapshot()],
    hash: "#/current/skills?scope=tree",
  });
  await harness.start();
  const view = (): StubElement => harness.element("view");
  const texts = (): string => harness.texts(view()).join(" ");
  assert.equal(texts().includes("build"), true);
  assert.equal(texts().includes("deploy"), false);
  assert.equal(texts().includes("1 shown · 1 hidden"), true);
  // An installed skill nothing invoked is hidden by the invocation predicate,
  // never reported as unavailable.
  assert.equal(texts().includes("hidden/unavailable"), false);
  assert.equal(texts().includes("Invoked only"), true);
  const toggle = view()
    .querySelectorAll("button")
    .find((button) => button.dataset.filter === "invokedOnly");
  assert.notEqual(toggle, undefined);
  harness.click(toggle as StubElement);
  assert.equal(texts().includes("deploy"), true);
  assert.equal(texts().includes("2 shown · 0 hidden"), true);
});

test("the History table hides unavailable sessions by default and reveals them", async () => {
  const harness = createWebClient({
    responses: [uiSnapshot()],
    hash: "#/history/overview",
  });
  await harness.start();
  const view = (): StubElement => harness.element("view");
  const membership = (): (string | undefined)[] =>
    view()
      .querySelectorAll("tr")
      .filter((row) => row.dataset.membership !== undefined)
      .map((row) => row.dataset.membership);
  assert.deepEqual(membership(), ["member"]);
  assert.equal(harness.texts(view()).join(" ").includes("session-b"), false);
  assert.equal(
    harness.texts(view()).join(" ").includes("1 shown · 1 hidden/unavailable"),
    true,
  );
  const toggle = view()
    .querySelectorAll("button")
    .find((button) => button.dataset.filter === "availableOnly");
  assert.notEqual(toggle, undefined);
  harness.click(toggle as StubElement);
  assert.deepEqual(membership(), ["member", "unknown"]);
  assert.equal(harness.texts(view()).join(" ").includes("session-b"), true);
});

// ---------------------------------------------------------------------------
// The Agents execution view: Tree | Table, run containers, and the session root
// ---------------------------------------------------------------------------

const CONTAINER_ID = `subagent-${"f".repeat(64)}`;

/**
 * One run row as L2 publishes it. The parent verdict is an input here: L2 owns
 * it, and these tests render what it published rather than re-deriving it.
 */
function agentRow(input: {
  id: string;
  parentId?: string | null;
  parent?: UiAgentParent;
  agent?: string | null;
  status?: UiAgentRow["status"];
  model?: string | null;
  thinking?: string | null;
  artifacts?: UiAgentRow["artifacts"];
  tokens?: number | null;
  cost?: number | null;
}): UiAgentRow {
  const tokens = input.tokens === undefined ? null : input.tokens;
  const cost = input.cost === undefined ? null : input.cost;
  return {
    id: input.id,
    parentId: input.parentId ?? null,
    agent: input.agent === undefined ? "worker" : input.agent,
    status: input.status ?? "succeeded",
    confidence: "native",
    artifacts: input.artifacts ?? null,
    observedAt: null,
    evidenceToolId: null,
    model: input.model === undefined ? null : input.model,
    thinking: input.thinking === undefined ? null : input.thinking,
    failure: null,
    usage:
      tokens === null && cost === null
        ? null
        : { totalTokens: tokens ?? 0, cost: cost ?? 0 },
    parent: input.parent ?? "none",
  };
}

/** The DTO a run row arrives in: the fixture range, replaced with these rows. */
function treeSnapshot(rows: readonly UiAgentRow[]): InspectorUiSnapshot {
  const snapshot = uiSnapshot();
  const range = snapshot.current.tree.range;
  if (range === undefined) throw new Error("fixture must carry a tree range");
  range.agents = [...rows];
  const byStatus = {
    succeeded: 0,
    failed: 0,
    interrupted: 0,
    running: 0,
    unknown: 0,
  };
  let withUsage = 0;
  for (const row of rows) {
    byStatus[row.status] += 1;
    if (row.usage !== null) withUsage += 1;
  }
  range.childUsage = {
    runsTotal: rows.length,
    runsWithUsage: withUsage,
    totalTokens: null,
    cost: null,
    failedCost: null,
    failedRunsWithUsage: 0,
    byStatus,
  };
  return snapshot;
}

/** Every text the rendered view shows, in one string. */
function viewText(harness: Harness): string {
  return harness.texts(harness.element("view")).join(" ");
}

/** The Agents view switch button for one mode. */
function viewButton(harness: Harness, mode: string): StubElement {
  const found = harness
    .element("view")
    .querySelectorAll("button")
    .find((button) => button.dataset.agentsView === mode);
  if (found === undefined) throw new Error(`no ${mode} control`);
  return found;
}

/** One tree row's toggle, by the identity the row renders. */
function treeToggle(harness: Harness, label: string): StubElement {
  const found = harness
    .element("view")
    .querySelectorAll("button")
    .find(
      (button) =>
        button.attributes["aria-label"] === `Collapse ${label}` ||
        button.attributes["aria-label"] === `Expand ${label}`,
    );
  if (found === undefined) throw new Error(`no toggle for ${label}`);
  return found;
}

/** The rendered tree rows, as their identity text. */
function treeRows(harness: Harness): string[] {
  return harness
    .element("view")
    .querySelectorAll("li")
    .map((row) => row.dataset.treeRow ?? "");
}

test("the Agents view is a Tree by default and keeps the table one click away", async () => {
  const parentId = `subagent-${"1".repeat(64)}`;
  const childId = `subagent-${"2".repeat(64)}`;
  const harness = createWebClient({
    responses: [
      treeSnapshot([
        agentRow({ id: parentId, agent: "reviewer" }),
        agentRow({
          id: childId,
          agent: "scout",
          parentId,
          parent: "in-range",
        }),
      ]),
    ],
    hash: "#/current/llm?scope=tree&preset=7",
  });
  await harness.start();

  assert.equal(viewButton(harness, "tree").attributes["aria-pressed"], "true");
  assert.equal(
    viewButton(harness, "table").attributes["aria-pressed"],
    "false",
  );
  // The tree nests the child in its parent's own list, not in a flat list.
  const child = harness
    .element("view")
    .querySelectorAll("li")
    .find((row) => row.dataset.treeRow === childId);
  if (child === undefined) throw new Error("the nested run must be rendered");
  const parentRow = child.parentNode?.parentNode;
  assert.equal(parentRow?.dataset.treeRow, parentId);

  // Table is a real route: it survives a reload and Back restores the tree.
  harness.click(viewButton(harness, "table"));
  assert.equal(harness.location.hash.includes("view=table"), true);
  assert.equal(
    harness.element("view").querySelectorAll("table").length > 0,
    true,
  );
  assert.equal(harness.element("view").querySelectorAll("ul").length, 0);

  harness.click(viewButton(harness, "tree"));
  assert.equal(harness.location.hash.includes("view=table"), false);
  assert.equal(harness.element("view").querySelectorAll("ul").length > 0, true);
});

test("a collapsed branch hides its children and states what it hides", async () => {
  const parentId = `subagent-${"3".repeat(64)}`;
  const failedId = `subagent-${"4".repeat(64)}`;
  const harness = createWebClient({
    responses: [
      treeSnapshot([
        agentRow({ id: parentId, agent: "reviewer" }),
        agentRow({
          id: failedId,
          agent: "scout",
          parentId,
          parent: "in-range",
          status: "failed",
        }),
        agentRow({
          id: `subagent-${"5".repeat(64)}`,
          agent: "worker",
          parentId,
          parent: "in-range",
        }),
      ]),
    ],
    hash: "#/current/llm?scope=tree&preset=7",
  });
  await harness.start();
  const toggle = treeToggle(harness, "reviewer");
  assert.equal(toggle.attributes["aria-expanded"], "true");
  assert.equal(viewText(harness).includes("scout"), true);

  harness.click(toggle);
  const collapsed = treeToggle(harness, "reviewer");
  assert.equal(collapsed.attributes["aria-expanded"], "false");
  // A hidden failure is never silently hidden: the summary states it.
  assert.equal(viewText(harness).includes("scout"), false);
  assert.equal(viewText(harness).includes("2 descendants"), true);
  assert.equal(viewText(harness).includes("1 failed"), true);

  harness.click(treeToggle(harness, "reviewer"));
  assert.equal(
    treeToggle(harness, "reviewer").attributes["aria-expanded"],
    "true",
  );
  assert.equal(viewText(harness).includes("scout"), true);
});

test("children of one run container group under a node that is not an agent", async () => {
  const harness = createWebClient({
    responses: [
      treeSnapshot([
        agentRow({
          id: `subagent-${"6".repeat(64)}`,
          agent: "reviewer",
          parentId: CONTAINER_ID,
          parent: "orchestration-run",
        }),
        agentRow({
          id: `subagent-${"7".repeat(64)}`,
          agent: "worker",
          parentId: CONTAINER_ID,
          parent: "orchestration-run",
          status: "failed",
        }),
        agentRow({
          id: `subagent-${"8".repeat(64)}`,
          agent: "scout",
          parentId: CONTAINER_ID,
          parent: "orchestration-run",
        }),
      ]),
    ],
    hash: "#/current/llm?scope=tree&preset=7",
  });
  await harness.start();
  const text = viewText(harness);
  assert.equal(text.includes("Run container"), true);
  assert.equal(text.includes("3 children"), true);
  assert.equal(text.includes("1 failed"), true);
  // The container is a group node; each child is its own row.
  assert.equal(treeRows(harness).filter((row) => row !== "").length, 3);
  // A group node is never a run row: it carries no run identity at all.
  const container = harness
    .element("view")
    .querySelectorAll("li")
    .find((row) => row.className.includes("is-container"));
  if (container === undefined) throw new Error("the container row must exist");
  assert.equal(container.dataset.treeRow, undefined);
  assert.equal(
    container.closest("[data-entity]"),
    null,
    "the container is not an entity",
  );
  const groupLabel = harness
    .element("view")
    .querySelectorAll("span")
    .find((span) => span.className.includes("tree-group"));
  assert.notEqual(groupLabel, undefined);
  assert.equal(
    harness
      .element("view")
      .querySelectorAll("span")
      .some((span) => span.dataset.entity === `agent:${CONTAINER_ID}`),
    false,
  );
  // The producer's container identity is never rendered.
  assert.equal(text.includes(CONTAINER_ID), false);
  // Every child is a real agent row, and there are exactly three of them.
  assert.equal(
    harness
      .element("view")
      .querySelectorAll("span")
      .filter((span) => (span.dataset.entity ?? "").startsWith("agent:"))
      .length,
    3,
  );
});

test("a single child of a run container is flattened, stating its parent verdict", async () => {
  const harness = createWebClient({
    responses: [
      treeSnapshot([
        agentRow({
          id: `subagent-${"9".repeat(64)}`,
          agent: "worker",
          parentId: CONTAINER_ID,
          parent: "orchestration-run",
        }),
      ]),
    ],
    hash: "#/current/llm?scope=tree&preset=7",
  });
  await harness.start();
  const text = viewText(harness);
  // The run is rendered as one tree row of its own, with no group node around it.
  assert.equal(treeRows(harness).filter((row) => row !== "").length, 1);
  assert.equal(text.includes("Run container"), false);
  assert.equal(text.includes("Parent: orchestration run"), true);
  assert.equal(text.includes(CONTAINER_ID), false);
});

test("the session root summarizes one model without claiming a launch", async () => {
  const harness = createWebClient({
    responses: [
      treeSnapshot([
        agentRow({
          id: `subagent-${"a".repeat(64)}`,
          agent: "worker",
          model: "terraform-luna",
          thinking: "high",
          tokens: 34_477,
          cost: 0.004893924,
        }),
      ]),
    ],
    hash: "#/current/llm?scope=tree&preset=7",
  });
  await harness.start();
  const text = viewText(harness);
  assert.equal(text.includes("Primary session"), true);
  assert.equal(text.includes("alpha · 2 generations"), true);
  assert.equal(text.includes("1,200 tokens"), true);
  assert.equal(text.includes("$0.24"), true);
  // The child's own model, tokens, and cost are its own row's figures.
  assert.equal(text.includes("terraform-luna · high"), true);
  assert.equal(text.includes("34,477 tokens"), true);
  assert.equal(text.includes("$0.0049"), true);
  assert.equal(/\$0\.00(?!\d)/.test(text), false);
});

test("several session models are listed, never reduced to one primary model", async () => {
  const snapshot = treeSnapshot([
    agentRow({ id: `subagent-${"b".repeat(64)}`, agent: "worker" }),
  ]);
  const range = snapshot.current.tree.range;
  if (range === undefined) throw new Error("fixture must carry a tree range");
  range.models = [
    {
      provider: "acme",
      model: "alpha",
      generations: 287,
      totalTokens: 1000,
      cost: 0.2,
    },
    {
      provider: "acme",
      model: "luna",
      generations: 15,
      totalTokens: 200,
      cost: 0.04,
    },
  ];
  const harness = createWebClient({
    responses: [snapshot],
    hash: "#/current/llm?scope=tree&preset=7",
  });
  await harness.start();
  const text = viewText(harness);
  assert.equal(text.includes("2 models used"), true);
  const models = harness
    .element("view")
    .querySelectorAll("button")
    .find((button) => button.textContent === "Models");
  if (models === undefined) throw new Error("the models detail must exist");
  assert.equal(models.attributes["aria-expanded"], "false");
  // The detail names each model's own generations; neither is called primary.
  assert.equal(text.includes("alpha · 287 generations"), false);
  harness.click(models);
  const expanded = viewText(harness);
  assert.equal(expanded.includes("alpha · 287 generations"), true);
  assert.equal(expanded.includes("luna · 15 generations"), true);
  // The root stays the session's own root: no model is promoted to its label.
  assert.equal(expanded.includes("Primary session"), true);
  assert.equal(expanded.includes("2 models used"), true);
});

test("search keeps the ancestors a matching child needs, and marks them as context", async () => {
  const parentId = `subagent-${"c".repeat(64)}`;
  const harness = createWebClient({
    responses: [
      treeSnapshot([
        agentRow({ id: parentId, agent: "reviewer", model: "deepseek" }),
        agentRow({
          id: `subagent-${"d".repeat(64)}`,
          agent: "scout",
          parentId,
          parent: "in-range",
          model: "terraform-luna",
        }),
        agentRow({ id: `subagent-${"e".repeat(64)}`, agent: "worker" }),
      ]),
    ],
    hash: "#/current/llm?scope=tree&preset=7",
  });
  await harness.start();
  const search = harness.element("search");
  search.value = "scout";
  harness.input(search);
  const text = viewText(harness);
  assert.equal(text.includes("reviewer"), true);
  assert.equal(text.includes("scout"), true);
  assert.equal(text.includes("worker"), false);
  assert.equal(text.includes("context"), true);
  assert.equal(text.includes("1 of 3 runs match"), true);
});

test("a status and a model filter keep the same ancestor context", async () => {
  const parentId = `subagent-${"1a".repeat(32)}`;
  const harness = createWebClient({
    responses: [
      treeSnapshot([
        agentRow({ id: parentId, agent: "reviewer", model: "deepseek" }),
        agentRow({
          id: `subagent-${"1b".repeat(32)}`,
          agent: "scout",
          parentId,
          parent: "in-range",
          model: "terraform-luna",
          status: "failed",
        }),
      ]),
    ],
    hash: "#/current/llm?scope=tree&preset=7",
  });
  await harness.start();
  const model = harness.element("agent-model");
  model.value = "terraform-luna";
  harness.change(model);
  assert.equal(viewText(harness).includes("reviewer"), true);
  assert.equal(viewText(harness).includes("1 of 2 runs match"), true);

  const status = harness.element("agent-status");
  status.value = "succeeded";
  harness.change(status);
  const text = viewText(harness);
  assert.equal(text.includes("0 of 2 runs match"), true);
  assert.equal(text.includes("No run matches"), true);

  const all = harness.element("agent-status");
  all.value = "";
  harness.change(all);
  assert.equal(viewText(harness).includes("scout"), true);
});

test("an unavailable child model and partial child usage stay stated, never blank", async () => {
  const parentId = `subagent-${"1c".repeat(32)}`;
  const harness = createWebClient({
    responses: [
      treeSnapshot([
        agentRow({ id: parentId, agent: "reviewer" }),
        agentRow({
          id: `subagent-${"1d".repeat(32)}`,
          agent: "scout",
          parentId,
          parent: "in-range",
        }),
      ]),
    ],
    hash: "#/current/llm?scope=tree&preset=7",
  });
  await harness.start();
  const text = viewText(harness);
  assert.equal(text.includes("Unavailable"), true);
  assert.equal(text.includes("usage Unavailable"), true);
  // The coverage fraction is L2's own figure and is never implied complete.
  assert.equal(text.includes("0 of 2 runs reported usage"), true);
});

test("a nested agent is revealed by its route, even in a collapsed forest", async () => {
  const rows: UiAgentRow[] = [];
  for (let index = 0; index < 60; index += 1) {
    rows.push(agentRow({ id: `root-${index}`, agent: `root-${index}` }));
    rows.push(
      agentRow({
        id: `child-${index}`,
        agent: `child-${index}`,
        parentId: `root-${index}`,
        parent: "in-range",
      }),
    );
  }
  // One deep target, three levels down a branch of its own.
  rows.push(agentRow({ id: "deep-root", agent: "deep-root" }));
  rows.push(
    agentRow({
      id: "deep-mid",
      agent: "deep-mid",
      parentId: "deep-root",
      parent: "in-range",
    }),
  );
  rows.push(
    agentRow({
      id: "deep-target",
      agent: "deep-target",
      parentId: "deep-mid",
      parent: "in-range",
    }),
  );
  const started = process.hrtime.bigint();
  const harness = createWebClient({
    responses: [treeSnapshot(rows)],
    hash: "#/current/llm?scope=tree&preset=7&entity=agent%3Adeep-target",
  });
  await harness.start();
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  // 123 runs, progressively disclosed: the ancestors of the focused run are
  // expanded, and nothing else is.
  assert.equal(treeRows(harness).includes("deep-target"), true);
  assert.equal(harness.activeElement()?.dataset.entity, "agent:deep-target");
  assert.equal(
    harness.element("view").querySelectorAll(".entity-focus").length,
    1,
  );
  const rendered = treeRows(harness).filter((row) => row !== "").length;
  assert.equal(rendered <= 130, true, `rendered ${rendered} rows`);
  assert.equal(elapsedMs < 5000, true, `${elapsedMs}ms`);
});

test("focusing an agent never pins the view, and Back restores what it showed", async () => {
  const parentId = `subagent-${"2a".repeat(32)}`;
  const childId = `subagent-${"2b".repeat(32)}`;
  const harness = createWebClient({
    responses: [
      treeSnapshot([
        agentRow({ id: parentId, agent: "reviewer" }),
        agentRow({
          id: childId,
          agent: "scout",
          parentId,
          parent: "in-range",
        }),
      ]),
    ],
    hash: `#/current/llm?scope=tree&preset=7&entity=agent%3A${childId}`,
  });
  await harness.start();
  assert.equal(harness.activeElement()?.dataset.entity, `agent:${childId}`);

  // A focused entity keeps the reader free to change the view it is shown in.
  harness.click(viewButton(harness, "table"));
  assert.equal(
    harness.location.hash,
    `#/current/llm?scope=tree&view=table&preset=7&entity=agent%3A${childId}`,
  );
  assert.equal(
    harness.element("view").querySelectorAll("table").length > 0,
    true,
  );
  assert.equal(harness.activeElement()?.dataset.entity, `agent:${childId}`);
  assert.equal(
    harness.element("view").querySelectorAll(".entity-focus").length,
    1,
  );

  // Back returns to the tree the reader came from, with the same focused row.
  harness.location.hash = `#/current/llm?scope=tree&preset=7&entity=agent%3A${childId}`;
  harness.popstate();
  assert.equal(harness.element("view").querySelectorAll("ul").length > 0, true);
  assert.equal(harness.activeElement()?.dataset.entity, `agent:${childId}`);
});

test("a zero cost is the only cost that renders as zero", async () => {
  const harness = createWebClient({
    responses: [
      treeSnapshot([
        agentRow({
          id: `subagent-${"3a".repeat(32)}`,
          agent: "worker",
          tokens: 12,
          cost: 0,
        }),
        agentRow({
          id: `subagent-${"3b".repeat(32)}`,
          agent: "reviewer",
          tokens: 34_477,
          cost: 0.004893924,
        }),
      ]),
    ],
    hash: "#/current/llm?scope=tree&preset=7",
  });
  await harness.start();
  assert.equal(/\$0\.00(?!\d)/.test(viewText(harness)), true);
  assert.equal(viewText(harness).includes("$0.0049"), true);
  // The same rule holds in the table view of the same rows.
  harness.click(viewButton(harness, "table"));
  assert.equal(/\$0\.00(?!\d)/.test(viewText(harness)), true);
  assert.equal(viewText(harness).includes("$0.0049"), true);
});

test("a filter keeps the tree open, so a disclosure control never stands dead", async () => {
  const parentId = `subagent-${"6a".repeat(32)}`;
  const harness = createWebClient({
    responses: [
      treeSnapshot([
        agentRow({ id: parentId, agent: "reviewer" }),
        agentRow({
          id: `subagent-${"6b".repeat(32)}`,
          agent: "scout",
          parentId,
          parent: "in-range",
        }),
      ]),
    ],
    hash: "#/current/llm?scope=tree&preset=7",
  });
  await harness.start();
  assert.notEqual(treeToggle(harness, "reviewer"), undefined);
  const search = harness.element("search");
  search.value = "scout";
  harness.input(search);
  // Every level a filter matches is held open, so no row offers a toggle whose
  // state the reader could not change; the counts still state what is shown.
  assert.equal(
    harness
      .element("view")
      .querySelectorAll("button")
      .filter((button) => button.dataset.treeToggle !== undefined).length,
    0,
  );
  assert.equal(viewText(harness).includes("reviewer"), true);
  assert.equal(viewText(harness).includes("context"), true);
});

test("a collapsed session root states how many runs it holds", async () => {
  const parentId = `subagent-${"7a".repeat(32)}`;
  const harness = createWebClient({
    responses: [
      treeSnapshot([
        agentRow({ id: parentId, agent: "reviewer" }),
        agentRow({
          id: `subagent-${"7b".repeat(32)}`,
          agent: "scout",
          parentId,
          parent: "in-range",
          status: "failed",
        }),
      ]),
    ],
    hash: "#/current/llm?scope=tree&preset=7",
  });
  await harness.start();
  const root = treeToggle(harness, "Primary session");
  assert.equal(root.attributes["aria-expanded"], "true");
  harness.click(root);
  const text = viewText(harness);
  assert.equal(
    treeToggle(harness, "Primary session").attributes["aria-expanded"],
    "false",
  );
  assert.equal(text.includes("2 descendants"), true);
  assert.equal(text.includes("1 failed"), true);
  // The hidden runs are gone from the page, and the session's own figures stay.
  assert.equal(text.includes("scout"), false);
  assert.equal(text.includes("alpha · 2 generations"), true);
});

test("the entry scope note explains a scope switch that changes nothing", async () => {
  const snapshot = treeSnapshot([
    agentRow({ id: `subagent-${"4a".repeat(32)}`, agent: "worker" }),
  ]);
  snapshot.current.sameReportProjection = true;
  const harness = createWebClient({
    responses: [snapshot],
    hash: "#/current/llm?scope=tree&preset=7",
  });
  await harness.start();
  assert.equal(
    harness.element("scope-sub").textContent,
    createTranslator("en")("scope.sameReport"),
  );
});

test("a run container and the session root are never rendered as agent rows", async () => {
  const rows = [
    agentRow({
      id: `subagent-${"5a".repeat(32)}`,
      agent: "reviewer",
      parentId: CONTAINER_ID,
      parent: "orchestration-run",
    }),
    agentRow({
      id: `subagent-${"5b".repeat(32)}`,
      agent: "worker",
      parentId: CONTAINER_ID,
      parent: "orchestration-run",
    }),
  ];
  const snapshot = treeSnapshot(rows);
  const harness = createWebClient({
    responses: [snapshot],
    hash: "#/current/llm?scope=tree&preset=7",
  });
  await harness.start();
  // Exactly the DTO's own runs carry an agent identity: the session root and the
  // container add none, and nothing is added to the report the DTO carries.
  const marks = harness
    .element("view")
    .querySelectorAll("span")
    .filter((span) => (span.dataset.entity ?? "").startsWith("agent:"));
  assert.deepEqual(
    marks.map((span) => span.dataset.entity),
    rows.map((row) => `agent:${row.id}`),
  );
  assert.equal(snapshot.current.tree.range?.agents.length, 2);
});

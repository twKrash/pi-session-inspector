import assert from "node:assert/strict";
import { test } from "node:test";

import {
  filterView,
  historyRowRange,
  isInRange,
  latestObservedDate,
  parseRangeQuery,
  presetRange,
  resolveRange,
  serializeRangeQuery,
  shiftUtcDay,
} from "../../src/ui/range.ts";
import {
  deriveView,
  parseRoute,
  routeKey,
  serializeRoute,
  type InspectorRoute,
} from "../../src/ui/route.ts";

const capabilities = {
  current: [
    "overview",
    "models",
    "tools",
    "environment",
    "agents",
    "integrations",
    "errors",
    "ledger",
  ],
  history: ["overview"],
  global: ["overview"],
};
const observed = ["2026-09-01", "2026-09-11", "2026-09-12"];
const defaults = {
  scope: "active" as const,
  capabilities,
  knownIds: new Set(["tool:call-abc", "subagent-aaaa"]),
};

test("a route round-trips with the canonical parameter order", () => {
  const route: InspectorRoute = {
    section: "current",
    tab: "tools",
    scope: "tree",
    range: { kind: "preset", preset: 7 },
    entity: { kind: "tool", id: "tool:call-abc" },
    table: { query: "bash", sort: "cost" },
  };
  const hash = serializeRoute(route);
  assert.equal(
    hash,
    "#/current/tools?scope=tree&preset=7&entity=tool%3Atool%3Acall-abc&q=bash&sort=cost",
  );
  assert.deepEqual(parseRoute(hash, defaults).route, route);
  assert.equal(routeKey(parseRoute(hash, defaults).route), hash);
});

test("a preset stays unresolved in the hash and resolves against the view's dates", () => {
  const { route } = parseRoute("#/current/tools?scope=tree&preset=7", defaults);
  assert.deepEqual(route.range, { kind: "preset", preset: 7 });
  assert.equal(serializeRoute(route), "#/current/tools?scope=tree&preset=7");
  assert.deepEqual(deriveView(route, capabilities, observed).range, {
    preset: 7,
    from: "2026-09-06",
    to: "2026-09-12",
  });
});

test("a view with nothing observed has no range and no sentinel", () => {
  const view = deriveView(
    parseRoute("#/current/tools", defaults).route,
    capabilities,
    [],
  );
  assert.equal(view.range, undefined);
  assert.equal(
    /1970-01-01/.test(
      serializeRoute(parseRoute("#/current/tools", defaults).route),
    ),
    false,
  );
});

test("custom ranges round-trip; lone or inverted endpoints fall back with a notice", () => {
  const route: InspectorRoute = {
    section: "current",
    tab: "tools",
    scope: "tree",
    range: { kind: "custom", from: "2026-09-01", to: "2026-09-12" },
  };
  assert.equal(
    serializeRoute(route),
    "#/current/tools?scope=tree&from=2026-09-01&to=2026-09-12",
  );
  assert.deepEqual(
    parseRoute(serializeRoute(route), defaults).route.range,
    route.range,
  );
  for (const hash of [
    "#/current/tools?from=2026-09-01",
    "#/current/tools?from=2026-09-12&to=2026-09-01",
    "#/current/tools?preset=99",
  ]) {
    const parsed = parseRoute(hash, defaults);
    assert.deepEqual(
      [parsed.route.range, parsed.notice],
      [undefined, "range-restored"],
      hash,
    );
  }
});

test("unsupported sections and tabs degrade with a notice", () => {
  const global = parseRoute("#/global/models", defaults);
  assert.deepEqual(
    [global.route.tab, global.notice],
    ["overview", "tab-unavailable"],
  );
  const unknown = parseRoute("#/nope/overview", defaults);
  assert.deepEqual(
    [unknown.route.section, unknown.notice],
    ["current", "section-unavailable"],
  );
});

test("unknown ids are dropped, never echoed", () => {
  assert.equal(
    parseRoute("#/current/tools?entity=agent%3ASECRET%20TEXT", defaults).route
      .entity,
    undefined,
  );
});

test("deriveView exposes exactly the state that drives rendering", () => {
  const view = deriveView(
    {
      section: "global",
      tab: "models",
      scope: "tree",
      range: { kind: "preset", preset: 30 },
    },
    capabilities,
    observed,
  );
  assert.deepEqual(
    [view.activeSection, view.activeTab, view.notice, view.focusTarget],
    ["global", "overview", "tab-unavailable", "section-heading"],
  );
  assert.deepEqual(
    [view.visibleTabs, view.range],
    [["overview"], { preset: 30, from: "2026-08-14", to: "2026-09-12" }],
  );
});

test("the parameter order is canonical and the scope is current-only", () => {
  // Scope is emitted for every `current` route — "active" included — so a
  // deep link restores the pressed scope without reading `initialScope`, and
  // the scope key never leads a non-current route (design §9.1).
  assert.equal(
    serializeRoute({ section: "current", tab: "overview", scope: "active" }),
    "#/current/overview?scope=active",
  );
  const current: InspectorRoute = {
    section: "current",
    tab: "tools",
    scope: "tree",
    range: { kind: "custom", from: "2026-09-01", to: "2026-09-12" },
    entity: { kind: "tool", id: "tool:call-abc" },
    table: { query: "bash", sort: "cost" },
  };
  assert.equal(
    serializeRoute(current),
    "#/current/tools?scope=tree&from=2026-09-01&to=2026-09-12&entity=tool%3Atool%3Acall-abc&q=bash&sort=cost",
  );
  assert.deepEqual(
    parseRoute(serializeRoute(current), defaults).route,
    current,
  );

  // `preset` precedes `session` (the brief's order, not the design's example
  // order), and a history route carries the caller's scope without emitting it.
  const options = {
    scope: "active" as const,
    capabilities,
    knownIds: new Set(["session-a", "subagent-aaaa"]),
  };
  const history: InspectorRoute = {
    section: "history",
    tab: "overview",
    session: "session-a",
    scope: "tree",
    range: { kind: "preset", preset: 14 },
    entity: { kind: "agent", id: "subagent-aaaa" },
  };
  assert.equal(
    serializeRoute(history),
    "#/history/overview?preset=14&session=session-a&entity=agent%3Asubagent-aaaa",
  );
  assert.deepEqual(parseRoute(serializeRoute(history), options).route, {
    ...history,
    scope: "active",
  });
  // The scope of a non-current route is the caller's default, so the canonical
  // key of a history route never depends on the scope it carries.
  assert.equal(
    routeKey({ ...history, scope: "active" }),
    routeKey({ ...history, scope: "tree" }),
  );
});

test("only a validated preset or pair is ever serialized", () => {
  const base = { section: "current", tab: "tools", scope: "tree" } as const;
  assert.equal(serializeRoute(base), "#/current/tools?scope=tree");
  assert.equal(
    serializeRoute({
      ...base,
      range: {
        kind: "custom",
        from: "2026-09-12",
        to: "2026-09-01",
      },
    }),
    "#/current/tools?scope=tree",
  );
  assert.equal(
    serializeRoute({
      ...base,
      range: { kind: "preset", preset: 99 as unknown as 7 },
    }),
    "#/current/tools?scope=tree",
  );
  assert.equal(
    serializeRoute({
      ...base,
      range: { kind: "custom", from: "2026-9-1", to: "2026-09-12" },
    }),
    "#/current/tools?scope=tree",
  );
});

test("an unknown scope or parameter degrades silently, never echoing text", () => {
  const fallback = {
    scope: "tree" as const,
    capabilities,
    knownIds: new Set<string>(),
  };
  const parsed = parseRoute("#/current/tools?scope=nope&unknown=1", fallback);
  assert.deepEqual([parsed.route.scope, parsed.notice], ["tree", undefined]);
  assert.equal(serializeRoute(parsed.route), "#/current/tools?scope=tree");
  const global = parseRoute("#/global/overview?scope=tree", fallback);
  assert.deepEqual(
    [global.route.scope, serializeRoute(global.route)],
    ["tree", "#/global/overview"],
  );
});

test("a session is kept only when the projection exposes it", () => {
  const known = {
    scope: "active" as const,
    capabilities,
    knownIds: new Set(["session-a"]),
  };
  assert.equal(
    parseRoute("#/history/overview?session=session-a", known).route.session,
    "session-a",
  );
  const unknown = parseRoute("#/history/overview?session=SECRET", known);
  assert.equal(unknown.route.session, undefined);
  assert.equal(serializeRoute(unknown.route), "#/history/overview");
  // `session` is history-only: on another section it is ignored outright.
  assert.equal(
    parseRoute("#/current/tools?session=session-a", known).route.session,
    undefined,
  );
});

test("entity kinds are a closed set and ids come from the projection", () => {
  const known = {
    scope: "active" as const,
    capabilities,
    knownIds: new Set(["tool:call-abc", "subagent-aaaa", "claude"]),
  };
  const kept = parseRoute(
    "#/current/models?entity=model%3Aclaude",
    known,
  ).route;
  assert.deepEqual(kept.entity, { kind: "model", id: "claude" });
  assert.equal(
    serializeRoute(kept),
    "#/current/models?scope=active&entity=model%3Aclaude",
  );
  assert.deepEqual(
    parseRoute("#/current/tools?entity=agent%3Asubagent-aaaa", known).route
      .entity,
    { kind: "agent", id: "subagent-aaaa" },
  );
  for (const hash of [
    // an unknown kind, even with a known id
    "#/current/tools?entity=widget%3Atool%3Acall-abc",
    // a known kind with an id the projection does not expose
    "#/current/tools?entity=tool%3Aunknown",
    // an empty id
    "#/current/tools?entity=tool%3A",
    // a kind without an id
    "#/current/tools?entity=tool",
    // whitespace is not an id
    "#/current/tools?entity=tool%3A%20",
  ]) {
    assert.equal(parseRoute(hash, known).route.entity, undefined, hash);
  }
});

test("parsing is total: hostile or malformed input degrades and never throws", () => {
  const inputs = [
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
  ];
  for (const input of inputs) {
    const parsed = parseRoute(input, defaults);
    assert.equal(
      ["current", "history", "global"].includes(parsed.route.section),
      true,
      String(input),
    );
    assert.equal(typeof parsed.route.tab, "string", String(input));
    assert.equal(
      /"|%E0|SECRET/.test(serializeRoute(parsed.route)),
      false,
      String(input),
    );
  }
  // A malformed escape is not a value: the parameter is ignored, never echoed.
  const malformed = parseRoute(
    "#/current/tools?q=%E0%A4%A&sort=cost",
    defaults,
  );
  assert.deepEqual(malformed.route.table, { sort: "cost" });
  // A full URL contributes only its fragment, so a path or URL can never enter
  // the route; the unknown scheme is simply an unrecognized section token.
  assert.equal(
    serializeRoute(
      parseRoute(
        "https://example.test/secret/path#/current/tools?scope=tree",
        defaults,
      ).route,
    ),
    "#/current/tools?scope=tree",
  );
});

test("deriving a range never reads a clock and never invents a fallback range", () => {
  const route: InspectorRoute = {
    section: "current",
    tab: "tools",
    scope: "active",
    range: { kind: "preset", preset: 7 },
  };
  // No observed date means nothing to anchor a preset on: no range, and no
  // restored-range claim (the restore claim belongs to the raw hash).
  const empty = deriveView(route, capabilities, []);
  assert.deepEqual([empty.range, empty.notice], [undefined, undefined]);
  // A validated custom pair is honoured even with no observed dates.
  const custom = deriveView(
    {
      ...route,
      range: { kind: "custom", from: "2026-09-01", to: "2026-09-12" },
    },
    capabilities,
    [],
  );
  assert.deepEqual(custom.range, {
    preset: null,
    from: "2026-09-01",
    to: "2026-09-12",
  });
  // A default current range spans the observed dates; an aggregate defaults to
  // the 14-day preset (design §5.1).
  assert.deepEqual(
    deriveView({ ...route, range: undefined }, capabilities, observed).range,
    {
      preset: null,
      from: "2026-09-01",
      to: "2026-09-12",
    },
  );
  assert.deepEqual(
    deriveView(
      { ...route, section: "global", tab: "overview", range: undefined },
      capabilities,
      observed,
    ).range,
    { preset: 14, from: "2026-08-30", to: "2026-09-12" },
  );
});

test("parseRoute and deriveView coerce a section and tab identically", () => {
  for (const hash of [
    "#/global/models",
    "#/nope/models",
    "#/nope/overview",
    "#/current/environment",
    "#/history/ledger",
  ]) {
    const { route } = parseRoute(hash, defaults);
    const view = deriveView(route, capabilities, observed);
    assert.deepEqual(
      [route.section, route.tab],
      [view.activeSection, view.activeTab],
      hash,
    );
    assert.equal(view.visibleTabs.includes(route.tab), true, hash);
  }
});

test("every exported function survives inlining with no module scope", () => {
  // Mirrors Task 14's inline list: the range helpers the route functions call,
  // then the route module's own functions, declared in the same block order.
  const source = [
    shiftUtcDay,
    latestObservedDate,
    presetRange,
    resolveRange,
    isInRange,
    serializeRangeQuery,
    parseRangeQuery,
    filterView,
    historyRowRange,
    serializeRoute,
    routeKey,
    parseRoute,
    deriveView,
  ]
    .map((fn) => `const ${fn.name}=${String(fn)};`)
    .join("\n");
  assert.equal(/__name\(/.test(source), false);
  assert.equal(/Date\.now|Math\.random|new Date\(\)/.test(source), false);
  const inlined = new Function(
    `${source}\nreturn {parseRoute,serializeRoute,routeKey,deriveView};`,
  )() as {
    parseRoute: typeof parseRoute;
    serializeRoute: typeof serializeRoute;
    routeKey: typeof routeKey;
    deriveView: typeof deriveView;
  };
  const route: InspectorRoute = {
    section: "current",
    tab: "tools",
    scope: "tree",
    range: { kind: "preset", preset: 7 },
    entity: { kind: "tool", id: "tool:call-abc" },
    table: { query: "bash", sort: "cost" },
  };
  const hash =
    "#/current/tools?scope=tree&preset=7&entity=tool%3Atool%3Acall-abc";
  assert.equal(inlined.serializeRoute(route), serializeRoute(route));
  assert.equal(inlined.routeKey(route), routeKey(route));
  assert.deepEqual(
    inlined.parseRoute(hash, defaults),
    parseRoute(hash, defaults),
  );
  assert.deepEqual(
    inlined.deriveView(route, capabilities, observed),
    deriveView(route, capabilities, observed),
  );
});

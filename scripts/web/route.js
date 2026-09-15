/**
 * The browser's route grammar (`/route.js`): one canonical hash, parsed and
 * serialized with the closed section, tab and entity vocabularies.
 *
 * Canonical parameter order — the order this serializer emits, so one route has
 * exactly one string: `scope, preset, from, to, session, entity, q, sort`.
 * `scope` is serialized for `current` routes only, a preset serializes alone, and
 * a custom range serializes only as a validated pair. Parsing is total: any
 * hash, including a malformed one, degrades to the section default and at most a
 * bounded notice code, and an id the payload does not already expose is dropped
 * rather than echoed.
 *
 * This module owns the route grammar and the coercion that goes with it. It
 * resolves no range: the `range` member of the sibling `range.js` parses and
 * serializes the intent, and the resolved span is whatever the API returned.
 */
(function () {
  "use strict";
  const web = (globalThis.SessionInspectorWeb =
    globalThis.SessionInspectorWeb || {});

  /** The three sections of the document. */
  const SECTIONS = ["current", "history", "global"];
  /** The closed tab vocabulary; a view's capability list is bounded by it. */
  const TABS = [
    "overview",
    "llm",
    "tools",
    "environment",
    "integrations",
    "errors",
    "ledger",
  ];
  /** The closed entity vocabulary a drill-down may name. */
  const ENTITY_KINDS = [
    "model",
    "tool",
    "agent",
    "error",
    "integration",
    "command",
    "skill",
    "resource",
  ];
  const DATE = /^\d{4}-\d{2}-\d{2}$/;

  /** The range grammar, looked up at call time so load order cannot matter. */
  const rangeModule = () =>
    web.range !== undefined && typeof web.range.parse === "function"
      ? web.range
      : null;

  /**
   * The one canonical serialization of a route. A value that fails validation is
   * dropped rather than echoed, so every emitted hash re-parses to the same
   * route, and an optional field that is absent or null is simply not emitted.
   */
  function serialize(route) {
    const source = route === null || route === undefined ? {} : route;
    const section =
      source.section === "history" || source.section === "global"
        ? source.section
        : "current";
    const tab =
      typeof source.tab === "string" && source.tab !== ""
        ? source.tab
        : "overview";
    const pairs = [];
    if (section === "current") {
      pairs.push("scope=" + (source.scope === "tree" ? "tree" : "active"));
    }
    const intent = source.range;
    if (intent !== undefined && intent !== null) {
      if (intent.kind === "preset") {
        if (intent.preset === 7 || intent.preset === 14 || intent.preset === 30) {
          pairs.push("preset=" + intent.preset);
        }
      } else if (
        intent.kind === "custom" &&
        DATE.test(intent.from) &&
        DATE.test(intent.to) &&
        intent.from <= intent.to
      ) {
        pairs.push("from=" + intent.from, "to=" + intent.to);
      }
    }
    const session = source.session;
    if (section === "history" && typeof session === "string" && session !== "") {
      pairs.push("session=" + encodeURIComponent(session));
    }
    const entity = source.entity;
    if (
      entity !== undefined &&
      entity !== null &&
      ENTITY_KINDS.indexOf(entity.kind) >= 0 &&
      typeof entity.id === "string" &&
      entity.id !== ""
    ) {
      pairs.push("entity=" + encodeURIComponent(entity.kind + ":" + entity.id));
    }
    const table = source.table;
    if (table !== undefined && table !== null) {
      if (typeof table.query === "string" && table.query !== "") {
        pairs.push("q=" + encodeURIComponent(table.query));
      }
      if (typeof table.sort === "string" && table.sort !== "") {
        pairs.push("sort=" + encodeURIComponent(table.sort));
      }
    }
    const query = pairs.join("&");
    const path =
      "#/" + encodeURIComponent(section) + "/" + encodeURIComponent(tab);
    return query === "" ? path : path + "?" + query;
  }

  /** The canonical serialization, so one navigation has exactly one key. */
  function key(route) {
    return serialize(route);
  }

  /** Reads one fragment's parameters; a repeated key keeps its first value. */
  function parameters(query) {
    const params = new Map();
    const names = query.split("&");
    for (let index = 0; index < names.length; index += 1) {
      const part = names[index];
      if (part === "") continue;
      const separator = part.indexOf("=");
      if (separator < 1) continue;
      const name = part.slice(0, separator);
      let value;
      try {
        value = decodeURIComponent(part.slice(separator + 1));
      } catch (error) {
        // An escape that does not decode is not a value.
        continue;
      }
      if (!params.has(name)) params.set(name, value);
    }
    return params;
  }

  /** The range parameters, in canonical order, for the sibling range grammar. */
  function rangeQuery(params) {
    const parts = [];
    const names = ["preset", "from", "to"];
    for (let index = 0; index < names.length; index += 1) {
      const value = params.get(names[index]);
      if (value !== undefined) {
        parts.push(names[index] + "=" + encodeURIComponent(value));
      }
    }
    return parts.join("&");
  }

  /** The fragment query text of one hash: everything after its `?`. */
  function queryText(hash) {
    const source = typeof hash === "string" ? hash : "";
    const fragmentStart = source.indexOf("#");
    const fragment =
      fragmentStart >= 0 ? source.slice(fragmentStart + 1) : source;
    const question = fragment.indexOf("?");
    return question >= 0 ? fragment.slice(question + 1) : "";
  }

  /**
   * The hash's range parameters, in canonical order, as query text. A caller
   * that must know which range it is asking for (the API request) reads it from
   * here, so the one parameter grammar stays in this module.
   */
  function rangeQueryOf(hash) {
    return rangeQuery(parameters(queryText(hash)));
  }

  /**
   * Parses a hash into a route. Total: every input, including a malformed one,
   * degrades to the section default and never throws. A section outside the
   * closed vocabulary coerces to `current` with `section-unavailable`; a tab the
   * section's capability list does not offer coerces to the section's root tab
   * with `tab-unavailable`; a range the grammar cannot apply as a whole (a lone
   * endpoint, a malformed or inverted pair, an unknown preset) is dropped with
   * `range-restored`, never partially applied.
   */
  function parse(hash, options) {
    const source = typeof hash === "string" ? hash : "";
    const settings = options === null || options === undefined ? {} : options;
    const start = source.indexOf("#");
    const fragment = start >= 0 ? source.slice(start + 1) : source;
    const question = fragment.indexOf("?");
    const path = question >= 0 ? fragment.slice(0, question) : fragment;
    const params = parameters(queryText(source));
    const segments = [];
    const raw = path.split("/");
    for (let index = 0; index < raw.length; index += 1) {
      if (raw[index] === "") continue;
      try {
        segments.push(decodeURIComponent(raw[index]));
      } catch (error) {
        segments.push(raw[index]);
      }
    }

    const requestedSection = segments.length > 0 ? segments[0] : undefined;
    const section =
      requestedSection !== undefined && SECTIONS.indexOf(requestedSection) >= 0
        ? requestedSection
        : "current";
    const requestedTab =
      segments.length > 1 && segments[1] !== "" ? segments[1] : undefined;
    const table =
      settings.capabilities === null || settings.capabilities === undefined
        ? undefined
        : settings.capabilities[section];
    const tabs = Array.isArray(table) ? table : [];
    const defaultTab = tabs.length > 0 ? tabs[0] : "overview";

    let notice;
    if (requestedSection !== undefined && section !== requestedSection) {
      notice = "section-unavailable";
    }
    let tab = defaultTab;
    if (requestedTab !== undefined && tabs.indexOf(requestedTab) >= 0) {
      tab = requestedTab;
    } else if (requestedTab !== undefined && notice === undefined) {
      notice = "tab-unavailable";
    }

    const scopeParam = params.get("scope");
    const fallback = settings.scope === "tree" ? "tree" : "active";
    const scope =
      section !== "current" || (scopeParam !== "active" && scopeParam !== "tree")
        ? fallback
        : scopeParam;

    const route = { section: section, tab: tab, scope: scope };
    const rangeModuleValue = rangeModule();
    const requestedRange = rangeQuery(params);
    const intent =
      rangeModuleValue === null
        ? { ok: false }
        : rangeModuleValue.parse(requestedRange);
    if (intent.ok === true && intent.intent !== undefined) {
      route.range = intent.intent;
    } else if (
      intent.ok !== true &&
      requestedRange !== "" &&
      notice === undefined
    ) {
      notice = "range-restored";
    }

    const ids = Array.isArray(settings.knownIds) ? settings.knownIds : [];
    const session = params.get("session");
    if (
      section === "history" &&
      session !== undefined &&
      session !== "" &&
      ids.indexOf(session) >= 0
    ) {
      route.session = session;
    }
    const entity = params.get("entity");
    if (entity !== undefined) {
      const separator = entity.indexOf(":");
      const kind = separator > 0 ? entity.slice(0, separator) : "";
      const id = separator > 0 ? entity.slice(separator + 1) : "";
      if (ENTITY_KINDS.indexOf(kind) >= 0 && id !== "" && ids.indexOf(id) >= 0) {
        route.entity = { kind: kind, id: id };
      }
    }
    const state = {};
    const search = params.get("q");
    const sort = params.get("sort");
    if (search !== undefined && search !== "") state.query = search;
    if (sort !== undefined && sort !== "") state.sort = sort;
    if (state.query !== undefined || state.sort !== undefined) {
      route.table = state;
    }

    return notice === undefined ? { route: route } : { route: route, notice: notice };
  }

  /**
   * The state that drives rendering, derived from the route and the capability
   * table alone: the coerced section and tab, the tabs this section may render,
   * the scope, and where focus belongs when the caller moves it.
   *
   * A section with nothing to render (an unavailable view, whose capability list
   * is empty) stays silent about its own default tab: only a tab the route asks
   * for beyond that default is a capability this document could not honour.
   */
  function derive(route, capabilities) {
    const source = route === null || route === undefined ? {} : route;
    const requested =
      source.section === "history" || source.section === "global"
        ? source.section
        : "current";
    const table =
      capabilities === null || capabilities === undefined
        ? undefined
        : capabilities[requested];
    const visibleTabs = Array.isArray(table) ? table.slice() : [];
    const defaultTab = visibleTabs.length > 0 ? visibleTabs[0] : "overview";
    let notice;
    if (requested !== source.section) notice = "section-unavailable";
    let activeTab = defaultTab;
    const tab = typeof source.tab === "string" ? source.tab : "";
    if (tab !== "") {
      if (visibleTabs.indexOf(tab) >= 0) activeTab = tab;
      else if (notice === undefined && tab !== defaultTab) notice = "tab-unavailable";
    }
    const view = {
      activeSection: requested,
      activeTab: activeTab,
      visibleTabs: visibleTabs,
      scope: source.scope === "tree" ? "tree" : "active",
      focusTarget: "section-heading",
    };
    if (notice !== undefined) view.notice = notice;
    return view;
  }

  web.route = {
    sections: SECTIONS,
    tabs: TABS,
    entityKinds: ENTITY_KINDS,
    serialize: serialize,
    key: key,
    rangeQuery: rangeQueryOf,
    parse: parse,
    derive: derive,
  };
})();

/**
 * The pure route contract (design §9.1-§9.4): one authoritative, canonical
 * hash from which every piece of rendering state is derived.
 *
 * The hash is output, never input to trust. Only closed vocabularies (section,
 * tab, scope, preset), ISO dates, and ids the projection already exposes can
 * enter a route; anything else is dropped or coerced, never echoed. Parsing is
 * total: any hash, including a malformed one, degrades to the section default
 * and at most a bounded notice code.
 *
 * Canonical parameter order — the order every serializer emits, so one route
 * has exactly one string: `scope, preset, from, to, session, entity, q, sort`.
 * `scope` is serialized for `current` routes only, a preset serializes alone,
 * and a custom range serializes only as a validated `from`/`to` pair.
 *
 * Every exported function below is inlined into the generated document with
 * `Function.prototype.toString()` and evaluated with no module scope, so each
 * one is self-contained: no module-scope constant, no runtime import use, no
 * Node or DOM API, no clock read, and no nested named helper (the transpiler
 * wraps those with a module-scope `__name` helper, which the inlined source
 * cannot resolve). Constants are declared inside the function that uses them,
 * shared logic is written inline rather than as a helper, and the only
 * non-local names these functions use are the two range functions imported
 * below, which the inliner declares in the same scope ahead of them.
 * Type-only declarations are erased at runtime and carry no such requirement.
 */
import type { Scope } from "../core/events.ts";
import {
  parseRangeQuery,
  resolveRange,
  type RangeIntent,
  type RangeState,
} from "./range.ts";

/** The three sections of the document (design §9.3). */
export type RouteSection = "current" | "history" | "global";

/** The closed entity vocabulary a drill-down may name (design §9.1). */
export type EntityKind =
  | "model"
  | "tool"
  | "agent"
  | "error"
  | "integration"
  | "command"
  | "skill"
  | "resource";

/**
 * A drill-down target. `id` must be an id the projection already exposes: an
 * id outside the parsed `knownIds` set is dropped, never echoed.
 */
export type EntityRef = { kind: EntityKind; id: string };

/** The active table's own state (design §9.5); two tables never share one. */
export type RouteTable = { query?: string; sort?: string };

/**
 * One navigation state. `tab` is validated against the section's capability
 * list before it is ever active, `session` is history-only and `scope`
 * current-only — a route always carries a scope (the value the current
 * section will use), but only a current route serializes it.
 */
export type InspectorRoute = {
  section: RouteSection;
  tab: string;
  session?: string;
  scope: Scope;
  /** An unresolved range intent: a preset resolves against the view's dates. */
  range?: RangeIntent;
  entity?: EntityRef;
  table?: RouteTable;
};

/**
 * The tabs each section can render (design §9.3). A section missing from the
 * table (or listing no tab, or listing a value that is not an array) can render
 * none, so every requested tab is unsupported there and the route falls back to
 * the root tab.
 */
export type SectionCapabilities = Readonly<
  Partial<Record<RouteSection, readonly string[]>>
>;

/** The one bounded notice vocabulary; codes, never sentences (design §9.1). */
export type RouteNotice =
  | "section-unavailable"
  | "tab-unavailable"
  | "range-restored";

/**
 * A parsed route plus the first degradation the raw hash required, in the
 * precedence order `section-unavailable`, `tab-unavailable`, `range-restored`.
 */
export type ParsedRoute = { route: InspectorRoute; notice?: RouteNotice };

/** Everything parsing and derivation need beyond the route itself. */
export type RouteOptions = {
  /** The scope a route uses when the hash names none, or names it off-section. */
  scope: Scope;
  capabilities: SectionCapabilities;
  /**
   * Every id the projection exposes — entity ids and the history section's
   * session ids. An id outside this set is dropped, never echoed.
   */
  knownIds: ReadonlySet<string>;
};

/** The state that drives rendering, derived from the route alone (design §9.2). */
export type RouteView = {
  activeSection: RouteSection;
  activeTab: string;
  visibleTabs: readonly string[];
  scope: Scope;
  /** The range resolved against the view's own dates, never the machine clock. */
  range?: RangeState;
  entity?: EntityRef;
  /**
   * The capability a route could not honour. A `range-restored` notice is a
   * property of the raw hash, so `parseRoute` reports it; a caller renders
   * `view.notice ?? parsed.notice`.
   */
  notice?: RouteNotice;
  /** Where focus belongs when the caller moves it (design §9.2). */
  focusTarget: "section-heading";
};

/**
 * The one canonical serialization of a route (design §9.1). Emits the hash with
 * the canonical parameter order, and only values that pass validation: a
 * `current` route carries its scope, a non-current route never does, a preset
 * serializes alone, and a custom range needs a well-formed, non-inverted pair.
 * A value that fails validation is dropped rather than echoed, so the emitted
 * hash is always re-parsable to the same route.
 */
export function serializeRoute(route: InspectorRoute): string {
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
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
  const section: RouteSection =
    route.section === "history" || route.section === "global"
      ? route.section
      : "current";
  const tab =
    typeof route.tab === "string" && route.tab !== "" ? route.tab : "overview";
  const pairs: string[] = [];
  if (section === "current") {
    pairs.push(`scope=${route.scope === "tree" ? "tree" : "active"}`);
  }
  const range = route.range;
  if (range !== undefined) {
    if (range.kind === "preset") {
      if (range.preset === 7 || range.preset === 14 || range.preset === 30) {
        pairs.push(`preset=${range.preset}`);
      }
    } else if (
      range.kind === "custom" &&
      DATE.test(range.from) &&
      DATE.test(range.to) &&
      range.from <= range.to
    ) {
      pairs.push(`from=${range.from}`, `to=${range.to}`);
    }
  }
  const session = route.session;
  if (section === "history" && typeof session === "string" && session !== "") {
    pairs.push(`session=${encodeURIComponent(session)}`);
  }
  const entity = route.entity;
  if (
    entity !== undefined &&
    ENTITY_KINDS.indexOf(entity.kind) >= 0 &&
    typeof entity.id === "string" &&
    entity.id !== ""
  ) {
    pairs.push(`entity=${encodeURIComponent(`${entity.kind}:${entity.id}`)}`);
  }
  const table = route.table;
  if (table !== undefined) {
    if (typeof table.query === "string" && table.query !== "") {
      pairs.push(`q=${encodeURIComponent(table.query)}`);
    }
    if (typeof table.sort === "string" && table.sort !== "") {
      pairs.push(`sort=${encodeURIComponent(table.sort)}`);
    }
  }
  const query = pairs.join("&");
  const path = `#/${encodeURIComponent(section)}/${encodeURIComponent(tab)}`;
  return query === "" ? path : `${path}?${query}`;
}

/**
 * The canonical serialization, so one navigation has exactly one key and a
 * renderer can dedupe repeated `hashchange`/`popstate` events (design §9.2).
 */
export function routeKey(route: InspectorRoute): string {
  return serializeRoute(route);
}

/**
 * Parses a hash into a route. Total: every input, including a malformed one,
 * degrades to the section default and never throws.
 *
 * A section outside the closed vocabulary coerces to `current` with
 * `section-unavailable`; a tab the section's capability list does not offer
 * coerces to the section's root tab with `tab-unavailable`; a range the range
 * grammar cannot apply as a whole (a lone endpoint, a malformed or inverted
 * pair, an unknown preset) is dropped with `range-restored`, never partially
 * applied. Unknown parameters are ignored, and an id outside `knownIds` — a
 * session or an entity — is dropped, never echoed.
 */
export function parseRoute(hash: string, options: RouteOptions): ParsedRoute {
  const SECTIONS = ["current", "history", "global"];
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
  const text = typeof hash === "string" ? hash : "";
  // Only the fragment is read, so a path, a URL or a query string outside the
  // hash can never reach the route.
  const start = text.indexOf("#");
  const fragment = start >= 0 ? text.slice(start + 1) : text;
  const question = fragment.indexOf("?");
  const path = question >= 0 ? fragment.slice(0, question) : fragment;
  const query = question >= 0 ? fragment.slice(question + 1) : "";

  const params = new Map<string, string>();
  let rangeRequested = false;
  for (const part of query.split("&")) {
    if (part === "") continue;
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const key = part.slice(0, separator);
    if (key === "preset" || key === "from" || key === "to")
      rangeRequested = true;
    let value: string;
    try {
      value = decodeURIComponent(part.slice(separator + 1));
    } catch {
      // An escape that does not decode is not a value: the parameter is
      // ignored rather than echoed back into the route.
      continue;
    }
    if (!params.has(key)) params.set(key, value);
  }

  // A path segment stays in place when it cannot be decoded; both path tokens
  // are validated against a closed vocabulary, so it can only be rejected.
  const segments: string[] = [];
  for (const raw of path.split("/")) {
    if (raw === "") continue;
    try {
      segments.push(decodeURIComponent(raw));
    } catch {
      segments.push(raw);
    }
  }

  const requestedSection = segments.length > 0 ? segments[0] : undefined;
  const section: RouteSection =
    requestedSection !== undefined && SECTIONS.indexOf(requestedSection) >= 0
      ? (requestedSection as RouteSection)
      : "current";
  const requestedTab =
    segments.length > 1 && segments[1] !== "" ? segments[1] : undefined;
  // A caller-supplied table is untrusted input: a missing or non-array section
  // value lists no tab, so parsing stays total instead of throwing.
  const sectionTable = options.capabilities;
  const listed = sectionTable === undefined ? undefined : sectionTable[section];
  const tabs: readonly string[] = Array.isArray(listed) ? listed : [];
  const defaultTab = tabs.length > 0 ? tabs[0] : "overview";

  let notice: RouteNotice | undefined;
  if (requestedSection !== undefined && section !== requestedSection) {
    notice = "section-unavailable";
  }
  let tab = defaultTab;
  if (requestedTab !== undefined && tabs.indexOf(requestedTab) >= 0) {
    tab = requestedTab;
  } else if (requestedTab !== undefined && notice === undefined) {
    notice = "tab-unavailable";
  }

  // Scope is the caller's default off the current section, and an unknown or
  // absent scope value falls back to it rather than being echoed.
  const scopeParam = params.get("scope");
  const scope: Scope =
    section !== "current" || (scopeParam !== "active" && scopeParam !== "tree")
      ? options.scope
      : scopeParam;

  const route: InspectorRoute = { section, tab, scope };
  const intent = parseRangeQuery(query);
  if (intent !== undefined) route.range = intent;
  if (rangeRequested && intent === undefined && notice === undefined) {
    notice = "range-restored";
  }
  const knownIds = options.knownIds;
  const session = params.get("session");
  if (
    section === "history" &&
    session !== undefined &&
    session !== "" &&
    knownIds !== undefined &&
    knownIds.has(session)
  ) {
    route.session = session;
  }
  const entity = params.get("entity");
  if (entity !== undefined) {
    const separator = entity.indexOf(":");
    const kind = separator > 0 ? entity.slice(0, separator) : "";
    const id = separator > 0 ? entity.slice(separator + 1) : "";
    if (
      ENTITY_KINDS.indexOf(kind) >= 0 &&
      id !== "" &&
      knownIds !== undefined &&
      knownIds.has(id)
    ) {
      route.entity = { kind: kind as EntityKind, id };
    }
  }
  const table: RouteTable = {};
  const search = params.get("q");
  const sort = params.get("sort");
  if (search !== undefined && search !== "") table.query = search;
  if (sort !== undefined && sort !== "") table.sort = sort;
  if (table.query !== undefined || table.sort !== undefined)
    route.table = table;

  return notice === undefined ? { route } : { route, notice };
}

/**
 * Derives the state that drives rendering from the route alone (design §9.2):
 * the coerced section and tab, the tabs this section may render, the scope, the
 * range resolved against the view's own observed dates (a custom pair passes
 * through, a preset anchors on the latest observed date, `current` defaults to
 * the whole observed span and `aggregate` to 14 days) and the focused entity.
 *
 * It coerces exactly like `parseRoute`, so a route the parser accepted is
 * derived unchanged. With nothing observed there is no range to resolve — never
 * a clock-derived or sentinel one — and this function makes no claim about a
 * range the raw hash failed to restore: that notice belongs to `parseRoute`.
 *
 * `tab-unavailable` names a tab the route asked for beyond the section's own
 * default, so a section that can render nothing (an unavailable view, whose
 * capability list is empty) stays silent about its default tab.
 */
export function deriveView(
  route: InspectorRoute,
  capabilities: SectionCapabilities,
  observedDates: readonly string[],
): RouteView {
  const requested = route.section;
  const activeSection: RouteSection =
    requested === "history" || requested === "global" ? requested : "current";
  const sectionTable: SectionCapabilities | undefined = capabilities;
  const listed =
    sectionTable === undefined ? undefined : sectionTable[activeSection];
  const visibleTabs: string[] = Array.isArray(listed) ? listed.slice() : [];
  const defaultTab = visibleTabs.length > 0 ? visibleTabs[0] : "overview";
  let notice: RouteNotice | undefined;
  if (activeSection !== requested) notice = "section-unavailable";
  let activeTab = defaultTab;
  if (typeof route.tab === "string" && route.tab !== "") {
    if (visibleTabs.indexOf(route.tab) >= 0) activeTab = route.tab;
    // A section with nothing to render (an unavailable view) is silent about its
    // own default tab: only a tab the route asks for beyond that default is a
    // capability the document could not honour.
    else if (notice === undefined && route.tab !== defaultTab)
      notice = "tab-unavailable";
  }
  const view: RouteView = {
    activeSection,
    activeTab,
    visibleTabs,
    scope: route.scope,
    focusTarget: "section-heading",
  };
  const range = resolveRange(
    route.range,
    observedDates,
    activeSection === "current" ? "current" : "aggregate",
  );
  if (range !== undefined) view.range = range;
  if (route.entity !== undefined) view.entity = route.entity;
  if (notice !== undefined) view.notice = notice;
  return view;
}

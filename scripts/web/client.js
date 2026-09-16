/**
 * The interactive client (`/client.js`): token bootstrap, protected API requests,
 * navigation, loading/error state, and DOM rendering.
 *
 * It owns presentation only. Every report figure, range, membership, verdict and
 * availability it shows is read from the `InspectorUiSnapshot` the API returned:
 * this file resolves no range, filters no report row, sums no usage, decides no
 * membership or truncation verdict, does no calendar arithmetic, and never turns
 * an unavailable value into a zero. Search and sort only reorder, or hide, the
 * rows the rendered table was handed.
 *
 * Report-derived strings reach the document through `textContent` and bounded
 * `setAttribute` calls; report-derived markup is never parsed. First-party
 * storage, cookies, and sockets are not used, and the capability token lives in
 * one in-memory variable for the lifetime of the page. The theme a run starts
 * with comes from the report settings; the in-page toggle is presentation only.
 */
(function () {
  "use strict";
  const web = globalThis.SessionInspectorWeb;
  if (web === undefined || web.route === undefined || web.range === undefined) {
    throw new Error("browser route and range modules must initialize first");
  }
  const route = web.route;
  const range = web.range;

  /**
   * The presentation translator uses the same local catalog as the snapshot;
   * report semantics remain in the API DTO.
   */
  const translator = web.i18n;
  if (translator === undefined || typeof translator.t !== "function") {
    throw new Error("browser translator must initialize first");
  }
  const t = (key, values) => translator.t(key, values);
  const COPY = new Proxy(Object.create(null), {
    get: (_target, key) => (typeof key === "string" ? t(key) : undefined),
  });
  /**
   * The two projections this client borrows from L2's own modules instead of
   * re-implementing: the one cost rule, and the execution topology of the agent
   * rows it was handed. Both are the same code the snapshot renderer runs.
   */
  const format = web.format;
  if (format === undefined || typeof format.cost !== "function") {
    throw new Error("browser format module must initialize first");
  }
  const executions = web.agentTree;
  if (executions === undefined || typeof executions.build !== "function") {
    throw new Error("browser agent-tree module must initialize first");
  }
  // -------------------------------------------------------------------------
  // Namespace and small DOM helpers
  // -------------------------------------------------------------------------

  /** The route this page applies when the fragment names none. */
  const DEFAULT_KEY = "#/current/overview";
  /** The fragment the bootstrap consumes; nothing else is a bootstrap token. */
  const TOKEN_FRAGMENT = /^#token=([A-Za-z0-9_-]{1,256})$/;

  const q = (id) => document.getElementById(id);
  const text = (value) =>
    value === null || value === undefined ? "" : String(value);
  const number = (value) => new Intl.NumberFormat("en").format(Number(value));
  const compact = (value) =>
    new Intl.NumberFormat("en", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(Number(value));
  const money = (value) => format.cost(Number(value));
  const tr = (key, values) => t(key, values);
  const el = (name, cls, value) => {
    const node = document.createElement(name);
    if (cls) node.className = cls;
    if (value !== undefined) node.textContent = text(value);
    return node;
  };
  const isNode = (value) => typeof value === "object" && value !== null;
  const orUnavailable = (value) =>
    value === null || value === undefined
      ? COPY["evidence.unavailable"]
      : text(value);
  const numberOrUnavailable = (value) =>
    value === null || value === undefined
      ? COPY["evidence.unavailable"]
      : number(value);
  /**
   * One value a row may fail to carry. `null` is its only honest projection: a
   * gap in a line, and Unavailable in a table — never `NaN`, and never a
   * formatted figure, which is how `$0.00` or `< $0.0001` would otherwise be
   * invented for a value the row never held.
   */
  const chartPoint = (value) =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const publishedCell = (value, render) => {
    const point = chartPoint(value);
    return point === null ? COPY["evidence.unavailable"] : render(point);
  };
  const badge = (label, tone) =>
    el("span", "badge " + (tone || "neutral"), label);
  const assign = (base, extra) => {
    const result = {};
    Object.keys(base).forEach((key) => {
      result[key] = base[key];
    });
    Object.keys(extra).forEach((key) => {
      if (extra[key] !== undefined && extra[key] !== null)
        result[key] = extra[key];
    });
    return result;
  };

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  /** The capability token: memory only, never storage, a cookie, or a query. */
  let token = null;
  let snapshot = null;
  let loadedQuery = null;
  let loadedOnce = false;
  let lastAppliedKey = "";
  let stateNotice = undefined;
  let inFlight = null;
  // The identity of the newest request. A response the client has already
  // superseded (a second refresh, a range the reader moved on from) is dropped
  // rather than published, so a slow answer never overwrites a newer one.
  let latestRequest = 0;
  let startPromise = null;
  let state = { section: "current", tab: "overview", scope: "active" };
  let view = null;
  // The one drawn chart of the rendered view. It is destroyed before the view
  // subtree it lives in is replaced, recolored in place on a theme toggle, and
  // created only after its canvas is in the document, so the canvas is measured
  // where it is drawn rather than at zero size.
  let activeChart = null;
  let pendingChart = null;

  /** Whether the page shows the dark theme; the canvas colors must match it. */
  const isDarkTheme = () => document.body.className.includes("theme-dark");

  /** Releases the live chart, if any. Never throws at the caller. */
  const destroyChart = () => {
    if (activeChart === null) return;
    try {
      activeChart.destroy();
    } catch (error) {
      // Observer-only: a chart that cannot be destroyed must not break the page.
    }
    activeChart = null;
  };

  /** Creates the chart the last rendered view asked for, if any. */
  const mountChart = () => {
    const pending = pendingChart;
    pendingChart = null;
    if (pending === null || web.chart === undefined) return;
    try {
      activeChart = web.chart.createDailyChart(pending.canvas, pending.input);
    } catch (error) {
      // Observer-only: a chart that cannot be drawn leaves the table alone.
      activeChart = null;
    }
  };
  // One remembered range intent per view identity, and the ephemeral per-(view,
  // tab) settings of the views this document is not showing.
  const rangeIntents = {};
  const viewSettings = {};
  const toolFilters = {};

  // -------------------------------------------------------------------------
  // Route helpers
  // -------------------------------------------------------------------------

  const viewIdentity = (target) => {
    const current = target || state;
    if (current.section !== "history") return current.section;
    return typeof current.session === "string"
      ? "history:" + current.session
      : "history:aggregate";
  };
  const settingsKey = (target) => {
    const current = target || state;
    return viewIdentity(current) + "/" + current.tab;
  };
  const activeSettings = () => viewSettings[settingsKey()] || {};
  const routeTable = () => state.table || {};
  const activeQuery = () =>
    typeof routeTable().query === "string" ? routeTable().query : "";
  const activeSort = () =>
    typeof routeTable().sort === "string" ? routeTable().sort : "default";
  const sameEntity = (left, right) =>
    left === right ||
    (left !== undefined &&
      right !== undefined &&
      left.kind === right.kind &&
      left.id === right.id);

  /** The DTO's own initial scope decides a fragment that names no scope. */
  const initialScope = () =>
    snapshot !== null && snapshot.initialScope === "tree" ? "tree" : "active";

  const sessionEntries = () =>
    snapshot === null || !Array.isArray(snapshot.history.sessions)
      ? []
      : snapshot.history.sessions;

  /** The selected history session row, or null when the route names none. */
  const selectedSession = (target) => {
    const current = target || state;
    if (current.section !== "history" || typeof current.session !== "string") {
      return null;
    }
    const entries = sessionEntries();
    for (let index = 0; index < entries.length; index += 1) {
      if (entries[index].sessionId === current.session) return entries[index];
    }
    return null;
  };

  /** The session-shaped projection the applied route renders, when it has one. */
  const targetView = () => {
    if (snapshot === null) return null;
    if (state.section === "current")
      return snapshot.current[state.scope] || null;
    if (state.section === "global") return null;
    const entry = selectedSession();
    if (entry !== null && entry.view !== undefined) return entry.view;
    return null;
  };

  /**
   * The range metadata of the view being rendered, exactly as L2 published it:
   * a session-shaped target carries its own, and the two aggregates carry the
   * fold's. Nothing here resolves, clamps, or recomputes a span.
   */
  const rangeMeta = () => {
    if (snapshot === null) return null;
    if (state.section === "global") {
      return {
        requested: snapshot.global.requested,
        resolved: snapshot.global.resolved,
        truncated: snapshot.global.truncated,
        totals: snapshot.global.totals,
        daily: snapshot.global.daily,
      };
    }
    if (state.section === "history" && selectedSession() === null) {
      return {
        requested: snapshot.history.requested,
        resolved: snapshot.history.resolved,
        truncated: snapshot.history.truncated,
        totals: snapshot.history.totals,
        daily: snapshot.history.daily,
      };
    }
    const target = targetView();
    return target === null || target.range === undefined ? null : target.range;
  };

  /** Every id the returned snapshot already exposes, in one bounded set. */
  let known = null;
  const knownIds = () => {
    if (snapshot === null) return [];
    if (known !== null) return known;
    known = [];
    const add = (value) => {
      if (
        typeof value === "string" &&
        value !== "" &&
        known.indexOf(value) < 0
      ) {
        known.push(value);
      }
    };
    sessionEntries().forEach((entry) => add(entry && entry.sessionId));
    const views = [snapshot.current.active, snapshot.current.tree]
      .concat(sessionEntries().map((entry) => entry && entry.view))
      .filter((candidate) => candidate !== undefined && candidate !== null);
    views.forEach((target) => {
      const meta = target.range;
      if (meta !== undefined) {
        (meta.models || []).forEach((row) =>
          add(row.provider + "/" + row.model),
        );
        (meta.toolSummary || []).forEach((row) => add(row.name));
        (meta.toolCalls || []).forEach((row) => {
          add(row.id);
          add(row.name);
        });
        (meta.agents || []).forEach((row) => add(row.id));
        (meta.errors || []).forEach((row) => add(row.id));
      }
      const report = target.report;
      if (report === undefined) return;
      (report.integrations || []).forEach((row) => add(row.integration));
      if (report.commands)
        report.commands.items.forEach((row) => add(row.name));
      if (report.skills) report.skills.items.forEach((row) => add(row.name));
      if (report.resources) {
        report.resources.items.forEach((row) => add(row.sourceLabel));
      }
    });
    return known;
  };

  /**
   * The capability table a route is coerced against: a session-shaped view
   * publishes its own tab list, and the two aggregates compute only their
   * overview. Every list is bounded by the route module's closed tab vocabulary,
   * so a name this client cannot render never becomes a tab.
   */
  const capabilitiesFor = (target) => {
    const bound = (list) =>
      route.tabs.filter((tab) => Array.isArray(list) && list.indexOf(tab) >= 0);
    const current =
      snapshot === null || target.section !== "current"
        ? undefined
        : snapshot.current[target.scope];
    const entry = selectedSession(target);
    const sessionTabs =
      entry !== null && entry.view !== undefined ? entry.view.capabilities : [];
    return {
      current: bound(current === undefined ? [] : current.capabilities),
      history:
        bound(sessionTabs).length > 0 ? bound(sessionTabs) : ["overview"],
      global: ["overview"],
    };
  };

  /** The widest table a hash is parsed with; derivation coerces with the real one. */
  const parseCapabilities = () => ({
    current: route.tabs.slice(),
    history: route.tabs.slice(),
    global: ["overview"],
  });

  /** The section and tab a navigation actually applies. */
  const coerced = (candidate) => {
    const derived = route.derive(candidate, capabilitiesFor(candidate));
    return assign(assign({}, candidate), {
      section: derived.activeSection,
      tab: derived.activeTab,
    });
  };

  /**
   * One link-route builder: a destination keeps the context it can carry. A link
   * that stays on the same view identity keeps the active range; a link to
   * another identity leaves it out, so the entering view's own memory decides.
   * An explicit null clears a field rather than carrying it.
   */
  const routeFor = (patch) => {
    const section = patch.section !== undefined ? patch.section : state.section;
    const rawSession =
      patch.session !== undefined
        ? patch.session
        : section === state.section
          ? state.session
          : undefined;
    const session =
      section === "history" && typeof rawSession === "string"
        ? rawSession
        : undefined;
    const next = {
      section: section,
      tab: patch.tab !== undefined ? patch.tab : state.tab,
      scope: patch.scope !== undefined ? patch.scope : state.scope,
    };
    if (session !== undefined) next.session = session;
    const sameIdentity = viewIdentity(next) === viewIdentity(state);
    const intent =
      patch.range !== undefined
        ? patch.range
        : sameIdentity
          ? state.range
          : undefined;
    if (intent !== undefined && intent !== null) next.range = intent;
    // The Agents presentation is the reader's choice of view, so it travels with
    // every destination the same way the entry scope does. An explicit null
    // clears it back to the default rather than carrying it.
    const agentsView = patch.view !== undefined ? patch.view : state.view;
    if (agentsView !== undefined && agentsView !== null) next.view = agentsView;
    // The Environment subview is the same kind of choice: one route member the
    // reader sets, never a decision an entity makes on their behalf.
    const envPanel = patch.panel !== undefined ? patch.panel : state.panel;
    if (envPanel !== undefined && envPanel !== null) next.panel = envPanel;
    const entity =
      patch.entity !== undefined
        ? patch.entity
        : sameIdentity
          ? state.entity
          : undefined;
    if (entity !== undefined && entity !== null) next.entity = entity;
    const table =
      patch.table !== undefined
        ? patch.table
        : sameIdentity && next.tab === state.tab
          ? state.table
          : undefined;
    if (table !== undefined && table !== null) next.table = table;
    return next;
  };

  /** The destination tab of one entity kind. */
  const tabFor = (kind) => {
    if (kind === "model" || kind === "agent") return "llm";
    if (kind === "tool") return "tools";
    if (kind === "skill") return "skills";
    if (kind === "error") return "errors";
    if (kind === "integration") return "integrations";
    return "environment";
  };

  /**
   * The Environment subview one entity kind belongs to, or `null` for a kind
   * that panel does not show. A link to a command or a source therefore lands on
   * the subview that can display it, and the subview it names is what the reader
   * can then change.
   */
  const panelFor = (kind) => {
    if (kind === "command") return "commands";
    if (kind === "source") return "sources";
    return null;
  };

  /** One element's entity identity, or false when the id is not published. */
  const entityMark = (target, kind, id) => {
    if (knownIds().indexOf(id) < 0) return false;
    target.dataset.entity = kind + ":" + id;
    target.className =
      target.className === "" ? "entity" : target.className + " entity";
    return true;
  };

  /** A row's entity identity when the payload publishes it, else a plain span. */
  const entitySpan = (kind, id, label, cls) => {
    const span = el("span", cls || "mono", label);
    if (entityMark(span, kind, id)) span.setAttribute("tabindex", "-1");
    return span;
  };

  /** An entity link: a real hash route when the payload publishes the id. */
  const entityLink = (kind, id, label, cls) => {
    const link = el("a", cls || "", label);
    if (!entityMark(link, kind, id)) return el("span", cls || "", label);
    const patch = { tab: tabFor(kind), entity: { kind: kind, id: id } };
    // A command or a source link also names the subview its row lives in, so the
    // destination it hrefs is the destination a click on it builds. Every other
    // kind leaves the subview alone, exactly as the click handler does.
    const panel = panelFor(kind);
    if (panel !== null) patch.panel = panel;
    link.setAttribute("href", route.serialize(routeFor(patch)));
    return link;
  };

  // -------------------------------------------------------------------------
  // Hash writes
  // -------------------------------------------------------------------------

  /**
   * Replaces the current entry with `key` without adding one. A document that
   * refuses the replacement (a `file://` page, for example) falls back to the
   * hash assignment, so the route is never lost to a refused rewrite.
   */
  const writeHash = (key, replace) => {
    if (
      replace &&
      typeof history !== "undefined" &&
      history !== null &&
      typeof history.replaceState === "function"
    ) {
      try {
        history.replaceState(null, "", key);
        return;
      } catch (error) {
        // The fallback below is the destination either way.
      }
    }
    try {
      location.hash = key;
    } catch (error) {
      // A refused write leaves the applied route in memory; it is still rendered.
    }
  };

  /** Recognizes and consumes the bounded bootstrap fragment. */
  const consumeToken = () => {
    const hash = location.hash || "";
    const match = TOKEN_FRAGMENT.exec(hash);
    if (match === null) return null;
    writeHash(DEFAULT_KEY, true);
    return match[1];
  };

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  const setLoading = (active) => {
    const landmark = q("loading");
    if (landmark !== null) landmark.hidden = !active;
  };
  const setFailure = (active) => {
    const landmark = q("error");
    if (landmark !== null) landmark.hidden = !active;
  };

  /** The one query the client sends: the range intent, and nothing else. */
  const requestQuery = (hash) => {
    const text = route.rangeQuery(hash);
    if (text === "") return "";
    const parsed = range.parse(text);
    return parsed.ok === true && parsed.intent !== undefined
      ? range.query(parsed.intent)
      : "";
  };

  const requestUrl = (query) =>
    query === "" ? "/api/v1/ui" : "/api/v1/ui?" + query;

  /**
   * One protected request. The token is sent as the bearer credential only, and
   * the transport's own text never reaches the document: a failed request is one
   * bounded state, not a message. Only the newest request publishes a payload and
   * owns the loading state.
   */
  const load = async (query, id) => {
    setFailure(false);
    try {
      const response = await fetch(requestUrl(query), {
        headers: token === null ? {} : { Authorization: "Bearer " + token },
      });
      if (id !== undefined && id !== latestRequest) return false;
      if (response === undefined || response === null || response.ok !== true) {
        return false;
      }
      const body = await response.json();
      if (id !== undefined && id !== latestRequest) return false;
      if (body === undefined || body === null || body.kind !== "ui")
        return false;
      snapshot = body;
      loadedQuery = query;
      known = null;
      if (!loadedOnce) {
        loadedOnce = true;
        syncTheme();
      }
      return true;
    } catch (error) {
      return false;
    }
  };

  // -------------------------------------------------------------------------
  // Rendering primitives
  // -------------------------------------------------------------------------

  const card = (title, note, control) => {
    const section = el("section", "card");
    const head = el("div", "panel-head");
    const copy = el("div");
    copy.append(el("h2", "", title), el("p", "", note));
    head.append(copy);
    if (control !== undefined && control !== null) head.append(control);
    section.append(head);
    return section;
  };

  /** The one empty/unavailable section: a bounded label, never a fabricated row. */
  const emptyCard = (title, note) => {
    const section = el("section", "card empty");
    section.append(
      el("p", "eyebrow", COPY["unavailable.title"]),
      el("h2", "", title),
      el("p", "", note),
    );
    return section;
  };

  const metric = (title, value, note, details) => {
    const node = el("section", "card metric");
    node.append(
      el("div", "muted", title),
      el("div", "value mono", value),
      el("small", "", note),
    );
    const block = el("div", "breakdown");
    (details || []).forEach((item) => {
      const row = el("div", "breakdown-row");
      row.append(el("span", "", item[0]), el("span", "mono", item[1]));
      block.append(row);
    });
    node.append(block);
    return node;
  };

  const metrics = (cards) => {
    const grid = el("div", "metrics");
    cards.forEach((item) => grid.append(item));
    return grid;
  };

  const columnClass = (classes, index) =>
    classes !== undefined && classes[index] ? classes[index] : "";

  /** A cell's search text; an id cell's descriptor reads its content. */
  const cellText = (cell) => {
    if (isNode(cell) && typeof cell.fullId === "string") cell = cell.content;
    if (isNode(cell)) return text(cell.textContent);
    return text(cell);
  };

  /**
   * A cell's content: a real node when the caller built one, else its text. One
   * rule for both the tables and the execution tree, so a value that is a link
   * in a table is a link in the tree.
   */
  const appendCell = (parent, content) => {
    if (isNode(content) && content.tagName !== undefined) parent.append(content);
    else parent.textContent = text(content);
    return parent;
  };

  /** One opaque id's copy control: a real button, labelled with the id it copies. */
  const copyControl = (fullId) => {
    const button = el("button", "copy-id", COPY["table.copyId"]);
    button.dataset.copyId = "true";
    button.setAttribute("aria-label", COPY["table.copyId"] + " " + fullId);
    return button;
  };

  const simpleTable = (section, headers, rows, classes) => {
    const wrap = el("div", "table-wrap");
    const table = document.createElement("table");
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    headers.forEach((header, index) => {
      headRow.append(el("th", columnClass(classes, index), header));
    });
    head.append(headRow);
    const body = document.createElement("tbody");
    rows.forEach((row) => {
      const rowNode = document.createElement("tr");
      if (row.membership !== undefined) {
        rowNode.dataset.membership = row.membership;
      }
      const cells = row.cells === undefined ? row : row.cells;
      cells.forEach((value, index) => {
        const className =
          cells.length === headers.length ? columnClass(classes, index) : "";
        const cell = el("td", className);
        const opaque =
          className === "id-cell" &&
          isNode(value) &&
          typeof value.fullId === "string";
        const content = opaque ? value.content : value;
        appendCell(cell, content);
        if (className === "id-cell") {
          const fullId = opaque ? text(value.fullId) : cellText(content);
          cell.setAttribute("data-full-id", fullId);
          cell.append(copyControl(fullId));
        }
        rowNode.append(cell);
      });
      body.append(rowNode);
    });
    table.append(head, body);
    wrap.append(table);
    section.append(wrap);
    return section;
  };

  /**
   * One view's default-on availability filter, stated in that view's own terms:
   * the caller marks each of its rows `reportable` by its own fact — telemetry
   * evidence for integrations, an observed invocation for skills, a replayed
   * session for history — so no view inherits another's meaning of available.
   * The control and the counts are browser state of this view, never a report
   * value and never a persisted setting, and a hidden row is always revealable.
   */
  const viewFilter = (rows,spec) => {
    const only = activeSettings()[spec.name] !== false;
    const reportable = rows.filter((row) => row.reportable === true);
    const toggle = el("button", "filter", COPY[spec.labelKey]);
    toggle.dataset.filter = spec.name;
    toggle.setAttribute("aria-pressed", String(only));
    const bar = el("span", "filter-bar");
    bar.append(
      toggle,
      el(
        "span",
        "muted",
        tr(spec.countKey, {
          shown: number(only ? reportable.length : rows.length),
          // A revealed row is not hidden: the count states the filter's current
          // effect (0 while the filter is off), never what it would hide.
          hidden: number(only ? rows.length - reportable.length : 0),
        }),
      ),
    );
    return { rows: only ? reportable : rows, control: bar };
  };

  /**
   * One searchable table. Search and sort are the table's own view state: they
   * hide or reorder the rows this call was handed and never add, drop by a report
   * rule, or recompute a row. An optional view filter hides the rows that view
   * itself calls unreportable, always with its control, its counts and a way
   * back.
   */
  const table = (title, note, headers, rows, classes, filter, control) => {
    const section = card(title, note, control);
    const toolbar = el("div", "toolbar");
    const searchLabel = el("label", "", COPY.search);
    const search = document.createElement("input");
    search.id = "search";
    search.type = "search";
    search.value = activeQuery();
    search.placeholder = COPY["search.placeholder"];
    searchLabel.append(search);
    const sortLabel = el("label", "", COPY.sort);
    const sort = document.createElement("select");
    sort.id = "sort";
    [
      ["default", "sort.default"],
      ["name", "sort.name"],
      ["reverse", "sort.reverse"],
    ].forEach((item) => {
      const option = el("option", "", COPY[item[1]]);
      option.value = item[0];
      option.selected = activeSort() === item[0];
      sort.append(option);
    });
    sortLabel.append(sort);
    const filtered = filter === undefined ? null : viewFilter(rows, filter);
    if (filtered !== null) toolbar.append(filtered.control);
    toolbar.append(searchLabel, sortLabel);
    section.append(toolbar);
    const query = activeQuery().toLowerCase();
    const order = activeSort();
    let shown = (filtered === null ? rows : filtered.rows).filter((row) =>
      row.cells.map(cellText).join(" ").toLowerCase().includes(query),
    );
    if (order === "name") {
      shown = shown
        .slice()
        .sort((left, right) =>
          cellText(left.cells[0]).localeCompare(cellText(right.cells[0]), "en"),
        );
    }
    if (order === "reverse") shown = shown.slice().reverse();
    return simpleTable(section, headers, shown, classes);
  };

  const badgeCell = (label, tone) => {
    const span = el("span");
    span.append(badge(label, tone));
    return span;
  };

  // -------------------------------------------------------------------------
  // Section rendering (each figure is a published DTO field)
  // -------------------------------------------------------------------------

  /**
   * The chart data table's columns: the four fields every daily row publishes,
   * plus the two a session projection carries as well. `metrics` is the
   * section's own chart vocabulary, so a column exists exactly when a
   * selectable metric reads it and never for a field the rows do not publish.
   */
  const dailyColumns = (metrics) => {
    const columns = [
      {
        header: COPY["table.date"],
        cell: (row) => row.date,
        cls: "status-cell",
      },
      {
        header: COPY["table.sessions"],
        cell: (row) => publishedCell(row.sessions, number),
        cls: "num",
      },
      {
        header: COPY["table.tokens"],
        cell: (row) => publishedCell(row.totalTokens, number),
        cls: "num",
      },
      {
        header: COPY["table.cost"],
        cell: (row) => publishedCell(row.cost, money),
        cls: "num",
      },
    ];
    if (metrics.indexOf("generations") >= 0) {
      columns.push({
        header: COPY["table.generations"],
        cell: (row) => publishedCell(row.generations, number),
        cls: "num",
      });
    }
    if (metrics.indexOf("tools") >= 0) {
      columns.push({
        header: COPY["table.tools"],
        cell: (row) => publishedCell(row.tools, number),
        cls: "num",
      });
    }
    return columns;
  };

  const evidenceSection = (rows) => {
    if (rows === undefined || rows.length === 0) {
      return emptyCard(COPY["panel.evidence"], COPY["evidence.note"]);
    }
    return simpleTable(
      card(COPY["panel.evidence"], COPY["evidence.note"]),
      [
        COPY["table.source"],
        COPY["table.observation"],
        COPY["table.confidence"],
      ],
      rows.map((row) => ({
        cells: [
          row.source,
          row.observation,
          badgeCell(row.confidence, "neutral"),
        ],
      })),
      ["status-cell", "wrap", "status-cell"],
    );
  };

  const compositionSection = (composition) => {
    if (
      composition === null ||
      composition === undefined ||
      !composition.available
    ) {
      return emptyCard(COPY["usage.title"], COPY["unavailable.composition"]);
    }
    const rows = composition.parts.map((part) => ({
      cells: [
        tr("metric.usage." + part.key),
        number(part.totalTokens),
        money(part.cost),
        badgeCell(COPY["evidence.native"], ""),
      ],
    }));
    if (composition.total !== undefined) {
      rows.push({
        cells: [
          COPY["usage.total"],
          number(composition.total.totalTokens),
          money(composition.total.cost),
          badgeCell(COPY["evidence.native"], ""),
        ],
      });
    }
    const section = card(COPY["usage.title"], COPY["usage.note"]);
    section
      .querySelector(".panel-head")
      .append(
        badge(
          composition.reconciles
            ? COPY["usage.reconciled"]
            : COPY["usage.unreconciled"],
          composition.reconciles ? "neutral" : "warn",
        ),
      );
    return simpleTable(
      section,
      [
        COPY["table.source"],
        COPY["table.tokens"],
        COPY["table.cost"],
        COPY["table.confidence"],
      ],
      rows,
      ["wrap", "num", "num", "status-cell"],
    );
  };

  const chartValue = (row, name) => {
    if (name === "cost") return row.cost;
    if (name === "tokens") return row.totalTokens;
    if (name === "generations") return row.generations;
    if (name === "tools") return row.tools;
    return row.sessions;
  };
  const chartFormat = (name) => (name === "cost" ? "cost" : "number");
  const chartLabel = (name) => COPY["chart." + name];
  /**
   * Money and counts do not share a scale, so a chart of more than one metric
   * splits them: `cost` takes the right axis and the count metrics share the
   * left one. A chart of a single metric splits nothing and draws on the left
   * axis, which is the rendering a lone metric has always had.
   */
  const chartAxis = (name, split) => (split && name === "cost" ? "y1" : "y");
  const CHART_METRICS = ["sessions", "cost", "tokens", "generations", "tools"];
  /**
   * The global aggregate's daily rows publish their date, session count and
   * usage — no generation or tool count — so its chart vocabulary is the subset
   * its own rows carry. No metric outside that vocabulary is offered, and a
   * value the selected row list does not publish is never charted as a zero.
   */
  const GLOBAL_CHART_METRICS = ["sessions", "cost", "tokens"];
  /**
   * What a chart shows before the reader chooses otherwise: the pair whose units
   * differ, so the default already states the axis rule. A vocabulary that
   * carries neither falls back to its own first metric.
   */
  const DEFAULT_CHART_METRICS = ["cost", "tokens"];
  /** The vocabulary of the chart now on screen, for its picker's clicks. */
  let chartVocabulary = [];

  /**
   * The metrics this chart draws: the reader's remembered choice for this view,
   * narrowed to what the view's rows publish, and the default when nothing is
   * remembered. A metric the rows cannot fill is still offered and selected — it
   * is stated as Unavailable rather than dropped from the picker.
   */
  const selectedMetrics = (metrics, remembered = activeSettings().metrics) => {
    const chosen = Array.isArray(remembered)
      ? metrics.filter((name) => remembered.indexOf(name) >= 0)
      : [];
    if (chosen.length > 0) return chosen;
    const preferred = metrics.filter(
      (name) => DEFAULT_CHART_METRICS.indexOf(name) >= 0,
    );
    return preferred.length === 0 ? metrics.slice(0, 1) : preferred;
  };

  /**
   * The metric picker: one pressed toggle per selectable metric, in vocabulary
   * order. The selection is this view's own browser state — never a report
   * value, never written to storage — and the last pressed metric cannot be
   * turned off, because a chart of nothing is not a state this view offers.
   */
  const metricPicker = (metrics, chosen) => {
    const picker = el("span", "metric-picker");
    picker.setAttribute("role", "group");
    picker.setAttribute("aria-label", COPY["chart.metric"]);
    metrics.forEach((name) => {
      const toggle = el("button", "metric-toggle", chartLabel(name));
      toggle.dataset.metric = name;
      toggle.setAttribute("aria-pressed", String(chosen.indexOf(name) >= 0));
      picker.append(toggle);
    });
    return picker;
  };

  /**
   * One chart over the published daily rows, drawn by the bundled adapter, with
   * the reader's own metric selection. The caller decided which metrics the
   * view's rows publish; this section projects them, assigns the axes from their
   * units, and hands the adapter labels and values in the DTO's own order. A row
   * that does not publish a metric is a `null` point — a gap in that line and
   * Unavailable in the table below — and never a zero; a selected metric the
   * rows cannot fill at all is named as Unavailable and adds no empty series.
   * The exact-value table stays the accessible representation, and a browser
   * that cannot give us a canvas keeps that table and loses only the drawing.
   */
  const chartSection = (rows, metrics) => {
    const section = card(COPY["panel.daily"], rangeText());
    const chosen = selectedMetrics(metrics);
    chartVocabulary = metrics;
    section.querySelector(".panel-head").append(metricPicker(metrics, chosen));
    if (rows.length === 0) {
      section.append(el("div", "chart-note", COPY["chart.empty"]));
      return section;
    }
    // One series per selected metric: a row that does not publish the metric is
    // a gap in that line, never a zero it never read.
    const split = chosen.length > 1;
    const unavailable = [];
    const series = [];
    chosen.forEach((name) => {
      const values = rows.map((row) => chartPoint(chartValue(row, name)));
      if (values.every((point) => point === null)) {
        unavailable.push(chartLabel(name));
        return;
      }
      series.push({
        axis: chartAxis(name, split),
        format: chartFormat(name),
        key: name,
        label: chartLabel(name),
        values: values,
      });
    });
    if (series.length === 0) {
      section.append(el("div", "chart-note", COPY["evidence.unavailable"]));
      return section;
    }
    const drawn = series.map((entry) => entry.label).join(", ");
    const figure = el("div", "chart");
    const chartModule = web.chart;
    const canvas = document.createElement("canvas");
    if (
      chartModule !== undefined &&
      typeof chartModule.createDailyChart === "function" &&
      typeof canvas.getContext === "function"
    ) {
      canvas.setAttribute("class", "line-chart");
      const host = el("div", "chart-canvas");
      host.append(canvas);
      figure.append(host);
      // Drawn after the view swap, when the canvas has a size to measure.
      pendingChart = {
        canvas: canvas,
        input: {
          ariaLabel: tr("chart.aria", { days: rows.length, metrics: drawn }),
          format: (kind, value) =>
            kind === "cost" ? money(value) : number(value),
          labels: rows.map((row) => row.date),
          series: series,
          theme: chartModule.chartTheme(isDarkTheme()),
        },
      };
    }
    figure.append(
      el(
        "div",
        "chart-dates",
        rows[0].date + " → " + rows[rows.length - 1].date,
      ),
    );
    section.append(
      figure,
      el("div", "chart-note", tr("chart.note", { metrics: drawn })),
    );
    if (split) {
      section.append(el("div", "chart-note", COPY["chart.axes"]));
    }
    if (unavailable.length > 0) {
      section.append(
        el(
          "div",
          "chart-note",
          tr("chart.unavailable", { metrics: unavailable.join(", ") }),
        ),
      );
    }
    const details = document.createElement("details");
    details.append(el("summary", "", COPY["chart.data"]));
    const columns = dailyColumns(metrics);
    simpleTable(
      details,
      columns.map((column) => column.header),
      rows.map((row) => columns.map((column) => column.cell(row))),
      columns.map((column) => column.cls),
    );
    section.append(details);
    return section;
  };

  const overviewNodes = (target) => {
    const report = target.report;
    const meta = rangeMeta();
    if (report === undefined || report.usage === undefined) {
      return [
        emptyCard(COPY["usage.title"], COPY["unavailable.usage"]),
        evidenceSection(target.evidence),
      ];
    }
    const resolved =
      meta !== null && meta.resolved !== null ? meta.resolved : null;
    if (resolved !== null && Number(meta.totals.days) === 0) {
      return [
        emptyCard(COPY["usage.title"], COPY["chart.empty"]),
        evidenceSection(target.evidence),
      ];
    }
    const totals = resolved === null || meta === null ? null : meta.totals;
    const partial = meta !== null && meta.truncated === true;
    const usage = report.usage;
    const costValue =
      totals === null ? COPY["evidence.unavailable"] : money(totals.cost);
    const tokensValue =
      totals === null
        ? COPY["evidence.unavailable"]
        : number(totals.totalTokens);
    const childCount = numberOrUnavailable(report.agentCount);
    const cards = [
      metric(
        partial ? COPY["metric.knownCost"] : COPY["metric.cost"],
        costValue,
        COPY["metric.native"],
        [
          [COPY["table.date"], rangeText()],
          [COPY["metric.child"], childCount],
        ],
      ),
      metric(
        partial ? COPY["metric.knownTokens"] : COPY["metric.tokens"],
        tokensValue,
        COPY["metric.tokens.note"],
        [
          [COPY["metric.input"], compactOrUnavailable(usage.inputTokens)],
          [COPY["metric.output"], compactOrUnavailable(usage.outputTokens)],
          [
            COPY["metric.cacheRead"],
            compactOrUnavailable(usage.cacheReadTokens),
          ],
          [
            COPY["metric.cacheWrite"],
            compactOrUnavailable(usage.cacheWriteTokens),
          ],
          [
            COPY["metric.cacheHit"],
            typeof report.cacheHitPercent === "number"
              ? report.cacheHitPercent.toFixed(1) + "%"
              : COPY["evidence.unavailable"],
          ],
          [COPY["usage.total"], tokensValue],
        ],
      ),
      metric(
        COPY["metric.compactions"],
        number(report.compactionCount),
        COPY["metric.compactions.note"],
      ),
      metric(
        COPY["metric.generations"],
        totals === null
          ? COPY["evidence.unavailable"]
          : number(totals.generations),
        COPY["metric.generations.note"],
      ),
      metric(
        COPY["metric.tools"],
        totals === null ? COPY["evidence.unavailable"] : number(totals.tools),
        COPY["metric.tools.note"],
      ),
      metric(
        COPY["metric.days"],
        totals === null ? COPY["evidence.unavailable"] : number(totals.days),
        COPY["metric.days.note"],
      ),
      metric(
        COPY["metric.duration"],
        orUnavailable(report.durationLabel),
        COPY["metric.duration.note"],
        [
          [
            COPY["evidence.native"],
            report.span === null
              ? COPY["evidence.unavailable"]
              : report.span.from + " → " + report.span.to,
          ],
        ],
      ),
      metric(COPY["metric.child"], childCount, COPY["metric.child.note"]),
    ];
    return [
      metrics(cards),
      compositionSection(meta === null ? null : meta.composition),
      chartSection(meta === null ? [] : meta.daily, CHART_METRICS),
      evidenceSection(target.evidence),
    ];
  };

  const compactOrUnavailable = (value) =>
    value === null || value === undefined
      ? COPY["evidence.unavailable"]
      : compact(value);

  const modelsNodes = (target) => {
    const meta = target.range;
    const rows = meta === undefined ? [] : meta.models;
    if (rows.length === 0) {
      return [emptyCard(COPY["panel.models"], COPY["models.none"])];
    }
    const section = table(
      COPY["panel.models"],
      COPY["models.note"],
      [
        COPY["table.provider"],
        COPY["table.model"],
        COPY["table.generations"],
        COPY["table.tokens"],
        COPY["table.cost"],
      ],
      rows.map((row) => ({
        cells: [
          row.provider,
          entityLink(
            "model",
            row.provider + "/" + row.model,
            row.model,
            "mono",
          ),
          number(row.generations),
          number(row.totalTokens),
          money(row.cost),
        ],
      })),
      ["status-cell", "status-cell", "num", "num", "num"],
    );
    if (meta !== undefined && meta.modelsTruncated === true) {
      section.append(el("div", "footnote", COPY["models.truncated"]));
    }
    return [section];
  };

  /**
   * One section boundary: a group of panels that share a subject, separated from
   * the group above it by the surface's own border token and one restrained
   * margin, never by a decorative rule.
   *
   * A heading is added only where the group has no name of its own. A group of
   * cards that already carry headings keeps them, because a second heading would
   * repeat what the card below it already says.
   */
  const tabSection = (nodes, heading) => {
    const section = el("section", "tab-section");
    if (heading === undefined) {
      section.append(...nodes);
      return section;
    }
    const title = el("h2", "section-title", heading.label);
    title.id = heading.id;
    section.setAttribute("aria-labelledby", title.id);
    section.append(title, ...nodes);
    return section;
  };

  /**
   * The Agent execution section: the child-run breakdown and the Agents panel of
   * the same scope, under one heading, because those panels are cards without a
   * group name of their own. Model usage and agent execution are two different
   * subjects, and the boundary says where one ends and the other begins.
   */
  const agentExecutionSection = (target) =>
    tabSection(agentsNodes(target), {
      id: "agent-execution-title",
      label: COPY["section.agentExecution"],
    });

  /**
   * The one LLM tab: the scope's model table, and below it the child-run
   * breakdown of the same scope, under its own section heading. Both halves are
   * the DTO's own rows; this is a composition of two existing panels, never a
   * joined or recomputed figure.
   */
  const llmNodes = (target) => [
    ...modelsNodes(target),
    agentExecutionSection(target),
  ];

  /** Known usage only: a partial row keeps its qualifier and its own fraction. */
  const toolUsageCell = (value, labelKey, row) => {
    if (row.withUsage === 0) return COPY["evidence.unavailable"];
    if (row.partial === true) {
      const span = el("span");
      span.append(text(value) + " ", badge(COPY[labelKey], "warn"));
      span.append(
        el(
          "small",
          "",
          tr("tools.usageFraction", {
            withUsage: row.withUsage,
            total: row.calls,
          }),
        ),
      );
      return span;
    }
    return value;
  };

  /**
   * A duration figure for one grouped row: a missing correlation is Unavailable
   * (never `0 ms`), and a partial correlation carries its coverage beside the
   * figure so the total is never read as complete.
   */
  const toolDurationCell = (label, row) => {
    if (row.withDuration === 0) return COPY["evidence.unavailable"];
    if (row.durationPartial !== true) return text(label);
    const span = el("span");
    span.append(text(label) + " ", badge(COPY["metric.correlated"], "warn"));
    span.append(
      el(
        "small",
        "",
        tr("tools.durationFraction", {
          withDuration: row.withDuration,
          total: row.calls,
        }),
      ),
    );
    return span;
  };

  /** The mean correlated duration; the coverage note lives on the total. */
  const toolAverageCell = (label, row) =>
    row.withDuration === 0 ? COPY["evidence.unavailable"] : text(label);

  const toolsNodes = (target) => {
    const meta = target.range;
    if (meta === undefined) {
      return [emptyCard(COPY["tools.summary"], COPY["tools.none"])];
    }
    const summary = meta.toolSummary;
    if (summary.length === 0) {
      return [emptyCard(COPY["tools.summary"], COPY["tools.none"])];
    }
    const identity = viewIdentity();
    const filter =
      toolFilters[identity] === undefined ? null : toolFilters[identity];
    const summarySection = table(
      COPY["tools.summary"],
      COPY["tools.note"],
      [
        COPY["table.tool"],
        COPY["table.calls"],
        COPY["tools.succeeded"],
        COPY["tools.failed"],
        COPY["tools.interrupted"],
        COPY["table.tokens"],
        COPY["table.cost"],
        COPY["table.duration"],
        COPY["table.average"],
        COPY["tools.lastUsed"],
        COPY["table.source"],
      ],
      summary.map((row) => ({
        cells: [
          toolFilterButton(row.name),
          number(row.calls),
          number(row.succeeded),
          number(row.failed),
          number(row.interrupted),
          toolUsageCell(number(row.tokens), "metric.knownTokens", row),
          toolUsageCell(money(row.cost), "metric.knownCost", row),
          toolDurationCell(row.durationLabel, row),
          toolAverageCell(row.averageLabel, row),
          row.lastUsed,
          orUnavailable(row.source),
        ],
      })),
      [
        "status-cell",
        "num",
        "num",
        "num",
        "num",
        "num",
        "num",
        "num",
        "num",
        "status-cell",
        "status-cell",
      ],
    );
    const calls = meta.toolCalls.filter(
      (row) => filter === null || row.name === filter,
    );
    const callsCard =
      calls.length === 0
        ? emptyCard(COPY["tools.calls"], COPY["chart.empty"])
        : simpleTable(
            card(COPY["tools.calls"], COPY["tools.note"]),
            [
              COPY["table.timestamp"],
              COPY["table.tool"],
              COPY["table.source"],
              COPY["table.status"],
              COPY["table.tokens"],
              COPY["table.cost"],
            ],
            calls.map((row) => ({
              cells: [
                row.timestamp,
                row.name,
                orUnavailable(row.source),
                badgeCell(
                  COPY["tools." + row.status],
                  row.status === "succeeded" ? "" : "warn",
                ),
                row.usage === null
                  ? COPY["evidence.unavailable"]
                  : number(row.usage.totalTokens),
                row.usage === null
                  ? COPY["evidence.unavailable"]
                  : money(row.usage.cost),
              ],
            })),
            [
              "status-cell",
              "status-cell",
              "status-cell",
              "status-cell",
              "num",
              "num",
            ],
          );
    if (filter === null) return [summarySection, tabSection([callsCard])];
    // The filter is ephemeral state of the view it was chosen in, never a route.
    const bar = el("div", "toolbar");
    const clear = el("button", "", COPY["tools.clearFilter"]);
    clear.dataset.clearFilter = "true";
    bar.append(
      el("span", "muted", tr("tools.filteredBy", { tool: filter })),
      clear,
    );
    return [bar, summarySection, tabSection([callsCard])];
  };

  /** A summary row's own tool name narrows the calls list; it is not a route. */
  const toolFilterButton = (name) => {
    const button = el("button", "", name);
    button.dataset.toolFilter = name;
    button.setAttribute("aria-label", tr("tools.filteredBy", { tool: name }));
    entityMark(button, "tool", name);
    return button;
  };

  const inventoryCount = (value) =>
    value === null || value === undefined
      ? COPY["evidence.unavailable"]
      : number(value);

  const environmentNodes = (target) => {
    const report = target.report;
    if (report === undefined) {
      return [emptyCard(COPY["tab.environment"], COPY["unavailable.usage"])];
    }
    const availability = target.inventoryAvailability;
    const summary = card(COPY["tab.environment"], COPY["env.note"]);
    summary.append(
      metrics([
        metric(
          COPY["env.commands"],
          inventoryCount(availability.commands),
          tr("env.observed", { value: COPY["evidence.unavailable"] }),
        ),
        metric(
          COPY["env.resources"],
          inventoryCount(availability.resources),
          COPY["resources.note"],
        ),
      ]),
    );
    const subnav = el("div", "segments");
    subnav.setAttribute("role", "group");
    subnav.setAttribute("aria-label", COPY["tab.environment"]);
    // The route decides the subview. An entity may name it only when the route
    // names none, and the reader's next click supersedes that choice, so a
    // deep-linked command or source can never pin the panel it arrived in.
    const named =
      state.entity === undefined ? null : panelFor(state.entity.kind);
    const active =
      state.panel !== undefined && state.panel !== null
        ? state.panel
        : (named ?? route.defaultEnvPanel);
    route.envPanels.forEach((panel) => {
      const button = el("button", "", COPY["env.panel." + panel]);
      button.dataset.envTab = panel;
      button.setAttribute("aria-pressed", String(active === panel));
      subnav.append(button);
    });
    const nodes = [summary, subnav];
    if (active === "sources") {
      nodes.push(resourcesSection(report.resources, hasResources(target)));
    } else {
      nodes.push(commandsSection(report.commands));
    }
    return nodes;
  };

  /** True when the report publishes a resource section at all. */
  const hasResources = (target) => {
    const inventory = target.inventoryAvailability;
    return inventory.resources !== null && inventory.resources !== undefined;
  };

  const commandsSection = (commands) => {
    if (commands === undefined || commands.items.length === 0) {
      return emptyCard(
        COPY["env.commands"],
        commands !== undefined && commands.count !== null
          ? tr("commands.count", { count: number(commands.count) })
          : COPY["unavailable.commands"],
      );
    }
    return table(
      COPY["env.commands"],
      COPY["commands.note"],
      [
        COPY["table.name"],
        COPY["table.source"],
        COPY["table.scope"],
        COPY["table.origin"],
        COPY["table.description"],
      ],
      commands.items.map((row) => ({
        cells: [
          entityLink("command", row.name, row.name),
          orUnavailable(row.sourceLabel === "" ? row.source : row.sourceLabel),
          row.scope,
          row.origin,
          orUnavailable(row.description),
        ],
      })),
      ["status-cell", "status-cell", "status-cell", "status-cell", "wrap"],
    );
  };

  /**
   * The one Skills tab: the inventory the environment reports and the explicit
   * invocations the folded counters observed, stated separately because
   * inventory is availability, never activity. An installed skill nothing
   * invoked stays a row the view's own filter can reveal, never an Unavailable
   * claim about the skill.
   */
  const skillsNodes = (target) => {
    const skills = target.report.skills;
    const observed =
      skills.invocationState === "supported" && skills.invocationCount !== null
        ? tr("env.invocationsObserved", {
            count: number(skills.invocationCount),
          })
        : COPY["env.invocationsUnavailable"];
    return [
      metrics([
        metric(
          COPY["env.skills"],
          inventoryCount(target.inventoryAvailability.skills),
          observed,
        ),
      ]),
      skillsSection(skills),
    ];
  };

  const skillsSection = (skills) => {
    if (skills === undefined || skills.items.length === 0) {
      return emptyCard(COPY["env.skills"], COPY["skills.empty"]);
    }
    const section = table(
      COPY["env.skills"],
      COPY["skills.note"],
      [
        COPY["table.name"],
        COPY["table.source"],
        COPY["table.scope"],
        COPY["table.origin"],
        COPY["table.invocations"],
      ],
      skills.items.map((row) => ({
        // The view's own predicate: an observed explicit invocation, not
        // availability. A skill the inventory lists and nothing invoked is
        // hidden, never called unavailable.
        reportable:
          typeof row.explicitInvocations === "number" &&
          row.explicitInvocations > 0,
        cells: [
          entityLink("skill", row.name, row.name),
          orUnavailable(row.sourceLabel),
          orUnavailable(row.scope),
          orUnavailable(row.origin),
          row.explicitInvocations === undefined
            ? COPY["evidence.unavailable"]
            : number(row.explicitInvocations),
        ],
      })),
      ["status-cell", "status-cell", "status-cell", "status-cell", "num"],
      {
        name: "invokedOnly",
        labelKey: "filter.invokedOnly",
        countKey: "filter.count",
      },
    );
    if (
      skills.otherInvocations !== null &&
      skills.otherInvocations !== undefined &&
      skills.otherInvocations > 0
    ) {
      section.append(
        el(
          "div",
          "footnote",
          tr("skills.otherInvocations", {
            count: number(skills.otherInvocations),
          }),
        ),
      );
    }
    return section;
  };

  const resourcesSection = (resources, available) => {
    if (!available || resources === undefined || resources.items.length === 0) {
      return emptyCard(COPY["panel.resources"], COPY["resources.unavailable"]);
    }
    return table(
      COPY["panel.resources"],
      COPY["resources.note"],
      [
        COPY["table.source"],
        COPY["table.scope"],
        COPY["table.origin"],
        COPY["table.commands"],
        COPY["table.skills"],
        COPY["table.prompts"],
        COPY["table.sourceTools"],
      ],
      resources.items.map((row) => ({
        cells: [
          entityLink("source", row.sourceLabel, row.sourceLabel),
          row.scope,
          row.origin,
          number(row.commands),
          number(row.skills),
          number(row.prompts),
          number(row.tools),
        ],
      })),
      ["status-cell", "status-cell", "status-cell", "num", "num", "num", "num"],
    );
  };

  /** The runs of one view, keyed by the id a run publishes. */
  const runsById = (runs) => {
    const byId = {};
    runs.forEach((run) => {
      byId[run.id] = run;
    });
    return byId;
  };

  // -------------------------------------------------------------------------
  // The Agents execution view
  // -------------------------------------------------------------------------

  /**
   * The session root is the tree's one grouping node that is not an agent run
   * and not a run container: it is where the execution hierarchy begins, and it
   * exists in this renderer alone.
   */
  const SESSION_ROOT_KEY = "session";
  /**
   * Past this many runs the tree opens shallow and discloses on demand. A
   * four-agent session is never aggressively collapsed; a hundred-run selection
   * renders its top level and nothing else until the reader asks.
   */
  const DEEP_FOREST = 50;
  /** The model filter's value for the runs that published no model at all. */
  const NO_MODEL_FILTER = "__none__";

  /**
   * The presentation in effect. The tree is the route grammar's own default, so
   * a route that names no view renders it; only an explicit table leaves it.
   */
  const agentsInTree = () =>
    state.view === undefined || state.view === route.defaultAgentView;

  /** The Agents panel's Tree | Table switch: a real route, never a setting. */
  const agentsViewControl = () => {
    const group = el("div", "segments");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", COPY["agents.view.label"]);
    route.agentViews.forEach((view) => {
      const button = el("button", "", COPY["agents.view." + view]);
      button.dataset.agentsView = view;
      button.setAttribute(
        "aria-pressed",
        String((view === route.defaultAgentView) === agentsInTree()),
      );
      group.append(button);
    });
    return group;
  };

  /**
   * The collapsed nodes of this view. Disclosure is this document's own state,
   * never a route and never a persisted setting, so a query string never grows a
   * node list and Back never replays a reader's expanding.
   */
  const collapsedNodes = () => {
    const collapsed = activeSettings().collapsed;
    return isNode(collapsed) ? collapsed : {};
  };

  const setCollapsed = (key, collapsed) => {
    const collapsedMap = assign(collapsedNodes(), {});
    if (collapsed) collapsedMap[key] = true;
    else delete collapsedMap[key];
    const key0 = settingsKey();
    const settings = viewSettings[key0] === undefined ? {} : viewSettings[key0];
    settings.collapsed = collapsedMap;
    viewSettings[key0] = settings;
  };

  /** One bounded select value of this view, or `""` for no filter. */
  const selectedOption = (name) => {
    const value = activeSettings()[name];
    return typeof value === "string" ? value : "";
  };

  /**
   * The status and model filters, as one predicate over the rows the DTO
   * published. They narrow which runs the view shows; they never rewrite a row,
   * and a filtered-out ancestor is kept by the projection as context instead of
   * being detached from the topology that gives a match its meaning.
   */
  const agentSelectionFilter = () => {
    const status = selectedOption("agentStatus");
    const model = selectedOption("agentModel");
    return (run) => {
      if (status !== "" && run.status !== status) return false;
      if (model === "") return true;
      if (model === NO_MODEL_FILTER) return run.model === null;
      return run.model === model;
    };
  };

  /** The search box's own predicate, over the fields a run row renders. */
  const agentQueryFilter = () => {
    const query = activeQuery().toLowerCase();
    if (query === "") return () => true;
    return (run) =>
      [run.agent, run.status, run.model, run.thinking]
        .filter((value) => typeof value === "string")
        .join(" ")
        .toLowerCase()
        .includes(query);
  };

  /** One toggle: a real button that names the node it discloses. */
  const treeToggle = (label, open, key) => {
    const button = el("button", "tree-toggle");
    button.dataset.treeToggle = key;
    button.setAttribute("aria-expanded", String(open));
    button.setAttribute(
      "aria-label",
      tr(open ? "agents.tree.collapse" : "agents.tree.expand", {
        label: label,
      }),
    );
    button.append(treeChevron());
    return button;
  };

  /**
   * A run row's toggle name: a role alone is not a unique accessible name when
   * two runs share it, so the run's own published status disambiguates the
   * control without printing an id.
   */
  const runToggle = (run, open) =>
    treeToggle(
      orUnavailable(run.agent) + " · " + COPY["agents." + run.status],
      open,
      run.id,
    );

  /**
   * The disclosure glyph: one inline SVG in the shipped icon style. It is
   * decorative (the button carries the name and the state), and it rotates
   * through a transform the stylesheet drops under reduced motion.
   */
  const treeChevron = () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M6 9l6 6 6-6");
    svg.append(path);
    return svg;
  };

  /** The spacer a leaf row keeps, so leaf and parent rows align. */
  const treeSpacer = () => {
    const spacer = el("span", "tree-toggle is-leaf");
    spacer.setAttribute("aria-hidden", "true");
    return spacer;
  };

  /**
   * What a collapsed or expanded node states about what it holds: the rows a
   * reader cannot see, and the failures those rows contain. The counts come from
   * the projection, so a summary never counts a row the tree is not holding.
   */
  const treeCounts = (node, open) => {
    const parts = [];
    if (open) {
      if (node.children.length > 0) {
        parts.push(
          tr("agents.tree.children", { count: node.children.length }),
        );
      }
    } else if (node.descendants > 0) {
      parts.push(
        tr("agents.tree.descendants", { count: node.descendants }),
      );
    }
    return parts.concat(treeStateCounts(node)).join(" · ");
  };

  /** What a set of runs contains that must never be hidden by a summary. */
  const treeStateCounts = (counts) => {
    const parts = [];
    if (counts.failed > 0) {
      parts.push(tr("agents.tree.failed", { count: counts.failed }));
    }
    if (counts.interrupted > 0) {
      parts.push(
        tr("agents.tree.interrupted", { count: counts.interrupted }),
      );
    }
    if (counts.withoutUsage > 0) {
      parts.push(
        tr("agents.tree.withoutUsage", { count: counts.withoutUsage }),
      );
    }
    return parts;
  };

  /**
   * The keys on the path from the session root to one run, so a route that names
   * a nested run opens exactly the branches holding it and nothing else.
   */
  const revealKeys = (entries, id) => {
    if (id === null) return {};
    const path = [];
    const walk = (nodes) => {
      for (const node of nodes) {
        const key = node.kind === "container" ? node.key : node.run.id;
        path.push(key);
        if (node.kind === "run" && node.run.id === id) return true;
        if (walk(node.children)) return true;
        path.pop();
      }
      return false;
    };
    if (!walk(entries)) return {};
    const reveal = { [SESSION_ROOT_KEY]: true };
    path.forEach((key) => {
      reveal[key] = true;
    });
    return reveal;
  };

  /** The run a route currently focuses, or null when it names no agent. */
  const focusedRunId = () =>
    state.entity !== undefined && state.entity.kind === "agent"
      ? state.entity.id
      : null;

  /** A run row's own figures, each one a field the DTO published. */
  const runMeta = (run) => {
    const parts = [orUnavailable(run.model)];
    if (run.thinking !== null) parts.push(run.thinking);
    parts.push(
      run.usage === null
        ? COPY["agents.tree.usageUnavailable"]
        : tr("agents.tree.tokens", { count: run.usage.totalTokens }) +
            " · " +
            money(run.usage.cost),
    );
    if (run.artifacts !== null) {
      parts.push(COPY["table.artifacts"] + ": " + run.artifacts);
    }
    return parts.join(" · ");
  };

  /**
   * The session root's summary: the session's own native figures for the
   * selected range, and how many models produced them. A range that resolves no
   * day has no figures at all, so nothing is rendered as a zero; a truncated
   * range qualifies its figures exactly as the Overview cards do, because a
   * partial total must never read as the whole one; and more than one model is
   * never reduced to one "primary" model.
   */
  const sessionSummary = (meta) => {
    const datable = meta.resolved !== null && Number(meta.totals.days) > 0;
    const models = meta.models;
    if (!datable) return COPY["evidence.unavailable"];
    // The retained window is not the whole range, so the two figures the range
    // cannot complete are named as known rather than stated flatly.
    const partial = meta.truncated === true;
    const parts = [];
    const single = meta.modelsTruncated !== true && models.length === 1;
    if (single) {
      parts.push(
        models[0].model +
          " · " +
          tr("agents.tree.generations", { count: models[0].generations }),
      );
    } else {
      parts.push(
        tr("agents.tree.generations", { count: meta.totals.generations }),
      );
      const listed = meta.modelsTruncated === true;
      parts.push(
        models.length === 0
          ? COPY["evidence.unavailable"]
          : tr(listed ? "agents.tree.modelsListed" : "agents.tree.modelsUsed", {
              count: models.length,
            }),
      );
    }
    const cost = money(meta.totals.cost);
    parts.push(
      // The label form carries its own grouped figure; the catalog form is
      // handed the number so its own format (and plural) rules apply.
      partial
        ? COPY["metric.knownTokens"] + ": " + number(meta.totals.totalTokens)
        : tr("agents.tree.tokens", { count: meta.totals.totalTokens }),
    );
    parts.push(partial ? COPY["metric.knownCost"] + ": " + cost : cost);
    return parts.join(" · ");
  };

  /**
   * The statement a session row owes when its model list is not the whole
   * picture: it is one figure the range cannot complete, so it is stated even
   * while the Models detail stays closed.
   */
  const sessionModelCaveat = (meta) =>
    meta.modelsTruncated === true ? COPY["models.truncated"] : "";

  /**
   * The Models detail of the session root: one row per model the range published
   * with that model's own generation count, and L2's truncation statement when
   * the model list is not the whole picture.
   */
  const sessionModels = (meta) => {
    const list = el("ul", "tree-models");
    list.setAttribute("role", "list");
    meta.models.forEach((model) => {
      list.append(
        el(
          "li",
          "tree-model",
          model.model +
            " · " +
            tr("agents.tree.generations", { count: model.generations }),
        ),
      );
    });
    if (meta.modelsTruncated === true) {
      list.append(el("li", "tree-model muted", COPY["models.truncated"]));
    }
    return list;
  };

  /** The one tree row of a materialized run. */
  const treeRunRow = (node, open, nested, rendered, context) => {
    const run = node.run;
    const row = el("div", "tree-row");
    const label = orUnavailable(run.agent);
    // While a filter holds the tree open, a row's disclosure control could not
    // act, so the row renders its leaf spacer instead of a dead button.
    row.append(
      node.children.length > 0 && context.filtering !== true
        ? runToggle(run, open)
        : treeSpacer(),
    );
    const main = el("div", "tree-main");
    const title = el("div", "tree-title");
    title.append(entitySpan("agent", run.id, label));
    title.append(
      badgeCell(
        COPY["agents." + run.status],
        run.status === "failed" || run.status === "interrupted"
          ? "warn"
          : "neutral",
      ),
    );
    // A row kept only because a descendant matched says so, so a reader never
    // reads a context row as a result.
    if (node.state === "context") {
      title.append(badgeCell(COPY["agents.tree.context"], "neutral"));
    }
    const counts = treeCounts(node, open);
    if (counts !== "") title.append(el("span", "tree-count", counts));
    main.append(title);
    main.append(el("div", "tree-meta mono", runMeta(run)));
    // A row the tree does not nest still states the parent verdict L2 published
    // for it: this renderer never re-decides one.
    if (!nested) {
      main.append(
        appendCell(el("div", "tree-parent"), parentCell(run, rendered)),
      );
    }
    row.append(main);
    return row;
  };

  /** The one tree row of a run container: a group, and worded as one. */
  const treeContainerRow = (node, open, context) => {
    const row = el("div", "tree-row");
    // Every container carries the same name, so its child count is what tells
    // two of them apart for a reader who cannot see the list.
    row.append(
      context.filtering === true
        ? treeSpacer()
        : treeToggle(
            tr("agents.tree.containerOrdinal", { ordinal: node.ordinal }) +
              " · " +
              tr("agents.tree.children", { count: node.children.length }),
            open,
            node.key,
          ),
    );
    const main = el("div", "tree-main");
    const title = el("div", "tree-title");
    title.append(el("span", "tree-group", COPY["agents.tree.container"]));
    const counts = treeCounts(node, open);
    if (counts !== "") title.append(el("span", "tree-count", counts));
    main.append(title);
    main.append(el("div", "tree-meta", COPY["agents.tree.container.note"]));
    row.append(main);
    return row;
  };

  /** One tree item, and the nested list the node discloses when it is open. */
  const treeItem = (node, context) => {
    const key = node.kind === "container" ? node.key : node.run.id;
    const open = context.open(key, node.children.length > 0);
    const item = el(
      "li",
      "tree-node" + (node.kind === "container" ? " is-container" : ""),
    );
    const nested = node.kind === "container" ? false : context.nested;
    if (node.kind === "container") {
      item.append(treeContainerRow(node, open, context));
    } else {
      item.dataset.treeRow = node.run.id;
      item.append(treeRunRow(node, open, nested, context.rendered, context));
    }
    if (open && node.children.length > 0) {
      const children = el("ul", "tree-children");
      children.setAttribute("role", "list");
      node.children.forEach((child) =>
        children.append(treeItem(child, assign(context, { nested: true }))),
      );
      item.append(children);
    }
    return item;
  };

  /** The session root: a label and the session's own figures, never a run row. */
  const treeSessionItem = (meta, context) => {
    const open = context.open(SESSION_ROOT_KEY, context.hasRuns);
    const item = el("li", "tree-node is-session");
    const row = el("div", "tree-row");
    // A filter expands every level it matches, so a disclosure control would
    // state a state the reader cannot change: it is rendered only when it acts.
    row.append(
      context.hasRuns && context.filtering !== true
        ? treeToggle(COPY["agents.tree.session"], open, SESSION_ROOT_KEY)
        : treeSpacer(),
    );
    const main = el("div", "tree-main");
    const title = el("div", "tree-title");
    title.append(el("span", "tree-session", COPY["agents.tree.session"]));
    if (!open && context.counts.descendants > 0) {
      title.append(
        el(
          "span",
          "tree-count",
          [
            tr("agents.tree.descendants", {
              count: context.counts.descendants,
            }),
          ]
            .concat(treeStateCounts(context.counts))
            .join(" · "),
        ),
      );
    }
    main.append(title);
    main.append(el("div", "tree-meta mono", sessionSummary(meta)));
    // The root's own scope, so the figures above it can never be read as the
    // model table's generation slice with the child card added on top.
    main.append(el("div", "tree-count", COPY["agents.tree.scope"]));
    const caveat = sessionModelCaveat(meta);
    if (caveat !== "") main.append(el("div", "tree-count", caveat));
    if (meta.models.length > 0) {
      const modelsOpen = activeSettings().agentModels === true;
      const detail = el("button", "tree-detail", COPY["agents.tree.models"]);
      detail.dataset.treeModels = "toggle";
      detail.setAttribute("aria-expanded", String(modelsOpen));
      main.append(detail);
      if (modelsOpen) main.append(sessionModels(meta));
    }
    row.append(main);
    item.append(row);
    if (open && context.children !== undefined) {
      const children = el("ul", "tree-children");
      children.setAttribute("role", "list");
      context.children.forEach((child) => children.append(treeItem(child, context)));
      item.append(children);
    }
    return item;
  };

  /**
   * The execution tree of the selected runs: the session root, then the runs the
   * DTO published, nested by the parent verdicts L2 decided. Filtering keeps the
   * ancestors a match needs and states what is a result and what is context.
   */
  const agentsTreeSection = (target) => {
    const meta = target.range;
    const runs = meta.agents;
    const query = activeQuery();
    const filtering =
      query !== "" ||
      selectedOption("agentStatus") !== "" ||
      selectedOption("agentModel") !== "";
    const select = agentSelectionFilter();
    const search = agentQueryFilter();
    const view = executions.filter(executions.build(runs), (run) =>
      select(run) && search(run),
    );
    const reveal = revealKeys(view.entries, focusedRunId());
    const collapsed = collapsedNodes();
    const deep = runs.length > DEEP_FOREST;
    const open = (key, hasChildren) => {
      if (!hasChildren) return false;
      // A filter must not hide its own match behind a collapsed branch.
      if (filtering) return true;
      if (reveal[key] === true) return true;
      if (collapsed[key] !== undefined) return collapsed[key] !== true;
      return !deep;
    };
    const section = card(
      COPY["tab.agents"],
      COPY["agents.note"],
      agentsViewControl(),
    );
    const toolbar = el("div", "toolbar");
    const searchLabel = el("label", "", COPY["search"]);
    const searchInput = document.createElement("input");
    searchInput.id = "search";
    searchInput.type = "search";
    searchInput.value = query;
    searchInput.placeholder = COPY["agents.tree.searchPlaceholder"];
    searchLabel.append(searchInput);
    const statusLabel = el("label", "", COPY["table.status"]);
    const statusSelect = document.createElement("select");
    statusSelect.id = "agent-status";
    const statuses = ["succeeded", "failed", "interrupted", "running", "unknown"];
    const anyStatus = el("option", "", COPY["agents.tree.filterAll"]);
    anyStatus.value = "";
    anyStatus.selected = selectedOption("agentStatus") === "";
    statusSelect.append(anyStatus);
    statuses.forEach((status) => {
      const option = el("option", "", COPY["agents." + status]);
      option.value = status;
      option.selected = selectedOption("agentStatus") === status;
      statusSelect.append(option);
    });
    statusLabel.append(statusSelect);
    const modelLabel = el("label", "", COPY["table.model"]);
    const modelSelect = document.createElement("select");
    modelSelect.id = "agent-model";
    const anyModel = el("option", "", COPY["agents.tree.filterAll"]);
    anyModel.value = "";
    anyModel.selected = selectedOption("agentModel") === "";
    modelSelect.append(anyModel);
    const models = [];
    let withoutModel = false;
    runs.forEach((run) => {
      if (run.model === null) withoutModel = true;
      else if (models.indexOf(run.model) < 0) models.push(run.model);
    });
    models.sort().forEach((model) => {
      const option = el("option", "", model);
      option.value = model;
      option.selected = selectedOption("agentModel") === model;
      modelSelect.append(option);
    });
    if (withoutModel) {
      const option = el("option", "", COPY["evidence.unavailable"]);
      option.value = NO_MODEL_FILTER;
      option.selected = selectedOption("agentModel") === NO_MODEL_FILTER;
      modelSelect.append(option);
    }
    modelLabel.append(modelSelect);
    toolbar.append(statusLabel, modelLabel, searchLabel);
    section.append(toolbar);
    if (filtering) {
      section.append(
        el(
          "p",
          "tree-summary",
          tr("agents.tree.filtered", {
            matched: number(view.matched),
            total: number(view.total),
            context: number(view.context),
          }),
        ),
      );
    }
    const tree = el("ul", "tree");
    tree.setAttribute("role", "list");
    tree.append(
      treeSessionItem(meta, {
        open: open,
        filtering: filtering,
        hasRuns: view.entries.length > 0,
        counts: view.counts,
        children: view.entries,
        rendered: runsById(runs),
        nested: false,
      }),
    );
    section.append(tree);
    if (view.entries.length === 0) {
      section.append(el("p", "tree-empty", COPY["agents.tree.empty"]));
    }
    return section;
  };

  const agentsNodes = (target) => {
    const meta = target.range;
    const report = target.report;
    // No runs to project is two different facts: a producer that publishes no
    // child-run evidence at all (a capability gap, so no run count is inferred)
    // and a selection whose range holds none of the runs the producer published.
    if (report !== undefined && report.agentEvidence !== "supported") {
      return [emptyCard(COPY["tab.agents"], COPY["agents.none"])];
    }
    if (meta === undefined || meta.childUsage.runsTotal === 0) {
      return [emptyCard(COPY["tab.agents"], COPY["bars.empty"])];
    }
    const child = meta.childUsage;
    const fraction = tr("agents.usageFraction", {
      withUsage: child.runsWithUsage,
      total: child.runsTotal,
    });
    const cards = [
      metric(
        COPY["agents.childRuns"],
        number(child.runsTotal),
        COPY["metric.child.note"],
      ),
    ];
    ["succeeded", "failed", "interrupted", "running", "unknown"].forEach(
      (status) => {
        if (child.byStatus[status] > 0) {
          cards.push(
            metric(
              COPY["agents." + status],
              number(child.byStatus[status]),
              COPY["metric.child.note"],
            ),
          );
        }
      },
    );
    cards.push(
      metric(
        COPY["agents.knownTokens"],
        child.totalTokens === null
          ? COPY["evidence.unavailable"]
          : number(child.totalTokens),
        fraction,
      ),
      metric(
        COPY["agents.knownCost"],
        child.cost === null ? COPY["evidence.unavailable"] : money(child.cost),
        fraction,
      ),
    );
    if (child.failedCost !== null) {
      cards.push(
        metric(
          COPY["agents.knownFailedCost"],
          money(child.failedCost),
          fraction,
        ),
      );
    }
    const rendered = runsById(meta.agents);
    if (agentsInTree()) {
      return [metrics(cards), agentsTreeSection(target)];
    }
    return [
      metrics(cards),
      table(
        COPY["tab.agents"],
        COPY["agents.note"],
        [
          COPY["table.role"],
          COPY["table.status"],
          COPY["table.model"],
          COPY["table.tokens"],
          COPY["table.cost"],
          COPY["table.artifacts"],
          COPY["table.parent"],
        ],
        meta.agents.map((run) => ({
          cells: [
            entitySpan("agent", run.id, orUnavailable(run.agent)),
            badgeCell(
              COPY["agents." + run.status],
              run.status === "failed" || run.status === "interrupted"
                ? "warn"
                : "neutral",
            ),
            orUnavailable(run.model),
            run.usage === null
              ? COPY["evidence.unavailable"]
              : number(run.usage.totalTokens),
            run.usage === null
              ? COPY["evidence.unavailable"]
              : money(run.usage.cost),
            orUnavailable(run.artifacts),
            parentCell(run, rendered),
          ],
        })),
        [
          "status-cell",
          "status-cell",
          "status-cell",
          "num",
          "num",
          "status-cell",
          "status-cell",
        ],
        undefined,
        agentsViewControl(),
      ),
    ];
  };

  /**
   * The row's parent cell: the wording is chosen for L2's published verdict, and
   * an in-range parent is a real entity link to the run that carries its id.
   */
  const parentCell = (run, rendered) => {
    if (run.parent === "none") return COPY["agents.parentNone"];
    if (run.parent === "outside-range")
      return COPY["agents.parentOutsideScope"];
    if (run.parent === "orchestration-run")
      return COPY["agents.parentOrchestrationRun"];
    if (run.parent === "unknown") return COPY["agents.parentUnknown"];
    const parent = rendered[run.parentId];
    return entityLink(
      "agent",
      run.parentId,
      orUnavailable(parent === undefined ? null : parent.agent),
    );
  };

  const integrationsNodes = (target) => {
    const report = target.report;
    const rows = report === undefined ? [] : report.integrations;
    if (rows.length === 0) {
      return [
        emptyCard(COPY["panel.integrations"], COPY["unavailable.integrations"]),
      ];
    }
    return [
      table(
        COPY["panel.integrations"],
        COPY["integrations.note"],
        [
          COPY["table.integration"],
          COPY["integration.detected"],
          COPY["integration.telemetry"],
          COPY["integration.activity"],
          COPY["integration.version"],
        ],
        rows.map((row) => ({
          // The view's own predicate: observed telemetry, not detection.
          reportable: row.state !== "unavailable",
          cells: [
            entityLink("integration", row.integration, row.integration),
            badgeCell(
              COPY["presence." + row.presence],
              row.presence === "absent" ? "warn" : "neutral",
            ),
            integrationTelemetry(row),
            row.counters.length === 0
              ? COPY["evidence.unavailable"]
              : COPY["integration.sessionTotal"] +
                " · " +
                row.counters.join(" · "),
            row.version === null
              ? COPY["evidence.unavailable"]
              : String(row.version),
          ],
        })),
        ["status-cell", "status-cell", "wrap", "wrap", "status-cell"],
        {
          name: "withEvidence",
          labelKey: "filter.withEvidence",
          countKey: "filter.countUnavailable",
        },
      ),
    ];
  };

  /** This row's published telemetry state, plus its bounded reason. */
  const integrationTelemetry = (row) => {
    const span = el("span");
    span.append(badge(COPY["evidence." + row.state], "neutral"));
    if (row.state === "unsupported") {
      span.append(el("small", "", COPY["integration.reasonUnsupported"]));
    }
    if (row.state === "unavailable") {
      span.append(el("small", "", COPY["integration.reasonMissing"]));
    }
    if (row.presence === "absent") {
      span.append(el("small", "", COPY["integration.noteNotDetected"]));
    }
    return span;
  };

  /**
   * The joined tool is the tool entity the payload publishes by name, so its
   * cell is the one entity-link path: a real route when the id is published,
   * the same bounded text when it is not.
   */
  const relatedToolCell = (row) => {
    if (row.toolName === null) return COPY["evidence.unavailable"];
    const label =
      row.toolSource === null
        ? row.toolName
        : row.toolName + " · " + row.toolSource;
    return entityLink("tool", row.toolName, label);
  };

  /**
   * Every child run the publishing result observed, one entity link per run in
   * run order and none of them named as a cause: a run whose role the payload
   * does not carry is labelled with the catalog's Unavailable wording, never
   * the raw run id.
   */
  const relatedChildrenCell = (ids, runs) => {
    if (ids.length === 0) return COPY["evidence.unavailable"];
    const list = el("span", "mono");
    ids.forEach((id, index) => {
      if (index > 0) list.append(el("span", "", " · "));
      const run = runs[id];
      list.append(
        entityLink(
          "agent",
          id,
          run && run.agent ? run.agent : COPY["evidence.unavailable"],
          "mono",
        ),
      );
    });
    return list;
  };

  const errorsNodes = (target) => {
    const meta = target.range;
    const rows = meta === undefined ? [] : meta.errors;
    if (rows.length === 0) {
      return [emptyCard(COPY["tab.errors"], COPY["errors.none"])];
    }
    const runs = runsById(meta.agents);
    return [
      table(
        COPY["tab.errors"],
        COPY["errors.note"],
        [
          COPY["table.error"],
          COPY["table.kind"],
          COPY["table.timestamp"],
          COPY["errors.relatedTool"],
          COPY["table.status"],
          COPY["errors.relatedChildren"],
          COPY["table.message"],
        ],
        rows.map((row) => ({
          cells: [
            {
              fullId: text(row.id),
              content: entitySpan("error", row.id, row.id),
            },
            row.kind,
            row.timestamp,
            relatedToolCell(row),
            row.toolStatus === null
              ? COPY["evidence.unavailable"]
              : badgeCell(
                  COPY["tools." + row.toolStatus],
                  row.toolStatus === "succeeded" ? "" : "warn",
                ),
            relatedChildrenCell(row.relatedChildIds, runs),
            row.message === undefined
              ? COPY["errors.messageUnavailable"]
              : row.message,
          ],
        })),
        [
          "id-cell",
          "status-cell",
          "status-cell",
          "status-cell",
          "status-cell",
          "wrap",
          "wrap",
        ],
      ),
    ];
  };

  const ledgerNodes = (target) => {
    const meta = target.range;
    const rows = meta === undefined ? [] : meta.ledger;
    if (rows.length === 0) {
      return [emptyCard(COPY["tab.ledger"], COPY["empty.ledger"])];
    }
    return [
      table(
        COPY["tab.ledger"],
        COPY["ledger.materialized"],
        [
          COPY["table.timestamp"],
          COPY["table.id"],
          COPY["table.category"],
          COPY["table.action"],
          COPY["table.confidence"],
        ],
        rows.map((item) => ({
          cells: [
            item.timestamp,
            { fullId: text(item.id), content: el("span", "mono", item.id) },
            item.kind,
            item.status,
            badgeCell(COPY["evidence." + item.confidence], "neutral"),
          ],
        })),
        ["status-cell", "id-cell", "status-cell", "status-cell", "status-cell"],
      ),
    ];
  };

  // -------------------------------------------------------------------------
  // History and global aggregates
  // -------------------------------------------------------------------------

  const historyMetrics = () => {
    const meta = rangeMeta();
    const labels = snapshot.history.usageLabels;
    const unavailable = labels.usageUnavailable === true;
    const partial = meta !== null && meta.truncated === true;
    const datable = meta !== null && meta.resolved !== null;
    const costKey =
      partial && labels.cost === "metric.cost"
        ? "metric.knownCost"
        : labels.cost;
    const tokensKey =
      partial && labels.tokens === "metric.tokens"
        ? "metric.knownTokens"
        : labels.tokens;
    const costValue = unavailable
      ? COPY[labels.cost]
      : datable
        ? money(meta.totals.cost)
        : COPY["evidence.unavailable"];
    const tokensValue = unavailable
      ? COPY[labels.tokens]
      : datable
        ? number(meta.totals.totalTokens)
        : COPY["evidence.unavailable"];
    return metrics([
      metric(COPY[costKey], costValue, COPY["metric.native"], [
        [COPY["table.date"], rangeText()],
      ]),
      metric(COPY[tokensKey], tokensValue, COPY["metric.tokens.note"], [
        [COPY["table.date"], rangeText()],
      ]),
      metric(
        COPY["metric.generations"],
        datable
          ? number(meta.totals.generations)
          : COPY["evidence.unavailable"],
        COPY["metric.generations.note"],
        [[COPY["table.date"], rangeText()]],
      ),
      metric(
        COPY["metric.days"],
        datable ? number(meta.totals.days) : COPY["evidence.unavailable"],
        COPY["metric.days.note"],
        [[COPY["range.label"], rangeText()]],
      ),
    ]);
  };

  /** The coverage card: L2's own session line, plus its bounded reasons. */
  const coverageSection = (coverage, labels) => {
    const line =
      coverage === null || coverage === undefined
        ? COPY[labels.sessions]
        : coverage.line;
    const section = card(COPY["coverage.title"], line);
    if (
      coverage !== null &&
      coverage !== undefined &&
      coverage.reasons !== ""
    ) {
      section.append(
        el(
          "div",
          "footnote",
          tr("coverage.reasons", { reasons: coverage.reasons }),
        ),
      );
    }
    return section;
  };

  const sessionCell = (entry) => {
    const cell = el("div", "id-value");
    cell.append(el("span", "mono", entry.sessionId));
    cell.append(
      el(
        "small",
        "wrap",
        entry.firstDate === null
          ? COPY["evidence.unavailable"]
          : entry.firstDate +
              (entry.lastDate !== null && entry.lastDate !== entry.firstDate
                ? " → " + entry.lastDate
                : ""),
      ),
    );
    return cell;
  };

  const openLink = (sessionId) => {
    const link = el("a", "", COPY["table.open"]);
    link.dataset.session = sessionId;
    link.setAttribute("aria-label", COPY["table.open"] + " " + sessionId);
    link.setAttribute(
      "href",
      route.serialize(
        routeFor({ section: "history", tab: "overview", session: sessionId }),
      ),
    );
    return link;
  };

  const historyTable = () => {
    const entries = sessionEntries();
    const section = table(
      COPY["panel.history"],
      COPY["history.note"],
      [
        COPY["table.session"],
        COPY["table.duration"],
        COPY["table.tokens"],
        COPY["table.generations"],
        COPY["table.agents"],
        COPY["table.status"],
        COPY["table.cost"],
        COPY["table.inspect"],
      ],
      entries.map((entry) => ({
        membership: entry.membership,
        // The view's own predicate: a session this Inspector replayed.
        reportable: entry.availability === "available",
        cells: [
          { fullId: text(entry.sessionId), content: sessionCell(entry) },
          orUnavailable(entry.durationLabel),
          entry.published === true
            ? numberOrUnavailable(entry.totalTokens)
            : COPY["evidence.unavailable"],
          numberOrUnavailable(entry.generationCount),
          numberOrUnavailable(entry.agentCount),
          entry.status === null
            ? COPY["evidence.unavailable"]
            : badgeCell(COPY[entry.status.key], entry.status.tone),
          entry.published === true && entry.cost !== null
            ? money(entry.cost)
            : COPY["evidence.unavailable"],
          entry.view === undefined ? "" : openLink(entry.sessionId),
        ],
      })),
      [
        "id-cell",
        "status-cell",
        "num",
        "num",
        "num",
        "status-cell",
        "num",
        "status-cell",
      ],
      {
        name: "availableOnly",
        labelKey: "filter.availableOnly",
        countKey: "filter.countUnavailable",
      },
    );
    section.append(
      el(
        "div",
        "footnote",
        COPY["table.duration"] +
          ", " +
          COPY["table.generations"] +
          ", " +
          COPY["table.agents"] +
          " · " +
          COPY["panel.allDates"],
      ),
    );
    const wrap = section.querySelector(".table-wrap");
    const node = section.querySelector("table");
    if (wrap !== null) wrap.className = "table-wrap history-table-wrap";
    if (node !== null) node.className = "history-table";
    return section;
  };

  const historyNodes = () => {
    const meta = rangeMeta();
    const resolved = meta !== null && meta.resolved !== null;
    const empty = resolved && Number(meta.totals.days) === 0;
    const nodes = [
      empty
        ? emptyCard(COPY["usage.title"], COPY["chart.empty"])
        : historyMetrics(),
      coverageSection(snapshot.history.coverage, snapshot.history.usageLabels),
    ];
    if (!empty) {
      nodes.push(chartSection(meta === null ? [] : meta.daily, CHART_METRICS));
    }
    nodes.push(historyTable(), evidenceSection(snapshot.history.evidence));
    return nodes;
  };

  const globalNodes = () => {
    const global = snapshot.global;
    const meta = rangeMeta();
    const labels = global.usageLabels;
    const unavailable = labels.usageUnavailable === true;
    const datable = meta !== null && meta.resolved !== null;
    const cards = [
      metric(
        COPY[labels.cost],
        unavailable
          ? COPY[labels.cost]
          : datable
            ? money(global.totals.cost)
            : COPY["evidence.unavailable"],
        COPY["metric.native"],
        [[COPY["table.date"], rangeText()]],
      ),
      metric(
        COPY[labels.tokens],
        unavailable
          ? COPY[labels.tokens]
          : datable
            ? number(global.totals.totalTokens)
            : COPY["evidence.unavailable"],
        COPY["metric.tokens.note"],
        [[COPY["table.date"], rangeText()]],
      ),
      metric(
        COPY["metric.days"],
        datable ? number(global.totals.days) : COPY["evidence.unavailable"],
        COPY["metric.days.note"],
        [[COPY["range.label"], rangeText()]],
      ),
      metric(
        COPY["metric.sessions"],
        number(global.trackedSessions),
        // L2's own session line, or the label key the same projection published.
        global.coverage === null ? COPY[labels.sessions] : global.coverage.line,
      ),
    ];
    const inventory = card(COPY["tab.environment"], COPY["env.note"]);
    inventory.append(
      metrics([
        metric(
          COPY["env.commands"],
          inventoryValue(global.inventory.commands),
          COPY["env.note"],
        ),
        metric(
          COPY["env.skills"],
          inventoryValue(global.inventory.skills),
          COPY["env.note"],
        ),
        metric(
          COPY["env.resources"],
          inventoryValue(global.inventory.resources),
          COPY["env.note"],
        ),
      ]),
    );
    return [
      metrics(cards),
      coverageSection(global.coverage, labels),
      chartSection(meta === null ? [] : meta.daily, GLOBAL_CHART_METRICS),
      compositionSection(global.composition),
      inventory,
      evidenceSection(global.evidence),
    ];
  };

  const inventoryValue = (value) =>
    value === null || value === undefined
      ? COPY["evidence.unavailable"]
      : tr("env.available", { count: number(value) });

  // -------------------------------------------------------------------------
  // View assembly
  // -------------------------------------------------------------------------

  const sectionUnavailable = (target, key) => {
    const diagnostic =
      target !== null && target.diagnostic !== undefined
        ? " · " + target.diagnostic
        : "";
    return emptyCard(COPY["unavailable.title"], COPY[key] + diagnostic);
  };

  const viewNodes = () => {
    if (snapshot === null) return [];
    if (state.section === "history" && selectedSession() !== null) {
      const target = targetView();
      if (target === null || target.availability !== "available") {
        return [sectionUnavailable(target, "unavailable.session")];
      }
      return sessionNodes(target);
    }
    if (state.section === "history") return historyNodes();
    if (state.section === "global") return globalNodes();
    const target = targetView();
    if (target === null || target.availability !== "available") {
      return [sectionUnavailable(target, "unavailable.current")];
    }
    return sessionNodes(target);
  };

  const sessionNodes = (target) => {
    if (target.report === undefined) {
      return [sectionUnavailable(target, "unavailable.current")];
    }
    if (view.activeTab === "llm") return llmNodes(target);
    if (view.activeTab === "tools") return toolsNodes(target);
    if (view.activeTab === "skills") return skillsNodes(target);
    if (view.activeTab === "environment") return environmentNodes(target);
    if (view.activeTab === "integrations") return integrationsNodes(target);
    if (view.activeTab === "errors") return errorsNodes(target);
    if (view.activeTab === "ledger") return ledgerNodes(target);
    return overviewNodes(target);
  };

  // -------------------------------------------------------------------------
  // Chrome
  // -------------------------------------------------------------------------

  const rangeResolved = () => {
    const meta = rangeMeta();
    return meta === null ? null : meta.resolved;
  };
  const rangeText = () => {
    const resolved = rangeResolved();
    return resolved === null
      ? COPY["evidence.unavailable"]
      : resolved.from + " → " + resolved.to;
  };

  /** Puts the DTO's own initial theme in effect, once, on the first payload. */
  const syncTheme = () => {
    const body = document.body;
    const dark = snapshot !== null && snapshot.theme === "dark";
    if (dark) body.classList.add("theme-dark");
    else body.classList.remove("theme-dark");
    const button = q("theme");
    if (button === null) return;
    button.textContent = dark ? COPY["theme.light"] : COPY["theme.dark"];
    button.setAttribute("aria-pressed", String(dark));
  };

  const syncNavigation = () => {
    const nav = q("navigation");
    if (nav === null) return;
    if (nav.children.length === 0) {
      route.sections.forEach((section) => {
        const link = el("a", "", COPY["nav." + section]);
        link.dataset.section = section;
        nav.append(link);
      });
    }
    nav.querySelectorAll("a").forEach((link) => {
      const section = link.dataset.section;
      link.setAttribute(
        "href",
        route.serialize(
          routeFor({ section: section, tab: "overview", session: null }),
        ),
      );
      if (section === view.activeSection)
        link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  };

  const tabLink = (tab, active) => {
    const link = el("a", "", COPY["tab." + tab]);
    link.dataset.tab = tab;
    link.setAttribute("href", route.serialize(routeFor({ tab: tab })));
    if (active) link.setAttribute("aria-current", "page");
    return link;
  };

  const syncTabs = (effects) => {
    const tabs = q("tabs");
    if (tabs === null) return;
    const active = document.activeElement;
    const held =
      active !== null && active.dataset !== undefined
        ? active.dataset.tab
        : undefined;
    tabs.replaceChildren(
      ...view.visibleTabs.map((tab) => tabLink(tab, tab === view.activeTab)),
    );
    // The strip is rebuilt every render: a tab that held keyboard focus gets it
    // back, except on a section change, where the heading takes focus instead.
    if (held === undefined || effects.sectionChanged === true) return;
    const links = tabs.querySelectorAll("a");
    const link =
      Array.from(links).find((candidate) => candidate.dataset.tab === held) ||
      Array.from(links).find(
        (candidate) => candidate.dataset.tab === view.activeTab,
      );
    if (link !== undefined && typeof link.focus === "function") link.focus();
  };

  const syncScope = () => {
    const current = snapshot === null ? null : snapshot.current;
    const group = q("scope");
    const scopes = group === null ? [] : group.querySelectorAll("button");
    scopes.forEach((button) => {
      const target =
        current === null ? undefined : current[button.dataset.scope];
      const unavailable =
        view.activeSection !== "current" ||
        target === undefined ||
        target.availability !== "available";
      button.disabled = unavailable;
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.scope === state.scope),
      );
      if (target !== undefined && target.diagnostic !== undefined) {
        button.title = target.diagnostic;
      } else {
        button.removeAttribute("title");
      }
    });
    const fixed = q("scope-fixed");
    if (fixed !== null) fixed.hidden = view.activeSection === "current";
    const note = q("scope-sub");
    if (note !== null) {
      // The scope switch is inert when both views carry the same report data, so
      // the DTO's own equality statement is what says so, instead of the switch
      // appearing to do nothing.
      const same =
        snapshot !== null && snapshot.current.sameReportProjection === true;
      note.textContent =
        view.activeSection === "current"
          ? same
            ? COPY["scope.sameReport"]
            : COPY[
                state.scope === "active"
                  ? "scope.active.note"
                  : "scope.tree.note"
              ]
          : COPY["scope.fixed"];
    }
  };

  const syncRange = () => {
    const meta = rangeMeta();
    const resolved = meta === null ? null : meta.resolved;
    const name = q("range-name");
    if (name !== null) {
      name.textContent =
        resolved === null
          ? COPY["evidence.unavailable"]
          : resolved.preset === null
            ? COPY["range.custom"]
            : tr("range.last", { days: resolved.preset });
    }
    const dates = q("range-dates");
    if (dates !== null) dates.textContent = rangeText();
    const section = q("range");
    const buttons = section === null ? [] : section.querySelectorAll("button");
    buttons.forEach((button) => {
      if (button.dataset.days === undefined) return;
      button.setAttribute(
        "aria-pressed",
        String(
          resolved !== null && resolved.preset === Number(button.dataset.days),
        ),
      );
    });
    const custom = q("custom-range");
    if (custom !== null) {
      custom.setAttribute(
        "aria-pressed",
        String(resolved !== null && resolved.preset === null),
      );
    }
    const notice = q("range-notice");
    if (notice === null) return;
    // Two published facts decide this line: an intent nothing resolved, and a
    // range the DTO itself calls partial. Neither is recomputed here.
    let copy = "";
    if (meta !== null && meta.requested !== null && meta.resolved === null) {
      copy = COPY["range.restored"];
    } else if (meta !== null && meta.truncated === true) {
      copy =
        state.section === "history" && selectedSession() === null
          ? COPY["history.dailyTruncated"]
          : COPY["range.truncated"];
    }
    notice.textContent = copy;
    notice.hidden = copy === "";
  };

  const syncNotice = () => {
    const notice = q("route-notice");
    if (notice === null) return;
    const copy =
      stateNotice === "range-restored"
        ? COPY["range.restored"]
        : stateNotice === undefined
          ? ""
          : COPY["nav.unavailable"];
    notice.textContent = copy;
    notice.hidden = copy === "";
  };

  const syncHeadings = () => {
    const section = view.activeSection;
    const kicker = q("kicker");
    if (kicker !== null) kicker.textContent = COPY["kicker." + section];
    const title = q("title");
    if (title !== null) title.textContent = COPY["heading." + section];
    const subtitle = q("subtitle");
    if (subtitle !== null) subtitle.textContent = COPY["subtitle." + section];
    const breadcrumb = q("breadcrumb");
    const entry = selectedSession();
    if (breadcrumb !== null) {
      breadcrumb.textContent =
        entry === null ? COPY["nav." + section] : entry.sessionId;
    }
    const label = q("session-label");
    if (label !== null) {
      if (section === "current") {
        const target = targetView();
        label.textContent =
          target === null || target.report === undefined
            ? COPY["evidence.unavailable"]
            : target.report.sessionId;
      } else if (entry !== null) {
        label.textContent = entry.sessionId;
      } else if (section === "global") {
        label.textContent =
          snapshot === null
            ? COPY["evidence.unavailable"]
            : number(snapshot.global.trackedSessions);
      } else {
        label.textContent =
          snapshot.history.coverage === null
            ? COPY["coverage.title"]
            : snapshot.history.coverage.line;
      }
    }
    const scopeNote = q("scope-note");
    if (scopeNote !== null) {
      scopeNote.textContent =
        section === "current"
          ? COPY[state.scope === "active" ? "scope.active" : "scope.tree"] +
            " · " +
            COPY[
              state.scope === "active" ? "scope.active.note" : "scope.tree.note"
            ]
          : COPY["scope.tree.note"];
    }
    const expired = q("wal-detail");
    const target = targetView();
    if (expired !== null) {
      expired.hidden = !(
        section === "current" &&
        target !== null &&
        target.walDetail === "expired"
      );
    }
  };

  /** The one post-render focus effect: the route's entity, highlighted in place. */
  const focusEntity = () => {
    if (state.entity === undefined) return false;
    const output = q("view");
    if (output === null) return false;
    const key = state.entity.kind + ":" + state.entity.id;
    const found = Array.from(output.querySelectorAll(".entity")).find(
      (candidate) => candidate.dataset.entity === key,
    );
    if (found === undefined) return false;
    found.classList.add("entity-focus");
    if (typeof found.focus === "function") found.focus();
    return true;
  };

  const rememberView = () => {
    const key = settingsKey();
    const settings = viewSettings[key] === undefined ? {} : viewSettings[key];
    if (state.table !== undefined) settings.table = state.table;
    else delete settings.table;
    if (state.range !== undefined) rangeIntents[viewIdentity()] = state.range;
    viewSettings[key] = settings;
  };

  const render = (effects) => {
    if (snapshot === null) return;
    const flags = effects === undefined ? {} : effects;
    // The view subtree is replaced on every render, so the search box a
    // keystroke came from loses its focus and caret with it: hold both across
    // the swap and give them back to the search box that had them.
    const active = document.activeElement;
    const held = active !== null && active.id === "search";
    const caret =
      held && typeof active.selectionStart === "number"
        ? active.selectionStart
        : null;
    rememberView();
    syncNavigation();
    syncTabs(flags);
    syncScope();
    syncRange();
    syncNotice();
    syncHeadings();
    // The chart is drawn on a canvas inside the subtree about to be replaced.
    destroyChart();
    const output = q("view");
    if (output !== null) output.replaceChildren(...viewNodes());
    mountChart();
    const focused = flags.structural === true ? focusEntity() : false;
    if (
      !focused &&
      flags.sectionChanged === true &&
      view.focusTarget === "section-heading"
    ) {
      const heading = q("title");
      if (heading !== null && typeof heading.focus === "function")
        heading.focus();
    }
    if (held) {
      const search = q("search");
      if (search !== null && typeof search.focus === "function") {
        search.focus();
        if (caret !== null && typeof search.setSelectionRange === "function") {
          search.setSelectionRange(caret, caret);
        }
      }
    }
    const announcement = q("announcement");
    if (announcement !== null) {
      announcement.textContent =
        COPY["nav." + view.activeSection] +
        ", " +
        COPY["tab." + view.activeTab] +
        ", " +
        rangeText() +
        (focused ? " · " + COPY["nav.entityFocus"] : "");
    }
  };

  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------

  /**
   * One navigation: the applied route is serialized into the address bar and
   * applied. A discrete change is a new entry, so Back restores the state it came
   * from; only in-progress search typing replaces the current entry, so a search
   * box never fills the history stack.
   */
  const navigate = (candidate, push) => {
    const applied = coerced(candidate);
    const key = route.key(applied);
    if (key === lastAppliedKey) return;
    if (push === false) writeHash(key, true);
    else location.hash = key;
    apply();
  };

  /**
   * One request for one range intent, followed by the apply that renders it. The
   * view being left stays on screen while the request is in flight, so a range
   * change never blanks the page it came from.
   */
  const request = (query, effects) => {
    const id = (latestRequest += 1);
    setLoading(true);
    inFlight = (async () => {
      const served = await load(query, id);
      // A newer request owns the page now: it renders and it clears the loading
      // state, so this one leaves both alone.
      if (id !== latestRequest) return;
      setLoading(false);
      if (!served) {
        setFailure(true);
        return;
      }
      apply(effects, true);
    })();
  };

  /** The one place a hash becomes the applied route. */
  const apply = (effects, force) => {
    // Nothing can be coerced or rendered before a DTO exists: the address bar is
    // the only source of the range intent the first request may carry, and the
    // route is applied once there is a payload to bound it against.
    if (snapshot === null) {
      request(requestQuery(location.hash || ""), effects);
      return;
    }
    const previous = state;
    const parsed = route.parse(location.hash || "", {
      scope: initialScope(),
      capabilities: parseCapabilities(),
      knownIds: knownIds(),
    });
    const next = assign({}, parsed.route);
    // One Environment subview shows one entity kind, so a route naming the other
    // kind is canonicalized here by dropping the entity: the focus can then
    // never pin a panel it does not belong to, whatever wrote the route.
    if (next.tab === "environment" && next.entity !== undefined) {
      const named = panelFor(next.entity.kind);
      const panel =
        next.panel !== undefined && next.panel !== null
          ? next.panel
          : (named ?? route.defaultEnvPanel);
      if (named !== null && named !== panel) delete next.entity;
    }
    if (
      next.range === undefined &&
      viewIdentity(next) !== viewIdentity(previous) &&
      rangeIntents[viewIdentity(next)] !== undefined
    ) {
      next.range = rangeIntents[viewIdentity(next)];
    }
    const key = settingsKey(next);
    if (key !== settingsKey(previous)) {
      const remembered = viewSettings[key];
      if (
        remembered !== undefined &&
        next.table === undefined &&
        remembered.table !== undefined
      ) {
        next.table = remembered.table;
      }
    }
    const derived = route.derive(next, capabilitiesFor(next));
    const applied = assign(next, {
      section: derived.activeSection,
      tab: derived.activeTab,
    });
    const appliedKey = route.key(applied);
    if (location.hash !== appliedKey) writeHash(appliedKey, true);
    const flags = {
      structural:
        previous.section !== applied.section ||
        previous.tab !== applied.tab ||
        previous.session !== applied.session ||
        // A presentation switch re-renders the same entity, so the focus effect
        // has to run again to put the reader's row back in view.
        previous.view !== applied.view ||
        !sameEntity(previous.entity, applied.entity),
      sectionChanged: previous.section !== applied.section,
    };
    // A load that was requested by an earlier apply renders with THAT
    // navigation's effects, so its focus behaviour is not lost to the wait.
    const pending = effects === undefined ? flags : effects;
    const query = requestQuery(location.hash || "");
    const stale = query !== loadedQuery;
    if (!stale && appliedKey === lastAppliedKey) {
      if (force === true) render(pending);
      return;
    }
    lastAppliedKey = appliedKey;
    stateNotice = derived.notice !== undefined ? derived.notice : parsed.notice;
    state = applied;
    view = derived;
    if (stale) {
      request(query, pending);
      return;
    }
    render(pending);
  };

  const retry = () => {
    loadedQuery = null;
    apply({});
  };

  const onLocationChange = () => {
    apply();
  };

  // -------------------------------------------------------------------------
  // Wiring
  // -------------------------------------------------------------------------

  /** The table state after one patch, with an emptied field removed entirely. */
  const withTable = (patch) => {
    const next = {};
    const current = routeTable();
    if (typeof current.query === "string" && current.query !== "") {
      next.query = current.query;
    }
    if (typeof current.sort === "string" && current.sort !== "") {
      next.sort = current.sort;
    }
    Object.keys(patch).forEach((key) => {
      if (patch[key] === null || patch[key] === "") delete next[key];
      else next[key] = patch[key];
    });
    return routeFor({ table: Object.keys(next).length === 0 ? null : next });
  };

  const copyId = (button) => {
    const cell = button.closest("[data-full-id]");
    const value = cell === null ? "" : text(cell.dataset.fullId);
    if (value === "") return;
    if (
      typeof navigator === "undefined" ||
      navigator.clipboard === undefined ||
      typeof navigator.clipboard.writeText !== "function"
    ) {
      return;
    }
    navigator.clipboard.writeText(value).catch(() => {});
  };

  const setSetting = (name, value) => {
    const key = settingsKey();
    const settings = viewSettings[key] === undefined ? {} : viewSettings[key];
    settings[name] = value;
    viewSettings[key] = settings;
    render({});
  };

  const onDocumentClick = (event) => {
    const target = event.target;
    if (
      target === undefined ||
      target === null ||
      typeof target.closest !== "function"
    ) {
      return;
    }
    const link = target.closest("a");
    const control = link !== null ? link : target.closest("button");
    if (control === null) return;
    const data = control.dataset;
    // The view-local controls come first: a summary row's tool name carries both
    // its filter role and its entity identity, and the filter is what a click on
    // it means.
    if (data.toolFilter !== undefined) {
      toolFilters[viewIdentity()] = data.toolFilter;
      render({});
      return;
    }
    if (data.clearFilter !== undefined) {
      toolFilters[viewIdentity()] = null;
      render({});
      return;
    }
    if (data.copyId !== undefined) {
      copyId(control);
      return;
    }
    if (data.envTab !== undefined) {
      const current = state.entity === undefined ? null : panelFor(state.entity.kind);
      navigate(
        routeFor({
          panel: data.envTab,
          // A subview the focused entity does not belong to clears that focus;
          // the same one keeps it.
          entity:
            current !== null && current !== data.envTab ? null : undefined,
        }),
      );
      return;
    }
    if (data.filter !== undefined) {
      // A view's availability filter is this document's own state: it is never a
      // route, so it pushes nothing and writes no hash.
      setSetting(data.filter, activeSettings()[data.filter] === false);
      return;
    }
    if (data.metric !== undefined) {
      // The chart's metric selection is this view's own state too. A metric that
      // is not selected joins the selection in vocabulary order, so the series
      // order is the order the picker itself states.
      const name = data.metric;
      const chosen = selectedMetrics(chartVocabulary);
      const next =
        chosen.indexOf(name) >= 0
          ? chosen.filter((other) => other !== name)
          : chartVocabulary.filter(
              (other) => chosen.indexOf(other) >= 0 || other === name,
            );
      // The chart keeps at least one series: the last pressed metric stays on.
      if (next.length > 0) setSetting("metrics", next);
      return;
    }
    if (data.agentsView !== undefined) {
      navigate(
        routeFor({
          view: data.agentsView === route.defaultAgentView ? null : data.agentsView,
        }),
      );
      return;
    }
    if (data.treeToggle !== undefined) {
      // A disclosure is this view's own state: it selects a presentation, never
      // a route, so it pushes no history entry and writes no hash.
      setCollapsed(data.treeToggle, collapsedNodes()[data.treeToggle] !== true);
      render({});
      return;
    }
    if (data.treeModels !== undefined) {
      setSetting("agentModels", activeSettings().agentModels !== true);
      return;
    }
    if (data.retry !== undefined) {
      retry();
      return;
    }
    if (data.days !== undefined) {
      navigate(
        routeFor({ range: { kind: "preset", preset: Number(data.days) } }),
      );
      return;
    }
    if (data.scope !== undefined) {
      navigate(routeFor({ scope: data.scope }));
      return;
    }
    if (
      data.section === undefined &&
      data.tab === undefined &&
      data.session === undefined &&
      data.back === undefined &&
      data.entity === undefined
    ) {
      return;
    }
    // A route destination is the anchor's own navigation: the delegated handler
    // rebuilds exactly the destination its href names.
    if (typeof event.preventDefault === "function") event.preventDefault();
    if (data.back !== undefined) {
      navigate(
        routeFor({ section: "history", tab: "overview", session: null }),
      );
    } else if (data.session !== undefined) {
      navigate(
        routeFor({
          section: "history",
          tab: "overview",
          session: data.session,
        }),
      );
    } else if (data.section !== undefined) {
      navigate(
        routeFor({ section: data.section, tab: "overview", session: null }),
      );
    } else if (data.entity !== undefined) {
      const separator = data.entity.indexOf(":");
      const kind = data.entity.slice(0, separator);
      navigate(
        routeFor({
          tab: tabFor(kind),
          entity: { kind: kind, id: data.entity.slice(separator + 1) },
        }),
      );
    } else {
      navigate(routeFor({ tab: data.tab }));
    }
  };

  const onDocumentInput = (event) => {
    const target = event.target;
    if (target === undefined || target === null || target.id !== "search")
      return;
    navigate(withTable({ query: target.value }), false);
  };

  const onDocumentChange = (event) => {
    const target = event.target;
    if (target === undefined || target === null) return;
    if (target.id === "agent-status" || target.id === "agent-model") {
      setSetting(
        target.id === "agent-status" ? "agentStatus" : "agentModel",
        target.value,
      );
      return;
    }
    if (target.id === "sort") {
      navigate(
        withTable({ sort: target.value === "default" ? "" : target.value }),
      );
    }
  };

  const wire = () => {
    document.addEventListener("click", onDocumentClick);
    document.addEventListener("input", onDocumentInput);
    document.addEventListener("change", onDocumentChange);
    window.addEventListener("hashchange", onLocationChange);
    window.addEventListener("popstate", onLocationChange);
    const theme = q("theme");
    if (theme !== null) {
      theme.addEventListener("click", () => {
        const dark = document.body.classList.toggle("theme-dark");
        theme.textContent = dark ? COPY["theme.light"] : COPY["theme.dark"];
        theme.setAttribute("aria-pressed", String(dark));
        // The canvas cannot read the stylesheet's custom properties: recolor the
        // live chart from the palette of the theme now in effect.
        const chartModule = web.chart;
        if (
          activeChart !== null &&
          chartModule !== undefined &&
          typeof chartModule.applyChartTheme === "function"
        ) {
          try {
            chartModule.applyChartTheme(
              activeChart,
              chartModule.chartTheme(dark),
            );
          } catch (error) {
            // Observer-only: recoloring is presentation, never a state change.
          }
        }
      });
    }
    const refresh = q("refresh");
    if (refresh !== null) {
      const label = COPY["action.refresh"];
      refresh.setAttribute("aria-label", label);
      refresh.setAttribute("title", label);
      // Re-reads the running Inspector through the one request the route
      // already makes: the range stays whatever the address bar names, so a
      // refresh never moves the reader off the view they are looking at.
      refresh.addEventListener("click", () => {
        request(requestQuery(location.hash || ""), undefined);
      });
    }
    const custom = q("custom-range");
    if (custom !== null) {
      custom.addEventListener("click", () => {
        const resolved = rangeResolved();
        const from = q("date-from");
        const to = q("date-to");
        const error = q("date-error");
        const dialog = q("date-dialog");
        if (from !== null) from.value = resolved === null ? "" : resolved.from;
        if (to !== null) to.value = resolved === null ? "" : resolved.to;
        if (error !== null) error.hidden = true;
        if (dialog !== null && typeof dialog.showModal === "function") {
          dialog.showModal();
        }
      });
    }
    const cancel = q("date-cancel");
    if (cancel !== null) {
      cancel.addEventListener("click", () => {
        const dialog = q("date-dialog");
        if (dialog !== null && typeof dialog.close === "function")
          dialog.close();
      });
    }
    const form = q("date-form");
    if (form !== null) {
      form.addEventListener("submit", (event) => {
        if (typeof event.preventDefault === "function") event.preventDefault();
        const from = q("date-from");
        const to = q("date-to");
        const error = q("date-error");
        const parsed =
          from === null || to === null
            ? { ok: false }
            : range.parse("from=" + from.value + "&to=" + to.value);
        if (parsed.ok !== true) {
          if (error !== null) error.hidden = false;
          return;
        }
        const dialog = q("date-dialog");
        if (dialog !== null && typeof dialog.close === "function")
          dialog.close();
        navigate(routeFor({ range: parsed.intent }));
      });
    }
  };

  // -------------------------------------------------------------------------
  // The one entry point
  // -------------------------------------------------------------------------

  /**
   * Bootstrap, load, and apply. The capability fragment is consumed before the
   * address bar is parsed, so no route and no request can ever carry it. The
   * promise is shared because the browser starts the client on script load while
   * any later caller may await the same startup work.
   */
  const start = () => {
    if (startPromise !== null) return startPromise;
    startPromise = (async () => {
      token = consumeToken();
      wire();
      apply();
      if (inFlight !== null) await inFlight;
    })();
    return startPromise;
  };

  web.start = start;
  void start().catch(() => {});
})();

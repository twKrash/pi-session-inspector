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
  const agentTree = web.agentTree;
  if (agentTree === undefined || typeof agentTree.build !== "function") {
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
    link.setAttribute(
      "href",
      route.serialize(
        routeFor({ tab: tabFor(kind), entity: { kind: kind, id: id } }),
      ),
    );
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

  const card = (title, note) => {
    const section = el("section", "card");
    const head = el("div", "panel-head");
    const copy = el("div");
    copy.append(el("h2", "", title), el("p", "", note));
    head.append(copy);
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
        if (isNode(content) && content.tagName !== undefined) {
          cell.append(content);
        } else {
          cell.textContent = text(content);
        }
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
  const table = (title, note, headers, rows, classes, filter) => {
    const section = card(title, note);
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
        cell: (row) => number(row.sessions),
        cls: "num",
      },
      {
        header: COPY["table.tokens"],
        cell: (row) => number(row.totalTokens),
        cls: "num",
      },
      {
        header: COPY["table.cost"],
        cell: (row) => money(row.cost),
        cls: "num",
      },
    ];
    if (metrics.indexOf("generations") >= 0) {
      columns.push({
        header: COPY["table.generations"],
        cell: (row) => number(row.generations),
        cls: "num",
      });
    }
    if (metrics.indexOf("tools") >= 0) {
      columns.push({
        header: COPY["table.tools"],
        cell: (row) => number(row.tools),
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
  const CHART_METRICS = ["sessions", "cost", "tokens", "generations", "tools"];
  /**
   * The global aggregate's daily rows publish their date, session count and
   * usage — no generation or tool count — so its chart vocabulary is the subset
   * its own rows carry. No metric outside that vocabulary is offered, and a
   * value the selected row list does not publish is never charted as a zero.
   */
  const GLOBAL_CHART_METRICS = ["sessions", "cost", "tokens"];

  /**
   * One chart over the published daily rows, drawn by the bundled adapter. The
   * caller has already decided that every point is a published value and that a
   * row without the metric is Unavailable rather than a zero; the adapter is
   * handed labels and values in the DTO's own order and owns no range,
   * aggregation, or verdict. The exact-value table below stays the accessible
   * representation, and a browser that cannot give us a canvas keeps that table
   * and loses only the drawing.
   */
  const chartSection = (rows, metrics) => {
    const section = card(COPY["panel.daily"], rangeText());
    const select = document.createElement("select");
    select.id = "chart-metric";
    select.setAttribute("aria-label", COPY["chart.metric"]);
    const remembered = activeSettings().metric;
    const metricName =
      metrics.indexOf(remembered) >= 0 ? remembered : metrics[0];
    metrics.forEach((name) => {
      const option = el("option", "", chartLabel(name));
      option.value = name;
      option.selected = metricName === name;
      select.append(option);
    });
    section.querySelector(".panel-head").append(select);
    if (rows.length === 0) {
      section.append(el("div", "chart-note", COPY["chart.empty"]));
      return section;
    }
    // Every point is a published value: a row without this metric is a state the
    // chart states as Unavailable rather than a zero it never read.
    const values = rows.map((row) => chartValue(row, metricName));
    if (values.some((value) => Number.isFinite(value) === false)) {
      section.append(el("div", "chart-note", COPY["evidence.unavailable"]));
      return section;
    }
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
          ariaLabel: tr("chart.aria", {
            days: rows.length,
            metric: chartLabel(metricName),
          }),
          format: (kind, value) =>
            kind === "cost" ? money(value) : number(value),
          labels: rows.map((row) => row.date),
          series: [
            {
              axis: "y",
              format: chartFormat(metricName),
              key: metricName,
              label: chartLabel(metricName),
              values: values,
            },
          ],
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
      el(
        "div",
        "chart-note",
        tr("chart.note", { metric: chartLabel(metricName) }),
      ),
    );
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
   * The one LLM tab: the scope's model table, and below it the child-run
   * breakdown of the same scope. Both halves are the DTO's own rows; this is a
   * composition of two existing panels, never a joined or recomputed figure.
   */
  const llmNodes = (target) => [...modelsNodes(target), ...agentsNodes(target)];

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
    if (filter === null) return [summarySection, callsCard];
    // The filter is ephemeral state of the view it was chosen in, never a route.
    const bar = el("div", "toolbar");
    const clear = el("button", "", COPY["tools.clearFilter"]);
    clear.dataset.clearFilter = "true";
    bar.append(
      el("span", "muted", tr("tools.filteredBy", { tool: filter })),
      clear,
    );
    return [bar, summarySection, callsCard];
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
    subnav.setAttribute("aria-label", COPY["tab.environment"]);
    const entity = state.entity;
    const named =
      entity === undefined
        ? undefined
        : entity.kind === "command"
          ? "commands"
          : entity.kind === "source"
            ? "sources"
            : undefined;
    const active = named || activeSettings().envTab || "commands";
    [
      ["commands", COPY["env.commands"]],
      ["sources", COPY["env.resources"]],
    ].forEach((item) => {
      const button = el("button", "", item[1]);
      button.dataset.envTab = item[0];
      button.setAttribute("aria-pressed", String(active === item[0]));
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

  const agentsNodes = (target) => {
    const meta = target.range;
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
      note.textContent =
        view.activeSection === "current"
          ? COPY[
              state.scope === "active" ? "scope.active.note" : "scope.tree.note"
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
      setSetting("envTab", data.envTab);
      return;
    }
    if (data.filter !== undefined) {
      // A view's availability filter is this document's own state: it is never a
      // route, so it pushes nothing and writes no hash.
      setSetting(data.filter, activeSettings()[data.filter] === false);
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
    if (target.id === "sort") {
      navigate(
        withTable({ sort: target.value === "default" ? "" : target.value }),
      );
      return;
    }
    if (target.id === "chart-metric") setSetting("metric", target.value);
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

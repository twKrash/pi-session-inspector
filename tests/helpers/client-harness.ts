/**
 * The ordinary-asset harness: it executes the one bundled browser script in a
 * `vm` context with a stub DOM built from the shipped `shell.html`, so browser
 * tests exercise the exact bytes the server serves rather than a copy of its
 * logic.
 *
 * Everything the scripts can reach is stubbed here: the document (ids, tags,
 * classes, `[data-*]` attributes, focus, and an input's selection), the address
 * bar, `history.replaceState`, both storages, `fetch`, and the two event paths.
 * The harness also records what the client did and in which order — the route
 * parses it performed, the requests it sent with their `Authorization` header
 * and the address bar they were sent from, the times it installed a canonical
 * hash, and every storage write — because bootstrap order and a missing write
 * are claims no rendered value can prove on its own.
 */
import { createContext, runInContext } from "node:vm";

import { WEB_ASSETS } from "../../src/ui/web-assets.ts";
import type { InspectorUiSnapshot } from "../../src/ui/ui-projection.ts";
/**
 * The two observers a chart library binds on construction. They never fire: the
 * harness asserts what the shipped bundle renders, not how a library schedules.
 */
class StubObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): unknown[] {
    return [];
  }
}

/** An empty computed style: nothing in the shell is styled by the harness. */
function computedStyle(): Record<string, unknown> {
  const style: Record<string, unknown> = { getPropertyValue: () => "" };
  return new Proxy(style, {
    get: (target, property) =>
      property in target
        ? (target as Record<string | symbol, unknown>)[property]
        : "",
    set: (target, property, value) => {
      (target as Record<string | symbol, unknown>)[property] = value;
      return true;
    },
  });
}

/**
 * A 2D context that draws nothing: every method is a no-op and `measureText`
 * returns a fixed width, so layout is stable across runs.
 *
 * Only three members exist, because only they are read back:
 * - `canvas` — a chart refuses a context that does not point at its own canvas;
 * - `measureText` — text layout reads `.width` (the only measurement we can
 *   invent, and a fixed one keeps the number stable across runs);
 * - `getLineDash` — read as a list, so it must not be a no-op's `undefined`.
 *
 * Everything else (drawing, transforms, clipping, images, gradients) is a no-op
 * through the proxy. The harness deliberately does not model canvas behaviour:
 * what it asserts is that the shipped bundle starts the chart and keeps
 * rendering the rest of the view.
 */
function context2d(canvas: object): Record<string, unknown> {
  const base: Record<string, unknown> = {
    canvas,
    getLineDash: () => [],
    measureText: (text: unknown) => ({ width: String(text).length * 6 }),
  };
  return new Proxy(base, {
    get: (target, property) =>
      property in target
        ? (target as Record<string | symbol, unknown>)[property]
        : () => {},
    set: (target, property, value) => {
      (target as Record<string | symbol, unknown>)[property] = value;
      return true;
    },
  });
}

/** The slice of a canvas a chart library needs before it will start. */
export type ChartCanvasStub = {
  getContext(type: string): object | null;
  setAttribute(name: string, value: string): void;
  [member: string]: unknown;
};

/**
 * A canvas of a fixed size for the paths that need a chart to start (the browser
 * integration test through the harness, and the benchmark). It carries the
 * attributes a caller sets on it and hands back a no-op context; it models
 * nothing about how a chart draws or lays out.
 *
 * A chart reads exactly these members before it will construct, which is why
 * each is here:
 * - `getContext("2d")` and `parentNode` (with a size) — acquiring a context and
 *   measuring the box it draws into;
 * - `getAttribute`/`setAttribute`/`removeAttribute` plus `style`, `width` and
 *   `height` — the size/restore dance an acquisition performs;
 * - `addEventListener`/`removeEventListener` — bound only when the canvas is
 *   attached, which it is in the harness.
 */
export function createChartCanvasStub(
  width = 800,
  height = 180,
): ChartCanvasStub {
  const canvas: ChartCanvasStub = {
    attributes: {} as Record<string, string>,
    height: 0,
    isConnected: true,
    parentNode: null,
    style: {} as Record<string, string>,
    tagName: "CANVAS",
    width: 0,
    addEventListener() {},
    getAttribute: (name: string) =>
      (canvas.attributes as Record<string, string>)[name] ?? null,
    getContext: (type: string) => (type === "2d" ? context2d(canvas) : null),
    removeAttribute(name: string) {
      delete (canvas.attributes as Record<string, string>)[name];
    },
    removeEventListener() {},
    setAttribute(name: string, value: string) {
      (canvas.attributes as Record<string, string>)[name] = String(value);
    },
  };
  const parent = {
    clientHeight: height,
    clientWidth: width,
    getBoundingClientRect: () => ({
      bottom: height,
      height,
      left: 0,
      right: width,
      top: 0,
      width,
      x: 0,
      y: 0,
    }),
    isConnected: true,
    ownerDocument: globalThis.document,
    style: {},
  };
  canvas.parentNode = parent;
  canvas.ownerDocument = globalThis.document;
  return canvas;
}

/**
 * Installs the DOM globals a chart checks for in the current realm: the presence
 * of `window`/`document` (which selects the DOM platform), the computed-style
 * view the library reads through `ownerDocument`, the two observers it binds on
 * an attached canvas, and a device pixel ratio. The browser tests get the same
 * surface through the `vm` context; the benchmark runs the adapter directly and
 * needs it here.
 */
export function installChartGlobals(): void {
  const windowStub = {
    // Read while the library initializes, to probe listener options.
    addEventListener() {},
    removeEventListener() {},
    devicePixelRatio: 1,
    getComputedStyle: () => computedStyle(),
  };
  const documentStub = { defaultView: windowStub };
  const globals = globalThis as Record<string, unknown>;
  globals.document = documentStub;
  globals.window = windowStub;
  globals.getComputedStyle = () => computedStyle();
  globals.ResizeObserver = StubObserver;
  globals.MutationObserver = StubObserver;
}

export type StubElement = HarnessNode & {
  id: string;
  tagName: string;
  className: string;
  textContent: string;
  hidden: boolean;
  disabled: boolean;
  selected: boolean;
  value: string;
  placeholder: string;
  title: string;
  width: number;
  height: number;
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
  getAttribute(name: string): string | null;
  getBoundingClientRect(): {
    bottom: number;
    height: number;
    left: number;
    right: number;
    top: number;
    width: number;
    x: number;
    y: number;
  };
  getContext(type: string): unknown;
  isConnected: boolean;
  ownerDocument: unknown;
  querySelector(selector: string): StubElement | null;
  querySelectorAll(selector: string): StubElement[];
  closest(selector: string): StubElement | null;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  classList: { add(value: string): void; toggle(value: string): boolean };
  focus(): void;
  selectionStart: number;
  selectionEnd: number;
  setSelectionRange(start: number, end: number): void;
  showModal(): void;
  close(): void;
};

/** The scripts are classic; their element checks need one class identity. */
class HarnessNode {}

/**
 * How the stub reports the two DOM facts focus handling depends on: a `focus()`
 * call names the active element, and detaching the active element (which
 * `replaceChildren` does) moves focus back to the body.
 */
/** How the stub reports the two DOM facts focus handling depends on: a `focus()`
 * call names the active element, and detaching the active element (which
 * `replaceChildren` does) moves focus back to the body.
 */
type StubTracking = {
  focus(element: StubElement): void;
  detach(removed: readonly StubElement[]): void;
};

/**
 * One chart input the client handed the adapter. The client owns the projection
 * — labels, series, axes, gaps — so a test can assert it without reaching into
 * a live Chart instance.
 */
export type ChartInputRecord = {
  ariaLabel: string;
  labels: string[];
  series: {
    axis: string;
    format: string;
    key: string;
    label: string;
    values: (number | null)[];
  }[];
};

/** One ordered observation of what the client did, not only what it rendered. */
export type WebClientEvent =
  | { kind: "parse"; hash: string }
  | { kind: "fetch"; url: string; authorization: string; hash: string }
  | { kind: "replaceState"; hash: string }
  | { kind: "hashAssign"; hash: string };

/**
 * The one harness input. `responses` is consumed one per request (the last one
 * repeats), so a test can reload with a different DTO; `deferFetch` holds the
 * response back so the in-flight loading state is observable; `fetchFailure`
 * makes the boundary fail the way a browser reports it.
 */
/**
 * The one harness input. `responses` is consumed one per request (the last one
 * repeats), so a test can reload with a different DTO; `deferFetch` holds the
 * response back so the in-flight loading state is observable; `fetchFailure`
 * makes the boundary fail the way a browser reports it; `globals` adds
 * environment values (e.g. a clock probe) to the recycled realm.
 */
export type WebClientInput = {
  responses?: readonly InspectorUiSnapshot[];
  hash?: string;
  deferFetch?: boolean;
  fetchFailure?: "network" | "http";
  replaceStateFails?: boolean;
  globals?: Record<string, unknown>;
};

export type WebClientHarness = {
  /** The `vm` globals: the one namespace the scripts own lives here. */
  context: Record<string, unknown>;
  events: WebClientEvent[];
  fetches(): { url: string; authorization: string }[];
  routeParses(): string[];
  /** Every chart input the client projected, in the order it drew them. */
  chartInputs(): ChartInputRecord[];
  start(): Promise<void>;
  /** Releases a deferred response; only meaningful with `deferFetch`. */
  releaseFetch(): void;
  element(id: string): StubElement;
  body(): StubElement;
  texts(node: StubElement): string[];
  click(node: StubElement): void;
  change(node: StubElement): void;
  input(node: StubElement): void;
  hashchange(): void;
  popstate(): void;
  location: { hash: string };
  activeElement(): StubElement | null;
  /** Every storage write the client performed, though both storages exist. */
  storageWrites(): readonly { area: string; key: string }[];
  /** Renders performed so far, counted by the client's one view swap. */
  renders(): number;
  /** `history.replaceState` calls so far, so a push and a replace differ. */
  replacements(): number;
};

// ---------------------------------------------------------------------------
// Stub DOM
// ---------------------------------------------------------------------------

function matches(node: StubElement, selector: string): boolean {
  const match = /^([A-Za-z][\w-]*)?(?:\.([\w-]+))?(?:\[([\w-]+)\])?$/.exec(
    selector.trim(),
  );
  if (match === null) return false;
  const [, tag, className, attribute] = match;
  if (tag !== undefined && node.tagName !== tag.toLowerCase()) return false;
  if (
    className !== undefined &&
    !node.className.split(" ").includes(className)
  ) {
    return false;
  }
  if (
    attribute !== undefined &&
    node.dataset[attribute] === undefined &&
    node.attributes[attribute] === undefined
  ) {
    return false;
  }
  return true;
}

function descendants(node: StubElement, selector: string): StubElement[] {
  const found: StubElement[] = [];
  for (const child of node.children) {
    if (selector.split(",").some((part) => matches(child, part))) {
      found.push(child);
    }
    found.push(...descendants(child, selector));
  }
  return found;
}

/** True when `node` is `root` or one of its descendants. */
function containsNode(root: StubElement, node: StubElement): boolean {
  if (root === node) return true;
  return root.children.some((child) => containsNode(child, node));
}

function stubElement(
  tagName: string,
  onAppend?: (element: StubElement) => void,
  tracking?: StubTracking,
): StubElement {
  const element = new HarnessNode() as StubElement;
  element.id = "";
  element.tagName = tagName.toLowerCase();
  element.className = "";
  element.textContent = "";
  element.hidden = false;
  element.disabled = false;
  element.selected = false;
  element.value = "";
  element.placeholder = "";
  element.title = "";
  element.width = 0;
  element.height = 0;
  element.dataset = {};
  element.style = {};
  element.attributes = {};
  element.children = [];
  element.parentNode = null;
  element.ownerDocument = null;
  element.isConnected = true;
  element.getAttribute = (name) => element.attributes[name] ?? null;
  // The chart host is the one element a layout measures; give it a size so the
  // same numbers come out on every run.
  element.getBoundingClientRect = () => {
    const width = element.className.split(" ").includes("chart-canvas")
      ? 800
      : 0;
    const height = width === 0 ? 0 : 180;
    return {
      bottom: height,
      height,
      left: 0,
      right: width,
      top: 0,
      width,
      x: 0,
      y: 0,
    };
  };
  // Only a canvas hands back a context; nothing else in the stub tree does.
  element.getContext = (type) =>
    String(type) === "2d" && element.tagName === "canvas"
      ? context2d(element)
      : null;
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
    const removed = element.children;
    element.children = [];
    element.append(...nodes);
    tracking?.detach(removed);
  };
  element.setAttribute = (name, value) => {
    element.attributes[name] = String(value);
    if (name === "id") element.id = String(value);
    if (name === "class") element.className = String(value);
    if (name.startsWith("data-")) {
      element.dataset[
        name
          .slice(5)
          .replace(/-([a-z])/g, (_all, letter: string) => letter.toUpperCase())
      ] = String(value);
    }
  };
  element.removeAttribute = (name) => {
    delete element.attributes[name];
    if (name.startsWith("data-")) {
      const key = name
        .slice(5)
        .replace(/-([a-z])/g, (_all, letter: string) => letter.toUpperCase());
      delete element.dataset[key];
    }
  };
  element.querySelector = (selector) =>
    descendants(element, selector)[0] ?? null;
  element.querySelectorAll = (selector) => descendants(element, selector);
  element.closest = (selector) => {
    let node: StubElement | null = element;
    while (node !== null) {
      if (
        selector.split(",").some((part) => matches(node as StubElement, part))
      )
        return node;
      node = node.parentNode;
    }
    return null;
  };
  element.addEventListener = (type, listener) => {
    if (element.listeners[type] === undefined) element.listeners[type] = [];
    element.listeners[type].push(listener);
  };
  element.classList = {
    add: (value) => {
      const classes =
        element.className === "" ? [] : element.className.split(" ");
      if (!classes.includes(value)) classes.push(value);
      element.className = classes.join(" ");
    },
    toggle: (value) => {
      const classes =
        element.className === "" ? [] : element.className.split(" ");
      const enabled = !classes.includes(value);
      element.className = (
        enabled ? [...classes, value] : classes.filter((name) => name !== value)
      ).join(" ");
      return enabled;
    },
  };
  element.focus = () => {
    tracking?.focus(element);
  };
  element.selectionStart = 0;
  element.selectionEnd = 0;
  element.setSelectionRange = (start, end) => {
    element.selectionStart = start;
    element.selectionEnd = end;
  };
  element.showModal = () => {};
  element.close = () => {};
  return element;
}

/** The HTML attributes the shell carries that the scripts read back. */
const VOID_TAGS = new Set([
  "meta",
  "link",
  "input",
  "br",
  "hr",
  "img",
  "source",
]);

/**
 * Builds the stub tree from the shipped shell markup. The scan is deliberately
 * small — the shell is fixed, report-free markup — but it keeps real nesting and
 * the attributes (`id`, `class`, `data-*`, `href`, `src`) the scripts read, so
 * the client is driven by the actual landmarks rather than by a fixture list.
 */
function markupTree(
  html: string,
  tracking: StubTracking,
  register: (element: StubElement) => void,
): { body: StubElement; nodes: StubElement[] } {
  const body = stubElement("body", register, tracking);
  const stack: StubElement[] = [body];
  const nodes: StubElement[] = [body];
  // Tags and text: an element's own text becomes its `textContent`, so the
  // chrome the shell carries (labels, landmarks, static copy) reads back the way
  // a browser reports it.
  const token =
    /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|([^<]+)/g;
  for (const match of html.matchAll(token)) {
    const [, closing, name, attributeText = "", selfClosing, between] = match;
    if (between !== undefined) {
      const open = stack[stack.length - 1];
      if (open.children.length === 0) open.textContent += between;
      continue;
    }
    if (closing === "/") {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const element = stubElement(name, register, tracking);
    for (const attribute of attributeText.matchAll(
      /([\w:-]+)\s*=\s*"([^"]*)"/g,
    )) {
      element.setAttribute(attribute[1], attribute[2]);
    }
    if (/\shidden(\s|\/|$)/.test(attributeText)) element.hidden = true;
    stack[stack.length - 1].append(element);
    nodes.push(element);
    if (selfClosing !== "/" && !VOID_TAGS.has(name.toLowerCase())) {
      stack.push(element);
    }
  }
  return { body, nodes };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/**
 * Runs the bundled browser script against a stub DOM built from the shipped
 * shell. The bundle bootstraps on evaluation as it does in a browser;
 * `start()` remains awaitable so tests can wait for the initial request and
 * inspect its effects (the loading landmark, token disappearance, and render).
 */
export function createWebClient(input: WebClientInput = {}): WebClientHarness {
  const events: WebClientEvent[] = [];
  const store = new Map<string, StubElement>();
  const register = (element: StubElement): void => {
    if (element.id !== "") store.set(element.id, element);
  };
  // documentStub is read only when a control is focused or detached, which is
  // always after the store below exists.
  const tracking: StubTracking = {
    focus: (element) => {
      documentStub.activeElement = element;
    },
    detach: (removed) => {
      const active = documentStub.activeElement;
      if (active === null) return;
      if (removed.some((child) => containsNode(child, active))) {
        documentStub.activeElement = documentStub.body;
      }
    },
  };
  const { body, nodes } = markupTree(WEB_ASSETS.shell, tracking, register);
  for (const node of nodes) register(node);
  let renders = 0;
  const view = store.get("view");
  if (view !== undefined) {
    const swap = view.replaceChildren;
    view.replaceChildren = (...children) => {
      renders += 1;
      swap(...children);
    };
  }
  const windowStub = {
    cancelAnimationFrame: () => {},
    devicePixelRatio: 1,
    getComputedStyle: () => computedStyle(),
    requestAnimationFrame: (callback: (time: number) => void) =>
      setTimeout(() => callback(0), 0),
    scrollX: 0,
    scrollY: 0,
    scrollTo: () => {},
    listeners: {} as Record<string, ((event: unknown) => void)[]>,
    addEventListener: (
      type: string,
      listener: (event: unknown) => void,
    ): void => {
      const listeners = windowStub.listeners[type] ?? [];
      windowStub.listeners[type] = listeners;
      listeners.push(listener);
    },
  };
  const documentStub = {
    body,
    defaultView: windowStub,
    activeElement: null as StubElement | null,
    listeners: {} as Record<string, ((event: unknown) => void)[]>,
    getElementById: (id: string): StubElement | null => store.get(id) ?? null,
    createElement: (name: string): StubElement => {
      const created = stubElement(name, register, tracking);
      created.ownerDocument = documentStub;
      return created;
    },
    createElementNS: (_namespace: string, name: string): StubElement => {
      const created = stubElement(name, register, tracking);
      created.ownerDocument = documentStub;
      return created;
    },
    querySelector: (selector: string): StubElement | null =>
      descendants(body, selector)[0] ?? null,
    querySelectorAll: (selector: string): StubElement[] =>
      descendants(body, selector),
    addEventListener: (
      type: string,
      listener: (event: unknown) => void,
    ): void => {
      const listeners = documentStub.listeners[type] ?? [];
      documentStub.listeners[type] = listeners;
      listeners.push(listener);
    },
  };
  // The address bar the client reads and writes; a replacement moves the entry
  // the client already has, an assignment is the client's own history entry —
  // the difference the event log exists to prove.
  let hashValue = input.hash ?? "";
  const locationStub = {
    get hash(): string {
      return hashValue;
    },
    set hash(value: string) {
      hashValue = value;
      events.push({ kind: "hashAssign", hash: value });
    },
  };
  let replacements = 0;
  const historyStub = {
    replaceState: (_state: unknown, _title: string, url: string): void => {
      if (input.replaceStateFails === true) throw new Error("SecurityError");
      replacements += 1;
      hashValue = url;
      events.push({ kind: "replaceState", hash: url });
    },
  };

  // Both storages exist and record every write, so "no token reaches storage"
  // is a behavior of the client rather than an API this harness never built.
  const storageWrites: { area: string; key: string }[] = [];
  const storage = (area: string): Record<string, unknown> =>
    new Proxy(
      {},
      {
        set: (_target, key) => {
          storageWrites.push({ area: area, key: String(key) });
          return true;
        },
      },
    );

  // The client reads at most one bounded capability token from the fragment; the
  // stub below reports exactly the three request facts a test may assert.
  const responses = input.responses ?? [];
  let served = 0;
  let release: (() => void) | null = null;
  const snapshotFor = (): InspectorUiSnapshot | undefined =>
    responses.length === 0
      ? undefined
      : responses[Math.min(served, responses.length - 1)];
  const respond = (): Promise<unknown> => {
    const snapshot = snapshotFor();
    served += 1;
    if (input.fetchFailure !== undefined) {
      return input.fetchFailure === "network"
        ? Promise.reject(new TypeError("Failed to fetch"))
        : Promise.resolve(Response(false));
    }
    return Promise.resolve(Response(true, snapshot));
  };
  const Response = (ok: boolean, snapshot?: InspectorUiSnapshot) => ({
    ok,
    status: ok ? 200 : 401,
    json: async () => snapshot,
  });
  const fetchStub = (
    url: string,
    init?: { headers?: Record<string, string> },
  ) => {
    events.push({
      kind: "fetch",
      url,
      authorization: init?.headers?.Authorization ?? "",
      hash: locationStub.hash,
    });
    if (input.deferFetch === true) {
      return new Promise<unknown>((resolve) => {
        release = () => resolve(respond());
      });
    }
    return respond();
  };
  const navigatorStub = {
    clipboard: { writeText: async () => {} },
  };
  const context: Record<string, unknown> = {
    document: documentStub,
    window: windowStub,
    location: locationStub,
    history: historyStub,
    localStorage: storage("localStorage"),
    sessionStorage: storage("sessionStorage"),
    navigator: navigatorStub,
    fetch: fetchStub,
    console,
    ResizeObserver: StubObserver,
    MutationObserver: StubObserver,
    setTimeout,
    ...input.globals,
  };
  for (const node of nodes) node.ownerDocument = documentStub;
  createContext(context);
  runInContext(WEB_ASSETS.client, context, { filename: "client.js" });
  // The client starts during evaluation; this recorder is installed before the
  // asynchronous response resolves, so it sees every request-driven parse.
  const namespace = context.SessionInspectorWeb as
    | { route?: { parse?: (hash: unknown, options?: unknown) => unknown } }
    | undefined;
  // The chart namespace is a plain object the prelude installs, so recording the
  // input it is handed observes the client's own projection rather than the
  // drawing. The real adapter still runs, so the chart still has to construct.
  const chartInputs: ChartInputRecord[] = [];
  const chartNamespace = (
    context.SessionInspectorWeb as
      | {
          chart?: {
            createDailyChart?: (
              canvas: unknown,
              input: ChartInputRecord,
            ) => unknown;
          };
        }
      | undefined
  )?.chart;
  if (
    chartNamespace !== undefined &&
    typeof chartNamespace.createDailyChart === "function"
  ) {
    const create = chartNamespace.createDailyChart;
    chartNamespace.createDailyChart = (canvas, input) => {
      chartInputs.push(input);
      return create(canvas, input);
    };
  }
  const routeParse = namespace?.route?.parse;
  if (typeof routeParse === "function" && namespace?.route !== undefined) {
    namespace.route.parse = (hash: unknown, options?: unknown) => {
      events.push({ kind: "parse", hash: String(hash) });
      return routeParse(hash, options);
    };
  }

  const texts = (node: StubElement): string[] => {
    const collected = node.textContent === "" ? [] : [node.textContent];
    for (const child of node.children) collected.push(...texts(child));
    return collected;
  };
  const element = (id: string): StubElement => {
    const found = store.get(id);
    if (found === undefined) throw new Error(`no element #${id}`);
    return found;
  };
  const dispatch = (node: StubElement, type: string): void => {
    const listeners = [
      ...(node.listeners[type] ?? []),
      ...(documentStub.listeners[type] ?? []),
    ];
    if (listeners.length === 0) throw new Error(`no ${type} handler`);
    // A real event runs the target's own listeners and then bubbles to the
    // document, so a control's own handler and the one delegated handler both
    // see it, in that order.
    const event = {
      target: node,
      currentTarget: node,
      button: 0,
      preventDefault: () => {},
    };
    for (const listener of listeners) listener(event);
  };
  const fire = (type: string): void => {
    const listeners = windowStub.listeners[type] ?? [];
    if (listeners.length === 0) throw new Error(`no ${type} listener`);
    for (const listener of listeners) listener({});
  };
  const start = async (): Promise<void> => {
    const started = (context.SessionInspectorWeb as { start?: () => unknown })
      ?.start;
    if (typeof started !== "function") throw new Error("no start member");
    await started();
  };
  return {
    context,
    events,
    fetches: () =>
      events
        .filter((event) => event.kind === "fetch")
        .map((event) => ({
          url: event.url,
          authorization: event.authorization,
        })),
    routeParses: () =>
      events
        .filter((event) => event.kind === "parse")
        .map((event) => event.hash),
    chartInputs: () => chartInputs,
    start,
    releaseFetch: () => {
      if (release === null) throw new Error("no deferred fetch");
      const run = release;
      release = null;
      run();
    },
    element,
    body: () => body,
    texts,
    click: (node) => dispatch(node, "click"),
    change: (node) => dispatch(node, "change"),
    input: (node) => dispatch(node, "input"),
    hashchange: () => fire("hashchange"),
    popstate: () => fire("popstate"),
    location: locationStub,
    activeElement: () => documentStub.activeElement,
    storageWrites: () => storageWrites,
    renders: () => renders,
    replacements: () => replacements,
  };
}

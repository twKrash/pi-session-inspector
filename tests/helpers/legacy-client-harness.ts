/**
 * The legacy document's harness: it runs the emitted `renderInspectorBundle`
 * script against a stub DOM, because that script is the only code no unit test
 * would otherwise execute.
 *
 * The interactive localhost application is the ordinary assets under
 * `src/ui/web/`, executed by `client-harness.ts`; this harness stays only for
 * the legacy document suites (`report-range.test.ts`) until the cleanup task
 * deletes the inline document and the suites that assert it. Its stub DOM is
 * therefore frozen: new browser tests belong in the ordinary-asset harness.
 */
import type { InspectorBundle } from "../../src/ui/bundle.ts";
import { renderInspectorBundle } from "../../src/ui/html.ts";

export type StubElement = HarnessNode & {
  id: string;
  tagName: string;
  className: string;
  textContent: string;
  hidden: boolean;
  value: string;
  placeholder: string;
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
  querySelector(selector: string): StubElement | null;
  querySelectorAll(selector: string): StubElement[];
  closest(selector: string): StubElement | null;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  classList: { add(value: string): void; toggle(value: string): boolean };
  focus(): void;
  setSelectionRange(): void;
  showModal(): void;
  close(): void;
};

/** The client is a classic script; its `instanceof Node` checks need a class. */
class HarnessNode {}

/**
 * How the stub reports the two DOM facts focus preservation depends on: a
 * `focus()` call names the active element, and detaching the active element
 * (which `replaceChildren` does) moves focus back to the body.
 */
type StubTracking = {
  focus(element: StubElement): void;
  detach(removed: readonly StubElement[]): void;
};

function descendant(node: StubElement, selector: string): StubElement | null {
  for (const child of node.children) {
    const matches = selector.startsWith(".")
      ? child.className.split(" ").includes(selector.slice(1))
      : child.tagName === selector;
    if (matches) return child;
    const nested = descendant(child, selector);
    if (nested !== null) return nested;
  }
  return null;
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
  element.tagName = tagName;
  element.className = "";
  element.textContent = "";
  element.hidden = false;
  element.value = "";
  element.placeholder = "";
  element.dataset = {};
  element.style = {};
  element.attributes = {};
  element.children = [];
  element.parentNode = null;
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
  };
  element.removeAttribute = (name) => {
    delete element.attributes[name];
  };
  element.querySelector = (selector) => descendant(element, selector);
  element.querySelectorAll = (selector) => {
    const found: StubElement[] = [];
    for (const child of element.children) {
      if (
        selector.startsWith(".")
          ? child.className.split(" ").includes(selector.slice(1))
          : child.tagName === selector
      ) {
        found.push(child);
      }
      found.push(...child.querySelectorAll(selector));
    }
    return found;
  };
  element.closest = (selector) => {
    let node: StubElement | null = element;
    while (node !== null) {
      const matches = selector.startsWith(".")
        ? node.className.split(" ").includes(selector.slice(1))
        : node.tagName === selector;
      if (matches) return node;
      node = node.parentNode;
    }
    return null;
  };
  element.addEventListener = (type, listener) => {
    if (element.listeners[type] === undefined) element.listeners[type] = [];
    element.listeners[type].push(listener);
  };
  // Class changes are recorded on `className`, so the highlight and theme rules
  // the client writes are rendered evidence a test can read back.
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
  // The document's activeElement follows real focus calls, so a test can assert
  // which control the client handed focus to (and which one it preserved).
  element.focus = () => {
    tracking?.focus(element);
  };
  element.setSelectionRange = () => {};
  element.showModal = () => {};
  element.close = () => {};
  return element;
}

/**
 * The applied route the client exposes to the harness, plus the one derivation it
 * renders from. A test mutates the route exactly like a navigation would and
 * calls render(), so the expectations below are always checked against the
 * document's own client.
 */
type ClientInternals = {
  state: {
    section: string;
    tab: string;
    scope: string;
    session?: string | null;
    range?: { kind: string; preset?: number; from?: string; to?: string };
    entity?: { kind: string; id: string };
    table?: { query?: string; sort?: string };
  };
  render(effects?: { structural?: boolean; sectionChanged?: boolean }): void;
};

/**
 * The one client-harness behaviour a test may vary. `replaceStateFails` models
 * the browser that rejects `history.replaceState` for a `file://` document (a
 * SecurityError), which the design's hash routing has to survive (design R5).
 */
export type ClientHarnessOptions = { replaceStateFails?: boolean };

/**
 * Runs the emitted client against a stub document. The generated document is
 * 40 KB of client code that no other test executes, so at least one test has to
 * render it for real: the store below is what the client's own `q(id)` reads.
 * `initialHash` is the address bar the document loads with, so a deep link is
 * exercised exactly as a fresh load would.
 */
export function runClient(
  bundle: InspectorBundle,
  initialHash = "",
  options: ClientHarnessOptions = {},
): {
  client: ClientInternals;
  preset(days: string): void;
  submit(): void;
  click(node: StubElement): void;
  change(node: StubElement): void;
  input(node: StubElement): void;
  element(id: string): StubElement;
  texts(node: StubElement): string[];
  /** The address bar the client reads and writes; a test drives a deep link. */
  location: { hash: string };
  /** Renders performed so far, counted by the one scroll call render() makes. */
  renders(): number;
  /** `history.replaceState` calls so far, so a push and a replace differ. */
  replacements(): number;
  /** The element the client last focused, exactly as the DOM reports it. */
  activeElement(): StubElement | null;
  /** Fires the event the browser fires for a hash the test just set. */
  hashchange(): void;
} {
  const html = renderInspectorBundle(bundle);
  const payload =
    /<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/.exec(
      html,
    )?.[1] ?? "";
  const catalog =
    /<script type="application\/json" id="catalog-data">([\s\S]*?)<\/script>/.exec(
      html,
    )?.[1] ?? "";
  const script =
    /<script>\n([\s\S]*)\n<\/script><\/body>/.exec(html)?.[1] ?? "";
  // Every id the server-rendered markup carries; anything else is absent, so
  // the client's create-on-demand paths (and any stale id) behave as in a browser.
  const markupIds = [
    "navigation",
    "breadcrumb",
    "kicker",
    "title",
    "subtitle",
    "theme",
    "session-label",
    "scope-note",
    "wal-detail",
    "scope",
    "scope-sub",
    "scope-fixed",
    "time-range",
    "range-name",
    "range-dates",
    "custom-range",
    "date-dialog",
    "date-form",
    "date-title",
    "date-from",
    "date-to",
    "date-error",
    "date-cancel",
    "tabs",
    "route-notice",
    "view",
    "announcement",
    "report-data",
    "catalog-data",
    // The server renders the truncation notice only for a capped view.
    ...(html.includes('id="range-truncated"') ? ["range-truncated"] : []),
  ];
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
  const dayButtons = ["7", "14", "30"].map((days) => {
    const button = stubElement("button", register, tracking);
    button.dataset.days = days;
    return button;
  });
  const documentStub = {
    body: stubElement("body"),
    activeElement: null as StubElement | null,
    listeners: {} as Record<string, (event: unknown) => void>,
    getElementById: (id: string): StubElement | null => {
      const existing = store.get(id);
      if (existing !== undefined) return existing;
      if (!markupIds.includes(id)) return null;
      const created = stubElement(
        id === "tabs" ? "nav" : "div",
        register,
        tracking,
      );
      created.id = id;
      created.parentNode = stubElement("div");
      created.textContent =
        id === "report-data" ? payload : id === "catalog-data" ? catalog : "";
      store.set(id, created);
      return created;
    },
    createElement: (name: string): StubElement =>
      stubElement(name, register, tracking),
    createElementNS: (_namespace: string, name: string): StubElement =>
      stubElement(name, register, tracking),
    querySelectorAll: (selector: string): StubElement[] =>
      selector === "[data-days]" ? dayButtons : [],
    addEventListener: (
      type: string,
      listener: (event: unknown) => void,
    ): void => {
      documentStub.listeners[type] = listener;
    },
  };
  let renders = 0;
  const windowStub = {
    scrollX: 0,
    scrollY: 0,
    // render() makes exactly one scroll call, so this counts renders.
    scrollTo: () => {
      renders += 1;
    },
    listeners: {} as Record<string, (event: unknown) => void>,
    addEventListener: (
      type: string,
      listener: (event: unknown) => void,
    ): void => {
      windowStub.listeners[type] = listener;
    },
  };
  // The address bar the client reads on every applyLocation and writes on every
  // navigate, with the one history surface a replace navigation uses.
  const locationStub: { hash: string } = { hash: initialHash };
  let replacements = 0;
  const historyStub = {
    replaceState: (_state: unknown, _title: string, url: string): void => {
      // A document that refuses the call refuses it the way a browser does:
      // it throws before anything is written, so no replacement is counted.
      if (options.replaceStateFails === true) throw new Error("SecurityError");
      replacements += 1;
      locationStub.hash = url;
    },
  };
  const factory = new Function(
    "document",
    "window",
    "Node",
    "location",
    "history",
    `${script}\nreturn {state:state,render:render};`,
  ) as (
    document: unknown,
    window: unknown,
    node: unknown,
    location: unknown,
    history: unknown,
  ) => ClientInternals;
  const client = factory(
    documentStub,
    windowStub,
    HarnessNode,
    locationStub,
    historyStub,
  );
  const texts = (node: StubElement): string[] => {
    const collected = node.textContent === "" ? [] : [node.textContent];
    for (const child of node.children) collected.push(...texts(child));
    return collected;
  };
  return {
    client,
    preset: (days) => {
      const button = dayButtons.find(
        (candidate) => candidate.dataset.days === days,
      );
      if (button === undefined) throw new Error(`no preset ${days}`);
      for (const listener of button.listeners.click ?? []) {
        listener({ currentTarget: button });
      }
    },
    submit: () => {
      for (const listener of documentStub.getElementById("date-form")?.listeners
        .submit ?? []) {
        listener({ preventDefault: () => {} });
      }
    },
    // The client delegates every button to one document-level click handler, so
    // a rendered control is exercised through that handler, not by calling the
    // state logic the handler would have reached.
    click: (node) => {
      const listener = documentStub.listeners.click;
      if (listener === undefined) throw new Error("no document click handler");
      listener({ target: node });
    },
    // The client's one change handler reads the control it is given, so a select
    // is exercised the way the browser reports it.
    change: (node) => {
      const listener = documentStub.listeners.change;
      if (listener === undefined) throw new Error("no document change handler");
      listener({ target: node });
    },
    // Typing is the same delegated event path a browser uses for an input.
    input: (node) => {
      const listener = documentStub.listeners.input;
      if (listener === undefined) throw new Error("no document input handler");
      listener({ target: node });
    },
    element: (id) => {
      const found = documentStub.getElementById(id);
      if (found === null) throw new Error(`no element #${id}`);
      return found;
    },
    texts,
    location: locationStub,
    renders: () => renders,
    replacements: () => replacements,
    activeElement: () => documentStub.activeElement,
    hashchange: () => {
      const listener = windowStub.listeners.hashchange;
      if (listener === undefined) throw new Error("no hashchange listener");
      listener({});
    },
  };
}

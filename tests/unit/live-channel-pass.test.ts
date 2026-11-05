import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test as nodeTest, type TestContext } from "node:test";
import WebSocket from "ws";
import { sessionInvalidationSignal } from "../../src/ui/invalidation.ts";
import { attachLiveChannel } from "../../src/ui/live-channel.ts";
import type { InspectorBundle } from "../../src/ui/bundle.ts";
import { serializeUiSnapshot } from "../../src/ui/snapshot-revision.ts";
import type { InspectorUiSnapshot } from "../../src/ui/ui-projection.ts";

let previousTest = Promise.resolve();
function test(name: string, fn: (t: TestContext) => Promise<void>): void {
  const previous = previousTest;
  let release!: () => void;
  previousTest = new Promise<void>((resolve) => {
    release = resolve;
  });
  nodeTest(name, async (context) => {
    await previous;
    try {
      await fn(context);
    } finally {
      release();
    }
  });
}

const snapshot = {
  kind: "ui",
  schemaVersion: 1,
  theme: "light",
  initialScope: "active",
  current: { active: {}, tree: {}, sameReportProjection: false },
  history: {},
  global: {},
} as unknown as InspectorUiSnapshot;
const bundle: InspectorBundle = {
  schemaVersion: 1,
  theme: "light",
  initialScope: "active",
  current: {
    active: { availability: "unavailable", diagnostic: "current-unavailable" },
    tree: { availability: "unavailable", diagnostic: "current-unavailable" },
    sameReportProjection: false,
  },
  history: { availability: "unavailable", sessions: [], diagnostics: [] },
  global: {
    availability: "unavailable",
    sessions: [],
    usage: { totalTokens: 0, cost: 0 },
    dates: [],
    diagnostics: [],
    inventory: { commands: null, skills: null, resources: null },
  },
};
const closed = (ws: WebSocket) =>
  new Promise<number | undefined>((resolve) => {
    const timeout = setTimeout(() => resolve(undefined), 1_000);
    ws.once("close", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });

async function setup(pass: {
  loadUi?: () => Promise<InspectorUiSnapshot>;
  loadPass(): Promise<InspectorBundle>;
  projectPass(
    source: InspectorBundle,
    intent?: import("../../src/ui/range.ts").RangeIntent,
  ): InspectorUiSnapshot;
}) {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  const origin = `http://127.0.0.1:${port}`;
  let loads = 0;
  const channel = attachLiveChannel(
    server,
    origin,
    () => ({
      runtimeId: "pass-test",
      projectRoot: "/p",
      initialScope: "active",
      loadUi: async () => {
        loads++;
        return snapshot;
      },
      ...pass,
    }),
    () => true,
  );
  const sockets: WebSocket[] = [];
  async function connect(
    range: string,
    onSubscribe?: () => void,
    etag = "stale",
  ) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/v1/ui-live`, {
      origin,
    });
    sockets.push(ws);
    await new Promise<void>((resolve) => ws.once("open", resolve));
    ws.send(
      JSON.stringify({
        type: "subscribe",
        capability: "cap",
        etag,
        range,
      }),
    );
    onSubscribe?.();
    return ws;
  }
  async function add(
    range: string,
    onSubscribe?: () => void,
    etag?: string,
  ): Promise<WebSocket> {
    const ws = await connect(range, onSubscribe, etag);
    await new Promise<void>((resolve) => ws.once("message", () => resolve()));
    return ws;
  }
  return { server, channel, sockets, add, connect, loads: () => loads };
}

test("a pass captured during first initialization delivers its update", async (t) => {
  let initialStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    initialStarted = resolve;
  });
  let releaseInitial!: () => void;
  const initialHeld = new Promise<void>((resolve) => {
    releaseInitial = resolve;
  });
  let initialLoads = 0;
  let projected!: () => void;
  const passProjected = new Promise<void>((resolve) => {
    projected = resolve;
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = await setup({
    loadUi: async () => {
      initialLoads++;
      if (initialLoads === 1) {
        initialStarted();
        await initialHeld;
      }
      return snapshot;
    },
    loadPass: async () => bundle,
    projectPass: () => {
      projected();
      return { ...snapshot, theme: "dark" };
    },
  });
  try {
    const address = h.server.address();
    assert.ok(address && typeof address !== "string");
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/api/v1/ui-live`, {
      origin: `http://127.0.0.1:${address.port}`,
    });
    h.sockets.push(ws);
    await new Promise<void>((resolve) => ws.once("open", resolve));
    ws.send(
      JSON.stringify({
        type: "subscribe",
        capability: "cap",
        etag: "stale",
        range: "",
      }),
    );
    await started;
    sessionInvalidationSignal.notify({
      runtimeId: "pass-test",
      sessionId: "s",
    });
    t.mock.timers.tick(200);
    const messages: string[] = [];
    ws.on("message", (raw) => messages.push(raw.toString()));
    releaseInitial();
    await passProjected;
    const pong = new Promise<void>((resolve) => ws.once("pong", resolve));
    ws.ping();
    await pong;
    assert.ok(messages.some((message) => message.includes('"theme":"dark"')));
  } finally {
    releaseInitial();
    t.mock.timers.reset();
    for (const ws of h.sockets) ws.close();
    await h.channel.close();
    await new Promise<void>((resolve) => h.server.close(() => resolve()));
  }
});

test("late stale-ETag initialization cannot be overwritten by a captured pass", async () => {
  let passStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    passStarted = resolve;
  });
  let releasePass!: () => void;
  const held = new Promise<void>((resolve) => {
    releasePass = resolve;
  });
  let uiLoads = 0;
  const h = await setup({
    loadUi: async () => {
      uiLoads++;
      return uiLoads === 1 ? snapshot : { ...snapshot, theme: "dark" };
    },
    loadPass: async () => {
      passStarted();
      await held;
      return bundle;
    },
    projectPass: () => snapshot,
  });
  try {
    const a = await h.add("");
    const updates: string[] = [];
    a.on("message", (raw) => updates.push(raw.toString()));
    sessionInvalidationSignal.notify({
      runtimeId: "pass-test",
      sessionId: "s",
    });
    await started;
    let subscribed!: () => void;
    const subscribeSent = new Promise<void>((resolve) => {
      subscribed = resolve;
    });
    const bPending = h.add("", () => subscribed());
    await subscribeSent;
    assert.equal(uiLoads, 1);
    releasePass();
    await bPending;
    const pong = new Promise<void>((resolve) => a.once("pong", resolve));
    a.ping();
    await pong;
    const darkIndex = updates.findIndex((message) =>
      message.includes('"theme":"dark"'),
    );
    assert.notEqual(darkIndex, -1);
    assert.ok(
      !updates
        .slice(darkIndex + 1)
        .some((message) => message.includes('"theme":"light"')),
    );
  } finally {
    releasePass();
    for (const ws of h.sockets) ws.close();
    await h.channel.close();
    await new Promise<void>((resolve) => h.server.close(() => resolve()));
  }
});

test("a stale revalidation during a captured pass schedules a follow-up", async (t) => {
  let revalidationStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    revalidationStarted = resolve;
  });
  let releaseRevalidation!: () => void;
  const held = new Promise<void>((resolve) => {
    releaseRevalidation = resolve;
  });
  let uiLoads = 0;
  let passLoads = 0;
  let firstProjected!: () => void;
  const first = new Promise<void>((resolve) => {
    firstProjected = resolve;
  });
  let secondProjected!: () => void;
  const second = new Promise<void>((resolve) => {
    secondProjected = resolve;
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = await setup({
    loadUi: async () => {
      uiLoads++;
      if (uiLoads === 2) {
        revalidationStarted();
        await held;
      }
      return snapshot;
    },
    loadPass: async () => {
      passLoads++;
      return bundle;
    },
    projectPass: () => {
      if (passLoads === 1) firstProjected();
      if (passLoads === 2) secondProjected();
      return { ...snapshot, theme: "dark" };
    },
  });
  try {
    await h.add("");
    const bPending = h.add("");
    await started;
    sessionInvalidationSignal.notify({
      runtimeId: "pass-test",
      sessionId: "s",
    });
    t.mock.timers.tick(200);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(passLoads, 0);

    releaseRevalidation();
    await bPending;
    await first;
    await new Promise<void>((resolve) => setImmediate(resolve));
    t.mock.timers.tick(200);
    await second;
    assert.equal(passLoads, 2);
  } finally {
    releaseRevalidation();
    t.mock.timers.reset();
    for (const ws of h.sockets) ws.close();
    await h.channel.close();
    await new Promise<void>((resolve) => h.server.close(() => resolve()));
  }
});

test("a stale revalidation coalesces with an already scheduled pass", async (t) => {
  let revalidationStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    revalidationStarted = resolve;
  });
  let releaseRevalidation!: () => void;
  const held = new Promise<void>((resolve) => {
    releaseRevalidation = resolve;
  });
  let uiLoads = 0;
  let passLoads = 0;
  let projected!: () => void;
  const passProjected = new Promise<void>((resolve) => {
    projected = resolve;
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = await setup({
    loadUi: async () => {
      uiLoads++;
      if (uiLoads === 2) {
        revalidationStarted();
        await held;
      }
      return snapshot;
    },
    loadPass: async () => {
      passLoads++;
      return bundle;
    },
    projectPass: () => {
      projected();
      return { ...snapshot, theme: "dark" };
    },
  });
  try {
    await h.add("");
    const bPending = h.add("");
    await started;
    sessionInvalidationSignal.notify({
      runtimeId: "pass-test",
      sessionId: "s",
    });
    releaseRevalidation();
    await bPending;
    t.mock.timers.tick(200);
    await passProjected;
    await new Promise<void>((resolve) => setImmediate(resolve));
    t.mock.timers.tick(200);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(passLoads, 1);
  } finally {
    releaseRevalidation();
    t.mock.timers.reset();
    for (const ws of h.sockets) ws.close();
    await h.channel.close();
    await new Promise<void>((resolve) => h.server.close(() => resolve()));
  }
});

test("channel shutdown abandons pending initialization barriers", async (t) => {
  let initializationStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    initializationStarted = resolve;
  });
  let releaseInitialization!: () => void;
  const held = new Promise<void>((resolve) => {
    releaseInitialization = resolve;
  });
  let passLoads = 0;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = await setup({
    loadUi: async () => {
      initializationStarted();
      await held;
      return snapshot;
    },
    loadPass: async () => {
      passLoads++;
      return bundle;
    },
    projectPass: () => snapshot,
  });
  let channelClosed = false;
  try {
    await h.connect("");
    await started;
    sessionInvalidationSignal.notify({
      runtimeId: "pass-test",
      sessionId: "s",
    });
    t.mock.timers.tick(200);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(passLoads, 0);

    await h.channel.close();
    channelClosed = true;
    releaseInitialization();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(passLoads, 0);
  } finally {
    releaseInitialization();
    t.mock.timers.reset();
    for (const ws of h.sockets) ws.close();
    if (!channelClosed) await h.channel.close();
    await new Promise<void>((resolve) => h.server.close(() => resolve()));
  }
});

test("a disconnected initializer does not block refreshes for surviving ranges", async () => {
  let revalidationStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    revalidationStarted = resolve;
  });
  let releaseRevalidation!: () => void;
  const held = new Promise<void>((resolve) => {
    releaseRevalidation = resolve;
  });
  let uiLoads = 0;
  let passLoads = 0;
  let passStarted!: () => void;
  const refreshStarted = new Promise<void>((resolve) => {
    passStarted = resolve;
  });
  const h = await setup({
    loadUi: async () => {
      uiLoads++;
      if (uiLoads === 3) {
        revalidationStarted();
        await held;
        return snapshot;
      }
      return snapshot;
    },
    loadPass: async () => {
      passLoads++;
      passStarted();
      return bundle;
    },
    projectPass: () => ({ ...snapshot, theme: "dark" }),
  });
  try {
    const a = await h.add("");
    const c = await h.add("preset=7");
    const aMessages: string[] = [];
    const cMessages: string[] = [];
    a.on("message", (raw) => aMessages.push(raw.toString()));
    c.on("message", (raw) => cMessages.push(raw.toString()));
    const aDark = new Promise<void>((resolve) => {
      a.on("message", (raw) => {
        if (raw.toString().includes('"theme":"dark"')) resolve();
      });
    });
    const cDark = new Promise<void>((resolve) => {
      c.on("message", (raw) => {
        if (raw.toString().includes('"theme":"dark"')) resolve();
      });
    });
    const b = await h.connect("");
    await started;
    const closedB = closed(b);
    b.close(1000);
    assert.equal(await closedB, 1000);
    sessionInvalidationSignal.notify({
      runtimeId: "pass-test",
      sessionId: "s",
    });
    let timeout: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(
        () => reject(Error("refresh did not complete")),
        1_000,
      );
    });
    try {
      await Promise.race([
        Promise.all([refreshStarted, aDark, cDark]),
        deadline,
      ]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }

    assert.equal(passLoads, 1);
    assert.ok(aMessages.some((message) => message.includes('"theme":"dark"')));
    assert.ok(cMessages.some((message) => message.includes('"theme":"dark"')));

    releaseRevalidation();
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    assert.equal(passLoads, 1);
  } finally {
    releaseRevalidation();
    for (const ws of h.sockets) ws.close();
    await h.channel.close();
    await new Promise<void>((resolve) => h.server.close(() => resolve()));
  }
});

test("a late same-range subscriber cannot receive a stale ready after its captured peers close", async (t) => {
  let passStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    passStarted = resolve;
  });
  let releasePass!: () => void;
  const held = new Promise<void>((resolve) => {
    releasePass = resolve;
  });
  let uiLoads = 0;
  let passLoads = 0;
  let projections = 0;
  const freshSnapshot: InspectorUiSnapshot = { ...snapshot, theme: "dark" };
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = await setup({
    loadUi: async () => {
      uiLoads++;
      return uiLoads === 1 ? snapshot : freshSnapshot;
    },
    loadPass: async () => {
      passLoads++;
      passStarted();
      await held;
      return bundle;
    },
    projectPass: () => {
      projections++;
      return freshSnapshot;
    },
  });
  try {
    const a = await h.add("");
    const oldEtag = serializeUiSnapshot(snapshot).etag;
    sessionInvalidationSignal.notify({
      runtimeId: "pass-test",
      sessionId: "s",
    });
    t.mock.timers.tick(200);
    await started;

    const b = await h.connect("", undefined, oldEtag);
    const pong = new Promise<void>((resolve) => b.once("pong", resolve));
    b.ping();
    await pong;
    assert.equal(uiLoads, 1);
    const response = new Promise<Record<string, unknown>>((resolve) => {
      b.once("message", (raw) => resolve(JSON.parse(raw.toString())));
    });
    const closedA = closed(a);
    a.close(1000);
    assert.equal(await closedA, 1000);

    releasePass();
    const message = await response;
    assert.equal(message.type, "snapshot");
    assert.equal(message.etag, serializeUiSnapshot(freshSnapshot).etag);
    assert.equal(uiLoads, 2);
    assert.equal(passLoads, 1);
    assert.equal(projections, 0);
  } finally {
    releasePass();
    t.mock.timers.reset();
    for (const ws of h.sockets) ws.close();
    await h.channel.close();
    await new Promise<void>((resolve) => h.server.close(() => resolve()));
  }
});

test("a rejected captured initialization does not abort other range updates", async (t) => {
  let failedLoadStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    failedLoadStarted = resolve;
  });
  let releaseFailure!: () => void;
  const held = new Promise<void>((resolve) => {
    releaseFailure = resolve;
  });
  let uiLoads = 0;
  let passLoads = 0;
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = await setup({
    loadUi: async () => {
      uiLoads++;
      if (uiLoads === 1) {
        failedLoadStarted();
        await held;
        throw Error("initial load failure");
      }
      return snapshot;
    },
    loadPass: async () => {
      passLoads++;
      return bundle;
    },
    projectPass: () => ({ ...snapshot, theme: "dark" }),
  });
  try {
    const a = await h.connect("");
    await started;
    const closedA = closed(a);
    const b = await h.add("preset=7");
    const updates: string[] = [];
    b.on("message", (raw) => updates.push(raw.toString()));
    sessionInvalidationSignal.notify({
      runtimeId: "pass-test",
      sessionId: "s",
    });
    t.mock.timers.tick(200);
    releaseFailure();
    await new Promise<void>((resolve) => setImmediate(resolve));
    const pong = new Promise<void>((resolve) => b.once("pong", resolve));
    b.ping();
    await pong;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(passLoads, 1);
    assert.ok(updates.some((message) => message.includes('"theme":"dark"')));
    assert.deepEqual(unhandled, []);
    assert.equal(await closedA, 1011);
  } finally {
    process.off("unhandledRejection", onUnhandled);
    releaseFailure();
    t.mock.timers.reset();
    for (const ws of h.sockets) ws.close();
    await h.channel.close();
    await new Promise<void>((resolve) => h.server.close(() => resolve()));
  }
});

test("retiring a rejected captured initialization releases the pass for a later range", async (t) => {
  let initializationStarted!: () => void;
  const initializationPending = new Promise<void>((resolve) => {
    initializationStarted = resolve;
  });
  let rejectInitialization!: () => void;
  const heldInitialization = new Promise<void>((resolve) => {
    rejectInitialization = resolve;
  });
  let firstPassStarted!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    firstPassStarted = resolve;
  });
  let secondPassStarted!: () => void;
  const secondStarted = new Promise<void>((resolve) => {
    secondPassStarted = resolve;
  });
  let releaseFirstPass!: () => void;
  const heldPass = new Promise<void>((resolve) => {
    releaseFirstPass = resolve;
  });
  let uiLoads = 0;
  let passLoads = 0;
  const projectedThemes: string[] = [];
  const freshBundle: InspectorBundle = { ...bundle, theme: "dark" };
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = await setup({
    loadUi: async () => {
      uiLoads++;
      if (uiLoads === 1) {
        initializationStarted();
        await heldInitialization;
        throw Error("initial load failure");
      }
      return snapshot;
    },
    loadPass: async () => {
      passLoads++;
      if (passLoads === 1) {
        firstPassStarted();
        await heldPass;
        return bundle;
      }
      secondPassStarted();
      return freshBundle;
    },
    projectPass: (source) => {
      projectedThemes.push(source.theme);
      return { ...snapshot, theme: source.theme };
    },
  });
  try {
    const a = await h.connect("");
    await initializationPending;
    sessionInvalidationSignal.notify({
      runtimeId: "pass-test",
      sessionId: "s",
    });
    t.mock.timers.tick(200);

    const b = await h.add("preset=7");
    const update = new Promise<string>((resolve) => {
      b.once("message", (raw) => resolve(raw.toString()));
    });
    const closedA = closed(a);
    rejectInitialization();
    await firstStarted;
    assert.equal(await closedA, 1011);
    const pong = new Promise<void>((resolve) => b.once("pong", resolve));
    b.ping();
    await pong;

    sessionInvalidationSignal.notify({
      runtimeId: "pass-test",
      sessionId: "s",
    });
    t.mock.timers.tick(200);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(passLoads, 2);
    await secondStarted;
    assert.ok((await update).includes('"theme":"dark"'));

    releaseFirstPass();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(projectedThemes, ["dark"]);
    assert.equal(uiLoads, 2);
  } finally {
    rejectInitialization();
    releaseFirstPass();
    t.mock.timers.reset();
    for (const ws of h.sockets) ws.close();
    await h.channel.close();
    await new Promise<void>((resolve) => h.server.close(() => resolve()));
  }
});

test("retiring the last captured range releases the pass for a later subscriber", async (t) => {
  let firstPassStarted!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    firstPassStarted = resolve;
  });
  let secondPassStarted!: () => void;
  const secondStarted = new Promise<void>((resolve) => {
    secondPassStarted = resolve;
  });
  let releaseFirstPass!: () => void;
  const held = new Promise<void>((resolve) => {
    releaseFirstPass = resolve;
  });
  let passLoads = 0;
  const projectedThemes: string[] = [];
  const freshBundle: InspectorBundle = { ...bundle, theme: "dark" };
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = await setup({
    loadPass: async () => {
      passLoads++;
      if (passLoads === 1) {
        firstPassStarted();
        await held;
        return bundle;
      }
      secondPassStarted();
      return freshBundle;
    },
    projectPass: (source) => {
      projectedThemes.push(source.theme);
      return { ...snapshot, theme: source.theme };
    },
  });
  try {
    const a = await h.add("");
    sessionInvalidationSignal.notify({
      runtimeId: "pass-test",
      sessionId: "s",
    });
    t.mock.timers.tick(200);
    await firstStarted;

    const b = await h.add("preset=7");
    const update = new Promise<string>((resolve) => {
      b.once("message", (raw) => resolve(raw.toString()));
    });
    const closedA = closed(a);
    a.close(1000);
    assert.equal(await closedA, 1000);
    const pong = new Promise<void>((resolve) => b.once("pong", resolve));
    b.ping();
    await pong;

    sessionInvalidationSignal.notify({
      runtimeId: "pass-test",
      sessionId: "s",
    });
    t.mock.timers.tick(200);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(passLoads, 2);
    await secondStarted;
    assert.ok((await update).includes('"theme":"dark"'));

    releaseFirstPass();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(projectedThemes, ["dark"]);
  } finally {
    releaseFirstPass();
    t.mock.timers.reset();
    for (const ws of h.sockets) ws.close();
    await h.channel.close();
    await new Promise<void>((resolve) => h.server.close(() => resolve()));
  }
});

test("retiring a captured range releases the pass for remaining ranges", async (t) => {
  let loadStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    loadStarted = resolve;
  });
  let releaseLoad!: () => void;
  const held = new Promise<void>((resolve) => {
    releaseLoad = resolve;
  });
  let uiLoads = 0;
  let passLoads = 0;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = await setup({
    loadUi: async () => {
      uiLoads++;
      if (uiLoads === 1) {
        loadStarted();
        await held;
      }
      return snapshot;
    },
    loadPass: async () => {
      passLoads++;
      return bundle;
    },
    projectPass: () => ({ ...snapshot, theme: "dark" }),
  });
  try {
    const a = await h.connect("");
    await started;
    const b = await h.add("preset=7");
    const updates: string[] = [];
    b.on("message", (raw) => updates.push(raw.toString()));
    sessionInvalidationSignal.notify({
      runtimeId: "pass-test",
      sessionId: "s",
    });
    t.mock.timers.tick(200);
    const closedA = closed(a);
    a.close(1000);
    assert.equal(await closedA, 1000);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const pong = new Promise<void>((resolve) => b.once("pong", resolve));
    b.ping();
    await pong;
    assert.equal(passLoads, 1);
    assert.ok(updates.some((message) => message.includes('"theme":"dark"')));
  } finally {
    releaseLoad();
    t.mock.timers.reset();
    for (const ws of h.sockets) ws.close();
    await h.channel.close();
    await new Promise<void>((resolve) => h.server.close(() => resolve()));
  }
});

test("one shared source pass projects separately to each captured range", async () => {
  let started!: () => void;
  const passStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let passLoads = 0;
  let projections = 0;
  const h = await setup({
    loadPass: async () => {
      passLoads++;
      started();
      await held;
      return bundle;
    },
    projectPass: (_source, intent) => {
      projections++;
      return {
        ...snapshot,
        theme: intent?.kind === "preset" ? "dark" : "light",
        initialScope: intent?.kind === "preset" ? "active" : "tree",
      };
    },
  });
  try {
    const a = await h.add("");
    const b = await h.add("preset=7");
    const delivered = [a, b].map(
      (ws) =>
        new Promise<string>((resolve) =>
          ws.once("message", (raw) => resolve(raw.toString())),
        ),
    );
    sessionInvalidationSignal.notify({
      runtimeId: "pass-test",
      sessionId: "s",
    });
    await passStarted;
    release();
    const updates = await Promise.all(delivered);
    assert.ok(updates.every((message) => message.includes('"type":"delta"')));
    assert.ok(updates[0]?.includes('"initialScope":"tree"'));
    assert.ok(updates[1]?.includes('"theme":"dark"'));
    assert.equal(passLoads, 1);
    assert.equal(projections, 2);
    assert.equal(h.loads(), 2);
  } finally {
    release();
    for (const ws of h.sockets) ws.close();
    await h.channel.close();
    await new Promise<void>((resolve) => h.server.close(() => resolve()));
  }
});

test("a failed shared pass reloads a waiting same-range subscriber", async (t) => {
  let passStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    passStarted = resolve;
  });
  let releasePass!: () => void;
  const held = new Promise<void>((resolve) => {
    releasePass = resolve;
  });
  let uiLoads = 0;
  let passLoads = 0;
  let projections = 0;
  const freshSnapshot: InspectorUiSnapshot = { ...snapshot, theme: "dark" };
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = await setup({
    loadUi: async () => {
      uiLoads++;
      return uiLoads === 1 ? snapshot : freshSnapshot;
    },
    loadPass: async () => {
      passLoads++;
      passStarted();
      await held;
      throw Error("load failure");
    },
    projectPass: () => {
      projections++;
      return snapshot;
    },
  });
  try {
    const a = await h.add("");
    const oldEtag = serializeUiSnapshot(snapshot).etag;
    sessionInvalidationSignal.notify({
      runtimeId: "pass-test",
      sessionId: "s",
    });
    t.mock.timers.tick(200);
    await started;

    const b = await h.connect("", undefined, oldEtag);
    const response = new Promise<string>((resolve) => {
      b.once("message", (raw) => resolve(raw.toString()));
    });
    const pong = new Promise<void>((resolve) => b.once("pong", resolve));
    b.ping();
    await pong;
    const closedA = closed(a);
    releasePass();
    assert.equal(await closedA, 1011);

    const message = JSON.parse(await response) as {
      type: string;
      etag: string;
      snapshot?: InspectorUiSnapshot;
    };
    assert.equal(message.type, "snapshot");
    assert.equal(message.snapshot?.theme, "dark");
    assert.equal(message.etag, serializeUiSnapshot(freshSnapshot).etag);
    assert.equal(uiLoads, 2);
    assert.equal(passLoads, 1);
    assert.equal(projections, 0);
  } finally {
    releasePass();
    t.mock.timers.reset();
    for (const ws of h.sockets) ws.close();
    await h.channel.close();
    await new Promise<void>((resolve) => h.server.close(() => resolve()));
  }
});

test("a failed range projection reloads its late peer and leaves sibling ranges live", async (t) => {
  let passStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    passStarted = resolve;
  });
  let releasePass!: () => void;
  const held = new Promise<void>((resolve) => {
    releasePass = resolve;
  });
  let uiLoads = 0;
  let passLoads = 0;
  let projections = 0;
  const freshSnapshot: InspectorUiSnapshot = { ...snapshot, theme: "dark" };
  const freshBundle: InspectorBundle = { ...bundle, theme: "dark" };
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = await setup({
    loadUi: async () => {
      uiLoads++;
      return uiLoads <= 2 ? snapshot : freshSnapshot;
    },
    loadPass: async () => {
      passLoads++;
      passStarted();
      await held;
      return freshBundle;
    },
    projectPass: (source, intent) => {
      projections++;
      if (intent === undefined) throw Error("range failure");
      return { ...snapshot, theme: source.theme };
    },
  });
  try {
    const a = await h.add("");
    const sibling = await h.add("preset=7");
    const siblingUpdate = new Promise<string>((resolve) => {
      sibling.once("message", (raw) => resolve(raw.toString()));
    });
    const oldEtag = serializeUiSnapshot(snapshot).etag;
    sessionInvalidationSignal.notify({
      runtimeId: "pass-test",
      sessionId: "s",
    });
    t.mock.timers.tick(200);
    await started;

    const b = await h.connect("", undefined, oldEtag);
    const response = new Promise<string>((resolve) => {
      b.once("message", (raw) => resolve(raw.toString()));
    });
    const pong = new Promise<void>((resolve) => b.once("pong", resolve));
    b.ping();
    await pong;
    const closedA = closed(a);
    releasePass();
    assert.equal(await closedA, 1011);

    const message = JSON.parse(await response) as {
      type: string;
      etag: string;
      snapshot?: InspectorUiSnapshot;
    };
    assert.equal(message.type, "snapshot");
    assert.equal(message.snapshot?.theme, "dark");
    assert.equal(message.etag, serializeUiSnapshot(freshSnapshot).etag);
    assert.ok((await siblingUpdate).includes('"theme":"dark"'));
    assert.equal(sibling.readyState, WebSocket.OPEN);
    assert.equal(uiLoads, 3);
    assert.equal(passLoads, 1);
    assert.equal(projections, 2);
  } finally {
    releasePass();
    t.mock.timers.reset();
    for (const ws of h.sockets) ws.close();
    await h.channel.close();
    await new Promise<void>((resolve) => h.server.close(() => resolve()));
  }
});

test("a rejected shared pass closes every captured range without projecting", async () => {
  let passLoads = 0;
  let projections = 0;
  const h = await setup({
    loadPass: async () => {
      passLoads++;
      throw Error("load failure");
    },
    projectPass: () => {
      projections++;
      return snapshot;
    },
  });
  try {
    const a = await h.add("");
    const b = await h.add("preset=7");
    const closedA = closed(a);
    const closedB = closed(b);
    sessionInvalidationSignal.notify({
      runtimeId: "pass-test",
      sessionId: "s",
    });
    assert.deepEqual(await Promise.all([closedA, closedB]), [1011, 1011]);
    assert.equal(passLoads, 1);
    assert.equal(projections, 0);
    assert.equal(h.loads(), 2);
  } finally {
    for (const ws of h.sockets) ws.close();
    await h.channel.close();
    await new Promise<void>((resolve) => h.server.close(() => resolve()));
  }
});

test("one failed range projection does not prevent another captured range", async () => {
  let projections = 0;
  const h = await setup({
    loadPass: async () => bundle,
    projectPass: (_source, intent) => {
      projections++;
      if (intent !== undefined) throw Error("range failure");
      return snapshot;
    },
  });
  try {
    const a = await h.add("");
    const b = await h.add("preset=7");
    const closedB = closed(b);
    sessionInvalidationSignal.notify({
      runtimeId: "pass-test",
      sessionId: "s",
    });
    assert.equal(await closedB, 1011);
    assert.equal(projections, 2);
    assert.equal(a.readyState, WebSocket.OPEN);
    assert.equal(h.loads(), 2);
  } finally {
    for (const ws of h.sockets) ws.close();
    await h.channel.close();
    await new Promise<void>((resolve) => h.server.close(() => resolve()));
  }
});

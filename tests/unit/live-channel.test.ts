import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import WebSocket from "ws";
import { sessionInvalidationSignal } from "../../src/ui/invalidation.ts";
import { attachLiveChannel } from "../../src/ui/live-channel.ts";
import type { RangeIntent } from "../../src/ui/range.ts";
import type { InspectorUiSnapshot } from "../../src/ui/ui-projection.ts";
import { waitFor } from "../helpers/wait.ts";

const snapshot = {
  kind: "ui",
  schemaVersion: 1,
  theme: "light",
  initialScope: "active",
  current: { active: {}, tree: {}, sameReportProjection: false },
  history: {},
  global: {},
} as unknown as InspectorUiSnapshot;
function snapshotForRange(requested: RangeIntent | null) {
  return {
    ...snapshot,
    current: {
      ...snapshot.current,
      active: { ...snapshot.current.active, range: { requested } },
      tree: { ...snapshot.current.tree, range: { requested } },
    },
    history: { ...snapshot.history, requested },
    global: { ...snapshot.global, requested },
  } as unknown as InspectorUiSnapshot;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function messageWithin(
  ws: WebSocket,
  timeoutMs = 1_000,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const onMessage = (data: WebSocket.RawData) => {
      clearTimeout(timeout);
      resolve(data.toString());
    };
    const timeout = setTimeout(() => {
      ws.off("message", onMessage);
      resolve(undefined);
    }, timeoutMs);
    ws.once("message", onMessage);
  });
}
async function listen() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { server, address, origin: `http://127.0.0.1:${address.port}` };
}
async function stop(
  server: ReturnType<typeof createServer>,
  channel: { close(): Promise<void> },
) {
  await channel.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
function openSocket(
  port: number,
  origin: string,
  path = "/api/v1/ui-live",
  headers?: Record<string, string>,
) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, {
    origin,
    headers,
  });
  ws.on("error", () => {});
  return ws;
}
function message(ws: WebSocket) {
  return new Promise<string>((resolve) =>
    ws.once("message", (data) => resolve(data.toString())),
  );
}
function ready(ws: WebSocket) {
  return new Promise<void>((resolve) => ws.once("open", resolve));
}
function subscribe(
  ws: WebSocket,
  capability: string,
  etag: string,
  range = "",
) {
  ws.send(JSON.stringify({ type: "subscribe", capability, etag, range }));
}

test("auth before report read; unchanged DTOs and deltas are controlled by canonical revision", async () => {
  const { server, address, origin } = await listen();
  let loads = 0;
  let theme: "light" | "dark" = "light";
  const context = {
    runtimeId: "r",
    projectRoot: "/p",
    initialScope: "active",
    loadUi: async () => {
      loads++;
      return { ...snapshot, theme } as InspectorUiSnapshot;
    },
  };
  const channel = attachLiveChannel(
    server,
    origin,
    () => context,
    (token) => token === "secret",
  );
  const ws = openSocket(address.port, origin);
  await ready(ws);
  assert.equal(loads, 0);
  const { serializeUiSnapshot } = await import(
    "../../src/ui/snapshot-revision.ts"
  );
  const first = serializeUiSnapshot(snapshot);
  subscribe(ws, "secret", first.etag);
  assert.equal(JSON.parse(await message(ws)).type, "ready");
  assert.equal(loads, 1);
  sessionInvalidationSignal.notify();
  await new Promise((r) => setTimeout(r, 240));
  assert.equal(loads, 2);
  assert.equal(ws.readyState, WebSocket.OPEN);
  theme = "dark";
  sessionInvalidationSignal.notify();
  const delta = JSON.parse(await message(ws));
  assert.equal(delta.type, "delta");
  assert.deepEqual(Object.keys(delta.changes), ["theme"]);
  ws.close();
  await stop(server, channel);
});

test("retires a slow subscriber before its outbound DTO queue exceeds the byte budget", async () => {
  const { server, address, origin } = await listen();
  const originalBufferedAmount = Object.getOwnPropertyDescriptor(
    WebSocket.prototype,
    "bufferedAmount",
  );
  assert.ok(originalBufferedAmount?.get);
  let payload = "x".repeat(1_240_000);
  const context = {
    runtimeId: "r",
    projectRoot: "/p",
    initialScope: "active",
    loadUi: async () =>
      ({ ...snapshot, history: { payload } }) as unknown as InspectorUiSnapshot,
  };
  const channel = attachLiveChannel(
    server,
    origin,
    () => context,
    (token) => token === "secret",
  );
  const ws = openSocket(address.port, origin);
  try {
    await ready(ws);
    subscribe(ws, "secret", "stale");
    const initial = JSON.parse(await message(ws));
    assert.equal(initial.type, "snapshot");
    assert.equal(initial.snapshot.history.payload.length, 1_240_000);

    Object.defineProperty(WebSocket.prototype, "bufferedAmount", {
      ...originalBufferedAmount,
      get: () => 3 * 1024 * 1024,
    });
    payload = "y" + payload.slice(1);
    sessionInvalidationSignal.notify();
    await waitFor(
      () => ws.readyState === WebSocket.CLOSED,
      "slow WebSocket subscriber termination",
    );
  } finally {
    Object.defineProperty(
      WebSocket.prototype,
      "bufferedAmount",
      originalBufferedAmount,
    );
    ws.close();
    await stop(server, channel);
  }
});

test("one report load per shared runtime/project/scope/range baseline during a burst", async () => {
  const { server, address, origin } = await listen();
  let loads = 0;
  let theme: "light" | "dark" = "light";
  const context = {
    runtimeId: "generation-1",
    projectRoot: "/p",
    initialScope: "tree",
    loadUi: async () => {
      loads++;
      return { ...snapshot, theme } as InspectorUiSnapshot;
    },
  };
  const channel = attachLiveChannel(
    server,
    origin,
    () => context,
    () => true,
  );
  const a = openSocket(address.port, origin),
    b = openSocket(address.port, origin);
  await Promise.all([ready(a), ready(b)]);
  const { etag } = await import("../../src/ui/snapshot-revision.ts").then((m) =>
    m.serializeUiSnapshot(snapshot),
  );
  subscribe(a, "a", etag, "preset=7");
  subscribe(b, "b", etag, "preset=7");
  await Promise.all([message(a), message(b)]);
  assert.equal(loads, 1);
  theme = "dark";
  for (let i = 0; i < 5; i++) sessionInvalidationSignal.notify();
  const [ma, mb] = await Promise.all([message(a), message(b)]);
  assert.equal(JSON.parse(ma).type, "delta");
  assert.equal(JSON.parse(mb).type, "delta");
  assert.equal(
    loads,
    2,
    "shared range baseline should load once for the burst",
  );
  a.close();
  b.close();
  await stop(server, channel);
});

test("a retired multi-range refresh cannot overwrite replacement baselines", async () => {
  const { server, address, origin } = await listen();
  const range7: RangeIntent = { kind: "preset", preset: 7 };
  const firstRefresh = deferred<InspectorUiSnapshot>();
  let oldLoads = 0;
  let nextLoads = 0;
  let announceRefresh!: () => void;
  const refreshStarted = new Promise<void>((resolve) => {
    announceRefresh = resolve;
  });
  let theme: "light" | "dark" = "dark";
  const oldContext = {
    runtimeId: "r",
    projectRoot: "/p",
    initialScope: "active",
    loadUi: async (intent?: RangeIntent) => {
      oldLoads++;
      if (oldLoads === 3 && intent?.kind === "preset" && intent.preset === 7) {
        announceRefresh();
        return firstRefresh.promise;
      }
      return snapshotForRange(intent ?? null);
    },
  };
  const nextContext = {
    ...oldContext,
    loadUi: async (intent?: RangeIntent) => {
      nextLoads++;
      return {
        ...snapshotForRange(intent ?? null),
        theme,
      } as InspectorUiSnapshot;
    },
  };
  let context = oldContext;
  const channel = attachLiveChannel(
    server,
    origin,
    () => context,
    () => true,
  );
  const old7 = openSocket(address.port, origin);
  let old14: WebSocket | undefined;
  let current: WebSocket | undefined;
  try {
    await ready(old7);
    const secondSocket = openSocket(address.port, origin);
    old14 = secondSocket;
    await ready(secondSocket);
    subscribe(old7, "cap", "stale", "preset=7");
    subscribe(secondSocket, "cap", "stale", "preset=14");
    await Promise.all([message(old7), message(secondSocket)]);

    sessionInvalidationSignal.notify();
    await refreshStarted;

    const old7Closed = new Promise<void>((resolve) =>
      old7.once("close", () => resolve()),
    );
    const old14Closed = new Promise<void>((resolve) =>
      secondSocket.once("close", () => resolve()),
    );
    context = nextContext;
    channel.replaceContext();
    await Promise.all([old7Closed, old14Closed]);

    current = openSocket(address.port, origin);
    await ready(current);
    subscribe(current, "cap", "stale", "preset=14");
    const initial = JSON.parse(await message(current));
    assert.equal(initial.type, "snapshot");
    assert.equal(initial.snapshot.theme, "dark");

    theme = "light";
    const update = messageWithin(current, 500);
    sessionInvalidationSignal.notify();
    const delta = JSON.parse((await update) ?? "null");
    assert.equal(delta.type, "delta");
    assert.deepEqual(Object.keys(delta.changes), ["theme"]);
    assert.equal(delta.changes.theme, "light");
    assert.equal(nextLoads, 2);
    firstRefresh.resolve(snapshotForRange(range7));
  } finally {
    old7.close();
    old14?.close();
    current?.close();
    await stop(server, channel);
  }
});

test("a final disconnect retires its refresh lock and captured range groups", async () => {
  const { server, address, origin } = await listen();
  const range7: RangeIntent = { kind: "preset", preset: 7 };
  const firstRefresh = deferred<InspectorUiSnapshot>();
  let theme: "light" | "dark" = "dark";
  let range7Loads = 0;
  let announceRefresh!: () => void;
  const refreshStarted = new Promise<void>((resolve) => {
    announceRefresh = resolve;
  });
  const context = {
    runtimeId: "r",
    projectRoot: "/p",
    initialScope: "active",
    loadUi: async (intent?: RangeIntent) => {
      if (
        intent?.kind === "preset" &&
        intent.preset === 7 &&
        ++range7Loads === 2
      ) {
        announceRefresh();
        return firstRefresh.promise;
      }
      return {
        ...snapshotForRange(intent ?? null),
        theme,
      } as InspectorUiSnapshot;
    },
  };
  const channel = attachLiveChannel(
    server,
    origin,
    () => context,
    () => true,
  );
  const old7 = openSocket(address.port, origin);
  let old14: WebSocket | undefined;
  let current: WebSocket | undefined;
  try {
    await ready(old7);
    const secondSocket = openSocket(address.port, origin);
    old14 = secondSocket;
    await ready(secondSocket);
    const old7Message = message(old7);
    const old14Message = message(secondSocket);
    subscribe(old7, "cap", "stale", "preset=7");
    subscribe(secondSocket, "cap", "stale", "preset=14");
    await Promise.all([old7Message, old14Message]);

    sessionInvalidationSignal.notify();
    await refreshStarted;

    const old7Closed = new Promise<void>((resolve) =>
      old7.once("close", () => resolve()),
    );
    const old14Closed = new Promise<void>((resolve) =>
      secondSocket.once("close", () => resolve()),
    );
    old7.close();
    secondSocket.close();
    await Promise.all([old7Closed, old14Closed]);

    current = openSocket(address.port, origin);
    await ready(current);
    const initialMessage = message(current);
    subscribe(current, "cap", "stale", "preset=14");
    const initial = JSON.parse(await initialMessage);
    assert.equal(initial.snapshot.theme, "dark");

    theme = "light";
    const firstUpdate = messageWithin(current, 500);
    sessionInvalidationSignal.notify();
    const firstDelta = JSON.parse((await firstUpdate) ?? "null");
    assert.equal(firstDelta.type, "delta");
    assert.equal(firstDelta.changes.theme, "light");

    theme = "dark";
    firstRefresh.resolve(snapshotForRange(range7));
    await new Promise<void>((resolve) => setImmediate(resolve));
    const secondUpdate = messageWithin(current, 500);
    sessionInvalidationSignal.notify();
    const secondDelta = JSON.parse((await secondUpdate) ?? "null");
    assert.equal(secondDelta.type, "delta");
    assert.equal(secondDelta.changes.theme, "dark");
  } finally {
    old7.close();
    old14?.close();
    current?.close();
    await stop(server, channel);
  }
});

test("retiring another range preserves the active range's pending delta", async () => {
  const { server, address, origin } = await listen();
  const serverSockets: Array<import("node:stream").Duplex> = [];
  server.on("upgrade", (_request, socket) => serverSockets.push(socket));
  const range7: RangeIntent = { kind: "preset", preset: 7 };
  const firstRefresh = deferred<InspectorUiSnapshot>();
  let range7Loads = 0;
  let announceRefresh!: () => void;
  const refreshStarted = new Promise<void>((resolve) => {
    announceRefresh = resolve;
  });
  let theme: "light" | "dark" = "dark";
  const context = {
    runtimeId: "r",
    projectRoot: "/p",
    initialScope: "active",
    loadUi: async (intent?: RangeIntent) => {
      if (
        intent?.kind === "preset" &&
        intent.preset === 7 &&
        ++range7Loads === 2
      ) {
        announceRefresh();
        return firstRefresh.promise;
      }
      return {
        ...snapshotForRange(intent ?? null),
        theme,
      } as InspectorUiSnapshot;
    },
  };
  const channel = attachLiveChannel(
    server,
    origin,
    () => context,
    () => true,
  );
  const active = openSocket(address.port, origin);
  let retiring: WebSocket | undefined;
  try {
    await ready(active);
    retiring = openSocket(address.port, origin);
    await ready(retiring);
    const activeInitial = message(active);
    const retiringInitial = message(retiring);
    subscribe(active, "cap", "stale", "preset=7");
    subscribe(retiring, "cap", "stale", "preset=14");
    const [initial] = await Promise.all([activeInitial, retiringInitial]);
    const initialSnapshot = JSON.parse(initial);
    assert.equal(initialSnapshot.snapshot.theme, "dark");

    sessionInvalidationSignal.notify();
    await refreshStarted;

    const retiringClosed = new Promise<void>((resolve) =>
      retiring?.once("close", () => resolve()),
    );
    const retiringTransport = serverSockets[1];
    assert.ok(retiringTransport);
    const retiringTransportClosed = new Promise<void>((resolve) =>
      retiringTransport.once("close", () => resolve()),
    );
    retiring.close();
    await Promise.all([retiringClosed, retiringTransportClosed]);

    theme = "light";
    const update = messageWithin(active, 500);
    firstRefresh.resolve({
      ...snapshotForRange(range7),
      theme,
    } as InspectorUiSnapshot);
    const delta = JSON.parse((await update) ?? "null");
    assert.equal(delta.type, "delta");
    assert.equal(delta.baseEtag, initialSnapshot.etag);
    assert.equal(delta.changes.theme, "light");

    theme = "dark";
    const nextUpdate = messageWithin(active, 500);
    sessionInvalidationSignal.notify();
    const nextDelta = JSON.parse((await nextUpdate) ?? "null");
    assert.equal(nextDelta.type, "delta");
    assert.equal(nextDelta.baseEtag, delta.etag);
    assert.equal(nextDelta.changes.theme, "dark");
  } finally {
    active.close();
    retiring?.close();
    await stop(server, channel);
  }
});

test("an ETag associated with a different range forces a full snapshot", async () => {
  const { server, address, origin } = await listen();
  const channel = attachLiveChannel(
    server,
    origin,
    () => ({
      runtimeId: "r",
      projectRoot: "/p",
      initialScope: "active",
      loadUi: async () => snapshot,
    }),
    () => true,
  );
  const { etag } = await import("../../src/ui/snapshot-revision.ts").then((m) =>
    m.serializeUiSnapshot(snapshot),
  );
  const first = openSocket(address.port, origin);
  await ready(first);
  subscribe(first, "cap", etag, "");
  assert.equal(JSON.parse(await message(first)).type, "ready");
  const second = openSocket(address.port, origin);
  await ready(second);
  subscribe(second, "cap", etag, "preset=7");
  assert.equal(JSON.parse(await message(second)).type, "snapshot");
  first.close();
  second.close();
  await stop(server, channel);
});

test("zero authenticated subscribers discard invalidations without report loads", async () => {
  const { server, address, origin } = await listen();
  let loads = 0;
  const channel = attachLiveChannel(
    server,
    origin,
    () => ({
      runtimeId: "r",
      projectRoot: "/p",
      initialScope: "active",
      loadUi: async (intent) => {
        loads++;
        return snapshotForRange(intent ?? null);
      },
    }),
    () => true,
  );
  try {
    sessionInvalidationSignal.notify();
    await new Promise((r) => setTimeout(r, 230));
    assert.equal(loads, 0);

    const ws = openSocket(address.port, origin);
    await ready(ws);
    const { etag } = await import("../../src/ui/snapshot-revision.ts").then(
      (m) => m.serializeUiSnapshot(snapshotForRange(null)),
    );
    subscribe(ws, "cap", etag);
    assert.equal(JSON.parse(await message(ws)).type, "ready");
    assert.equal(loads, 1);
    const closed = new Promise<void>((resolve) =>
      ws.once("close", () => resolve()),
    );
    ws.close();
    await closed;

    sessionInvalidationSignal.notify();
    await new Promise((r) => setTimeout(r, 230));
    assert.equal(loads, 1);

    const reconnected = openSocket(address.port, origin);
    await ready(reconnected);
    subscribe(reconnected, "cap", etag, "preset=7");
    const rangeResync = JSON.parse(await message(reconnected));
    assert.equal(rangeResync.type, "snapshot");
    assert.deepEqual(rangeResync.snapshot.history.requested, {
      kind: "preset",
      preset: 7,
    });
    assert.equal(loads, 2, "an unused baseline is not retained");
  } finally {
    await stop(server, channel);
  }
});

test("range mismatch and stale revision receive a full snapshot", async () => {
  const { server, address, origin } = await listen();
  let loads = 0;
  const channel = attachLiveChannel(
    server,
    origin,
    () => ({
      runtimeId: "r",
      projectRoot: "/p",
      initialScope: "active",
      loadUi: async () => {
        loads++;
        return snapshot;
      },
    }),
    () => true,
  );
  const stale = openSocket(address.port, origin);
  try {
    await ready(stale);
    subscribe(stale, "cap", "wrong-etag", "preset=7");
    const resync = JSON.parse(await message(stale));
    assert.equal(resync.type, "snapshot");
    assert.equal(loads, 1);
  } finally {
    stale.close();
    await stop(server, channel);
  }
});

test("socket cap counts authenticated and pending connections together", async () => {
  const { server, address, origin } = await listen();
  const channel = attachLiveChannel(
    server,
    origin,
    () => ({
      runtimeId: "r",
      projectRoot: "/p",
      initialScope: "active",
      loadUi: async () => snapshot,
    }),
    () => true,
  );
  const peers: WebSocket[] = [];
  try {
    const { etag } = await import("../../src/ui/snapshot-revision.ts").then(
      (m) => m.serializeUiSnapshot(snapshot),
    );
    const authenticated = Array.from({ length: 4 }, () =>
      openSocket(address.port, origin),
    );
    peers.push(...authenticated);
    await Promise.all(authenticated.map(ready));
    const initial = authenticated.map((ws) => message(ws));
    authenticated.forEach((ws) => {
      subscribe(ws, "cap", etag);
    });
    await Promise.all(initial);

    for (let index = 0; index < 4; index++) {
      const ws = openSocket(address.port, origin);
      peers.push(ws);
      await ready(ws);
    }
    const rejectedPeer = openSocket(address.port, origin);
    peers.push(rejectedPeer);
    const rejected = new Promise<void>((resolve) => {
      rejectedPeer.once("error", resolve);
      rejectedPeer.once("close", resolve);
    });
    await rejected;
  } finally {
    for (const ws of peers) ws.close();
    await stop(server, channel);
  }
});

test("foreign origin, wrong path and oversized frames are rejected before report reads", async () => {
  const { server, address, origin } = await listen();
  let loads = 0;
  const channel = attachLiveChannel(
    server,
    origin,
    () => ({
      runtimeId: "r",
      projectRoot: "/p",
      initialScope: "active",
      loadUi: async () => {
        loads++;
        return snapshot;
      },
    }),
    () => true,
  );
  const foreign = openSocket(address.port, "http://evil.invalid");
  await new Promise<void>((resolve) => {
    foreign.once("error", resolve);
    foreign.once("close", resolve);
  });
  const wrongHost = openSocket(address.port, origin, "/api/v1/ui-live", {
    Host: "localhost",
  });
  await new Promise<void>((resolve) => {
    wrongHost.once("error", resolve);
    wrongHost.once("close", resolve);
  });
  const wrong = openSocket(address.port, origin, "/wrong");
  await new Promise<void>((resolve) => {
    wrong.once("error", resolve);
    wrong.once("close", resolve);
  });
  const oversized = openSocket(address.port, origin);
  await ready(oversized);
  const ended = new Promise<void>((resolve) => {
    oversized.once("close", resolve);
    oversized.once("error", resolve);
  });
  oversized.send("x".repeat(1025));
  await ended;
  assert.equal(loads, 0);
  await stop(server, channel);
});

test("invalidation during a refresh schedules a follow-up pass", async () => {
  const { server, address, origin } = await listen();
  let loads = 0;
  let theme: "light" | "dark" = "light";
  let releaseFirstRefresh: ((value: InspectorUiSnapshot) => void) | undefined;
  let announceFirstRefresh: (() => void) | undefined;
  const firstRefreshStarted = new Promise<void>((resolve) => {
    announceFirstRefresh = resolve;
  });
  const channel = attachLiveChannel(
    server,
    origin,
    () => ({
      runtimeId: "r",
      projectRoot: "/p",
      initialScope: "active",
      loadUi: async () => {
        loads++;
        if (loads === 2) {
          announceFirstRefresh?.();
          return await new Promise<InspectorUiSnapshot>((resolve) => {
            releaseFirstRefresh = resolve;
          });
        }
        return { ...snapshot, theme } as InspectorUiSnapshot;
      },
    }),
    () => true,
  );
  const ws = openSocket(address.port, origin);
  try {
    await ready(ws);
    const { etag } = await import("../../src/ui/snapshot-revision.ts").then(
      (m) => m.serializeUiSnapshot(snapshot),
    );
    subscribe(ws, "cap", etag);
    await message(ws);
    sessionInvalidationSignal.notify();
    await firstRefreshStarted;
    theme = "dark";
    sessionInvalidationSignal.notify();
    releaseFirstRefresh?.({
      ...snapshot,
      theme: "light",
    } as InspectorUiSnapshot);
    const delta = JSON.parse(await message(ws));
    assert.equal(delta.type, "delta");
    assert.deepEqual(Object.keys(delta.changes), ["theme"]);
    assert.equal(loads, 3);
  } finally {
    ws.close();
    await stop(server, channel);
  }
});

test("invalidation during first baseline construction triggers a fresh read", async () => {
  const { server, address, origin } = await listen();
  const initialLoad = deferred<InspectorUiSnapshot>();
  let announceInitial!: () => void;
  const initialStarted = new Promise<void>((resolve) => {
    announceInitial = resolve;
  });
  let loads = 0;
  let theme: "light" | "dark" = "light";
  const channel = attachLiveChannel(
    server,
    origin,
    () => ({
      runtimeId: "r",
      projectRoot: "/p",
      initialScope: "active",
      loadUi: async (intent) => {
        loads++;
        if (loads === 1) {
          announceInitial();
          return initialLoad.promise;
        }
        return {
          ...snapshotForRange(intent ?? null),
          theme,
        } as InspectorUiSnapshot;
      },
    }),
    () => true,
  );
  const ws = openSocket(address.port, origin);
  try {
    await ready(ws);
    subscribe(ws, "cap", "stale");
    await initialStarted;
    sessionInvalidationSignal.notify();
    theme = "dark";
    await new Promise((resolve) => setTimeout(resolve, 230));

    const firstMessage = message(ws);
    initialLoad.resolve(snapshotForRange(null));
    const first = JSON.parse(await firstMessage);
    assert.equal(first.type, "snapshot");
    assert.equal(first.snapshot.theme, "light");

    const update = JSON.parse((await messageWithin(ws)) ?? "null");
    assert.equal(update.type, "delta");
    assert.equal(update.changes.theme, "dark");
    assert.equal(loads, 2);
  } finally {
    ws.close();
    await stop(server, channel);
  }
});

test("a reconnect retires an in-flight baseline and ignores its late completion", async () => {
  const { server, address, origin } = await listen();
  const initialLoad = deferred<InspectorUiSnapshot>();
  let announceInitial!: () => void;
  const initialStarted = new Promise<void>((resolve) => {
    announceInitial = resolve;
  });
  let loads = 0;
  let theme: "light" | "dark" = "light";
  const channel = attachLiveChannel(
    server,
    origin,
    () => ({
      runtimeId: "r",
      projectRoot: "/p",
      initialScope: "active",
      loadUi: async (intent) => {
        loads++;
        if (loads === 1) {
          announceInitial();
          return initialLoad.promise;
        }
        return {
          ...snapshotForRange(intent ?? null),
          theme,
        } as InspectorUiSnapshot;
      },
    }),
    () => true,
  );
  const oldSocket = openSocket(address.port, origin);
  let current: WebSocket | undefined;
  try {
    await ready(oldSocket);
    subscribe(oldSocket, "cap", "stale");
    await initialStarted;
    const oldClosed = new Promise<void>((resolve) =>
      oldSocket.once("close", () => resolve()),
    );
    oldSocket.close();
    await oldClosed;

    sessionInvalidationSignal.notify();
    theme = "dark";
    current = openSocket(address.port, origin);
    await ready(current);
    const initialMessage = message(current);
    subscribe(current, "cap", "stale");
    await waitFor(() => loads === 2, "fresh load after reconnect", 250);
    const initial = JSON.parse(await initialMessage);
    assert.equal(initial.type, "snapshot");
    assert.equal(initial.snapshot.theme, "dark");

    theme = "light";
    const update = messageWithin(current);
    initialLoad.resolve(snapshotForRange(null));
    await new Promise<void>((resolve) => setImmediate(resolve));
    sessionInvalidationSignal.notify();
    const delta = JSON.parse((await update) ?? "null");
    assert.equal(delta.type, "delta");
    assert.equal(delta.baseEtag, initial.etag);
    assert.equal(delta.changes.theme, "light");
    assert.equal(loads, 3);
  } finally {
    oldSocket.close();
    current?.close();
    await stop(server, channel);
  }
});

test("missed pong evicts the connection, baseline, and socket slot", async (t) => {
  const { server, address, origin } = await listen();
  t.mock.timers.enable({ apis: ["setInterval"] });
  let loads = 0;
  const channel = attachLiveChannel(
    server,
    origin,
    () => ({
      runtimeId: "r",
      projectRoot: "/p",
      initialScope: "active",
      loadUi: async () => {
        loads++;
        return snapshot;
      },
    }),
    () => true,
  );
  const dead = new WebSocket(`ws://127.0.0.1:${address.port}/api/v1/ui-live`, {
    origin,
    autoPong: false,
  });
  dead.on("error", () => {});
  const pending: WebSocket[] = [];
  try {
    await ready(dead);
    const { etag } = await import("../../src/ui/snapshot-revision.ts").then(
      (m) => m.serializeUiSnapshot(snapshot),
    );
    const initial = message(dead);
    subscribe(dead, "cap", etag);
    assert.equal(JSON.parse(await initial).type, "ready");

    const ping = new Promise<void>((resolve) => dead.once("ping", resolve));
    const deadClosed = new Promise<void>((resolve) =>
      dead.once("close", () => resolve()),
    );
    const others = Array.from({ length: 7 }, () =>
      openSocket(address.port, origin),
    );
    pending.push(...others);
    await Promise.all(others.map(ready));
    t.mock.timers.tick(30_000);
    await ping;
    t.mock.timers.tick(30_000);
    const evicted = await Promise.race([
      deadClosed.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 250)),
    ]);
    assert.equal(evicted, true, "a missing pong should terminate the socket");

    const replacement = openSocket(address.port, origin);
    pending.push(replacement);
    await ready(replacement);
    for (const ws of pending) ws.close();
    await Promise.all(
      pending.map(
        (ws) =>
          new Promise<void>((resolve) =>
            ws.readyState === WebSocket.CLOSED
              ? resolve()
              : ws.once("close", () => resolve()),
          ),
      ),
    );
    sessionInvalidationSignal.notify();
    await new Promise((resolve) => setTimeout(resolve, 230));
    assert.equal(loads, 1, "unsubscribed peers must not retain report work");
  } finally {
    dead.close();
    for (const ws of pending) ws.close();
    await stop(server, channel);
  }
});

test("unauthenticated socket closes on its five-second deadline", async () => {
  const { server, address, origin } = await listen();
  const channel = attachLiveChannel(
    server,
    origin,
    () => ({
      runtimeId: "r",
      projectRoot: "/p",
      initialScope: "active",
      loadUi: async () => snapshot,
    }),
    () => true,
  );
  const ws = openSocket(address.port, origin);
  await ready(ws);
  const code = await new Promise<number>((resolve) =>
    ws.once("close", resolve),
  );
  assert.equal(code, 4401);
  await stop(server, channel);
});

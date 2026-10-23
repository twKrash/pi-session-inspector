import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import WebSocket from "ws";
import { sessionInvalidationSignal } from "../../src/ui/invalidation.ts";
import { attachLiveChannel } from "../../src/ui/live-channel.ts";
import type { RangeIntent } from "../../src/ui/range.ts";
import type { InspectorUiSnapshot } from "../../src/ui/ui-projection.ts";

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

import type { IncomingMessage, Server } from "node:http";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import { sessionInvalidationSignal } from "./invalidation.ts";
import { parseRangeQuery, type RangeIntent } from "./range.ts";
import { diffUiSnapshot, serializeUiSnapshot } from "./snapshot-revision.ts";
import type { InspectorUiSnapshot } from "./ui-projection.ts";

const MAX_SOCKETS = 8;
const AUTH_TIMEOUT_MS = 5_000;
const COALESCE_MS = 200;
const PING_MS = 30_000;

/** The only accepted peer forms for the IPv4 loopback listener. */
export function isLoopbackPeer(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::ffff:127.0.0.1";
}

type Context = {
  runtimeId: string;
  projectRoot: string;
  initialScope: string;
  loadUi(intent?: RangeIntent): Promise<InspectorUiSnapshot>;
};
type SocketState = {
  ws: WebSocket;
  context: Context;
  range: string;
  intent?: RangeIntent;
  timer: NodeJS.Timeout;
  baselineKey?: string;
  authenticated: boolean;
};

/** Attaches a bounded noServer WebSocket channel to an existing loopback HTTP owner. */
export function attachLiveChannel(
  server: Server,
  origin: string,
  getContext: () => Context,
  authorize: (capability: string) => boolean,
): { close(): Promise<void>; replaceContext(): void } {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 1024,
    perMessageDeflate: false,
  });
  const sockets = new Set<SocketState>();
  let timer: NodeJS.Timeout | undefined;
  let ping: NodeJS.Timeout | undefined;
  let closed = false;
  let refreshing = false;
  let dirty = false;
  let generation = 0;
  const baselines = new Map<
    string,
    { snapshot: InspectorUiSnapshot; etag: string }
  >();
  const loading = new Map<
    string,
    Promise<{ snapshot: InspectorUiSnapshot; etag: string }>
  >();
  const etagKeys = new Map<string, Set<string>>();
  const startPing = (): void => {
    if (ping !== undefined) return;
    ping = setInterval(() => {
      for (const state of sockets)
        if (state.ws.readyState === WebSocket.OPEN) state.ws.ping();
    }, PING_MS);
    ping.unref();
  };
  const stopPing = (): void => {
    if (ping !== undefined) clearInterval(ping);
    ping = undefined;
  };
  const scheduleRefresh = (): void => {
    if (closed || timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      void refresh();
    }, COALESCE_MS);
  };
  let unsubscribe: (() => void) | undefined;
  const subscribeInvalidation = (): void => {
    if (unsubscribe !== undefined) return;
    unsubscribe = sessionInvalidationSignal.subscribe(() => {
      if (closed || ![...sockets].some((state) => state.authenticated)) return;
      if (refreshing) {
        dirty = true;
        return;
      }
      scheduleRefresh();
    });
  };
  const clearSubscription = (): void => {
    unsubscribe?.();
    unsubscribe = undefined;
  };
  const onUpgrade = (
    req: IncomingMessage,
    socket: import("node:stream").Duplex,
    head: Buffer,
  ) => {
    const context = getContext();
    if (
      closed ||
      req.url !== "/api/v1/ui-live" ||
      req.headers.host !== `127.0.0.1:${new URL(origin).port}` ||
      !isLoopbackPeer(req.socket.remoteAddress) ||
      req.headers.origin !== origin ||
      sockets.size >= MAX_SOCKETS
    ) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const state: SocketState = {
        ws,
        context,
        range: "",
        timer: setTimeout(
          () => ws.close(4401, "authentication timeout"),
          AUTH_TIMEOUT_MS,
        ),
        authenticated: false,
      };
      sockets.add(state);
      startPing();
      ws.on("message", (raw: RawData) => {
        if (state.authenticated) {
          ws.close(4400, "unexpected message");
          return;
        }
        let message: unknown;
        try {
          message = JSON.parse(raw.toString());
        } catch {
          ws.close(4400, "invalid message");
          return;
        }
        if (message === null || typeof message !== "object") {
          ws.close(4400, "invalid message");
          return;
        }
        const input = message as Record<string, unknown>;
        if (
          input.type !== "subscribe" ||
          typeof input.capability !== "string" ||
          !authorize(input.capability) ||
          typeof input.etag !== "string" ||
          typeof input.range !== "string"
        ) {
          ws.close(4401, "unauthorized");
          return;
        }
        const parsed = parseRangeQuery(input.range);
        if (!parsed.ok || canonicalRange(parsed.intent) !== input.range) {
          ws.close(4400, "invalid range");
          return;
        }
        clearTimeout(state.timer);
        state.authenticated = true;
        subscribeInvalidation();
        state.range = canonicalRange(parsed.intent);
        state.intent = parsed.intent;
        state.baselineKey = baselineKey(state.context, parsed.intent);
        void initialize(state, input.etag);
      });
      ws.on("close", () => {
        clearTimeout(state.timer);
        sockets.delete(state);
        if (
          state.baselineKey !== undefined &&
          !hasSubscriber(state.baselineKey)
        ) {
          removeBaseline(state.baselineKey);
        }
        if (![...sockets].some((candidate) => candidate.authenticated)) {
          clearSubscription();
          clearBaseline();
        }
        if (sockets.size === 0) {
          stopPing();
          clearBaseline();
        }
      });
      ws.on("error", () => {
        ws.terminate();
      });
    });
  };
  server.on("upgrade", onUpgrade);
  function loadBaseline(
    context: Context,
    intent?: RangeIntent,
  ): Promise<{ snapshot: InspectorUiSnapshot; etag: string }> {
    const key = baselineKey(context, intent);
    const cached = baselines.get(key);
    if (cached !== undefined) return Promise.resolve(cached);
    const pending = loading.get(key);
    if (pending !== undefined) return pending;
    const requestGeneration = generation;
    const request = context
      .loadUi(intent)
      .then((snapshot) => {
        const serialized = serializeUiSnapshot(snapshot);
        const baseline = { snapshot, etag: serialized.etag };
        if (!closed && requestGeneration === generation && hasSubscriber(key)) {
          storeBaseline(key, baseline);
        }
        return baseline;
      })
      .finally(() => {
        if (loading.get(key) === request) loading.delete(key);
      });
    loading.set(key, request);
    return request;
  }
  function hasSubscriber(key: string): boolean {
    return [...sockets].some(
      (state) => state.authenticated && state.baselineKey === key,
    );
  }
  function storeBaseline(
    key: string,
    baseline: { snapshot: InspectorUiSnapshot; etag: string },
  ): void {
    removeBaseline(key);
    baselines.set(key, baseline);
    const keys = etagKeys.get(baseline.etag) ?? new Set<string>();
    keys.add(key);
    etagKeys.set(baseline.etag, keys);
  }
  function removeBaseline(key: string): void {
    const baseline = baselines.get(key);
    baselines.delete(key);
    if (baseline === undefined) return;
    const keys = etagKeys.get(baseline.etag);
    keys?.delete(key);
    if (keys?.size === 0) etagKeys.delete(baseline.etag);
  }
  async function initialize(state: SocketState, etag: string): Promise<void> {
    try {
      const baseline = await loadBaseline(state.context, state.intent);
      if (state.ws.readyState !== WebSocket.OPEN) return;
      const knownKeys = etagKeys.get(etag);
      const staleRange =
        knownKeys !== undefined &&
        [...knownKeys].some((key) => key !== state.baselineKey);
      state.ws.send(
        JSON.stringify(
          etag === baseline.etag && !staleRange
            ? { type: "ready", etag: baseline.etag }
            : {
                type: "snapshot",
                etag: baseline.etag,
                snapshot: baseline.snapshot,
              },
        ),
      );
    } catch {
      state.ws.close(1011, "unavailable");
    }
  }
  async function refresh(): Promise<void> {
    if (refreshing || closed) return;
    refreshing = true;
    dirty = false;
    try {
      const groups = new Map<string, SocketState[]>();
      for (const state of sockets) {
        if (
          !state.authenticated ||
          state.ws.readyState !== WebSocket.OPEN ||
          state.baselineKey === undefined
        )
          continue;
        const current = getContext();
        if (
          state.context.runtimeId !== current.runtimeId ||
          state.context.projectRoot !== current.projectRoot ||
          state.context.initialScope !== current.initialScope
        ) {
          state.ws.close(1012, "context replaced");
          continue;
        }
        const group = groups.get(state.baselineKey) ?? [];
        group.push(state);
        groups.set(state.baselineKey, group);
      }
      for (const [key, group] of groups) {
        const first = group[0];
        if (first === undefined) continue;
        const previous = baselines.get(key);
        removeBaseline(key);
        let next: { snapshot: InspectorUiSnapshot; etag: string };
        try {
          next = await loadBaseline(getContext(), first.intent);
        } catch {
          for (const state of group) state.ws.close(1011, "unavailable");
          continue;
        }
        if (previous === undefined || next.etag === previous.etag) continue;
        const changes = diffUiSnapshot(previous.snapshot, next.snapshot);
        if (changes !== undefined)
          for (const state of group) {
            if (state.ws.readyState === WebSocket.OPEN)
              state.ws.send(
                JSON.stringify({
                  type: "delta",
                  baseEtag: previous.etag,
                  etag: next.etag,
                  changes,
                }),
              );
          }
      }
    } finally {
      refreshing = false;
      if (dirty && !closed) {
        dirty = false;
        scheduleRefresh();
      }
    }
  }
  function clearBaseline(): void {
    baselines.clear();
    etagKeys.clear();
    dirty = false;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }
  const replaceContext = (): void => {
    generation++;
    clearSubscription();
    loading.clear();
    clearBaseline();
    for (const state of sockets) {
      clearTimeout(state.timer);
      state.ws.close(1012, "context replaced");
    }
  };
  return {
    replaceContext,
    close: async () => {
      closed = true;
      generation++;
      clearSubscription();
      stopPing();
      clearBaseline();
      loading.clear();
      server.off("upgrade", onUpgrade);
      const closing = [...sockets].map(
        (state) =>
          new Promise<void>((resolve) => {
            clearTimeout(state.timer);
            const fallback = setTimeout(() => {
              state.ws.terminate();
              resolve();
            }, 250);
            fallback.unref();
            state.ws.once("close", () => {
              clearTimeout(fallback);
              resolve();
            });
            state.ws.close(1001, "server closed");
          }),
      );
      await Promise.all(closing);
      sockets.clear();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
function baselineKey(
  context: Context,
  intent: RangeIntent | undefined,
): string {
  return JSON.stringify([
    context.runtimeId,
    context.projectRoot,
    context.initialScope,
    canonicalRange(intent),
  ]);
}
function canonicalRange(intent: RangeIntent | undefined): string {
  if (intent === undefined) return "";
  return intent.kind === "preset"
    ? `preset=${intent.preset}`
    : `from=${intent.from}&to=${intent.to}`;
}

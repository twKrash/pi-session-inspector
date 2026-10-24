import type { IncomingMessage, Server } from "node:http";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import { sessionInvalidationSignal } from "./invalidation.ts";
import { parseRangeQuery, type RangeIntent } from "./range.ts";
import { diffUiSnapshot, serializeUiSnapshot } from "./snapshot-revision.ts";
import type { InspectorUiSnapshot } from "./ui-projection.ts";

const MAX_SOCKETS = 8;
const MAX_OUTBOUND_BUFFER_BYTES = 4 * 1024 * 1024;
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
  alive: boolean;
};
type Baseline = {
  snapshot: InspectorUiSnapshot;
  etag: string;
  invalidationVersion: number;
};
type Loading = { promise: Promise<Baseline> };

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
  let activeRefresh: { key?: string } | undefined;
  let dirty = false;
  let generation = 0;
  const baselines = new Map<string, Baseline>();
  const loading = new Map<string, Loading>();
  let invalidationVersion = 0;
  const etagKeys = new Map<string, Set<string>>();
  const startPing = (): void => {
    if (ping !== undefined) return;
    ping = setInterval(() => {
      for (const state of sockets) {
        if (state.ws.readyState !== WebSocket.OPEN) continue;
        if (!state.alive) {
          state.ws.terminate();
          continue;
        }
        state.alive = false;
        state.ws.ping();
      }
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
      invalidationVersion++;
      if (activeRefresh !== undefined) {
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
        alive: true,
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
        state.baselineKey = baselineKey(
          state.context,
          parsed.intent,
          generation,
        );
        void initialize(state, input.etag);
      });
      ws.on("pong", () => {
        state.alive = true;
      });
      ws.on("close", () => {
        clearTimeout(state.timer);
        sockets.delete(state);
        if (
          state.baselineKey !== undefined &&
          !hasSubscriber(state.baselineKey)
        ) {
          retireBaseline(state.baselineKey);
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
  function sendMessage(
    state: SocketState,
    message: Record<string, unknown>,
  ): void {
    const payload = JSON.stringify(message);
    if (payload === undefined) {
      state.ws.close(1011, "unavailable");
      return;
    }
    if (
      state.ws.bufferedAmount + Buffer.byteLength(payload) >
      MAX_OUTBOUND_BUFFER_BYTES
    ) {
      state.ws.terminate();
      return;
    }
    state.ws.send(payload);
  }
  function loadBaseline(
    context: Context,
    intent?: RangeIntent,
  ): Promise<Baseline> {
    const key = baselineKey(context, intent, generation);
    const cached = baselines.get(key);
    if (cached !== undefined) return Promise.resolve(cached);
    const pending = loading.get(key);
    if (pending !== undefined) return pending.promise;
    const requestGeneration = generation;
    const requestVersion = invalidationVersion;
    let record!: Loading;
    const request = context
      .loadUi(intent)
      .then((snapshot) => {
        const serialized = serializeUiSnapshot(snapshot);
        const baseline = {
          snapshot,
          etag: serialized.etag,
          invalidationVersion: requestVersion,
        };
        if (
          !closed &&
          requestGeneration === generation &&
          loading.get(key) === record &&
          hasSubscriber(key)
        ) {
          storeBaseline(key, baseline);
        }
        return baseline;
      })
      .finally(() => {
        if (loading.get(key) === record) loading.delete(key);
      });
    record = { promise: request };
    loading.set(key, record);
    return request;
  }
  function hasSubscriber(key: string): boolean {
    return [...sockets].some(
      (state) => state.authenticated && state.baselineKey === key,
    );
  }
  function storeBaseline(key: string, baseline: Baseline): void {
    removeBaseline(key);
    baselines.set(key, baseline);
    const keys = etagKeys.get(baseline.etag) ?? new Set<string>();
    keys.add(key);
    etagKeys.set(baseline.etag, keys);
  }
  function retireBaseline(key: string): void {
    const retired = baselines.has(key) || loading.has(key);
    removeBaseline(key);
    loading.delete(key);
    if (!retired || activeRefresh?.key !== key) return;
    activeRefresh = undefined;
    dirty = false;
    if (!closed && [...sockets].some((state) => state.authenticated)) {
      scheduleRefresh();
    }
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
      sendMessage(
        state,
        etag === baseline.etag && !staleRange
          ? { type: "ready", etag: baseline.etag }
          : {
              type: "snapshot",
              etag: baseline.etag,
              snapshot: baseline.snapshot,
            },
      );
    } catch {
      state.ws.close(1011, "unavailable");
    }
  }
  async function refresh(): Promise<void> {
    if (activeRefresh !== undefined || closed) return;
    const refreshPass: { key?: string } = {};
    activeRefresh = refreshPass;
    dirty = false;
    const refreshGeneration = generation;
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
        if (
          closed ||
          activeRefresh !== refreshPass ||
          refreshGeneration !== generation
        )
          return;
        const first = group[0];
        if (first === undefined) continue;
        const recipients = group.filter(
          (state) =>
            state.authenticated &&
            state.ws.readyState === WebSocket.OPEN &&
            sockets.has(state),
        );
        if (recipients.length === 0) continue;
        refreshPass.key = key;
        const previous = baselines.get(key);
        removeBaseline(key);
        let next: Baseline;
        try {
          next = await loadBaseline(getContext(), first.intent);
        } catch {
          if (
            closed ||
            activeRefresh !== refreshPass ||
            refreshGeneration !== generation
          )
            return;
          for (const state of group) state.ws.close(1011, "unavailable");
          continue;
        }
        if (
          closed ||
          activeRefresh !== refreshPass ||
          refreshGeneration !== generation
        )
          return;
        if (next.invalidationVersion < invalidationVersion) dirty = true;
        if (previous === undefined || next.etag === previous.etag) continue;
        const changes = diffUiSnapshot(previous.snapshot, next.snapshot);
        if (changes !== undefined)
          for (const state of recipients) {
            if (state.ws.readyState === WebSocket.OPEN)
              sendMessage(state, {
                type: "delta",
                baseEtag: previous.etag,
                etag: next.etag,
                changes,
              });
          }
      }
    } finally {
      if (activeRefresh === refreshPass) {
        activeRefresh = undefined;
        if (dirty && !closed) {
          dirty = false;
          scheduleRefresh();
        }
      }
    }
  }
  function clearBaseline(): void {
    activeRefresh = undefined;
    baselines.clear();
    loading.clear();
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
  generation: number,
): string {
  return JSON.stringify([
    generation,
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

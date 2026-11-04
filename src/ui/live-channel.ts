import type { IncomingMessage, Server } from "node:http";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import { sessionInvalidationSignal } from "./invalidation.ts";
import { parseRangeQuery, type RangeIntent } from "./range.ts";
import { diffUiSnapshot, serializeUiSnapshot } from "./snapshot-revision.ts";
import type { InspectorBundle } from "./bundle.ts";
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
  loadPass?(): Promise<InspectorBundle>;
  projectPass?(
    source: InspectorBundle,
    intent?: RangeIntent,
  ): InspectorUiSnapshot;
};
type SocketState = {
  ws: WebSocket;
  context: Context;
  range: string;
  intent?: RangeIntent;
  timer: NodeJS.Timeout;
  baselineKey?: string;
  authenticated: boolean;
  initialized: boolean;
  clientEtag?: string;
  alive: boolean;
};
type Baseline = {
  snapshot: InspectorUiSnapshot;
  etag: string;
  invalidationVersion: number;
};
type Loading = { promise: Promise<Baseline> };
type Completion = { promise: Promise<void>; complete(): void };
type Initialization = Completion & { state: SocketState; cancelled: boolean };
type ActiveRefresh = Completion & { key?: string; groups?: Set<string> };
type ControllerState = {
  server: Server;
  origin: string;
  getContext: () => Context;
  authorize: (capability: string) => boolean;
  webSocketServer: WebSocketServer;
  socketSet: Set<SocketState>;
  refreshTimer: NodeJS.Timeout | undefined;
  pingTimer: NodeJS.Timeout | undefined;
  isClosed: boolean;
  refreshOperation: ActiveRefresh | undefined;
  isDirty: boolean;
  contextGeneration: number;
  baselineMap: Map<string, Baseline>;
  loadingMap: Map<string, Loading>;
  initializationMap: Map<string, Set<Initialization>>;
  invalidationSerial: number;
  etagIndex: Map<string, Set<string>>;
  invalidationUnsubscribe: (() => void) | undefined;
};

function createCompletion(): Completion {
  let complete = (): void => {};
  const promise = new Promise<void>((resolve) => {
    complete = resolve;
  });
  return { promise, complete };
}

type SubscribeMessage =
  | { ok: true; etag: string; intent: RangeIntent | undefined; range: string }
  | { ok: false; code: 4400 | 4401; reason: string };
type SubscribeInput = { etag: string; range: string };

class LiveChannelController {
  private readonly refreshCallback = (): Promise<void> => this.refresh();
  private readonly onUpgrade = (
    req: IncomingMessage,
    socket: import("node:stream").Duplex,
    head: Buffer,
  ): void => handleUpgrade(this.state, this.refreshCallback, req, socket, head);

  constructor(private readonly state: ControllerState) {
    state.server.on("upgrade", this.onUpgrade);
  }

  replaceContext(): void {
    this.state.contextGeneration++;
    clearSubscription(this.state);
    this.state.loadingMap.clear();
    clearBaseline(this.state);
    for (const state of this.state.socketSet) {
      clearTimeout(state.timer);
      state.ws.close(1012, "context replaced");
    }
  }

  async close(): Promise<void> {
    const controller = this.state;
    controller.isClosed = true;
    controller.contextGeneration++;
    clearSubscription(controller);
    stopPing(controller);
    clearBaseline(controller);
    controller.loadingMap.clear();
    controller.server.off("upgrade", this.onUpgrade);
    const closing = [...controller.socketSet].map(
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
    controller.socketSet.clear();
    await new Promise<void>((resolve) =>
      controller.webSocketServer.close(() => resolve()),
    );
  }

  async refresh(): Promise<void> {
    const controller = this.state;
    if (controller.refreshOperation !== undefined || controller.isClosed)
      return;
    const refreshPass: ActiveRefresh = createCompletion();
    controller.refreshOperation = refreshPass;
    controller.isDirty = false;
    const refreshGeneration = controller.contextGeneration;
    try {
      const groups = this.captureRefreshGroups();
      const context = controller.getContext();
      const loadPass = context.loadPass;
      const projectPass = context.projectPass;
      if (loadPass !== undefined && projectPass !== undefined) {
        await this.refreshShared(
          refreshPass,
          refreshGeneration,
          loadPass,
          projectPass,
          groups,
        );
        return;
      }
      await this.refreshLegacy(refreshPass, refreshGeneration, groups);
    } finally {
      if (controller.refreshOperation === refreshPass) {
        controller.refreshOperation = undefined;
        refreshPass.complete();
        if (controller.isDirty && !controller.isClosed) {
          controller.isDirty = false;
          scheduleChannelRefresh(controller, () => this.refresh());
        }
      }
    }
  }

  private async refreshShared(
    pass: ActiveRefresh,
    generation: number,
    loadPass: NonNullable<Context["loadPass"]>,
    projectPass: NonNullable<Context["projectPass"]>,
    groups: Map<string, SocketState[]>,
  ): Promise<void> {
    const prepared = await this.prepareSharedRefresh(pass, generation, groups);
    if (prepared === undefined) return;
    await this.loadAndPublishShared(
      pass,
      generation,
      loadPass,
      projectPass,
      prepared,
    );
  }

  private async prepareSharedRefresh(
    pass: ActiveRefresh,
    generation: number,
    groups: Map<string, SocketState[]>,
  ): Promise<
    | {
        captured: Map<string, SocketState[]>;
        previous: Map<string, Baseline | undefined>;
        requestVersion: number;
      }
    | undefined
  > {
    const controller = this.state;
    const captured = new Map(
      [...groups].map(([key, group]) => [key, [...group]]),
    );
    const keys = [...captured.keys()];
    pass.groups = new Set(keys);
    await Promise.all(
      keys.flatMap((key) =>
        [...(controller.initializationMap.get(key) ?? [])].map(
          (operation) => operation.promise,
        ),
      ),
    );
    if (!this.isCurrent(pass, generation)) return undefined;
    return {
      captured,
      previous: new Map(
        keys.map((key) => [key, controller.baselineMap.get(key)]),
      ),
      requestVersion: controller.invalidationSerial,
    };
  }

  private async loadAndPublishShared(
    pass: ActiveRefresh,
    generation: number,
    loadPass: NonNullable<Context["loadPass"]>,
    projectPass: NonNullable<Context["projectPass"]>,
    prepared: {
      captured: Map<string, SocketState[]>;
      previous: Map<string, Baseline | undefined>;
      requestVersion: number;
    },
  ): Promise<void> {
    try {
      const source = await loadPass();
      if (!this.isCurrent(pass, generation)) return;
      this.publishCapturedRanges(pass, projectPass, source, prepared);
    } catch {
      if (this.isCurrent(pass, generation))
        this.failSharedRanges(pass, prepared.captured);
    }
  }

  private publishCapturedRanges(
    pass: ActiveRefresh,
    projectPass: NonNullable<Context["projectPass"]>,
    source: InspectorBundle,
    prepared: {
      captured: Map<string, SocketState[]>;
      previous: Map<string, Baseline | undefined>;
      requestVersion: number;
    },
  ): void {
    for (const [key, group] of prepared.captured) {
      if (!pass.groups?.has(key)) continue;
      this.publishSharedRange(
        pass,
        projectPass,
        source,
        key,
        group,
        prepared.previous.get(key),
        prepared.requestVersion,
      );
    }
  }

  private publishSharedRange(
    pass: ActiveRefresh,
    projectPass: NonNullable<Context["projectPass"]>,
    source: InspectorBundle,
    key: string,
    group: SocketState[],
    previous: Baseline | undefined,
    requestVersion: number,
  ): void {
    try {
      const first = group.find(
        (state) => state.ws.readyState === WebSocket.OPEN,
      );
      if (first === undefined) {
        this.removeSharedBaselineForUncapturedSubscribers(key);
        return;
      }
      const snapshot = projectPass(source, first.intent);
      const next = this.createBaseline(snapshot, requestVersion);
      const canPublish = this.canPublishSharedRange(pass, key, group);
      if (!canPublish) return;
      this.storeSharedBaseline(key, requestVersion, next);
      if (previous === undefined) return;
      const changes =
        next.etag === previous.etag
          ? undefined
          : diffUiSnapshot(previous.snapshot, snapshot);
      this.publishSharedRangeUpdate(key, group, next, previous, changes);
    } catch {
      this.failSharedRange(key, group);
    }
  }

  private createBaseline(
    snapshot: InspectorUiSnapshot,
    invalidationVersion: number,
  ): Baseline {
    return {
      snapshot,
      etag: serializeUiSnapshot(snapshot).etag,
      invalidationVersion,
    };
  }

  private removeSharedBaselineForUncapturedSubscribers(key: string): void {
    if (hasSubscriber(this.state, key)) removeBaseline(this.state, key);
  }

  private canPublishSharedRange(
    pass: ActiveRefresh,
    key: string,
    group: SocketState[],
  ): boolean {
    return (
      pass.groups?.has(key) === true &&
      group.some(
        (state) =>
          state.authenticated && state.ws.readyState === WebSocket.OPEN,
      )
    );
  }

  private storeSharedBaseline(
    key: string,
    requestVersion: number,
    next: Baseline,
  ): void {
    const controller = this.state;
    storeBaseline(controller, key, next);
    if (requestVersion < controller.invalidationSerial)
      controller.isDirty = true;
  }

  private failSharedRange(key: string, group: SocketState[]): void {
    removeBaseline(this.state, key);
    for (const state of group)
      if (state.ws.readyState === WebSocket.OPEN)
        state.ws.close(1011, "unavailable");
  }

  private publishSharedRangeUpdate(
    key: string,
    group: SocketState[],
    next: Baseline,
    previous: Baseline,
    changes: ReturnType<typeof diffUiSnapshot> | undefined,
  ): void {
    for (const state of group) {
      if (
        !state.authenticated ||
        !state.initialized ||
        state.baselineKey !== key ||
        state.ws.readyState !== WebSocket.OPEN ||
        state.clientEtag === next.etag
      )
        continue;
      if (changes !== undefined && state.clientEtag === previous.etag)
        sendMessage(state, {
          type: "delta",
          baseEtag: previous.etag,
          etag: next.etag,
          changes,
        });
      else
        sendMessage(state, {
          type: "snapshot",
          etag: next.etag,
          snapshot: next.snapshot,
        });
      state.clientEtag = next.etag;
    }
  }

  private failSharedRanges(
    pass: ActiveRefresh,
    captured: Map<string, SocketState[]>,
  ): void {
    const controller = this.state;
    for (const [key, group] of captured) {
      if (!pass.groups?.has(key)) continue;
      removeBaseline(controller, key);
      for (const state of group)
        if (state.ws.readyState === WebSocket.OPEN)
          state.ws.close(1011, "unavailable");
    }
  }

  private async refreshLegacyRange(
    pass: ActiveRefresh,
    generation: number,
    key: string,
    group: SocketState[],
    first: SocketState,
  ): Promise<void> {
    const controller = this.state;
    pass.key = key;
    const previous = controller.baselineMap.get(key);
    removeBaseline(controller, key);
    let next: Baseline;
    try {
      next = await loadBaseline(
        controller,
        controller.getContext(),
        first.intent,
      );
    } catch {
      if (!this.isCurrent(pass, generation)) return;
      for (const state of group) state.ws.close(1011, "unavailable");
      return;
    }
    if (!this.isCurrent(pass, generation)) return;
    if (next.invalidationVersion < controller.invalidationSerial)
      controller.isDirty = true;
    if (previous === undefined) return;
    const changes =
      next.etag === previous.etag
        ? undefined
        : diffUiSnapshot(previous.snapshot, next.snapshot);
    this.publishLegacyRange(key, next, previous, changes);
  }

  private async refreshLegacy(
    pass: ActiveRefresh,
    generation: number,
    groups: Map<string, SocketState[]>,
  ): Promise<void> {
    for (const [key, group] of groups) {
      if (!this.isCurrent(pass, generation)) return;
      const first = group[0];
      if (first === undefined) continue;
      await this.refreshLegacyRange(pass, generation, key, group, first);
    }
  }

  private publishLegacyRange(
    key: string,
    next: Baseline,
    previous: Baseline,
    changes: ReturnType<typeof diffUiSnapshot> | undefined,
  ): void {
    for (const state of this.state.socketSet) {
      if (
        !state.authenticated ||
        !state.initialized ||
        state.baselineKey !== key ||
        state.ws.readyState !== WebSocket.OPEN
      )
        continue;
      if (state.clientEtag === next.etag) continue;
      if (changes !== undefined && state.clientEtag === previous.etag)
        sendMessage(state, {
          type: "delta",
          baseEtag: previous.etag,
          etag: next.etag,
          changes,
        });
      else
        sendMessage(state, {
          type: "snapshot",
          etag: next.etag,
          snapshot: next.snapshot,
        });
      state.clientEtag = next.etag;
    }
  }

  private captureRefreshGroups(): Map<string, SocketState[]> {
    const controller = this.state;
    const groups = new Map<string, SocketState[]>();
    for (const state of controller.socketSet) {
      if (
        !state.authenticated ||
        state.ws.readyState !== WebSocket.OPEN ||
        state.baselineKey === undefined
      )
        continue;
      const current = controller.getContext();
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
    return groups;
  }

  private isCurrent(pass: ActiveRefresh, generation: number): boolean {
    const controller = this.state;
    return (
      !controller.isClosed &&
      controller.refreshOperation === pass &&
      generation === controller.contextGeneration
    );
  }
}

function parseMessage(raw: RawData): Record<string, unknown> | undefined {
  try {
    const message: unknown = JSON.parse(raw.toString());
    return message !== null && typeof message === "object"
      ? (message as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function parseSubscribeInput(
  input: Record<string, unknown>,
  authorize: (capability: string) => boolean,
): SubscribeInput | undefined {
  if (
    input.type !== "subscribe" ||
    typeof input.capability !== "string" ||
    !authorize(input.capability) ||
    typeof input.etag !== "string" ||
    typeof input.range !== "string"
  )
    return undefined;
  return { etag: input.etag, range: input.range };
}

function parseSubscribeMessage(
  raw: RawData,
  authorize: (capability: string) => boolean,
): SubscribeMessage {
  const message = parseMessage(raw);
  if (message === undefined)
    return { ok: false, code: 4400, reason: "invalid message" };
  const input = parseSubscribeInput(message, authorize);
  if (input === undefined)
    return { ok: false, code: 4401, reason: "unauthorized" };
  const parsed = parseRangeQuery(input.range);
  if (!parsed.ok || canonicalRange(parsed.intent) !== input.range)
    return { ok: false, code: 4400, reason: "invalid range" };
  return {
    ok: true,
    etag: input.etag,
    intent: parsed.intent,
    range: canonicalRange(parsed.intent),
  };
}

function sendMessage(
  state: SocketState,
  message: Record<string, unknown>,
): void {
  let payload = JSON.stringify(message);
  if (payload === undefined) {
    state.ws.close(1011, "unavailable");
    return;
  }
  // A message larger than the whole budget is not a slow consumer: a large
  // project's DTO can exceed it on every send, and terminating then makes the
  // client reconnect into the same message forever. Name the revision instead
  // and let the client read it over HTTP, which has no frame budget.
  let bytes = Buffer.byteLength(payload);
  if (bytes > MAX_OUTBOUND_BUFFER_BYTES) {
    payload = JSON.stringify({
      type: "resync",
      ...(typeof message.etag === "string" ? { etag: message.etag } : {}),
    });
    bytes = Buffer.byteLength(payload);
  }
  if (state.ws.bufferedAmount + bytes > MAX_OUTBOUND_BUFFER_BYTES) {
    state.ws.terminate();
    return;
  }
  state.ws.send(payload);
}

function startPing(controller: ControllerState): void {
  if (controller.pingTimer !== undefined) return;
  controller.pingTimer = setInterval(() => {
    for (const state of controller.socketSet) {
      if (state.ws.readyState !== WebSocket.OPEN) continue;
      if (!state.alive) {
        state.ws.terminate();
        continue;
      }
      state.alive = false;
      state.ws.ping();
    }
  }, PING_MS);
  controller.pingTimer.unref();
}

function stopPing(controller: ControllerState): void {
  if (controller.pingTimer !== undefined) clearInterval(controller.pingTimer);
  controller.pingTimer = undefined;
}

function scheduleChannelRefresh(
  controller: ControllerState,
  refresh: () => Promise<void>,
): void {
  if (controller.isClosed || controller.refreshTimer !== undefined) return;
  controller.refreshTimer = setTimeout(() => {
    controller.refreshTimer = undefined;
    void refresh();
  }, COALESCE_MS);
}

function subscribeInvalidation(
  controller: ControllerState,
  refresh: () => Promise<void>,
): void {
  if (controller.invalidationUnsubscribe !== undefined) return;
  controller.invalidationUnsubscribe = sessionInvalidationSignal.subscribe(
    (event) => {
      if (
        controller.isClosed ||
        ![...controller.socketSet].some(
          (state) =>
            state.authenticated && state.context.runtimeId === event.runtimeId,
        )
      )
        return;
      controller.invalidationSerial++;
      if (controller.refreshOperation !== undefined) {
        controller.isDirty = true;
        return;
      }
      scheduleChannelRefresh(controller, refresh);
    },
  );
}

function clearSubscription(controller: ControllerState): void {
  controller.invalidationUnsubscribe?.();
  controller.invalidationUnsubscribe = undefined;
}

function hasSubscriber(controller: ControllerState, key: string): boolean {
  return [...controller.socketSet].some(
    (state) => state.authenticated && state.baselineKey === key,
  );
}

function removeBaseline(controller: ControllerState, key: string): void {
  const baseline = controller.baselineMap.get(key);
  controller.baselineMap.delete(key);
  if (baseline === undefined) return;
  const keys = controller.etagIndex.get(baseline.etag);
  keys?.delete(key);
  if (keys?.size === 0) controller.etagIndex.delete(baseline.etag);
}

function storeBaseline(
  controller: ControllerState,
  key: string,
  baseline: Baseline,
): void {
  removeBaseline(controller, key);
  controller.baselineMap.set(key, baseline);
  const keys = controller.etagIndex.get(baseline.etag) ?? new Set<string>();
  keys.add(key);
  controller.etagIndex.set(baseline.etag, keys);
}

function loadBaseline(
  controller: ControllerState,
  context: Context,
  intent?: RangeIntent,
): Promise<Baseline> {
  const key = baselineKey(context, intent, controller.contextGeneration);
  const cached = controller.baselineMap.get(key);
  if (cached !== undefined) return Promise.resolve(cached);
  const pending = controller.loadingMap.get(key);
  if (pending !== undefined) return pending.promise;
  const requestGeneration = controller.contextGeneration;
  const requestVersion = controller.invalidationSerial;
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
        !controller.isClosed &&
        requestGeneration === controller.contextGeneration &&
        controller.loadingMap.get(key) === record &&
        hasSubscriber(controller, key)
      ) {
        storeBaseline(controller, key, baseline);
      }
      return baseline;
    })
    .finally(() => {
      if (controller.loadingMap.get(key) === record)
        controller.loadingMap.delete(key);
    });
  record = { promise: request };
  controller.loadingMap.set(key, record);
  return request;
}

function finishInitialization(
  controller: ControllerState,
  key: string,
  operations: Set<Initialization>,
  operation: Initialization,
): void {
  operation.complete();
  operations.delete(operation);
  if (
    operations.size === 0 &&
    controller.initializationMap.get(key) === operations
  ) {
    controller.initializationMap.delete(key);
  }
}

function cancelInitialization(
  controller: ControllerState,
  state: SocketState,
): void {
  for (const [key, operations] of controller.initializationMap) {
    const operation = [...operations].find(
      (candidate) => candidate.state === state,
    );
    if (operation === undefined) continue;
    operation.cancelled = true;
    finishInitialization(controller, key, operations, operation);
    return;
  }
}

function abandonInitializations(
  controller: ControllerState,
  key: string,
): void {
  const operations = controller.initializationMap.get(key);
  if (operations === undefined) return;
  controller.initializationMap.delete(key);
  for (const operation of operations) {
    operation.cancelled = true;
    operation.complete();
  }
}

function clearBaseline(controller: ControllerState): void {
  controller.refreshOperation?.complete();
  controller.refreshOperation = undefined;
  for (const key of controller.initializationMap.keys())
    abandonInitializations(controller, key);
  controller.baselineMap.clear();
  controller.loadingMap.clear();
  controller.etagIndex.clear();
  controller.isDirty = false;
  if (controller.refreshTimer !== undefined)
    clearTimeout(controller.refreshTimer);
  controller.refreshTimer = undefined;
}

function scheduleRefreshForAuthenticated(
  controller: ControllerState,
  refresh: () => Promise<void>,
): void {
  if (
    !controller.isClosed &&
    [...controller.socketSet].some((state) => state.authenticated)
  ) {
    scheduleChannelRefresh(controller, refresh);
  }
}

function retireBaseline(
  controller: ControllerState,
  key: string,
  refresh: () => Promise<void>,
): void {
  const retired =
    controller.baselineMap.has(key) || controller.loadingMap.has(key);
  removeBaseline(controller, key);
  controller.loadingMap.delete(key);
  abandonInitializations(controller, key);
  if (controller.refreshOperation === undefined) return;
  const groups = controller.refreshOperation.groups;
  if (groups?.delete(key)) {
    if (groups.size === 0) {
      const abandonedPass = controller.refreshOperation;
      controller.refreshOperation = undefined;
      controller.isDirty = false;
      abandonedPass.complete();
      scheduleRefreshForAuthenticated(controller, refresh);
    }
    return;
  }
  if (!retired || controller.refreshOperation.key !== key) return;
  controller.refreshOperation = undefined;
  controller.isDirty = false;
  scheduleRefreshForAuthenticated(controller, refresh);
}

function initialize(
  controller: ControllerState,
  state: SocketState,
  etag: string,
  refresh: () => Promise<void>,
): void {
  const key = state.baselineKey;
  if (key === undefined) return;
  const requestGeneration = controller.contextGeneration;
  const hasSharedPass =
    state.context.loadPass !== undefined &&
    state.context.projectPass !== undefined;
  const pass = controller.refreshOperation;
  const waitForPass = pass?.groups?.has(key) ? pass.promise : undefined;
  const start = () =>
    startInitialization(
      controller,
      state,
      key,
      etag,
      requestGeneration,
      hasSharedPass,
      refresh,
    );
  if (waitForPass === undefined) start();
  else void waitForPass.then(start);
}

function startInitialization(
  controller: ControllerState,
  state: SocketState,
  key: string,
  etag: string,
  requestGeneration: number,
  hasSharedPass: boolean,
  refresh: () => Promise<void>,
): void {
  if (
    controller.isClosed ||
    requestGeneration !== controller.contextGeneration ||
    state.baselineKey !== key ||
    state.ws.readyState !== WebSocket.OPEN
  )
    return;
  const operation: Initialization = {
    ...createCompletion(),
    state,
    cancelled: false,
  };
  const operations =
    controller.initializationMap.get(key) ?? new Set<Initialization>();
  operations.add(operation);
  controller.initializationMap.set(key, operations);
  void runInitialization(
    controller,
    state,
    key,
    etag,
    requestGeneration,
    hasSharedPass,
    refresh,
    operations,
    operation,
  );
}

async function runInitialization(
  controller: ControllerState,
  state: SocketState,
  key: string,
  etag: string,
  requestGeneration: number,
  hasSharedPass: boolean,
  refresh: () => Promise<void>,
  operations: Set<Initialization>,
  operation: Initialization,
): Promise<void> {
  try {
    const existedBeforeInitialize =
      controller.baselineMap.has(key) || controller.loadingMap.has(key);
    let baseline = await loadBaseline(controller, state.context, state.intent);
    if (operation.cancelled) return;
    if (
      existedBeforeInitialize &&
      etag !== baseline.etag &&
      controller.baselineMap.get(key) === baseline
    ) {
      const revalidated = await revalidateInitialization(
        controller,
        state,
        key,
        requestGeneration,
        hasSharedPass,
        refresh,
        baseline,
        operation,
      );
      if (revalidated === undefined) return;
      baseline = revalidated;
    }
    sendInitializationResult(controller, state, key, etag, baseline);
  } catch {
    state.ws.close(1011, "unavailable");
  } finally {
    finishInitialization(controller, key, operations, operation);
  }
}

async function revalidateInitialization(
  controller: ControllerState,
  state: SocketState,
  key: string,
  requestGeneration: number,
  hasSharedPass: boolean,
  refresh: () => Promise<void>,
  previousBaseline: Baseline,
  operation: Initialization,
): Promise<Baseline | undefined> {
  const requestVersion = controller.invalidationSerial;
  const freshSnapshot = await state.context.loadUi(state.intent);
  if (operation.cancelled) return undefined;
  scheduleInvalidationRefresh(
    controller,
    hasSharedPass,
    requestVersion,
    refresh,
  );
  if (
    controller.isClosed ||
    requestGeneration !== controller.contextGeneration ||
    !hasSubscriber(controller, key)
  )
    return undefined;
  return resolveRevalidatedBaseline(
    controller,
    state,
    key,
    previousBaseline,
    freshSnapshot,
    hasSharedPass,
    requestVersion,
  );
}

function scheduleInvalidationRefresh(
  controller: ControllerState,
  hasSharedPass: boolean,
  requestVersion: number,
  refresh: () => Promise<void>,
): void {
  if (!hasSharedPass || requestVersion >= controller.invalidationSerial) return;
  if (controller.refreshOperation === undefined)
    scheduleChannelRefresh(controller, refresh);
  else controller.isDirty = true;
}

async function resolveRevalidatedBaseline(
  controller: ControllerState,
  state: SocketState,
  key: string,
  previousBaseline: Baseline,
  freshSnapshot: InspectorUiSnapshot,
  hasSharedPass: boolean,
  requestVersion: number,
): Promise<Baseline> {
  let baseline = previousBaseline;
  let currentBaseline = controller.baselineMap.get(key);
  if (currentBaseline === undefined) {
    baseline = await loadBaseline(controller, state.context, state.intent);
    currentBaseline = controller.baselineMap.get(key);
  } else if (currentBaseline !== previousBaseline) {
    baseline = currentBaseline;
  } else {
    baseline = {
      snapshot: freshSnapshot,
      etag: serializeUiSnapshot(freshSnapshot).etag,
      invalidationVersion: hasSharedPass
        ? requestVersion
        : controller.invalidationSerial,
    };
  }
  if (currentBaseline === previousBaseline) {
    storeBaseline(controller, key, baseline);
    publishBaselineToSubscribers(controller, state, key, baseline);
  }
  return baseline;
}

function publishBaselineToSubscribers(
  controller: ControllerState,
  state: SocketState,
  key: string,
  baseline: Baseline,
): void {
  for (const subscriber of controller.socketSet) {
    if (
      subscriber === state ||
      subscriber.baselineKey !== key ||
      !subscriber.authenticated ||
      subscriber.ws.readyState !== WebSocket.OPEN
    )
      continue;
    sendMessage(subscriber, {
      type: "snapshot",
      etag: baseline.etag,
      snapshot: baseline.snapshot,
    });
    subscriber.clientEtag = baseline.etag;
  }
}

function sendInitializationResult(
  controller: ControllerState,
  state: SocketState,
  key: string,
  etag: string,
  baseline: Baseline,
): void {
  if (state.ws.readyState !== WebSocket.OPEN) return;
  const knownKeys = controller.etagIndex.get(etag);
  const staleRange =
    knownKeys !== undefined &&
    [...knownKeys].some((candidate) => candidate !== key);
  state.initialized = true;
  state.clientEtag = baseline.etag;
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
}

function expectedUpgradeHost(origin: string): string | undefined {
  try {
    return `127.0.0.1:${new URL(origin).port}`;
  } catch {
    return undefined;
  }
}

function isAllowedUpgrade(
  controller: ControllerState,
  req: IncomingMessage,
): boolean {
  const host = expectedUpgradeHost(controller.origin);
  return (
    host !== undefined &&
    !controller.isClosed &&
    req.url === "/api/v1/ui-live" &&
    req.headers.host === host &&
    isLoopbackPeer(req.socket.remoteAddress) &&
    req.headers.origin === controller.origin &&
    controller.socketSet.size < MAX_SOCKETS
  );
}

function handleSocketMessage(
  controller: ControllerState,
  refresh: () => Promise<void>,
  state: SocketState,
  raw: RawData,
): void {
  if (state.authenticated) {
    state.ws.close(4400, "unexpected message");
    return;
  }
  const message = parseSubscribeMessage(raw, controller.authorize);
  if (!message.ok) {
    state.ws.close(message.code, message.reason);
    return;
  }
  clearTimeout(state.timer);
  state.authenticated = true;
  subscribeInvalidation(controller, refresh);
  state.range = message.range;
  state.intent = message.intent;
  state.clientEtag = message.etag;
  state.baselineKey = baselineKey(
    state.context,
    message.intent,
    controller.contextGeneration,
  );
  void initialize(controller, state, message.etag, refresh);
}

function handleSocketClose(
  controller: ControllerState,
  refresh: () => Promise<void>,
  state: SocketState,
): void {
  clearTimeout(state.timer);
  controller.socketSet.delete(state);
  cancelInitialization(controller, state);
  if (
    state.baselineKey !== undefined &&
    !hasSubscriber(controller, state.baselineKey)
  ) {
    retireBaseline(controller, state.baselineKey, refresh);
  }
  if (![...controller.socketSet].some((candidate) => candidate.authenticated)) {
    clearSubscription(controller);
    clearBaseline(controller);
  }
  if (controller.socketSet.size === 0) {
    stopPing(controller);
    clearBaseline(controller);
  }
}

function registerSocket(
  controller: ControllerState,
  refresh: () => Promise<void>,
  context: Context,
  ws: import("ws").WebSocket,
): void {
  const state: SocketState = {
    ws,
    context,
    range: "",
    timer: setTimeout(
      () => ws.close(4401, "authentication timeout"),
      AUTH_TIMEOUT_MS,
    ),
    authenticated: false,
    initialized: false,
    alive: true,
  };
  controller.socketSet.add(state);
  startPing(controller);
  ws.on("message", (raw: RawData) =>
    handleSocketMessage(controller, refresh, state, raw),
  );
  ws.on("pong", () => {
    state.alive = true;
  });
  ws.on("close", () => handleSocketClose(controller, refresh, state));
  ws.on("error", () => {
    ws.terminate();
  });
}

function handleUpgrade(
  controller: ControllerState,
  refresh: () => Promise<void>,
  req: IncomingMessage,
  socket: import("node:stream").Duplex,
  head: Buffer,
): void {
  if (!isAllowedUpgrade(controller, req)) {
    socket.destroy();
    return;
  }
  const context = controller.getContext();
  controller.webSocketServer.handleUpgrade(req, socket, head, (ws) =>
    registerSocket(controller, refresh, context, ws),
  );
}

/** Attaches a bounded noServer WebSocket channel to an existing loopback HTTP owner. */
export function attachLiveChannel(
  server: Server,
  origin: string,
  getContext: () => Context,
  authorize: (capability: string) => boolean,
): { close(): Promise<void>; replaceContext(): void } {
  const controller: ControllerState = {
    server,
    origin,
    getContext,
    authorize,
    webSocketServer: new WebSocketServer({
      noServer: true,
      maxPayload: 1024,
      perMessageDeflate: false,
    }),
    socketSet: new Set(),
    refreshTimer: undefined,
    pingTimer: undefined,
    isClosed: false,
    refreshOperation: undefined,
    isDirty: false,
    contextGeneration: 0,
    baselineMap: new Map(),
    loadingMap: new Map(),
    initializationMap: new Map(),
    invalidationSerial: 0,
    etagIndex: new Map(),
    invalidationUnsubscribe: undefined,
  };
  const liveChannelController = new LiveChannelController(controller);
  return {
    replaceContext: () => liveChannelController.replaceContext(),
    close: () => liveChannelController.close(),
  };
}
function baselineKey(
  context: Context,
  intent: RangeIntent | undefined,
  keyGeneration: number,
): string {
  return JSON.stringify([
    keyGeneration,
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

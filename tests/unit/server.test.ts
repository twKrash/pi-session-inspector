import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { after, test } from "node:test";
import WebSocket from "ws";

import type { SessionReport } from "../../src/core/reports.ts";
import { createUiCapabilities } from "../../src/ui/capabilities.ts";
import type { RangeIntent } from "../../src/ui/range.ts";
import {
  closeInspectorServer,
  getInspectorServer,
  type InspectorServer,
  type InspectorServerContext,
  isLoopbackPeer,
} from "../../src/ui/server.ts";
import { serializeUiSnapshot } from "../../src/ui/snapshot-revision.ts";
import type {
  GlobalReportProjection,
  InspectorUiSnapshot,
} from "../../src/ui/ui-projection.ts";
import { type ShellTheme, WEB_ASSETS } from "../../src/ui/web-assets.ts";

/**
 * The loopback server boundary (ADR 0018 and the spec's Pre-M8.4 HTTP and
 * security contract). These tests hit the real listener with `node:http` and
 * pin what the network sees: the bootstrap URL, known asset bytes and headers,
 * the exact Host/peer/Origin/bearer boundary, strict range acceptance, the
 * atomic session resource, bounded Problem Details, bounded diagnostics, and
 * explicit singleton close/rotation. Report semantics stay in L2 and are only
 * observed here as the callbacks' own DTOs.
 */

// ---------------------------------------------------------------------------
// Fixtures and network helpers
// ---------------------------------------------------------------------------

/** A marker DTO: the server must serialize exactly what the callback returned. */
const SNAPSHOT = {
  kind: "ui",
  marker: "SNAPSHOT_DTO",
  current: { active: {}, tree: {} },
} as unknown as InspectorUiSnapshot;

const GLOBAL = {
  availability: "available",
  marker: "GLOBAL_DTO",
} as unknown as GlobalReportProjection;

const SESSION_ID = "01a09c7b-0000-4000-8000-000000000000";

const SESSION = {
  sessionId: SESSION_ID,
  marker: "SESSION_DTO",
} as unknown as SessionReport;

type Calls = {
  ui: (RangeIntent | undefined)[];
  sessions: string[];
  global: (RangeIntent | undefined)[];
};

/** The counting context: every callback records its bounded input. */
function fixtureContext(theme: ShellTheme = "light"): {
  context: InspectorServerContext;
  calls: Calls;
} {
  const calls: Calls = { ui: [], sessions: [], global: [] };
  return {
    calls,
    context: {
      theme,
      runtimeId: "runtime-a",
      projectRoot: "/project-a",
      loadUi: async (intent) => {
        calls.ui.push(intent);
        return SNAPSHOT;
      },
      loadSession: async (sessionId) => {
        calls.sessions.push(sessionId);
        return sessionId === SESSION_ID ? SESSION : undefined;
      },
      loadGlobal: async (intent) => {
        calls.global.push(intent);
        return GLOBAL;
      },
    },
  };
}

type TestResponse = {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
};

type CallOptions = {
  method?: string;
  headers?: Record<string, string>;
  setHost?: boolean;
};

/** One request against the returned origin, with a fresh socket every time. */
function call(
  server: InspectorServer,
  path: string,
  options: CallOptions = {},
): Promise<TestResponse> {
  const { hostname, port } = new URL(server.origin);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname,
        port,
        path,
        method: options.method ?? "GET",
        headers: options.headers ?? {},
        agent: false,
        ...(options.setHost === undefined ? {} : { setHost: options.setHost }),
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    request.on("error", reject);
    request.end();
  });
}

/**
 * One raw HTTP/1.1 exchange over `node:net`. `http.request` merges repeated
 * headers before a raw socket sees them, so this is the only way to observe
 * what Node's parser does with a duplicate `Host`.
 */
function rawExchange(
  server: InspectorServer,
  lines: readonly string[],
): Promise<string> {
  const { hostname, port } = new URL(server.origin);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = net.connect({ host: hostname, port: Number(port) });
    socket.on("connect", () => socket.write(`${lines.join("\r\n")}\r\n\r\n`));
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    socket.on("error", reject);
  });
}

const BOOTSTRAP_URL =
  /^http:\/\/127\.0\.0\.1:(\d+)\/#token=([A-Za-z0-9_-]{43})$/;

function bootstrapToken(server: InspectorServer): string {
  const url = server.bootstrapUrl();
  const match = BOOTSTRAP_URL.exec(url);
  assert.ok(match !== null, `bootstrap URL shape: ${url}`);
  assert.equal(Number(match[1]), server.port);
  return match[2];
}

async function bearer(
  server: InspectorServer,
): Promise<Record<string, string>> {
  const token = bootstrapToken(server);
  const response = await call(server, "/api/v1/ui-session", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 200);
  return {
    Authorization: `Bearer ${(JSON.parse(response.body) as { capability: string }).capability}`,
  };
}

/** A same-length, different token. */
function wrongToken(token: string): string {
  return `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
}

const PROBLEM_KEYS = [
  "code",
  "correlationId",
  "detail",
  "retryable",
  "status",
  "title",
  "type",
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Every failure is one sealed Problem Details body: fixed safe fields, an
 * opaque correlation id, the shared security headers, no CORS, no redirect,
 * and none of the rejected input echoed back.
 */
function assertProblem(
  response: TestResponse,
  status: number,
  code: string,
  forbidden: readonly string[] = [],
): Record<string, unknown> {
  assert.equal(response.status, status);
  assert.equal(response.headers["content-type"], "application/problem+json");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["cache-control"], "no-store, no-cache");
  assert.equal(response.headers["referrer-policy"], "no-referrer");
  assert.equal(response.headers["access-control-allow-origin"], undefined);
  assert.equal(response.headers["access-control-allow-credentials"], undefined);
  assert.equal(response.headers.location, undefined);
  assert.equal(response.headers["set-cookie"], undefined);
  const body = JSON.parse(response.body) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), PROBLEM_KEYS);
  assert.equal(body.type, "about:blank");
  assert.equal(body.status, status);
  assert.equal(body.code, code);
  assert.equal(typeof body.title, "string");
  assert.equal(typeof body.detail, "string");
  assert.equal(typeof body.retryable, "boolean");
  assert.match(String(body.correlationId), UUID);
  const headerText = JSON.stringify(response.headers);
  for (const secret of forbidden) {
    if (secret === "") continue;
    assert.equal(
      response.body.includes(secret),
      false,
      `problem echoed ${secret}`,
    );
    assert.equal(
      headerText.includes(secret),
      false,
      `problem header echoed ${secret}`,
    );
  }
  return body;
}

const serverCsp = (port: number) =>
  `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ws://127.0.0.1:${port}; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

const ASSETS: readonly {
  path: string;
  body: string;
  contentType: string;
}[] = [
  {
    path: "/",
    body: WEB_ASSETS.shell,
    contentType: "text/html; charset=utf-8",
  },
  {
    path: "/style.css",
    body: WEB_ASSETS.style,
    contentType: "text/css; charset=utf-8",
  },
  {
    path: "/client.js",
    body: WEB_ASSETS.client,
    contentType: "text/javascript; charset=utf-8",
  },
];

after(async () => {
  await closeInspectorServer();
});

test("replacement serialized behind an in-flight request cannot orphan a later listener", async () => {
  const entered = deferred<void>();
  const release = deferred<void>();
  const ownerA = fixtureContext().context;
  ownerA.loadUi = async () => {
    entered.resolve();
    await release.promise;
    return SNAPSHOT;
  };
  let serverA: InspectorServer | undefined;
  let replacementB: Promise<InspectorServer> | undefined;
  let replacementC: Promise<InspectorServer> | undefined;
  let observeReplacementB:
    | Promise<PromiseSettledResult<InspectorServer>[]>
    | undefined;
  let observeReplacementC:
    | Promise<PromiseSettledResult<InspectorServer>[]>
    | undefined;
  let serverB: InspectorServer | undefined;
  let serverC: InspectorServer | undefined;
  let cleanupMode = false;
  const capturedServers = new Set<InspectorServer>();
  let requestA: Promise<unknown> | undefined;
  try {
    serverA = await getInspectorServer(ownerA);
    capturedServers.add(serverA);
    requestA = call(serverA, "/api/v1/ui", {
      headers: await bearer(serverA),
    });
    await entered.promise;

    const ownerB = {
      ...fixtureContext().context,
      runtimeId: "runtime-b",
      projectRoot: "/project-b",
    };
    replacementB = getInspectorServer(ownerB).then((server) => {
      serverB = server;
      capturedServers.add(server);
      if (cleanupMode) void settleWithin(closeCapturedServer(server));
      return server;
    });
    observeReplacementB = Promise.allSettled([replacementB]);
    await waitUntilNotListening(serverA);
    const ownerC = {
      ...fixtureContext().context,
      runtimeId: "runtime-c",
      projectRoot: "/project-c",
    };
    replacementC = getInspectorServer(ownerC).then((server) => {
      serverC = server;
      capturedServers.add(server);
      if (cleanupMode) void settleWithin(closeCapturedServer(server));
      return server;
    });
    observeReplacementC = Promise.allSettled([replacementC]);
    release.resolve();
    await requestA;
    [serverB, serverC] = await Promise.all([replacementB, replacementC]);
    assert.notEqual(serverB.origin, serverC.origin);
    assert.equal((await call(serverC, "/")).status, 200);
    await assert.rejects(call(serverB, "/"));
    await closeInspectorServer("runtime-c");
    await assert.rejects(call(serverC, "/"));
  } finally {
    cleanupMode = true;
    release.resolve();
    await settleWithin(observeReplacementB);
    await settleWithin(observeReplacementC);
    await settleWithin(requestA);
    for (const server of capturedServers) {
      await settleWithin(closeCapturedServer(server));
    }
    for (const runtimeId of ["runtime-a", "runtime-b", "runtime-c"]) {
      await settleWithin(closeInspectorServer(runtimeId));
    }
    await settleWithin(closeInspectorServer());
  }
});

const capturedServerClosures = new WeakMap<InspectorServer, Promise<void>>();

function closeCapturedServer(server: InspectorServer): Promise<void> {
  let closing = capturedServerClosures.get(server);
  if (closing === undefined) {
    closing = server.close();
    capturedServerClosures.set(server, closing);
  }
  return closing;
}

async function settleWithin<T>(
  promise: Promise<T> | undefined,
): Promise<T | undefined> {
  if (!promise) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), 2_000);
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

async function waitUntilNotListening(server: InspectorServer): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      await call(server, "/");
      await new Promise<void>((resolve) => setImmediate(resolve));
    } catch {
      return;
    }
  }
  assert.fail("replacement did not close the previous listener");
}

// ---------------------------------------------------------------------------
// Bootstrap URL
// ---------------------------------------------------------------------------

test("bootstrap credentials expire at 60 seconds, are one-use, and retain one stable runtime capability", () => {
  let now = 100;
  const capabilities = createUiCapabilities(() => now);
  const first = capabilities.newBootstrapToken();
  const exchanged = capabilities.exchange(first);
  assert.ok(exchanged);
  assert.equal(capabilities.exchange(first), undefined);
  const second = capabilities.newBootstrapToken();
  const third = capabilities.newBootstrapToken();
  assert.equal(capabilities.exchange(second), undefined);
  assert.equal(capabilities.exchange("unknown"), undefined);
  assert.equal(capabilities.exchange(third), exchanged);
  const expiring = capabilities.newBootstrapToken();
  now += 60_000;
  assert.equal(capabilities.exchange(expiring), undefined);
  assert.equal(capabilities.authorize(exchanged), true);
  capabilities.revoke();
  assert.equal(capabilities.authorize(exchanged), false);
});

test("successive bootstrap exchanges reuse the stable capability and reject spent tokens", async () => {
  const { context } = fixtureContext();
  const server = await getInspectorServer(context);
  try {
    const oldToken = bootstrapToken(server);
    const currentToken = bootstrapToken(server);
    const exchange = (token: string) =>
      call(server, "/api/v1/ui-session", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    assert.equal((await exchange(oldToken)).status, 401);
    const first = await exchange(currentToken);
    assert.equal(first.status, 200);
    const capability = (JSON.parse(first.body) as { capability: string })
      .capability;
    assert.equal(Buffer.from(capability, "base64url").length, 32);
    assert.equal((await exchange(currentToken)).status, 401);
    const nextToken = bootstrapToken(server);
    const second = await exchange(nextToken);
    assert.equal(second.status, 200);
    assert.equal(
      (JSON.parse(second.body) as { capability: string }).capability,
      capability,
    );
    assert.equal(
      (
        await call(server, "/api/v1/ui", {
          headers: { Authorization: `Bearer ${capability}` },
        })
      ).status,
      200,
    );
  } finally {
    await closeInspectorServer();
  }
});

test("each UI invocation mints a fresh bootstrap token on the reused listener", async () => {
  const { context } = fixtureContext();
  const server = await getInspectorServer(context);
  try {
    assert.equal(server.origin, `http://127.0.0.1:${server.port}`);
    const token = bootstrapToken(server);
    assert.equal(Buffer.from(token, "base64url").length, 32);
    // The anchored shape above is the whole URL: origin, "/", fragment token.
    const next = bootstrapToken(server);
    assert.notEqual(next, token);
  } finally {
    await closeInspectorServer();
  }
});

// ---------------------------------------------------------------------------
// Known assets
// ---------------------------------------------------------------------------

test("known assets are served byte-for-byte for GET and HEAD with fixed headers", async () => {
  const { context, calls } = fixtureContext();
  const server = await getInspectorServer(context);
  const token = bootstrapToken(server);
  try {
    for (const asset of ASSETS) {
      for (const method of ["GET", "HEAD"]) {
        const response = await call(server, asset.path, { method });
        const label = `${method} ${asset.path}`;
        assert.equal(response.status, 200, label);
        assert.equal(response.headers["content-type"], asset.contentType);
        const policy = String(response.headers["content-security-policy"]);
        assert.equal(policy, serverCsp(server.port));
        assert.equal(policy.includes("ws://localhost"), false);
        assert.equal(policy.includes("ws://127.0.0.1:*"), false);
        assert.equal(policy.includes("wss://"), false);
        assert.equal(response.headers["x-content-type-options"], "nosniff");
        assert.equal(response.headers["cache-control"], "no-store, no-cache");
        assert.equal(response.headers["referrer-policy"], "no-referrer");
        assert.equal(
          response.headers["content-length"],
          String(Buffer.byteLength(asset.body)),
        );
        assert.equal(
          response.headers["access-control-allow-origin"],
          undefined,
        );
        assert.equal(response.headers.location, undefined);
        assert.equal(response.body, method === "GET" ? asset.body : "");
        // Unauthenticated assets carry no report or session state.
        assert.equal(response.body.includes("SNAPSHOT_DTO"), false, label);
        assert.equal(response.body.includes(SESSION_ID), false, label);
        assert.equal(response.body.includes(token), false, label);
        assert.equal(
          JSON.stringify(response.headers).includes(token),
          false,
          `${label} headers echoed the token`,
        );
      }
    }
    assert.deepEqual(calls.ui, []);
  } finally {
    await closeInspectorServer();
  }
});

test("the shell is served with the resolved theme already in effect", async () => {
  try {
    const lightServer = await getInspectorServer(
      fixtureContext("light").context,
    );
    const light = await call(lightServer, "/");
    assert.equal(light.status, 200);
    assert.equal(light.headers["content-type"], "text/html; charset=utf-8");
    // The default theme is the shipped shell bytes: nothing is injected, and
    // the content length is that document's own.
    assert.equal(light.body, WEB_ASSETS.shell);
    assert.equal(
      light.headers["content-length"],
      String(Buffer.byteLength(WEB_ASSETS.shell)),
    );
    assert.equal(light.body.includes("theme-dark"), false);

    // One long-lived instance rotates its context, and the theme with it.
    const darkServer = await getInspectorServer(fixtureContext("dark").context);
    assert.equal(darkServer.origin, lightServer.origin);
    const dark = await call(darkServer, "/");
    const themedShell = WEB_ASSETS.shell.replace(
      "<body>",
      '<body class="theme-dark">',
    );
    assert.equal(dark.status, 200);
    assert.equal(dark.body, themedShell);
    assert.equal(
      dark.headers["content-length"],
      String(Buffer.byteLength(themedShell)),
    );
    // Presentation only: the same headers, and still no report, session, or
    // catalog value — the one injected value is a closed enum's class name.
    assert.equal(
      dark.headers["content-security-policy"],
      serverCsp(darkServer.port),
    );
    assert.equal(dark.body.includes("SNAPSHOT_DTO"), false);
    assert.equal(dark.body.includes(SESSION_ID), false);
    assert.equal(dark.body.includes("application/json"), false);
    assert.equal(
      dark.body.length - light.body.length,
      ' class="theme-dark"'.length,
    );
  } finally {
    await closeInspectorServer();
  }
});

// ---------------------------------------------------------------------------
// Bearer authentication
// ---------------------------------------------------------------------------
test("protected API calls require the exact bearer credential", async () => {
  const { context, calls } = fixtureContext();
  const server = await getInspectorServer(context);
  const token = bootstrapToken(server);
  try {
    const rejections: readonly [string, Record<string, string>][] = [
      ["missing", {}],
      ["empty", { Authorization: "" }],
      ["scheme only", { Authorization: "Bearer" }],
      ["wrong scheme", { Authorization: `Basic ${token}` }],
      ["bare token", { Authorization: token }],
      ["wrong token", { Authorization: `Bearer ${wrongToken(token)}` }],
      ["short token", { Authorization: `Bearer ${token.slice(0, 42)}` }],
      ["long token", { Authorization: `Bearer ${token}x` }],
      ["trailing text", { Authorization: `Bearer ${token} extra` }],
      ["query token", {}],
      ["cookie token", { Cookie: `token=${token}` }],
    ];
    for (const [label, headers] of rejections) {
      const path =
        label === "query token" ? `/api/v1/ui?token=${token}` : "/api/v1/ui";
      const response = await call(server, path, { headers });
      assertProblem(response, 401, "unauthorized", [token]);
      assert.equal(calls.ui.length, 0, label);
    }
    // A query token is never a credential, even beside a valid bearer.
    const both = await call(server, `/api/v1/ui?token=${token}`, {
      headers: await bearer(server),
    });
    assertProblem(both, 400, "invalid-range", [token]);
    assert.equal(calls.ui.length, 0);

    const accepted = await call(server, "/api/v1/ui", {
      headers: await bearer(server),
    });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body, JSON.stringify(SNAPSHOT));
    assert.equal(calls.ui.length, 1);
  } finally {
    await closeInspectorServer();
  }
});

// ---------------------------------------------------------------------------
// /api/v1/ui
// ---------------------------------------------------------------------------

test("/api/v1/ui calls loadUi once per response and passes only the parse result", async () => {
  const { context, calls } = fixtureContext();
  const server = await getInspectorServer(context);
  try {
    const plain = await call(server, "/api/v1/ui", {
      headers: await bearer(server),
    });
    assert.equal(plain.status, 200);
    assert.equal(plain.headers["content-type"], "application/json");
    assert.equal(plain.headers["x-content-type-options"], "nosniff");
    assert.equal(plain.headers["cache-control"], "no-store, no-cache");
    assert.equal(plain.headers["referrer-policy"], "no-referrer");
    assert.equal(plain.body, JSON.stringify(SNAPSHOT));
    assert.deepEqual(calls.ui, [undefined]);

    const preset = await call(server, "/api/v1/ui?preset=7", {
      headers: await bearer(server),
    });
    assert.equal(preset.status, 200);
    assert.deepEqual(calls.ui.at(-1), { kind: "preset", preset: 7 });

    const custom = await call(
      server,
      "/api/v1/ui?from=2026-09-01&to=2026-09-12",
      { headers: await bearer(server) },
    );
    assert.equal(custom.status, 200);
    assert.deepEqual(calls.ui.at(-1), {
      kind: "custom",
      from: "2026-09-01",
      to: "2026-09-12",
    });

    const responses = await Promise.all([
      call(server, "/api/v1/ui", { headers: await bearer(server) }),
      call(server, "/api/v1/ui", { headers: await bearer(server) }),
    ]);
    assert.deepEqual(
      responses.map((response) => response.status),
      [200, 200],
    );
    // Two responses, two callback invocations: one per response, never shared.
    assert.equal(calls.ui.length, 5);
  } finally {
    await closeInspectorServer();
  }
});

test("invalid range input is rejected without invoking the projection", async () => {
  const { context, calls } = fixtureContext();
  const server = await getInspectorServer(context);
  try {
    const rejected = [
      "preset=7&preset=14",
      "preset=7&from=2026-09-01&to=2026-09-02",
      "preset=5",
      "from=2026-09-01",
      "to=2026-09-12",
      "from=2026-09-12&to=2026-09-01",
      "from=2026-02-30&to=2026-03-01",
      "scope=tree",
      "token=SECRET_QUERY_VALUE",
      "from=2026-09-01&to=2026-09-12&extra=SECRET_QUERY_VALUE",
      `from=2026-09-01&to=2026-09-12&x=${"a".repeat(600)}`,
    ];
    for (const query of rejected) {
      const response = await call(server, `/api/v1/ui?${query}`, {
        headers: await bearer(server),
      });
      assertProblem(response, 400, "invalid-range", [query]);
      assert.equal(calls.ui.length, 0, query);
    }
  } finally {
    await closeInspectorServer();
  }
});

// ---------------------------------------------------------------------------
// /api/v1/reports/global
// ---------------------------------------------------------------------------

test("the global resource accepts exactly the same range grammar", async () => {
  const { context, calls } = fixtureContext();
  const server = await getInspectorServer(context);
  try {
    const empty = await call(server, "/api/v1/reports/global", {
      headers: await bearer(server),
    });
    assert.equal(empty.status, 200);
    assert.equal(empty.body, JSON.stringify(GLOBAL));
    assert.deepEqual(calls.global, [undefined]);

    const preset = await call(server, "/api/v1/reports/global?preset=14", {
      headers: await bearer(server),
    });
    assert.equal(preset.status, 200);
    assert.deepEqual(calls.global.at(-1), { kind: "preset", preset: 14 });

    const custom = await call(
      server,
      "/api/v1/reports/global?from=2026-09-01&to=2026-09-12",
      { headers: await bearer(server) },
    );
    assert.equal(custom.status, 200);
    assert.deepEqual(calls.global.at(-1), {
      kind: "custom",
      from: "2026-09-01",
      to: "2026-09-12",
    });

    const invalid = await call(
      server,
      "/api/v1/reports/global?preset=7&from=2026-09-01&to=2026-09-12",
      { headers: await bearer(server) },
    );
    assertProblem(invalid, 400, "invalid-range");
    assert.equal(calls.global.length, 3);
  } finally {
    await closeInspectorServer();
  }
});

// ---------------------------------------------------------------------------
// /api/v1/reports/sessions/{sessionId}
// ---------------------------------------------------------------------------

test("the atomic session resource resolves one bounded id through loadSession", async () => {
  const { context, calls } = fixtureContext();
  const server = await getInspectorServer(context);
  try {
    const response = await call(
      server,
      `/api/v1/reports/sessions/${SESSION_ID}`,
      { headers: await bearer(server) },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers["content-type"], "application/json");
    assert.equal(response.body, JSON.stringify(SESSION));
    assert.deepEqual(calls.sessions, [SESSION_ID]);
  } finally {
    await closeInspectorServer();
  }
});

test("the atomic session resource rejects scope and range queries", async () => {
  const { context, calls } = fixtureContext();
  const server = await getInspectorServer(context);
  try {
    const rejected: readonly [string, string][] = [
      ["scope=tree", "range-not-supported"],
      ["preset=7", "range-not-supported"],
      ["from=2026-09-01&to=2026-09-12", "range-not-supported"],
      ["to=2026-09-12", "range-not-supported"],
      ["scope=active&preset=14", "range-not-supported"],
      // Over the 512-character query bound: refused before the key scan.
      [`x=${"a".repeat(600)}`, "invalid-range"],
    ];
    for (const [query, code] of rejected) {
      const response = await call(
        server,
        `/api/v1/reports/sessions/${SESSION_ID}?${query}`,
        { headers: await bearer(server) },
      );
      assertProblem(response, 400, code, [query]);
      assert.equal(calls.sessions.length, 0, query);
    }
    const unknownKey = await call(
      server,
      `/api/v1/reports/sessions/${SESSION_ID}?token=SECRET_QUERY_VALUE`,
      { headers: await bearer(server) },
    );
    assertProblem(unknownKey, 400, "invalid-range", ["SECRET_QUERY_VALUE"]);
    assert.equal(calls.sessions.length, 0);
  } finally {
    await closeInspectorServer();
  }
});

test("unknown and malformed session ids return one bounded generic failure", async () => {
  const { context, calls } = fixtureContext();
  const server = await getInspectorServer(context);
  try {
    const unknownId = "99999999-9999-4999-8999-999999999999";
    const unknown = await call(
      server,
      `/api/v1/reports/sessions/${unknownId}`,
      {
        headers: await bearer(server),
      },
    );
    assertProblem(unknown, 404, "not-found", [unknownId]);
    assert.deepEqual(calls.sessions, [unknownId]);

    for (const path of [
      "/api/v1/reports/sessions/",
      "/api/v1/reports/sessions",
      "/api/v1/reports/sessions/a/b",
      "/api/v1/reports/sessions/..%2f..%2fetc%2fpasswd",
      "/api/v1/reports/sessions/%2e%2e",
      `/api/v1/reports/sessions/${"a".repeat(129)}`,
    ]) {
      const response = await call(server, path, {
        headers: await bearer(server),
      });
      assertProblem(response, 404, "not-found", [path]);
    }
    // Malformed ids never reach the loader.
    assert.deepEqual(calls.sessions, [unknownId]);
  } finally {
    await closeInspectorServer();
  }
});

// ---------------------------------------------------------------------------
// Host, peer, and Origin boundary
// ---------------------------------------------------------------------------

test("the Host, peer, and Origin boundary admits only the exact loopback origin", async () => {
  const { context, calls } = fixtureContext();
  const server = await getInspectorServer(context);
  const origin = `http://127.0.0.1:${server.port}`;
  try {
    const wrongHost = await call(server, "/", {
      headers: { Host: "evil.example:1" },
    });
    assertProblem(wrongHost, 403, "forbidden", ["evil.example"]);
    const wrongFaviconHost = await call(server, "/favicon.ico", {
      headers: { Host: "evil.example:1" },
    });
    assertProblem(wrongFaviconHost, 403, "forbidden", ["evil.example"]);

    const missingHost = await call(server, "/", { setHost: false });
    assertProblem(missingHost, 403, "forbidden");

    // A forwarded header never substitutes for the exact Host.
    const forwardedHost = await call(server, "/", {
      headers: {
        Host: "evil.example:1",
        "X-Forwarded-Host": `127.0.0.1:${server.port}`,
      },
    });
    assertProblem(forwardedHost, 403, "forbidden", [
      "evil.example",
      `X-Forwarded-Host`,
    ]);

    const nullOrigin = await call(server, "/api/v1/ui", {
      headers: { ...(await bearer(server)), Origin: "null" },
    });
    assertProblem(nullOrigin, 403, "forbidden");

    for (const rejectedOrigin of [
      `http://localhost:${server.port}`,
      "http://127.0.0.1:1",
      `https://127.0.0.1:${server.port}`,
      `http://127.0.0.1:${server.port}/`,
    ]) {
      const response = await call(server, "/api/v1/ui", {
        headers: { ...(await bearer(server)), Origin: rejectedOrigin },
      });
      assertProblem(response, 403, "forbidden", [rejectedOrigin]);
    }
    assert.equal(calls.ui.length, 0);

    // Missing Origin is the documented exception: assets after Host/peer
    // validation, API calls only beside a valid bearer.
    const matching = await call(server, "/", { headers: { Origin: origin } });
    assert.equal(matching.status, 200);
    const apiWithOrigin = await call(server, "/api/v1/ui", {
      headers: { ...(await bearer(server)), Origin: origin },
    });
    assert.equal(apiWithOrigin.status, 200);
    const apiWithoutOrigin = await call(server, "/api/v1/ui", {
      headers: await bearer(server),
    });
    assert.equal(apiWithoutOrigin.status, 200);
    const apiWithoutBearer = await call(server, "/api/v1/ui", {
      headers: { Origin: origin },
    });
    assertProblem(apiWithoutBearer, 401, "unauthorized");
    // Forwarded headers are ignored, never trusted.
    const forwardedFor = await call(server, "/api/v1/ui", {
      headers: {
        ...(await bearer(server)),
        "X-Forwarded-For": "203.0.113.9",
        Forwarded: "host=evil.example",
      },
    });
    assert.equal(forwardedFor.status, 200);
    assert.equal(calls.ui.length, 3);
  } finally {
    await closeInspectorServer();
  }
});

test("a duplicate Host keeps its first value and is no parser-level refusal", async () => {
  const { context } = fixtureContext();
  const server = await getInspectorServer(context);
  const expectedHost = `127.0.0.1:${server.port}`;
  try {
    // Observed Node behaviour with this parser configuration: a repeated Host
    // is accepted and `req.headers.host` keeps the FIRST value. There is no
    // body-less parser 400 and no second line of defence; this module's exact
    // match is the only Host check.
    const wrongFirst = await rawExchange(server, [
      "GET / HTTP/1.1",
      "Host: evil.example:1",
      `Host: ${expectedHost}`,
      "Connection: close",
    ]);
    assert.match(wrongFirst.split("\r\n")[0], /^HTTP\/1\.1 403 /);
    assert.equal(wrongFirst.includes('"code":"forbidden"'), true);
    assert.equal(wrongFirst.includes("evil.example"), false);

    // The correct value first is the one Node trusts; the repeated second
    // value is ignored entirely, and the exact match admits the request.
    const correctFirst = await rawExchange(server, [
      "GET / HTTP/1.1",
      `Host: ${expectedHost}`,
      "Host: evil.example:1",
      "Connection: close",
    ]);
    assert.match(correctFirst.split("\r\n")[0], /^HTTP\/1\.1 200 /);
    assert.equal(correctFirst.endsWith(WEB_ASSETS.shell), true);
  } finally {
    await closeInspectorServer();
  }
});

/**
 * Source-address bind refusals that mean the platform has no `127.0.0.2` on
 * its loopback interface; the wire test skips rather than failing.
 */
const SOURCE_BIND_REFUSED = new Set([
  "EADDRNOTAVAIL",
  "EINVAL",
  "EACCES",
  "EPERM",
  "EAFNOSUPPORT",
]);

test("a request from another loopback address is refused boundedly", async (t) => {
  const { context, calls } = fixtureContext();
  const server = await getInspectorServer(context);
  const { hostname, port } = new URL(server.origin);
  try {
    // Source-bind to 127.0.0.2 so the listener sees a 127/8 peer that is not
    // its own address: the only wire-level way to exercise the peer check.
    const authHeaders = await bearer(server);
    const outcome = await new Promise<TestResponse | { bindError: string }>(
      (resolve, reject) => {
        const request = http.request(
          {
            hostname,
            port,
            path: "/api/v1/ui",
            method: "GET",
            headers: authHeaders,
            agent: false,
            localAddress: "127.0.0.2",
          },
          (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk: Buffer) => chunks.push(chunk));
            response.on("end", () =>
              resolve({
                status: response.statusCode ?? 0,
                headers: response.headers,
                body: Buffer.concat(chunks).toString("utf8"),
              }),
            );
          },
        );
        request.on("error", (error: Error) => {
          const code = (error as NodeJS.ErrnoException).code ?? "";
          if (SOURCE_BIND_REFUSED.has(code)) {
            resolve({ bindError: code });
            return;
          }
          reject(error);
        });
        request.end();
      },
    );
    if ("bindError" in outcome) {
      t.skip(`platform refused localAddress 127.0.0.2 (${outcome.bindError})`);
      return;
    }
    assertProblem(outcome, 403, "forbidden");
    assert.equal(calls.ui.length, 0);
  } finally {
    await closeInspectorServer();
  }
});

test("only normalized IPv4 loopback peers are accepted", () => {
  assert.equal(isLoopbackPeer("127.0.0.1"), true);
  assert.equal(isLoopbackPeer("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackPeer("::1"), false);
  assert.equal(isLoopbackPeer("::ffff:7f00:1"), false);
  assert.equal(isLoopbackPeer("127.0.0.2"), false);
  assert.equal(isLoopbackPeer("10.0.0.1"), false);
  assert.equal(isLoopbackPeer("localhost"), false);
  assert.equal(isLoopbackPeer(undefined), false);
});

// ---------------------------------------------------------------------------
// Methods, unknown routes, and traversal
// ---------------------------------------------------------------------------

test("favicon and method requests do not emit Pi diagnostics", async () => {
  const { context } = fixtureContext();
  const server = await getInspectorServer(context);
  const lines: string[] = [];
  const original = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    for (const method of ["GET", "HEAD"]) {
      const response = await call(server, "/favicon.ico", { method });
      assert.equal(response.status, 204, method);
      assert.equal(response.body, "", method);
      assert.equal(response.headers["content-type"], "image/x-icon", method);
      assert.equal(
        response.headers["cache-control"],
        "no-store, no-cache",
        method,
      );
      assert.equal(
        response.headers["x-content-type-options"],
        "nosniff",
        method,
      );
    }
    assert.deepEqual(lines, []);

    for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
      const response = await call(server, "/favicon.ico", { method });
      assertProblem(response, 405, "method-not-allowed", [method]);
      assert.equal(response.headers.allow, "GET, HEAD");
    }
    assert.equal(lines.length, 0);
  } finally {
    process.stderr.write = original;
    await closeInspectorServer();
  }
});

test("unsupported methods, traversal paths, and unknown routes fail boundedly", async () => {
  const { context, calls } = fixtureContext();
  const server = await getInspectorServer(context);
  const lines: string[] = [];
  const original = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const response = await call(server, "/", { method });
      assertProblem(response, 405, "method-not-allowed", [method]);
      assert.equal(response.headers.allow, "GET, HEAD");
    }
    for (const method of ["POST", "PUT", "DELETE"]) {
      const response = await call(server, "/api/v1/ui", {
        method,
        headers: await bearer(server),
      });
      assertProblem(response, 405, "method-not-allowed", [method]);
      assert.equal(response.headers.allow, "GET");
    }
    // HEAD must not carry a body; its bounded headers state the same refusal.
    const headApi = await call(server, "/api/v1/ui", {
      method: "HEAD",
      headers: await bearer(server),
    });
    assert.equal(headApi.status, 405);
    assert.equal(headApi.body, "");
    assert.equal(headApi.headers["content-type"], "application/problem+json");
    assert.equal(headApi.headers.allow, "GET");
    assert.equal(calls.ui.length, 0);

    for (const path of [
      "/../style.css",
      "/%2e%2e/style.css",
      "/style.css/../client.js",
      "//style.css",
      "/style.css/",
      "/etc/passwd",
      "/index.html",
      "/.env",
      "/api/v1/ui/",
      "/api/v1/",
      "/api/v1/nope",
      "/api/v1/reports",
      "/api/v1/reports/sessionsx",
      "/api/v2/ui",
    ]) {
      const response = await call(server, path, {
        headers: await bearer(server),
      });
      assertProblem(response, 404, "not-found", [path]);
      assert.equal(response.body.includes("<html"), false, path);
      assert.equal(
        response.headers["content-security-policy"],
        undefined,
        path,
      );
    }
    assert.equal(
      calls.ui.length + calls.global.length + calls.sessions.length,
      0,
    );
    assert.deepEqual(lines, []);
  } finally {
    process.stderr.write = original;
    await closeInspectorServer();
  }
});

// ---------------------------------------------------------------------------
// Bounded diagnostics
// ---------------------------------------------------------------------------

test("a failing callback answers a bounded internal error without Pi diagnostics", async () => {
  const { context } = fixtureContext();
  const server = await getInspectorServer({
    ...context,
    loadUi: async () => {
      throw new Error("read failed /home/dvory/private/notes.txt");
    },
  });
  const lines: string[] = [];
  const original = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    const response = await call(server, "/api/v1/ui", {
      headers: await bearer(server),
    });
    const body = assertProblem(response, 500, "internal-error", [
      "/home/dvory/private/notes.txt",
      "read failed",
    ]);
    assert.equal(body.detail, "The request could not be completed.");
    assert.deepEqual(lines, []);
  } finally {
    process.stderr.write = original;
    await closeInspectorServer();
  }
});

// ---------------------------------------------------------------------------
// Singleton lifecycle
// ---------------------------------------------------------------------------// ---------------------------------------------------------------------------

test("runtime/project replacement retires the listener and old-owner shutdown cannot close its replacement", async () => {
  const first = fixtureContext();
  const serverA = await getInspectorServer({
    ...first.context,
    runtimeId: "old",
    projectRoot: "/old",
  });
  const serverB = await getInspectorServer({
    ...first.context,
    runtimeId: "new",
    projectRoot: "/new",
  });
  assert.notEqual(serverA.port, serverB.port);
  await closeInspectorServer("old");
  assert.equal((await call(serverB, "/")).status, 200);
  await closeInspectorServer("new");

  const projectA = await getInspectorServer({
    ...first.context,
    runtimeId: "same",
    projectRoot: "/project-a",
  });
  const projectB = await getInspectorServer({
    ...first.context,
    runtimeId: "same",
    projectRoot: "/project-b",
  });
  assert.notEqual(projectA.port, projectB.port);
  await closeInspectorServer();
});

test("the singleton is reused with replaced context and closed explicitly", async () => {
  const first = fixtureContext();
  const serverA = await getInspectorServer(first.context);
  const tokenA = bootstrapToken(serverA);
  const second = fixtureContext();
  const serverB = await getInspectorServer(second.context);
  try {
    // Reuse one listener while each invocation mints a distinct one-use token.
    assert.equal(serverB.port, serverA.port);
    assert.equal(serverB.origin, serverA.origin);
    const tokenB = bootstrapToken(serverB);
    assert.notEqual(tokenB, tokenA);
    const response = await call(serverA, "/api/v1/ui", {
      headers: await bearer(serverA),
    });
    assert.equal(response.status, 200);
    assert.equal(first.calls.ui.length, 0);
    assert.equal(second.calls.ui.length, 1);
  } finally {
    await serverA.close();
  }
  // The released port serves nothing: the next connection cannot get a response.
  await assert.rejects(call(serverA, "/"));

  // A second startup is a fresh instance with a fresh token.
  const serverC = await getInspectorServer(fixtureContext().context);
  try {
    assert.notEqual(bootstrapToken(serverC), tokenA);
  } finally {
    await closeInspectorServer();
    await closeInspectorServer();
  }
  await assert.rejects(call(serverC, "/"));
});

test("protected UI snapshot ETag matches the revision serializer without conditional responses", async () => {
  const { context } = fixtureContext();
  const server = await getInspectorServer(context);
  try {
    const headers = await bearer(server);
    const expected = serializeUiSnapshot(SNAPSHOT);
    const response = await call(server, "/api/v1/ui", { headers });
    assert.equal(response.status, 200);
    assert.equal(response.body, expected.body);
    assert.equal(response.headers.etag, expected.etag);
    assert.equal(response.headers["cache-control"], "no-store, no-cache");
    const fullBody = await call(server, "/api/v1/ui", {
      headers: { ...headers, "If-None-Match": expected.etag },
    });
    assert.equal(fullBody.status, 200);
    assert.equal(fullBody.body, expected.body);
    assert.equal(fullBody.headers.etag, expected.etag);
  } finally {
    await closeInspectorServer();
  }
});

test("owner shutdown closes an authenticated live socket and its channel", async () => {
  const { context } = fixtureContext();
  const server = await getInspectorServer(context);
  const auth = await bearer(server);
  const authorization = auth.Authorization;
  assert.ok(authorization);
  const capability = authorization.replace(/^Bearer /, "");
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/api/v1/ui-live`, {
    origin: server.origin,
  });
  await new Promise<void>((resolve) => ws.once("open", resolve));
  ws.send(
    JSON.stringify({ type: "subscribe", capability, etag: "stale", range: "" }),
  );
  await new Promise<void>((resolve) => ws.once("message", () => resolve()));
  const closed = new Promise<number>((resolve) =>
    ws.once("close", (code) => resolve(code)),
  );
  await Promise.race([
    closeInspectorServer(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("owner close timeout")), 1500),
    ),
  ]);
  assert.equal(
    await Promise.race([
      closed,
      new Promise<number>((_, reject) =>
        setTimeout(() => reject(new Error("socket close timeout")), 1500),
      ),
    ]),
    1001,
  );
});

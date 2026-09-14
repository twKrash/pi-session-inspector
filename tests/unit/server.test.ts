import assert from "node:assert/strict";
import http from "node:http";
import { after, test } from "node:test";

import type { SessionReport } from "../../src/core/reports.ts";
import type { RangeIntent } from "../../src/ui/range.ts";
import {
  closeInspectorServer,
  getInspectorServer,
  isLoopbackPeer,
  type InspectorServer,
  type InspectorServerContext,
} from "../../src/ui/server.ts";
import type {
  GlobalReportProjection,
  InspectorUiSnapshot,
} from "../../src/ui/ui-projection.ts";
import { WEB_ASSETS } from "../../src/ui/web-assets.ts";

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
function fixtureContext(): { context: InspectorServerContext; calls: Calls } {
  const calls: Calls = { ui: [], sessions: [], global: [] };
  return {
    calls,
    context: {
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

const BOOTSTRAP_URL =
  /^http:\/\/127\.0\.0\.1:(\d+)\/#token=([A-Za-z0-9_-]{43})$/;

function bootstrapToken(server: InspectorServer): string {
  const match = BOOTSTRAP_URL.exec(server.bootstrapUrl());
  assert.ok(match !== null, `bootstrap URL shape: ${server.bootstrapUrl()}`);
  assert.equal(Number(match[1]), server.port);
  return match[2];
}

function bearer(server: InspectorServer): Record<string, string> {
  return { Authorization: `Bearer ${bootstrapToken(server)}` };
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
  for (const secret of forbidden) {
    if (secret === "") continue;
    assert.equal(
      response.body.includes(secret),
      false,
      `problem echoed ${secret}`,
    );
  }
  return body;
}

const SERVER_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

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
    path: "/route.js",
    body: WEB_ASSETS.route,
    contentType: "text/javascript; charset=utf-8",
  },
  {
    path: "/range.js",
    body: WEB_ASSETS.range,
    contentType: "text/javascript; charset=utf-8",
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

// ---------------------------------------------------------------------------
// Bootstrap URL
// ---------------------------------------------------------------------------

test("the bootstrap URL is one fresh 32-byte token and no report state", async () => {
  const { context } = fixtureContext();
  const server = await getInspectorServer(context);
  try {
    assert.equal(server.origin, `http://127.0.0.1:${server.port}`);
    const token = bootstrapToken(server);
    assert.equal(Buffer.from(token, "base64url").length, 32);
    // The anchored shape above is the whole URL: origin, "/", fragment token.
    assert.equal(server.bootstrapUrl(), `${server.origin}/#token=${token}`);
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
        assert.equal(response.headers["content-security-policy"], SERVER_CSP);
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
      }
    }
    assert.deepEqual(calls.ui, []);
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
      headers: bearer(server),
    });
    assertProblem(both, 400, "invalid-range", [token]);
    assert.equal(calls.ui.length, 0);

    const accepted = await call(server, "/api/v1/ui", {
      headers: bearer(server),
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
    const plain = await call(server, "/api/v1/ui", { headers: bearer(server) });
    assert.equal(plain.status, 200);
    assert.equal(plain.headers["content-type"], "application/json");
    assert.equal(plain.headers["x-content-type-options"], "nosniff");
    assert.equal(plain.headers["cache-control"], "no-store, no-cache");
    assert.equal(plain.headers["referrer-policy"], "no-referrer");
    assert.equal(plain.body, JSON.stringify(SNAPSHOT));
    assert.deepEqual(calls.ui, [undefined]);

    const preset = await call(server, "/api/v1/ui?preset=7", {
      headers: bearer(server),
    });
    assert.equal(preset.status, 200);
    assert.deepEqual(calls.ui.at(-1), { kind: "preset", preset: 7 });

    const custom = await call(
      server,
      "/api/v1/ui?from=2026-09-01&to=2026-09-12",
      { headers: bearer(server) },
    );
    assert.equal(custom.status, 200);
    assert.deepEqual(calls.ui.at(-1), {
      kind: "custom",
      from: "2026-09-01",
      to: "2026-09-12",
    });

    const responses = await Promise.all([
      call(server, "/api/v1/ui", { headers: bearer(server) }),
      call(server, "/api/v1/ui", { headers: bearer(server) }),
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
        headers: bearer(server),
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
      headers: bearer(server),
    });
    assert.equal(empty.status, 200);
    assert.equal(empty.body, JSON.stringify(GLOBAL));
    assert.deepEqual(calls.global, [undefined]);

    const preset = await call(server, "/api/v1/reports/global?preset=14", {
      headers: bearer(server),
    });
    assert.equal(preset.status, 200);
    assert.deepEqual(calls.global.at(-1), { kind: "preset", preset: 14 });

    const custom = await call(
      server,
      "/api/v1/reports/global?from=2026-09-01&to=2026-09-12",
      { headers: bearer(server) },
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
      { headers: bearer(server) },
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
      { headers: bearer(server) },
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
    const rejected = [
      "scope=tree",
      "preset=7",
      "from=2026-09-01&to=2026-09-12",
      "to=2026-09-12",
      "scope=active&preset=14",
    ];
    for (const query of rejected) {
      const response = await call(
        server,
        `/api/v1/reports/sessions/${SESSION_ID}?${query}`,
        { headers: bearer(server) },
      );
      assertProblem(response, 400, "range-not-supported", [query]);
      assert.equal(calls.sessions.length, 0, query);
    }
    const unknownKey = await call(
      server,
      `/api/v1/reports/sessions/${SESSION_ID}?token=SECRET_QUERY_VALUE`,
      { headers: bearer(server) },
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
        headers: bearer(server),
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
      const response = await call(server, path, { headers: bearer(server) });
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
      headers: { ...bearer(server), Origin: "null" },
    });
    assertProblem(nullOrigin, 403, "forbidden");

    for (const rejectedOrigin of [
      `http://localhost:${server.port}`,
      "http://127.0.0.1:1",
      `https://127.0.0.1:${server.port}`,
      `http://127.0.0.1:${server.port}/`,
    ]) {
      const response = await call(server, "/api/v1/ui", {
        headers: { ...bearer(server), Origin: rejectedOrigin },
      });
      assertProblem(response, 403, "forbidden", [rejectedOrigin]);
    }
    assert.equal(calls.ui.length, 0);

    // Missing Origin is the documented exception: assets after Host/peer
    // validation, API calls only beside a valid bearer.
    const matching = await call(server, "/", { headers: { Origin: origin } });
    assert.equal(matching.status, 200);
    const apiWithOrigin = await call(server, "/api/v1/ui", {
      headers: { ...bearer(server), Origin: origin },
    });
    assert.equal(apiWithOrigin.status, 200);
    const apiWithoutOrigin = await call(server, "/api/v1/ui", {
      headers: bearer(server),
    });
    assert.equal(apiWithoutOrigin.status, 200);
    const apiWithoutBearer = await call(server, "/api/v1/ui", {
      headers: { Origin: origin },
    });
    assertProblem(apiWithoutBearer, 401, "unauthorized");
    // Forwarded headers are ignored, never trusted.
    const forwardedFor = await call(server, "/api/v1/ui", {
      headers: {
        ...bearer(server),
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

test("unsupported methods, traversal paths, and unknown routes fail boundedly", async () => {
  const { context, calls } = fixtureContext();
  const server = await getInspectorServer(context);
  try {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const response = await call(server, "/", { method });
      assertProblem(response, 405, "method-not-allowed", [method]);
      assert.equal(response.headers.allow, "GET, HEAD");
    }
    for (const method of ["POST", "PUT", "DELETE"]) {
      const response = await call(server, "/api/v1/ui", {
        method,
        headers: bearer(server),
      });
      assertProblem(response, 405, "method-not-allowed", [method]);
      assert.equal(response.headers.allow, "GET");
    }
    // HEAD must not carry a body; its bounded headers state the same refusal.
    const headApi = await call(server, "/api/v1/ui", {
      method: "HEAD",
      headers: bearer(server),
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
      "/favicon.ico",
      "/.env",
      "/api/v1/ui/",
      "/api/v1/",
      "/api/v1/nope",
      "/api/v1/reports",
      "/api/v1/reports/sessionsx",
      "/api/v2/ui",
    ]) {
      const response = await call(server, path, { headers: bearer(server) });
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
  } finally {
    await closeInspectorServer();
  }
});

// ---------------------------------------------------------------------------
// Bounded diagnostics
// ---------------------------------------------------------------------------

test("a failing callback answers a bounded internal error and one redacted stderr line", async () => {
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
      headers: bearer(server),
    });
    const body = assertProblem(response, 500, "internal-error", [
      "/home/dvory/private/notes.txt",
      "read failed",
    ]);
    assert.equal(body.detail, "The request could not be completed.");
    assert.equal(lines.length, 1);
    assert.equal(lines[0].endsWith("\n"), true);
    assert.equal(lines[0].split("\n").filter((line) => line !== "").length, 1);
    const record = JSON.parse(lines[0]) as Record<string, unknown>;
    assert.deepEqual(Object.keys(record).sort(), [
      "code",
      "event",
      "phase",
      "reason",
      "requestId",
      "status",
    ]);
    assert.equal(record.event, "ui-server");
    assert.equal(record.phase, "request");
    assert.equal(record.code, "internal-error");
    assert.equal(record.status, 500);
    assert.equal(record.requestId, body.correlationId);
    assert.equal(typeof record.reason, "string");
    assert.equal(String(record.reason).includes("/home/"), false);
    assert.equal(String(record.reason).includes("[PATH]"), true);
  } finally {
    process.stderr.write = original;
    await closeInspectorServer();
  }
});

test("a failing stderr writer cannot change the response", async () => {
  const { context } = fixtureContext();
  const server = await getInspectorServer({
    ...context,
    loadUi: async () => {
      throw new Error("SECRET_EXCEPTION_TEXT");
    },
  });
  const original = process.stderr.write;
  process.stderr.write = (() => {
    throw new Error("stderr is closed");
  }) as typeof process.stderr.write;
  try {
    const response = await call(server, "/api/v1/ui", {
      headers: bearer(server),
    });
    assertProblem(response, 500, "internal-error", ["SECRET_EXCEPTION_TEXT"]);
  } finally {
    process.stderr.write = original;
    await closeInspectorServer();
  }
});

// ---------------------------------------------------------------------------
// Singleton lifecycle
// ---------------------------------------------------------------------------

test("the singleton is reused with replaced context and closed explicitly", async () => {
  const first = fixtureContext();
  const serverA = await getInspectorServer(first.context);
  const tokenA = bootstrapToken(serverA);
  const second = fixtureContext();
  const serverB = await getInspectorServer(second.context);
  try {
    // Reuse: one listener, one token, request-time context replaced.
    assert.equal(serverB.port, serverA.port);
    assert.equal(serverB.origin, serverA.origin);
    assert.equal(serverB.bootstrapUrl(), serverA.bootstrapUrl());
    const response = await call(serverA, "/api/v1/ui", {
      headers: bearer(serverA),
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

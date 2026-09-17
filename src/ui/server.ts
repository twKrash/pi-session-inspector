/**
 * The one ephemeral loopback server (ADR 0018; spec §3 localhost contract).
 *
 * This module routes, authenticates, validates bounded input, serializes the
 * request-time context callbacks' DTOs, and writes bounded diagnostics — and
 * nothing else. Every report, scope, range, and availability decision stays in
 * L2; Task 7 composes the request-time callbacks that own data access.
 *
 * The listener binds only `127.0.0.1:0`, holds one lazy module-local singleton
 * whose request-time context is replaced on every `getInspectorServer` call,
 * and keeps one 32-byte capability token per server instance in memory only.
 * `closeInspectorServer()` exists for tests and lifecycle owners; nothing here
 * starts a server at import time and nothing maps a request path to the
 * filesystem.
 */
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import { redactBoundedText } from "../core/redact.ts";
import type { SessionReport } from "../core/reports.ts";
import { parseRangeQuery, type RangeIntent } from "./range.ts";
import type {
  GlobalReportProjection,
  InspectorUiSnapshot,
} from "./ui-projection.ts";
import { renderShell, WEB_ASSETS, type ShellTheme } from "./web-assets.ts";

/** The request-time data seams: only these callbacks may observe reports. */
export type InspectorServerContext = {
  /** The resolved theme the shell is rendered in; presentation, never report data. */
  theme: ShellTheme;
  loadUi(intent?: RangeIntent): Promise<InspectorUiSnapshot>;
  loadSession(sessionId: string): Promise<SessionReport | undefined>;
  loadGlobal(intent?: RangeIntent): Promise<GlobalReportProjection>;
};

/** One running instance as its owner sees it. */
export type InspectorServer = {
  port: number;
  origin: string;
  bootstrapUrl(): string;
  close(): Promise<void>;
};

const SERVER_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** The two fixed assets; the shell is rendered per request with its theme. */
const ASSETS = new Map<string, { body: string; contentType: string }>([
  [
    "/style.css",
    { body: WEB_ASSETS.style, contentType: "text/css; charset=utf-8" },
  ],
  [
    "/client.js",
    { body: WEB_ASSETS.client, contentType: "text/javascript; charset=utf-8" },
  ],
]);

const SHELL_CONTENT_TYPE = "text/html; charset=utf-8";

/** One bounded opaque session-id route segment; never a path. */
const SESSION_ID = /^[A-Za-z0-9._~-]{1,128}$/;

/** The keys the atomic session resource must refuse. */
const SESSION_QUERY_KEYS = new Set(["scope", "preset", "from", "to"]);

/** The parser's own bound, applied before the session key scan as well. */
const MAX_QUERY_LENGTH = 512;

const BEARER = /^Bearer ([A-Za-z0-9_-]{1,256})$/i;

type ProblemCode =
  | "unauthorized"
  | "forbidden"
  | "not-found"
  | "method-not-allowed"
  | "invalid-range"
  | "range-not-supported"
  | "internal-error";

/** Fixed safe Problem Details values: no message is ever composed from input. */
const PROBLEMS: Record<
  ProblemCode,
  { status: number; title: string; detail: string; retryable: boolean }
> = {
  unauthorized: {
    status: 401,
    title: "Unauthorized",
    detail: "A valid bearer credential is required.",
    retryable: false,
  },
  forbidden: {
    status: 403,
    title: "Forbidden",
    detail: "The request is outside the permitted loopback boundary.",
    retryable: false,
  },
  "not-found": {
    status: 404,
    title: "Not Found",
    detail: "The requested resource is not available.",
    retryable: false,
  },
  "method-not-allowed": {
    status: 405,
    title: "Method Not Allowed",
    detail: "The requested method is not supported for this resource.",
    retryable: false,
  },
  "invalid-range": {
    status: 400,
    title: "Invalid Range",
    detail: "The range query is not a supported bounded form.",
    retryable: false,
  },
  "range-not-supported": {
    status: 400,
    title: "Range Not Supported",
    detail: "This resource accepts no range or scope parameters.",
    retryable: false,
  },
  "internal-error": {
    status: 500,
    title: "Internal Error",
    detail: "The request could not be completed.",
    retryable: true,
  },
};

type Running = {
  server: Server;
  port: number;
  origin: string;
  token: string;
  context: InspectorServerContext;
  inspector: InspectorServer;
};

let running: Running | undefined;
let pending: Promise<Startup> | undefined;

/** What a shared start hands each caller: the instance and its context seam. */
type Startup = {
  inspector: InspectorServer;
  setContext(context: InspectorServerContext): void;
};

/**
 * Accepted loopback peer forms. The listener binds IPv4 `127.0.0.1`, so the
 * only other form a kernel may report is the IPv4-mapped IPv6 representation
 * of the same address; native IPv6 loopback is not this listener and is
 * refused. Exported because a real non-loopback peer cannot be produced from
 * the test process.
 */
export function isLoopbackPeer(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::ffff:127.0.0.1";
}

/**
 * Starts or reuses the module-local singleton and replaces its request-time
 * context. Two concurrent callers share one listener; the last caller's
 * context serves requests from then on.
 */
export async function getInspectorServer(
  context: InspectorServerContext,
): Promise<InspectorServer> {
  if (running !== undefined) {
    running.context = context;
    return running.inspector;
  }
  if (pending === undefined) {
    const start = startServer(context);
    pending = start.finally(() => {
      pending = undefined;
    });
  }
  const startup = await pending;
  startup.setContext(context);
  return startup.inspector;
}

/** Closes and clears the singleton; safe to call when nothing is running. */
export async function closeInspectorServer(): Promise<void> {
  const starting = pending;
  if (starting !== undefined) {
    const startup = await starting.catch(() => undefined);
    if (startup !== undefined) {
      await startup.inspector.close();
    }
    return;
  }
  const current = running;
  running = undefined;
  if (current !== undefined) {
    await closeServer(current.server);
  }
}

function securityHeaders(contentType: string): Record<string, string> {
  return {
    "content-type": contentType,
    "x-content-type-options": "nosniff",
    "cache-control": "no-store, no-cache",
    "referrer-policy": "no-referrer",
  };
}

function logDiagnostic(record: {
  phase: "startup" | "request" | "runtime";
  code: string;
  status?: number;
  requestId?: string;
  reason?: unknown;
}): void {
  try {
    const line: Record<string, string | number> = {
      event: "ui-server",
      phase: record.phase,
      code: record.code,
    };
    if (typeof record.status === "number" && Number.isInteger(record.status)) {
      line.status = record.status;
    }
    if (typeof record.requestId === "string") {
      line.requestId = record.requestId;
    }
    const reason = redactBoundedText(record.reason);
    if (reason !== undefined) {
      line.reason = reason;
    }
    process.stderr.write(`${JSON.stringify(line)}\n`);
  } catch {
    // Best-effort only: a diagnostic failure can never affect Pi execution.
  }
}

function sendProblem(
  res: ServerResponse,
  code: ProblemCode,
  options: { head?: boolean; allow?: string; reason?: string } = {},
): void {
  const problem = PROBLEMS[code];
  const correlationId = randomUUID();
  const body = JSON.stringify({
    type: "about:blank",
    title: problem.title,
    status: problem.status,
    detail: problem.detail,
    code,
    retryable: problem.retryable,
    correlationId,
  });
  const headers = securityHeaders("application/problem+json");
  headers["content-length"] = String(Buffer.byteLength(body));
  if (options.allow !== undefined) {
    headers.allow = options.allow;
  }
  res.writeHead(problem.status, headers);
  res.end(options.head === true ? undefined : body);
  logDiagnostic({
    phase: "request",
    code,
    status: problem.status,
    requestId: correlationId,
    reason: options.reason,
  });
}

function sendJson(res: ServerResponse, value: unknown): void {
  if (value === undefined || value === null) {
    sendProblem(res, "internal-error", { reason: "callback-result" });
    return;
  }
  const body = JSON.stringify(value);
  const headers = securityHeaders("application/json");
  headers["content-length"] = String(Buffer.byteLength(body));
  res.writeHead(200, headers);
  res.end(body);
}

function sendAsset(
  res: ServerResponse,
  asset: { body: string; contentType: string },
  head: boolean,
): void {
  const body = Buffer.from(asset.body, "utf8");
  res.writeHead(200, {
    ...securityHeaders(asset.contentType),
    "content-security-policy": SERVER_CSP,
    "content-length": String(body.byteLength),
  });
  res.end(head ? undefined : body);
}

function isAuthorized(state: Running, req: IncomingMessage): boolean {
  const header = req.headers.authorization;
  if (typeof header !== "string") {
    return false;
  }
  const match = BEARER.exec(header);
  if (match === null) {
    return false;
  }
  // Constant-time only after bounded format and equal-length validation.
  const candidate = Buffer.from(match[1], "utf8");
  const expected = Buffer.from(state.token, "utf8");
  if (candidate.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(candidate, expected);
}

/**
 * Whether the atomic session resource accepts, refuses as range/scope, or
 * rejects as an unknown query form. The key scan is bounded and never resolves
 * a value.
 */
function sessionQueryDecision(
  search: string,
): "none" | "range-not-supported" | "invalid-range" {
  if (search === "") {
    return "none";
  }
  if (search.length > MAX_QUERY_LENGTH) {
    return "invalid-range";
  }
  for (const part of search.split("&")) {
    const separator = part.indexOf("=");
    const raw = separator === -1 ? part : part.slice(0, separator);
    let key: string;
    try {
      key = decodeURIComponent(raw);
    } catch {
      return "invalid-range";
    }
    if (key === "") {
      return "invalid-range";
    }
    if (SESSION_QUERY_KEYS.has(key)) {
      return "range-not-supported";
    }
  }
  return "invalid-range";
}

async function handleRequest(
  state: Running,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const method = req.method ?? "";
  const head = method === "HEAD";
  const expectedHost = `127.0.0.1:${state.port}`;
  const target = typeof req.url === "string" ? req.url : "";
  const queryAt = target.indexOf("?");
  const path = queryAt === -1 ? target : target.slice(0, queryAt);
  const search = queryAt === -1 ? "" : target.slice(queryAt + 1);

  // The network boundary is checked before any route, asset, or callback.
  // A duplicate `Host` is not refused by Node: the parser accepts the request
  // and keeps the first value, so this exact match is the only Host defence.
  if (req.headers.host !== expectedHost) {
    sendProblem(res, "forbidden", { head, reason: "host" });
    return;
  }
  if (!isLoopbackPeer(req.socket.remoteAddress)) {
    sendProblem(res, "forbidden", { head, reason: "peer" });
    return;
  }
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== `http://${expectedHost}`) {
    sendProblem(res, "forbidden", { head, reason: "origin" });
    return;
  }

  const asset =
    path === "/"
      ? {
          body: renderShell(state.context.theme),
          contentType: SHELL_CONTENT_TYPE,
        }
      : ASSETS.get(path);
  if (asset !== undefined) {
    if (method !== "GET" && method !== "HEAD") {
      sendProblem(res, "method-not-allowed", {
        head,
        allow: "GET, HEAD",
        reason: "method",
      });
      return;
    }
    sendAsset(res, asset, head);
    return;
  }

  // Browsers request this conventional icon even though no icon asset is shipped.
  if (path === "/favicon.ico") {
    if (method !== "GET" && method !== "HEAD") {
      sendProblem(res, "method-not-allowed", {
        head,
        allow: "GET, HEAD",
        reason: "method",
      });
      return;
    }
    res.writeHead(204, securityHeaders("image/x-icon"));
    res.end();
    return;
  }

  if (path === "/api/v1/ui" || path === "/api/v1/reports/global") {
    if (method !== "GET") {
      sendProblem(res, "method-not-allowed", {
        head,
        allow: "GET",
        reason: "method",
      });
      return;
    }
    if (!isAuthorized(state, req)) {
      sendProblem(res, "unauthorized", { head, reason: "bearer" });
      return;
    }
    const range = parseRangeQuery(search);
    if (!range.ok) {
      sendProblem(res, "invalid-range", { head, reason: "range" });
      return;
    }
    if (path === "/api/v1/ui") {
      sendJson(res, await state.context.loadUi(range.intent));
    } else {
      sendJson(res, await state.context.loadGlobal(range.intent));
    }
    return;
  }

  if (path.startsWith("/api/v1/reports/sessions/")) {
    if (method !== "GET") {
      sendProblem(res, "method-not-allowed", {
        head,
        allow: "GET",
        reason: "method",
      });
      return;
    }
    if (!isAuthorized(state, req)) {
      sendProblem(res, "unauthorized", { head, reason: "bearer" });
      return;
    }
    // Exactly one bounded segment: no slash, no decoding, no filesystem path.
    const segments = path.split("/");
    const sessionId = segments.length === 6 ? segments[5] : "";
    if (!SESSION_ID.test(sessionId)) {
      sendProblem(res, "not-found", { head, reason: "session-id" });
      return;
    }
    const decision = sessionQueryDecision(search);
    if (decision !== "none") {
      sendProblem(res, decision, { head, reason: "session-query" });
      return;
    }
    const report = await state.context.loadSession(sessionId);
    if (report === undefined) {
      sendProblem(res, "not-found", { head, reason: "session" });
      return;
    }
    sendJson(res, report);
    return;
  }

  sendProblem(res, "not-found", { head, reason: "route" });
}

function dispatch(
  state: Running,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  void handleRequest(state, req, res).catch((error: unknown) => {
    try {
      if (res.headersSent) {
        res.end();
        return;
      }
      sendProblem(res, "internal-error", {
        head: req.method === "HEAD",
        reason: error instanceof Error ? error.message : undefined,
      });
    } catch {
      // The socket is already gone; there is nothing safe left to write.
    }
  });
}

async function startServer(context: InspectorServerContext): Promise<Startup> {
  const state: Running = {
    // Node's own missing-Host refusal is a bare 400; letting the request reach
    // this module keeps every refusal in the one bounded Problem Details shape.
    server: createServer({ requireHostHeader: false }),
    port: 0,
    origin: "",
    token: randomBytes(32).toString("base64url"),
    context,
    inspector: {
      port: 0,
      origin: "",
      bootstrapUrl: () => `${state.origin}/#token=${state.token}`,
      close: () => closeServer(state.server, state),
    },
  };
  state.server.on("request", (req, res) => dispatch(state, req, res));
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    state.server.once("error", onError);
    state.server.listen(0, "127.0.0.1", () => {
      state.server.off("error", onError);
      resolve();
    });
  }).catch((error: unknown) => {
    logDiagnostic({
      phase: "startup",
      code: "listen",
      reason: error instanceof Error ? error.message : undefined,
    });
    throw error;
  });
  const address = state.server.address();
  if (address === null || typeof address === "string") {
    await closeServer(state.server, state);
    throw new Error("loopback server did not expose a TCP address");
  }
  state.port = address.port;
  state.origin = `http://127.0.0.1:${state.port}`;
  state.inspector.port = state.port;
  state.inspector.origin = state.origin;
  // Runtime listener errors are swallowed: they must never reach Pi.
  state.server.on("error", (error: Error) => {
    logDiagnostic({
      phase: "runtime",
      code: "listener",
      reason: error.message,
    });
  });
  running = state;
  return {
    inspector: state.inspector,
    setContext: (next) => {
      state.context = next;
    },
  };
}

async function closeServer(server: Server, state?: Running): Promise<void> {
  if (state !== undefined && running === state) {
    running = undefined;
  }
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeIdleConnections();
  });
}

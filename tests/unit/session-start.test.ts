import assert from "node:assert/strict";
import { test } from "node:test";

type SessionManager = {
  getSessionId(): string;
  getSessionFile(): string | undefined;
};

type Register = (
  api: {
    on(
      event: "session_start",
      handler: (
        event: unknown,
        context: { sessionManager: SessionManager },
      ) => Promise<void>,
    ): void;
    appendEntry(type: string, data: unknown): void;
  },
  root: string,
  track: (input: {
    root: string;
    sessionId: string;
    appendEntry(type: string, data: unknown): void;
    revalidateSession(): boolean;
  }) => Promise<boolean>,
) => void;

async function loadRegister(): Promise<Register | undefined> {
  try {
    return (
      await import(
        new URL("../../src/pi/session-start.ts", import.meta.url).href
      )
    ).registerSessionStartTracking;
  } catch {
    return undefined;
  }
}

test("starts tracking from public session context without reading event payload", async () => {
  const registerSessionStartTracking = await loadRegister();
  assert.ok(registerSessionStartTracking);

  let handler:
    | ((
        event: unknown,
        context: { sessionManager: SessionManager },
      ) => Promise<void>)
    | undefined;
  const calls: string[] = [];
  registerSessionStartTracking(
    {
      on: (_event, registered) => {
        handler = registered;
      },
      appendEntry: (type, data) =>
        calls.push(`${type}:${JSON.stringify(data)}`),
    },
    "/agent/session-inspector/v1",
    async ({ root, sessionId, appendEntry }) => {
      calls.push(`${root}:${sessionId}`);
      appendEntry("session-inspector:tracking-start", { schemaVersion: 1 });
      return true;
    },
  );

  assert.ok(handler);
  await assert.doesNotReject(
    handler(
      { secret: "must-not-read" },
      {
        sessionManager: {
          getSessionFile: () => "/sessions/session-1.jsonl",
          getSessionId: () => "session-1",
        },
      },
    ),
  );
  assert.deepEqual(calls, [
    "/agent/session-inspector/v1:session-1",
    'session-inspector:tracking-start:{"schemaVersion":1}',
  ]);
});

test("passes a synchronous captured session ID and file revalidation to tracking", async () => {
  const registerSessionStartTracking = await loadRegister();
  assert.ok(registerSessionStartTracking);

  let handler:
    | ((
        event: unknown,
        context: { sessionManager: SessionManager },
      ) => Promise<void>)
    | undefined;
  let currentSessionId = "session-1";
  let currentSessionFile: string | undefined = "/sessions/session-1.jsonl";
  let revalidate: (() => boolean) | undefined;
  registerSessionStartTracking(
    {
      on: (_event, registered) => {
        handler = registered;
      },
      appendEntry: () => undefined,
    },
    "/agent/session-inspector/v1",
    async (input) => {
      revalidate = input.revalidateSession;
      return true;
    },
  );

  assert.ok(handler);
  await handler(undefined, {
    sessionManager: {
      getSessionId: () => currentSessionId,
      getSessionFile: () => currentSessionFile,
    },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.ok(revalidate);
  assert.equal(revalidate(), true);

  currentSessionId = "session-2";
  currentSessionFile = "/sessions/session-2.jsonl";
  assert.equal(revalidate(), false);
});

test("does nothing for ephemeral sessions without a session file", async () => {
  const registerSessionStartTracking = await loadRegister();
  assert.ok(registerSessionStartTracking);

  let handler:
    | ((
        event: unknown,
        context: { sessionManager: SessionManager },
      ) => Promise<void>)
    | undefined;
  let tracked = false;
  let appended = false;
  registerSessionStartTracking(
    {
      on: (_event, registered) => {
        handler = registered;
      },
      appendEntry: () => {
        appended = true;
      },
    },
    "/agent/session-inspector/v1",
    async () => {
      tracked = true;
      return true;
    },
  );

  assert.ok(handler);
  await assert.doesNotReject(
    handler(undefined, {
      sessionManager: {
        getSessionFile: () => undefined,
        getSessionId: () => {
          throw new Error("must not read ephemeral session ID");
        },
      },
    }),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(tracked, false);
  assert.equal(appended, false);
});

test("returns before a tracker promise settles", async () => {
  const registerSessionStartTracking = await loadRegister();
  assert.ok(registerSessionStartTracking);

  let handler:
    | ((
        event: unknown,
        context: { sessionManager: SessionManager },
      ) => Promise<void>)
    | undefined;
  registerSessionStartTracking(
    {
      on: (_event, registered) => {
        handler = registered;
      },
      appendEntry: () => undefined,
    },
    "/agent/session-inspector/v1",
    async () => new Promise(() => {}),
  );

  assert.ok(handler);
  let settled = false;
  void handler(undefined, {
    sessionManager: {
      getSessionFile: () => "/sessions/session-1.jsonl",
      getSessionId: () => "session-1",
    },
  }).then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, true);
});

test("swallows session lookup and tracking failures", async () => {
  const registerSessionStartTracking = await loadRegister();
  assert.ok(registerSessionStartTracking);

  let handler:
    | ((
        event: unknown,
        context: { sessionManager: SessionManager },
      ) => Promise<void>)
    | undefined;
  registerSessionStartTracking(
    {
      on: (_event, registered) => {
        handler = registered;
      },
      appendEntry: () => undefined,
    },
    "/agent/session-inspector/v1",
    async () => {
      throw new Error("storage unavailable");
    },
  );

  assert.ok(handler);
  await assert.doesNotReject(
    handler(undefined, {
      sessionManager: {
        getSessionFile: () => "/sessions/session-1.jsonl",
        getSessionId: () => {
          throw new Error("unavailable");
        },
      },
    }),
  );
});

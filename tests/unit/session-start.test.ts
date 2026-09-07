import assert from "node:assert/strict";
import { test } from "node:test";

type Register = (
  api: {
    on(
      event: "session_start",
      handler: (
        event: unknown,
        context: { sessionManager: { getSessionId(): string } },
      ) => Promise<void>,
    ): void;
    appendEntry(type: string, data: unknown): void;
  },
  root: string,
  track: (input: {
    root: string;
    sessionId: string;
    appendEntry(type: string, data: unknown): void;
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
        context: { sessionManager: { getSessionId(): string } },
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
      { sessionManager: { getSessionId: () => "session-1" } },
    ),
  );
  assert.deepEqual(calls, [
    "/agent/session-inspector/v1:session-1",
    'session-inspector:tracking-start:{"schemaVersion":1}',
  ]);
});

test("returns before a tracker promise settles", async () => {
  const registerSessionStartTracking = await loadRegister();
  assert.ok(registerSessionStartTracking);

  let handler:
    | ((
        event: unknown,
        context: { sessionManager: { getSessionId(): string } },
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
    sessionManager: { getSessionId: () => "session-1" },
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
        context: { sessionManager: { getSessionId(): string } },
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
        getSessionId: () => {
          throw new Error("unavailable");
        },
      },
    }),
  );
});

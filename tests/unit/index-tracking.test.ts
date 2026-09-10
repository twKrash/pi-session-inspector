import assert from "node:assert/strict";
import { test } from "node:test";

type SessionManager = {
  getSessionId(): string;
  getSessionFile(): string | undefined;
  getSessionDir(): string;
};

type SessionStartApi = {
  on(
    event: "session_start",
    handler: (
      event: unknown,
      context: { sessionManager: SessionManager },
    ) => Promise<void>,
  ): void;
  appendEntry(type: string, data: unknown): void;
};

type RegisterTracking = (
  api: SessionStartApi,
  options: {
    agentDir: string;
    track(input: {
      root: string;
      sessionId: string;
      appendEntry(type: string, data: unknown): void;
    }): Promise<boolean>;
    setupSessionWal(input: {
      root: string;
      sessionId: string;
      api: unknown;
    }): Promise<void>;
  },
) => void;

async function loadRegisterTracking(): Promise<RegisterTracking | undefined> {
  try {
    return (await import(new URL("../../src/index.ts", import.meta.url).href))
      .registerTracking;
  } catch {
    return undefined;
  }
}

const durableManager = (): SessionManager => ({
  getSessionId: () => "session-1",
  getSessionFile: () => "/sessions/session-1.jsonl",
  getSessionDir: () => "/sessions",
});

test("wires session-start tracking beneath Pi's public agent directory", async () => {
  const registerTracking = await loadRegisterTracking();
  assert.ok(registerTracking);

  let handler:
    | ((
        event: unknown,
        context: { sessionManager: SessionManager },
      ) => Promise<void>)
    | undefined;
  const calls: string[] = [];
  const api: SessionStartApi = {
    on: (_event, registered) => {
      handler = registered;
    },
    appendEntry: (type, data) => calls.push(`${type}:${JSON.stringify(data)}`),
  };
  registerTracking(api, {
    agentDir: "/agent",
    track: async ({ root, sessionId, appendEntry }) => {
      calls.push(`${root}:${sessionId}`);
      appendEntry("session-inspector:tracking-start", { schemaVersion: 1 });
      return true;
    },
    setupSessionWal: async ({ root, sessionId, api: setupApi }) => {
      assert.equal(setupApi, api);
      calls.push(`setup:${root}:${sessionId}`);
    },
  });

  assert.ok(handler);
  await handler(undefined, { sessionManager: durableManager() });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [
    "/agent/session-inspector/v1:session-1",
    'session-inspector:tracking-start:{"schemaVersion":1}',
    "setup:/agent/session-inspector/v1:session-1",
  ]);
});

test("does not set up a WAL when tracking is not promoted", async () => {
  const registerTracking = await loadRegisterTracking();
  assert.ok(registerTracking);

  let handler:
    | ((
        event: unknown,
        context: { sessionManager: SessionManager },
      ) => Promise<void>)
    | undefined;
  let setups = 0;
  registerTracking(
    {
      on: (_event, registered) => {
        handler = registered;
      },
      appendEntry: () => {},
    },
    {
      agentDir: "/agent",
      track: async () => false,
      setupSessionWal: async () => {
        setups += 1;
      },
    },
  );

  assert.ok(handler);
  await handler(undefined, { sessionManager: durableManager() });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(setups, 0);
});

test("does not set up a WAL when tracking rejects", async () => {
  const registerTracking = await loadRegisterTracking();
  assert.ok(registerTracking);

  let handler:
    | ((
        event: unknown,
        context: { sessionManager: SessionManager },
      ) => Promise<void>)
    | undefined;
  let setups = 0;
  registerTracking(
    {
      on: (_event, registered) => {
        handler = registered;
      },
      appendEntry: () => {},
    },
    {
      agentDir: "/agent",
      track: async () => {
        throw new Error("storage unavailable");
      },
      setupSessionWal: async () => {
        setups += 1;
      },
    },
  );

  assert.ok(handler);
  await assert.doesNotReject(
    handler(undefined, { sessionManager: durableManager() }),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(setups, 0);
});

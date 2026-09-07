import assert from "node:assert/strict";
import { test } from "node:test";

type RegisterTracking = (
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
  options: {
    agentDir: string;
    track(input: {
      root: string;
      sessionId: string;
      appendEntry(type: string, data: unknown): void;
    }): Promise<boolean>;
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

test("wires session-start tracking beneath Pi's public agent directory", async () => {
  const registerTracking = await loadRegisterTracking();
  assert.ok(registerTracking);

  let handler:
    | ((
        event: unknown,
        context: { sessionManager: { getSessionId(): string } },
      ) => Promise<void>)
    | undefined;
  const calls: string[] = [];
  registerTracking(
    {
      on: (_event, registered) => {
        handler = registered;
      },
      appendEntry: (type, data) =>
        calls.push(`${type}:${JSON.stringify(data)}`),
    },
    {
      agentDir: "/agent",
      track: async ({ root, sessionId, appendEntry }) => {
        calls.push(`${root}:${sessionId}`);
        appendEntry("session-inspector:tracking-start", { schemaVersion: 1 });
        return true;
      },
    },
  );

  assert.ok(handler);
  await handler(undefined, {
    sessionManager: { getSessionId: () => "session-1" },
  });
  assert.deepEqual(calls, [
    "/agent/session-inspector/v1:session-1",
    'session-inspector:tracking-start:{"schemaVersion":1}',
  ]);
});

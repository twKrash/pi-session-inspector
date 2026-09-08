import assert from "node:assert/strict";
import { test } from "node:test";

async function loadSetupSessionWal() {
  return import(
    new URL("../../src/pi/session-wal.ts", import.meta.url).href
  ).catch(() => ({}));
}

test("creates a session-local WAL only after tracking succeeds", async () => {
  const mod = await loadSetupSessionWal();
  assert.ok(mod.setupSessionWal);
  const calls: string[] = [];
  await mod.setupSessionWal(
    { root: "/inspector", sessionId: "session-1", api: {} },
    {
      createWriter: async ({ root }: { root: string }) => {
        calls.push(root);
        return {};
      },
      registerLive: (_api: unknown, _writer: unknown) => calls.push("live"),
    },
  );
  assert.deepEqual(calls, ["/inspector/sessions/session-1", "live"]);
});

test("swallows writer creation failure without registering live observation", async () => {
  const mod = await loadSetupSessionWal();
  assert.ok(mod.setupSessionWal);
  let registered = false;

  await assert.doesNotReject(
    mod.setupSessionWal(
      { root: "/inspector", sessionId: "session-1", api: {} },
      {
        createWriter: async () => {
          throw new Error("storage unavailable");
        },
        registerLive: () => {
          registered = true;
        },
      },
    ),
  );
  assert.equal(registered, false);
});

test("swallows live registration failure", async () => {
  const mod = await loadSetupSessionWal();
  assert.ok(mod.setupSessionWal);

  await assert.doesNotReject(
    mod.setupSessionWal(
      { root: "/inspector", sessionId: "session-1", api: {} },
      {
        createWriter: async () => ({}),
        registerLive: () => {
          throw new Error("observer unavailable");
        },
      },
    ),
  );
});

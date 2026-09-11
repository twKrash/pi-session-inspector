import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { maintainSession } from "../../src/storage/maintenance.ts";
import { createWalWriter } from "../../src/storage/wal.ts";

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

test("schedules bounded maintenance after an active writer rotates its daily segment", async () => {
  const mod = await loadSetupSessionWal();
  assert.ok(mod.setupSessionWal);
  let onSegmentRotation: (() => void) | undefined;
  const scheduled: unknown[] = [];

  await mod.setupSessionWal(
    {
      root: "/inspector",
      sessionId: "session-1",
      sessionFile: "/pi/session-1.jsonl",
      api: {},
    },
    {
      createWriter: async ({
        onSegmentRotation: callback,
      }: {
        root: string;
        onSegmentRotation?(): void;
      }) => {
        onSegmentRotation = callback;
        return {};
      },
      registerLive: () => undefined,
      scheduleMaintenance: (input: unknown) => scheduled.push(input),
    },
  );

  onSegmentRotation?.();
  onSegmentRotation?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(scheduled, [
    {
      root: "/inspector",
      sessionId: "session-1",
      sessionFile: "/pi/session-1.jsonl",
    },
  ]);
});

test("prunes an expired checkpointed segment after an active session rotates", async () => {
  const mod = await loadSetupSessionWal();
  assert.ok(mod.setupSessionWal);

  const root = await mkdtemp(join(tmpdir(), "inspector-session-wal-"));
  const sessionId = "session-1";
  const source = join(root, "pi-session.jsonl");
  const expired = join(
    root,
    "sessions",
    sessionId,
    "wal",
    "old-writer",
    "2026-08-01.jsonl",
  );
  let current = new Date("2026-09-09T23:59:59.000Z");
  let writer: Awaited<ReturnType<typeof createWalWriter>> | undefined;
  try {
    await mkdir(join(root, "sessions", sessionId, "wal", "old-writer"), {
      recursive: true,
    });
    await writeFile(
      expired,
      '{"eventId":"old-1","timestamp":"2026-08-01T12:00:00.000Z","kind":"live_timing","timing":{"category":"tool","status":"running","confidence":"live","startedAt":"2026-08-01T12:00:00.000Z"},"writerId":"old-writer","writerSequence":1}\n',
    );
    await writeFile(`${expired}.closed`, "1\n");
    await writeFile(
      source,
      '{"id":"marker","parentId":null,"timestamp":"2026-09-01T00:00:00.000Z","type":"custom","customType":"session-inspector:tracking-start","data":{"schemaVersion":1}}\n',
    );

    let finished: (() => void) | undefined;
    const maintained = new Promise<void>((resolve) => {
      finished = resolve;
    });
    await mod.setupSessionWal(
      { root, sessionId, sessionFile: source, api: {} },
      {
        createWriter: async ({
          root: writerRoot,
          onSegmentRotation,
        }: {
          root: string;
          onSegmentRotation(): void;
        }) => {
          writer = await createWalWriter({
            root: writerRoot,
            writerId: "active-writer",
            now: () => current,
            onSegmentRotation,
          });
          return writer;
        },
        registerLive: () => undefined,
        scheduleMaintenance: (input: {
          root: string;
          sessionId: string;
          sessionFile: string;
        }) => {
          void maintainSession({
            ...input,
            writerId: "maintenance-writer",
            now: () => current,
          }).then(() => finished?.());
        },
      },
    );
    assert.ok(writer);
    writer.append({
      eventId: "active-1",
      timestamp: current.toISOString(),
      kind: "live_timing",
      timing: {
        category: "tool",
        status: "running",
        confidence: "live",
        startedAt: current.toISOString(),
      },
    });
    await writer.flush();
    current = new Date("2026-09-10T00:00:00.000Z");
    writer.append({
      eventId: "active-2",
      timestamp: current.toISOString(),
      kind: "live_timing",
      timing: {
        category: "tool",
        status: "running",
        confidence: "live",
        startedAt: current.toISOString(),
      },
    });
    await writer.flush();

    await maintained;
    await assert.rejects(
      import("node:fs/promises").then(({ readFile }) => readFile(expired)),
      {
        code: "ENOENT",
      },
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test(
  "prunes an expired segment closed by idle UTC rotation while the owner is alive",
  {
    timeout: 5000,
  },
  async () => {
    const mod = await loadSetupSessionWal();
    assert.ok(mod.setupSessionWal);

    const root = await mkdtemp(join(tmpdir(), "inspector-session-wal-"));
    const sessionId = "session-1";
    const source = join(root, "pi-session.jsonl");
    const segment = join(
      root,
      "sessions",
      sessionId,
      "wal",
      "active-writer",
      "2026-09-07.jsonl",
    );
    let current = new Date("2026-09-07T23:59:59.800Z");
    let writer: Awaited<ReturnType<typeof createWalWriter>> | undefined;
    try {
      await mkdir(join(root, "sessions", sessionId), { recursive: true });
      await writeFile(
        source,
        '{"id":"marker","parentId":null,"timestamp":"2026-09-07T00:00:00.000Z","type":"custom","customType":"session-inspector:tracking-start","data":{"schemaVersion":1}}\n',
      );

      let finished: (() => void) | undefined;
      const maintained = new Promise<void>((resolve) => {
        finished = resolve;
      });
      await mod.setupSessionWal(
        { root, sessionId, sessionFile: source, api: {} },
        {
          createWriter: async ({
            root: writerRoot,
            onSegmentRotation,
          }: {
            root: string;
            onSegmentRotation(): void;
          }) => {
            writer = await createWalWriter({
              root: writerRoot,
              writerId: "active-writer",
              now: () => current,
              onSegmentRotation,
            });
            return writer;
          },
          registerLive: () => undefined,
          scheduleMaintenance: (input: {
            root: string;
            sessionId: string;
            sessionFile: string;
          }) => {
            void maintainSession({
              ...input,
              writerId: "maintenance-writer",
              now: () => new Date("2026-09-21T12:00:00.000Z"),
            }).then(() => finished?.());
          },
        },
      );
      assert.ok(writer);
      writer.append({
        eventId: "active-1",
        timestamp: current.toISOString(),
        kind: "live_timing",
        timing: {
          category: "tool",
          status: "running",
          confidence: "live",
          startedAt: current.toISOString(),
        },
      });
      await writer.flush();

      current = new Date("2026-09-08T00:00:00.000Z");
      // The idle-rotation timer is unref'd on purpose; keep the test loop alive
      // until the rotation fires and maintenance finishes.
      const keepAlive = setInterval(() => {}, 1_000);
      try {
        await maintained;
      } finally {
        clearInterval(keepAlive);
      }

      await assert.rejects(readFile(segment), { code: "ENOENT" });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  },
);

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

test("registers live counter producers with the session writer and never throws", async () => {
  const mod = await loadSetupSessionWal();
  assert.ok(mod.setupSessionWal);
  const registered: string[] = [];
  await mod.setupSessionWal(
    {
      root: "/root",
      sessionId: "session-a",
      sessionFile: "/src.jsonl",
      api: {},
    },
    {
      createWriter: async () => ({
        appendTelemetry: () => {},
        flush: async () => {},
      }),
      registerLive: () => registered.push("timing"),
      registerLiveCounters: (
        _api: unknown,
        _writer: unknown,
        context: { sessionId: string },
      ) => {
        registered.push(`counters:${context.sessionId}`);
      },
      scheduleMaintenance: () => {},
    },
  );
  assert.deepEqual(registered, ["timing", "counters:session-a"]);
});

test("swallows live counter registration failure", async () => {
  const mod = await loadSetupSessionWal();
  assert.ok(mod.setupSessionWal);

  await assert.doesNotReject(
    mod.setupSessionWal(
      { root: "/inspector", sessionId: "session-1", api: {} },
      {
        createWriter: async () => ({}),
        registerLive: () => undefined,
        registerLiveCounters: () => {
          throw new Error("counter observer unavailable");
        },
      },
    ),
  );
});

test("passes a bounded inventory-name lookup to live counter producers", async () => {
  const mod = await loadSetupSessionWal();
  assert.ok(mod.setupSessionWal);
  let inventoryNames: (() => ReadonlySet<string>) | undefined;

  await mod.setupSessionWal(
    { root: "/inspector", sessionId: "session-1", api: {} },
    {
      createWriter: async () => ({}),
      registerLive: () => undefined,
      readInventoryNames: () => new Set(["council-mode"]),
      registerLiveCounters: (
        _api: unknown,
        _writer: unknown,
        context: { inventoryNames(): ReadonlySet<string> },
      ) => {
        inventoryNames = context.inventoryNames;
      },
    },
  );

  assert.ok(inventoryNames);
  assert.deepEqual([...inventoryNames()], ["council-mode"]);
});

test("defaults the live counter inventory lookup to an empty set", async () => {
  const mod = await loadSetupSessionWal();
  assert.ok(mod.setupSessionWal);
  let names: ReadonlySet<string> | undefined;

  await mod.setupSessionWal(
    { root: "/inspector", sessionId: "session-1", api: {} },
    {
      createWriter: async () => ({}),
      registerLive: () => undefined,
      registerLiveCounters: (
        _api: unknown,
        _writer: unknown,
        context: { inventoryNames(): ReadonlySet<string> },
      ) => {
        names = context.inventoryNames();
      },
    },
  );

  assert.deepEqual(names === undefined ? undefined : [...names], []);
});

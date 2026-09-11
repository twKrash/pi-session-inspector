import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { readInventory } from "../../src/integrations/inventory.ts";
import {
  boundInventorySnapshot,
  parseInventorySnapshot,
  readInventorySnapshot,
  refreshInventorySnapshot,
  writeInventorySnapshot,
} from "../../src/storage/inventory-snapshot.ts";

const BASE = {
  schemaVersion: 1,
  commands: [],
  skills: [],
  resources: [],
  toolSources: {},
};

function commandRow(overrides: Record<string, unknown> = {}) {
  return {
    name: "cmd",
    source: "extension",
    sourceLabel: "local",
    scope: "user",
    origin: "top-level",
    ...overrides,
  };
}

function resourceRow(overrides: Record<string, unknown> = {}) {
  return {
    sourceLabel: "local",
    scope: "user",
    origin: "top-level",
    commands: 0,
    skills: 0,
    prompts: 0,
    tools: 0,
    ...overrides,
  };
}

test("writes, hash-compares, and validates the bounded inventory snapshot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-inventory-"));
  const snapshot = readInventory(
    [
      {
        name: "ponytail",
        source: "extension",
        sourceInfo: {
          path: "/home/dev/x",
          source: "npm:ponytail",
          scope: "user",
          origin: "package",
        },
      },
    ],
    [],
  );

  assert.equal(await readInventorySnapshot(directory), undefined);
  await refreshInventorySnapshot({ directory, snapshot });
  const first = await stat(join(directory, "inventory.json"));
  await refreshInventorySnapshot({ directory, snapshot });
  const second = await stat(join(directory, "inventory.json"));
  assert.equal(
    first.mtimeMs,
    second.mtimeMs,
    "unchanged snapshot must not rewrite",
  );

  const read = await readInventorySnapshot(directory);
  assert.deepEqual(read, snapshot);

  await writeFile(join(directory, "inventory.json"), "{ not json");
  assert.equal(await readInventorySnapshot(directory), undefined);

  const oversize = { ...snapshot, commands: [] };
  await writeFile(
    join(directory, "inventory.json"),
    JSON.stringify({ ...oversize, padding: "x".repeat(70 * 1024) }),
  );
  assert.equal(await readInventorySnapshot(directory), undefined);
});

test("rejects snapshots beyond the reader's array caps", () => {
  assert.equal(
    parseInventorySnapshot({
      ...BASE,
      commands: Array.from({ length: 257 }, (_, i) =>
        commandRow({ name: `cmd-${i}` }),
      ),
    }),
    undefined,
  );
  assert.equal(
    parseInventorySnapshot({
      ...BASE,
      skills: Array.from({ length: 129 }, (_, i) => ({ name: `skill-${i}` })),
    }),
    undefined,
  );
  assert.equal(
    parseInventorySnapshot({
      ...BASE,
      resources: Array.from({ length: 65 }, () => resourceRow()),
    }),
    undefined,
  );
});

test("rejects a snapshot with a non-grammar name", () => {
  assert.equal(
    parseInventorySnapshot({
      ...BASE,
      commands: [commandRow({ name: "/abs/path" })],
    }),
    undefined,
  );
  assert.equal(
    parseInventorySnapshot({
      ...BASE,
      commands: [commandRow({ name: "white space" })],
    }),
    undefined,
  );
  assert.equal(
    parseInventorySnapshot({ ...BASE, toolSources: { "../escape": "local" } }),
    undefined,
  );
});

test("re-sanitizes tampered labels and drops unknown fields on read", () => {
  const parsed = parseInventorySnapshot({
    schemaVersion: 1,
    commands: [
      commandRow({
        sourceLabel: "file:///home/dev/secret-plugin",
        unexpected: "ignored",
      }),
    ],
    skills: [
      {
        name: "skill-1",
        sourceLabel: "/home/dev/secret",
        scope: "user",
        origin: "package",
      },
    ],
    resources: [
      resourceRow({ sourceLabel: "C:\\Users\\dev\\secret", commands: 1 }),
    ],
    toolSources: { read: "/home/dev/tools/read.ts" },
    schemaExtension: { anything: true },
  });
  const expected = {
    schemaVersion: 1,
    commands: [commandRow({ sourceLabel: "other" })],
    skills: [
      {
        name: "skill-1",
        sourceLabel: "other",
        scope: "user",
        origin: "package",
      },
    ],
    resources: [resourceRow({ sourceLabel: "other", commands: 1 })],
    toolSources: { read: "other" },
  };
  assert.deepEqual(parsed, expected);
  // Stable: re-parsing the sanitized result is a no-op.
  assert.deepEqual(parseInventorySnapshot(parsed), parsed);
});

test("drops a description that fails the bounded privacy policy", () => {
  const parsed = parseInventorySnapshot({
    ...BASE,
    commands: [
      commandRow({ name: "safe", description: "lists files" }),
      commandRow({ name: "secret", description: "api key sk-abcdef123" }),
      commandRow({ name: "path", description: "read /home/dev/notes" }),
      commandRow({ name: "long", description: "x".repeat(121) }),
    ],
  });
  assert.ok(parsed);
  assert.deepEqual(
    parsed.commands.map((row) => row.description),
    ["lists files", undefined, undefined, undefined],
  );
});

test("writes the snapshot with user-only file mode", async () => {
  if (process.platform === "win32") return;
  const directory = await mkdtemp(join(tmpdir(), "inspector-inventory-"));
  const snapshot = readInventory([], []);
  assert.equal(await writeInventorySnapshot(directory, snapshot), true);
  assert.equal(
    (await stat(join(directory, "inventory.json"))).mode & 0o777,
    0o600,
  );
});

test("a snapshot at the array caps writes and reads back deep-equal", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-inventory-"));
  const snapshot = parseInventorySnapshot({
    schemaVersion: 1,
    commands: Array.from({ length: 256 }, (_, i) =>
      commandRow({ name: `cmd-${i}` }),
    ),
    skills: Array.from({ length: 128 }, (_, i) => ({ name: `skill-${i}` })),
    resources: Array.from({ length: 64 }, (_, i) =>
      resourceRow({ commands: i }),
    ),
    toolSources: Object.fromEntries(
      Array.from({ length: 256 }, (_, i) => [`tool-${i}`, "local"]),
    ),
  });
  assert.ok(snapshot);
  assert.equal(await writeInventorySnapshot(directory, snapshot), true);
  const read = await readInventorySnapshot(directory);
  assert.notEqual(read, undefined);
  assert.deepEqual(read, snapshot);
});

test("bounds an oversized write so the reader can always read it back", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-inventory-"));
  const snapshot = parseInventorySnapshot({
    schemaVersion: 1,
    commands: Array.from({ length: 256 }, (_, i) =>
      commandRow({ name: `cmd-${i}`, description: "d".repeat(120) }),
    ),
    skills: Array.from({ length: 128 }, (_, i) => ({
      name: `skill-${i}`,
      description: "d".repeat(120),
    })),
    resources: Array.from({ length: 64 }, () => resourceRow()),
    toolSources: Object.fromEntries(
      Array.from({ length: 256 }, (_, i) => [`tool-${i}`, "local"]),
    ),
  });
  assert.ok(snapshot);
  assert.ok(
    Buffer.byteLength(JSON.stringify(snapshot), "utf8") > 64 * 1024,
    "fixture must exceed the reader bound",
  );
  const bounded = boundInventorySnapshot(snapshot);
  assert.ok(Buffer.byteLength(JSON.stringify(bounded), "utf8") <= 64 * 1024);
  assert.equal(await writeInventorySnapshot(directory, snapshot), true);
  const read = await readInventorySnapshot(directory);
  assert.notEqual(read, undefined);
  assert.deepEqual(read, bounded);
  assert.deepEqual(boundInventorySnapshot(bounded), bounded);
});

test("an oversized snapshot does not churn on refresh", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-inventory-"));
  const snapshot = parseInventorySnapshot({
    schemaVersion: 1,
    commands: Array.from({ length: 256 }, (_, i) =>
      commandRow({ name: `cmd-${i}`, description: "d".repeat(120) }),
    ),
    skills: Array.from({ length: 128 }, (_, i) => ({
      name: `skill-${i}`,
      description: "d".repeat(120),
    })),
    resources: Array.from({ length: 64 }, () => resourceRow()),
    toolSources: {},
  });
  assert.ok(snapshot);
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot), "utf8") > 64 * 1024);
  await refreshInventorySnapshot({ directory, snapshot });
  const first = await stat(join(directory, "inventory.json"));
  await refreshInventorySnapshot({ directory, snapshot });
  const second = await stat(join(directory, "inventory.json"));
  assert.equal(
    first.mtimeMs,
    second.mtimeMs,
    "bounded snapshot must not rewrite",
  );
  assert.notEqual(await readInventorySnapshot(directory), undefined);
});

test("a failed inventory producer read preserves stored resource counts", async () => {
  const { readSessionInventory, refreshSessionInventory } = await import(
    "../../src/pi/session-start.ts"
  );
  const { maintainSession } = await import("../../src/storage/maintenance.ts");
  const { readCheckpoint } = await import("../../src/storage/checkpoint.ts");
  const root = await mkdtemp(join(tmpdir(), "inspector-inventory-"));
  const directory = join(root, "sessions", "session-1");
  const source = join(root, "pi.jsonl");
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(
      source,
      [
        '{"type":"session","version":3,"id":"session-1","timestamp":"2026-01-01T00:00:00Z"}',
        '{"id":"marker","parentId":null,"timestamp":"2026-01-01T00:00:00Z","type":"custom","customType":"session-inspector:tracking-start","data":{"schemaVersion":1}}',
        "",
      ].join("\n"),
    );
    assert.equal(
      (
        await maintainSession({
          root,
          sessionId: "session-1",
          sessionFile: source,
          writerId: "m1",
          inventoryCounts: { commands: 3, skills: 1 },
        })
      ).status,
      "available",
    );
    assert.deepEqual(
      (await readCheckpoint({ directory }))?.aggregates.resourceCounts,
      { commands: 3, skills: 1 },
    );

    const throwing = {
      getCommands() {
        throw new Error("transient producer failure");
      },
      getAllTools() {
        return [];
      },
    };
    assert.equal(readSessionInventory(throwing), undefined);
    assert.equal(
      await refreshSessionInventory({
        api: throwing,
        root,
        sessionId: "session-1",
      }),
      undefined,
    );
    // Nothing fabricated: no snapshot is written and no zero counts exist.
    assert.equal((await readdir(directory)).includes("inventory.json"), false);

    // Omitted counts preserve the previously stored real values.
    assert.equal(
      (
        await maintainSession({
          root,
          sessionId: "session-1",
          sessionFile: source,
          writerId: "m2",
        })
      ).status,
      "available",
    );
    assert.deepEqual(
      (await readCheckpoint({ directory }))?.aggregates.resourceCounts,
      { commands: 3, skills: 1 },
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

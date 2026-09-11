import assert from "node:assert/strict";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { readInventory } from "../../src/integrations/inventory.ts";
import {
  readInventorySnapshot,
  refreshInventorySnapshot,
} from "../../src/storage/inventory-snapshot.ts";

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
  assert.equal(first.mtimeMs, second.mtimeMs, "unchanged snapshot must not rewrite");

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

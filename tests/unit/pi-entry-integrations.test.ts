import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { SessionEntry } from "../../src/core/events.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";
import { readPiEntryEvidence } from "../../src/integrations/pi-entries.ts";

const fixturePath = new URL(
  "../fixtures/integrations/pi-entries.jsonl",
  import.meta.url,
);

test("reads allowlisted, sanitized Pi-entry integration evidence", async () => {
  const fixture = await readFile(fixturePath, "utf8");
  const { entries } = parseSessionJsonl(fixture);

  const rows = readPiEntryEvidence(entries);

  assert.deepEqual(
    rows.map((row) => row.integration),
    ["context", "rtk", "mode", "permission", "lens"],
  );
  assert.deepEqual(
    rows.find((row) => row.integration === "context"),
    {
      integration: "context",
      version: 1,
      state: "supported",
      counters: { calls: 1 },
    },
  );
  assert.deepEqual(
    rows.find((row) => row.integration === "rtk"),
    {
      integration: "rtk",
      version: 1,
      state: "supported",
      counters: {
        compactions: 1,
        sourceChars: 100,
        compactedChars: 60,
        sourceLines: 10,
        compactedLines: 6,
        truncated: false,
      },
    },
  );
  assert.equal(
    rows.find((row) => row.integration === "rtk")?.state,
    "supported",
  );
  assert.deepEqual(rows.find((row) => row.integration === "mode")?.counters, {
    changes: 1,
  });
  assert.deepEqual(
    rows.find((row) => row.integration === "permission")?.counters,
    { events: 1, granted: 1 },
  );
  assert.deepEqual(rows.find((row) => row.integration === "lens")?.counters, {
    calls: 1,
  });
});

test("reports unknown supported-integration versions and omits unrelated entries", () => {
  const unknownContextEntry = {
    type: "custom",
    id: "context-unknown",
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    customType: "ctx_status",
    data: { schemaVersion: 99, active: true },
  } satisfies SessionEntry;
  const unrelatedEntry = {
    type: "custom",
    id: "other",
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    customType: "other",
    data: { schemaVersion: 1, active: true },
  } satisfies SessionEntry;

  assert.deepEqual(readPiEntryEvidence([unknownContextEntry]), [
    {
      integration: "context",
      version: 99,
      state: "unsupported",
    },
  ]);
  assert.deepEqual(readPiEntryEvidence([unrelatedEntry]), []);
});

test("never returns custom data or tool input/output", () => {
  const rows = readPiEntryEvidence([
    {
      type: "custom",
      id: "context-private",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      customType: "ctx_status",
      data: { schemaVersion: 1, active: true, private: "seeded-secret" },
    },
    {
      type: "message",
      id: "lens-private",
      parentId: null,
      timestamp: "2026-01-01T00:00:01.000Z",
      message: {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "tool-lens",
            name: "lens",
            arguments: { private: "seeded-secret" },
          },
        ],
      },
    },
  ]);

  assert.equal(JSON.stringify(rows).includes("seeded-secret"), false);
  assert.deepEqual(rows, [
    {
      integration: "context",
      version: 1,
      state: "supported",
      counters: { calls: 1 },
    },
    {
      integration: "lens",
      version: 1,
      state: "supported",
      counters: { calls: 1 },
    },
  ]);
});

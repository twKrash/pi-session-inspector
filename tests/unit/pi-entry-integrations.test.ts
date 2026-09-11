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

  assert.equal(
    JSON.stringify(rows).includes("raw-tool-result-sentinel"),
    false,
  );
  assert.deepEqual(
    rows.map((row) => row.integration),
    ["context", "rtk", "lens"],
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
  assert.deepEqual(rows.find((row) => row.integration === "lens")?.counters, {
    calls: 1,
  });
});

test("marks RTK v1 evidence unsupported when any required field is malformed", () => {
  const malformed = (id: string, rtkCompaction: Record<string, unknown>) =>
    ({
      type: "message",
      id,
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      message: { role: "toolResult", details: { rtkCompaction } },
    }) satisfies SessionEntry;

  assert.deepEqual(
    readPiEntryEvidence([
      malformed("rtk-missing", {
        schemaVersion: 1,
        sourceChars: 100,
        compactedChars: 60,
        sourceLines: 10,
        truncated: false,
      }),
    ]),
    [{ integration: "rtk", version: 1, state: "unsupported" }],
  );
  assert.deepEqual(
    readPiEntryEvidence([
      malformed("rtk-invalid", {
        schemaVersion: 1,
        sourceChars: 100,
        compactedChars: -1,
        sourceLines: 10,
        compactedLines: 6,
        truncated: false,
      }),
    ]),
    [{ integration: "rtk", version: 1, state: "unsupported" }],
  );
});

test("marks RTK evidence unsupported when aggregated counters overflow", () => {
  const rtk = (id: string, sourceChars: number) =>
    ({
      type: "message",
      id,
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      message: {
        role: "toolResult",
        details: {
          rtkCompaction: {
            schemaVersion: 1,
            sourceChars,
            compactedChars: 0,
            sourceLines: 0,
            compactedLines: 0,
            truncated: false,
          },
        },
      },
    }) satisfies SessionEntry;

  assert.deepEqual(
    readPiEntryEvidence([
      rtk("rtk-safe-limit", Number.MAX_SAFE_INTEGER),
      rtk("rtk-overflow", 1),
    ]),
    [{ integration: "rtk", version: 1, state: "unsupported" }],
  );
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

test("detects ctx_* tool calls as context evidence without retaining arguments", () => {
  const rows = readPiEntryEvidence([
    {
      type: "message",
      id: "ctx-tool-calls",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      message: {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "tool-ctx-execute",
            name: "ctx_execute",
            arguments: { command: "raw-tool-arg-sentinel" },
          },
          { type: "toolCall", id: "tool-ctx-search", name: "ctx_search" },
        ],
      },
    } satisfies SessionEntry,
  ]);

  assert.deepEqual(rows, [
    {
      integration: "context",
      version: 1,
      state: "supported",
      counters: { calls: 2 },
    },
  ]);
  assert.equal(JSON.stringify(rows).includes("raw-tool-arg-sentinel"), false);
});

test("counts one Context Mode invocation once when custom and tool evidence both observe it", () => {
  const rows = readPiEntryEvidence([
    {
      type: "custom",
      id: "context-1",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      customType: "ctx_status",
      data: { schemaVersion: 1, active: true },
    } satisfies SessionEntry,
    {
      type: "message",
      id: "ctx-tool-call",
      parentId: null,
      timestamp: "2026-01-01T00:00:01.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", id: "tool-ctx-execute", name: "ctx_execute" },
        ],
      },
    } satisfies SessionEntry,
  ]);

  assert.deepEqual(rows, [
    {
      integration: "context",
      version: 1,
      state: "supported",
      counters: { calls: 1 },
    },
  ]);
});

test("does not treat a non-ctx_ tool call as context evidence", () => {
  const rows = readPiEntryEvidence([
    {
      type: "message",
      id: "read-tool-call",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id: "tool-read", name: "read" }],
      },
    } satisfies SessionEntry,
  ]);

  assert.deepEqual(rows, []);
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

test("reads schema-less Ponytail and Caveman mode entries as independent evidence", async () => {
  const fixture = await readFile(
    new URL("../fixtures/pi/0.85.1/ponytail-caveman.jsonl", import.meta.url),
    "utf8",
  );
  const { entries } = parseSessionJsonl(fixture);

  const rows = readPiEntryEvidence(entries);

  assert.deepEqual(
    rows.map((row) => row.integration),
    ["ponytail", "caveman"],
  );
  assert.deepEqual(rows[0]?.counters, { changes: 2 });
  assert.deepEqual(rows[1]?.counters, { changes: 2 });
  assert.equal(
    rows.every((row) => row.state === "supported" && row.version === 1),
    true,
  );
  assert.equal(JSON.stringify(rows).includes("not-a-mode"), false);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";
import { buildGraphNodes } from "../../src/pi/graph.ts";

const header = JSON.stringify({
  type: "session",
  id: "s1",
  version: 3,
  timestamp: "2026-09-12T10:00:00.000Z",
});
const known = JSON.stringify({
  type: "message",
  id: "a",
  parentId: null,
  timestamp: "2026-09-12T10:00:01.000Z",
  message: { role: "user", content: [] },
});
const unknown = JSON.stringify({
  type: "future_widget",
  id: "b",
  parentId: "a",
  timestamp: "2026-09-12T10:00:02.000Z",
  widgetPayload: { secret: "never-retained" },
});
const leaf = JSON.stringify({
  type: "message",
  id: "c",
  parentId: "b",
  timestamp: "2026-09-12T10:00:03.000Z",
  message: { role: "assistant", content: [] },
});

test("unknown semantic entries keep a node but no payload", () => {
  const nodes = buildGraphNodes(
    [known, unknown, leaf].map((line) => JSON.parse(line)),
  );
  assert.deepEqual(
    nodes.map((n) => [
      n.entryId,
      n.parentId,
      n.appendOrdinal,
      n.semanticType.state,
    ]),
    [
      ["a", null, 0, "known"],
      ["b", "a", 1, "unknown"],
      ["c", "b", 2, "known"],
    ],
  );
  assert.equal(JSON.stringify(nodes).includes("secret"), false);
  // R12: unknown raw type text is dropped with the payload.
  assert.equal(JSON.stringify(nodes).includes("future_widget"), false);
});

test("adapter keeps header facts and graph nodes", () => {
  const parsed = parseSessionJsonl([header, known, unknown, leaf].join("\n"));
  assert.equal(parsed.formatVersion, 3);
  assert.equal(parsed.createdAt, "2026-09-12T10:00:00.000Z");
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.graphNodes.length, 3);
  assert.equal(parsed.unknownEntryCount, 1);
});

test("structurally invalid entries become no node", () => {
  const nodes = buildGraphNodes([
    { type: "message", id: "", parentId: null, timestamp: "t" },
    { type: "message", id: "x", parentId: 5, timestamp: "t" },
    { type: "message", id: "y", parentId: null, timestamp: "t" },
  ]);
  assert.deepEqual(
    nodes.map((n) => [n.entryId, n.appendOrdinal]),
    [
      // R13: ordinals are dense over accepted nodes, so rejected records
      // consume none.
      ["y", 0],
    ],
  );
});

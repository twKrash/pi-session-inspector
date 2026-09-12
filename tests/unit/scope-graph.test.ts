import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGraphNodes } from "../../src/pi/graph.ts";
import { isTrackingMarkerRecord, resolveScope } from "../../src/pi/scope.ts";

const marker = (id: string, parentId: string | null) => ({
  type: "custom",
  customType: "session-inspector:tracking-start",
  id,
  parentId,
  timestamp: "2026-09-12T10:00:00.000Z",
  data: { schemaVersion: 1 },
});
const node = (id: string, parentId: string | null, type = "message") => ({
  type,
  id,
  parentId,
  timestamp: "2026-09-12T10:00:01.000Z",
  message: { role: "user", content: [] },
});

const scopeOf = (
  records: Record<string, unknown>[],
  leafId: string | null,
  scope: "active" | "tree",
) => resolveScope(records, buildGraphNodes(records), leafId, scope);

test("unknown node between known nodes keeps active ancestry resolvable", () => {
  const records = [
    marker("m", null),
    node("a", "m"),
    node("b", "a", "future_widget"),
    node("c", "b"),
  ];
  const resolved = scopeOf(records, "c", "active");
  assert.equal(resolved.state, "available");
  assert.deepEqual(resolved.state === "available" ? resolved.entryIds : [], [
    "a",
    "b",
    "c",
  ]);
});

test("marker detection is exact: other custom entries are never the boundary", () => {
  const otherCustom = {
    type: "custom",
    customType: "ctx_execute",
    id: "x",
    parentId: null,
    timestamp: "2026-09-12T10:00:00.000Z",
    data: { schemaVersion: 1 },
  };
  const wrongVersion = { ...marker("m2", null), data: { schemaVersion: 2 } };
  assert.equal(isTrackingMarkerRecord(otherCustom), false);
  assert.equal(isTrackingMarkerRecord(wrongVersion), false);
  assert.deepEqual(
    scopeOf([otherCustom, wrongVersion, node("a", null)], "a", "tree"),
    {
      state: "unavailable",
      reason: "tracking-marker-missing",
    },
  );
});

test("missing marker is unavailable, never all-entries", () => {
  const resolved = scopeOf([node("a", null)], "a", "tree");
  assert.deepEqual(resolved, {
    state: "unavailable",
    reason: "tracking-marker-missing",
  });
});

test("earliest marker wins and duplicates are counted", () => {
  const records = [
    marker("m1", null),
    node("a", "m1"),
    marker("m2", "a"),
    node("b", "m2"),
  ];
  const resolved = scopeOf(records, "b", "tree");
  assert.equal(resolved.state, "available");
  assert.equal(
    resolved.state === "available" ? resolved.markerEntryId : "",
    "m1",
  );
  assert.equal(
    resolved.state === "available" ? resolved.duplicateMarkers : 0,
    1,
  );
  assert.deepEqual(resolved.state === "available" ? resolved.entryIds : [], [
    "a",
    "m2",
    "b",
  ]);
});

test("invalid leaf never falls back to tree", () => {
  const records = [marker("m", null), node("a", "m")];
  assert.deepEqual(scopeOf(records, "missing", "active"), {
    state: "unavailable",
    reason: "active-leaf-unavailable",
  });
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGraphNodes } from "../../src/pi/graph.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";
import { selectScope } from "../../src/pi/sessions.ts";
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

function duplicateBoundaryEntries() {
  const header = {
    type: "session",
    version: 3,
    id: "duplicate-boundary-session",
    timestamp: "2026-09-12T10:00:00.000Z",
    cwd: "/fixture",
  };
  const before = {
    ...node("duplicate", null),
    timestamp: "2026-09-12T10:00:01.000Z",
  };
  const trackingMarker = marker("marker", "duplicate");
  const after = {
    ...node("duplicate", "marker"),
    timestamp: "2026-09-12T10:00:03.000Z",
  };
  const leaf = {
    ...node("leaf", "duplicate"),
    timestamp: "2026-09-12T10:00:04.000Z",
  };
  const parsed = parseSessionJsonl(
    [header, before, trackingMarker, after, leaf]
      .map((entry) => JSON.stringify(entry))
      .join("\n"),
  );
  assert.equal(parsed.hasMalformedJson, false);
  return { entries: parsed.entries, after };
}

test("tree scope resolves duplicate ids to the post-marker entry", () => {
  const { entries, after } = duplicateBoundaryEntries();
  const selected = selectScope(entries, "leaf", "tree");
  assert.deepEqual(
    selected.map((entry) => entry.id),
    ["duplicate", "leaf"],
  );
  assert.equal(selected[0]?.timestamp, after.timestamp);
});

test("active scope resolves duplicate ids within tracked ancestry", () => {
  const { entries, after } = duplicateBoundaryEntries();
  const selected = selectScope(entries, "leaf", "active");
  assert.deepEqual(
    selected.map((entry) => entry.id),
    ["duplicate", "leaf"],
  );
  assert.equal(selected[0]?.timestamp, after.timestamp);
});

test("active scope keeps post-marker ownership over duplicate pre-marker ids", () => {
  const records = [
    node("tracked", null),
    node("tracked", null),
    marker("m", null),
    node("tracked", "m"),
    node("leaf", "tracked"),
  ];
  const resolved = scopeOf(records, "leaf", "active");
  assert.equal(resolved.state, "available");
  assert.deepEqual(resolved.state === "available" ? resolved.entryIds : [], [
    "tracked",
    "leaf",
  ]);
});

test("active scope keeps branches rooted in pre-marker ancestry", () => {
  const records = [
    node("old-root", null),
    marker("m", "old-root"),
    node("tracked-branch", "old-root"),
  ];
  const selected = selectScope(records, "tracked-branch", "active");
  assert.deepEqual(
    selected.map((entry) => entry.id),
    ["tracked-branch"],
  );
});

test("active scope keeps post-marker ancestors across pre-marker records", () => {
  const records = [
    node("pre", "tracked"),
    marker("m", null),
    node("tracked", "m"),
    node("leaf", "pre"),
  ];
  const resolved = scopeOf(records, "leaf", "active");
  assert.equal(resolved.state, "available");
  assert.deepEqual(resolved.state === "available" ? resolved.entryIds : [], [
    "tracked",
    "leaf",
  ]);
});

test("active scope follows marker ancestry to a post-marker ancestor", () => {
  const records = [
    node("pre", "tracked"),
    marker("m", "pre"),
    node("tracked", null),
    node("leaf", "m"),
  ];
  const resolved = scopeOf(records, "leaf", "active");
  assert.equal(resolved.state, "available");
  assert.deepEqual(resolved.state === "available" ? resolved.entryIds : [], [
    "tracked",
    "leaf",
  ]);
});

test("active scope excludes a post-marker sibling matching a pre-marker sentinel id", () => {
  const records = [
    node("duplicate", null),
    marker("marker", "duplicate"),
    node("duplicate", "marker"),
    node("leaf", "marker"),
  ];
  const resolved = scopeOf(records, "leaf", "active");
  assert.equal(resolved.state, "available");
  assert.deepEqual(resolved.state === "available" ? resolved.entryIds : [], [
    "leaf",
  ]);
});

test("ambiguous pre-marker ancestors make active scope unavailable", () => {
  const records = [
    node("bridge", "tracked"),
    node("bridge", null),
    marker("m", null),
    node("tracked", "m"),
    node("leaf", "bridge"),
  ];
  assert.deepEqual(scopeOf(records, "leaf", "active"), {
    state: "unavailable",
    reason: "active-leaf-unavailable",
  });
});

test("active scope keeps deep pre-marker ancestry ahead of post-marker duplicate", () => {
  const records = [
    node("duplicate", null),
    node("bridge", "duplicate"),
    marker("marker", "bridge"),
    node("duplicate", null),
    node("leaf", "marker"),
  ];
  const resolved = scopeOf(records, "leaf", "active");
  assert.equal(resolved.state, "available");
  assert.deepEqual(resolved.state === "available" ? resolved.entryIds : [], [
    "leaf",
  ]);
});

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

test("invalid active ancestry is unavailable for missing parents, cycles, pre-marker leaves, and duplicate ids", () => {
  const cases: Array<Record<string, unknown>[]> = [
    [marker("m", null), node("leaf", "missing")],
    [marker("m", null), node("a", "b"), node("b", "a")],
    [node("before", null), marker("m", "before"), node("after", "m")],
    [marker("m", null), node("a", "m"), node("a", "m")],
  ];
  for (const [index, records] of cases.entries()) {
    const leaf =
      index === 1 ? "a" : index === 2 ? "before" : index === 3 ? "a" : "leaf";
    assert.deepEqual(scopeOf(records, leaf, "active"), {
      state: "unavailable",
      reason: "active-leaf-unavailable",
    });
  }
});

test("boundary is the marker node ordinal, not a records-derived id set", () => {
  const knownA = node("knownA", null);
  const preUnknown = node("preUnknown", "knownA", "future_widget");
  const markerRecord = marker("m", "preUnknown");
  const knownB = node("knownB", "m");
  // The records list is not the list that produced the nodes: the nodes carry
  // a pre-boundary unknown node the records list omits. An id-set boundary
  // would leak it; the marker node's ordinal must not.
  const records = [knownA, markerRecord, knownB];
  const nodes = buildGraphNodes([knownA, preUnknown, markerRecord, knownB]);
  const resolved = resolveScope(records, nodes, "knownB", "tree");
  assert.equal(resolved.state, "available");
  assert.deepEqual(resolved.state === "available" ? resolved.entryIds : [], [
    "knownB",
  ]);
});

test("a marker id that is unbounded, missing, or unmatched is unavailable", () => {
  const validMarker = marker("m", null);
  const missingId = { ...validMarker, id: undefined };
  const numericId = { ...validMarker, id: 42 };
  const overBoundId = { ...validMarker, id: "x".repeat(129) };
  for (const record of [missingId, numericId, overBoundId]) {
    assert.deepEqual(
      resolveScope(
        [record, node("a", null)],
        buildGraphNodes([node("a", null)]),
        "a",
        "tree",
      ),
      { state: "unavailable", reason: "tracking-marker-missing" },
    );
  }
  // A bounded marker id with no matching node cannot anchor a boundary.
  const ghost = marker("ghost", null);
  assert.deepEqual(
    resolveScope(
      [ghost, node("a", "ghost")],
      buildGraphNodes([node("a", null)]),
      "a",
      "tree",
    ),
    { state: "unavailable", reason: "tracking-marker-missing" },
  );
});

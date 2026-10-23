import assert from "node:assert/strict";
import { test } from "node:test";
import {
  diffUiSnapshot,
  serializeUiSnapshot,
} from "../../src/ui/snapshot-revision.ts";
import type { InspectorUiSnapshot } from "../../src/ui/ui-projection.ts";

const snapshot = (theme: "light" | "dark" = "light") =>
  ({
    kind: "ui",
    schemaVersion: 1,
    theme,
    initialScope: "active",
    current: { active: { x: 1 }, tree: {}, sameReportProjection: false },
    history: {},
    global: {},
  }) as unknown as InspectorUiSnapshot;
test("revision serializes stable snapshots and diffs only changed sections", () => {
  const a = snapshot(),
    b = snapshot("dark");
  assert.equal(diffUiSnapshot(a, a), undefined);
  assert.deepEqual(diffUiSnapshot(a, b), { theme: "dark" });
  assert.equal(serializeUiSnapshot(a).etag, serializeUiSnapshot(a).etag);
});

import assert from "node:assert/strict";
import { test } from "node:test";

import type { SessionEntry } from "../../src/core/events.ts";
import { reduceEntries } from "../../src/core/reduce.ts";
import { toSessionReport } from "../../src/core/reports.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";
import { resolveScope } from "../../src/pi/scope.ts";

const line = (value: Record<string, unknown>) => JSON.stringify(value);

const fixture = [
  line({
    type: "session",
    version: 3,
    id: "graph-session",
    timestamp: "2026-09-12T10:00:00.000Z",
  }),
  line({
    type: "custom",
    id: "marker",
    parentId: null,
    customType: "session-inspector:tracking-start",
    data: { schemaVersion: 1 },
    timestamp: "2026-09-12T10:00:00.500Z",
  }),
  line({
    type: "message",
    id: "known-a",
    parentId: "marker",
    timestamp: "2026-09-12T10:00:01.000Z",
    message: {
      role: "assistant",
      provider: "acme",
      model: "alpha",
      content: [{ type: "text", text: "sanitized" }],
      usage: { totalTokens: 10, cost: { total: 0.01 } },
    },
  }),
  line({
    type: "future_widget",
    id: "unknown-b",
    parentId: "known-a",
    timestamp: "2026-09-12T10:00:02.000Z",
  }),
  line({
    type: "message",
    id: "known-c",
    parentId: "unknown-b",
    timestamp: "2026-09-12T10:00:03.000Z",
    message: {
      role: "assistant",
      provider: "acme",
      model: "alpha",
      content: [{ type: "text", text: "sanitized" }],
      usage: { totalTokens: 20, cost: { total: 0.02 } },
    },
  }),
].join("\n");

test("active scope keeps known messages across an unknown semantic node", () => {
  const session = parseSessionJsonl(fixture);
  assert.equal(session.unknownEntryCount, 1);

  const resolution = resolveScope(
    session.entries,
    session.graphNodes,
    "known-c",
    "active",
  );
  assert.equal(resolution.state, "available");
  const entryIds = resolution.state === "available" ? resolution.entryIds : [];
  assert.deepEqual(entryIds, ["known-a", "unknown-b", "known-c"]);

  const byId = new Map(session.entries.map((entry) => [entry.id, entry]));
  const selected = entryIds
    .map((id) => byId.get(id))
    .filter((entry): entry is SessionEntry => entry !== undefined);
  assert.deepEqual(
    selected.map((entry) => entry.id),
    ["known-a", "known-c"],
  );

  const report = toSessionReport(reduceEntries(session.id, selected));
  assert.deepEqual(
    report.generations.map((generation) => generation.id),
    ["generation:known-a", "generation:known-c"],
  );
  assert.equal(report.usage?.totalTokens, 30);
});

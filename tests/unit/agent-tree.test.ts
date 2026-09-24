import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildAgentForest,
  filterAgentForest,
  sortAgentRowsByDuration,
  type UiAgentTreeEntry,
} from "../../src/ui/agent-tree.ts";
import type { UiAgentParent, UiAgentRow } from "../../src/ui/ui-projection.ts";

/** One run row, exactly as L2 publishes it: the verdict is an input, not derived. */
function run(input: {
  id: string;
  parentId?: string | null;
  parent?: UiAgentParent;
  agent?: string | null;
  status?: UiAgentRow["status"];
  model?: string | null;
  thinking?: string | null;
  tokens?: number | null;
  cost?: number | null;
  durationMs?: number | null;
  durationLabel?: string | null;
  toolCalls?: number | null;
  effortCoverage?: UiAgentRow["effortCoverage"];
}): UiAgentRow {
  const tokens = input.tokens === undefined ? null : input.tokens;
  const cost = input.cost === undefined ? null : input.cost;
  return {
    id: input.id,
    parentId: input.parentId ?? null,
    agent: input.agent === undefined ? "worker" : input.agent,
    status: input.status ?? "succeeded",
    confidence: "native",
    artifacts: null,
    observedAt: null,
    evidenceToolId: null,
    model: input.model === undefined ? null : input.model,
    thinking: input.thinking === undefined ? null : input.thinking,
    failure: null,
    usage:
      tokens === null && cost === null
        ? null
        : { totalTokens: tokens ?? 0, cost: cost ?? 0 },
    durationMs: input.durationMs ?? null,
    durationLabel: input.durationLabel ?? null,
    generations: null,
    toolCalls: input.toolCalls ?? null,
    errorCount: null,
    effortCoverage: input.effortCoverage ?? {
      duration: input.durationMs == null ? "unavailable" : "partial",
      generations: "unavailable",
      tools: input.toolCalls == null ? "unavailable" : "partial",
      errors: "unavailable",
      usage: tokens === null ? "unavailable" : "partial",
      cost: cost === null ? "unavailable" : "partial",
    },
    parent: input.parent ?? "none",
  };
}

const containerId = `subagent-${"a".repeat(64)}`;
const otherContainerId = `subagent-${"b".repeat(64)}`;

function runsOf(entries: readonly UiAgentTreeEntry[]): string[] {
  return entries.flatMap((entry) =>
    entry.kind === "container"
      ? entry.children.map((child) => child.run.id)
      : [entry.run.id],
  );
}

test("duration sorting orders observed values first, breaks ties by id, and preserves input", () => {
  const unavailable = {
    duration: "unavailable",
    generations: "unavailable",
    tools: "unavailable",
    errors: "unavailable",
    usage: "unavailable",
    cost: "unavailable",
  } as const;
  const rows = [
    run({ id: "duration-z", durationMs: 5 }),
    run({ id: "duration-b", durationMs: 5 }),
    run({ id: "duration-zero", durationMs: 0 }),
    run({
      id: "duration-inconsistent",
      durationMs: 1000,
      effortCoverage: unavailable,
    }),
    run({ id: "duration-missing" }),
  ];

  const sorted = sortAgentRowsByDuration(rows);

  assert.deepEqual(
    sorted.map((row) => row.id),
    [
      "duration-b",
      "duration-z",
      "duration-zero",
      "duration-inconsistent",
      "duration-missing",
    ],
  );
  assert.deepEqual(
    rows.map((row) => row.id),
    [
      "duration-z",
      "duration-b",
      "duration-zero",
      "duration-inconsistent",
      "duration-missing",
    ],
  );
  assert.notEqual(sorted, rows);
});

test("a run whose parent is materialized nests under that run", () => {
  const forest = buildAgentForest([
    run({ id: "parent", agent: "reviewer" }),
    run({
      id: "child",
      agent: "scout",
      parentId: "parent",
      parent: "in-range",
    }),
  ]);
  assert.equal(forest.entries.length, 1);
  const parent = forest.entries[0];
  if (parent === undefined || parent.kind !== "run") {
    throw new Error("the parent must be the one top-level entry");
  }
  assert.equal(parent.run.id, "parent");
  assert.deepEqual(
    parent.children.map((node) => node.run.id),
    ["child"],
  );
  assert.equal(parent.descendants, 1);
  assert.equal(parent.children[0]?.descendants, 0);
});

test("a real agent hierarchy nests at every level and counts its descendants", () => {
  const forest = buildAgentForest([
    run({ id: "reviewer", agent: "reviewer" }),
    run({
      id: "scout",
      agent: "scout",
      parentId: "reviewer",
      parent: "in-range",
      status: "failed",
    }),
    run({
      id: "worker",
      agent: "worker",
      parentId: "scout",
      parent: "in-range",
      status: "interrupted",
    }),
    run({
      id: "deep",
      agent: "deep",
      parentId: "worker",
      parent: "in-range",
    }),
  ]);
  const reviewer = forest.entries[0];
  if (reviewer === undefined || reviewer.kind !== "run") {
    throw new Error("reviewer must be the one top-level entry");
  }
  assert.equal(reviewer.descendants, 3);
  assert.equal(reviewer.failed, 1);
  assert.equal(reviewer.interrupted, 1);
  const scout = reviewer.children[0];
  assert.equal(scout?.descendants, 2);
  assert.equal(scout?.failed, 0);
  assert.equal(scout?.interrupted, 1);
});

test("runs sharing one run container are grouped under a container, not an agent", () => {
  const forest = buildAgentForest([
    run({
      id: "one",
      agent: "reviewer",
      parentId: containerId,
      parent: "orchestration-run",
    }),
    run({
      id: "two",
      agent: "worker",
      parentId: containerId,
      parent: "orchestration-run",
      status: "failed",
    }),
    run({
      id: "three",
      agent: "scout",
      parentId: containerId,
      parent: "orchestration-run",
    }),
  ]);
  assert.equal(forest.entries.length, 1);
  const container = forest.entries[0];
  if (container === undefined || container.kind !== "container") {
    throw new Error("three children of one container must group");
  }
  assert.equal(container.children.length, 3);
  assert.equal(container.descendants, 3);
  assert.equal(container.failed, 1);
  assert.deepEqual(
    container.children.map((child) => child.run.id),
    ["one", "two", "three"],
  );
  // A container is a group, never a run: it carries no agent, status, or usage.
  assert.equal("run" in container, false);
  assert.equal("status" in container, false);
});

test("a single child of a run container is flattened into the run itself", () => {
  const forest = buildAgentForest([
    run({
      id: "only",
      agent: "worker",
      parentId: containerId,
      parent: "orchestration-run",
    }),
  ]);
  assert.equal(forest.entries.length, 1);
  assert.equal(forest.entries[0]?.kind, "run");
  assert.deepEqual(runsOf(forest.entries), ["only"]);
});

test("the container identity is never an entry of its own, only an Inspector-owned key", () => {
  const forest = buildAgentForest([
    run({
      id: "one",
      parentId: containerId,
      parent: "orchestration-run",
    }),
    run({
      id: "two",
      parentId: containerId,
      parent: "orchestration-run",
    }),
    run({
      id: "three",
      parentId: otherContainerId,
      parent: "orchestration-run",
    }),
    run({
      id: "four",
      parentId: otherContainerId,
      parent: "orchestration-run",
    }),
  ]);
  const keys = forest.entries.map((entry) =>
    entry.kind === "container" ? entry.key : entry.run.id,
  );
  assert.deepEqual(keys, ["container-1", "container-2"]);
  assert.deepEqual(
    forest.entries.map((entry) =>
      entry.kind === "container" ? entry.ordinal : null,
    ),
    [1, 2],
  );
  for (const entry of forest.entries) {
    if (entry.kind !== "container") continue;
    // A container is a group this projection formed, so it has no row to render
    // and no identity a route, a link, or a focus effect could name.
    assert.equal(keys.includes(entry.key), true);
    assert.equal(entry.key.includes(containerId), false);
    assert.equal("run" in entry, false);
  }
});

test("every parent verdict without a materialized parent stays at the top level", () => {
  const forest = buildAgentForest([
    run({ id: "rootless", parent: "none" }),
    run({ id: "outside", parent: "outside-range", parentId: containerId }),
    run({ id: "malformed", parent: "unknown", parentId: "not-an-opaque-id" }),
    run({
      id: "containerised",
      parent: "orchestration-run",
      parentId: containerId,
    }),
  ]);
  assert.deepEqual(runsOf(forest.entries), [
    "rootless",
    "outside",
    "malformed",
    "containerised",
  ]);
  assert.equal(
    forest.entries.every((entry) => entry.kind === "run"),
    true,
  );
});

test("a parent identity that names no rendered row never nests and never loops", () => {
  // A cycle is not something this producer publishes, and it must not hang a
  // renderer: neither run is nested, and both stay visible at the top level.
  const forest = buildAgentForest([
    run({ id: "left", parentId: "right", parent: "in-range" }),
    run({ id: "right", parentId: "left", parent: "in-range" }),
  ]);
  assert.deepEqual(runsOf(forest.entries), ["left", "right"]);
  assert.equal(
    forest.entries.every((entry) => entry.kind === "run"),
    true,
  );
});

test("a run with no published usage is counted, so a known total is never implied", () => {
  const forest = buildAgentForest([
    run({ id: "parent", agent: "reviewer" }),
    run({
      id: "known",
      parentId: "parent",
      parent: "in-range",
      tokens: 34_477,
      cost: 0.004893924,
    }),
    run({ id: "unknown", parentId: "parent", parent: "in-range" }),
  ]);
  const parent = forest.entries[0];
  if (parent === undefined || parent.kind !== "run") {
    throw new Error("parent must be the one top-level entry");
  }
  assert.equal(parent.withoutUsage, 1);
  assert.equal(parent.descendants, 2);
});

test("a filter keeps the ancestors a match needs to be understood", () => {
  const forest = buildAgentForest([
    run({ id: "reviewer", agent: "reviewer", model: "deepseek" }),
    run({
      id: "scout",
      agent: "scout",
      model: "terra",
      parentId: "reviewer",
      parent: "in-range",
    }),
    run({ id: "unrelated", agent: "worker", model: "deepseek" }),
  ]);
  const view = filterAgentForest(forest, (row) => row.model === "terra");
  assert.equal(view.matched, 1);
  assert.equal(view.shown, 2);
  assert.equal(view.context, 1);
  assert.equal(view.total, 3);
  const reviewer = view.entries[0];
  if (reviewer === undefined || reviewer.kind !== "run") {
    throw new Error("the kept ancestor must stay a run entry");
  }
  assert.equal(reviewer.state, "context");
  assert.equal(reviewer.children[0]?.state, "match");
  assert.equal(reviewer.children[0]?.run.id, "scout");
});

test("a filter that matches nothing keeps nothing and counts honestly", () => {
  const forest = buildAgentForest([run({ id: "one" }), run({ id: "two" })]);
  const view = filterAgentForest(forest, () => false);
  assert.deepEqual(view.entries, []);
  assert.equal(view.matched, 0);
  assert.equal(view.shown, 0);
  assert.equal(view.total, 2);
});

test("a matching parent stays a match, and its matching child keeps its own state", () => {
  const forest = buildAgentForest([
    run({ id: "reviewer", agent: "reviewer" }),
    run({
      id: "scout",
      agent: "scout",
      parentId: "reviewer",
      parent: "in-range",
    }),
  ]);
  const view = filterAgentForest(forest, () => true);
  const reviewer = view.entries[0];
  if (reviewer === undefined || reviewer.kind !== "run") {
    throw new Error("reviewer must be the one top-level entry");
  }
  assert.equal(reviewer.state, "match");
  assert.equal(reviewer.children[0]?.state, "match");
  assert.equal(view.context, 0);
  assert.equal(view.matched, 2);
});

test("a container survives a filter only through a matching child", () => {
  const forest = buildAgentForest([
    run({
      id: "one",
      parentId: containerId,
      parent: "orchestration-run",
      model: "deepseek",
    }),
    run({
      id: "two",
      parentId: containerId,
      parent: "orchestration-run",
      model: "terra",
    }),
  ]);
  const view = filterAgentForest(forest, (row) => row.model === "terra");
  const container = view.entries[0];
  if (container === undefined || container.kind !== "container") {
    throw new Error("the container must survive through its matching child");
  }
  assert.deepEqual(
    container.children.map((child) => [child.run.id, child.state]),
    [["two", "match"]],
  );
  assert.equal(view.context, 0);
});

test("a filtered node's counts describe the subtree that is rendered", () => {
  const forest = buildAgentForest([
    run({ id: "reviewer", agent: "reviewer" }),
    run({
      id: "match",
      agent: "scout",
      parentId: "reviewer",
      parent: "in-range",
      model: "terra",
      tokens: 10,
      cost: 0.01,
    }),
    run({
      id: "failed",
      agent: "worker",
      parentId: "reviewer",
      parent: "in-range",
      status: "failed",
    }),
    run({
      id: "unknown-usage",
      agent: "writer",
      parentId: "reviewer",
      parent: "in-range",
      model: "deepseek",
    }),
  ]);
  const whole = forest.entries[0];
  if (whole === undefined || whole.kind !== "run") {
    throw new Error("reviewer must be the one top-level entry");
  }
  assert.equal(whole.descendants, 3);
  assert.equal(whole.failed, 1);
  assert.equal(whole.withoutUsage, 2);

  // Under a filter the summary counts what the reader can actually see: a count
  // of hidden rows would be a figure printed over rows the tree does not hold.
  const view = filterAgentForest(forest, (row) => row.model === "terra");
  const shown = view.entries[0];
  if (shown === undefined || shown.kind !== "run") {
    throw new Error("the kept ancestor must stay a run entry");
  }
  assert.equal(shown.state, "context");
  assert.equal(shown.descendants, 1);
  assert.equal(shown.failed, 0);
  assert.equal(shown.withoutUsage, 0);
  assert.equal(view.total, 4);
});

test("filtered effort-coverage summaries count only rendered descendant runs", () => {
  const forest = buildAgentForest([
    run({ id: "root", agent: "orchestrator" }),
    run({
      id: "known",
      parentId: "root",
      parent: "in-range",
      durationMs: 1234,
      durationLabel: "1.2 s",
      toolCalls: 2,
      effortCoverage: {
        duration: "partial",
        generations: "unavailable",
        tools: "partial",
        errors: "unavailable",
        usage: "unavailable",
        cost: "unavailable",
      },
    }),
    run({ id: "missing", parentId: "root", parent: "in-range" }),
  ]);
  const whole = forest.entries[0];
  if (whole === undefined || whole.kind !== "run") {
    throw new Error("root must be the one top-level entry");
  }
  assert.deepEqual(
    [
      whole.durationPartial,
      whole.durationUnavailable,
      whole.toolCallsPartial,
      whole.toolCallsUnavailable,
    ],
    [1, 1, 1, 1],
  );

  const view = filterAgentForest(forest, (row) => row.id === "known");
  const shown = view.entries[0];
  if (shown === undefined || shown.kind !== "run") {
    throw new Error("the kept ancestor must stay a run entry");
  }
  assert.deepEqual(
    [
      shown.durationPartial,
      shown.durationUnavailable,
      shown.toolCallsPartial,
      shown.toolCallsUnavailable,
    ],
    [1, 0, 1, 0],
  );
});

test("a hundred-odd runs build and filter once, without quadratic work", () => {
  const rows: UiAgentRow[] = [];
  for (let index = 0; index < 150; index += 1) {
    rows.push(run({ id: `root-${index}`, agent: `root-${index}` }));
    rows.push(
      run({
        id: `child-${index}`,
        parentId: `root-${index}`,
        parent: "in-range",
        agent: `child-${index}`,
        model: index % 2 === 0 ? "deepseek" : "terra",
      }),
    );
    rows.push(
      run({
        id: `grouped-${index}`,
        parentId: containerId,
        parent: "orchestration-run",
        agent: `grouped-${index}`,
      }),
    );
  }
  const started = process.hrtime.bigint();
  const forest = buildAgentForest(rows);
  const view = filterAgentForest(forest, (row) => row.model === "terra");
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.equal(forest.entries.length, 151);
  assert.equal(view.total, 450);
  assert.equal(view.matched, 75);
  // Every match keeps its own parent as context, and nothing else.
  assert.equal(view.shown, 150);
  assert.equal(view.context, 75);
  // A bounded traversal, not a nested scan: this is a ceiling, not a benchmark.
  assert.equal(elapsedMs < 2000, true, `${elapsedMs}ms`);
});

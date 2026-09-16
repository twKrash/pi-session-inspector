import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { readSubagentEvidenceWithArchives } from "../../src/integrations/subagents.ts";
import type { InspectorBundle } from "../../src/ui/bundle.ts";
import { loadCurrentView } from "../../src/ui/bundle.ts";
import { ENGLISH_CATALOG } from "../../src/ui/i18n/catalog.ts";
import { loadCurrentSessionReport } from "../../src/ui/load-current.ts";
import { renderSnapshot } from "../../src/ui/snapshot.ts";
import {
  projectCurrentView,
  projectInspectorUi,
  type UiSessionProjection,
} from "../../src/ui/ui-projection.ts";
import { createWebClient } from "../helpers/client-harness.ts";

/**
 * The one usage-scope contract of the LLM tab, pinned end to end.
 *
 * Pi is the billing authority and records the child agent's own usage on the
 * parent's subagent tool result, so the session's persisted native usage already
 * contains it. The session root therefore renders the report's native usage -
 * never `native + child` - while the model table is only its generation slice
 * and the child card is a breakdown *inside* the tool-result part of the same
 * total (never a separate addend).
 *
 * The fixture is the UAT shape itself: 7,781,728 native generation tokens plus a
 * subagent result carrying 1,434,150 of child usage.
 */

const NATIVE_GENERATION_TOKENS = 7_781_728;
const NATIVE_GENERATION_COST = 0.17;
const CHILD_TOKENS = 1_434_150;
const CHILD_COST = 0.1;
const SESSION_TOTAL_TOKENS = NATIVE_GENERATION_TOKENS + CHILD_TOKENS;
const SESSION_TOTAL_COST = NATIVE_GENERATION_COST + CHILD_COST;
/** What a renderer would show if it added the child card to the total. */
const FORBIDDEN_ADDED_TOTAL = SESSION_TOTAL_TOKENS + CHILD_TOKENS;

type GenerationFixture = {
  id?: string;
  provider?: string;
  model?: string;
  totalTokens: number;
  cost: number;
};

type ChildRunFixture = {
  agent?: string;
  model?: string | null;
  /** The child's own usage; absent means the run published none. */
  totalTokens?: number;
  cost?: number;
  /** Whether the run's usage is published on this tool result at all. */
  publish?: boolean;
};

type Fixture = {
  generations: readonly GenerationFixture[];
  children?: readonly ChildRunFixture[];
  /** The parent tool result's own usage record, when it has one. */
  toolResultUsage?: "sum-of-published" | "absent";
};

function usageOf(totalTokens: number, cost: number): Record<string, unknown> {
  return {
    input: totalTokens,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
  };
}

/** One sanitized Pi session carrying the fixture's usage records. */
function sessionSource(fixture: Fixture): string {
  const records: Record<string, unknown>[] = [
    {
      type: "session",
      version: 3,
      id: "usage-scope-session",
      timestamp: "2026-09-16T09:00:00.000Z",
      cwd: "/fixture",
    },
    {
      type: "custom",
      id: "marker",
      parentId: null,
      timestamp: "2026-09-16T09:00:00.500Z",
      customType: "session-inspector:tracking-start",
      data: { schemaVersion: 1 },
    },
  ];
  let parentId: string | null = "marker";
  fixture.generations.forEach((generation, index) => {
    const id = generation.id ?? `gen-${index + 1}`;
    records.push({
      type: "message",
      id,
      parentId,
      timestamp: `2026-09-16T09:0${index}:01.000Z`,
      message: {
        role: "assistant",
        provider: generation.provider ?? "deepseek",
        model: generation.model ?? "deepseek-flash",
        content: [],
        usage: usageOf(generation.totalTokens, generation.cost),
      },
    });
    parentId = id;
  });
  const children = (fixture.children ?? []).filter(
    (child) => child.publish !== false,
  );
  if ((fixture.children ?? []).length > 0) {
    records.push({
      type: "message",
      id: "call-subagent",
      parentId,
      timestamp: "2026-09-16T09:10:00.000Z",
      message: {
        role: "assistant",
        provider: "deepseek",
        model: "deepseek-flash",
        content: [{ type: "toolCall", id: "call-subagent", name: "subagent" }],
      },
    });
    const carried =
      fixture.toolResultUsage === "absent"
        ? undefined
        : children.reduce((sum, child) => sum + (child.totalTokens ?? 0), 0);
    const carriedCost = children.reduce(
      (sum, child) => sum + (child.cost ?? 0),
      0,
    );
    records.push({
      type: "message",
      id: "res-subagent",
      parentId: "call-subagent",
      timestamp: "2026-09-16T09:10:30.000Z",
      message: {
        role: "toolResult",
        toolCallId: "call-subagent",
        toolName: "subagent",
        isError: false,
        content: [],
        ...(carried === undefined
          ? {}
          : { usage: usageOf(carried, carriedCost) }),
        details: {
          // Foreground children are identified as (aggregate runId, index): the
          // container id is the parent relationship, never an agent run itself.
          runId: "usage-scope-run",
          results: children.map((child, index) => ({
            index,
            agent: child.agent ?? "reviewer",
            model: child.model ?? undefined,
            outputState: "present",
            exitCode: 0,
            ...(child.totalTokens === undefined
              ? {}
              : {
                  usage: {
                    input: child.totalTokens,
                    output: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                    cost: child.cost ?? 0,
                    turns: 1,
                  },
                }),
          })),
        },
      },
    });
  }
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

type Loaded = {
  projection: UiSessionProjection;
  bundle: InspectorBundle;
  close(): Promise<void>;
};

async function loadFixture(fixture: Fixture): Promise<Loaded> {
  const directory = await mkdtemp(join(tmpdir(), "inspector-usage-scope-"));
  const file = join(directory, "session.jsonl");
  await writeFile(file, sessionSource(fixture));
  const bundle = JSON.parse(
    await (await import("node:fs/promises")).readFile(
      new URL("../fixtures/bundles/inspector-bundle.json", import.meta.url),
      "utf8",
    ),
  ) as InspectorBundle;
  const view = await loadCurrentView(
    (scope) =>
      loadCurrentSessionReport(file, scope, {
        leafId: null,
        subagentEvidence: readSubagentEvidenceWithArchives,
      }),
    "tree",
  );
  bundle.current.active = view;
  bundle.current.tree = view;
  const projection = projectCurrentView(view, "tree");
  return {
    projection,
    bundle,
    close: async () => {
      await rm(directory, { recursive: true, force: true });
    },
  };
}

const sumOf = (rows: readonly Record<string, unknown>[], key: string): number =>
  rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);

const UAT_FIXTURE: Fixture = {
  generations: [
    {
      model: "deepseek-flash",
      totalTokens: NATIVE_GENERATION_TOKENS,
      cost: NATIVE_GENERATION_COST,
    },
  ],
  children: [{ totalTokens: CHILD_TOKENS, cost: CHILD_COST }],
};

test("the session root is the report's native usage, and the model table is its generation slice", async () => {
  const loaded = await loadFixture(UAT_FIXTURE);
  try {
    const { projection } = loaded;
    const range = projection.range;
    assert.ok(range, "the fixture must resolve a range");
    const report = projection.report;
    assert.ok(report, "the fixture must project a report");
    const usage = report.usage;
    assert.ok(usage, "the fixture must publish the session's usage");
    const composition = report.composition;
    assert.equal(composition.available, true);

    assert.equal(usage.totalTokens, SESSION_TOTAL_TOKENS);
    assert.equal(usage.cost, SESSION_TOTAL_COST);
    // The one invariant: what the tree root renders is the report's native
    // usage, never a native figure with a child figure added to it.
    assert.equal(range.totals.totalTokens, usage.totalTokens);
    assert.equal(range.totals.cost, usage.cost);

    // The model table is the generation slice of that same total, and never the
    // total itself: no model row carries another owner's usage.
    const generationsPart = composition.parts.find(
      (part) => part.key === "generations",
    );
    const toolResultsPart = composition.parts.find(
      (part) => part.key === "toolResults",
    );
    assert.ok(generationsPart && toolResultsPart);
    assert.equal(
      sumOf(range.models, "totalTokens"),
      generationsPart.totalTokens,
    );
    assert.equal(sumOf(range.models, "totalTokens"), NATIVE_GENERATION_TOKENS);
    assert.notEqual(
      range.totals.totalTokens,
      sumOf(range.models, "totalTokens"),
    );

    // The child card reads the child's own persisted usage, and that usage is a
    // subset of the tool-result part of the same native total.
    assert.equal(range.childUsage.totalTokens, CHILD_TOKENS);
    assert.equal(range.childUsage.cost, CHILD_COST);
    assert.equal(range.childUsage.runsTotal, 1);
    assert.equal(range.childUsage.runsWithUsage, 1);
    assert.ok(
      (range.childUsage.totalTokens ?? 0) <= toolResultsPart.totalTokens,
      "child usage must be a breakdown inside the tool-result part",
    );
  } finally {
    await loaded.close();
  }
});

test("child usage coverage never changes the session total", async () => {
  const variants: readonly { name: string; fixture: Fixture }[] = [
    {
      name: "complete",
      fixture: {
        ...UAT_FIXTURE,
        children: [
          { totalTokens: 1_000, cost: 0.05 },
          { totalTokens: 434_150, cost: 0.05 },
        ],
      },
    },
    {
      name: "partial",
      fixture: {
        ...UAT_FIXTURE,
        children: [
          { totalTokens: CHILD_TOKENS, cost: CHILD_COST },
          { totalTokens: undefined, cost: undefined },
        ],
      },
    },
    {
      name: "unavailable",
      fixture: {
        ...UAT_FIXTURE,
        children: [{ totalTokens: undefined, cost: undefined }],
        toolResultUsage: "absent",
      },
    },
    {
      name: "zero",
      fixture: {
        ...UAT_FIXTURE,
        children: [{ totalTokens: 0, cost: 0 }],
      },
    },
  ];
  for (const variant of variants) {
    const loaded = await loadFixture(variant.fixture);
    try {
      const range = loaded.projection.range;
      const report = loaded.projection.report;
      assert.ok(range && report, variant.name);
      // The native total follows Pi's persisted records exactly: the parent's
      // generation usage plus whatever the parent's own tool result recorded.
      const toolResultTokens =
        variant.fixture.toolResultUsage === "absent"
          ? 0
          : (variant.fixture.children ?? []).reduce(
              (total, child) => total + (child.totalTokens ?? 0),
              0,
            );
      assert.equal(
        range.totals.totalTokens,
        NATIVE_GENERATION_TOKENS + toolResultTokens,
        variant.name,
      );
      assert.equal(
        range.totals.totalTokens,
        report.usage?.totalTokens,
        variant.name,
      );
      assert.equal(
        range.childUsage.runsTotal,
        (variant.fixture.children ?? []).filter(
          (child) => child.publish !== false,
        ).length,
        variant.name,
      );
      // Coverage is the child card's own qualifier, never something the root
      // absorbs or hides: no run with usage reads `Unavailable`, a published
      // zero reads as a real zero.
      if (variant.name === "unavailable") {
        assert.equal(range.childUsage.totalTokens, null, variant.name);
        assert.equal(range.childUsage.runsWithUsage, 0, variant.name);
      } else if (variant.name === "zero") {
        assert.equal(range.childUsage.totalTokens, 0, variant.name);
        assert.equal(range.childUsage.runsWithUsage, 1, variant.name);
      } else {
        assert.equal(
          range.childUsage.totalTokens,
          variant.fixture.children?.reduce(
            (total, child) => total + (child.totalTokens ?? 0),
            0,
          ),
          variant.name,
        );
      }
    } finally {
      await loaded.close();
    }
  }
});

test("multiple parent models and multiple child runs keep the model table model-attributed", async () => {
  const loaded = await loadFixture({
    generations: [
      { id: "gen-a", model: "alpha", totalTokens: 100, cost: 0.01 },
      { id: "gen-b", model: "beta", totalTokens: 240, cost: 0.02 },
    ],
    children: [
      { agent: "reviewer", model: "gamma", totalTokens: 40, cost: 0.004 },
      { agent: "worker", model: "alpha", totalTokens: 60, cost: 0.006 },
    ],
  });
  try {
    const range = loaded.projection.range;
    assert.ok(range);
    const models = range.models.map((row) => row.model).sort();
    // Child models never enter the model table: it attributes the parent's own
    // generations, and the child rows carry their own model in Agents.
    assert.deepEqual(models, ["alpha", "beta"]);
    assert.equal(sumOf(range.models, "totalTokens"), 340);
    assert.equal(range.totals.totalTokens, 340 + 100);
    assert.equal(range.childUsage.runsTotal, 2);
    assert.equal(range.childUsage.totalTokens, 100);
    assert.deepEqual(range.agents.map((row) => row.model).sort(), [
      "alpha",
      "gamma",
    ]);
  } finally {
    await loaded.close();
  }
});

test("a child sharing the parent's model never doubles that model's row", async () => {
  const shared = await loadFixture({
    generations: [{ model: "deepseek-flash", totalTokens: 500, cost: 0.05 }],
    children: [
      { model: "deepseek-flash", totalTokens: 200, cost: 0.02 },
      { model: "deepseek-flash", totalTokens: 50, cost: 0.005 },
    ],
  });
  const different = await loadFixture({
    generations: [{ model: "deepseek-flash", totalTokens: 500, cost: 0.05 }],
    children: [{ model: "other-model", totalTokens: 200, cost: 0.02 }],
  });
  try {
    for (const loaded of [shared, different]) {
      const range = loaded.projection.range;
      assert.ok(range);
      assert.equal(sumOf(range.models, "totalTokens"), 500);
      assert.equal(range.models.length, 1);
      assert.equal(
        range.totals.totalTokens,
        500 + (loaded === shared ? 250 : 200),
      );
    }
  } finally {
    await shared.close();
    await different.close();
  }
});

test("the browser Tree and the static snapshot render the same session figures", async () => {
  const loaded = await loadFixture(UAT_FIXTURE);
  try {
    const payload = projectInspectorUi({ bundle: loaded.bundle });
    const harness = createWebClient({
      responses: [payload],
      hash: "#/current/llm?scope=tree&preset=7",
    });
    await harness.start();
    const browserText = harness.texts(harness.element("view")).join(" ");
    const html = renderSnapshot({
      kind: "current",
      schemaVersion: 1,
      theme: "dark",
      projection: loaded.projection,
    });
    const rootIndex = html.indexOf("tree-node is-session");
    assert.notEqual(rootIndex, -1, "the snapshot must render the tree root");
    const sessionRoot = html.slice(
      rootIndex,
      html.indexOf("tree-children", rootIndex),
    );
    const formatted = (value: number): string =>
      String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

    for (const [name, text] of [
      ["browser", browserText],
      ["snapshot", sessionRoot],
    ] as const) {
      assert.equal(
        text.includes(formatted(SESSION_TOTAL_TOKENS)),
        true,
        `${name} must render the session's native usage`,
      );
      assert.equal(
        text.includes(formatted(FORBIDDEN_ADDED_TOTAL)),
        false,
        `${name} must never render native usage with child usage added`,
      );
      assert.equal(
        text.includes(ENGLISH_CATALOG["agents.tree.scope"]),
        true,
        `${name} must state the session root's scope`,
      );
    }
    // Both renderers carry the model slice and the child breakdown too, from the
    // same projection fields.
    for (const [name, text] of [
      ["browser", browserText],
      ["snapshot", html],
    ] as const) {
      assert.equal(
        text.includes(formatted(NATIVE_GENERATION_TOKENS)),
        true,
        `${name} must render the model slice`,
      );
      assert.equal(
        text.includes(formatted(CHILD_TOKENS)),
        true,
        `${name} must render the child breakdown`,
      );
    }
  } finally {
    await loaded.close();
  }
});

test("the LLM tab's copy names each usage scope instead of implying one total", () => {
  const models = ENGLISH_CATALOG["models.note"];
  // The model table is a generation slice; saying it is "native usage" invites
  // reading the session total as native usage plus the child card.
  assert.equal(models.includes("generation"), true);
  assert.equal(models.includes("session total"), true);
  const child = ENGLISH_CATALOG["metric.child.note"];
  assert.equal(child.includes("never added"), true);
  assert.equal(child.includes("tool-result"), true);
  assert.equal(
    ENGLISH_CATALOG["agents.tree.scope"].includes("Session total"),
    true,
  );
});

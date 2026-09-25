import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import {
  projectUsageEconomics,
  type SessionReport,
  unavailableEvidenceHealth,
} from "../../src/core/reports.ts";
import { createCurrentTuiComponent } from "../../src/ui/current-tui.ts";
import {
  CURRENT_TABS,
  createCurrentTuiModel,
  type CurrentTab,
  type CurrentTuiModel,
} from "../../src/ui/current.ts";
import { ENGLISH_CATALOG } from "../../src/ui/i18n/catalog.ts";

const report: SessionReport = {
  sessionId: "session-1",
  usage: { totalTokens: 42, cost: 0.01 },
  usageComposition: {
    generations: { totalTokens: 0, cost: 0 },
    toolResults: { totalTokens: 0, cost: 0 },
    compactions: { totalTokens: 0, cost: 0 },
    branchSummaries: { totalTokens: 0, cost: 0 },
  },
  models: [],
  tools: [],
  compactions: [],
  generations: [],
  agents: [],
  agentUsage: { runsTotal: 0, runsWithUsage: 0 },
  agentEvidence: "unavailable",
  agentActivity: {
    state: "unavailable",
    calls: 0,
    succeeded: 0,
    failed: 0,
    interrupted: 0,
    tools: [],
  },
  integrations: [],
  durationEvidence: "unavailable",
  commands: { state: "unavailable", items: [], count: null },
  skills: {
    state: "unavailable",
    items: [],
    count: null,
    invocationState: "unavailable",
    invocationCount: null,
    otherInvocations: null,
  },
  resources: { state: "unavailable", items: [] },
  errors: [],
  evidenceHealth: unavailableEvidenceHealth(),
};

const theme = { fg: (_color: string, text: string) => text };

/** Builds a model from the shared base report with the patched DTO fields. */
function modelWith(patch: Partial<SessionReport>): CurrentTuiModel {
  return createCurrentTuiModel({ ...report, ...patch }, "active");
}

/** Renders one tab through the real component's initial tab selection. */
function renderTab(
  model: CurrentTuiModel,
  tab: CurrentTab,
  width = 120,
): string[] {
  return createCurrentTuiComponent({
    model,
    load: async () => model,
    theme,
    initialTab: tab,
    requestRender: () => {},
    done: () => {},
  }).render(width);
}

/**
 * A tools tab with `count` rows: one header line plus one line per call, so a
 * fixture's content length is `count + 1` and the page arithmetic is explicit.
 */
function toolsModel(count: number): CurrentTuiModel {
  return modelWith({
    tools: Array.from({ length: count }, (_, index) => ({
      id: `tool-${index + 1}`,
      timestamp: "2026-09-16T10:00:00Z",
      name: `tool-${index + 1}`,
      status: "succeeded" as const,
    })),
  });
}

/** One component instance, so key handling and rendering share one state. */
function componentWith(model: CurrentTuiModel, tab: CurrentTab = "tools") {
  return createCurrentTuiComponent({
    model,
    load: async (scope) => createCurrentTuiModel(model.report, scope),
    theme,
    initialTab: tab,
    requestRender: () => {},
    done: () => {},
  });
}

const KEY_DOWN = "\u001B[B";
const KEY_UP = "\u001B[A";
const KEY_RIGHT = "\u001B[C";
const KEY_LEFT = "\u001B[D";

/** Every rendered content line, in page order, ignoring the fixed chrome. */
function contentLines(lines: readonly string[]): string[] {
  return lines.filter(
    (line) => line.startsWith("Tool: ") || line.startsWith("Tools: "),
  );
}

test("shows native bucket economics and inline coverage in Overview", () => {
  const usage = {
    totalTokens: 41,
    cost: 0.182,
    inputTokens: 27,
    outputTokens: 12,
    cacheReadTokens: 1,
    cacheWriteTokens: 1,
    reasoningTokens: 3,
    inputCost: 0.065,
    outputCost: 0.094,
    cacheReadCost: 0.01,
    cacheWriteCost: 0.013,
  };
  const component = componentWith(
    modelWith({
      usage,
      usageEconomics: projectUsageEconomics(usage),
    }),
    "overview",
  );
  const firstPage = component.render(120);
  component.handleInput(KEY_DOWN);
  const rendered = [...firstPage, ...component.render(120)].join("\n");
  assert.match(rendered, /Token totals:/);
  assert.match(rendered, /Cache:/);
  assert.match(rendered, /Input tokens: 27/);
  assert.match(rendered, /Output cost: 0\.094/);
  assert.match(rendered, /Cache read tokens: 1/);
  assert.match(rendered, /Reasoning tokens: 3/);
  assert.match(rendered, /Cache reuse: 3\.4%/);
  assert.match(rendered, /Cache denominator: 29/);
});

test("shows cache hit percentage and native compaction count in Overview", () => {
  const lines = renderTab(
    modelWith({
      usage: {
        totalTokens: 42,
        cost: 0.01,
        inputTokens: 30,
        cacheReadTokens: 5,
        cacheWriteTokens: 2,
      },
      compactions: [
        {
          id: "compaction-1",
          timestamp: "2026-01-01T00:00:00.000Z",
          kind: "compaction",
          usage: { totalTokens: 1, cost: 0 },
        },
        {
          id: "branch-1",
          timestamp: "2026-01-01T00:00:01.000Z",
          kind: "branch_summary",
          usage: { totalTokens: 1, cost: 0 },
        },
      ],
    }),
    "overview",
  );

  assert.match(lines.join("\n"), /Cache hit: 13\.5%/);
  assert.match(lines.join("\n"), /Compactions: 1/);

  const noInput = renderTab(
    modelWith({
      usage: {
        totalTokens: 0,
        cost: 0,
        inputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    }),
    "overview",
  );
  assert.match(noInput.join("\n"), /Cache hit: Unavailable/);
});

test("renders inventory, presence, agent activity, and bounded error messages", () => {
  const model = modelWith({
    commands: {
      state: "supported",
      count: 1,
      items: [
        {
          name: "ponytail",
          source: "extension",
          sourceLabel: "npm:ponytail",
          scope: "user",
          origin: "package",
        },
      ],
    },
    skills: {
      state: "supported",
      invocationState: "supported",
      invocationCount: 2,
      otherInvocations: 0,
      items: [{ name: "council-mode", explicitInvocations: 2 }],
      count: 1,
    },
    resources: {
      state: "supported",
      items: [
        {
          sourceLabel: "npm:ponytail",
          scope: "user",
          origin: "package",
          commands: 1,
          skills: 0,
          prompts: 0,
          tools: 0,
        },
      ],
    },
    agentActivity: {
      state: "supported",
      calls: 3,
      succeeded: 1,
      failed: 1,
      interrupted: 1,
      tools: [{ name: "subagent", calls: 2 }],
    },
    integrations: [
      { integration: "caveman", presence: "absent", state: "unavailable" },
    ],
    errors: [
      {
        id: "generation:a1",
        timestamp: "2026-09-11T10:00:00Z",
        kind: "generation-error",
        confidence: "native",
        message: "429 rate limit from [URL]",
      },
    ],
  });

  assert.match(renderTab(model, "commands").join("\n"), /ponytail/);
  assert.match(renderTab(model, "skills").join("\n"), /council-mode/);
  assert.match(renderTab(model, "agents").join("\n"), /Calls: 3/);
  assert.match(renderTab(model, "integrations").join("\n"), /Not observed/);
  assert.match(renderTab(model, "errors").join("\n"), /429 rate limit/);
});

test("keeps counted skill names visible after the inventory expires", () => {
  const expired = modelWith({
    skills: {
      state: "unavailable",
      invocationState: "supported",
      invocationCount: 2,
      otherInvocations: 0,
      items: [{ name: "council-mode", explicitInvocations: 2 }],
      count: null,
    },
  });

  const lines = renderTab(expired, "skills");
  const rendered = lines.join("\n");
  assert.match(rendered, /council-mode/);
  assert.match(rendered, /invocations: 2/);
  assert.match(rendered, /Inventory: Unavailable/);
  assert.ok(!lines.includes("Unavailable"));

  const empty = renderTab(modelWith({}), "skills");
  assert.ok(empty.includes("Unavailable"));
});

test("states the skills inventory count, never the activity-inflated row count", () => {
  // The snapshot lists two skills while the folded counters name a third the
  // snapshot does not carry: the line is availability, so it counts the
  // inventory rows only and leaves the counted name to the row list.
  const counted = modelWith({
    skills: {
      state: "supported",
      invocationState: "supported",
      invocationCount: 5,
      otherInvocations: 1,
      items: [
        { name: "council-mode", explicitInvocations: 2 },
        { name: "guard-mode" },
        { name: "retired-mode", explicitInvocations: 3 },
      ],
      count: 2,
    },
  });
  const component = componentWith(counted, "skills");
  const lines = component.render(120);
  const rendered = lines.join("\n");
  assert.match(rendered, /Skills: 2/);
  assert.equal(/Skills: 3/.test(rendered), false);
  // The counted name is the third row, so it is on the second content page
  // now that the view renders a bounded page of lines.
  component.handleInput(KEY_DOWN);
  assert.match(component.render(120).join("\n"), /retired-mode/);

  // A supported inventory whose count is unknown states Unavailable rather
  // than falling back to the rows it renders.
  const unknownCount = modelWith({
    skills: {
      state: "supported",
      invocationState: "unavailable",
      invocationCount: null,
      otherInvocations: null,
      items: [{ name: "council-mode" }],
      count: null,
    },
  });
  assert.match(
    renderTab(unknownCount, "skills").join("\n"),
    /Skills: Unavailable/,
  );
});

test("shares the ≠ inventory copy with the HTML renderer", () => {
  const expected =
    "Inventory ≠ invocations. Counts are availability, never activity.";
  assert.equal(visibleWidth("≠"), 1);

  for (const tab of ["commands", "skills"] as const) {
    assert.ok(
      renderTab(modelWith({}), tab).includes(expected),
      `${tab} tab must render the shared inventory copy`,
    );
  }
});

test("guards the integration version fallback", () => {
  const withoutVersion = renderTab(
    modelWith({
      integrations: [
        { integration: "caveman", presence: "absent", state: "unavailable" },
      ],
    }),
    "integrations",
  ).join("\n");
  assert.match(withoutVersion, /Version: Unavailable/);
  assert.ok(!withoutVersion.includes("Version: undefined"));

  const withVersion = renderTab(
    modelWith({
      integrations: [
        {
          integration: "context",
          presence: "present",
          state: "supported",
          version: 3,
        },
      ],
    }),
    "integrations",
  ).join("\n");
  assert.match(withVersion, /Version: 3/);
});

test("renders the + N other invocations footnote only when non-zero", () => {
  const withOther = modelWith({
    skills: {
      state: "supported",
      invocationState: "supported",
      invocationCount: 3,
      otherInvocations: 2,
      items: [{ name: "alpha", explicitInvocations: 1 }],
      count: 1,
    },
  });
  assert.match(
    renderTab(withOther, "skills").join("\n"),
    /\+ 2 other invocations/,
  );

  const withoutOther = modelWith({
    skills: {
      state: "supported",
      invocationState: "supported",
      invocationCount: 1,
      otherInvocations: 0,
      items: [{ name: "alpha", explicitInvocations: 1 }],
      count: 1,
    },
  });
  assert.ok(
    !renderTab(withoutOther, "skills").join("\n").includes("other invocations"),
  );
});

test("keeps the agents tab populated by activity alone", () => {
  const model = modelWith({
    agentActivity: {
      state: "supported",
      calls: 3,
      succeeded: 1,
      failed: 1,
      interrupted: 1,
      tools: [{ name: "subagent", calls: 2 }],
    },
  });

  const lines = renderTab(model, "agents");
  const rendered = lines.join("\n");
  assert.ok(lines.length > 0);
  assert.match(rendered, /Calls: 3/);
  assert.match(rendered, /Succeeded: 1/);
  assert.match(rendered, /Failed: 1/);
  assert.match(rendered, /Interrupted: 1/);
  assert.match(rendered, /Activity tool: subagent {2}Calls: 2/);
});

test("renders each tool source label or Unavailable", () => {
  const model = modelWith({
    tools: [
      {
        id: "tool-1",
        timestamp: "2026-09-11T10:00:00Z",
        name: "read",
        status: "succeeded",
        source: "npm:pi-tools",
      },
      {
        id: "tool-2",
        timestamp: "2026-09-11T10:01:00Z",
        name: "bash",
        status: "failed",
      },
    ],
  });

  const rendered = renderTab(model, "tools").join("\n");
  assert.match(rendered, /read {2}Source: npm:pi-tools/);
  assert.match(rendered, /bash {2}Source: Unavailable/);
});

test("renders fixed tabs, changes scope, and closes", async () => {
  let closed = false;
  let renders = 0;
  const component = createCurrentTuiComponent({
    model: createCurrentTuiModel(report, "active"),
    load: async (scope) => createCurrentTuiModel(report, scope),
    theme,
    requestRender: () => {
      renders++;
    },
    done: () => {
      closed = true;
    },
  });

  assert.ok(component.render(120).some((line) => line.includes("Overview")));
  assert.ok(component.render(40).some((line) => line.includes("Models")));

  component.handleInput?.("t");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.ok(component.render(120).some((line) => line.includes("Scope: Tree")));
  assert.equal(renders, 1);

  component.handleInput?.("q");
  assert.equal(closed, true);
});

test("handles arrow navigation and Escape", () => {
  let closed = false;
  const component = createCurrentTuiComponent({
    model: createCurrentTuiModel(report, "active"),
    load: async (scope) => createCurrentTuiModel(report, scope),
    theme,
    requestRender: () => {},
    done: () => {
      closed = true;
    },
  });

  component.handleInput("\u001B[C");
  assert.ok(component.render(120).some((line) => line.includes("Models: 0")));
  component.handleInput("\u001B[D");
  assert.ok(
    component.render(120).some((line) => line.includes("Total tokens: 42")),
  );
  component.handleInput("\u001B");
  assert.equal(closed, true);
});

test("uses the vertical selector until the complete horizontal tab row fits", () => {
  const component = createCurrentTuiComponent({
    model: createCurrentTuiModel(report, "active"),
    load: async (scope) => createCurrentTuiModel(report, scope),
    theme,
    requestRender: () => {},
    done: () => {},
  });
  const horizontalTabs =
    "Overview | Models | Tools | Commands | Agents | Skills | Integrations | Errors | Ledger";

  for (let width = 80; width <= 86; width++) {
    const lines = component.render(width);
    assert.ok(
      lines.includes("> Overview"),
      `expected vertical selector at ${width}`,
    );
    assert.ok(
      !lines.includes(horizontalTabs),
      `unexpected tab row at ${width}`,
    );
  }

  const lines = component.render(87);
  assert.ok(lines.includes(horizontalTabs));
  assert.equal(visibleWidth(horizontalTabs), 87);
});

test("reloads the report when the scope changes", async () => {
  const scopes: string[] = [];
  const component = createCurrentTuiComponent({
    model: createCurrentTuiModel(report, "active"),
    load: async (scope: "active" | "tree") => {
      scopes.push(scope);
      return createCurrentTuiModel(
        { ...report, usage: { totalTokens: 72, cost: 0.086 } },
        scope,
      );
    },
    theme,
    requestRender: () => {},
    done: () => {},
  });

  component.handleInput("t");
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(scopes, ["tree"]);
  assert.ok(
    component.render(120).some((line) => line.includes("Total tokens: 72")),
  );
});

test("applies only the latest scope reload completion", async () => {
  let resolveTree:
    | ((model: ReturnType<typeof createCurrentTuiModel>) => void)
    | undefined;
  let resolveActive:
    | ((model: ReturnType<typeof createCurrentTuiModel>) => void)
    | undefined;
  const component = createCurrentTuiComponent({
    model: createCurrentTuiModel(report, "active"),
    load: (scope) =>
      new Promise((resolve) => {
        if (scope === "tree") resolveTree = resolve;
        else resolveActive = resolve;
      }),
    theme,
    requestRender: () => {},
    done: () => {},
  });

  component.handleInput("t");
  component.handleInput("a");
  assert.ok(resolveTree);
  assert.ok(resolveActive);

  resolveActive(
    createCurrentTuiModel(
      { ...report, usage: { totalTokens: 42, cost: 0.01 } },
      "active",
    ),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  resolveTree(
    createCurrentTuiModel(
      { ...report, usage: { totalTokens: 72, cost: 0.086 } },
      "tree",
    ),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));

  const lines = component.render(120);
  assert.ok(lines.some((line) => line.includes("Scope: Active")));
  assert.ok(lines.some((line) => line.includes("Total tokens: 42")));
});

test("renders bounded agent and integration evidence", () => {
  const component = createCurrentTuiComponent({
    model: createCurrentTuiModel(
      {
        ...report,
        agents: [
          {
            id: "child-run",
            parentId: "parent-run",
            status: "succeeded",
            confidence: "cooperative",
            effortCoverage: {
              duration: "partial",
              generations: "unavailable",
              tools: "partial",
              errors: "unavailable",
              usage: "partial",
              cost: "partial",
            },
            durationMs: 1234,
            toolCalls: 3,
            usage: { totalTokens: 20, cost: 3 },
          },
        ],
        integrations: [
          {
            integration: "context",
            presence: "unknown",
            version: 1,
            state: "supported",
            counters: { calls: 1 },
          },
        ],
      },
      "active",
    ),
    load: async () => undefined,
    theme,
    requestRender: () => {},
    done: () => {},
  });

  for (let index = 0; index < 4; index++) component.handleInput("\u001B[C");
  const renderedAgents = component.render(120).join("\n");
  assert.ok(renderedAgents.includes("child-run"));
  assert.ok(renderedAgents.includes("Duration: Known 1.2 s"));
  assert.ok(renderedAgents.includes("Generations: Unavailable"));
  assert.ok(renderedAgents.includes("Tool calls: Known 3"));
  assert.ok(renderedAgents.includes("Error count: Unavailable"));
  assert.ok(renderedAgents.includes("Effort coverage: duration partial"));
  assert.ok(renderedAgents.includes("Tokens: Known 20"));
  assert.ok(renderedAgents.includes("Cost: Known 3"));
  // `parent-run` is not an Inspector-owned run identity, so L2's verdict is
  // `unknown`: the parent cell states Unavailable and never echoes the value.
  assert.ok(renderedAgents.includes(ENGLISH_CATALOG["agents.parentUnknown"]));
  assert.ok(!renderedAgents.includes("parent-run"));

  component.handleInput("\u001B[C");
  component.handleInput("\u001B[C");
  const renderedIntegrations = component.render(120).join("\n");
  assert.ok(renderedIntegrations.includes("context"));
  assert.ok(renderedIntegrations.includes("calls: 1"));
  assert.equal(
    renderedIntegrations.includes("raw-tool-result-sentinel"),
    false,
  );
});

test("keeps fixed tabs visible when their content is unavailable", () => {
  const component = createCurrentTuiComponent({
    model: createCurrentTuiModel(report, "active"),
    load: async (scope) => createCurrentTuiModel(report, scope),
    theme,
    requestRender: () => {},
    done: () => {},
  });
  const unavailableTabs = new Set([
    "commands",
    "agents",
    "skills",
    "integrations",
  ]);

  for (const [index, tab] of CURRENT_TABS.entries()) {
    const lines = component.render(20);
    assert.ok(
      lines.some((line) => line.includes(tab[0].toUpperCase() + tab.slice(1))),
    );
    if (unavailableTabs.has(tab)) assert.ok(lines.includes("Unavailable"));
    if (index < CURRENT_TABS.length - 1) component.handleInput("\u001B[C");
  }
});

test("defers ledger materialization until the Ledger tab is selected", () => {
  let generationReads = 0;
  const lazyReport = {
    ...report,
    get generations() {
      generationReads++;
      return [];
    },
  } as SessionReport;
  const component = createCurrentTuiComponent({
    model: createCurrentTuiModel(lazyReport, "active"),
    load: async (scope) => createCurrentTuiModel(lazyReport, scope),
    theme,
    requestRender: () => {},
    done: () => {},
  });

  component.render(20);
  assert.equal(generationReads, 0);

  for (let index = 1; index < CURRENT_TABS.length; index++) {
    component.handleInput("\u001B[C");
  }
  component.render(20);
  assert.equal(generationReads, 1);
});

test("keeps every rendered line within 20 columns on every tab", () => {
  const component = createCurrentTuiComponent({
    model: createCurrentTuiModel(report, "active"),
    load: async (scope) => createCurrentTuiModel(report, scope),
    theme,
    requestRender: () => {},
    done: () => {},
  });

  for (let index = 0; index < CURRENT_TABS.length; index++) {
    assert.ok(component.render(20).every((line) => visibleWidth(line) <= 20));
    component.handleInput("\u001B[C");
  }
});

test("does not paginate content that fits one page", () => {
  const lines = componentWith(toolsModel(5)).render(120);

  assert.ok(!lines.some((line) => line.startsWith("Page ")));
  assert.ok(lines.some((line) => line.startsWith("Tool: tool-5 ")));
  assert.equal(contentLines(lines).length, 6);
});

test("bounds the first page of content longer than one page", () => {
  const lines = componentWith(toolsModel(13)).render(120);

  assert.ok(lines.includes("Page 1/2 · lines 1–12 of 14"));
  assert.equal(contentLines(lines).length, 12);
  assert.ok(lines.some((line) => line.startsWith("Tool: tool-11 ")));
  assert.ok(!lines.some((line) => line.startsWith("Tool: tool-12 ")));
});

test("Down advances the content page and Up returns", () => {
  const component = componentWith(toolsModel(13));

  component.handleInput(KEY_DOWN);
  const second = component.render(120);
  assert.ok(second.includes("Page 2/2 · lines 13–14 of 14"));
  assert.ok(second.some((line) => line.startsWith("Tool: tool-12 ")));
  assert.ok(second.some((line) => line.startsWith("Tool: tool-13 ")));
  assert.ok(!second.some((line) => line.startsWith("Tool: tool-1 ")));

  component.handleInput(KEY_UP);
  assert.ok(component.render(120).includes("Page 1/2 · lines 1–12 of 14"));
});

test("cannot page before the first or after the last page", () => {
  const component = componentWith(toolsModel(13));

  component.handleInput(KEY_UP);
  assert.ok(component.render(120).includes("Page 1/2 · lines 1–12 of 14"));

  for (let index = 0; index < 4; index++) component.handleInput(KEY_DOWN);
  assert.ok(component.render(120).includes("Page 2/2 · lines 13–14 of 14"));
});

test("switching tabs resets the content page", () => {
  const component = componentWith(toolsModel(13));

  component.handleInput(KEY_DOWN);
  assert.ok(component.render(120).includes("Page 2/2 · lines 13–14 of 14"));

  component.handleInput(KEY_RIGHT);
  assert.ok(!component.render(120).some((line) => line.startsWith("Page ")));

  component.handleInput(KEY_LEFT);
  assert.ok(component.render(120).includes("Page 1/2 · lines 1–12 of 14"));
});

test("changing scope resets the content page", async () => {
  const component = componentWith(toolsModel(13));

  component.handleInput(KEY_DOWN);
  assert.ok(component.render(120).includes("Page 2/2 · lines 13–14 of 14"));

  component.handleInput("t");
  await new Promise<void>((resolve) => setImmediate(resolve));
  const tree = component.render(120);
  assert.ok(tree.some((line) => line.includes("Scope: Tree")));
  assert.ok(tree.includes("Page 1/2 · lines 1–12 of 14"));
});

test("reaches every content line exactly once across pages", () => {
  const component = componentWith(toolsModel(13));
  const seen: string[] = [];

  seen.push(...contentLines(component.render(120)));
  component.handleInput(KEY_DOWN);
  seen.push(...contentLines(component.render(120)));

  assert.deepEqual(seen, [
    "Tools: 13",
    ...Array.from(
      { length: 13 },
      (_, index) =>
        `Tool: tool-${index + 1}  Source: Unavailable  Status: succeeded`,
    ),
  ]);
});

const MALFORMED_PARENT_RUN = "parent-run";
const OPAQUE_ROW_ID = `subagent-${"a".repeat(64)}`;

/** One agent row with the given id and optional parent identity. */
function agentRow(
  id: string,
  parentId?: string,
  usage?: SessionReport["agents"][number]["usage"],
): SessionReport["agents"][number] {
  return {
    id,
    ...(parentId === undefined ? {} : { parentId }),
    status: "succeeded",
    confidence: "cooperative",
    effortCoverage: {
      duration: "unavailable",
      generations: "unavailable",
      tools: "unavailable",
      errors: "unavailable",
      usage: usage?.totalTokens === undefined ? "unavailable" : "partial",
      cost: usage?.cost === undefined ? "unavailable" : "partial",
    },
    ...(usage === undefined ? {} : { usage }),
  };
}

/** Every line with `prefix` across `pages` content pages of one tab. */
function linesAcrossPages(
  component: ReturnType<typeof componentWith>,
  pages: number,
  prefix: string,
): string[] {
  const collected: string[] = [];
  for (let page = 0; page < pages; page++) {
    if (page > 0) component.handleInput(KEY_DOWN);
    collected.push(
      ...component.render(120).filter((line) => line.startsWith(prefix)),
    );
  }
  return collected;
}

test("renders the semantic parent verdict instead of a raw run id", () => {
  const component = componentWith(
    modelWith({
      agents: [
        agentRow(OPAQUE_ROW_ID),
        agentRow("run-with-malformed-parent", MALFORMED_PARENT_RUN),
        agentRow("run-in-container", `subagent-${"b".repeat(64)}`),
        agentRow("run-with-report-parent", OPAQUE_ROW_ID),
        {
          ...agentRow(`subagent-${"f".repeat(64)}`),
          executionKind: "async",
        },
      ],
      agentEvidence: "supported",
      agentUsage: { runsTotal: 5, runsWithUsage: 0 },
    }),
    "agents",
  );
  // Five runs render more than one page of lines, so the cells are collected
  // from every page: pagination must not drop a verdict.
  const parentCells = linesAcrossPages(component, 4, "Parent: ");
  assert.equal(parentCells.length, 5);
  assert.ok(parentCells[0]?.includes(ENGLISH_CATALOG["agents.parentNone"]));
  assert.ok(parentCells[4]?.includes(ENGLISH_CATALOG["agents.parentUnknown"]));

  const rendered = parentCells.join("\n");
  assert.ok(rendered.includes(ENGLISH_CATALOG["agents.parentNone"]));
  assert.ok(rendered.includes(ENGLISH_CATALOG["agents.parentUnknown"]));
  assert.ok(
    rendered.includes(ENGLISH_CATALOG["agents.parentOrchestrationRun"]),
  );
  assert.ok(rendered.includes("Parent: run in this report"));

  for (const cell of parentCells) {
    assert.ok(!cell.includes("subagent-"), `raw run id leaked: ${cell}`);
    assert.ok(!cell.includes(MALFORMED_PARENT_RUN));
  }
});

test("keeps unavailable distinct from an observed zero", () => {
  const unavailable = renderTab(
    modelWith({ usage: undefined }),
    "overview",
  ).join("\n");
  assert.match(unavailable, /Usage: unavailable/);
  assert.ok(!unavailable.includes("Total tokens: 0"));

  const zero = renderTab(
    modelWith({ usage: { totalTokens: 0, cost: 0 } }),
    "overview",
  ).join("\n");
  assert.match(zero, /Total tokens: 0/);
  assert.match(zero, /Cost: 0/);

  const runWithoutUsage = renderTab(
    modelWith({
      agents: [agentRow("run-a")],
      agentEvidence: "supported",
      agentUsage: { runsTotal: 1, runsWithUsage: 0 },
    }),
    "agents",
  ).join("\n");
  assert.ok(!runWithoutUsage.includes("Tokens: 0"));
  assert.ok(!runWithoutUsage.includes("Cost: 0"));
});

test("keeps partial child-run usage visible", () => {
  const withUsage = agentRow("run-a", undefined, {
    totalTokens: 20,
    cost: 3,
  });
  const rendered = renderTab(
    modelWith({
      agents: [withUsage, agentRow("run-b"), agentRow("run-c")],
      agentEvidence: "supported",
      agentUsage: { runsTotal: 3, runsWithUsage: 1 },
    }),
    "agents",
  ).join("\n");

  assert.match(rendered, /usage reported by 1 of 3/);
});

test("renders unavailable for missing child token or cost", () => {
  const tokenOnly = renderTab(
    modelWith({
      agents: [agentRow("token-only", undefined, { totalTokens: 20 })],
      agentEvidence: "supported",
      agentUsage: { runsTotal: 1, runsWithUsage: 1 },
    }),
    "agents",
  ).join("\\n");
  const costOnly = renderTab(
    modelWith({
      agents: [agentRow("cost-only", undefined, { cost: 3 })],
      agentEvidence: "supported",
      agentUsage: { runsTotal: 1, runsWithUsage: 1 },
    }),
    "agents",
  ).join("\\n");

  assert.match(tokenOnly, /Tokens: Known 20/);
  assert.match(tokenOnly, /Cost: Unavailable/);
  assert.match(costOnly, /Tokens: Unavailable/);
  assert.match(costOnly, /Cost: Known 3/);
  assert.ok(!tokenOnly.includes("undefined"));
  assert.ok(!costOnly.includes("undefined"));
});

test("keeps child usage wording non-additive", () => {
  const withUsage = agentRow("run-a", undefined, {
    totalTokens: 20,
    cost: 3,
  });
  const lines = renderTab(
    modelWith({
      agents: [withUsage],
      agentEvidence: "supported",
      agentUsage: { runsTotal: 1, runsWithUsage: 1 },
    }),
    "agents",
  );
  const rendered = lines.join("\n");

  assert.match(rendered, /breakdown only; never added to session totals/);
  const summary = lines.filter((line) => line.startsWith("Child runs: "));
  assert.equal(summary.length, 1);
  for (const line of summary) assert.ok(!/total/i.test(line));
});

test("states an empty ledger as no records rather than unavailable", () => {
  const rendered = renderTab(modelWith({}), "ledger").join("\n");

  assert.ok(rendered.includes(ENGLISH_CATALOG["empty.ledger"]));
  assert.ok(!rendered.includes("Unavailable"));
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import type { SessionReport } from "../../src/core/reports.ts";
import { createCurrentTuiComponent } from "../../src/ui/current-tui.ts";
import {
  CURRENT_TABS,
  createCurrentTuiModel,
  type CurrentTab,
  type CurrentTuiModel,
} from "../../src/ui/current.ts";

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
    invocationState: "unavailable",
    invocationCount: null,
    otherInvocations: null,
  },
  resources: { state: "unavailable", items: [] },
  errors: [],
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
  assert.ok(renderedAgents.includes("parent-run"));
  assert.ok(renderedAgents.includes("child-run"));
  assert.ok(renderedAgents.includes("Cost: 3"));

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

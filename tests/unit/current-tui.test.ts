import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import type { SessionReport } from "../../src/core/reports.ts";
import { createCurrentTuiComponent } from "../../src/ui/current-tui.ts";
import { CURRENT_TABS, createCurrentTuiModel } from "../../src/ui/current.ts";

const report: SessionReport = {
  sessionId: "session-1",
  usage: { totalTokens: 42, cost: 0.01 },
  models: [],
  tools: [],
  compactions: [],
  generations: [],
};

const theme = { fg: (_color: string, text: string) => text };

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
    "errors",
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

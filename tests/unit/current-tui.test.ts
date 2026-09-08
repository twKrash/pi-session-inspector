import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import type { SessionReport } from "../../src/core/reports.ts";
import { createCurrentTuiComponent } from "../../src/ui/current-tui.ts";
import { createCurrentTuiModel } from "../../src/ui/current.ts";

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

test("keeps every rendered line within the terminal width", () => {
  const component = createCurrentTuiComponent({
    model: createCurrentTuiModel(report, "active"),
    load: async (scope) => createCurrentTuiModel(report, scope),
    theme,
    requestRender: () => {},
    done: () => {},
  });

  assert.ok(component.render(20).every((line) => visibleWidth(line) <= 20));
});

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

test("renders fixed tabs, changes scope, and closes", () => {
  let closed = false;
  let renders = 0;
  const component = createCurrentTuiComponent({
    model: createCurrentTuiModel(report, "active"),
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
  assert.ok(component.render(120).some((line) => line.includes("Scope: Tree")));
  assert.equal(renders, 1);

  component.handleInput?.("q");
  assert.equal(closed, true);
});

test("handles arrow navigation and Escape", () => {
  let closed = false;
  const component = createCurrentTuiComponent({
    model: createCurrentTuiModel(report, "active"),
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

test("keeps every rendered line within the terminal width", () => {
  const component = createCurrentTuiComponent({
    model: createCurrentTuiModel(report, "active"),
    theme,
    requestRender: () => {},
    done: () => {},
  });

  assert.ok(component.render(20).every((line) => visibleWidth(line) <= 20));
});

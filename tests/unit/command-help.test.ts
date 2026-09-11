import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  createInspectorHelpComponent,
  inspectorHelpLines,
} from "../../src/commands/help.ts";

test("help copy is frozen shared state", () => {
  assert.equal(Object.isFrozen(inspectorHelpLines()), true);
});

test("help lists only valid combinations and every mode", () => {
  const lines = inspectorHelpLines().join("\n");
  assert.match(lines, /session-inspector ui/);
  assert.match(lines, /session-inspector tui/);
  assert.match(lines, /session-inspector json/);
  assert.match(lines, /--theme dark\|light/);
  assert.equal(lines.includes("--format"), false);
  assert.equal(lines.includes("--subagents-artifact"), false);
  assert.equal(lines.split("\n").length <= 30, true);
});

test("help copy stays width-safe and complete", () => {
  const lines = inspectorHelpLines();
  for (const line of lines) assert.equal(visibleWidth(line) <= 72, true, line);
  const joined = lines.join("\n");
  assert.match(joined, /--scope active\|tree/);
  assert.match(joined, /--output/);
  assert.match(joined, /--no-open/);
  assert.match(joined, /default/i);
});

test("help component renders every line, closes on esc and q, and never throws", () => {
  const rendered: string[] = [];
  const theme = {
    fg: (_color: string, text: string) => {
      rendered.push(text);
      return text;
    },
  };
  let closed = 0;
  const component = createInspectorHelpComponent({
    theme,
    done: () => {
      closed += 1;
    },
  });

  const output = component.render(120);
  assert.deepEqual(output, inspectorHelpLines());
  assert.equal(rendered.length, inspectorHelpLines().length);

  const narrow = component.render(10);
  assert.equal(narrow.length, inspectorHelpLines().length);
  for (const line of narrow) assert.equal(visibleWidth(line) <= 10, true, line);

  component.handleInput?.("q");
  component.handleInput?.("\u001b");
  assert.equal(closed, 2);
  component.invalidate();
});

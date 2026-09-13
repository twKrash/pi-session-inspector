import assert from "node:assert/strict";
import { test } from "node:test";
import { completeInspectorCommand } from "../../src/commands/completions.ts";

test("offers only valid completions for the current token", () => {
  const labels = (prefix: string) =>
    (completeInspectorCommand(prefix) ?? []).map((item) => item.label);

  assert.deepEqual(labels(""), ["ui", "tui", "json", "help"]);
  assert.deepEqual(labels("u"), ["ui"]);
  assert.deepEqual(labels("tui "), ["current", "ledger"]);
  assert.deepEqual(labels("json "), ["current", "history", "global"]);
  assert.deepEqual(labels("ui -"), [
    "--scope",
    "--theme",
    "--output",
    "--no-open",
  ]);
  assert.deepEqual(labels("json -"), ["--scope", "--output"]);
  assert.deepEqual(labels("ui --theme "), ["dark", "light"]);
  assert.deepEqual(labels("ui --scope "), ["active", "tree"]);
  assert.deepEqual(labels("tui --theme "), []);
  assert.equal(completeInspectorCommand("ui --nope "), null);
  assert.equal(completeInspectorCommand("nonsense "), null);
  // `json history|global` force `--scope tree`; `active` is a parser error there.
  assert.deepEqual(labels("json history --scope "), ["tree"]);
  assert.deepEqual(labels("json global --scope "), ["tree"]);
  assert.deepEqual(labels("json current --scope "), ["active", "tree"]);
  assert.deepEqual(labels("json --scope "), ["active", "tree"]);
  assert.deepEqual(labels("tui --scope "), ["active", "tree"]);
});

test("keeps completing after a settled target without offering options too early", () => {
  const labels = (prefix: string) =>
    (completeInspectorCommand(prefix) ?? []).map((item) => item.label);

  assert.deepEqual(labels("tui c"), ["current"]);
  assert.deepEqual(labels("tui current "), ["--scope"]);
  assert.deepEqual(labels("json history "), ["--scope", "--output"]);
  assert.deepEqual(labels("ui "), [
    "--scope",
    "--theme",
    "--output",
    "--no-open",
  ]);
  assert.deepEqual(labels("tui xyz"), []);
});

test("completion values rewrite the raw prefix instead of re-joining tokens", () => {
  const items = completeInspectorCommand(
    'ui --output "/tmp/my report.json" --th',
  );
  assert.deepEqual(
    items?.map((item) => item.value),
    ['ui --output "/tmp/my report.json" --theme'],
  );
  assert.equal(items?.[0]?.label, "--theme");
});

test("a trailing space keeps the quotes and offers the next token", () => {
  const items = completeInspectorCommand(
    'json history --output "/tmp/a b.json" ',
  );
  assert.ok(
    items?.every((item) =>
      item.value.startsWith('json history --output "/tmp/a b.json"'),
    ),
  );
  assert.deepEqual(
    items?.map((item) => item.value),
    ['json history --output "/tmp/a b.json" --scope'],
  );
});

test("an option already present is not offered again", () => {
  const items = completeInspectorCommand("ui --theme dark --");
  assert.deepEqual(
    [
      items?.some((item) => item.label === "--theme"),
      items?.some((item) => item.label === "--scope"),
    ],
    [false, true],
  );
});

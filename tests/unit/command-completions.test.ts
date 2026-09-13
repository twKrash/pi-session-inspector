import assert from "node:assert/strict";
import { test } from "node:test";
import { completeInspectorCommand } from "../../src/commands/completions.ts";

test("offers only valid completions for the current token", () => {
  const labels = (prefix: string) =>
    (completeInspectorCommand(prefix) ?? []).map((item) => item.label);

  assert.deepEqual(labels(""), ["ui", "snapshot", "tui", "json", "help"]);
  assert.deepEqual(labels("u"), ["ui"]);
  assert.deepEqual(labels("snapshot "), [
    "current",
    "history",
    "global",
    "session",
  ]);
  assert.deepEqual(labels("tui "), ["current", "ledger"]);
  assert.deepEqual(labels("json "), ["current", "history", "global"]);
  assert.deepEqual(labels("ui -"), ["--scope", "--theme", "--no-open"]);
  assert.deepEqual(labels("snapshot current -"), [
    "--scope",
    "--preset",
    "--from",
    "--to",
    "--theme",
    "--output",
    "--no-open",
  ]);
  assert.deepEqual(labels("json -"), ["--scope", "--output"]);
  assert.deepEqual(labels("snapshot current --preset "), ["7", "14", "30"]);
  assert.deepEqual(labels("snapshot current --theme "), ["dark", "light"]);
  assert.deepEqual(labels("ui --theme "), ["dark", "light"]);
  assert.deepEqual(labels("ui --scope "), ["active", "tree"]);
  assert.deepEqual(labels("tui --theme "), []);
  assert.equal(completeInspectorCommand("ui --nope "), null);
  assert.equal(completeInspectorCommand("nonsense "), null);
  assert.equal(completeInspectorCommand("json history --scope "), null);
  assert.equal(completeInspectorCommand("json global --scope "), null);
  assert.deepEqual(labels("json current --scope "), ["active", "tree"]);
  assert.deepEqual(labels("json --scope "), ["active", "tree"]);
  assert.deepEqual(labels("tui --scope "), ["active", "tree"]);
  assert.equal(completeInspectorCommand("snapshot session "), null);
  assert.deepEqual(labels("snapshot session session-a "), [
    "--theme",
    "--output",
    "--no-open",
  ]);
});

test("keeps completing after a settled target without offering options too early", () => {
  const labels = (prefix: string) =>
    (completeInspectorCommand(prefix) ?? []).map((item) => item.label);

  assert.deepEqual(labels("tui c"), ["current"]);
  assert.deepEqual(labels("tui current "), ["--scope"]);
  assert.deepEqual(labels("json history "), ["--output"]);
  assert.deepEqual(labels("ui "), ["--scope", "--theme", "--no-open"]);
  assert.deepEqual(labels("tui xyz"), []);
});

test("completion values rewrite the raw prefix instead of re-joining tokens", () => {
  const items = completeInspectorCommand(
    'snapshot current --output "/tmp/my report.html" --th',
  );
  assert.deepEqual(
    items?.map((item) => item.value),
    ['snapshot current --output "/tmp/my report.html" --theme'],
  );
  assert.equal(items?.[0]?.label, "--theme");
});

test("a trailing space keeps the quotes and offers the next token", () => {
  const items = completeInspectorCommand(
    'snapshot history --output "/tmp/a b.html" ',
  );
  assert.ok(
    items?.every((item) =>
      item.value.startsWith('snapshot history --output "/tmp/a b.html"'),
    ),
  );
  assert.deepEqual(
    items?.map((item) => item.value),
    [
      'snapshot history --output "/tmp/a b.html" --preset',
      'snapshot history --output "/tmp/a b.html" --from',
      'snapshot history --output "/tmp/a b.html" --to',
      'snapshot history --output "/tmp/a b.html" --theme',
      'snapshot history --output "/tmp/a b.html" --no-open',
    ],
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

import assert from "node:assert/strict";
import { test } from "node:test";
import { completeInspectorCommand } from "../../src/commands/completions.ts";

test("offers only valid completions for the current token", () => {
  const values = (prefix: string) =>
    (completeInspectorCommand(prefix) ?? []).map((item) => item.value);

  assert.deepEqual(values(""), ["ui", "tui", "json", "help"]);
  assert.deepEqual(values("u"), ["ui"]);
  assert.deepEqual(values("tui "), ["current", "ledger"]);
  assert.deepEqual(values("json "), ["current", "history", "global"]);
  assert.deepEqual(values("ui -"), [
    "--scope",
    "--theme",
    "--output",
    "--no-open",
  ]);
  assert.deepEqual(values("json -"), ["--scope", "--output"]);
  assert.deepEqual(values("ui --theme "), ["dark", "light"]);
  assert.deepEqual(values("ui --scope "), ["active", "tree"]);
  assert.deepEqual(values("tui --theme "), []);
  assert.equal(completeInspectorCommand("ui --nope "), null);
  assert.equal(completeInspectorCommand("nonsense "), null);
  // `json history|global` force `--scope tree`; `active` is a parser error there.
  assert.deepEqual(values("json history --scope "), ["tree"]);
  assert.deepEqual(values("json global --scope "), ["tree"]);
  assert.deepEqual(values("json current --scope "), ["active", "tree"]);
  assert.deepEqual(values("json --scope "), ["active", "tree"]);
  assert.deepEqual(values("tui --scope "), ["active", "tree"]);
});

test("keeps completing after a settled target without offering options too early", () => {
  const values = (prefix: string) =>
    (completeInspectorCommand(prefix) ?? []).map((item) => item.value);

  assert.deepEqual(values("tui c"), ["current"]);
  assert.deepEqual(values("tui current "), ["--scope"]);
  assert.deepEqual(values("json history "), ["--scope", "--output"]);
  assert.deepEqual(values("ui "), [
    "--scope",
    "--theme",
    "--output",
    "--no-open",
  ]);
  assert.deepEqual(values("tui xyz"), []);
});

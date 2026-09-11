import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  readInventory,
  sanitizeSourceLabel,
} from "../../src/integrations/inventory.ts";

const fixture = (name: string) =>
  readFile(
    new URL(`../fixtures/integrations/${name}`, import.meta.url),
    "utf8",
  );

test("normalizes producer source labels without leaking paths or URLs", () => {
  assert.equal(sanitizeSourceLabel("local"), "local");
  assert.equal(sanitizeSourceLabel("auto"), "auto");
  assert.equal(sanitizeSourceLabel("builtin"), "builtin");
  assert.equal(sanitizeSourceLabel("npm:@scope/pkg@1.2.3"), "npm:@scope/pkg");
  assert.equal(
    sanitizeSourceLabel("git+ssh://git@github.com/a/b.git"),
    "other",
  );
  assert.equal(sanitizeSourceLabel("/home/dev/private-ext"), "other");
  assert.equal(sanitizeSourceLabel("C:\\Users\\dev\\ext"), "other");
  assert.equal(sanitizeSourceLabel("x".repeat(200)), "other");
});

test("sanitizes command, skill, tool, and resource-source inventory", async () => {
  const commands = JSON.parse(await fixture("commands-inventory.json"));
  const tools = JSON.parse(await fixture("tools-inventory.json"));

  const snapshot = readInventory(commands, tools);
  const serialized = JSON.stringify(snapshot);

  for (const leak of [
    "/home/",
    "C:\\",
    "file://",
    "secret",
    "PRIVATE",
    "promptGuidelines",
  ]) {
    assert.equal(serialized.includes(leak), false, leak);
  }

  assert.deepEqual(
    snapshot.commands.map((row) => row.name),
    ["session-inspector", "council-mode", "web-search"],
  );
  assert.equal(
    snapshot.commands.find((row) => row.name === "web-search")?.source,
    "prompt",
  );
  assert.equal(
    snapshot.skills.map((row) => row.name).join(","),
    "council-mode,hf-cli",
  );
  assert.equal(snapshot.toolSources.subagent, "npm:pi-subagents");
  assert.equal(snapshot.toolSources.read, "builtin");
  assert.equal("read" in snapshot.toolSources, true);

  const subagents = snapshot.resources.find(
    (row) => row.sourceLabel === "npm:pi-subagents",
  );
  assert.deepEqual(subagents, {
    sourceLabel: "npm:pi-subagents",
    scope: "user",
    origin: "package",
    commands: 1,
    skills: 2,
    prompts: 1,
    tools: 3,
  });

  assert.deepEqual(readInventory(commands, tools), snapshot);
});

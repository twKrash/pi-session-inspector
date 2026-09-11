import assert from "node:assert/strict";
import { test } from "node:test";
import { readIntegrationPresence } from "../../src/integrations/presence.ts";

test("maps native inventory signals to presence without guessing", () => {
  const rows = readIntegrationPresence({
    commands: ["ponytail", "caveman", "skill:council-mode"],
    tools: [
      "subagent",
      "subagent_wait",
      "ctx_execute",
      "lens_diagnostics",
      "read",
    ],
    permissionsReady: false,
    inventoryAvailable: true,
  });

  assert.deepEqual(rows, {
    context: "present",
    rtk: "unknown",
    ponytail: "present",
    caveman: "present",
    permission: "unknown",
    subagents: "present",
    lens: "present",
  });
});

test("reports absence only with an available inventory, and presence from a ready bus", () => {
  const rows = readIntegrationPresence({
    commands: [],
    tools: ["read", "bash"],
    permissionsReady: true,
    inventoryAvailable: true,
  });

  assert.equal(rows.ponytail, "absent");
  assert.equal(rows.caveman, "absent");
  assert.equal(rows.context, "absent");
  assert.equal(rows.subagents, "absent");
  assert.equal(rows.rtk, "unknown");
  assert.equal(rows.permission, "present");

  const unknown = readIntegrationPresence({
    commands: [],
    tools: [],
    permissionsReady: false,
    inventoryAvailable: false,
  });
  assert.deepEqual(unknown, {
    context: "unknown",
    rtk: "unknown",
    ponytail: "unknown",
    caveman: "unknown",
    permission: "unknown",
    subagents: "unknown",
    lens: "unknown",
  });
});

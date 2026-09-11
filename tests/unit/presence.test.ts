import assert from "node:assert/strict";
import { test } from "node:test";
import { readIntegrationPresence } from "../../src/integrations/presence.ts";

test("maps native inventory signals to presence without guessing", () => {
  const rows = readIntegrationPresence({
    extensionCommands: ["ponytail", "caveman"],
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
    extensionCommands: [],
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
    extensionCommands: [],
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

test("never reports an extension present from a same-named skill or prompt command", () => {
  // A loaded skill named `ponytail` contributes no extension command, so the
  // extension stays absent with an available inventory and never `present`.
  const skillOnly = readIntegrationPresence({
    extensionCommands: [],
    tools: [],
    permissionsReady: false,
    inventoryAvailable: true,
  });
  assert.equal(skillOnly.ponytail, "absent");
  assert.equal(skillOnly.caveman, "absent");

  const unavailable = readIntegrationPresence({
    extensionCommands: [],
    tools: [],
    permissionsReady: false,
    inventoryAvailable: false,
  });
  assert.equal(unavailable.ponytail, "unknown");

  // A real extension command named `ponytail` still reports present.
  const extension = readIntegrationPresence({
    extensionCommands: ["ponytail"],
    tools: [],
    permissionsReady: false,
    inventoryAvailable: true,
  });
  assert.equal(extension.ponytail, "present");
  assert.equal(extension.caveman, "absent");
});

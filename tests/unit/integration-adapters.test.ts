import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionEntry } from "../../src/core/events.ts";
import {
  cavemanIntegration,
  contextIntegration,
  legacyModeIntegration,
  lensIntegration,
  permissionIntegration,
  ponytailIntegration,
  rtkIntegration,
} from "../../src/integrations/adapters/index.ts";
import type {
  Integration,
  PersistedEvidenceContext,
  PresenceContext,
} from "../../src/integrations/contract.ts";

/** The one presence input shape the integrations read; overridden per test. */
function presence(overrides: Partial<PresenceContext> = {}): PresenceContext {
  return {
    extensionCommands: [],
    tools: [],
    observed: [],
    inventoryAvailable: true,
    ...overrides,
  };
}

/** One persisted read for one entry set. */
function persisted(entries: readonly SessionEntry[]): PersistedEvidenceContext {
  return { entries };
}

function custom(customType: string, data: unknown): SessionEntry {
  return {
    id: `${customType}-1`,
    parentId: null,
    timestamp: "2026-09-15T10:00:00.000Z",
    type: "custom",
    customType,
    data,
  };
}

function toolCalls(names: readonly string[]): SessionEntry {
  return {
    id: "message-1",
    parentId: null,
    timestamp: "2026-09-15T10:00:00.000Z",
    type: "message",
    message: {
      role: "assistant",
      content: names.map((name) => ({ type: "toolCall", id: name, name })),
    },
  };
}

function rtkMessage(rtkCompaction: Record<string, unknown>): SessionEntry {
  return {
    id: "message-rtk",
    parentId: null,
    timestamp: "2026-09-15T10:00:00.000Z",
    type: "message",
    message: { details: { rtkCompaction } },
  };
}

test("context folds its two evidence paths by maximum, not by sum", () => {
  const evidence = contextIntegration.hooks?.persisted?.(
    persisted([
      custom("ctx_status", { schemaVersion: 1 }),
      custom("ctx_status", { schemaVersion: 1 }),
      toolCalls(["ctx_execute"]),
      toolCalls(["ctx_execute", "read"]),
    ]),
  );
  assert.deepEqual(evidence, {
    integration: "context",
    state: "supported",
    version: 1,
    counters: { calls: 2 },
    reason: "evidence-supported",
  });

  // A version conflict is a contract report, never a merged counter set.
  assert.deepEqual(
    contextIntegration.hooks?.persisted?.(
      persisted([
        custom("ctx_status", { schemaVersion: 1 }),
        custom("ctx_status", { schemaVersion: 2 }),
      ]),
    ),
    {
      integration: "context",
      state: "unsupported",
      version: 2,
      reason: "unsupported-schema",
    },
  );
  assert.equal(
    contextIntegration.hooks?.persisted?.(persisted([toolCalls(["read"])])),
    undefined,
  );
});

test("context presence is the ctx_ tool prefix and its alias is its own metadata", () => {
  assert.equal(
    contextIntegration.hooks?.presence?.(presence({ tools: ["ctx_execute"] })),
    "present",
  );
  assert.equal(
    contextIntegration.hooks?.presence?.(presence({ tools: ["context7"] })),
    "absent",
  );
  assert.deepEqual(contextIntegration.aliases, ["ctx"]);
});

test("rtk reads both its persisted and native shapes through one counter contract", () => {
  const fromPersisted = rtkIntegration.hooks?.persisted?.(
    persisted([
      rtkMessage({
        schemaVersion: 1,
        sourceChars: 100,
        compactedChars: 20,
        sourceLines: 10,
        compactedLines: 2,
        truncated: false,
      }),
    ]),
  );
  assert.deepEqual(fromPersisted, {
    integration: "rtk",
    state: "supported",
    version: 1,
    counters: {
      compactions: 1,
      sourceChars: 100,
      compactedChars: 20,
      sourceLines: 10,
      compactedLines: 2,
      truncated: false,
    },
    reason: "evidence-supported",
  });

  const native = rtkIntegration.hooks?.persisted?.(
    persisted([
      rtkMessage({
        applied: true,
        originalCharCount: 5,
        compactedCharCount: 1,
        originalLineCount: 2,
        compactedLineCount: 1,
        truncated: true,
      }),
    ]),
  );
  assert.equal(native?.state, "supported");
  assert.deepEqual(native?.counters, {
    compactions: 1,
    sourceChars: 5,
    compactedChars: 1,
    sourceLines: 2,
    compactedLines: 1,
    truncated: true,
  });

  // An unusable schema marker is reported, never reinterpreted as native.
  assert.deepEqual(
    rtkIntegration.hooks?.persisted?.(
      persisted([rtkMessage({ schemaVersion: "two" })]),
    ),
    { integration: "rtk", state: "unsupported", reason: "unsupported-schema" },
  );
  // RTK has no presence signal: absence is never inferred.
  assert.equal((rtkIntegration as Integration).hooks?.presence, undefined);
});

test("ponytail and caveman count only their own bounded mode vocabulary", () => {
  const cases = [
    [ponytailIntegration, "ponytail-mode", "mode", "ultra", "maybe"],
    [cavemanIntegration, "caveman-level", "level", "wenyan-ultra", "shouty"],
  ] as const;

  for (const [integration, customType, field, valid, invalid] of cases) {
    assert.deepEqual(
      integration.hooks?.persisted?.(
        persisted([
          custom(customType, { [field]: valid }),
          custom(customType, { [field]: invalid }),
          custom(customType, {}),
        ]),
      ),
      {
        integration: integration.key,
        state: "supported",
        version: 1,
        counters: { changes: 1 },
        reason: "evidence-supported",
      },
      customType,
    );
    assert.equal(
      integration.hooks?.presence?.(
        presence({ extensionCommands: [integration.key] }),
      ),
      "present",
    );
    // A skill with the same name is not the extension command.
    assert.equal(
      integration.hooks?.presence?.(
        presence({ extensionCommands: [`skill:${integration.key}`] }),
      ),
      "absent",
    );
  }
});

test("lens presence and evidence share one tool vocabulary", () => {
  const lensTools = [
    "lens",
    "lens_diagnostics",
    "pi_lens_activate_tools",
    "lsp_navigation",
    "ast_grep_search",
  ];
  for (const tool of lensTools) {
    assert.equal(
      lensIntegration.hooks?.presence?.(presence({ tools: [tool] })),
      "present",
      tool,
    );
  }
  assert.equal(
    lensIntegration.hooks?.presence?.(presence({ tools: ["read"] })),
    "absent",
  );

  // A session that calls prefixed Lens tools has real evidence: presence and
  // evidence can no longer disagree about what a Lens tool is.
  assert.deepEqual(
    lensIntegration.hooks?.persisted?.(
      persisted([
        toolCalls(["lens", "read"]),
        toolCalls(["lens_diagnostics", "lens_diagnostics", "lsp_navigation"]),
      ]),
    ),
    {
      integration: "lens",
      state: "supported",
      version: 1,
      counters: { calls: 4 },
      reason: "evidence-supported",
    },
  );
  // An installed Lens tool with no call stays evidence-free, never a zero count.
  assert.equal(
    lensIntegration.hooks?.persisted?.(persisted([toolCalls(["read"])])),
    undefined,
  );
});

test("permission declares no presence or persisted hook of its own", () => {
  // Presence comes from the generic live/durable observation, and its counters
  // come from the telemetry fold: this slice declares none of those hooks, so
  // the integration is never inferred `absent` from a missing bus.
  assert.equal((permissionIntegration as Integration).hooks, undefined);
  assert.deepEqual(permissionIntegration.schemas[1].counters, [
    "decisions",
    "allowed",
    "denied",
    "prompts",
    "promptToolCall",
    "promptSkillInput",
    "promptSkillRead",
    "gateErrors",
  ]);
});

test("the legacy mode integration validates keys without hooks", () => {
  assert.equal(legacyModeIntegration.legacyOnly, true);
  assert.equal((legacyModeIntegration as Integration).hooks, undefined);
  assert.deepEqual(legacyModeIntegration.schemas[1].counters, ["changes"]);
});

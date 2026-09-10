import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

import registerSessionInspector from "../../src/index.ts";
import { renderHtml } from "../../src/ui/html.ts";
import { loadCurrentSessionReport } from "../../src/ui/load-current.ts";

type CommandHandler = (
  args: string,
  ctx: ExtensionCommandContext,
) => Promise<void>;
type CustomFactory = Parameters<ExtensionCommandContext["ui"]["custom"]>[0];

function registerCommand(handlerRef: { current?: CommandHandler }): void {
  registerSessionInspector({
    on: () => {},
    registerCommand: (name: string, command: { handler: CommandHandler }) => {
      if (name === "session-inspector") handlerRef.current = command.handler;
    },
  } as unknown as ExtensionAPI);
}

test("loads a durable current session report and leaves ephemeral sessions unavailable", async () => {
  assert.equal(
    await loadCurrentSessionReport(undefined, "active", null),
    undefined,
  );

  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const file = join(directory, "session.jsonl");
  await writeFile(
    file,
    [
      '{"type":"session","version":3,"id":"fixture-session"}',
      '{"type":"message","id":"entry-1","parentId":null,"timestamp":"2026-01-01T00:00:00.000Z","message":{"role":"assistant","provider":"acme","model":"alpha","usage":{"totalTokens":7,"cost":{"total":0.01}}}}',
    ].join("\n"),
  );

  const model = await loadCurrentSessionReport(file, "active", "entry-1");
  assert.equal(model?.report.sessionId, "fixture-session");
  assert.equal(model?.scope, "active");
  assert.deepEqual(model?.report.agents, []);
  assert.equal(model?.report.agentEvidence, "unavailable");
  assert.deepEqual(model?.report.integrations, []);

  await writeFile(file, '{"type":"message"}\n');
  assert.equal(await loadCurrentSessionReport(file, "active", null), undefined);
  await writeFile(file, '{"type":"session","id":""}\n');
  assert.equal(await loadCurrentSessionReport(file, "active", null), undefined);
  await writeFile(file, "not JSONL\n");
  assert.equal(await loadCurrentSessionReport(file, "active", null), undefined);
  await writeFile(
    file,
    [
      '{"type":"session","version":3,"id":"fixture-session"}',
      '{"type":"message","id":"entry-1","parentId":null,"timestamp":"2026-01-01T00:00:00.000Z"}',
      "{ malformed JSONL",
    ].join("\n"),
  );
  assert.equal(
    await loadCurrentSessionReport(file, "active", "entry-1"),
    undefined,
  );
});

test("projects persisted Pi-entry integration evidence in the production loader", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const file = join(directory, "session.jsonl");
  await writeFile(
    file,
    [
      '{"type":"session","version":3,"id":"fixture-session"}',
      '{"type":"custom","id":"context-1","parentId":null,"timestamp":"2026-01-01T00:00:00.000Z","customType":"ctx_status","data":{"schemaVersion":1,"active":true}}',
    ].join("\n"),
  );

  const model = await loadCurrentSessionReport(file, "tree", null);
  assert.deepEqual(model?.report.integrations, [
    {
      integration: "context",
      version: 1,
      state: "supported",
      counters: { calls: 1 },
    },
  ]);
  assert.equal(model?.report.agentEvidence, "unavailable");
});

test("renders an unknown known-integration version as Unsupported in the production TUI", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const file = join(directory, "session.jsonl");
  await writeFile(
    file,
    [
      '{"type":"session","version":3,"id":"fixture-session"}',
      '{"type":"message","id":"rtk-1","parentId":null,"timestamp":"2026-01-01T00:00:00.000Z","message":{"details":{"rtkCompaction":{"schemaVersion":99,"sourceChars":100,"compactedChars":50,"sourceLines":10,"compactedLines":5,"truncated":false}}}}',
    ].join("\n"),
  );

  const handlerRef: { current?: CommandHandler } = {};
  registerCommand(handlerRef);
  assert.ok(handlerRef.current);
  await handlerRef.current("", {
    mode: "tui",
    sessionManager: {
      getLeafId: () => "rtk-1",
      getSessionFile: () => file,
    },
    ui: {
      notify: () => assert.fail("must load the persisted integration evidence"),
      custom: async (factory: CustomFactory) => {
        const component = await factory(
          { requestRender: () => {} } as never,
          { fg: (_color: string, text: string) => text } as never,
          undefined as never,
          () => {},
        );
        for (let index = 0; index < 6; index++)
          component.handleInput?.("\u001B[C");
        const rendered = component.render(120);
        assert.ok(rendered.includes("Integration: rtk"));
        assert.ok(rendered.includes("Status: Unsupported"));
        assert.equal(rendered.includes("Unavailable"), false);
      },
    },
  } as unknown as ExtensionCommandContext);
});

test("projects only an explicitly supplied public subagent artifact in the production loader", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const file = join(directory, "session.jsonl");
  await writeFile(
    file,
    [
      '{"type":"session","version":3,"id":"fixture-session"}',
      '{"type":"message","id":"entry-1","parentId":null,"timestamp":"2026-01-01T00:00:00.000Z","message":{"role":"assistant","provider":"acme","model":"alpha","usage":{"totalTokens":7,"cost":{"total":0.01}}}}',
    ].join("\n"),
  );
  const artifacts = JSON.parse(
    await readFile("tests/fixtures/integrations/subagents.json", "utf8"),
  ) as { foreground: unknown };

  const model = await loadCurrentSessionReport(
    file,
    "tree",
    null,
    artifacts.foreground,
  );

  assert.equal(model?.report.agentEvidence, "supported");
  assert.equal(model?.report.agents.length, 2);
  assert.equal(model?.report.usage.totalTokens, 7);
});

test("uses Pi's active leaf rather than the latest appended branch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const file = join(directory, "branching.jsonl");
  await writeFile(
    file,
    await readFile("tests/fixtures/pi/0.85.1/branching.jsonl", "utf8"),
  );

  const model = await loadCurrentSessionReport(file, "active", "e6");
  assert.equal(model?.report.usage.totalTokens, 42);
});

test("leaves active scope unavailable when Pi has no known active leaf", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const file = join(directory, "branching.jsonl");
  await writeFile(
    file,
    await readFile("tests/fixtures/pi/0.85.1/branching.jsonl", "utf8"),
  );

  assert.equal(await loadCurrentSessionReport(file, "active", null), undefined);
  assert.equal(
    await loadCurrentSessionReport(file, "active", "unknown-leaf"),
    undefined,
  );

  const tree = await loadCurrentSessionReport(file, "tree", null);
  assert.equal(tree?.report.usage.totalTokens, 72);
});

test("opens the current-session TUI through Pi's public session lookup", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const file = join(directory, "session.jsonl");
  await writeFile(
    file,
    await readFile("tests/fixtures/pi/0.85.1/branching.jsonl", "utf8"),
  );

  const handlerRef: { current?: CommandHandler } = {};
  registerCommand(handlerRef);

  let customCalls = 0;
  let notifications = 0;
  let toggleTree: (() => void) | undefined;
  let rendered: (() => string[]) | undefined;
  assert.ok(handlerRef.current);
  await handlerRef.current("", {
    mode: "tui",
    sessionManager: {
      getLeafId: () => "e6",
      getSessionFile: () => file,
    },
    ui: {
      notify: () => {
        notifications++;
      },
      custom: async (factory: CustomFactory) => {
        customCalls++;
        const component = await factory(
          { requestRender: () => {} } as never,
          { fg: (_color: string, text: string) => text } as never,
          undefined as never,
          () => {},
        );
        assert.ok(
          component
            .render(120)
            .some((line: string) => line.includes("Total tokens: 42")),
        );
        toggleTree = () => component.handleInput?.("t");
        rendered = () => component.render(120);
      },
    },
  } as unknown as ExtensionCommandContext);

  assert.equal(customCalls, 1);
  assert.equal(notifications, 0);
  assert.ok(toggleTree);
  toggleTree();
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  assert.ok(rendered?.().some((line) => line.includes("Total tokens: 72")));
});

test("loads a public subagent artifact supplied to the production command for active and tree scopes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const sessionFile = join(directory, "session.jsonl");
  const artifactFile = join(directory, "public artifact.json");
  await writeFile(
    sessionFile,
    [
      '{"type":"session","version":3,"id":"fixture-session"}',
      '{"type":"message","id":"entry-1","parentId":null,"timestamp":"2026-01-01T00:00:00.000Z","message":{"role":"assistant","provider":"acme","model":"alpha","usage":{"totalTokens":7,"cost":{"total":0.01}}}}',
    ].join("\n"),
  );
  const artifacts = JSON.parse(
    await readFile("tests/fixtures/integrations/subagents.json", "utf8"),
  ) as { foreground: unknown };
  await writeFile(artifactFile, JSON.stringify(artifacts.foreground));

  const handlerRef: { current?: CommandHandler } = {};
  registerCommand(handlerRef);
  let toggleTree: (() => void) | undefined;
  let rendered: (() => string[]) | undefined;
  assert.ok(handlerRef.current);
  await handlerRef.current(`current --subagents-artifact "${artifactFile}"`, {
    mode: "tui",
    sessionManager: {
      getLeafId: () => "entry-1",
      getSessionFile: () => sessionFile,
    },
    ui: {
      notify: () => assert.fail("must load a valid public artifact"),
      custom: async (factory: CustomFactory) => {
        const component = await factory(
          { requestRender: () => {} } as never,
          { fg: (_color: string, text: string) => text } as never,
          undefined as never,
          () => {},
        );
        for (let index = 0; index < 4; index++)
          component.handleInput?.("\u001B[C");
        assert.ok(
          component
            .render(120)
            .some((line) => line.includes("Evidence: cooperative")),
        );
        toggleTree = () => component.handleInput?.("t");
        rendered = () => component.render(120);
      },
    },
  } as unknown as ExtensionCommandContext);

  assert.ok(toggleTree);
  toggleTree();
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  assert.ok(
    rendered?.().some((line) => line.includes("Evidence: cooperative")),
  );
});

test("preserves supplied public subagent evidence in current JSON export without rendering the artifact path", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const sessionFile = join(directory, "session.jsonl");
  const artifactFile = join(directory, "public artifact.json");
  const output = join(directory, "report.json");
  await writeFile(
    sessionFile,
    [
      '{"type":"session","version":3,"id":"fixture-session"}',
      '{"type":"message","id":"entry-1","parentId":null,"timestamp":"2026-01-01T00:00:00.000Z","message":{"role":"assistant","provider":"acme","model":"alpha","usage":{"totalTokens":7,"cost":{"total":0.01}}}}',
    ].join("\n"),
  );
  const artifacts = JSON.parse(
    await readFile("tests/fixtures/integrations/subagents.json", "utf8"),
  ) as { foreground: unknown };
  await writeFile(artifactFile, JSON.stringify(artifacts.foreground));

  const handlerRef: { current?: CommandHandler } = {};
  registerCommand(handlerRef);
  assert.ok(handlerRef.current);
  await handlerRef.current(
    `current --format json --output "${output}" --subagents-artifact "${artifactFile}"`,
    {
      mode: "interactive",
      sessionManager: {
        getLeafId: () => "entry-1",
        getSessionFile: () => sessionFile,
        getSessionDir: () => directory,
      },
      ui: { notify: () => {}, custom: async () => assert.fail("must export") },
    } as unknown as ExtensionCommandContext,
  );
  const rendered = await readFile(output, "utf8");
  assert.match(rendered, /"agentEvidence":"supported"/);
  assert.equal(rendered.includes(artifactFile), false);
  const model = await loadCurrentSessionReport(
    sessionFile,
    "active",
    "entry-1",
    artifacts.foreground,
  );
  assert.ok(model);
  assert.equal(model.report.agentEvidence, "supported");
  const html = renderHtml({
    kind: "current",
    report: model.report,
    scope: "active",
  });
  assert.match(html, /"agents":\[/);
  assert.equal(html.includes(artifactFile), false);
});

test("treats a missing public subagent artifact as unavailable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const sessionFile = join(directory, "session.jsonl");
  await writeFile(
    sessionFile,
    [
      '{"type":"session","version":3,"id":"fixture-session"}',
      '{"type":"message","id":"entry-1","parentId":null,"timestamp":"2026-01-01T00:00:00.000Z","message":{"role":"assistant","provider":"acme","model":"alpha","usage":{"totalTokens":7,"cost":{"total":0.01}}}}',
    ].join("\n"),
  );

  const handlerRef: { current?: CommandHandler } = {};
  registerCommand(handlerRef);
  assert.ok(handlerRef.current);
  await handlerRef.current("--subagents-artifact missing.json", {
    mode: "tui",
    sessionManager: {
      getLeafId: () => "entry-1",
      getSessionFile: () => sessionFile,
    },
    ui: {
      notify: () => assert.fail("must retain the current view"),
      custom: async (factory: CustomFactory) => {
        const component = await factory(
          { requestRender: () => {} } as never,
          { fg: (_color: string, text: string) => text } as never,
          undefined as never,
          () => {},
        );
        for (let index = 0; index < 4; index++)
          component.handleInput?.("\u001B[C");
        assert.ok(component.render(120).some((line) => line === "Unavailable"));
      },
    },
  } as unknown as ExtensionCommandContext);
});

test("opens /ledger directly on the lazy Ledger tab", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const file = join(directory, "session.jsonl");
  await writeFile(
    file,
    [
      '{"type":"session","version":3,"id":"fixture-session"}',
      '{"type":"message","id":"entry-1","parentId":null,"timestamp":"2026-01-01T00:00:00.000Z","message":{"role":"assistant","provider":"acme","model":"alpha","usage":{"totalTokens":7,"cost":{"total":0.01}}}}',
    ].join("\n"),
  );
  const handlerRef: { current?: CommandHandler } = {};
  registerCommand(handlerRef);
  assert.ok(handlerRef.current);
  await handlerRef.current("ledger", {
    mode: "tui",
    sessionManager: { getLeafId: () => "entry-1", getSessionFile: () => file },
    ui: {
      notify: () => assert.fail("must open the ledger"),
      custom: async (factory: CustomFactory) => {
        const component = await factory(
          { requestRender: () => {} } as never,
          { fg: (_color: string, text: string) => text } as never,
          undefined as never,
          () => {},
        );
        assert.ok(
          component
            .render(120)
            .some((line) => line.includes("Ledger events: 1")),
        );
      },
    },
  } as unknown as ExtensionCommandContext);
});

test("rejects non-current command arguments without opening the current view", async () => {
  const handlerRef: { current?: CommandHandler } = {};
  registerCommand(handlerRef);

  let customCalls = 0;
  let notifications = 0;
  assert.ok(handlerRef.current);
  await handlerRef.current("history", {
    mode: "tui",
    sessionManager: {
      getLeafId: () => {
        assert.fail("must not look up a rejected command");
      },
      getSessionFile: () => {
        assert.fail("must not look up a rejected command");
      },
    },
    ui: {
      notify: () => {
        notifications++;
      },
      custom: async () => {
        customCalls++;
      },
    },
  } as unknown as ExtensionCommandContext);

  assert.equal(customCalls, 0);
  assert.equal(notifications, 1);
});

test("notifies and does not throw when public session lookup or replay is unavailable", async () => {
  const handlerRef: { current?: CommandHandler } = {};
  registerCommand(handlerRef);

  let notifications = 0;
  const directory = await mkdtemp(join(tmpdir(), "pi-session-inspector-"));
  const file = join(directory, "session.jsonl");
  await writeFile(
    file,
    [
      '{"type":"session","version":3,"id":"fixture-session"}',
      '{"type":"message","id":"entry-1","parentId":null,"timestamp":"2026-01-01T00:00:00.000Z"}',
    ].join("\n"),
  );
  assert.ok(handlerRef.current);
  await assert.doesNotReject(
    handlerRef.current("", {
      mode: "tui",
      sessionManager: {
        getLeafId: () => null,
        getSessionFile: () => file,
      },
      ui: {
        notify: () => {
          notifications++;
        },
        custom: async () => assert.fail("must not open without a session"),
      },
    } as unknown as ExtensionCommandContext),
  );
  await assert.doesNotReject(
    handlerRef.current("", {
      mode: "tui",
      sessionManager: {
        getLeafId: () => null,
        getSessionFile: () => undefined,
      },
      ui: {
        notify: () => {
          notifications++;
        },
        custom: async () => assert.fail("must not open without a session"),
      },
    } as unknown as ExtensionCommandContext),
  );
  await assert.doesNotReject(
    handlerRef.current("", {
      mode: "tui",
      sessionManager: {
        getLeafId: () => null,
        getSessionFile: () => join(tmpdir(), "missing-session.jsonl"),
      },
      ui: {
        notify: () => {
          notifications++;
        },
        custom: async () => assert.fail("must not open after replay failure"),
      },
    } as unknown as ExtensionCommandContext),
  );
  assert.equal(notifications, 3);
});

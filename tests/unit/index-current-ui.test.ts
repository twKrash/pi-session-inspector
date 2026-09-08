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

test("opens the current-session TUI through Pi's public session lookup", async () => {
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

  let customCalls = 0;
  let notifications = 0;
  assert.ok(handlerRef.current);
  await handlerRef.current("", {
    mode: "tui",
    sessionManager: {
      getLeafId: () => "entry-1",
      getSessionFile: () => file,
    },
    ui: {
      notify: () => {
        notifications++;
      },
      custom: async (factory: CustomFactory) => {
        customCalls++;
        const component = await factory(
          undefined as never,
          { fg: (_color: string, text: string) => text } as never,
          undefined as never,
          () => {},
        );
        assert.ok(
          component
            .render(120)
            .some((line: string) => line.includes("Total tokens: 7")),
        );
      },
    },
  } as unknown as ExtensionCommandContext);

  assert.equal(customCalls, 1);
  assert.equal(notifications, 0);
});

test("notifies and does not throw when public session lookup or replay is unavailable", async () => {
  const handlerRef: { current?: CommandHandler } = {};
  registerCommand(handlerRef);

  let notifications = 0;
  assert.ok(handlerRef.current);
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
  assert.equal(notifications, 2);
});

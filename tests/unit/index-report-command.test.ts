import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import registerSessionInspector from "../../src/index.ts";

type Handler = (args: string, ctx: ExtensionCommandContext) => Promise<void>;
type CustomFactory = Parameters<ExtensionCommandContext["ui"]["custom"]>[0];

type Harness = {
  directory: string;
  sessionFile: string;
  sessionDirectory: string;
  root: string;
  cache: string;
  notices: string[];
  opens: Array<[string, string[]]>;
  rendered: string[][];
  setOpenerResult(code: number): void;
  handler(alias?: string): Handler;
  context(
    overrides?: Partial<{
      mode: string;
      leafId: string | null;
      sessionFile: string | undefined;
    }>,
  ): ExtensionCommandContext;
  cleanup(): Promise<void>;
};

const SESSION_SOURCE = `${[
  { type: "session", version: 3, id: "real-session" },
  {
    type: "custom",
    id: "marker",
    parentId: null,
    customType: "session-inspector:tracking-start",
    data: { schemaVersion: 1 },
    timestamp: "2026-02-01T00:00:00Z",
  },
  ...[
    ["main", 7],
    ["sibling", 11],
  ].map(([id, tokens]) => ({
    type: "message",
    id,
    parentId: "marker",
    timestamp: "2026-02-01T01:00:00Z",
    message: {
      role: "assistant",
      provider: "acme",
      model: "alpha",
      content: [{ type: "text", text: "PRIVATE_BODY" }],
      usage: { totalTokens: tokens, cost: { total: 0.1 } },
    },
  })),
]
  .map((row) => JSON.stringify(row))
  .join("\n")}\n`;

async function createHarness(inventory?: {
  getCommands(): readonly unknown[];
  getAllTools(): readonly unknown[];
}): Promise<Harness> {
  const directory = await mkdtemp(join(tmpdir(), "inspector-command-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = directory;
  const root = join(directory, "session-inspector", "v1");
  const cache = join(root, "reports");
  const sessionDirectory = join(directory, "native");
  await mkdir(sessionDirectory);
  const sessionFile = join(sessionDirectory, "session.jsonl");
  await writeFile(sessionFile, SESSION_SOURCE);

  const handlers = new Map<string, Handler>();
  const notices: string[] = [];
  const opens: Array<[string, string[]]> = [];
  const rendered: string[][] = [];
  let openerResult = 0;
  registerSessionInspector({
    on: () => {},
    registerCommand: (name: string, command: { handler: Handler }) =>
      handlers.set(name, command.handler),
    ...(inventory === undefined
      ? {}
      : {
          getCommands: () => inventory.getCommands(),
          getAllTools: () => inventory.getAllTools(),
        }),
    exec: async (command: string, args: string[]) => {
      opens.push([command, args]);
      if (openerResult === -1) throw new Error("PRIVATE_OPENER");
      return {
        code: openerResult,
        killed: false,
        stdout: "",
        stderr: "PRIVATE_OPENER",
      };
    },
  } as unknown as ExtensionAPI);

  const context = (
    overrides: Partial<{
      mode: string;
      leafId: string | null;
      sessionFile: string | undefined;
    }> = {},
  ): ExtensionCommandContext =>
    ({
      mode: overrides.mode ?? "tui",
      sessionManager: {
        getSessionId: () => "real-session",
        getSessionFile: () =>
          "sessionFile" in overrides ? overrides.sessionFile : sessionFile,
        getLeafId: () => ("leafId" in overrides ? overrides.leafId : "main"),
        getSessionDir: () => sessionDirectory,
      },
      ui: {
        notify: (text: string) => notices.push(text),
        custom: async (factory: CustomFactory) => {
          const component = await factory(
            { requestRender: () => {} } as never,
            { fg: (_color: string, value: string) => value } as never,
            undefined as never,
            () => {},
          );
          rendered.push(component.render(120));
        },
      },
    }) as unknown as ExtensionCommandContext;

  return {
    directory,
    sessionFile,
    sessionDirectory,
    root,
    cache,
    notices,
    opens,
    rendered,
    setOpenerResult: (code) => {
      openerResult = code;
    },
    handler(alias = "session-ins") {
      const handler = handlers.get(alias);
      assert.ok(handler, `registered handler: ${alias}`);
      return handler;
    },
    context,
    async cleanup() {
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previous;
      await rm(directory, { recursive: true, force: true });
    },
  };
}

// biome-ignore lint/suspicious/noExplicitAny: decoding the report's embedded JSON in tests
function embeddedBundle(html: string): Record<string, any> {
  const match =
    /<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/.exec(
      html,
    );
  assert.notEqual(match, null, "report-data payload present");
  return JSON.parse(match?.[1] ?? "{}");
}

test("ui writes one self-contained bundle, honours the theme, and opens unless --no-open", async () => {
  const harness = await createHarness();
  try {
    const output = join(harness.directory, "inspector.html");
    await harness.handler()(
      `ui --theme dark --scope tree --output ${JSON.stringify(output)}`,
      harness.context(),
    );

    const html = await readFile(output, "utf8");
    assert.match(html, /theme-dark/);
    const data = embeddedBundle(html);
    assert.equal(data.kind, "bundle");
    assert.equal(data.current.active.report.sessionId, "real-session");
    assert.equal(data.current.tree.report.sessionId, "real-session");
    assert.equal(data.history.sessions.length, 0);
    assert.equal(html.includes("PRIVATE_BODY"), false);
    assert.equal(
      harness.notices.some((notice) =>
        notice.includes("Inspector report written"),
      ),
      true,
    );
    assert.equal(harness.opens.length, 1);
    assert.equal(harness.opens[0]?.[1].at(-1), output);
    assert.equal(
      harness.opens[0]?.[0],
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "rundll32"
          : "xdg-open",
    );

    await harness.handler("session-inspector")(
      `ui --output ${JSON.stringify(output)} --no-open`,
      harness.context(),
    );
    assert.equal(harness.opens.length, 1);
    const light = await readFile(output, "utf8");
    assert.equal(light.includes('class="theme-dark"'), false);

    harness.setOpenerResult(1);
    await harness.handler()(
      `ui --output ${JSON.stringify(output)}`,
      harness.context(),
    );
    assert.equal(
      harness.notices.at(-1),
      `Inspector report available at: ${output}`,
    );
    assert.equal(harness.notices.join().includes("PRIVATE_OPENER"), false);
  } finally {
    await harness.cleanup();
  }
});

test("legacy syntax and removed flags return usage instead of the generic message", async () => {
  const harness = await createHarness();
  try {
    for (const args of [
      "--format json",
      "current",
      "--subagents-artifact /tmp/x.json",
      "tui history",
      "json active",
    ]) {
      harness.notices.length = 0;
      harness.opens.length = 0;
      await harness.handler()(args, harness.context({ mode: "interactive" }));
      const text = harness.notices.join("\n");
      assert.equal(text.includes("options are unavailable"), false, args);
      assert.match(text, /help/i, args);
      assert.equal(harness.opens.length, 0, args);
    }
  } finally {
    await harness.cleanup();
  }
});

test("json current, history and global export deterministically and never open", async () => {
  const harness = await createHarness();
  try {
    const jsonPath = join(harness.directory, "current.json");
    await harness.handler()(
      `json --scope tree --output ${JSON.stringify(jsonPath)}`,
      harness.context({ mode: "interactive" }),
    );
    const first = await readFile(jsonPath, "utf8");
    assert.equal(JSON.parse(first).usage.totalTokens, 18);
    await harness.handler()(
      `json --scope tree --output ${JSON.stringify(jsonPath)}`,
      harness.context({ mode: "interactive" }),
    );
    assert.equal(await readFile(jsonPath, "utf8"), first);
    assert.equal(harness.opens.length, 0);

    await mkdir(join(harness.root, "sessions", "real-session"), {
      recursive: true,
    });
    await writeFile(
      join(harness.root, "sessions", "real-session", "meta.json"),
      JSON.stringify({
        schemaVersion: 2,
        sessionId: "real-session",
        sourceFile: "session.jsonl",
        state: "tracking",
      }),
    );
    await harness.handler()(
      "json history",
      harness.context({ mode: "interactive" }),
    );
    const history = JSON.parse(
      await readFile(join(harness.cache, "history.json"), "utf8"),
    );
    assert.equal(history.sessions[0].report.usage.totalTokens, 18);
    await harness.handler()(
      "json global",
      harness.context({ mode: "interactive" }),
    );
    const global = JSON.parse(
      await readFile(join(harness.cache, "global.json"), "utf8"),
    );
    assert.equal(global.usage.totalTokens, 18);
    assert.equal(harness.opens.length, 0);
    assert.equal(await readFile(harness.sessionFile, "utf8"), SESSION_SOURCE);
  } finally {
    await harness.cleanup();
  }
});

test("a report load refreshes the inventory snapshot only when the producer changed", async () => {
  const commands: unknown[] = [
    {
      name: "ponytail",
      source: "extension",
      sourceInfo: {
        source: "npm:ponytail",
        scope: "user",
        origin: "package",
      },
    },
  ];
  const tools: unknown[] = [
    {
      name: "read",
      sourceInfo: { source: "builtin", scope: "user", origin: "top-level" },
    },
  ];
  let failing = false;
  const harness = await createHarness({
    getCommands: () => {
      if (failing) throw new Error("producer down");
      return commands;
    },
    getAllTools: () => tools,
  });
  try {
    const sessionDirectory = join(harness.root, "sessions", "real-session");
    await mkdir(sessionDirectory, { recursive: true });
    const snapshotPath = join(sessionDirectory, "inventory.json");
    const output = join(harness.directory, "report.json");
    const names = (bytes: string) =>
      (JSON.parse(bytes).commands as { name: string }[]).map((row) => row.name);
    const run = () =>
      harness.handler()(
        `json --scope tree --output ${JSON.stringify(output)}`,
        harness.context({ mode: "interactive" }),
      );

    // The first report load captures the current producer rows.
    await run();
    const firstBytes = await readFile(snapshotPath, "utf8");
    assert.deepEqual(names(firstBytes), ["ponytail"]);
    const first = await stat(snapshotPath);

    // An unchanged producer hashes equal: the next load writes nothing.
    await sleep(20);
    await run();
    assert.equal(await readFile(snapshotPath, "utf8"), firstBytes);
    assert.equal((await stat(snapshotPath)).mtimeMs, first.mtimeMs);

    // A late runtime registration changes the hash: one atomic rewrite.
    commands.push({
      name: "caveman",
      source: "extension",
      sourceInfo: { source: "local", scope: "user", origin: "top-level" },
    });
    await sleep(20);
    await run();
    const changedBytes = await readFile(snapshotPath, "utf8");
    assert.notEqual(changedBytes, firstBytes);
    assert.deepEqual(names(changedBytes), ["ponytail", "caveman"]);
    const changed = await stat(snapshotPath);
    assert.ok(changed.mtimeMs > first.mtimeMs);

    // The refreshed snapshot feeds presence and the report injection...
    const report = JSON.parse(await readFile(output, "utf8"));
    assert.deepEqual(
      (report.commands.items as { name: string }[]).map((row) => row.name),
      ["ponytail", "caveman"],
    );
    assert.equal(
      (report.integrations as { integration: string; presence: string }[]).find(
        (row) => row.integration === "ponytail",
      )?.presence,
      "present",
    );

    // ...and the next identical load is a no-write again, so the change
    // produced exactly one rewrite.
    await sleep(20);
    await run();
    assert.equal(await readFile(snapshotPath, "utf8"), changedBytes);
    assert.equal((await stat(snapshotPath)).mtimeMs, changed.mtimeMs);

    // An unreadable producer keeps the last readable snapshot: no wipe, no
    // fabricated zero inventory, and the report still sees the last snapshot.
    failing = true;
    await run();
    assert.equal(await readFile(snapshotPath, "utf8"), changedBytes);
    assert.deepEqual(names(changedBytes), ["ponytail", "caveman"]);
  } finally {
    await harness.cleanup();
  }
});

test("json history --output leaves the Pi session, pending marker, and lease untouched", async () => {
  const harness = await createHarness();
  try {
    const sessionRoot = join(harness.root, "sessions", "real-session");
    await mkdir(sessionRoot, { recursive: true });
    const metadata = JSON.stringify({
      schemaVersion: 2,
      sessionId: "real-session",
      sourceFile: "session.jsonl",
      state: "tracking",
    });
    await writeFile(join(sessionRoot, "meta.json"), metadata);

    const output = join(harness.directory, "maintenance.json");
    await harness.handler()(
      `json history --output ${JSON.stringify(output)}`,
      harness.context({ mode: "interactive" }),
    );
    assert.equal(JSON.parse(await readFile(output, "utf8")).sessions.length, 1);
    // Reading history must never create a maintenance lease.
    await assert.rejects(access(join(sessionRoot, "maintenance.lease")));

    // Pi's live maintenance parks the metadata as a pending marker and holds
    // an expired lease; the observer must not reclaim, consume, or rewrite it.
    await rm(join(sessionRoot, "meta.json"));
    await writeFile(join(sessionRoot, "meta.json.pending"), metadata);
    const leaseDirectory = join(sessionRoot, "maintenance.lease");
    await mkdir(leaseDirectory);
    const owner = JSON.stringify({
      schemaVersion: 1,
      writerId: "live-maintainer",
      pid: process.pid,
      acquiredAt: Date.now() - 120_000,
      expiresAt: Date.now() - 90_000,
    });
    await writeFile(join(leaseDirectory, "owner.json"), owner);

    await harness.handler()(
      `json history --output ${JSON.stringify(output)}`,
      harness.context({ mode: "interactive" }),
    );

    assert.equal(
      await readFile(join(leaseDirectory, "owner.json"), "utf8"),
      owner,
    );
    await access(join(sessionRoot, "meta.json.pending"));
    await assert.rejects(access(join(sessionRoot, "meta.json")));
    assert.equal(await readFile(harness.sessionFile, "utf8"), SESSION_SOURCE);
  } finally {
    await harness.cleanup();
  }
});

test("tui opens the current component and the ledger tab", async () => {
  const harness = await createHarness();
  try {
    await harness.handler()("tui", harness.context());
    assert.equal(harness.rendered.length, 1);
    assert.ok(
      harness.rendered[0]?.some((line) => line.includes("Total tokens: 7")),
    );

    harness.rendered.length = 0;
    await harness.handler()("tui ledger", harness.context());
    assert.equal(harness.rendered.length, 1);
    assert.ok(
      harness.rendered[0]?.some((line) => line.includes("Ledger events:")),
    );
  } finally {
    await harness.cleanup();
  }
});

test("help opens the help component without touching report data", async () => {
  const harness = await createHarness();
  try {
    for (const args of ["help", "--help", "-h"]) {
      harness.rendered.length = 0;
      harness.notices.length = 0;
      await harness.handler()(args, harness.context());
      assert.equal(harness.rendered.length, 1, args);
      const lines = harness.rendered[0] ?? [];
      assert.ok(
        lines.some((line) => line.includes("command help")),
        args,
      );
      assert.equal(
        lines.some((line) => line.includes("Total tokens")),
        false,
        args,
      );
      assert.equal(harness.notices.length, 0, args);
      assert.equal(harness.opens.length, 0, args);
    }
  } finally {
    await harness.cleanup();
  }
});

test("runtime unavailability keeps its distinct current-session message", async () => {
  const harness = await createHarness();
  try {
    await harness.handler()(
      "tui",
      harness.context({ leafId: null, sessionFile: undefined }),
    );
    assert.equal(
      harness.notices.at(-1),
      "Current session Inspector data is unavailable.",
    );
    assert.equal(harness.rendered.length, 0);
  } finally {
    await harness.cleanup();
  }
});

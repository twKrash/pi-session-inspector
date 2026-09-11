import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import registerSessionInspector from "../../src/index.ts";
import { loadCurrentSessionReport } from "../../src/ui/load-current.ts";
import { renderHtml } from "../../src/ui/html.ts";
import { renderJson } from "../../src/ui/json.ts";

test("production aliases replay local Pi data through TUI, cached HTML, explicit exports and history/global", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-command-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = directory;
  try {
    const root = join(directory, "session-inspector", "v1");
    const cache = join(root, "reports");
    const sessionDirectory = join(directory, "native");
    await mkdir(sessionDirectory);
    const sessionFile = join(sessionDirectory, "session.jsonl");
    const source = `${[
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
    await writeFile(sessionFile, source);
    const handlers = new Map<
      string,
      (args: string, ctx: ExtensionCommandContext) => Promise<void>
    >();
    const opens: Array<[string, string[]]> = [];
    let openerResult = 0;
    registerSessionInspector({
      on: () => {},
      registerCommand: (
        name: string,
        command: {
          handler: (
            args: string,
            ctx: ExtensionCommandContext,
          ) => Promise<void>;
        },
      ) => handlers.set(name, command.handler),
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
    await assert.rejects(access(cache));
    const notices: string[] = [];
    let tuiCalls = 0;
    const ctx = {
      mode: "tui",
      sessionManager: {
        getSessionFile: () => sessionFile,
        getLeafId: () => "main",
        getSessionDir: () => sessionDirectory,
      },
      ui: {
        notify: (text: string) => notices.push(text),
        custom: async (
          factory: Parameters<ExtensionCommandContext["ui"]["custom"]>[0],
        ) => {
          tuiCalls++;
          const component = await factory(
            { requestRender: () => {} } as never,
            { fg: (_color: string, value: string) => value } as never,
            undefined as never,
            () => {},
          );
          assert.ok(
            component
              .render(120)
              .some((line) => line.includes("Total tokens: 7")),
          );
        },
      },
    } as unknown as ExtensionCommandContext;
    const run = async (args: string, alias = "session-ins") => {
      const handler = handlers.get(alias);
      assert.ok(handler);
      await handler(args, ctx);
    };
    await run("current");
    assert.equal(tuiCalls, 1);
    await assert.rejects(access(cache));
    const model = await loadCurrentSessionReport(sessionFile, "active", "main");
    assert.ok(model);
    assert.equal(model.report.usage.totalTokens, 7);
    await run("current --format html");
    const output = join(cache, "real-session.html");
    const html = await readFile(output, "utf8");
    assert.equal(
      html,
      renderHtml({ kind: "current", report: model.report, scope: "active" }),
    );
    assert.equal(html.includes("PRIVATE_BODY"), false);
    assert.equal(opens.length, 1);
    assert.equal(
      opens[0]?.[0],
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "rundll32"
          : "xdg-open",
    );
    assert.equal(opens[0]?.[1].at(-1), output);
    await run("current --format html --no-open", "session-inspector");
    assert.equal(await readFile(output, "utf8"), html);
    assert.equal(opens.length, 1);
    const explicit = join(directory, "user export.html");
    await run(`current --format html --output "${explicit}" --no-open`);
    assert.equal(await readFile(explicit, "utf8"), html);
    for (const code of [1, -1]) {
      openerResult = code;
      await run("current --format html");
      assert.equal(notices.at(-1), `Inspector report available at: ${output}`);
    }
    assert.equal(notices.join().includes("PRIVATE_OPENER"), false);
    const jsonPath = join(directory, "user.json");
    await run(`current --format json --output "${jsonPath}"`);
    assert.equal(await readFile(jsonPath, "utf8"), renderJson(model.report));
    await run(`current --format json --output "${jsonPath}"`);
    assert.equal(await readFile(jsonPath, "utf8"), renderJson(model.report));
    await mkdir(join(root, "sessions", "real-session"), { recursive: true });
    await writeFile(
      join(root, "sessions", "real-session", "meta.json"),
      JSON.stringify({
        schemaVersion: 2,
        sessionId: "real-session",
        sourceFile: "session.jsonl",
        state: "tracking",
      }),
    );
    await run("history --format json");
    const history = JSON.parse(
      await readFile(join(cache, "history.json"), "utf8"),
    );
    assert.equal(history.sessions[0].report.usage.totalTokens, 18);
    await run("history --format html --no-open");
    assert.equal(
      await readFile(join(cache, "history.html"), "utf8"),
      renderHtml({ kind: "history", report: history }),
    );
    openerResult = 0;
    await run("global");
    const globalHtml = await readFile(join(cache, "global.html"), "utf8");
    await run("global --format json");
    const globalJson = await readFile(join(cache, "global.json"), "utf8");
    const global = JSON.parse(globalJson);
    assert.equal(global.usage.totalTokens, 18);
    assert.equal(globalHtml, renderHtml({ kind: "global", report: global }));
    assert.equal(opens.at(-1)?.[1].at(-1), join(cache, "global.html"));
    await run("global --format json");
    assert.equal(
      await readFile(join(cache, "global.json"), "utf8"),
      globalJson,
    );
    for (const command of ["history", "global --format tui"]) {
      await run(command);
      assert.match(notices.at(-1) ?? "", /History\/global TUI is unavailable/);
    }
    assert.equal(tuiCalls, 1);
    const sessionRoot = join(root, "sessions", "real-session");
    const metadata = await readFile(join(sessionRoot, "meta.json"), "utf8");
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
    await run("history --format json");
    assert.equal(
      await readFile(join(leaseDirectory, "owner.json"), "utf8"),
      owner,
    );
    await access(join(sessionRoot, "meta.json.pending"));
    assert.equal(await readFile(sessionFile, "utf8"), source);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

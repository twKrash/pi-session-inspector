import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import registerSessionInspector, { registerTracking } from "../../src/index.ts";
import { readInventory } from "../../src/integrations/inventory.ts";
import { ENGLISH_CATALOG } from "../../src/ui/report-projection.ts";
import { generatedSnapshotPath } from "../../src/ui/report-output.ts";
import { closeInspectorServer } from "../../src/ui/server.ts";

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
  setLeafId(leafId: string | null): void;
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
  // The live leaf the session manager reports until a test moves it: the UI
  // server's callbacks must read it per request, not once per command.
  let currentLeafId: string | null = "main";
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
        getLeafId: () =>
          "leafId" in overrides ? overrides.leafId : currentLeafId,
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
    setLeafId: (leafId) => {
      currentLeafId = leafId;
    },
    handler(alias = "session-ins") {
      const handler = handlers.get(alias);
      assert.ok(handler, `registered handler: ${alias}`);
      return handler;
    },
    context,
    async cleanup() {
      await closeInspectorServer();
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previous;
      await rm(directory, { recursive: true, force: true });
    },
  };
}

/** Counts files in the reports cache; an absent cache holds none. */
async function countFiles(directory: string): Promise<number> {
  try {
    return (await readdir(directory)).length;
  } catch {
    return 0;
  }
}

/** The origin and token the `ui` command notified, or `undefined`. */
function bootstrapOf(
  notice: string,
): { origin: string; token: string } | undefined {
  const match =
    /^Inspector UI available at: (http:\/\/127\.0\.0\.1:\d+)\/#token=([A-Za-z0-9_-]{43})$/.exec(
      notice,
    );
  return match === null
    ? undefined
    : { origin: match[1] as string, token: match[2] as string };
}

/** One authenticated API read against the running UI server. */
async function apiGet(
  origin: string,
  path: string,
  token: string,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${origin}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return { status: response.status, body: await response.json() };
}

/** The one `/api/v1/ui` field set these command tests assert on. */
type UiSnapshotBody = {
  current: {
    active: { range?: { totals: { totalTokens: number } } };
    tree: { range?: { totals: { totalTokens: number } } };
  };
};

/** The one tracked-session manifest the command fixtures declare. */
async function writeSessionManifest(harness: Harness): Promise<void> {
  const directory = join(harness.root, "sessions", "real-session");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "meta.json"),
    JSON.stringify({
      schemaVersion: 2,
      sessionId: "real-session",
      sourceFile: "session.jsonl",
      state: "tracking",
    }),
  );
}

test("ui notifies one tokenized URL, writes no report, and serves current request-time state", async () => {
  const harness = await createHarness();
  try {
    await harness.handler()(
      "ui --theme dark --scope tree --no-open",
      harness.context({ mode: "interactive" }),
    );
    assert.equal(await countFiles(harness.cache), 0);
    const first = harness.notices.at(-1) ?? "";
    const bootstrap = bootstrapOf(first);
    assert.ok(bootstrap, first);
    assert.equal(harness.opens.length, 0);

    // `--output` is removed syntax for `ui`: the URL is its only output.
    harness.notices.length = 0;
    await harness.handler()(
      `ui --output ${JSON.stringify(join(harness.directory, "ui.html"))}`,
      harness.context({ mode: "interactive" }),
    );
    assert.match(harness.notices.at(-1) ?? "", /help/i);
    assert.equal(await countFiles(harness.cache), 0);

    // A repeated invocation reuses the one server and token; the request-time
    // context is replaced, so the next request reads the current leaf.
    harness.notices.length = 0;
    await harness.handler()(
      "ui --no-open",
      harness.context({ mode: "interactive" }),
    );
    assert.equal(harness.notices.at(-1), first);
    assert.deepEqual(bootstrapOf(harness.notices.at(-1) ?? ""), bootstrap);
    await writeSessionManifest(harness);

    // The one server reads the session manager's current values per request:
    // moving the leaf between requests changes the served active view without
    // any new command, and no request has replaced the context yet.
    const beforeMove = await apiGet(
      bootstrap.origin,
      "/api/v1/ui",
      bootstrap.token,
    );
    assert.equal(beforeMove.status, 200);
    assert.equal(
      (beforeMove.body as UiSnapshotBody).current.active.range?.totals
        .totalTokens,
      7,
    );
    harness.setLeafId("sibling");
    const ui = await apiGet(bootstrap.origin, "/api/v1/ui", bootstrap.token);
    assert.equal(ui.status, 200);
    const snapshot = ui.body as UiSnapshotBody & { theme: string };
    assert.equal(snapshot.current.active.range?.totals.totalTokens, 11);
    assert.equal(snapshot.current.tree.range?.totals.totalTokens, 18);

    // A later invocation replaces that request-time context: the theme is the
    // new command's and the leaf is still the session manager's current one.
    harness.notices.length = 0;
    await harness.handler()(
      "ui --no-open",
      harness.context({ mode: "interactive" }),
    );
    assert.equal(harness.notices.at(-1), first);
    const replaced = await apiGet(
      bootstrap.origin,
      "/api/v1/ui",
      bootstrap.token,
    );
    const replacedBody = replaced.body as UiSnapshotBody & { theme: string };
    assert.equal(replacedBody.theme, "light");
    assert.equal(replacedBody.current.active.range?.totals.totalTokens, 11);
    await writeSessionManifest(harness);

    const session = await apiGet(
      bootstrap.origin,
      "/api/v1/reports/sessions/real-session",
      bootstrap.token,
    );
    assert.equal(session.status, 200);
    assert.equal(
      (session.body as { sessionId: string }).sessionId,
      "real-session",
    );
    assert.equal(
      (session.body as { usage: { totalTokens: number } }).usage.totalTokens,
      18,
    );

    const global = await apiGet(
      bootstrap.origin,
      "/api/v1/reports/global",
      bootstrap.token,
    );
    assert.equal(global.status, 200);
    assert.deepEqual((global.body as { totals: unknown }).totals, {
      totalTokens: 18,
      cost: 0.2,
      days: 1,
    });

    // An opener failure never hides the tokenized URL: it is notified first.
    harness.setOpenerResult(1);
    harness.notices.length = 0;
    await harness.handler()("ui", harness.context({ mode: "interactive" }));
    assert.deepEqual(bootstrapOf(harness.notices.at(-1) ?? ""), bootstrap);
    assert.equal(harness.opens.length, 1);
    assert.equal(
      harness.opens[0]?.[1].at(-1),
      `${bootstrap.origin}/#token=${bootstrap.token}`,
    );
    assert.equal(harness.notices.join().includes("PRIVATE_OPENER"), false);

    assert.equal(await readFile(harness.sessionFile, "utf8"), SESSION_SOURCE);
  } finally {
    await harness.cleanup();
  }
});

test("snapshot writes exactly its requested target as one static document and never serves", async () => {
  const harness = await createHarness();
  try {
    await writeSessionManifest(harness);
    // A snapshot must never start the loopback listener. The count is
    // self-normalized against anything the test runner already holds, and the
    // settle lets a listener a previous test closed finish unregistering.
    await sleep(10);
    const countListeners = (): number =>
      process
        .getActiveResourcesInfo()
        .filter((name) => name === "TCPServerWrap").length;
    const listenersBefore = countListeners();

    await harness.handler()(
      "snapshot current --scope tree --preset 7 --theme dark --no-open",
      harness.context({ mode: "interactive" }),
    );
    const currentPath = generatedSnapshotPath(harness.cache, {
      target: "current",
      scope: "tree",
      range: { kind: "preset", preset: 7 },
      theme: "dark",
    });
    const currentHtml = await readFile(currentPath, "utf8");
    assert.equal(currentHtml.includes("<script"), false);
    assert.equal(currentHtml.includes("theme-dark"), true);
    assert.equal(
      currentHtml.includes(ENGLISH_CATALOG["heading.current"]),
      true,
    );
    // The preset resolves against the session's own observed date.
    assert.equal(currentHtml.includes("2026-01-26 → 2026-02-01"), true);
    assert.equal(
      harness.notices.at(-1),
      `Inspector report written: ${currentPath}`,
    );
    assert.equal(harness.opens.length, 0);

    await harness.handler()(
      "snapshot history --no-open",
      harness.context({ mode: "interactive" }),
    );
    const historyPath = generatedSnapshotPath(harness.cache, {
      target: "history",
      theme: "light",
    });
    assert.equal(
      (await readFile(historyPath, "utf8")).includes(
        ENGLISH_CATALOG["heading.history"],
      ),
      true,
    );

    await harness.handler()(
      "snapshot global --no-open",
      harness.context({ mode: "interactive" }),
    );
    const globalPath = generatedSnapshotPath(harness.cache, {
      target: "global",
      theme: "light",
    });
    assert.equal(
      (await readFile(globalPath, "utf8")).includes(
        ENGLISH_CATALOG["heading.global"],
      ),
      true,
    );

    await harness.handler()(
      "snapshot session real-session --no-open",
      harness.context({ mode: "interactive" }),
    );
    const sessionPath = generatedSnapshotPath(harness.cache, {
      target: "session",
      sessionId: "real-session",
      theme: "light",
    });
    const sessionHtml = await readFile(sessionPath, "utf8");
    assert.equal(sessionHtml.includes("real-session"), true);
    assert.equal(sessionHtml.includes(ENGLISH_CATALOG["nav.history"]), true);

    // Exactly the four requested documents exist: no target wrote another
    // target's file.
    assert.deepEqual(
      (await readdir(harness.cache)).sort(),
      [currentPath, historyPath, globalPath, sessionPath]
        .map((path) => basename(path))
        .sort(),
    );

    // The atomic session target accepts no scope or range: the grammar refuses
    // both before any load, and no fifth document is written.
    for (const args of [
      "snapshot session real-session --from 2026-02-01 --to 2026-02-02",
      "snapshot session real-session --scope tree",
      "snapshot session real-session --preset 7",
    ]) {
      await harness.handler()(args, harness.context({ mode: "interactive" }));
      assert.match(harness.notices.at(-1) ?? "", /usage|invalid|help/i, args);
    }
    assert.equal((await readdir(harness.cache)).length, 4);

    // A manifest no root declares is a bounded refusal, not a document.
    await harness.handler()(
      "snapshot session absent-session --no-open",
      harness.context({ mode: "interactive" }),
    );
    assert.match(harness.notices.at(-1) ?? "", /unavailable/i);
    assert.equal((await readdir(harness.cache)).length, 4);

    assert.equal(
      harness.notices.some((notice) =>
        notice.startsWith("Inspector UI available at:"),
      ),
      false,
    );
    assert.equal(countListeners(), listenersBefore);
    assert.equal(harness.opens.length, 0);
    assert.equal(await readFile(harness.sessionFile, "utf8"), SESSION_SOURCE);
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
    // The command writes the report DTO verbatim, so the inspection verdict and
    // the per-session dated-window flag travel with it (UAT 8).
    assert.deepEqual(
      [
        history.coverage.inspected,
        history.coverage.available,
        history.coverage.complete,
        history.sessions[0].usageByDateTruncated,
        "usageByDate" in history.sessions[0],
      ],
      [1, 1, true, false, true],
    );
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

test("json history projects the composition root's checkpoint evidence and inventory", async () => {
  const harness = await createHarness();
  try {
    const sessionRoot = join(harness.root, "sessions", "real-session");
    await mkdir(sessionRoot, { recursive: true });
    await writeFile(
      join(sessionRoot, "meta.json"),
      JSON.stringify({
        schemaVersion: 2,
        sessionId: "real-session",
        sourceFile: "session.jsonl",
        state: "tracking",
      }),
    );
    await writeFile(
      join(sessionRoot, "checkpoint.json"),
      JSON.stringify({
        schemaVersion: 1,
        cursors: { pi: { lineCount: 3, revision: "0".repeat(64) }, wal: {} },
        aggregates: {
          totalTokens: 18,
          totalCost: 0.2,
          generations: 2,
          tools: 0,
          compactions: 0,
          integrationCounters: { permission: { decisions: 2 } },
          skillInvocations: { "council-mode": 3 },
          skillOverflowInvocations: 2,
          presence: { permission: true },
          resourceCounts: { commands: 9, skills: 4 },
        },
      }),
    );

    type HistoryJson = {
      inventory: {
        commands: number | null;
        skills: number | null;
        resources: number | null;
      };
      sessions: Array<{
        report: {
          commands: { state: string; count: number | null };
          skills: {
            invocationCount: number | null;
            otherInvocations: number | null;
            items: readonly { name: string; explicitInvocations?: number }[];
          };
          resources: { items: readonly unknown[] };
          integrations: readonly { integration: string; presence: string }[];
          evidenceHealth: { aggregates: { detail: string } };
        };
      }>;
    };
    const historyPath = join(harness.cache, "history.json");
    const readHistory = async (): Promise<HistoryJson> =>
      JSON.parse(await readFile(historyPath, "utf8")) as HistoryJson;

    await harness.handler()(
      "json history",
      harness.context({ mode: "interactive" }),
    );
    const report = (await readHistory()).sessions[0]?.report;
    assert.equal(report?.evidenceHealth.aggregates.detail, "aggregate-only");
    assert.equal(report?.commands.count, 9);
    assert.equal(report?.skills.invocationCount, 5);
    assert.equal(report?.skills.otherInvocations, 2);
    assert.deepEqual(report?.skills.items, [
      { name: "council-mode", explicitInvocations: 3 },
    ]);
    assert.equal(
      report?.integrations.find((row) => row.integration === "permission")
        ?.presence,
      "present",
    );

    await harness.handler()(
      "json global",
      harness.context({ mode: "interactive" }),
    );
    const global = JSON.parse(
      await readFile(join(harness.cache, "global.json"), "utf8"),
    ) as HistoryJson;
    assert.deepEqual(global.inventory, {
      commands: 9,
      skills: 4,
      resources: null,
    });

    // A persisted snapshot read by the composition root feeds the same report,
    // while the checkpoint counts stay the global canonical resource totals.
    const snapshot = readInventory(
      [
        {
          name: "ponytail",
          source: "extension",
          sourceInfo: {
            source: "npm:ponytail",
            scope: "user",
            origin: "package",
          },
        },
      ],
      [
        {
          name: "subagent",
          parameters: {},
          sourceInfo: {
            source: "npm:pi-subagents",
            scope: "user",
            origin: "package",
          },
        },
      ],
    );
    await writeFile(
      join(sessionRoot, "inventory.json"),
      JSON.stringify(snapshot),
    );
    await harness.handler()(
      "json history",
      harness.context({ mode: "interactive" }),
    );
    const withInventory = (await readHistory()).sessions[0]?.report;
    assert.equal(withInventory?.commands.state, "supported");
    assert.equal(withInventory?.resources.items.length, 2);
    assert.equal(
      withInventory?.integrations.find((row) => row.integration === "ponytail")
        ?.presence,
      "present",
    );
  } finally {
    await harness.cleanup();
  }
});

test("a report load reuses unchanged inventory payload but advances its observation time", async () => {
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
    // Payload identity excludes the observation time, which is expected to
    // advance on every successful observation.
    const payload = (bytes: string): unknown => {
      const parsed = JSON.parse(bytes) as Record<string, unknown>;
      delete parsed.observedAt;
      return parsed;
    };
    const run = () =>
      harness.handler()(
        `json --scope tree --output ${JSON.stringify(output)}`,
        harness.context({ mode: "interactive" }),
      );

    // The first report load captures the current producer rows and stamps the
    // successful observation time.
    await run();
    const firstBytes = await readFile(snapshotPath, "utf8");
    assert.deepEqual(names(firstBytes), ["ponytail"]);
    const firstObservedAt = JSON.parse(firstBytes).observedAt as string;
    assert.equal(typeof firstObservedAt, "string");

    // An unchanged producer reuses the payload bytes, but a byte-equivalent
    // observation must still advance `observedAt` (spec §14.2.1).
    await sleep(20);
    await run();
    const secondBytes = await readFile(snapshotPath, "utf8");
    assert.deepEqual(payload(secondBytes), payload(firstBytes));
    const secondObservedAt = JSON.parse(secondBytes).observedAt as string;
    assert.notEqual(secondObservedAt, firstObservedAt);
    assert.ok(Date.parse(secondObservedAt) >= Date.parse(firstObservedAt));
    const second = await stat(snapshotPath);

    // A late runtime registration changes the hash: one atomic rewrite.
    commands.push({
      name: "caveman",
      source: "extension",
      sourceInfo: { source: "local", scope: "user", origin: "top-level" },
    });
    await sleep(20);
    await run();
    const changedBytes = await readFile(snapshotPath, "utf8");
    assert.notEqual(payload(changedBytes), payload(secondBytes));
    assert.deepEqual(names(changedBytes), ["ponytail", "caveman"]);
    const changed = await stat(snapshotPath);
    assert.ok(changed.mtimeMs >= second.mtimeMs);

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

    // ...and the next identical payload is reused while its observation time
    // advances, so the payload changed exactly once.
    await sleep(20);
    await run();
    const finalBytes = await readFile(snapshotPath, "utf8");
    assert.deepEqual(payload(finalBytes), payload(changedBytes));
    assert.deepEqual(names(finalBytes), ["ponytail", "caveman"]);

    // An unreadable producer keeps the last readable snapshot: no wipe, no
    // fabricated zero inventory, and the report still sees the last snapshot.
    failing = true;
    await run();
    const failedBytes = await readFile(snapshotPath, "utf8");
    assert.deepEqual(payload(failedBytes), payload(changedBytes));
    assert.deepEqual(names(failedBytes), ["ponytail", "caveman"]);
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

test("a repeated session_start for one session registers live observation exactly once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-tracking-"));
  const sessionDirectory = join(directory, "native");
  await mkdir(sessionDirectory);
  const sessionFile = join(sessionDirectory, "session.jsonl");
  await writeFile(sessionFile, SESSION_SOURCE);
  try {
    let handler:
      | ((event: unknown, context: unknown) => Promise<void>)
      | undefined;
    let setups = 0;
    let schedules = 0;
    registerTracking(
      {
        on: (
          _event: string,
          registered: (event: unknown, context: unknown) => Promise<void>,
        ) => {
          handler = registered;
        },
        appendEntry: () => {},
      } as unknown as Parameters<typeof registerTracking>[0],
      {
        agentDir: directory,
        track: async () => true,
        setupSessionWal: async () => {
          setups += 1;
        },
        schedule: () => {
          schedules += 1;
        },
      },
    );
    assert.ok(handler);
    const context = {
      sessionManager: {
        getSessionId: () => "real-session",
        getSessionFile: () => sessionFile,
        getSessionDir: () => sessionDirectory,
      },
    };
    await handler({}, context);
    await handler({}, context);
    // Tracking promotion is detached; let the microtask queue settle.
    await sleep(20);

    assert.equal(setups, 1, "second session_start must not register a writer");
    assert.equal(schedules, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a skill named after an absent extension is not reported present", async () => {
  const harness = await createHarness({
    getCommands: () => [
      {
        name: "skill:ponytail",
        source: "skill",
        sourceInfo: {
          source: "local",
          scope: "user",
          origin: "top-level",
        },
      },
    ],
    getAllTools: () => [],
  });
  try {
    const output = join(harness.directory, "skill-presence.json");
    await harness.handler()(
      `json --scope tree --output ${JSON.stringify(output)}`,
      harness.context({ mode: "interactive" }),
    );
    const report = JSON.parse(await readFile(output, "utf8"));
    const ponytail = (
      report.integrations as {
        integration: string;
        presence: string;
      }[]
    ).find((row) => row.integration === "ponytail");
    assert.equal(ponytail?.presence, "absent");
  } finally {
    await harness.cleanup();
  }
});

import assert from "node:assert/strict";
import {
  access,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
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
import { ENGLISH_CATALOG } from "../../src/ui/i18n/catalog.ts";
import {
  generatedReportPath,
  generatedSnapshotPath,
} from "../../src/ui/report-output.ts";
import { closeInspectorServer } from "../../src/ui/server.ts";
import { waitFor } from "../helpers/wait.ts";

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
  /** Interleaved `notify:`/`open:` trace proving the notification precedes the opener. */
  sequence: string[];
  rendered: string[][];
  setOpenerResult(code: number): void;
  setLeafId(leafId: string | null): void;
  replaceSession(session: {
    sessionId: string;
    sessionFile: string;
    leafId: string | null;
  }): void;
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

const REPLACEMENT_SESSION_SOURCE = `${[
  { type: "session", version: 3, id: "replacement-session" },
  {
    type: "custom",
    id: "marker",
    parentId: null,
    customType: "session-inspector:tracking-start",
    data: { schemaVersion: 1 },
    timestamp: "2026-02-02T00:00:00Z",
  },
  {
    type: "message",
    id: "fresh",
    parentId: "marker",
    timestamp: "2026-02-02T01:00:00Z",
    message: {
      role: "assistant",
      provider: "acme",
      model: "alpha",
      content: [{ type: "text", text: "PRIVATE_BODY" }],
      usage: { totalTokens: 5, cost: { total: 0.05 } },
    },
  },
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
  const sequence: string[] = [];
  const rendered: string[][] = [];
  let openerResult = 0;
  // The live session the session manager reports until a test moves or
  // replaces it: the UI server's callbacks must read it per request, not once
  // per command.
  let liveSession = {
    sessionId: "real-session",
    sessionFile,
    leafId: "main" as string | null,
  };
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
      sequence.push(`open:${args.at(-1) ?? ""}`);
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
        getSessionId: () => liveSession.sessionId,
        getSessionFile: () =>
          "sessionFile" in overrides
            ? overrides.sessionFile
            : liveSession.sessionFile,
        getLeafId: () =>
          "leafId" in overrides ? overrides.leafId : liveSession.leafId,
        getSessionDir: () => sessionDirectory,
      },
      ui: {
        notify: (text: string) => {
          notices.push(text);
          sequence.push(`notify:${text}`);
        },
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
    sequence,
    rendered,
    setOpenerResult: (code) => {
      openerResult = code;
    },
    setLeafId: (leafId) => {
      liveSession.leafId = leafId;
    },
    replaceSession: (session) => {
      liveSession = { ...session };
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
    tree: {
      range?: { totals: { totalTokens: number } };
      report?: { sessionId: string };
    };
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

/** A second tracked session, with its own facts, distinct from the live one. */
const OTHER_SESSION_SOURCE = `${[
  { type: "session", version: 3, id: "other-session" },
  {
    type: "custom",
    id: "marker",
    parentId: null,
    customType: "session-inspector:tracking-start",
    data: { schemaVersion: 1 },
    timestamp: "2026-02-03T00:00:00Z",
  },
  {
    type: "message",
    id: "other-main",
    parentId: "marker",
    timestamp: "2026-02-03T01:00:00Z",
    message: {
      role: "assistant",
      provider: "acme",
      model: "beta",
      content: [{ type: "text", text: "PRIVATE_BODY" }],
      usage: { totalTokens: 4321, cost: { total: 0.5 } },
    },
  },
  {
    type: "message",
    id: "other-call",
    parentId: "other-main",
    timestamp: "2026-02-03T01:05:00Z",
    message: {
      role: "assistant",
      provider: "acme",
      model: "beta",
      content: [
        {
          type: "toolCall",
          id: "other-call-1",
          name: "bash",
          arguments: { command: "PRIVATE_ARGUMENT" },
        },
      ],
      usage: { totalTokens: 0, cost: { total: 0 } },
    },
  },
  {
    type: "message",
    id: "other-result",
    parentId: "other-call",
    timestamp: "2026-02-03T01:06:00Z",
    message: {
      role: "toolResult",
      toolCallId: "other-call-1",
      toolName: "bash",
      isError: false,
      content: "PRIVATE_RESULT",
      usage: { totalTokens: 0, cost: { total: 0 } },
    },
  },
]
  .map((row) => JSON.stringify(row))
  .join("\n")}\n`;

/** Every raw producer string the fixtures carry, for absence assertions. */
const RAW_PRODUCER_TEXT = [
  "PRIVATE_BODY",
  "PRIVATE_ARGUMENT",
  "PRIVATE_RESULT",
] as const;

/** Declares that second session the way tracking does, and writes its source. */
async function writeOtherSession(harness: Harness): Promise<void> {
  const directory = join(harness.root, "sessions", "other-session");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "meta.json"),
    JSON.stringify({
      schemaVersion: 2,
      sessionId: "other-session",
      sourceFile: "other.jsonl",
      state: "tracking",
    }),
  );
  await writeFile(
    join(harness.sessionDirectory, "other.jsonl"),
    OTHER_SESSION_SOURCE,
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

test("a successful snapshot opens its written artifact unless --no-open is given", async () => {
  const harness = await createHarness();
  try {
    const output = join(harness.directory, "opened.html");
    await harness.handler()(
      `snapshot current --output ${JSON.stringify(output)}`,
      harness.context({ mode: "interactive" }),
    );
    // The path is notified first, then that exact document is handed to the
    // platform opener: the opener never receives a path the user was not told.
    assert.equal(harness.notices.at(-1), `Inspector report written: ${output}`);
    assert.equal((await readFile(output, "utf8")).includes("<script"), false);
    assert.equal(harness.opens.length, 1);
    assert.equal(
      harness.opens[0]?.[0],
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "rundll32"
          : "xdg-open",
    );
    assert.equal(harness.opens[0]?.[1].at(-1), output);
    // The opener receives the artifact path, never a server URL: no snapshot
    // target starts the localhost server, opened or not.
    assert.equal(
      harness.notices.some((notice) =>
        notice.startsWith("Inspector UI available at:"),
      ),
      false,
    );
    const written = `notify:Inspector report written: ${output}`;
    assert.ok(
      harness.sequence.indexOf(written) !== -1 &&
        harness.sequence.indexOf(written) <
          harness.sequence.indexOf(`open:${output}`),
    );

    // A failed opener is swallowed: the bounded path stays the last notice and
    // no exception text reaches the user.
    harness.setOpenerResult(1);
    harness.notices.length = 0;
    const failedOutput = join(harness.directory, "opener-failed.html");
    await harness.handler()(
      `snapshot current --output ${JSON.stringify(failedOutput)}`,
      harness.context({ mode: "interactive" }),
    );
    assert.equal(
      harness.notices.at(-1),
      `Inspector report written: ${failedOutput}`,
    );
    assert.equal(harness.notices.join().includes("PRIVATE_OPENER"), false);
    assert.equal(harness.opens.at(-1)?.[1].at(-1), failedOutput);
    assert.equal(
      (await readFile(failedOutput, "utf8")).includes("<script"),
      false,
    );

    // `--no-open` suppresses only the opener: the document is still written
    // and the server is still never started.
    const opensBefore = harness.opens.length;
    harness.notices.length = 0;
    const quietOutput = join(harness.directory, "quiet.html");
    await harness.handler()(
      `snapshot current --no-open --output ${JSON.stringify(quietOutput)}`,
      harness.context({ mode: "interactive" }),
    );
    assert.equal(
      harness.notices.at(-1),
      `Inspector report written: ${quietOutput}`,
    );
    assert.equal(harness.opens.length, opensBefore);
    assert.equal(
      harness.notices.some((notice) =>
        notice.startsWith("Inspector UI available at:"),
      ),
      false,
    );
    assert.equal(await readFile(harness.sessionFile, "utf8"), SESSION_SOURCE);
  } finally {
    await harness.cleanup();
  }
});

test("one /api/v1/ui request serves one observed session even if Pi replaces it mid-read", async () => {
  // Pi replaces the live session while this request's evidence is being read:
  // the request must serve the session it started with, never A's evidence
  // attached to B's JSONL or leaf.
  let replaceDuringEvidence: (() => void) | undefined;
  const harness = await createHarness({
    getCommands: () => {
      const replace = replaceDuringEvidence;
      replaceDuringEvidence = undefined;
      replace?.();
      return [];
    },
    getAllTools: () => [],
  });
  try {
    await writeSessionManifest(harness);
    await harness.handler()(
      "ui --no-open",
      harness.context({ mode: "interactive" }),
    );
    const bootstrap = bootstrapOf(harness.notices.at(-1) ?? "");
    assert.ok(bootstrap, harness.notices.at(-1));

    const before = await apiGet(
      bootstrap.origin,
      "/api/v1/ui",
      bootstrap.token,
    );
    const beforeBody = before.body as UiSnapshotBody;
    assert.equal(beforeBody.current.tree.report?.sessionId, "real-session");
    assert.equal(beforeBody.current.active.range?.totals.totalTokens, 7);

    const replacementFile = join(harness.sessionDirectory, "replacement.jsonl");
    await writeFile(replacementFile, REPLACEMENT_SESSION_SOURCE);
    replaceDuringEvidence = () =>
      harness.replaceSession({
        sessionId: "replacement-session",
        sessionFile: replacementFile,
        leafId: null,
      });

    const mixed = await apiGet(bootstrap.origin, "/api/v1/ui", bootstrap.token);
    assert.equal(mixed.status, 200);
    const mixedBody = mixed.body as UiSnapshotBody;
    assert.equal(mixedBody.current.tree.report?.sessionId, "real-session");
    assert.equal(mixedBody.current.active.range?.totals.totalTokens, 7);
    assert.equal(mixedBody.current.tree.range?.totals.totalTokens, 18);

    // The replacement is real: the next request reads the new session.
    const replaced = await apiGet(
      bootstrap.origin,
      "/api/v1/ui",
      bootstrap.token,
    );
    const replacedBody = replaced.body as UiSnapshotBody;
    assert.equal(
      replacedBody.current.tree.report?.sessionId,
      "replacement-session",
    );
    assert.equal(replacedBody.current.tree.range?.totals.totalTokens, 5);
  } finally {
    await harness.cleanup();
  }
});

test("snapshot refuses a destination that could overwrite Pi session authority", async () => {
  const harness = await createHarness();
  try {
    await writeSessionManifest(harness);
    // The Pi session source itself, and anything inside the directory Pi keeps
    // its session sources in, are never writable snapshot destinations.
    for (const destination of [
      harness.sessionFile,
      join(harness.sessionDirectory, "report.html"),
      join(harness.sessionDirectory, "nested", "report.html"),
    ]) {
      harness.notices.length = 0;
      await harness.handler()(
        `snapshot current --no-open --output ${JSON.stringify(destination)}`,
        harness.context({ mode: "interactive" }),
      );
      const notice = harness.notices.at(-1) ?? "";
      assert.match(notice, /snapshot output/i, destination);
      // Bounded refusal: neither the destination nor exception text leaks.
      assert.equal(notice.includes(destination), false, destination);
      assert.equal(await countFiles(harness.cache), 0, destination);
      if (destination !== harness.sessionFile)
        await assert.rejects(access(destination), destination);
      assert.equal(
        await readFile(harness.sessionFile, "utf8"),
        SESSION_SOURCE,
        destination,
      );
    }

    // A user-owned HTML destination outside Pi's session directory still
    // writes, including one whose directory merely shares the session
    // directory's name prefix.
    for (const html of [
      join(harness.directory, "snapshot.html"),
      join(`${harness.sessionDirectory}-exports`, "snapshot.html"),
    ]) {
      harness.notices.length = 0;
      await harness.handler()(
        `snapshot current --no-open --output ${JSON.stringify(html)}`,
        harness.context({ mode: "interactive" }),
      );
      assert.equal(harness.notices.at(-1), `Inspector report written: ${html}`);
      assert.equal(
        (await readFile(html, "utf8")).includes("<script"),
        false,
        html,
      );
      assert.equal(
        await readFile(harness.sessionFile, "utf8"),
        SESSION_SOURCE,
        html,
      );
    }
  } finally {
    await harness.cleanup();
  }
});

/** Whether this filesystem cannot create the requested alias kind at all. */
function isAliasUnsupported(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return (
    code === "EACCES" ||
    code === "EPERM" ||
    code === "ENOTSUP" ||
    code === "EOPNOTSUPP" ||
    code === "EXDEV"
  );
}

test("snapshot replaces a filesystem alias to the Pi session source instead of truncating it", async () => {
  const harness = await createHarness();
  try {
    await writeSessionManifest(harness);
    // A destination that is a second name for Pi's authoritative session file.
    // The lexical refusal above cannot see this: only replacing the destination
    // directory entry keeps the source inode (and its bytes) intact.
    const aliasKinds: Array<[string, (destination: string) => Promise<void>]> =
      [
        ["hard-link", (destination) => link(harness.sessionFile, destination)],
        ["symlink", (destination) => symlink(harness.sessionFile, destination)],
      ];
    let checked = 0;
    for (const [kind, createAlias] of aliasKinds) {
      const destination = join(harness.directory, `${kind}-alias.html`);
      try {
        await createAlias(destination);
      } catch (error) {
        // A filesystem without one alias kind still exercises the other.
        assert.equal(
          isAliasUnsupported(error),
          true,
          `${kind}: ${String(error)}`,
        );
        continue;
      }
      checked += 1;
      assert.equal(
        await readFile(harness.sessionFile, "utf8"),
        SESSION_SOURCE,
        kind,
      );

      harness.notices.length = 0;
      await harness.handler()(
        `snapshot current --no-open --output ${JSON.stringify(destination)}`,
        harness.context({ mode: "interactive" }),
      );

      // Writing through the alias must never reach Pi's authoritative bytes.
      assert.equal(
        await readFile(harness.sessionFile, "utf8"),
        SESSION_SOURCE,
        kind,
      );
      // Bounded notice: the destination, no temporary path, no exception text.
      const notice = harness.notices.at(-1) ?? "";
      assert.equal(notice, `Inspector report written: ${destination}`, kind);
      assert.equal(notice.includes(harness.sessionFile), false, kind);
      // The alias is now one fresh static HTML document, not the shared inode.
      const replaced = await lstat(destination);
      assert.equal(replaced.isSymbolicLink(), false, kind);
      const html = await readFile(destination, "utf8");
      assert.equal(html.startsWith("<!doctype html>"), true, kind);
      assert.equal(html.includes("<script"), false, kind);
      assert.equal(
        html.includes(ENGLISH_CATALOG["heading.current"]),
        true,
        kind,
      );
      if (kind === "hard-link")
        assert.notEqual(
          replaced.ino,
          (await stat(harness.sessionFile)).ino,
          kind,
        );
      assert.equal(await countFiles(harness.cache), 0, kind);
    }
    assert.ok(checked > 0, "no alias kind was creatable");
    // A destination that cannot be replaced is one bounded refusal: no error
    // text, no destination, and no temporary file left behind.
    const occupied = join(harness.directory, "occupied.html");
    await mkdir(occupied);
    harness.notices.length = 0;
    await harness.handler()(
      `snapshot current --no-open --output ${JSON.stringify(occupied)}`,
      harness.context({ mode: "interactive" }),
    );
    assert.equal(
      harness.notices.at(-1),
      "Current session Inspector data is unavailable.",
    );
    assert.equal(harness.notices.join().includes(occupied), false);
    assert.equal((await lstat(occupied)).isDirectory(), true);
    assert.deepEqual(
      (await readdir(harness.directory)).filter((name) =>
        name.endsWith(".tmp"),
      ),
      [],
      "no temporary output remains",
    );
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

test("json refuses a destination that could overwrite Pi session authority", async () => {
  const harness = await createHarness();
  try {
    await writeSessionManifest(harness);
    // Pi keeps every session source as a JSONL path, so an explicit JSON
    // export never names one: not the live session, not another tracked
    // session, and not a nested path inside the session directory.
    for (const destination of [
      harness.sessionFile,
      join(harness.sessionDirectory, "other-session.jsonl"),
      join(harness.sessionDirectory, "nested", "report.jsonl"),
    ]) {
      harness.notices.length = 0;
      await harness.handler()(
        `json --scope tree --output ${JSON.stringify(destination)}`,
        harness.context({ mode: "interactive" }),
      );
      const notice = harness.notices.at(-1) ?? "";
      assert.match(notice, /json output/i, destination);
      // Bounded refusal: neither the destination nor exception text leaks,
      // and no report is written anywhere.
      assert.equal(notice.includes(destination), false, destination);
      assert.equal(await countFiles(harness.cache), 0, destination);
      if (destination !== harness.sessionFile)
        await assert.rejects(access(destination), destination);
      assert.equal(
        await readFile(harness.sessionFile, "utf8"),
        SESSION_SOURCE,
        destination,
      );
    }

    // A user-owned JSON destination outside Pi's session directory still
    // writes, including one whose directory merely shares the session
    // directory's name prefix.
    for (const json of [
      join(harness.directory, "report.json"),
      join(`${harness.sessionDirectory}-exports`, "report.json"),
    ]) {
      harness.notices.length = 0;
      await harness.handler()(
        `json --scope tree --output ${JSON.stringify(json)}`,
        harness.context({ mode: "interactive" }),
      );
      assert.equal(harness.notices.at(-1), `Inspector report written: ${json}`);
      assert.equal(
        JSON.parse(await readFile(json, "utf8")).usage.totalTokens,
        18,
        json,
      );
      assert.equal(
        await readFile(harness.sessionFile, "utf8"),
        SESSION_SOURCE,
        json,
      );
    }

    // A filesystem alias that merely names the session source is not a direct
    // session-source destination: the write replaces the alias atomically, so
    // the source inode and its bytes survive.
    const aliasKinds: Array<[string, (destination: string) => Promise<void>]> =
      [
        ["hard-link", (destination) => link(harness.sessionFile, destination)],
        ["symlink", (destination) => symlink(harness.sessionFile, destination)],
      ];
    let checked = 0;
    for (const [kind, createAlias] of aliasKinds) {
      const destination = join(harness.directory, `${kind}-alias.json`);
      try {
        await createAlias(destination);
      } catch (error) {
        assert.equal(
          isAliasUnsupported(error),
          true,
          `${kind}: ${String(error)}`,
        );
        continue;
      }
      checked += 1;
      harness.notices.length = 0;
      await harness.handler()(
        `json --scope tree --output ${JSON.stringify(destination)}`,
        harness.context({ mode: "interactive" }),
      );
      assert.equal(
        await readFile(harness.sessionFile, "utf8"),
        SESSION_SOURCE,
        kind,
      );
      assert.equal(
        harness.notices.at(-1),
        `Inspector report written: ${destination}`,
        kind,
      );
      assert.equal((await lstat(destination)).isSymbolicLink(), false, kind);
      assert.equal(
        JSON.parse(await readFile(destination, "utf8")).usage.totalTokens,
        18,
        kind,
      );
      if (kind === "hard-link")
        assert.notEqual(
          (await stat(destination)).ino,
          (await stat(harness.sessionFile)).ino,
          kind,
        );
    }
    assert.ok(checked > 0, "no alias kind was creatable");
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

test("json session exports one requested historical session through the snapshot loader", async () => {
  const harness = await createHarness();
  try {
    await writeSessionManifest(harness);
    await writeOtherSession(harness);

    const output = join(harness.directory, "session.json");
    await harness.handler()(
      `json session other-session --output ${JSON.stringify(output)}`,
      harness.context({ mode: "interactive" }),
    );
    assert.equal(harness.notices.at(-1), `Inspector report written: ${output}`);
    // A JSON export never opens a browser, and never starts the UI server.
    assert.equal(harness.opens.length, 0);
    const first = await readFile(output, "utf8");
    assert.equal(
      harness.notices.some((notice) =>
        notice.startsWith("Inspector UI available at:"),
      ),
      false,
    );

    const exported = JSON.parse(first) as {
      availability: string;
      sessionId: string;
      usageByDate: readonly unknown[];
      report: { sessionId: string; usage: { totalTokens: number } };
    };
    // The requested historical session, never the live one Pi reports: the
    // live session's own source carries 18 tokens, the requested one 4321.
    assert.equal(exported.availability, "available");
    assert.equal(exported.sessionId, "other-session");
    assert.equal(exported.report.sessionId, "other-session");
    assert.equal(exported.report.usage.totalTokens, 4321);
    assert.equal(Array.isArray(exported.usageByDate), true);
    // The document is the canonical report plus its dated evidence: never a
    // raw prompt body, tool argument, or tool result.
    for (const raw of RAW_PRODUCER_TEXT)
      assert.equal(first.includes(raw), false, raw);

    // Same session, same facts, one renderer apart: the snapshot document is
    // built from the projection this export publishes.
    await harness.handler()(
      "snapshot session other-session --no-open",
      harness.context({ mode: "interactive" }),
    );
    const document = await readFile(
      generatedSnapshotPath(harness.cache, {
        target: "session",
        sessionId: "other-session",
        theme: "light",
      }),
      "utf8",
    );
    assert.equal(document.includes("other-session"), true);
    for (const raw of RAW_PRODUCER_TEXT)
      assert.equal(document.includes(raw), false, raw);
    // The count the export publishes is the count the document states: 4321
    // thousands-separated, chosen so no stylesheet or label can carry it.
    assert.equal(document.includes("4,321"), true);

    // Repeating the command is byte-identical, and no destination means the
    // generated cache path — named for the session, never for the live one.
    await harness.handler()(
      `json session other-session --output ${JSON.stringify(output)}`,
      harness.context({ mode: "interactive" }),
    );
    assert.equal(await readFile(output, "utf8"), first);
    await harness.handler()(
      "json session other-session",
      harness.context({ mode: "interactive" }),
    );
    const generated = generatedReportPath(
      harness.cache,
      "session-other-session",
      "json",
    );
    assert.equal(
      harness.notices.at(-1),
      `Inspector report written: ${generated}`,
    );
    assert.equal(await readFile(generated, "utf8"), first);
    assert.equal(await readFile(harness.sessionFile, "utf8"), SESSION_SOURCE);
  } finally {
    await harness.cleanup();
  }
});

test("json session refuses unsafe destinations and unknown sessions as snapshot does", async () => {
  const harness = await createHarness();
  try {
    await writeSessionManifest(harness);
    await writeOtherSession(harness);
    const bare = await countFiles(harness.cache);

    // The existing JSON destination rules hold unchanged for a session target:
    // a `.json` file only, and never a Pi session source.
    for (const destination of [
      join(harness.directory, "session.html"),
      join(harness.sessionDirectory, "other.jsonl"),
      join(harness.directory, "session"),
    ]) {
      harness.notices.length = 0;
      await harness.handler()(
        `json session other-session --output ${JSON.stringify(destination)}`,
        harness.context({ mode: "interactive" }),
      );
      const notice = harness.notices.at(-1) ?? "";
      assert.match(notice, /json output/i, destination);
      // Bounded refusal: neither the destination nor exception text leaks.
      assert.equal(notice.includes(destination), false, destination);
      assert.equal(await countFiles(harness.cache), bare, destination);
      assert.equal(
        await readFile(join(harness.sessionDirectory, "other.jsonl"), "utf8"),
        OTHER_SESSION_SOURCE,
        destination,
      );
    }

    // Scope and range are refused before any load, in both modes alike.
    for (const args of [
      "json session other-session --scope tree",
      "json session other-session --preset 7",
      "json session",
    ]) {
      harness.notices.length = 0;
      await harness.handler()(args, harness.context({ mode: "interactive" }));
      assert.match(harness.notices.at(-1) ?? "", /usage|invalid|help/i, args);
    }
    assert.equal(await countFiles(harness.cache), bare);

    // A session no manifest declares is the same bounded refusal in both
    // export modes, and it writes nothing.
    for (const args of [
      "json session absent-session",
      "snapshot session absent-session --no-open",
    ]) {
      harness.notices.length = 0;
      await harness.handler()(args, harness.context({ mode: "interactive" }));
      assert.match(
        harness.notices.at(-1) ?? "",
        /^Inspector session (snapshot|JSON report) is unavailable\.$/,
        args,
      );
      assert.equal(await countFiles(harness.cache), bare, args);
    }

    // A declared session whose own source cannot be read is not an unknown
    // one: both modes state the unavailable verdict, because the export is the
    // loader's DTO verbatim and the document renders that same projection.
    const brokenDirectory = join(harness.root, "sessions", "broken-session");
    await mkdir(brokenDirectory, { recursive: true });
    await writeFile(
      join(brokenDirectory, "meta.json"),
      JSON.stringify({
        schemaVersion: 2,
        sessionId: "broken-session",
        sourceFile: "absent.jsonl",
        state: "tracking",
      }),
    );
    const broken = join(harness.directory, "broken.json");
    await harness.handler()(
      `json session broken-session --output ${JSON.stringify(broken)}`,
      harness.context({ mode: "interactive" }),
    );
    assert.equal(harness.notices.at(-1), `Inspector report written: ${broken}`);
    const brokenBody = JSON.parse(await readFile(broken, "utf8")) as {
      availability: string;
      sessionId: string;
    };
    assert.equal(brokenBody.availability, "unavailable");
    assert.equal(brokenBody.sessionId, "broken-session");
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
          event: string,
          registered: (event: unknown, context: unknown) => Promise<void>,
        ) => {
          // Pi registers several lifecycle handlers; the stub keys by event so a
          // `session_shutdown` registration never replaces the start handler.
          if (event === "session_start") handler = registered;
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
    // Tracking promotion is detached (`void track(...)`), and the writer setup
    // is the last step it performs, so waiting for that setup is the completion
    // signal rather than a guess at how long the promotion takes.
    await waitFor(() => setups > 0, "the promoted live writer registration");

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

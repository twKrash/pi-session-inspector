import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { readChildSessionLocators } from "../../src/integrations/subagents.ts";
import { selectChildSessionLocators } from "../../src/integrations/subagent-child-locators.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";
import {
  CHILD_SESSION_LIMITS,
  readChildSessionProjections,
} from "../../src/pi/child-sessions.ts";
import { assistant, header, usage, user } from "../helpers/child-session.ts";
import { patchOpen } from "../helpers/patch-open.ts";

const notice = (runId: string, record: Record<string, unknown> = {}) => ({
  runId,
  record: {
    sessionLabel: "Session file",
    sessionValue: `/p/${runId}.jsonl`,
    ...record,
  },
});

test("a run keeps the one path only it published, in notice order", () => {
  assert.deepEqual(
    selectChildSessionLocators([notice("b"), notice("a"), notice("a")]),
    [
      { runId: "b", path: "/p/b.jsonl" },
      { runId: "a", path: "/p/a.jsonl" },
    ],
  );
});

test("only the exact Session file label with a string path is a locator", () => {
  const withLabel = (
    sessionLabel: unknown,
    sessionValue: unknown = "/p/x.jsonl",
  ) =>
    selectChildSessionLocators([notice("a", { sessionLabel, sessionValue })]);
  assert.equal(withLabel("Session file").length, 1);
  for (const label of [
    "Session",
    "Session share error",
    "session file",
    undefined,
  ]) {
    assert.deepEqual(withLabel(label), [], String(label));
  }
  assert.deepEqual(withLabel("Session file", ""), []);
  assert.equal(withLabel("Session file", "x").length, 1);
  assert.deepEqual(withLabel("Session file", 7), []);
});

test("resume shares one path across run ids, so neither run is attributed", () => {
  const shared = { sessionValue: "/p/shared.jsonl" };
  assert.deepEqual(
    selectChildSessionLocators([
      notice("a", shared),
      notice("b", shared),
      notice("c"),
    ]),
    [{ runId: "c", path: "/p/c.jsonl" }],
  );
});

test("a run that published two different paths is withheld", () => {
  assert.deepEqual(
    selectChildSessionLocators([
      notice("a"),
      notice("a", { sessionValue: "/p/other.jsonl" }),
    ]),
    [],
  );
});

test("one run publishing many distinct paths trips the claim bound too", () => {
  const manyPaths = (count: number) =>
    Array.from({ length: count }, (_, i) =>
      notice("greedy", { sessionValue: `/p/greedy-${i}.jsonl` }),
    );
  // 511 + the other run's path = 512 distinct paths: still within the bound.
  assert.deepEqual(
    selectChildSessionLocators([...manyPaths(511), notice("other")]),
    [{ runId: "other", path: "/p/other.jsonl" }],
  );
  // One more distinct path and the whole selection fails closed.
  assert.deepEqual(
    selectChildSessionLocators([...manyPaths(512), notice("other")]),
    [],
  );
});

test("selection fails closed past the claim bound", () => {
  const many = Array.from({ length: 513 }, (_, i) => notice(`r${i}`));
  assert.deepEqual(selectChildSessionLocators(many), []);
  assert.equal(selectChildSessionLocators(many.slice(0, 512)).length, 512);
});

const launchLines = (runId: string) => [
  JSON.stringify({
    type: "message",
    id: `l-${runId}`,
    parentId: null,
    timestamp: "2026-11-05T00:00:01.000Z",
    message: {
      role: "assistant",
      content: [{ type: "toolCall", id: `c-${runId}`, name: "subagent" }],
    },
  }),
  JSON.stringify({
    type: "message",
    id: `r-${runId}`,
    parentId: `l-${runId}`,
    timestamp: "2026-11-05T00:00:02.000Z",
    message: {
      role: "toolResult",
      toolCallId: `c-${runId}`,
      toolName: "subagent",
      isError: false,
      content: [],
      details: {
        mode: "single",
        runId,
        asyncId: runId,
        asyncDir: "/tmp/async",
        results: [],
      },
    },
  }),
];

const noticeLine = (runs: Record<string, unknown>[]) =>
  JSON.stringify({
    type: "custom_message",
    id: `n-${runs.length}-${String(runs[0]?.runId)}`,
    parentId: null,
    timestamp: "2026-11-05T00:00:30.000Z",
    customType: "subagent-notify",
    content: "sanitized",
    display: false,
    details: { runs },
  });

const locatorsOf = (lines: string[]) =>
  readChildSessionLocators(parseSessionJsonl(lines.join("\n")).entries, "s");

const run = (runId: string, extra: Record<string, unknown> = {}) => ({
  agent: "reviewer",
  status: "completed",
  runId,
  sessionLabel: "Session file",
  sessionValue: `/p/${runId}.jsonl`,
  ...extra,
});

test("locators come only from plain async notices for launch-proven runs", () => {
  assert.deepEqual(
    locatorsOf([...launchLines("run-1"), noticeLine([run("run-1")])]),
    [{ runId: "run-1", path: "/p/run-1.jsonl" }],
  );
  assert.deepEqual(locatorsOf([noticeLine([run("run-1")])]), [], "no launch");
  assert.deepEqual(
    locatorsOf([
      ...launchLines("run-1"),
      noticeLine([run("run-1", { workflowRunId: "run-1" })]),
    ]),
    [],
    "workflow notices are not plain async",
  );
  assert.deepEqual(
    locatorsOf([
      ...launchLines("run-1"),
      ...launchLines("run-2"),
      noticeLine([run("run-1", { sessionValue: "/p/x.jsonl" })]),
      noticeLine([run("run-2", { sessionValue: "/p/x.jsonl" })]),
    ]),
    [],
    "a resumed child reuses its path",
  );
});

test("a conflicting claim hidden inside one notice still withholds the run", () => {
  const launches = [...launchLines("run-1"), ...launchLines("run-2")];
  const first = noticeLine([run("run-1", { sessionValue: "/p/a.jsonl" })]);
  const repeated = noticeLine([
    run("run-1", { sessionValue: "/p/a.jsonl" }),
    run("run-1", { sessionValue: "/p/b.jsonl" }),
  ]);
  assert.deepEqual(
    locatorsOf([...launches, first, repeated]),
    [],
    "valid then repeated",
  );
  assert.deepEqual(
    locatorsOf([...launches, repeated, first]),
    [],
    "repeated then valid",
  );
  // The repeated notice also claims /p/a.jsonl, so another run cannot take it.
  const other = noticeLine([run("run-2", { sessionValue: "/p/a.jsonl" })]);
  assert.deepEqual(
    locatorsOf([...launches, repeated, other]),
    [],
    "path taken by another run",
  );
});

let root: string;
let parentFile: string;
before(async () => {
  root = await mkdtemp(join(tmpdir(), "child-sessions-"));
  parentFile = join(root, "parent.jsonl");
});
after(() => rm(root, { recursive: true, force: true }));

const writeChild = async (name: string, users = 1) => {
  const path = join(root, "parent", name, "run-0", "session.jsonl");
  await mkdir(join(root, "parent", name, "run-0"), { recursive: true });
  // Prompts and the reply form one connected chain, as in a real child file.
  const prompts = Array.from({ length: users }, (_, i) =>
    user(`u${i}`, i === 0 ? null : `u${i - 1}`),
  );
  await writeFile(
    path,
    [
      header({ parentSession: parentFile }),
      ...prompts,
      assistant("a1", `u${users - 1}`, {
        usage: usage(7, 0.5),
        toolCalls: ["t1"],
      }),
    ].join("\n"),
  );
  return { runId: name, path };
};
const parent = () => ({ sessionFile: parentFile, entryIds: new Set<string>() });

test("a dedicated child is projected and a resumed one is not", async () => {
  const fresh = await writeChild("fresh");
  const resumed = await writeChild("resumed", 2);
  const projections = await readChildSessionProjections(
    [fresh, resumed],
    parent(),
  );
  assert.deepEqual([...projections.keys()], ["fresh"]);
  assert.equal(projections.get("fresh")?.usage?.totalTokens, 7);
  assert.equal(projections.get("fresh")?.toolCalls, 1);
});

test("a file that is not at the published path stays unavailable", async () => {
  const projections = await readChildSessionProjections(
    [
      {
        runId: "gone",
        path: join(root, "parent", "gone", "run-0", "session.jsonl"),
      },
    ],
    parent(),
  );
  assert.equal(projections.size, 0);
});

test("the file and byte budgets stop reading in locator order", async () => {
  const a = await writeChild("budget-a");
  const b = await writeChild("budget-b");
  const c = await writeChild("budget-c");
  const limits = { ...CHILD_SESSION_LIMITS, maxFiles: 2 };
  assert.deepEqual(
    [
      ...(
        await readChildSessionProjections([a, b, c], parent(), limits)
      ).keys(),
    ],
    ["budget-a", "budget-b"],
  );
  const size = (await (await import("node:fs/promises")).stat(a.path)).size;
  const tight = { ...CHILD_SESSION_LIMITS, maxTotalBytes: size + size - 1 };
  assert.deepEqual(
    [...(await readChildSessionProjections([a, b, c], parent(), tight)).keys()],
    ["budget-a"],
  );
  const small = { ...CHILD_SESSION_LIMITS, maxFileBytes: size - 1 };
  assert.equal(
    (await readChildSessionProjections([a], parent(), small)).size,
    0,
  );
});

test("bytes read from a file that is then rejected still spend the total budget", async () => {
  const files = await Promise.all(
    ["spend-a", "spend-b", "spend-c"].map(async (name) => {
      const path = join(root, "parent", name, "run-0", "session.jsonl");
      await mkdir(join(root, "parent", name, "run-0"), { recursive: true });
      await writeFile(path, "{}\n".repeat(40));
      return { runId: name, path };
    }),
  );
  let reads = 0;
  const restore = patchOpen((real) => async (target, ...args) => {
    const handle = await real(target, ...args);
    if (!files.some((file) => file.path === target)) return handle;
    const read = handle.read.bind(handle) as (
      ...a: unknown[]
    ) => Promise<unknown>;
    handle.read = (async (...a: unknown[]) => {
      const result = await read(...a);
      reads++;
      await appendFile(target, "x"); // the file grows, so its read is rejected
      return result;
    }) as typeof handle.read;
    return handle;
  });
  try {
    const limits = { maxFiles: 3, maxFileBytes: 120, maxTotalBytes: 120 };
    const projections = await readChildSessionProjections(
      files,
      parent(),
      limits,
    );
    assert.equal(projections.size, 0);
    // The first read spends all 120 bytes; the others never touch the disk.
    assert.equal(reads, 1);
  } finally {
    restore();
  }
});

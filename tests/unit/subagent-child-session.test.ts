import assert from "node:assert/strict";
import { test } from "node:test";
import { projectChildSession } from "../../src/pi/child-session.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";
import { MAX_ID_BYTES } from "../../src/pi/graph.ts";

const PARENT = "/sessions/parent.jsonl";

const header = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "session",
    version: 3,
    id: "child",
    timestamp: "2026-11-02T00:00:00.000Z",
    cwd: "sanitized",
    parentSession: PARENT,
    ...extra,
  });

const usage = (totalTokens: number, cost: number) => ({
  input: totalTokens,
  output: 0,
  totalTokens,
  cost: { total: cost },
});

const assistant = (
  id: string,
  parentId: string | null,
  options: {
    model?: unknown;
    usage?: unknown;
    toolCalls?: string[];
  } = {},
) =>
  JSON.stringify({
    type: "message",
    id,
    parentId,
    timestamp: "2026-11-02T00:00:01.000Z",
    message: {
      role: "assistant",
      provider: "fixture-provider",
      model: "model" in options ? options.model : "fixture-model",
      ...("usage" in options ? { usage: options.usage } : {}),
      content: (options.toolCalls ?? []).map((callId) => ({
        type: "toolCall",
        id: callId,
        name: "fixture_tool",
        arguments: {},
      })),
    },
  });

const user = (id: string, parentId: string | null) =>
  JSON.stringify({
    type: "message",
    id,
    parentId,
    timestamp: "2026-11-02T00:00:00.500Z",
    message: { role: "user", content: [] },
  });

// A fresh child holds exactly one user message (its task prompt); `users`
// varies that count to model resumed or follow-up files. Prompts form a chain
// and the first root-level body entry hangs off the last prompt, as in a real
// child file (one connected chain from a single root).
const project = (
  lines: string[],
  parent = PARENT,
  parentEntryIds: string[] = [],
  users = 1,
) => {
  const prompts = Array.from({ length: users }, (_, i) =>
    user(`u${i}`, i === 0 ? null : `u${i - 1}`),
  );
  const tail = users === 0 ? null : `u${users - 1}`;
  const at = lines[0]?.includes('"type":"session"') ? 1 : 0;
  const body = lines.slice(at).map((line) => attach(line, tail));
  const all = [...lines.slice(0, at), ...prompts, ...body];
  return projectChildSession(parseSessionJsonl(all.join("\n")), {
    sessionFile: parent,
    entryIds: new Set(parentEntryIds),
  });
};

/** Re-parents a root-level entry; leaves unparseable lines for the parser to reject. */
const attach = (line: string, tail: string | null): string => {
  try {
    const entry = JSON.parse(line);
    return tail !== null && entry.parentId === null
      ? JSON.stringify({ ...entry, parentId: tail })
      : line;
  } catch {
    return line;
  }
};

const projectRaw = (lines: string[], parentEntryIds: string[] = []) =>
  projectChildSession(parseSessionJsonl(lines.join("\n")), {
    sessionFile: PARENT,
    entryIds: new Set(parentEntryIds),
  });

test("a linked child sums native usage, one model, and distinct tool calls", () => {
  const projection = project([
    header(),
    assistant("a1", null, { usage: usage(10, 0.5), toolCalls: ["t1", "t2"] }),
    assistant("a2", "a1", { usage: usage(5, 0.25), toolCalls: ["t2"] }),
  ]);
  assert.equal(projection?.usageCoverage, "complete");
  assert.equal(projection?.usage?.totalTokens, 15);
  assert.equal(projection?.usage?.cost, 0.75);
  assert.equal(projection?.model, "fixture-model");
  assert.equal(projection?.toolCalls, 2);
});

test("a header that does not name the exact parent is unsupported", () => {
  const body = [assistant("a1", null, { usage: usage(1, 0) })];
  assert.equal(
    project([header({ parentSession: "/other.jsonl" }), ...body]),
    undefined,
  );
  assert.equal(
    project([header({ parentSession: undefined }), ...body]),
    undefined,
  );
  assert.equal(
    project([header(), ...body], "/sessions/other.jsonl"),
    undefined,
  );
});

test("unsupported shapes fail closed", () => {
  const body = [assistant("a1", null, { usage: usage(1, 0) })];
  assert.equal(project(body), undefined, "no header");
  assert.equal(project([header({ version: 2 }), ...body]), undefined);
  assert.equal(project([header(), ...body, "{not json"]), undefined);
  assert.equal(
    project([
      header(),
      ...body,
      JSON.stringify({
        type: "compaction",
        id: "c1",
        parentId: "a1",
        timestamp: "2026-11-02T00:00:02.000Z",
      }),
    ]),
    undefined,
    "compaction usage has no per-run meaning",
  );
  assert.equal(
    project([
      header(),
      assistant("a1", null, { usage: usage(1, 0) }),
      assistant("a2", "a1", { usage: usage(1, 0) }),
      assistant("a3", "a1", { usage: usage(1, 0) }),
    ]),
    undefined,
    "a forked tree is not one linear run",
  );
});

test("a resumed, reused, or forked file is not one dedicated run", () => {
  const body = [header(), assistant("a1", null, { usage: usage(1, 0) })];
  assert.equal(
    project(body, PARENT, [], 2),
    undefined,
    "resume appends a prompt",
  );
  assert.equal(
    project(body, PARENT, [], 0),
    undefined,
    "no prompt proves nothing",
  );
  assert.equal(
    project(body, PARENT, ["a1"]),
    undefined,
    "a fork inherits parent entry ids",
  );
  assert.equal(project(body, PARENT, ["unrelated"])?.usageCoverage, "complete");
});

test("only one connected chain of unique entries qualifies", () => {
  const hit = usage(1, 0);
  const chain = [
    header(),
    user("u0", null),
    assistant("a1", "u0", { usage: hit }),
    assistant("a2", "a1", { usage: hit }),
  ];
  assert.equal(projectRaw(chain)?.usage?.totalTokens, 2);

  const rejected: Record<string, string[]> = {
    "a second root": [
      header(),
      user("u0", null),
      assistant("a1", null, { usage: hit }),
    ],
    "an orphan parent": [
      header(),
      user("u0", null),
      assistant("a1", "missing", { usage: hit }),
    ],
    "a duplicate id": [
      header(),
      user("u0", null),
      assistant("a1", "u0", { usage: hit }),
      assistant("a1", "u0", { usage: hit }),
    ],
    "a branch": [
      header(),
      user("u0", null),
      assistant("a1", "u0", { usage: hit }),
      assistant("a2", "u0", { usage: hit }),
    ],
    "a detached cycle": [
      header(),
      user("u0", null),
      assistant("a1", "u0", { usage: hit }),
      assistant("c1", "c2", { usage: hit }),
      assistant("c2", "c1", { usage: hit }),
    ],
    "no root at all": [
      header(),
      assistant("a1", "a2", { usage: hit }),
      user("u0", "a1"),
    ],
  };
  for (const [label, lines] of Object.entries(rejected)) {
    assert.equal(projectRaw(lines), undefined, label);
  }
});

const record = (fields: Record<string, unknown>) =>
  JSON.stringify({ timestamp: "2026-11-02T00:00:03.000Z", ...fields });

test("an extension-defined entry type takes part in the chain instead of being skipped", () => {
  const hit = usage(1, 0);
  const valid = [
    header(),
    user("u0", null),
    record({ type: "context_edit", id: "x1", parentId: "u0" }),
    assistant("a1", "x1", { usage: hit }),
  ];
  assert.equal(projectRaw(valid)?.usage?.totalTokens, 1, "connected: accepted");

  const base = [
    header(),
    user("u0", null),
    assistant("a1", "u0", { usage: hit }),
  ];
  const hidden: Record<string, string[]> = {
    "a second root": [
      ...base,
      record({ type: "context_edit", id: "x1", parentId: null }),
    ],
    "a branch": [
      ...base,
      record({ type: "context_edit", id: "x1", parentId: "u0" }),
    ],
    "an orphan": [
      ...base,
      record({ type: "context_edit", id: "x1", parentId: "missing" }),
    ],
    "a duplicate id": [
      ...base,
      record({ type: "context_edit", id: "a1", parentId: "a1" }),
    ],
  };
  for (const [label, lines] of Object.entries(hidden)) {
    assert.equal(projectRaw(lines), undefined, label);
  }
  assert.equal(
    projectRaw(
      [...base, record({ type: "context_edit", id: "x1", parentId: "a1" })],
      ["x1"],
    ),
    undefined,
    "an unknown-type entry inherited from the parent",
  );
});

test("a record the parser drops cannot hide a violation", () => {
  const hit = usage(1, 0);
  const base = [
    header(),
    user("u0", null),
    assistant("a1", "u0", { usage: hit }),
  ];
  assert.equal(projectRaw(base)?.usageCoverage, "complete");
  const dropped: Record<string, string> = {
    "a second prompt with a non-string id": record({
      type: "message",
      id: 7,
      parentId: "a1",
      message: { role: "user", content: [] },
    }),
    "a compaction without a timestamp": JSON.stringify({
      type: "compaction",
      id: "c1",
      parentId: "a1",
    }),
    "an entry without a parentId": record({ type: "message", id: "m1" }),
    "a non-object line": "123",
    "a known type with a non-string id": record({
      type: "label",
      id: 5,
      parentId: "a1",
    }),
  };
  for (const [label, line] of Object.entries(dropped)) {
    assert.equal(projectRaw([...base, line]), undefined, label);
  }
});

test("an entry the graph cannot see cannot smuggle usage past the chain check", () => {
  const hit = usage(1, 0);
  const base = [
    header(),
    user("u0", null),
    assistant("a1", "u0", { usage: hit }),
  ];
  assert.equal(projectRaw(base)?.usage?.totalTokens, 1);

  // A message the parser keeps as an entry but the graph skips because its id
  // is empty or too long; it would add usage while escaping every chain rule.
  const unseen: Record<string, string[]> = {
    "an empty id, as a second root": [
      ...base,
      assistant("", null, { usage: hit }),
    ],
    "an empty id, hanging off the chain": [
      ...base,
      assistant("", "a1", { usage: hit }),
    ],
    "an oversize id, as a second root": [
      ...base,
      assistant("x".repeat(MAX_ID_BYTES + 1), null, { usage: hit }),
    ],
    "an oversize parent id": [
      ...base,
      assistant("a2", "p".repeat(MAX_ID_BYTES + 1), { usage: hit }),
    ],
  };
  for (const [label, lines] of Object.entries(unseen)) {
    assert.equal(projectRaw(lines), undefined, label);
  }
  // An id of exactly the bound is still a normal, graphed entry.
  assert.equal(
    projectRaw([
      header(),
      user("u0", null),
      assistant("x".repeat(MAX_ID_BYTES), "u0", { usage: hit }),
    ])?.usage?.totalTokens,
    1,
  );
});

test("a duplicate id is rejected without walking forever", () => {
  const hit = usage(1, 0);
  // The second a1 hangs off the first, so there is no branch and no orphan:
  // only the revisit during the walk exposes the duplicate.
  assert.equal(
    projectRaw([
      header(),
      user("u0", null),
      assistant("a1", "u0", { usage: hit }),
      assistant("a1", "a1", { usage: hit }),
    ]),
    undefined,
  );
});

test("compaction and branch-summary entries have no per-run meaning", () => {
  for (const type of ["compaction", "branch_summary"]) {
    const summary = JSON.stringify({
      type,
      id: "s1",
      parentId: "a1",
      timestamp: "2026-11-02T00:00:02.000Z",
    });
    assert.equal(
      projectRaw([
        header(),
        user("u0", null),
        assistant("a1", "u0", { usage: usage(1, 0) }),
        summary,
      ]),
      undefined,
      type,
    );
  }
});

test("mixed or unusable models never become a singular model", () => {
  const mixed = project([
    header(),
    assistant("a1", null, { usage: usage(1, 0), model: "model-a" }),
    assistant("a2", "a1", { usage: usage(1, 0), model: "model-b" }),
  ]);
  assert.equal(mixed?.model, undefined);
  assert.equal(mixed?.usageCoverage, "complete");
  const unusable = project([
    header(),
    assistant("a1", null, { usage: usage(1, 0), model: 42 }),
  ]);
  assert.equal(unusable?.model, undefined);
});

test("a model label must be a short, non-secret, non-empty string", () => {
  const modelOf = (model: unknown) =>
    project([header(), assistant("a1", null, { usage: usage(1, 0), model })])
      ?.model;
  assert.equal(modelOf("m"), "m");
  assert.equal(modelOf("x".repeat(128)), "x".repeat(128));
  assert.equal(modelOf("x".repeat(129)), undefined);
  assert.equal(modelOf(""), undefined);
  assert.equal(modelOf("sk-abcdef123"), undefined);
});

test("only well-formed toolCall blocks with string ids are counted", () => {
  const withContent = (content: unknown) =>
    JSON.stringify({
      type: "message",
      id: "a1",
      parentId: null,
      timestamp: "2026-11-02T00:00:01.000Z",
      message: { role: "assistant", model: "m", content, usage: usage(1, 0) },
    });
  const callsOf = (content: unknown) =>
    project([header(), withContent(content)])?.toolCalls;
  assert.equal(callsOf("text"), 0, "content that is not an array");
  assert.equal(
    callsOf([
      null,
      "text",
      { type: "text", id: "t1" },
      { type: "toolCall", id: 7 },
      { type: "toolCall", id: "t1" },
    ]),
    1,
  );
});

test("missing usage stays missing, never zero", () => {
  const partial = project([
    header(),
    assistant("a1", null, { usage: usage(4, 1) }),
    assistant("a2", "a1"),
  ]);
  assert.equal(partial?.usageCoverage, "partial");
  assert.equal(partial?.usage?.totalTokens, 4);

  const none = project([header(), assistant("a1", null)]);
  assert.equal(none?.usageCoverage, "unavailable");
  assert.equal(none?.usage, undefined);

  const empty = project([header()]);
  assert.equal(empty?.usageCoverage, "unavailable");
  assert.equal(empty?.toolCalls, undefined);
});

test("a sum past the bounded range is partial, not silently capped", () => {
  const max = Number.MAX_SAFE_INTEGER;
  const projection = project([
    header(),
    assistant("a1", null, { usage: usage(max, 0) }),
    assistant("a2", "a1", { usage: usage(1, 0) }),
  ]);
  assert.equal(projection?.usageCoverage, "partial");
  assert.equal(projection?.usage?.totalTokens, max);
});

test("the parsed header exposes a bounded parentSession and nothing else new", () => {
  assert.equal(parseSessionJsonl(header()).parentSession, PARENT);
  const oversized = parseSessionJsonl(
    header({ parentSession: "x".repeat(5000) }),
  );
  assert.equal(oversized.parentSession, undefined);
  const edge = parseSessionJsonl(header({ parentSession: "x".repeat(4096) }));
  assert.equal(edge.parentSession?.length, 4096);
  assert.equal(
    parseSessionJsonl(header({ parentSession: "p" })).parentSession,
    "p",
  );
  assert.equal(
    parseSessionJsonl(header({ parentSession: "" })).parentSession,
    undefined,
  );
  const plain = parseSessionJsonl(header({ parentSession: undefined }));
  assert.equal("parentSession" in plain, false);
});

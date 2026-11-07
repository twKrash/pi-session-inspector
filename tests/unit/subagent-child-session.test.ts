import assert from "node:assert/strict";
import { test } from "node:test";
import { projectChildSession } from "../../src/integrations/subagent-child-session.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";

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
// varies that count to model resumed or follow-up files.
const project = (
  lines: string[],
  parent = PARENT,
  parentEntryIds: string[] = [],
  users = 1,
) => {
  const prompts = Array.from({ length: users }, (_, i) => user(`u${i}`, null));
  const at = lines[0]?.includes('"type":"session"') ? 1 : 0;
  const all = [...lines.slice(0, at), ...prompts, ...lines.slice(at)];
  return projectChildSession(parseSessionJsonl(all.join("\n")), {
    sessionFile: parent,
    entryIds: new Set(parentEntryIds),
  });
};

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

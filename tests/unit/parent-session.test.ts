import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import {
  type ParentSessionDiagnostic,
  resolveParentSession,
} from "../../src/pi/parent-session.ts";

// Synthetic fixtures under one temp directory. No real session data is read.
let workspace: string;
let root: string;
let linkPath: string;
let nestedLinkDirectory: string;
let outsidePath: string;
let hugePath: string;
let v2Path: string;
let selfPath: string;
let bodyPath: string;
let missingPath: string;

function header(id: string, version = 3): string {
  return `${JSON.stringify({ type: "session", version, id })}\n`;
}

before(async () => {
  workspace = await mkdtemp(join(tmpdir(), "pi-parent-session-"));
  root = join(workspace, "root");
  await mkdir(join(root, "nested"), { recursive: true });

  await writeFile(join(root, "parent.jsonl"), header("parent-session"));
  await writeFile(
    join(root, "nested", "deep.jsonl"),
    header("deep-parent-session"),
  );
  // Second line is deliberately not a header; only the first line is read.
  bodyPath = join(root, "with-body.jsonl");
  await writeFile(
    bodyPath,
    `${header("body-parent-session")}${JSON.stringify({ type: "message" })}\n`,
  );
  selfPath = join(root, "self.jsonl");
  await writeFile(selfPath, header("parent-session"));
  v2Path = join(root, "v2.jsonl");
  await writeFile(v2Path, header("legacy-parent", 2));
  hugePath = join(root, "huge.jsonl");
  await writeFile(
    hugePath,
    `${JSON.stringify({ type: "session", version: 3, id: "a".repeat(20_000) })}\n`,
  );
  await writeFile(join(root, "empty.jsonl"), "");
  missingPath = join(root, "missing.jsonl");

  outsidePath = join(workspace, "outside.jsonl");
  await writeFile(outsidePath, header("outside-session"));

  linkPath = join(root, "link.jsonl");
  await symlink(join(root, "parent.jsonl"), linkPath);
  nestedLinkDirectory = join(root, "linked");
  await symlink(join(root, "nested"), nestedLinkDirectory);
});

after(async () => {
  await rm(workspace, { recursive: true, force: true });
});

test("valid contained parent resolves to its session id", async () => {
  const result = await resolveParentSession({
    parentPath: join(root, "parent.jsonl"),
    sessionRoot: root,
  });
  assert.deepEqual(result, { state: "known", id: "parent-session" });
});

test("contained nested parent resolves and only the first line is read", async () => {
  assert.deepEqual(
    await resolveParentSession({
      parentPath: join(root, "nested", "deep.jsonl"),
      sessionRoot: root,
    }),
    { state: "known", id: "deep-parent-session" },
  );
  assert.deepEqual(
    await resolveParentSession({
      parentPath: bodyPath,
      sessionRoot: root,
    }),
    { state: "known", id: "body-parent-session" },
  );
});

test("symlink, outside-root, directory and oversize are unavailable", async () => {
  assert.deepEqual(
    await resolveParentSession({ parentPath: linkPath, sessionRoot: root }),
    { state: "unavailable" },
  );
  assert.deepEqual(
    await resolveParentSession({ parentPath: outsidePath, sessionRoot: root }),
    { state: "unavailable" },
  );
  assert.deepEqual(
    await resolveParentSession({ parentPath: root, sessionRoot: root }),
    { state: "unavailable" },
  );
  assert.deepEqual(
    await resolveParentSession({ parentPath: hugePath, sessionRoot: root }),
    { state: "unavailable" },
  );
});

test("a symlinked intermediate component is rejected", async () => {
  assert.deepEqual(
    await resolveParentSession({
      parentPath: join(nestedLinkDirectory, "deep.jsonl"),
      sessionRoot: root,
    }),
    { state: "unavailable" },
  );
});

test("wrong version, bad header and self-reference are unavailable", async () => {
  assert.deepEqual(
    await resolveParentSession({ parentPath: v2Path, sessionRoot: root }),
    { state: "unavailable" },
  );
  assert.deepEqual(
    await resolveParentSession({
      parentPath: selfPath,
      sessionRoot: root,
      childSessionId: "parent-session",
    }),
    { state: "unavailable" },
  );
  assert.deepEqual(
    await resolveParentSession({
      parentPath: "just-a-name.jsonl",
      sessionRoot: root,
    }),
    { state: "unavailable" },
  );
  assert.deepEqual(
    await resolveParentSession({ parentPath: missingPath, sessionRoot: root }),
    { state: "unavailable" },
  );
  assert.deepEqual(
    await resolveParentSession({
      parentPath: join(root, "empty.jsonl"),
      sessionRoot: root,
    }),
    { state: "unavailable" },
  );
});

test("unusable input is unavailable without throwing", async () => {
  assert.deepEqual(
    await resolveParentSession({ parentPath: "", sessionRoot: root }),
    { state: "unavailable" },
  );
  assert.deepEqual(
    await resolveParentSession({
      parentPath: `bad\0path.jsonl`,
      sessionRoot: root,
    }),
    { state: "unavailable" },
  );
  assert.deepEqual(
    await resolveParentSession({
      parentPath: `/${"a".repeat(5_000)}.jsonl`,
      sessionRoot: root,
    }),
    { state: "unavailable" },
  );
  assert.deepEqual(
    await resolveParentSession({
      parentPath: undefined as unknown as string,
      sessionRoot: root,
    }),
    { state: "unavailable" },
  );
  assert.deepEqual(
    await resolveParentSession({
      parentPath: join(root, "parent.jsonl"),
      sessionRoot: join(root, "missing-root"),
    }),
    { state: "unavailable" },
  );
});

test("only { state, id } escapes, without path or filesystem detail", async () => {
  const result = await resolveParentSession({
    parentPath: outsidePath,
    sessionRoot: root,
  });
  assert.equal(JSON.stringify(result).includes(root), false);
  assert.equal(JSON.stringify(result).includes(workspace), false);
  assert.deepEqual(Object.keys(result), ["state"]);
});

test("each failure increments the bounded diagnostic", async () => {
  const diagnostics = new Set<ParentSessionDiagnostic>();
  assert.deepEqual(
    await resolveParentSession({
      parentPath: outsidePath,
      sessionRoot: root,
      diagnostics,
    }),
    { state: "unavailable" },
  );
  assert.equal(diagnostics.has("parent-session-unavailable"), true);
});

test("a resolved parent does not emit the diagnostic", async () => {
  const diagnostics = new Set<ParentSessionDiagnostic>();
  await resolveParentSession({
    parentPath: join(root, "parent.jsonl"),
    sessionRoot: root,
    diagnostics,
  });
  assert.equal(diagnostics.size, 0);
});

test("injected header reader is bounded by the same containment gate", async () => {
  let called = false;
  assert.deepEqual(
    await resolveParentSession({
      parentPath: outsidePath,
      sessionRoot: root,
      readHeader: async () => {
        called = true;
        return header("outside-session");
      },
    }),
    { state: "unavailable" },
  );
  assert.equal(called, false);
  assert.deepEqual(
    await resolveParentSession({
      parentPath: join(root, "parent.jsonl"),
      sessionRoot: root,
      readHeader: async () => header("injected-parent"),
    }),
    { state: "known", id: "injected-parent" },
  );
});

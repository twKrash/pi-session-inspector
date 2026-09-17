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
let linkedRoot: string;
let linkedSiblingPath: string;
let hugePath: string;
let overBoundPaddingPath: string;
let smallPaddingPath: string;
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
  // First line is a *valid* v3 header with a bounded id, but carries more than
  // the 16 KiB header-read bound of padding inside the JSON. The newline only
  // arrives past the bound, so an enforced bound rejects it; an unbounded read
  // would parse it as a valid header.
  overBoundPaddingPath = join(root, "padded-over-bound.jsonl");
  await writeFile(
    overBoundPaddingPath,
    `${JSON.stringify({
      type: "session",
      version: 3,
      id: "padded-parent-session",
      padding: "a".repeat(17_000),
    })}\n`,
  );
  // Same shape, but the padding is well under the bound, so the header still
  // resolves. Pins the lower side of the bound against an over-narrow cap.
  smallPaddingPath = join(root, "padded-small.jsonl");
  await writeFile(
    smallPaddingPath,
    `${JSON.stringify({
      type: "session",
      version: 3,
      id: "padded-parent-session",
      padding: "a".repeat(256),
    })}\n`,
  );
  await writeFile(join(root, "empty.jsonl"), "");
  missingPath = join(root, "missing.jsonl");

  outsidePath = join(workspace, "outside.jsonl");
  await writeFile(outsidePath, header("outside-session"));

  // A root whose lexical path and canonical path differ, because one component
  // is a symbolic link. This is the shape macOS presents for `/var` under
  // `/private/var`: the approved root is canonical while Pi reports the path it
  // was given, so the two must not be compared across forms.
  const linkedTarget = join(workspace, "linked-target");
  await mkdir(join(linkedTarget, "sessions"), { recursive: true });
  await writeFile(
    join(linkedTarget, "sessions", "linked-parent.jsonl"),
    header("linked-parent-session"),
  );
  await writeFile(
    join(linkedTarget, "linked-sibling.jsonl"),
    header("linked-sibling-session"),
  );
  linkedRoot = join(workspace, "linked-root");
  await symlink(linkedTarget, linkedRoot);
  linkedSiblingPath = join(linkedRoot, "linked-sibling.jsonl");

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

test("a valid header longer than 16 KiB is unavailable and diagnostic", async () => {
  // Mutant kill: dropping/widening MAX_HEADER_BYTES lets the unbounded read see
  // the trailing newline past 16 KiB, parse the valid header and return
  // { state: "known", id: "padded-parent-session" }.
  const diagnostics = new Set<ParentSessionDiagnostic>();
  assert.deepEqual(
    await resolveParentSession({
      parentPath: overBoundPaddingPath,
      sessionRoot: root,
      diagnostics,
    }),
    { state: "unavailable" },
  );
  assert.equal(diagnostics.has("parent-session-unavailable"), true);
});

test("a valid header with sub-bound padding still resolves", async () => {
  // Pins the lower side: an over-narrow bound would reject this valid header.
  const diagnostics = new Set<ParentSessionDiagnostic>();
  assert.deepEqual(
    await resolveParentSession({
      parentPath: smallPaddingPath,
      sessionRoot: root,
      diagnostics,
    }),
    { state: "known", id: "padded-parent-session" },
  );
  assert.equal(diagnostics.size, 0);
});

test("a root reached through a link still contains the parents inside it", async () => {
  // Mutant kill: judging the lexical candidate against the canonical root makes
  // this contained parent look like a `..` escape, so it is reported
  // `unavailable` on the platforms that present a link component in the root.
  assert.deepEqual(
    await resolveParentSession({
      parentPath: join(linkedRoot, "sessions", "linked-parent.jsonl"),
      sessionRoot: join(linkedRoot, "sessions"),
    }),
    { state: "known", id: "linked-parent-session" },
  );
  // Containment is not weakened to get there: a sibling of the root, reached
  // through the same link, is still outside it.
  assert.deepEqual(
    await resolveParentSession({
      parentPath: linkedSiblingPath,
      sessionRoot: join(linkedRoot, "sessions"),
    }),
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

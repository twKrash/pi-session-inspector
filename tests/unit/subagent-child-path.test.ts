import assert from "node:assert/strict";
import { test } from "node:test";
import {
  childSessionRoot,
  isConfinedChildPath,
  MAX_CHILD_PATH_BYTES,
} from "../../src/pi/child-session-path.ts";

test("the child directory is the parent's absolute .jsonl path without its suffix", () => {
  assert.equal(childSessionRoot("/s/parent.jsonl"), "/s/parent");
  assert.equal(childSessionRoot("parent.jsonl"), undefined, "relative");
  assert.equal(childSessionRoot(".jsonl"), undefined, "relative");
  assert.equal(childSessionRoot("/s/parent"), undefined, "not a .jsonl file");
  assert.equal(childSessionRoot("/s/parent.json"), undefined);
});

const ROOT = "/s/parent";
const inside = (rest: string) => `${ROOT}/${rest}`;

test("a bounded, normalized, absolute .jsonl strictly beneath the root is confined", () => {
  assert.equal(
    isConfinedChildPath(inside("run-1/run-0/session.jsonl"), ROOT),
    true,
  );
  assert.equal(isConfinedChildPath(inside("a.jsonl"), ROOT), true);
});

test("everything else is not confined", () => {
  const rejected: unknown[] = [
    undefined,
    42,
    "",
    "s/parent/a.jsonl",
    "/s/other/a.jsonl",
    "/s/parent-evil/a.jsonl",
    "/s/parent.jsonl",
    ROOT,
    `${ROOT}/`,
    inside("a.json"),
    inside("a/../b.jsonl"),
    inside("a//b.jsonl"),
    inside("a\0.jsonl"),
  ];
  for (const candidate of rejected) {
    assert.equal(
      isConfinedChildPath(candidate, ROOT),
      false,
      String(candidate),
    );
  }
});

test("the path byte bound is inclusive", () => {
  const withBytes = (bytes: number) =>
    inside(`${"a".repeat(bytes - inside("").length - ".jsonl".length)}.jsonl`);
  assert.equal(
    Buffer.byteLength(withBytes(MAX_CHILD_PATH_BYTES)),
    MAX_CHILD_PATH_BYTES,
  );
  assert.equal(
    isConfinedChildPath(withBytes(MAX_CHILD_PATH_BYTES), ROOT),
    true,
  );
  assert.equal(
    isConfinedChildPath(withBytes(MAX_CHILD_PATH_BYTES + 1), ROOT),
    false,
  );
});

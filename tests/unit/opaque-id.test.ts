import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canonicalOpaqueDigest,
  OPAQUE_ID_DOMAINS,
} from "../../src/core/opaque-id.ts";

const SESSION = "01a0950b-60f3-72b7-9d18-4b9836d6845f";

test("digest is deterministic 64 lowercase hex", () => {
  const a = canonicalOpaqueDigest("live-tool", SESSION, "call_abc");
  const b = canonicalOpaqueDigest("live-tool", SESSION, "call_abc");
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
});

test("domains and sessions are collision-isolated", () => {
  const base = canonicalOpaqueDigest("live-tool", SESSION, "id");
  assert.notEqual(
    base,
    canonicalOpaqueDigest("permission-request", SESSION, "id"),
  );
  assert.notEqual(
    base,
    canonicalOpaqueDigest("live-tool", `${SESSION}-2`, "id"),
  );
  assert.notEqual(base, canonicalOpaqueDigest("live-tool", SESSION, "id "));
  assert.equal(OPAQUE_ID_DOMAINS.length, 3);
});

test("invalid input is rejected, never hashed leniently", () => {
  assert.throws(() => canonicalOpaqueDigest("live-tool", SESSION, ""));
  assert.throws(() => canonicalOpaqueDigest("live-tool", "", "id"));
  assert.throws(() => canonicalOpaqueDigest("live-tool", SESSION, "a\u0000b"));
  assert.throws(() =>
    canonicalOpaqueDigest("live-tool", SESSION, "x".repeat(513)),
  );
  assert.throws(() => canonicalOpaqueDigest("nope" as never, SESSION, "id"));
});

test("utf8 bytes are hashed without normalization", () => {
  const composed = canonicalOpaqueDigest("live-tool", SESSION, "\u00e9");
  const decomposed = canonicalOpaqueDigest("live-tool", SESSION, "e\u0301");
  assert.notEqual(composed, decomposed);
});

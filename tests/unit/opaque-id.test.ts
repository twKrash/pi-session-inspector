import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canonicalOpaqueDigest,
  OPAQUE_ID_DOMAINS,
} from "../../src/core/opaque-id.ts";

const SESSION = "fixture-session";

// Pinned reference vector for the spec §8.1.1 preimage: fields NUL-separated,
// no trailing NUL. Changing the preimage must fail this assertion.
const GOLDEN =
  "301ec87b2b3d5de5f8ceed12db1019649b0ca95ed93f7d70b6e245d838015420";

test("digest is deterministic 64 lowercase hex and pins the golden vector", () => {
  const a = canonicalOpaqueDigest("live-tool", SESSION, "call_abc");
  const b = canonicalOpaqueDigest("live-tool", SESSION, "call_abc");
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.equal(a, GOLDEN);
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
  // Field-boundary test: with `+` concatenation both preimages become
  // `...fixture-sessionab`, so these two must differ only if NUL separators exist.
  assert.notEqual(
    canonicalOpaqueDigest("live-tool", SESSION, "ab"),
    canonicalOpaqueDigest("live-tool", `${SESSION}a`, "b"),
  );
  // Trailing whitespace is hashed, never trimmed.
  assert.notEqual(base, canonicalOpaqueDigest("live-tool", SESSION, "id "));
  assert.deepEqual(
    [...OPAQUE_ID_DOMAINS],
    ["live-tool", "permission-request", "subagent-run"],
  );
});

test("invalid input is rejected, never hashed leniently", () => {
  assert.throws(
    () => canonicalOpaqueDigest("live-tool", SESSION, ""),
    TypeError,
  );
  assert.throws(() => canonicalOpaqueDigest("live-tool", "", "id"), TypeError);
  assert.throws(
    () => canonicalOpaqueDigest("live-tool", SESSION, "a\u0000b"),
    TypeError,
  );
  assert.throws(
    () => canonicalOpaqueDigest("live-tool", SESSION, "a\u0001b"),
    TypeError,
  );
  assert.throws(
    () => canonicalOpaqueDigest("live-tool", SESSION, "x".repeat(513)),
    TypeError,
  );
  assert.throws(
    () => canonicalOpaqueDigest("nope" as never, SESSION, "id"),
    TypeError,
  );
});

test("utf8 bytes are hashed without normalization", () => {
  const composed = canonicalOpaqueDigest("live-tool", SESSION, "\u00e9");
  const decomposed = canonicalOpaqueDigest("live-tool", SESSION, "e\u0301");
  assert.notEqual(composed, decomposed);
});

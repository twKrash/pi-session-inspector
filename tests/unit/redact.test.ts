import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PATH_MARKER,
  REDACTED,
  URL_MARKER,
  redactBoundedText,
  secretLikeValue,
} from "../../src/core/redact.ts";

test("redacts secrets, paths, and URLs while preserving ordinary prose", () => {
  const cases: Array<[string, string]> = [
    [
      "Request failed: /home/dev/project/.env not readable",
      "Request failed: [PATH] not readable",
    ],
    ["ENOENT: open '/tmp/report.json'", "ENOENT: open '[PATH]'"],
    ["missing C:\\Users\\dev\\secret.txt", "missing [PATH]"],
    ["missing C:/Users/dev/x", "missing [PATH]"],
    ["cannot read \\\\server\\share\\x", "cannot read [PATH]"],
    ["fetch file:///home/dev/x failed", "fetch [URL] failed"],
    [
      "401 from https://user:pass@api.example.com/v1?token=abc",
      "401 from [URL]",
    ],
    ["Bearer sk-live-abcdef leaked", "[REDACTED]"],
    ["unsupported: text/html", "unsupported: text/html"],
    ["ratio 1.2/3.4 and/or 3/4", "ratio 1.2/3.4 and/or 3/4"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(redactBoundedText(input), expected, input);
  }

  assert.equal(
    redactBoundedText("a".repeat(400))?.endsWith("…[TRUNCATED]"),
    true,
  );
  assert.equal(redactBoundedText("line one\nline two")?.includes("\n"), false);
  assert.equal(redactBoundedText(undefined), undefined);
});

test("rejects non-string and empty-after-strip input", () => {
  assert.equal(redactBoundedText(null), undefined);
  assert.equal(redactBoundedText(42), undefined);
  assert.equal(redactBoundedText("   \n\t "), undefined);
});

test("truncates at a UTF-8 boundary within the byte budget", () => {
  const value = "é".repeat(300);
  const redacted = redactBoundedText(value, 200);
  assert.ok(redacted !== undefined);
  assert.equal(Buffer.byteLength(redacted, "utf8") <= 200, true);
  assert.equal(redacted.endsWith("…[TRUNCATED]"), true);
  // No replacement characters: the cut landed on a code point boundary.
  assert.equal(redacted.includes("\uFFFD"), false);
  assert.equal(/^é+…\[TRUNCATED\]$/.test(redacted), true);

  // Byte-accurate accounting: a 20-byte budget still yields a valid string.
  const narrow = redactBoundedText(value, 20);
  assert.ok(narrow !== undefined);
  assert.equal(Buffer.byteLength(narrow, "utf8") <= 20, true);
});

test("returns an already-bounded value unchanged", () => {
  assert.equal(redactBoundedText("short message"), "short message");
});

test("redacts bare provider tokens and honors tiny byte budgets", () => {
  const redacted = redactBoundedText("auth failed for sk-abcdef123");
  assert.equal(redacted, REDACTED);
  assert.equal(redacted?.includes("sk-abcdef123"), false);

  // The truncation marker is 14 bytes; every smaller budget still fits.
  for (const budget of [1, 5, 13, 14, 15]) {
    const bounded = redactBoundedText("x".repeat(400), budget);
    assert.ok(bounded !== undefined);
    assert.equal(
      Buffer.byteLength(bounded, "utf8") <= budget,
      true,
      `budget ${budget} overflowed`,
    );
  }
  assert.equal(redactBoundedText("x".repeat(400), 14), "x".repeat(14));
});

test("exposes the marker constants", () => {
  assert.equal(REDACTED, "[REDACTED]");
  assert.equal(PATH_MARKER, "[PATH]");
  assert.equal(URL_MARKER, "[URL]");
});

test("secretLikeValue recognises secret-shaped values", () => {
  assert.equal(secretLikeValue("Bearer sk-live-abcdef"), true);
  assert.equal(secretLikeValue("sk-abcdef123"), true);
  assert.equal(secretLikeValue("PASSWORD=hunter2"), true);
  assert.equal(secretLikeValue("lists files"), false);
});

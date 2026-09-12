import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boundedProducerLabel,
  isBoundedToken,
} from "../../src/core/evidence.ts";

test("bounded token accepts safe ASCII identifiers only", () => {
  assert.equal(isBoundedToken("call_abc-1", 64), true);
  assert.equal(isBoundedToken("", 64), false);
  assert.equal(isBoundedToken("a".repeat(65), 64), false);
  assert.equal(isBoundedToken("a b", 64), false);
  assert.equal(isBoundedToken(42, 64), false);
});

test("producer labels are bounded and secret/path rejected", () => {
  assert.equal(boundedProducerLabel("openai"), "openai");
  assert.equal(boundedProducerLabel("Bearer abc"), undefined);
  assert.equal(boundedProducerLabel("/home/u/project"), undefined);
  assert.equal(boundedProducerLabel("x".repeat(200)), undefined);
  assert.equal(boundedProducerLabel(7), undefined);
});

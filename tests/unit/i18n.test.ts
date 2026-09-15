import assert from "node:assert/strict";
import { test } from "node:test";

import { createTranslator } from "../../src/ui/i18n.ts";
import { ENGLISH_CATALOG } from "../../src/ui/i18n/catalog.ts";

test("translator resolves local English catalog with existing braces", () => {
  const t = createTranslator("en");

  assert.equal(t("range.last", { days: 7 }), "Last 7 days");
  assert.equal(
    t("coverage.sessions", { available: 2, inspected: 3, unavailable: 1 }),
    "2 / 3 sessions · 1 unavailable",
  );
});

test("translator is explicit, synchronous, and returns missing keys", () => {
  const t = createTranslator("unsupported-locale");

  assert.equal(t("report.title"), "Pi Session Inspector");
  assert.equal(t("missing.key" as never), "missing.key");
});

test("translator resolves every local catalog entry", () => {
  const t = createTranslator();

  for (const [key, value] of Object.entries(ENGLISH_CATALOG)) {
    assert.equal(t(key as keyof typeof ENGLISH_CATALOG), value, key);
  }
});

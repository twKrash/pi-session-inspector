import assert from "node:assert/strict";
import { test } from "node:test";

import { createTranslator } from "../../src/ui/i18n.ts";

/**
 * The Inspector-owned translation boundary: what the adapter promises, not what
 * i18next does internally. Rendering coverage lives in the browser and snapshot
 * tests, which read the same catalog.
 */
test("resolves catalog copy, interpolated and plain", () => {
  const t = createTranslator("en");

  assert.equal(t("range.last", { days: 7 }), "Last 7 days");
  assert.equal(t("heading.current"), "A session, in focus.");
});

test("falls back to English for an unsupported locale", () => {
  const t = createTranslator("de");

  assert.equal(t("report.title"), "Pi Session Inspector");
});

test("returns the key itself for a missing key", () => {
  const t = createTranslator("en");

  assert.equal(t("missing.key" as never), "missing.key");
});

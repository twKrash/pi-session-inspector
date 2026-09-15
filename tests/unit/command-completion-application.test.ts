import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyCompletionFor,
  suggestionLabelsFor,
} from "./helpers/pi-autocomplete.ts";

/**
 * §10.2 rows the pinned provider can deliver verbatim. The trailing space of
 * the last row is the table's `␠`.
 */
const cases: [string, string, string][] = [
  ["/session-ins ui --th", "--theme", "/session-ins ui --theme"],
  ["/session-ins ui --theme d", "dark", "/session-ins ui --theme dark"],
  [
    "/session-ins snapshot current --preset 1",
    "14",
    "/session-ins snapshot current --preset 14",
  ],
  [
    "/session-ins ui --theme dark --",
    "--scope",
    "/session-ins ui --theme dark --scope",
  ],
  [
    "/session-ins snapshot current --sc",
    "--scope",
    "/session-ins snapshot current --scope",
  ],
  [
    "/session-ins snapshot current --scope tr",
    "tree",
    "/session-ins snapshot current --scope tree",
  ],
  [
    '/session-ins snapshot current --output "/tmp/my report.html" --th',
    "--theme",
    '/session-ins snapshot current --output "/tmp/my report.html" --theme',
  ],
  [
    '/session-ins snapshot current --output "/tmp/my report.html" ',
    "--theme",
    '/session-ins snapshot current --output "/tmp/my report.html" --theme',
  ],
];

test("completion replaces only the current token through the real Pi provider", async () => {
  for (const [line, label, expected] of cases) {
    const result = await applyCompletionFor(line, line.length, label);
    assert.deepEqual(
      [result.line, result.cursor],
      [expected, expected.length],
      line,
    );
  }
});

test("option completion after a settled mode keeps the typed prefix", async () => {
  const applied = await applyCompletionFor(
    "/session-ins ui ",
    "/session-ins ui ".length,
    "--theme",
  );
  assert.deepEqual(
    [applied.line, applied.cursor],
    ["/session-ins ui --theme", "/session-ins ui --theme".length],
  );
});

test("an option already present is not offered again through the real provider", async () => {
  const line = "/session-ins ui --theme dark --";
  assert.deepEqual(await suggestionLabelsFor(line, line.length), [
    "--scope",
    "--debug",
    "--no-open",
  ]);
});

test("mode completion replaces the whole empty argument region", async () => {
  const applied = await applyCompletionFor(
    "/session-ins ",
    "/session-ins ".length,
    "ui",
  );
  assert.deepEqual(
    [applied.line, applied.cursor],
    ["/session-ins ui", "/session-ins ui".length],
  );
});

test("a mid-token cursor pins Pi's afterCursor append (§10.2 row 10 is unachievable)", async () => {
  // R17: `getArgumentCompletions` receives only the text before the cursor
  // ("ui --the"), so the extension cannot see the trailing "me". Pi's
  // `applyCompletion` computes `afterCursor = currentLine.slice(cursorCol)` and
  // appends it verbatim after `item.value`, so the remainder is duplicated.
  // No extension-side value can produce the §10.2 row 10 line here; this pins
  // the pinned provider's actual composition instead of faking the table.
  const applied = await applyCompletionFor(
    "/session-ins ui --theme",
    "/session-ins ui --the".length,
    "--theme",
  );
  assert.deepEqual(
    [applied.line, applied.cursor],
    ["/session-ins ui --thememe", "/session-ins ui --theme".length],
  );
});

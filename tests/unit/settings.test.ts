import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  MAX_SETTINGS_BYTES,
  parseSettings,
  readSettings,
  readSettingsSync,
  resolveConfig,
} from "../../src/config/settings.ts";

test("an absent or empty settings document resolves to product defaults", () => {
  assert.deepEqual(parseSettings("{}"), { settings: {}, diagnostics: [] });
  assert.deepEqual(resolveConfig({ settings: {}, cli: {} }), {
    theme: "light",
    debug: false,
    themeSource: "default",
    debugSource: "default",
  });
});

test("malformed settings degrade to defaults with a bounded diagnostic", () => {
  for (const text of ["", "{", "null", "[]", '"dark"', "42"]) {
    const read = parseSettings(text);
    assert.deepEqual(read.settings, {}, text);
    assert.deepEqual(read.diagnostics, ["settings-malformed"], text);
  }
  const oversized = `{"theme":"dark","padding":"${"x".repeat(
    MAX_SETTINGS_BYTES,
  )}"}`;
  assert.deepEqual(parseSettings(oversized).diagnostics, [
    "settings-oversized",
  ]);

  // The bound is UTF-8 bytes: a multi-byte document that fits in code units
  // still does not fit the file bound.
  const multiByte = `{"theme":"${"é".repeat(MAX_SETTINGS_BYTES / 2)}"}`;
  assert.equal(multiByte.length < MAX_SETTINGS_BYTES, true);
  assert.deepEqual(parseSettings(multiByte).diagnostics, [
    "settings-oversized",
  ]);
});

test("an unknown key or a wrongly typed value is ignored, never guessed", () => {
  assert.deepEqual(parseSettings('{"theme":"blue","debug":"yes","other":1}'), {
    settings: {},
    diagnostics: [],
  });
  assert.deepEqual(parseSettings('{"theme":"dark","debug":true}').settings, {
    theme: "dark",
    debug: true,
  });
});

test("CLI options win over settings, and settings win over the default", () => {
  const settings = { theme: "dark", debug: true } as const;

  assert.deepEqual(resolveConfig({ settings, cli: {} }), {
    theme: "dark",
    debug: true,
    themeSource: "settings",
    debugSource: "settings",
  });
  assert.deepEqual(resolveConfig({ settings, cli: { theme: "light" } }), {
    theme: "light",
    debug: true,
    themeSource: "cli",
    debugSource: "settings",
  });
  // `--debug` enables logging for the invocation even when settings say false.
  assert.deepEqual(
    resolveConfig({ settings: { debug: false }, cli: { debug: true } }),
    {
      theme: "light",
      debug: true,
      themeSource: "default",
      debugSource: "cli",
    },
  );
  // An explicit false is still an explicit CLI choice.
  assert.deepEqual(
    resolveConfig({ settings: { debug: true }, cli: { debug: false } }).debug,
    false,
  );
});

test("a missing settings file is the default configuration, not a diagnostic", async () => {
  const missingPath = join(
    tmpdir(),
    `inspector-absent-${Date.now()}`,
    "settings.json",
  );
  assert.deepEqual(await readSettings(missingPath), {
    settings: {},
    diagnostics: [],
  });
  assert.deepEqual(readSettingsSync(missingPath), {
    settings: {},
    diagnostics: [],
  });
});

test("a settings file that exists but cannot be read is reported as unreadable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-settings-"));
  try {
    // A directory where the file is expected: the read fails with EISDIR, which
    // is a real failure and must not be mistaken for "not configured".
    assert.deepEqual(readSettingsSync(directory).diagnostics, [
      "settings-unreadable",
    ]);
    assert.deepEqual((await readSettings(directory)).diagnostics, [
      "settings-unreadable",
    ]);

    const path = join(directory, "settings.json");
    await writeFile(path, '{"theme":"dark","debug":true}', "utf8");
    assert.deepEqual(readSettingsSync(path), {
      settings: { theme: "dark", debug: true },
      diagnostics: [],
    });
    assert.deepEqual(await readSettings(path), readSettingsSync(path));

    await writeFile(path, "{ not json", "utf8");
    assert.deepEqual(readSettingsSync(path).diagnostics, [
      "settings-malformed",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("an oversized settings file is refused before it is read", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-settings-"));
  try {
    const path = join(directory, "settings.json");
    // Valid JSON, but far past the byte bound: the size check must reject it
    // without parsing a document this large.
    await writeFile(
      path,
      `{"theme":"dark","padding":"${"x".repeat(MAX_SETTINGS_BYTES * 4)}"}`,
      "utf8",
    );
    assert.deepEqual(readSettingsSync(path), {
      settings: {},
      diagnostics: ["settings-oversized"],
    });
    assert.deepEqual(await readSettings(path), {
      settings: {},
      diagnostics: ["settings-oversized"],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

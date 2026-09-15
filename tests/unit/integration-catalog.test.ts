import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defineIntegration,
  defineIntegrations,
  findIntegration,
  integrationCounters,
  isAllowedIntegrationCounter,
  isKnownIntegrationVersion,
  primaryVersion,
  reportIntegrations,
  resolveIntegrationKey,
  rowKeys,
} from "../../src/integrations/catalog.ts";
import type { Integration } from "../../src/integrations/contract.ts";

/** Minimal descriptor; every test overrides only what it asserts. */
function integration(
  key: string,
  overrides: Partial<Integration> = {},
): Integration {
  return { key, schemas: { 1: { counters: ["calls"] } }, ...overrides };
}

test("a definition is validated locally and keeps its literal key", () => {
  const alpha = defineIntegration({
    key: "alpha",
    aliases: ["a"],
    schemas: { 1: { counters: ["calls"] } },
  });
  // The literal type survives, so a catalog key can be named without a
  // hand-maintained union.
  const literal: "alpha" = alpha.key;
  assert.equal(literal, "alpha");
  assert.deepEqual(alpha.aliases, ["a"]);
});

test("a malformed definition is rejected at its source", () => {
  for (const key of ["", "Alpha", "al pha", "a".repeat(33), "__proto__"]) {
    assert.throws(
      () => defineIntegration(integration(key)),
      /invalid integration key/,
      key,
    );
  }
  assert.throws(
    () => defineIntegration({ key: "alpha", schemas: {} }),
    /needs at least one schema version/,
  );
  for (const version of [0, -1, 1.5]) {
    assert.throws(
      () =>
        defineIntegration({
          key: "alpha",
          schemas: { [version]: { counters: ["calls"] } },
        }),
      /invalid schema version/,
      String(version),
    );
  }
  assert.throws(
    () =>
      defineIntegration({
        key: "alpha",
        schemas: { 1: { counters: ["calls", "calls"] } },
      }),
    /duplicate counter: calls/,
  );
  assert.throws(
    () =>
      defineIntegration({
        key: "alpha",
        schemas: { 1: { counters: ["cal ls"] } },
      }),
    /invalid counter name/,
  );
  for (const alias of ["", "A", "al ias"]) {
    assert.throws(
      () => defineIntegration(integration("alpha", { aliases: [alias] })),
      /invalid integration alias/,
      JSON.stringify(alias),
    );
  }
  assert.throws(
    () => defineIntegration(integration("alpha", { aliases: ["alpha"] })),
    /alias collides with an integration key: alpha/,
  );
});

test("a legacy-only definition cannot own an alias", () => {
  assert.throws(
    () =>
      defineIntegration({
        key: "mode",
        aliases: ["m"],
        legacyOnly: true,
        schemas: { 1: { counters: ["changes"] } },
      }),
    /legacy-only integration cannot own an alias: m/,
  );
});

test("declaration order is the report order, with no order metadata", () => {
  const list = defineIntegrations([
    integration("gamma"),
    integration("alpha", { aliases: ["a"] }),
    integration("beta"),
  ]);

  assert.deepEqual(
    list.map((entry) => entry.key),
    ["gamma", "alpha", "beta"],
  );
  assert.deepEqual(
    reportIntegrations(list).map((entry) => entry.key),
    ["gamma", "alpha", "beta"],
  );
  // No `order` field exists to disagree with the array.
  for (const entry of list) {
    assert.equal(Object.hasOwn(entry, "order"), false);
  }
});

test("the collection rejects duplicates, collisions, and legacy hooks", () => {
  assert.throws(
    () => defineIntegrations([integration("alpha"), integration("alpha")]),
    /duplicate integration key: alpha/,
  );
  assert.throws(
    () =>
      defineIntegrations([
        integration("alpha", { aliases: ["beta"] }),
        integration("beta"),
      ]),
    /alias collides with an integration key: beta/,
  );
  assert.throws(
    () =>
      defineIntegrations([
        integration("alpha", { aliases: ["a"] }),
        integration("beta", { aliases: ["a"] }),
      ]),
    /alias collides with an integration key: a/,
  );
  assert.throws(
    () =>
      defineIntegrations([
        integration("mode", {
          legacyOnly: true,
          hooks: { presence: () => "present" },
        }),
      ]),
    /legacy-only integration cannot own hooks: mode/,
  );
});

test("the declared list is frozen", () => {
  const list = defineIntegrations([integration("alpha")]);
  assert.equal(Object.isFrozen(list), true);
});

test("lookup helpers answer over the declared list and nothing else", () => {
  const list = defineIntegrations([
    integration("alpha", { aliases: ["a"] }),
    integration("gamma"),
    integration("mode", {
      legacyOnly: true,
      schemas: { 1: { counters: ["changes"] } },
    }),
  ]);

  assert.deepEqual(rowKeys(list), ["alpha", "gamma", "mode"]);
  assert.deepEqual(
    reportIntegrations(list).map((entry) => entry.key),
    ["alpha", "gamma"],
  );
  assert.equal(findIntegration(list, "gamma")?.key, "gamma");
  assert.equal(findIntegration(list, "delta"), undefined);

  // A legacy key validates rows but never resolves as a report key.
  assert.equal(resolveIntegrationKey(list, "alpha"), "alpha");
  assert.equal(resolveIntegrationKey(list, "a"), "alpha");
  assert.equal(resolveIntegrationKey(list, "mode"), undefined);
  assert.equal(resolveIntegrationKey(list, "delta"), undefined);
  for (const hostile of ["__proto__", "constructor", "toString", ""]) {
    assert.equal(resolveIntegrationKey(list, hostile), undefined, hostile);
  }

  assert.equal(isKnownIntegrationVersion(list, "alpha", 1), true);
  assert.equal(isKnownIntegrationVersion(list, "alpha", 2), false);
  assert.equal(isKnownIntegrationVersion(list, "delta", 1), false);
  assert.equal(isAllowedIntegrationCounter(list, "alpha", 1, "calls"), true);
  assert.equal(isAllowedIntegrationCounter(list, "alpha", 1, "tokens"), false);
  assert.equal(isAllowedIntegrationCounter(list, "mode", 1, "changes"), true);
  assert.deepEqual(integrationCounters(list, "alpha", 1), ["calls"]);
  assert.equal(integrationCounters(list, "alpha", 2), undefined);
  assert.equal(primaryVersion(list, "alpha"), 1);
  assert.equal(primaryVersion(list, "delta"), undefined);
});

test("a multi-version definition validates each declared version", () => {
  const list = defineIntegrations([
    defineIntegration({
      key: "alpha",
      schemas: {
        1: { counters: ["calls"] },
        2: { counters: ["calls", "tokens"] },
      },
    }),
  ]);

  assert.equal(isAllowedIntegrationCounter(list, "alpha", 1, "tokens"), false);
  assert.equal(isAllowedIntegrationCounter(list, "alpha", 2, "tokens"), true);
  assert.equal(primaryVersion(list, "alpha"), 1);
});

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

type CapabilityState = "supported" | "unavailable" | "unsupported";
type CapabilityMatrix = {
  statusProjection: CapabilityState;
  asyncStatusSnapshot: CapabilityState;
  fleetStatus: CapabilityState;
  cost: CapabilityState;
  processTerminalProof: CapabilityState;
  childStatusEvent: CapabilityState;
};
type Compatibility = {
  protocol: "supported" | "unsupported";
  capabilities: CapabilityMatrix;
};
type Validator = (value: unknown) => Compatibility;

type ValidatorModule = { validatePiSubagentsPing: Validator };
const validatorModule = import(
  "../../src/integrations/pi-subagents-compatibility.ts"
)
  .then((module) => module as unknown as ValidatorModule)
  .catch(() => undefined);

async function getValidator(): Promise<Validator> {
  const module = await validatorModule;
  assert.ok(module, "pi-subagents compatibility validator should exist");
  return module.validatePiSubagentsPing;
}

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`../fixtures/pi-subagents/rpc-v1/${name}`, import.meta.url),
      "utf8",
    ),
  );

const capabilityNames: readonly (keyof CapabilityMatrix)[] = [
  "statusProjection",
  "asyncStatusSnapshot",
  "fleetStatus",
  "cost",
  "processTerminalProof",
  "childStatusEvent",
];

function typescriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? typescriptFiles(path)
      : entry.name.endsWith(".ts")
        ? [path]
        : [];
  });
}

test("projects the supported pinned v1 capability matrix", async () => {
  const validate = await getValidator();
  assert.deepEqual(validate(fixture("ping-supported.json")), {
    protocol: "supported",
    capabilities: {
      statusProjection: "supported",
      asyncStatusSnapshot: "supported",
      fleetStatus: "supported",
      cost: "supported",
      processTerminalProof: "supported",
      childStatusEvent: "supported",
    },
  });
});

test("rejects a malformed present capabilities container", async () => {
  const validate = await getValidator();
  const ping = fixture("ping-supported.json");
  assert.ok(typeof ping === "object" && ping !== null && !Array.isArray(ping));
  const result = validate({ ...ping, capabilities: [] });
  assert.equal(result.protocol, "unsupported");
  assert.deepEqual(result.capabilities, {
    statusProjection: "unsupported",
    asyncStatusSnapshot: "unsupported",
    fleetStatus: "unsupported",
    cost: "unsupported",
    processTerminalProof: "unsupported",
    childStatusEvent: "unsupported",
  });
});

test("rejects a malformed present events container", async () => {
  const validate = await getValidator();
  const ping = fixture("ping-supported.json");
  assert.ok(typeof ping === "object" && ping !== null && !Array.isArray(ping));
  const result = validate({ ...ping, events: [] });
  assert.equal(result.protocol, "unsupported");
  assert.deepEqual(result.capabilities, {
    statusProjection: "unsupported",
    asyncStatusSnapshot: "unsupported",
    fleetStatus: "unsupported",
    cost: "unsupported",
    processTerminalProof: "unsupported",
    childStatusEvent: "unsupported",
  });
});

test("unknown protocol version disables the whole live contract", async () => {
  const validate = await getValidator();
  const result = validate(fixture("ping-unsupported-protocol.json"));
  assert.equal(result.protocol, "unsupported");
  assert.deepEqual(result.capabilities, {
    statusProjection: "unsupported",
    asyncStatusSnapshot: "unsupported",
    fleetStatus: "unsupported",
    cost: "unsupported",
    processTerminalProof: "unsupported",
    childStatusEvent: "unsupported",
  });
});

test("missing or unsupported capability disables only that capability", async () => {
  const validate = await getValidator();
  const result = validate(fixture("ping-partial-capabilities.json"));
  assert.equal(result.protocol, "supported");
  assert.deepEqual(result.capabilities, {
    statusProjection: "supported",
    asyncStatusSnapshot: "unsupported",
    fleetStatus: "supported",
    cost: "unavailable",
    processTerminalProof: "supported",
    childStatusEvent: "supported",
  });
});

test("ignores additive fields without retaining producer payload", async () => {
  const validate = await getValidator();
  const result = validate(fixture("ping-additive-fields.json"));
  assert.deepEqual(result, validate(fixture("ping-supported.json")));
  assert.deepEqual(
    Object.keys(result.capabilities).sort(),
    [...capabilityNames].sort(),
  );
  assert.equal(JSON.stringify(result).includes("ADDITIVE_ONLY"), false);
});

test("keeps contract validation outside production runtime imports", () => {
  const consumers = typescriptFiles(resolve("src")).filter((path) =>
    /(?:from\s*|import\s*\()["'][^"']*pi-subagents-compatibility/.test(
      readFileSync(path, "utf8"),
    ),
  );
  assert.deepEqual(consumers, []);
});

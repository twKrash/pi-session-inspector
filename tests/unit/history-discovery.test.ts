import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { discoverHistory } from "../../src/storage/history.ts";

const maintenance = {
  writerId: "maintainer-1",
  now: () => new Date("2026-09-01T00:00:00.000Z"),
  isPidAlive: () => true,
};

test("reports a bounded reason per unavailable session", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-discovery-"));
  await mkdir(join(root, "sessions", "11111111-1111-4111-8111-111111111111"), {
    recursive: true,
  });
  const result = await discoverHistory({
    root,
    sessionDirectory: () => join(root, "pi-sessions"),
    markerEvidence: async () => true,
    maintenance,
  });
  assert.equal(result.availability, "available");
  assert.deepEqual(
    [
      result.sessions.length,
      result.sessions[0]?.availability,
      result.sessions[0]?.reason,
    ],
    [1, "unavailable", "no-manifest"],
  );
  assert.equal(result.discoveryLimited, false);
});

test("flags discovery as limited when the session cap is reached", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-discovery-cap-"));
  const sessions = join(root, "sessions");
  for (let index = 0; index < 207; index += 1) {
    const id = `1111111${String(index).padStart(2, "0")}-1111-4111-8111-111111111111`;
    await mkdir(join(sessions, id), { recursive: true });
    await writeFile(join(sessions, id, "tracking.json"), "{}");
  }
  const result = await discoverHistory({
    root,
    sessionDirectory: () => join(root, "pi-sessions"),
    markerEvidence: async () => true,
    maintenance,
  });
  assert.equal(result.discoveryLimited, true);
  assert.equal(result.sessions.length, 206);
  assert.ok(result.diagnostics.includes("history-limit-reached"));
});

test("an unreadable sessions directory stays unavailable and unlimited", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-discovery-missing-"));
  const result = await discoverHistory({
    root,
    sessionDirectory: () => join(root, "pi-sessions"),
    markerEvidence: async () => true,
    maintenance,
  });
  assert.deepEqual(result, {
    availability: "unavailable",
    sessions: [],
    diagnostics: ["history-unavailable"],
    discoveryLimited: false,
  });
});

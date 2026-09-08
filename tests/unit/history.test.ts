import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { discoverHistory } from "../../src/storage/history.ts";

const maintenance = {
  writerId: "maintainer-1",
  now: () => new Date("2026-09-07T12:00:00.000Z"),
  isPidAlive: () => false,
};

async function writeManifest(
  root: string,
  sessionId: string,
  fileName: "meta.json" | "meta.json.pending" = "meta.json",
): Promise<void> {
  const directory = join(root, "sessions", sessionId);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, fileName),
    `${JSON.stringify({ schemaVersion: 1, sessionId, state: "tracking" })}\n`,
  );
}

test("promotes pending tracking metadata only when native marker evidence is available under a maintenance lease", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-history-"));
  try {
    await writeManifest(root, "pending-session", "meta.json.pending");

    let evidenceChecks = 0;
    const result = await discoverHistory({
      root,
      markerEvidence: async (sessionId) => {
        evidenceChecks += 1;
        assert.equal(sessionId, "pending-session");
        if (evidenceChecks === 2) {
          const owner = JSON.parse(
            await readFile(
              join(
                root,
                "sessions",
                "pending-session",
                "maintenance.lease",
                "owner.json",
              ),
              "utf8",
            ),
          ) as { writerId?: unknown };
          assert.equal(owner.writerId, "maintainer-1");
        }
        return true;
      },
      maintenance,
    });
    assert.equal(evidenceChecks, 2);

    assert.deepEqual(result, {
      availability: "available",
      sessions: [{ sessionId: "pending-session", availability: "available" }],
      diagnostics: [],
    });
    assert.equal(
      await readFile(
        join(root, "sessions", "pending-session", "meta.json"),
        "utf8",
      ),
      '{"schemaVersion":1,"sessionId":"pending-session","state":"tracking"}\n',
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("does not promote pending metadata when marker evidence is removed after lease acquisition", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-history-"));
  try {
    await writeManifest(root, "rewritten-session", "meta.json.pending");
    let evidenceChecks = 0;

    const result = await discoverHistory({
      root,
      markerEvidence: async () => {
        evidenceChecks += 1;
        return evidenceChecks === 1;
      },
      maintenance,
    });

    assert.deepEqual(result.sessions, [
      { sessionId: "rewritten-session", availability: "unavailable" },
    ]);
    assert.equal(evidenceChecks, 2);
    await assert.rejects(
      readFile(
        join(root, "sessions", "rewritten-session", "meta.json"),
        "utf8",
      ),
      { code: "ENOENT" },
    );
    assert.equal(
      await readFile(
        join(root, "sessions", "rewritten-session", "meta.json.pending"),
        "utf8",
      ),
      '{"schemaVersion":1,"sessionId":"rewritten-session","state":"tracking"}\n',
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("keeps pending metadata unavailable when marker evidence is absent or cannot be read", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-history-"));
  try {
    await writeManifest(root, "without-marker", "meta.json.pending");
    await writeManifest(root, "marker-error", "meta.json.pending");

    const result = await discoverHistory({
      root,
      markerEvidence: async (sessionId) => {
        if (sessionId === "marker-error") throw new Error("Pi unavailable");
        return false;
      },
      maintenance,
    });

    assert.deepEqual(result.sessions, [
      { sessionId: "marker-error", availability: "unavailable" },
      { sessionId: "without-marker", availability: "unavailable" },
    ]);
    assert.deepEqual(result.diagnostics, ["marker-unavailable"]);
    await assert.rejects(
      readFile(join(root, "sessions", "without-marker", "meta.json"), "utf8"),
      { code: "ENOENT" },
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("discovers at most 206 Inspector manifests without scanning Pi sessions", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-history-"));
  try {
    await Promise.all(
      Array.from({ length: 207 }, (_, index) =>
        writeManifest(root, `session-${String(index).padStart(3, "0")}`),
      ),
    );
    await mkdir(join(root, "unrelated-pi-sessions"), { recursive: true });
    await writeFile(join(root, "unrelated-pi-sessions", "not-a-manifest"), "");

    const evidenceCalls: string[] = [];
    const result = await discoverHistory({
      root,
      markerEvidence: async (sessionId) => {
        evidenceCalls.push(sessionId);
        return true;
      },
      maintenance,
    });

    assert.equal(result.availability, "available");
    assert.equal(result.sessions.length, 206);
    assert.equal(evidenceCalls.length, 206);
    assert.deepEqual(result.diagnostics, ["history-limit-reached"]);
    assert.equal(result.sessions.at(-1)?.sessionId, "session-205");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("rejects oversized manifests before parsing them", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-history-"));
  try {
    const sessionId = "oversized-manifest";
    const directory = join(root, "sessions", sessionId);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "meta.json"), "x".repeat(1025));

    const result = await discoverHistory({
      root,
      markerEvidence: async () => {
        throw new Error(
          "must not read marker evidence for an invalid manifest",
        );
      },
      maintenance,
    });

    assert.deepEqual(result.sessions, [
      { sessionId, availability: "unavailable" },
    ]);
    assert.deepEqual(result.diagnostics, ["manifest-unavailable"]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("reports missing or unknown Inspector manifests as unavailable without guessing", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-history-"));
  try {
    const missing = await discoverHistory({
      root,
      markerEvidence: async () => true,
      maintenance,
    });
    assert.deepEqual(missing, {
      availability: "unavailable",
      sessions: [],
      diagnostics: ["history-unavailable"],
    });

    await mkdir(join(root, "sessions", "unknown-format"), { recursive: true });
    await writeFile(
      join(root, "sessions", "unknown-format", "meta.json"),
      "{}\n",
    );
    const unknown = await discoverHistory({
      root,
      markerEvidence: async () => true,
      maintenance,
    });
    assert.deepEqual(unknown.sessions, [
      { sessionId: "unknown-format", availability: "unavailable" },
    ]);
    assert.deepEqual(unknown.diagnostics, ["manifest-unavailable"]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { writeLiveUiCorpus } from "../../benchmark/corpus.ts";

test("live UI corpus produces 100 safe, manifest-backed sessions deterministically", async () => {
  const firstDirectory = await mkdtemp(
    join(tmpdir(), "pi-live-ui-corpus-first-"),
  );
  const secondDirectory = await mkdtemp(
    join(tmpdir(), "pi-live-ui-corpus-second-"),
  );
  try {
    const first = await writeLiveUiCorpus({
      directory: firstDirectory,
      sessions: 100,
      records: 40,
      seed: 20261030,
    });
    const second = await writeLiveUiCorpus({
      directory: secondDirectory,
      sessions: 100,
      records: 40,
      seed: 20261030,
    });
    const summary = (corpus: typeof first) =>
      corpus.sessions.map(({ sessionId, records, bytes }) => ({
        sessionId,
        records,
        bytes,
      }));

    assert.equal(first.sessions.length, 100);
    assert.equal(
      new Set(first.sessions.map(({ sessionId }) => sessionId)).size,
      100,
    );
    assert.ok(
      first.sessions.every(({ sessionId }) =>
        /^[a-z0-9]+-session-\d{3}$/.test(sessionId),
      ),
    );
    assert.deepEqual(summary(first), summary(second));
    for (const session of first.sessions) {
      assert.equal(session.records, 40);
      const header = JSON.parse(
        (await readFile(session.path, "utf8")).split("\n", 1)[0] ?? "null",
      ) as { id?: string };
      assert.equal(header.id, session.sessionId);
      const manifest = JSON.parse(
        await readFile(
          join(first.root, "sessions", session.sessionId, "meta.json"),
          "utf8",
        ),
      ) as Record<string, unknown>;
      assert.deepEqual(manifest, {
        schemaVersion: 2,
        sessionId: session.sessionId,
        sourceFile: `${session.sessionId}.jsonl`,
        state: "tracking",
      });
    }
  } finally {
    await rm(firstDirectory, { recursive: true, force: true });
    await rm(secondDirectory, { recursive: true, force: true });
  }
});

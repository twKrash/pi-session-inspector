import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  buildSessionLines,
  CORPUS_SEED,
  CORPUS_VERSION,
  writeCheckpointCorpus,
  writeSessionCorpus,
} from "../../benchmark/corpus.ts";
import { reduceEntries } from "../../src/core/reduce.ts";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";
import { selectScope } from "../../src/pi/sessions.ts";
import { readCheckpoint } from "../../src/storage/checkpoint.ts";

test("builds a byte-identical fixed-seed corpus for a given version", () => {
  assert.equal(CORPUS_VERSION, 1);
  const first = buildSessionLines({ records: 40, seed: CORPUS_SEED });
  const second = buildSessionLines({ records: 40, seed: CORPUS_SEED });
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, buildSessionLines({ records: 40, seed: 1 }));
  assert.equal(first.length, 42);
});

test("writes a replayable session corpus with the requested record count", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-corpus-"));
  try {
    const corpus = await writeSessionCorpus({
      directory,
      name: "session",
      records: 25,
    });
    assert.equal(corpus.records, 25);
    assert.ok(corpus.bytes > 0);
    const session = parseSessionJsonl(
      await (await import("node:fs/promises")).readFile(corpus.path, "utf8"),
    );
    assert.equal(session.hasMalformedJson, false);
    const entries = selectScope(session.entries, null, "tree");
    const reduced = reduceEntries(session.id, entries);
    assert.equal(reduced.generations.length, corpus.generations);
    assert.equal(reduced.tools.length, corpus.generations);
    assert.ok(reduced.tools.length > 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("writes checkpoint corpus entries that the real reader accepts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-checkpoints-"));
  try {
    const directories = await writeCheckpointCorpus({
      directory,
      count: 4,
    });
    assert.equal(directories.length, 4);
    let totalTokens = 0;
    for (const checkpointDirectory of directories) {
      const checkpoint = await readCheckpoint({
        directory: checkpointDirectory,
      });
      assert.ok(checkpoint, "corpus checkpoint must be valid");
      totalTokens += checkpoint.aggregates.totalTokens;
    }
    assert.equal(totalTokens, 1_000 + 1_001 + 1_002 + 1_003);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

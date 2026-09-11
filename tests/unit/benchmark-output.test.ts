import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { writeBenchmarkOutput } from "../../benchmark/output.ts";

test("writes benchmark results into a non-existent output directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-benchmark-output-"));
  try {
    const out = join(root, "nested", "missing", "release-latest.json");
    await writeBenchmarkOutput(out, { mode: "release", samples: 3 });

    const contents = await readFile(out, "utf8");
    assert.deepEqual(JSON.parse(contents), { mode: "release", samples: 3 });
    assert.equal(contents.endsWith("\n"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import {
  cleanReportCache,
  generatedReportPath,
  writeReportOutput,
} from "../../src/ui/report-output.ts";

const execFile = promisify(execFileCallback);
const reportOutputModule = new URL(
  "../../src/ui/report-output.ts",
  import.meta.url,
).href;

async function writeFromChild({
  cacheDirectory,
  path,
  content,
  explicit,
}: {
  cacheDirectory: string;
  path: string;
  content: string;
  explicit: boolean;
}): Promise<string | undefined> {
  const script = `
    import { writeReportOutput } from ${JSON.stringify(reportOutputModule)};
    const result = await writeReportOutput({
      cacheDirectory: process.argv[1], path: process.argv[2],
      content: process.argv[3], explicit: process.argv[4] === "true",
    });
    process.stdout.write(JSON.stringify(result ?? null));
  `;
  const { stdout } = await execFile(process.execPath, [
    "--import",
    "tsx",
    "--input-type=module",
    "--eval",
    script,
    cacheDirectory,
    path,
    content,
    String(explicit),
  ]);
  return (JSON.parse(stdout) as string | null) ?? undefined;
}

test("expires generated report cache after fourteen days", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-report-cache-"));
  try {
    const old = join(root, "old.html");
    const fresh = join(root, "fresh.html");
    await writeFile(old, "old");
    await writeFile(fresh, "fresh");
    await utimes(
      old,
      new Date("2026-01-01T00:00:00Z"),
      new Date("2026-01-01T00:00:00Z"),
    );
    await cleanReportCache(root, new Date("2026-01-16T00:00:00Z"));
    await assert.rejects(access(old));
    assert.equal(await readFile(fresh, "utf8"), "fresh");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("caps generated report cache at 100 MiB oldest first", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-report-cache-"));
  try {
    const old = join(root, "old.html");
    const fresh = join(root, "fresh.html");
    await writeFile(old, Buffer.alloc(60 * 1024 * 1024));
    await writeFile(fresh, Buffer.alloc(60 * 1024 * 1024));
    await utimes(
      old,
      new Date("2026-01-10T00:00:00Z"),
      new Date("2026-01-10T00:00:00Z"),
    );
    await cleanReportCache(root, new Date("2026-01-16T00:00:00Z"));
    await assert.rejects(access(old));
    await access(fresh);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generates opaque cache filenames inside the cache for hostile session IDs", () => {
  const cache = "/tmp/inspector/reports";
  const output = generatedReportPath(
    cache,
    "../../outside/secret-session\\name",
    "html",
  );

  assert.equal(output.startsWith(`${cache}/`), true);
  assert.match(
    output,
    /^\/tmp\/inspector\/reports\/session-[a-f0-9]{64}\.html$/,
  );
});

test("never overwrites an explicit output, including one deliberately placed inside the cache", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-report-cache-"));
  try {
    const cache = join(root, "reports");
    const explicit = join(cache, "user-report.html");
    await writeReportOutput({
      path: explicit,
      content: "user",
      cacheDirectory: cache,
      explicit: true,
    });

    assert.equal(
      await writeReportOutput({
        path: explicit,
        content: "generated",
        cacheDirectory: cache,
        explicit: false,
      }),
      undefined,
    );
    assert.equal(await readFile(explicit, "utf8"), "user");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reserves the explicit-output registry filename from explicit cache outputs", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-report-cache-"));
  try {
    const cache = join(root, "reports");
    const registry = join(cache, ".explicit-outputs");
    assert.equal(
      await writeReportOutput({
        path: registry,
        content: "user content",
        cacheDirectory: cache,
        explicit: true,
      }),
      undefined,
    );
    await assert.rejects(access(registry));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps every concurrent explicit cache output protected", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-report-cache-"));
  try {
    const cache = join(root, "reports");
    const outputs = ["first.html", "second.html", "third.html"].map((name) =>
      join(cache, name),
    );
    await Promise.all(
      outputs.map((path, index) =>
        writeReportOutput({
          path,
          content: `user ${index}`,
          cacheDirectory: cache,
          explicit: true,
        }),
      ),
    );

    for (const path of outputs) {
      assert.equal(
        await writeReportOutput({
          path,
          content: "generated",
          cacheDirectory: cache,
          explicit: false,
        }),
        undefined,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("coordinates cache output registry across processes", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-report-cache-"));
  try {
    const cache = join(root, "reports");
    const names = Array.from(
      { length: 12 },
      (_, index) => `user-${index}.html`,
    );
    const outputs = await Promise.all(
      names.map((name) =>
        writeFromChild({
          cacheDirectory: cache,
          path: join(cache, name),
          content: name,
          explicit: true,
        }),
      ),
    );

    assert.deepEqual(
      outputs.sort(),
      names.map((name) => join(cache, name)).sort(),
    );
    assert.deepEqual(
      (await readFile(join(cache, ".explicit-outputs"), "utf8"))
        .trim()
        .split("\n"),
      [...names].sort(),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generated output cannot overwrite a racing explicit cache output", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-report-cache-"));
  try {
    const cache = join(root, "reports");
    const output = join(cache, "same.html");
    const [explicit] = await Promise.all([
      writeFromChild({
        cacheDirectory: cache,
        path: output,
        content: "user",
        explicit: true,
      }),
      writeFromChild({
        cacheDirectory: cache,
        path: output,
        content: "generated",
        explicit: false,
      }),
    ]);

    assert.equal(explicit, output);
    assert.equal(await readFile(output, "utf8"), "user");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recovers an orphaned stale cache lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-report-cache-"));
  try {
    const cache = join(root, "reports");
    await writeCacheLock(cache, {
      pid: 999_999_999,
      acquiredAt: Date.now() - 31_000,
    });
    const output = join(cache, "recovered.html");

    assert.equal(
      await writeReportOutput({
        path: output,
        content: "recovered",
        cacheDirectory: cache,
        explicit: false,
      }),
      output,
    );
    assert.equal(await readFile(output, "utf8"), "recovered");
    await assert.rejects(access(join(cache, ".report-output.lock")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reclaims through repeated abandoned cache claims without path growth", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-report-cache-"));
  try {
    const cache = join(root, "reports");
    const acquiredAt = Date.now() - 31_000;
    const owner = {
      schemaVersion: 1,
      lockId: "test-lock",
      pid: 999_999_999,
      acquiredAt,
    };
    const ownerText = JSON.stringify(owner);
    await writeCacheLock(cache, { pid: owner.pid, acquiredAt });

    const claimRoot = join(
      cache,
      `.report-output.reclaim-${createHash("sha256")
        .update(ownerText)
        .digest("hex")}`,
    );
    const firstClaim = { ...owner, lockId: "abandoned-claimer-1" };
    const firstClaimText = JSON.stringify(firstClaim);
    const secondClaim = { ...owner, lockId: "abandoned-claimer-2" };
    const secondClaimText = JSON.stringify(secondClaim);
    const firstSuccessor = `${claimRoot}.handoff-${createHash("sha256")
      .update(firstClaimText)
      .digest("hex")}`;
    const secondSuccessor = `${claimRoot}.handoff-${createHash("sha256")
      .update(secondClaimText)
      .digest("hex")}`;
    await mkdir(claimRoot);
    await writeFile(join(claimRoot, "owner.json"), firstClaimText);
    await mkdir(firstSuccessor);
    await writeFile(join(firstSuccessor, "owner.json"), secondClaimText);
    // The pre-fix recursive path is intentionally unavailable. Reclamation
    // must use the bounded root-anchored successor for the second claim.
    await writeFile(
      `${firstSuccessor}.handoff-${createHash("sha256")
        .update(secondClaimText)
        .digest("hex")}`,
      "blocked",
    );

    const output = join(cache, "recovered-after-claims.html");
    assert.equal(
      await writeReportOutput({
        path: output,
        content: "recovered",
        cacheDirectory: cache,
        explicit: false,
      }),
      output,
    );
    assert.equal(secondSuccessor.includes(".handoff-.handoff-"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not reclaim a fresh cache lock with a dead PID", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-report-cache-"));
  try {
    const cache = join(root, "reports");
    await writeCacheLock(cache, { pid: 999_999_999, acquiredAt: Date.now() });
    const output = join(cache, "fresh-contention.html");

    assert.equal(
      await writeReportOutput({
        path: output,
        content: "blocked",
        cacheDirectory: cache,
        explicit: false,
      }),
      undefined,
    );
    await access(join(cache, ".report-output.lock", "owner.json"));
    await assert.rejects(access(output));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not reclaim a stale-looking cache lock held by a live PID", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-report-cache-"));
  try {
    const cache = join(root, "reports");
    await writeCacheLock(cache, {
      pid: process.pid,
      acquiredAt: Date.now() - 31_000,
    });
    const output = join(cache, "contended.html");

    assert.equal(
      await writeReportOutput({
        path: output,
        content: "blocked",
        cacheDirectory: cache,
        explicit: false,
      }),
      undefined,
    );
    await access(join(cache, ".report-output.lock", "owner.json"));
    await assert.rejects(access(output));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function writeCacheLock(
  cacheDirectory: string,
  { pid, acquiredAt }: { pid: number; acquiredAt: number },
): Promise<void> {
  const lock = join(cacheDirectory, ".report-output.lock");
  await mkdir(lock, { recursive: true, mode: 0o700 });
  await writeFile(
    join(lock, "owner.json"),
    JSON.stringify({
      schemaVersion: 1,
      lockId: "test-lock",
      pid,
      acquiredAt,
    }),
    { encoding: "utf8", mode: 0o600 },
  );
}

test("never deletes explicit output, including output deliberately placed inside the cache", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-report-cache-"));
  try {
    const cache = join(root, "reports");
    const explicit = join(cache, "user-report.html");
    assert.equal(
      await writeReportOutput({
        path: explicit,
        content: "user",
        cacheDirectory: cache,
        explicit: true,
      }),
      explicit,
    );
    await utimes(
      explicit,
      new Date("2026-01-01T00:00:00Z"),
      new Date("2026-01-01T00:00:00Z"),
    );
    await cleanReportCache(cache, new Date("2026-01-16T00:00:00Z"));
    assert.equal(await readFile(explicit, "utf8"), "user");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uses stable readable safe session and aggregate cache basenames", () => {
  const cache = "/tmp/reports";
  assert.equal(
    generatedReportPath(cache, "abc-123", "html"),
    join(cache, "abc-123.html"),
  );
  assert.equal(
    generatedReportPath(cache, "global", "html", "global"),
    join(cache, "global.html"),
  );
  assert.equal(
    generatedReportPath(cache, "history", "json", "history"),
    join(cache, "history.json"),
  );
  for (const id of [
    "..",
    "a".repeat(300),
    "CON",
    "nul",
    "COM1",
    "trailing.",
    "x/y",
    "x\\y",
  ]) {
    assert.match(
      generatedReportPath(cache, id, "html"),
      /session-[a-f0-9]{64}\.html$/,
    );
  }
});

test("returns an absolute output path so Pi exec cannot reinterpret a relative export", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-report-path-"));
  try {
    const { relative } = await import("node:path");
    const absolute = join(root, "-report.html");
    assert.equal(
      await writeReportOutput({
        path: relative(process.cwd(), absolute),
        content: "report",
        cacheDirectory: join(root, "cache"),
        explicit: true,
      }),
      absolute,
    );
    await assert.rejects(access(join(root, "cache")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps session identities separate from aggregate and hashed fallback namespaces", () => {
  const cache = "/tmp/reports";
  for (const kind of ["global", "history"] as const) {
    assert.notEqual(
      generatedReportPath(cache, kind, "html"),
      generatedReportPath(cache, kind, "html", kind),
    );
  }
  const hostile = generatedReportPath(cache, "../outside", "html");
  const impersonator = hostile.slice(cache.length + 1, -5);
  assert.notEqual(generatedReportPath(cache, impersonator, "html"), hostile);
});

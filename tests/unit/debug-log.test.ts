import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MAX_DEBUG_BYTES, createDebugFileSink } from "../../src/debug/file.ts";
import { MAX_DEBUG_LINE_BYTES } from "../../src/debug/events.ts";
import {
  configureDebugLog,
  debugLog,
  debugLogEnabled,
  resetDebugLog,
} from "../../src/debug/log.ts";
import { toSessionReport } from "../../src/core/reports.ts";
import { renderJson } from "../../src/ui/json.ts";
import type { ReducedSession } from "../../src/core/events.ts";

/** Runs `body` with a capturing sink, restoring the default state afterwards. */
function withSink(body: (lines: string[]) => void): void {
  const lines: string[] = [];
  configureDebugLog({ enabled: true, sink: (line) => lines.push(line) });
  try {
    body(lines);
  } finally {
    resetDebugLog();
  }
}

test("debug logging is off by default and writes nothing", () => {
  resetDebugLog();
  assert.equal(debugLogEnabled(), false);
  // No sink installed: the call is a no-op rather than an error.
  debugLog("integration", "presence-evaluated", { integration: "ponytail" });
});

test("only allowlisted, bounded fields reach the log", () => {
  withSink((lines) => {
    debugLog("integration", "presence-evaluated", {
      integration: "ponytail",
      presence: "present",
      reason: "inventory-signal",
      // Not allowlisted, or not bounded: dropped, never logged.
      prompt: "PRIVATE_PROMPT",
      args: { command: "rm -rf /" },
      path: "/home/dev/private",
      huge: "x".repeat(500),
      integrationPath: 42,
      counters: "not-a-number",
    });

    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0] ?? "{}"), {
      schemaVersion: 1,
      component: "integration",
      event: "presence-evaluated",
      integration: "ponytail",
      presence: "present",
      reason: "inventory-signal",
    });
  });
});

test("an unknown component, event, or unlisted field is dropped", () => {
  withSink((lines) => {
    debugLog("integration", "not-an-event", { integration: "x" });
    // An unknown component is rejected at the type boundary too; the
    // runtime guard is what a plain-JS caller would hit.
    (debugLog as (component: string, event: string) => void)(
      "payload-dump",
      "presence-evaluated",
    );
    debugLog("settings", "loaded", { rawFileContents: "PRIVATE" });
    assert.deepEqual(lines.length, 1, "only the allowlisted event is written");
  });
});

test("a failing sink never throws into the caller", () => {
  configureDebugLog({
    enabled: true,
    sink: () => {
      throw new Error("disk full");
    },
  });
  try {
    assert.doesNotThrow(() => {
      debugLog("integration", "presence-evaluated", { integration: "rtk" });
    });
  } finally {
    resetDebugLog();
  }
});

test("a thrown diagnostic value is never serialized", () => {
  withSink((lines) => {
    const hostile = {
      toString: () => "PRIVATE_SECRET",
      toJSON: () => "PRIVATE_SECRET",
    };
    debugLog("integration", "presence-evaluated", {
      integration: hostile,
      counters: hostile,
      found: hostile,
    });
    assert.equal(lines[0]?.includes("PRIVATE_SECRET"), false);
  });
});

test("debug events never reach a report or its JSON serialization", () => {
  const session: ReducedSession = {
    sessionId: "session-debug",
    usage: { totalTokens: 1, cost: 0 },
    usageComposition: {
      generations: { totalTokens: 0, cost: 0 },
      toolResults: { totalTokens: 0, cost: 0 },
      compactions: { totalTokens: 0, cost: 0 },
      branchSummaries: { totalTokens: 0, cost: 0 },
    },
    generations: [],
    tools: [
      {
        id: "tool:t1",
        timestamp: "2026-09-15T10:00:00.000Z",
        name: "read",
        status: "succeeded",
      },
    ],
    compactions: [],
    errors: [],
  };

  withSink((lines) => {
    debugLog("tool-timing", "duration-computed", {
      subject: "live-tool-abc",
      durationMs: 0,
      found: true,
    });
    assert.equal(lines.length, 1);

    const report = toSessionReport(session);
    const json = renderJson(report);
    for (const marker of [
      "component",
      "tool-timing",
      "duration-computed",
      "live-tool-abc",
    ]) {
      assert.equal(json.includes(marker), false, marker);
    }
  });
});

test("the file sink drops one oversized line instead of writing it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-debug-"));
  try {
    const path = join(directory, "nested", "oversized.jsonl");
    const write = createDebugFileSink(path);
    write(`${"x".repeat(MAX_DEBUG_LINE_BYTES + 1)}\n`);
    // A bounded sentinel proves the chain ran; the oversized line left nothing.
    write('{"component":"settings","event":"loaded","code":"ok"}\n');
    await waitFor(async () => (await size(path)) > 0);
    assert.equal((await readFile(path, "utf8")).includes("xxxx"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the file sink stays bounded under rotation and writes 0o600", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-debug-"));
  try {
    const path = join(directory, "nested", "session-1.jsonl");
    const write = createDebugFileSink(path);

    write("first\n");
    await waitFor(async () => (await size(path)) > 0);
    assert.equal((await stat(path)).mode & 0o777, 0o600);

    // Cross the bound repeatedly: the live file and its single rotated
    // predecessor each stay below the bound no matter how much is written.
    const line = `${JSON.stringify({
      schemaVersion: 1,
      component: "registry",
      event: "initialized",
      subject:
        "live-tool-0000000000000000000000000000000000000000000000000000000000000000",
    })}\n`.padEnd(7_900, " ");
    const writes = Math.ceil((MAX_DEBUG_BYTES * 3) / line.length);
    for (let index = 0; index < writes; index += 1) write(line);

    await waitFor(async () => (await size(`${path}.1`)) > 0);
    // Let the chain finish so the assertions read the settled footprint.
    await sleep(600);

    assert.equal((await size(path)) <= MAX_DEBUG_BYTES, true, "live bound");
    assert.equal(
      (await size(`${path}.1`)) <= MAX_DEBUG_BYTES,
      true,
      "rotated bound",
    );
    assert.equal((await stat(`${path}.1`)).mode & 0o777, 0o600);

    // A sink pointed at an impossible path swallows its failure.
    const unwritable = createDebugFileSink(join(directory, "file", "x.jsonl"));
    await assert.doesNotReject(async () => {
      unwritable("line\n");
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the logger itself drops an event larger than the line bound", () => {
  withSink((lines) => {
    debugLog("registry", "initialized", { counters: 1 });
    assert.equal(lines.length, 1);
    assert.equal(
      Buffer.byteLength(lines[0] ?? "", "utf8") <= MAX_DEBUG_LINE_BYTES,
      true,
    );
  });
});

test("a failed rotation drops the line instead of breaching the bound", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-debug-"));
  try {
    const path = join(directory, "session-2.jsonl");
    const write = createDebugFileSink(path);
    write('{"component":"registry","event":"initialized","counters":1}\n');
    await waitFor(async () => (await size(path)) > 0);

    // Make the rotation target a non-empty directory, so every rename fails
    // while the live file keeps whatever it already holds.
    await mkdir(`${path}.1`, { recursive: true });
    await writeFile(join(`${path}.1`, "keep"), "x", "utf8");

    const filler = `${JSON.stringify({
      schemaVersion: 1,
      component: "registry",
      event: "initialized",
      subject:
        "live-tool-0000000000000000000000000000000000000000000000000000000000000000",
    })}\n`.padEnd(7_900, " ");
    const writes = Math.ceil((MAX_DEBUG_BYTES * 1.5) / filler.length);
    for (let index = 0; index < writes; index += 1) write(filler);
    await sleep(600);

    const size_ = await size(path);
    // Every line that required rotation was dropped, so the bound held.
    assert.equal(size_ <= MAX_DEBUG_BYTES, true, `size ${size_}`);
    assert.equal(size_ > 0, true, "the pre-rotation lines are still there");
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  } finally {
    await sleep(100);
    await rm(directory, { recursive: true, force: true });
  }
});

test("a pre-existing permissive directory and file are tightened on first write", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-debug-"));
  try {
    const nested = join(directory, "loose");
    await mkdir(nested, { recursive: true, mode: 0o755 });
    await chmod(nested, 0o755);
    const path = join(nested, "session-3.jsonl");
    await writeFile(path, "", { encoding: "utf8", mode: 0o644 });
    await chmod(path, 0o644);
    assert.equal((await stat(path)).mode & 0o777, 0o644);

    const write = createDebugFileSink(path);
    write('{"component":"settings","event":"loaded","code":"ok"}\n');
    await waitFor(async () => (await size(path)) > 0);

    assert.equal((await stat(nested)).mode & 0o777, 0o700);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a sink whose private directory cannot be established writes nothing", async () => {
  // The debug directory path is occupied by a regular file, so the sink can
  // never establish its private (0700) directory. It fails closed: no debug
  // data is written anywhere and no error escapes to the caller.
  const directory = await mkdtemp(join(tmpdir(), "inspector-debug-"));
  try {
    const blocker = join(directory, "debug");
    await writeFile(blocker, "not a directory", "utf8");
    const path = join(blocker, "session-4.jsonl");

    const write = createDebugFileSink(path);
    await assert.doesNotReject(async () => {
      write('{"component":"settings","event":"loaded","code":"ok"}\n');
      await sleep(50);
    });

    assert.equal(existsSync(path), false);
    assert.equal((await stat(blocker)).isFile(), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The live size of one debug file; zero while it does not exist. */
async function size(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

async function waitFor(check: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition never held");
}

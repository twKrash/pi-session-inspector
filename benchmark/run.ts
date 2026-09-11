import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { reduceEntries } from "../src/core/reduce.ts";
import { toSessionReport } from "../src/core/reports.ts";
import { parseSessionJsonl } from "../src/pi/adapter.ts";
import { selectScope } from "../src/pi/sessions.ts";
import { readCheckpoint } from "../src/storage/checkpoint.ts";
import { renderHtml } from "../src/ui/html.ts";
import { renderJson } from "../src/ui/json.ts";
import {
  CORPUS_RECORDS,
  CORPUS_TARGET_BYTES,
  CORPUS_VERSION,
  writeCheckpointCorpus,
  writeSessionCorpus,
} from "./corpus.ts";
import { writeBenchmarkOutput } from "./output.ts";

/**
 * Published SLO targets that this harness actually measures. Spec SLOs for
 * delta reconcile and global fold are listed as unmeasured below, not claimed
 * here from proxy timings.
 */
const TARGETS = {
  coldReplay100MiB: { ms: 2_000 },
  incrementalMemory10k: { bytes: 10 * 1024 * 1024 },
  html: { ms: 3_000, bytes: 5 * 1024 * 1024 },
} as const;

type Samples = { median: number; p95: number; min: number; max: number };

function summarize(samples: number[]): Samples {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (quantile: number) =>
    sorted[
      Math.min(
        sorted.length - 1,
        Math.max(0, Math.ceil(quantile * sorted.length) - 1),
      )
    ] as number;
  return {
    median: at(0.5),
    p95: at(0.95),
    min: sorted[0] as number,
    max: sorted[sorted.length - 1] as number,
  };
}

async function time(operation: () => Promise<void> | void): Promise<number> {
  const started = performance.now();
  await operation();
  return performance.now() - started;
}

function replaySessionFile(source: string): string {
  const session = parseSessionJsonl(source);
  const entries = selectScope(session.entries, null, "tree");
  return renderJson(toSessionReport(reduceEntries(session.id, entries)));
}

async function main(): Promise<void> {
  const mode = process.argv.includes("--mode=release") ? "release" : "smoke";
  const warmSamples = mode === "release" ? 10 : 3;
  const coldSamples = mode === "release" ? 3 : 1;
  const directory = await mkdtemp(join(tmpdir(), "inspector-benchmark-"));
  const results: Record<string, unknown> = {
    corpusVersion: CORPUS_VERSION,
    mode,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    samples: { warm: warmSamples, cold: coldSamples },
    targets: TARGETS,
  };

  try {
    const small = await writeSessionCorpus({
      directory,
      name: "session-10k",
      records: CORPUS_RECORDS,
    });
    const smallSource = await readFile(small.path, "utf8");
    const first = replaySessionFile(smallSource);
    if (first !== replaySessionFile(smallSource))
      throw new Error("corpus replay is not deterministic");
    if (JSON.parse(first).generations.length !== small.generations)
      throw new Error("corpus replay lost records");

    const replaySamples: number[] = [];
    const memorySamples: number[] = [];
    const keepAlive: unknown[] = [];
    for (let index = 0; index < warmSamples; index += 1) {
      replaySamples.push(
        await time(() => {
          replaySessionFile(smallSource);
        }),
      );
      // Retain the reduced analyzer result in a reference sink so the delta
      // measures live memory for 10k records, then release it.
      global.gc?.();
      const before = process.memoryUsage().heapUsed;
      keepAlive[0] = (() => {
        const session = parseSessionJsonl(smallSource);
        const entries = selectScope(session.entries, null, "tree");
        return toSessionReport(reduceEntries(session.id, entries));
      })();
      global.gc?.();
      memorySamples.push(Math.max(0, process.memoryUsage().heapUsed - before));
      keepAlive[0] = undefined;
    }

    const checkpointDirectories = await writeCheckpointCorpus({
      directory: join(directory, "checkpoints"),
    });
    let folded = 0;
    const checkpointFoldSamples: number[] = [];
    for (let index = 0; index < warmSamples; index += 1) {
      checkpointFoldSamples.push(
        await time(async () => {
          folded = 0;
          for (const checkpointDirectory of checkpointDirectories) {
            const checkpoint = await readCheckpoint({
              directory: checkpointDirectory,
            });
            if (checkpoint === undefined)
              throw new Error("corpus checkpoint is unreadable");
            folded += checkpoint.aggregates.totalTokens;
          }
        }),
      );
    }
    if (folded === 0) throw new Error("checkpoint fold produced no aggregates");

    const htmlSamples: number[] = [];
    let htmlBytes = 0;
    const report = JSON.parse(first);
    for (let index = 0; index < warmSamples; index += 1) {
      htmlSamples.push(
        await time(() => {
          htmlBytes = Buffer.byteLength(
            renderHtml({ kind: "current", report, scope: "tree" }),
            "utf8",
          );
        }),
      );
    }

    results.warm = {
      replay10kMs: summarize(replaySamples),
      incrementalMemory10kBytes: summarize(memorySamples),
      checkpointReadFold1000Ms: summarize(checkpointFoldSamples),
      htmlMs: summarize(htmlSamples),
      htmlBytes,
      records: small.records,
      checkpoints: checkpointDirectories.length,
    };

    if (mode === "release") {
      const large = await writeSessionCorpus({
        directory,
        name: "session-100mb",
        targetBytes: CORPUS_TARGET_BYTES,
      });
      results.corpus = { largeBytes: large.bytes, largeRecords: large.records };
      const coldSamplesMs: number[] = [];
      for (let index = 0; index < coldSamples; index += 1) {
        coldSamplesMs.push(
          await time(async () => {
            replaySessionFile(await readFile(large.path, "utf8"));
          }),
        );
      }
      results.cold = { replay100MiBMs: summarize(coldSamplesMs) };
    }

    results.unmeasured = {
      reconcile10kDelta:
        "spec SLO; this harness reports warm 10k replay instead",
      globalFold1000Checkpoints:
        "spec SLO; this harness reports raw checkpoint read + token sum instead of loadGlobalReport",
      observerScheduling:
        "requires live Pi hooks; not measurable in this harness",
      startup: "measured by release packaging job, not this corpus harness",
      tuiWarmPaint: "requires a TUI host; HTML render time is reported instead",
    };

    console.log(JSON.stringify(results, null, 2));
    const writeIndex = process.argv.findIndex((value) =>
      value.startsWith("--out="),
    );
    if (writeIndex >= 0) {
      const out = process.argv[writeIndex]?.slice("--out=".length);
      if (out) await writeBenchmarkOutput(out, results);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

await main();

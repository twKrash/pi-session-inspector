import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Fixed-seed benchmark corpus. Corpus content is synthetic filler only: no
 * prompt, response, tool argument, or real session text is ever included.
 */
export const CORPUS_VERSION = 1;
export const CORPUS_SEED = 20260907;
export const CORPUS_RECORDS = 10_000;
export const CORPUS_TARGET_BYTES = 100 * 1024 * 1024;
export const CORPUS_CHECKPOINTS = 1_000;

const FILLER = "corpus-fixed-seed-filler-".repeat(24);
const PROVIDERS = ["acme", "globex", "initech"];
const MODELS = ["alpha", "beta", "gamma"];
const TOOLS = ["read", "grep", "bash"];

/** Deterministic PRNG so a corpus version always reproduces byte-identical input. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)] as T;
}

function entryId(index: number): string {
  return `entry-${String(index).padStart(8, "0")}`;
}

function timestamp(index: number): string {
  return new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString();
}

/** Builds one deterministic Pi session body of approximately `targetBytes`. */
export function buildSessionLines({
  records,
  targetBytes,
  seed = CORPUS_SEED,
}: {
  records?: number;
  targetBytes?: number;
  seed?: number;
}): string[] {
  const random = createRandom(seed);
  const lines: string[] = [
    JSON.stringify({ type: "session", version: 3, id: "corpus-session" }),
    JSON.stringify({
      type: "custom",
      id: entryId(0),
      parentId: null,
      customType: "session-inspector:tracking-start",
      data: { schemaVersion: 1 },
      timestamp: timestamp(0),
    }),
  ];

  const build = (index: number): string => {
    const role = index % 5 === 4 ? "toolResult" : "assistant";
    if (role === "toolResult") {
      return JSON.stringify({
        type: "message",
        id: entryId(index),
        parentId: index === 0 ? null : entryId(index - 1),
        timestamp: timestamp(index),
        message: {
          role,
          toolCallId: `call-${index - 1}`,
          content: [{ type: "text", text: FILLER }],
          usage: { totalTokens: 3, cost: { total: 0.0001 } },
        },
      });
    }
    return JSON.stringify({
      type: "message",
      id: entryId(index),
      parentId: index === 0 ? null : entryId(index - 1),
      timestamp: timestamp(index),
      message: {
        role,
        provider: pick(random, PROVIDERS),
        model: pick(random, MODELS),
        content: [
          { type: "text", text: FILLER },
          {
            type: "toolCall",
            id: `call-${index}`,
            name: pick(random, TOOLS),
            arguments: {},
          },
        ],
        usage: {
          input: 10 + (index % 7),
          output: 5 + (index % 3),
          cacheRead: index % 2,
          cacheWrite: 0,
          totalTokens: 15 + (index % 10),
          cost: { total: 0.001 },
        },
      },
    });
  };

  const count =
    records ??
    Math.max(
      1,
      Math.ceil(
        (targetBytes ?? CORPUS_RECORDS) / Buffer.byteLength(build(1), "utf8"),
      ),
    );
  for (let index = 1; index <= count; index += 1) lines.push(build(index));
  return lines;
}

/** Writes one deterministic session JSONL file and reports its exact size. */
export async function writeSessionCorpus({
  directory,
  name,
  records,
  targetBytes,
}: {
  directory: string;
  name: string;
  records?: number;
  targetBytes?: number;
}): Promise<{
  path: string;
  bytes: number;
  records: number;
  generations: number;
}> {
  await mkdir(directory, { recursive: true });
  const lines = buildSessionLines({ records, targetBytes });
  const body = `${lines.join("\n")}\n`;
  const path = join(directory, `${name}.jsonl`);
  await writeFile(path, body, { encoding: "utf8" });
  return {
    path,
    bytes: Buffer.byteLength(body, "utf8"),
    records: lines.length - 2,
    generations: lines.reduce(
      (count, line) => count + (line.includes('"role":"assistant"') ? 1 : 0),
      0,
    ),
  };
}

/** Writes `count` valid derived checkpoints for the global-fold measurement. */
export async function writeCheckpointCorpus({
  directory,
  count = CORPUS_CHECKPOINTS,
}: {
  directory: string;
  count?: number;
}): Promise<string[]> {
  const directories: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const sessionDirectory = join(
      directory,
      `session-${String(index).padStart(5, "0")}`,
    );
    await mkdir(sessionDirectory, { recursive: true });
    const checkpoint = {
      schemaVersion: 1,
      cursors: {
        pi: {
          lineCount: 100 + index,
          revision: createHash("sha256")
            .update(`corpus-${index}`)
            .digest("hex"),
        },
        wal: {},
      },
      aggregates: {
        totalTokens: 1_000 + index,
        totalCost: 0.5,
        generations: 10,
        tools: 20,
        compactions: 1,
      },
    };
    await writeFile(
      join(sessionDirectory, "checkpoint.json"),
      `${JSON.stringify(checkpoint)}\n`,
      { encoding: "utf8" },
    );
    directories.push(sessionDirectory);
  }
  return directories;
}

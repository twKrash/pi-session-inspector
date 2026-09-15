import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * One metric's distribution across samples. `stdev` is the sample standard
 * deviation (n−1); the Pre-M8.6 benchmarks record spread alongside the median so
 * a reported figure can be read against its variance, not in isolation.
 */
export type Samples = {
  median: number;
  p95: number;
  min: number;
  max: number;
  stdev: number;
};

/** Nearest-rank summary; shared so every benchmark reports the same shape. */
export function summarize(samples: number[]): Samples {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (quantile: number) =>
    sorted[
      Math.min(
        sorted.length - 1,
        Math.max(0, Math.ceil(quantile * sorted.length) - 1),
      )
    ] as number;
  const median = at(0.5);
  const mean =
    sorted.length === 0
      ? 0
      : sorted.reduce((total, value) => total + value, 0) / sorted.length;
  const stdev =
    sorted.length < 2
      ? 0
      : Math.sqrt(
          sorted.reduce((total, value) => total + (value - mean) ** 2, 0) /
            (sorted.length - 1),
        );
  return {
    max: sorted[sorted.length - 1] as number,
    median,
    min: sorted[0] as number,
    p95: at(0.95),
    stdev,
  };
}

/** Writes benchmark results, creating any missing parent directory. */
export async function writeBenchmarkOutput(
  out: string,
  results: unknown,
): Promise<void> {
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(results, null, 2)}\n`, "utf8");
}

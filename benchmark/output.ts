import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** One metric's distribution across samples. */
export type Samples = { median: number; p95: number; min: number; max: number };

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
  return {
    median: at(0.5),
    p95: at(0.95),
    min: sorted[0] as number,
    max: sorted[sorted.length - 1] as number,
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

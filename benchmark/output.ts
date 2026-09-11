import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Writes benchmark results, creating any missing parent directory. */
export async function writeBenchmarkOutput(
  out: string,
  results: unknown,
): Promise<void> {
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(results, null, 2)}\n`, "utf8");
}

import { performance } from "node:perf_hooks";

export type LoadStage =
  | "current-jsonl-read"
  | "current-jsonl-parse"
  | "current-report-build"
  | "history-discovery"
  | "history-jsonl-read"
  | "history-jsonl-parse"
  | "history-replay"
  | "history-evidence-provider"
  | "history-aggregation"
  | "global-aggregation";

export type LoadMetric = {
  stage: LoadStage;
  durationMs: number;
  bytes?: number;
};

export type LoadInstrumentation = (metric: LoadMetric) => void;

export function emitLoadMetric(
  instrumentation: LoadInstrumentation | undefined,
  stage: LoadStage,
  durationMs: number,
  bytes?: number,
): void {
  if (instrumentation === undefined) return;
  try {
    instrumentation({
      stage,
      durationMs,
      ...(bytes === undefined ? {} : { bytes }),
    });
  } catch {
    // Instrumentation is observational and must never alter report loading.
  }
}

export function measureSync<T>(
  instrumentation: LoadInstrumentation | undefined,
  stage: LoadStage,
  operation: () => T,
): T {
  if (instrumentation === undefined) return operation();
  const started = performance.now();
  try {
    return operation();
  } finally {
    emitLoadMetric(instrumentation, stage, performance.now() - started);
  }
}

export async function measureAsync<T>(
  instrumentation: LoadInstrumentation | undefined,
  stage: LoadStage,
  operation: () => Promise<T>,
  bytesOf?: (value: T) => number,
): Promise<T> {
  if (instrumentation === undefined) return operation();
  const started = performance.now();
  let bytes: number | undefined;
  try {
    const value = await operation();
    // Observation only: a byte counter that throws must not fail the load.
    try {
      bytes = bytesOf?.(value);
    } catch {
      bytes = undefined;
    }
    return value;
  } finally {
    emitLoadMetric(instrumentation, stage, performance.now() - started, bytes);
  }
}

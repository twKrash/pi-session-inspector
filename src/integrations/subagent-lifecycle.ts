import { Buffer } from "node:buffer";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, normalize, parse, sep } from "node:path";

import type { AgentRun } from "../core/events.ts";
import { MAX_AGENT_RUN_TOOL_CALLS } from "../core/events.ts";
import { boundedProducerLabel } from "../core/evidence.ts";
import { roundCost } from "../core/rounding.ts";

const MAX_STATUS_BYTES = 128 * 1024;
const MAX_ASYNC_DIR_BYTES = 4096;
const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const STEP_STATUSES = new Set([
  "pending",
  "running",
  "complete",
  "completed",
  "failed",
  "partial",
  "paused",
  "stopped",
  "rejected",
]);
const MAX_TOTAL_TOKENS = 1_000_000_000;
const MAX_COST = 1_000_000_000;
const MAX_DURATION_MS = 86_400_000_000;

type LifecycleEnrichment = {
  agent?: string;
  model?: string;
  thinking?: string;
  status?: AgentRun["status"];
  usage?: { totalTokens?: number; cost?: number };
  durationMs?: number;
  toolCalls?: number;
};

function readLifecycleUsage(record: Record<string, unknown>) {
  const tokens = record.tokens;
  const totalCost = record.totalCost;
  const tokenRecord =
    typeof tokens === "object" && tokens !== null && !Array.isArray(tokens)
      ? (tokens as Record<string, unknown>)
      : undefined;
  const costRecord =
    typeof totalCost === "object" &&
    totalCost !== null &&
    !Array.isArray(totalCost)
      ? (totalCost as Record<string, unknown>)
      : undefined;
  const totalTokens = tokenRecord?.total;
  const cost = costRecord?.costUsd;
  const boundedTokens =
    typeof totalTokens === "number" &&
    Number.isSafeInteger(totalTokens) &&
    totalTokens >= 0 &&
    totalTokens <= MAX_TOTAL_TOKENS
      ? totalTokens
      : undefined;
  const boundedCost =
    typeof cost === "number" &&
    Number.isFinite(cost) &&
    cost >= 0 &&
    cost <= MAX_COST
      ? roundCost(cost)
      : undefined;
  return boundedTokens === undefined && boundedCost === undefined
    ? undefined
    : {
        ...(boundedTokens === undefined ? {} : { totalTokens: boundedTokens }),
        ...(boundedCost === undefined ? {} : { cost: boundedCost }),
      };
}

function readLifecycleOutcome(
  record: Record<string, unknown>,
): AgentRun["status"] | undefined {
  const status = record.status;
  if (status === "failed") return "failed";
  if (status === "stopped") return "interrupted";
  const exitCode = record.exitCode;
  if (
    typeof exitCode === "number" &&
    Number.isSafeInteger(exitCode) &&
    exitCode >= 0 &&
    exitCode <= 2_147_483_647
  ) {
    if (exitCode > 0) return "failed";
    if (exitCode === 0 && status === "complete") return "succeeded";
  }
  return undefined;
}

/** Returns only approved bounded step fields; every failure is no enrichment. */
export async function readReferencedLifecycleEnrichment(
  asyncDir: unknown,
  runId: string,
  sessionFile: string,
): Promise<LifecycleEnrichment | undefined> {
  try {
    if (
      typeof asyncDir !== "string" ||
      asyncDir.length === 0 ||
      Buffer.byteLength(asyncDir) > MAX_ASYNC_DIR_BYTES ||
      asyncDir.includes("\0") ||
      !isAbsolute(asyncDir) ||
      normalize(asyncDir) !== asyncDir ||
      sessionFile.length === 0
    )
      return undefined;

    // realpath plus lstat of every component rejects symlinks in the directory
    // reference, not just a symlinked final status.json.
    if ((await realpath(asyncDir)) !== asyncDir) return undefined;
    const { root } = parse(asyncDir);
    let component = root;
    for (const part of asyncDir.slice(root.length).split(sep).filter(Boolean)) {
      component = normalize(
        `${component}${component.endsWith(sep) ? "" : sep}${part}`,
      );
      const info = await lstat(component);
      if (info.isSymbolicLink() || !info.isDirectory()) return undefined;
    }

    const statusPath = `${asyncDir}${asyncDir.endsWith(sep) ? "" : sep}status.json`;
    const info = await lstat(statusPath);
    if (
      info.isSymbolicLink() ||
      !info.isFile() ||
      !Number.isSafeInteger(info.size) ||
      info.size < 0 ||
      info.size > MAX_STATUS_BYTES
    ) {
      return undefined;
    }
    const handle = await open(
      statusPath,
      constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | O_NOFOLLOW,
    );
    try {
      const opened = await handle.stat();
      if (
        !opened.isFile() ||
        opened.size !== info.size ||
        !Number.isSafeInteger(opened.size) ||
        opened.size < 0 ||
        opened.size > MAX_STATUS_BYTES
      ) {
        return undefined;
      }
      const buffer = Buffer.alloc(opened.size);
      const { bytesRead } = await handle.read(buffer, 0, opened.size, 0);
      if (
        bytesRead !== opened.size ||
        (await handle.stat()).size !== opened.size
      ) {
        return undefined;
      }

      const value: unknown = JSON.parse(buffer.toString("utf8"));
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
      }
      const status = value as Record<string, unknown>;
      if (
        status.lifecycleArtifactVersion !== 3 ||
        status.mode !== "single" ||
        status.runId !== runId ||
        status.sessionId !== sessionFile ||
        !Array.isArray(status.steps) ||
        status.steps.length !== 1
      )
        return undefined;
      const step = status.steps[0];
      if (step === null || typeof step !== "object" || Array.isArray(step)) {
        return undefined;
      }
      const record = step as Record<string, unknown>;
      const stepStatus = record.status;
      if (typeof stepStatus !== "string" || !STEP_STATUSES.has(stepStatus)) {
        return undefined;
      }
      const toolCount = record.toolCount;
      if (
        Object.hasOwn(record, "toolCount") &&
        (typeof toolCount !== "number" ||
          !Number.isSafeInteger(toolCount) ||
          toolCount < 0 ||
          toolCount > MAX_AGENT_RUN_TOOL_CALLS)
      ) {
        return undefined;
      }
      const model =
        stepStatus === "complete"
          ? boundedProducerLabel(record.model)
          : undefined;
      if (
        stepStatus === "complete" &&
        Object.hasOwn(record, "model") &&
        model === undefined
      ) {
        return undefined;
      }
      const agent = boundedProducerLabel(record.agent);
      const thinking = boundedProducerLabel(record.thinking);
      const durationMs = record.durationMs;
      const usage = readLifecycleUsage(record);
      const outcome = readLifecycleOutcome(record);
      return {
        ...(agent === undefined ? {} : { agent }),
        ...(model === undefined ? {} : { model }),
        ...(thinking === undefined ? {} : { thinking }),
        ...(outcome === undefined ? {} : { status: outcome }),
        ...(usage === undefined ? {} : { usage }),
        ...(typeof durationMs === "number" &&
        Number.isSafeInteger(durationMs) &&
        durationMs >= 0 &&
        durationMs <= MAX_DURATION_MS
          ? { durationMs }
          : {}),
        ...(typeof toolCount === "number" ? { toolCalls: toolCount } : {}),
      };
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
}

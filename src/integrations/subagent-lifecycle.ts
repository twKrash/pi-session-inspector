import { Buffer } from "node:buffer";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, normalize, parse, sep } from "node:path";

import { MAX_AGENT_RUN_TOOL_CALLS } from "../core/events.ts";
import { boundedProducerLabel } from "../core/evidence.ts";

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

/** Returns only approved bounded step fields; every failure is no enrichment. */
export async function readReferencedLifecycleEnrichment(
  asyncDir: unknown,
  runId: string,
  sessionFile: string,
): Promise<{ model?: string; toolCalls?: number } | undefined> {
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
      return {
        ...(typeof toolCount === "number" ? { toolCalls: toolCount } : {}),
        ...(model === undefined ? {} : { model }),
      };
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
}

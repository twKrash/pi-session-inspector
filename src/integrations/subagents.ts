import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import type { AgentRun, EvidenceState, Usage } from "../core/events.ts";

const SUPPORTED_ARTIFACT_VERSION = 1;
const MAX_ARTIFACT_BYTES = 128 * 1024;
const MAX_RUNS = 256;
const MAX_ID_LENGTH = 128;
const MAX_TOTAL_TOKENS = 1_000_000_000;
const MAX_COST = 1_000_000_000;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export type SubagentRunsResult = {
  state: EvidenceState;
  runs: readonly AgentRun[];
};

/** Reads one bounded public artifact without retaining its path or raw text. */
export async function readPublicSubagentArtifact(
  path: string | undefined,
): Promise<unknown | undefined> {
  if (!path) return undefined;

  try {
    const file = await open(path, "r");
    try {
      const initial = await file.stat();
      if (!initial.isFile() || initial.size > MAX_ARTIFACT_BYTES) {
        return undefined;
      }

      const buffer = Buffer.allocUnsafe(MAX_ARTIFACT_BYTES + 1);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      const final = await file.stat();
      if (
        bytesRead > MAX_ARTIFACT_BYTES ||
        final.size !== bytesRead ||
        final.size > MAX_ARTIFACT_BYTES
      ) {
        return undefined;
      }
      return JSON.parse(buffer.toString("utf8", 0, bytesRead));
    } finally {
      await file.close().catch(() => {});
    }
  } catch {
    return undefined;
  }
}

/**
 * Reads the allowlisted, public pi-subagents artifact projection. Parentage is
 * retained only when the artifact names it explicitly; child usage is solely a
 * cooperative breakdown and is never combined with Pi-native parent usage.
 */
export function readSubagentRuns(input: unknown): SubagentRunsResult {
  try {
    if (input === undefined || input === null) return unavailable();

    const artifact = snapshotRecord(input);
    if (artifact === undefined || !hasOnlyKeys(artifact, ["version", "runs"])) {
      return unsupported();
    }
    if (
      artifact.version !== SUPPORTED_ARTIFACT_VERSION ||
      !Array.isArray(artifact.runs) ||
      artifact.runs.length > MAX_RUNS
    ) {
      return unsupported();
    }

    const runs: AgentRun[] = [];
    for (const value of artifact.runs) {
      const run = readRun(value);
      if (run === undefined) return unsupported();
      runs.push(run);
    }
    return { state: "supported", runs };
  } catch {
    return unsupported();
  }
}

function readRun(value: unknown): AgentRun | undefined {
  const record = snapshotRecord(value);
  if (
    record === undefined ||
    !hasOnlyKeys(record, ["id", "parentId", "status", "usage"]) ||
    !isId(record.id) ||
    !isId(record.parentId) ||
    typeof record.status !== "string"
  ) {
    return undefined;
  }

  const usage =
    record.usage === undefined ? undefined : readUsage(record.usage);
  return {
    id: opaqueSubagentId(record.id),
    parentId: opaqueSubagentId(record.parentId),
    status: mapStatus(record.status),
    confidence: "cooperative",
    ...(usage === undefined ? {} : { usage }),
  };
}

function readUsage(value: unknown): Usage | undefined {
  const usage = snapshotRecord(value);
  if (
    usage === undefined ||
    !hasOnlyKeys(usage, ["totalTokens", "cost"]) ||
    !isTotalTokens(usage.totalTokens) ||
    !isCost(usage.cost)
  ) {
    return undefined;
  }
  return { totalTokens: usage.totalTokens, cost: usage.cost };
}

function mapStatus(value: string): AgentRun["status"] {
  switch (value) {
    case "queued":
    case "running":
      return "running";
    case "complete":
      return "succeeded";
    case "failed":
    case "rejected":
      return "failed";
    case "stopped":
      return "interrupted";
    default:
      return "unknown";
  }
}

function isId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    ID.test(value)
  );
}

/**
 * Artifact identifiers are producer-controlled metadata. Hash them before they
 * leave this adapter so reports retain explicit parentage without copying IDs.
 */
function opaqueSubagentId(id: string): string {
  return `subagent-${createHash("sha256")
    .update("pi-session-inspector:subagent-artifact-id:v1\0")
    .update(id)
    .digest("hex")}`;
}

function isTotalTokens(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_TOTAL_TOKENS
  );
}

function isCost(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_COST
  );
}

function hasOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => allowed.includes(key));
}

function snapshotRecord(
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const snapshot: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") return undefined;
    const descriptor = descriptors[key];
    if (descriptor?.enumerable !== true || !("value" in descriptor)) {
      return undefined;
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

function unavailable(): SubagentRunsResult {
  return { state: "unavailable", runs: [] };
}

function unsupported(): SubagentRunsResult {
  return { state: "unsupported", runs: [] };
}

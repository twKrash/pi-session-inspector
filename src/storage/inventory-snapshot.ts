import { randomUUID } from "node:crypto";
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  inventoryHash,
  sanitizeSourceLabel,
  type CommandRow,
  type InventorySnapshot,
  type ResourceSourceRow,
  type SkillRow,
} from "../integrations/inventory.ts";
import { boundedDescription } from "../core/redact.ts";

/**
 * Persists the bounded, sanitized inventory snapshot beside a session's
 * derived state. Content is deterministic (canonical field order, hash-stable)
 * and the file is user-only where the platform supports it. Malformed, stale,
 * over-cap, or oversize input degrades to `undefined`, never a throw.
 */

const FILE_NAME = "inventory.json";
const MAX_BYTES = 64 * 1024;
const MAX_COMMANDS = 256;
const MAX_SKILLS = 128;
const MAX_RESOURCES = 64;
const MAX_NAME_BYTES = 64;
const MAX_DESCRIPTION_BYTES = 120;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

type Scope = "user" | "project" | "temporary";
type Origin = "package" | "top-level";
type Source = "extension" | "prompt" | "skill";

/** Reads and re-validates a persisted snapshot; any failure is `undefined`. */
export async function readInventorySnapshot(
  directory: string,
): Promise<InventorySnapshot | undefined> {
  try {
    const path = join(directory, FILE_NAME);
    // Refuse an oversized or non-regular file before loading it into memory.
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_BYTES) return undefined;
    const text = await readFile(path, "utf8");
    if (Buffer.byteLength(text, "utf8") > MAX_BYTES) return undefined;
    return parseInventorySnapshot(JSON.parse(text));
  } catch {
    return undefined;
  }
}

const EMPTY_SNAPSHOT: InventorySnapshot = {
  schemaVersion: 1,
  commands: [],
  skills: [],
  resources: [],
  toolSources: Object.create(null),
};

function serializedBytes(snapshot: InventorySnapshot): number {
  return Buffer.byteLength(JSON.stringify(snapshot), "utf8");
}

/**
 * Deterministically reduces a snapshot until it serializes within
 * `readInventorySnapshot`'s byte bound, so the write path can never publish a
 * file the reader would reject. Optional descriptions (the largest per-row
 * cost) are dropped first; then trailing rows are dropped in a fixed order
 * (commands, skills, resources, tool-source entries) until it fits. The result
 * is idempotent: bounding an already-bounded snapshot returns it unchanged.
 */
export function boundInventorySnapshot(
  snapshot: InventorySnapshot,
): InventorySnapshot {
  const capped = parseInventorySnapshot({
    schemaVersion: 1,
    commands: Array.isArray(snapshot.commands)
      ? snapshot.commands.slice(0, MAX_COMMANDS)
      : [],
    skills: Array.isArray(snapshot.skills)
      ? snapshot.skills.slice(0, MAX_SKILLS)
      : [],
    resources: Array.isArray(snapshot.resources)
      ? snapshot.resources.slice(0, MAX_RESOURCES)
      : [],
    toolSources: snapshot.toolSources,
  });
  const normalized = capped ?? EMPTY_SNAPSHOT;
  if (serializedBytes(normalized) <= MAX_BYTES) return normalized;

  const withoutDescriptions: InventorySnapshot = {
    schemaVersion: 1,
    commands: normalized.commands.map((row) => ({
      name: row.name,
      source: row.source,
      sourceLabel: row.sourceLabel,
      scope: row.scope,
      origin: row.origin,
    })),
    skills: normalized.skills.map((row) => ({
      name: row.name,
      ...(row.sourceLabel === undefined
        ? {}
        : { sourceLabel: row.sourceLabel }),
      ...(row.scope === undefined ? {} : { scope: row.scope }),
      ...(row.origin === undefined ? {} : { origin: row.origin }),
    })),
    resources: normalized.resources,
    toolSources: normalized.toolSources,
  };
  if (serializedBytes(withoutDescriptions) <= MAX_BYTES)
    return withoutDescriptions;

  const commands = [...withoutDescriptions.commands];
  const skills = [...withoutDescriptions.skills];
  const resources = [...withoutDescriptions.resources];
  const toolSources: Record<string, string> = Object.assign(
    Object.create(null),
    withoutDescriptions.toolSources,
  );
  let candidate: InventorySnapshot = {
    schemaVersion: 1,
    commands,
    skills,
    resources,
    toolSources,
  };
  while (serializedBytes(candidate) > MAX_BYTES) {
    if (commands.length > 0) commands.pop();
    else if (skills.length > 0) skills.pop();
    else if (resources.length > 0) resources.pop();
    else {
      const keys = Object.keys(toolSources);
      const last = keys[keys.length - 1];
      if (last === undefined) break;
      delete toolSources[last];
    }
    candidate = {
      schemaVersion: 1,
      commands,
      skills,
      resources,
      toolSources,
    };
  }
  return candidate;
}

/**
 * Atomically publishes a validated snapshot: a mode `0o600` temp file is
 * renamed over `inventory.json`. Never throws and never writes Pi session data.
 */
export async function writeInventorySnapshot(
  directory: string,
  snapshot: InventorySnapshot,
): Promise<boolean> {
  const bounded = boundInventorySnapshot(snapshot);
  const temporaryPath = join(directory, `.${FILE_NAME}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, JSON.stringify(bounded), {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, join(directory, FILE_NAME));
    return true;
  } catch {
    return false;
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

/**
 * Refreshes the snapshot only when its content hash changed, so an unchanged
 * inventory never rewrites the file (no mtime churn, no needless IO).
 */
export async function refreshInventorySnapshot({
  directory,
  snapshot,
}: {
  directory: string;
  snapshot: InventorySnapshot;
}): Promise<void> {
  try {
    // Compare the bounded form so a trimmed candidate still short-circuits.
    const candidate = boundInventorySnapshot(snapshot);
    const existing = await readInventorySnapshot(directory);
    if (
      existing !== undefined &&
      inventoryHash(existing) === inventoryHash(candidate)
    )
      return;
    await writeInventorySnapshot(directory, candidate);
  } catch {
    // Snapshot maintenance is observer-only and must never alter Pi.
  }
}

/**
 * Re-validates a decoded snapshot. `schemaVersion` must be `1`, every name
 * must match the bounded grammar, labels are re-sanitized, unknown fields are
 * dropped, and over-cap or structurally invalid input is rejected outright.
 */
export function parseInventorySnapshot(
  value: unknown,
): InventorySnapshot | undefined {
  try {
    const record = asRecord(value);
    if (record === undefined || record.schemaVersion !== 1) return undefined;
    if (
      !Array.isArray(record.commands) ||
      !Array.isArray(record.skills) ||
      !Array.isArray(record.resources) ||
      record.commands.length > MAX_COMMANDS ||
      record.skills.length > MAX_SKILLS ||
      record.resources.length > MAX_RESOURCES
    )
      return undefined;
    const toolSources = parseToolSources(record.toolSources);
    const commands = parseCommands(record.commands);
    const skills = parseSkills(record.skills);
    const resources = parseResources(record.resources);
    if (
      toolSources === undefined ||
      commands === undefined ||
      skills === undefined ||
      resources === undefined
    )
      return undefined;
    return { schemaVersion: 1, commands, skills, resources, toolSources };
  } catch {
    return undefined;
  }
}

function parseCommands(
  value: readonly unknown[],
): readonly CommandRow[] | undefined {
  const rows: CommandRow[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (record === undefined) return undefined;
    const name = record.name;
    if (typeof name !== "string" || !isBoundedName(name)) return undefined;
    const source = readSource(record.source);
    if (source === undefined) return undefined;
    const scope = readScope(record.scope);
    const origin = readOrigin(record.origin);
    if (scope === undefined || origin === undefined) return undefined;
    const description = boundedDescription(
      record.description,
      MAX_DESCRIPTION_BYTES,
    );
    rows.push({
      name,
      source,
      sourceLabel: sanitizeSourceLabel(record.sourceLabel),
      scope,
      origin,
      ...(description === undefined ? {} : { description }),
    });
  }
  return rows;
}

function parseSkills(
  value: readonly unknown[],
): readonly SkillRow[] | undefined {
  const rows: SkillRow[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (record === undefined) return undefined;
    const name = record.name;
    if (typeof name !== "string" || !isBoundedName(name)) return undefined;
    const sourceLabel =
      record.sourceLabel === undefined
        ? undefined
        : sanitizeSourceLabel(record.sourceLabel);
    const scope =
      record.scope === undefined ? undefined : readScope(record.scope);
    const origin =
      record.origin === undefined ? undefined : readOrigin(record.origin);
    if (
      (record.scope !== undefined && scope === undefined) ||
      (record.origin !== undefined && origin === undefined)
    )
      return undefined;
    const description = boundedDescription(
      record.description,
      MAX_DESCRIPTION_BYTES,
    );
    rows.push({
      name,
      ...(sourceLabel === undefined ? {} : { sourceLabel }),
      ...(scope === undefined ? {} : { scope }),
      ...(origin === undefined ? {} : { origin }),
      ...(description === undefined ? {} : { description }),
    });
  }
  return rows;
}

function parseResources(
  value: readonly unknown[],
): readonly ResourceSourceRow[] | undefined {
  const rows: ResourceSourceRow[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (record === undefined) return undefined;
    const scope = readScope(record.scope);
    const origin = readOrigin(record.origin);
    if (scope === undefined || origin === undefined) return undefined;
    const commands = readCount(record.commands);
    const skills = readCount(record.skills);
    const prompts = readCount(record.prompts);
    const tools = readCount(record.tools);
    if (
      commands === undefined ||
      skills === undefined ||
      prompts === undefined ||
      tools === undefined
    )
      return undefined;
    rows.push({
      sourceLabel: sanitizeSourceLabel(record.sourceLabel),
      scope,
      origin,
      commands,
      skills,
      prompts,
      tools,
    });
  }
  return rows;
}

function parseToolSources(
  value: unknown,
): Readonly<Record<string, string>> | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  // Null prototype so inherited `Object.prototype` members are never sources.
  const sources: Record<string, string> = Object.create(null);
  for (const [name, label] of Object.entries(record)) {
    if (!isBoundedName(name)) return undefined;
    sources[name] = sanitizeSourceLabel(label);
  }
  return sources;
}

function readSource(value: unknown): Source | undefined {
  return value === "extension" || value === "prompt" || value === "skill"
    ? value
    : undefined;
}

function readScope(value: unknown): Scope | undefined {
  return value === "user" || value === "project" || value === "temporary"
    ? value
    : undefined;
}

function readOrigin(value: unknown): Origin | undefined {
  return value === "package" || value === "top-level" ? value : undefined;
}

function readCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function isBoundedName(value: string): boolean {
  return (
    value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= MAX_NAME_BYTES &&
    NAME.test(value)
  );
}

function asRecord(
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Readonly<Record<string, unknown>>;
}

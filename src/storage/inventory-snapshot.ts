import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  inventoryHash,
  sanitizeSourceLabel,
  type CommandRow,
  type InventorySnapshot,
  type ResourceSourceRow,
  type SkillRow,
} from "../integrations/inventory.ts";

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
// Mirrors the bounded redaction applied when the snapshot is first read, so a
// tampered or foreign `inventory.json` cannot smuggle a path or secret in.
const SECRET_LIKE =
  /(?:secret|password|passwd|api[-_ ]?key|auth(?:orization)?|bearer|token)|\bsk-[A-Za-z0-9_-]{6,}/i;
const PATH_LIKE =
  /(?:^|[^A-Za-z0-9])(?:[/\\]|file:\/\/)|[A-Za-z]:[\\/]|(?:^|\s)~\//;

type Scope = "user" | "project" | "temporary";
type Origin = "package" | "top-level";
type Source = "extension" | "prompt" | "skill";

/** Reads and re-validates a persisted snapshot; any failure is `undefined`. */
export async function readInventorySnapshot(
  directory: string,
): Promise<InventorySnapshot | undefined> {
  try {
    const text = await readFile(join(directory, FILE_NAME), "utf8");
    if (Buffer.byteLength(text, "utf8") > MAX_BYTES) return undefined;
    return parseInventorySnapshot(JSON.parse(text));
  } catch {
    return undefined;
  }
}

/**
 * Atomically publishes a validated snapshot: a mode `0o600` temp file is
 * renamed over `inventory.json`. Never throws and never writes Pi session data.
 */
export async function writeInventorySnapshot(
  directory: string,
  snapshot: InventorySnapshot,
): Promise<boolean> {
  const temporaryPath = join(directory, `.${FILE_NAME}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, JSON.stringify(snapshot), {
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
    const existing = await readInventorySnapshot(directory);
    if (
      existing !== undefined &&
      inventoryHash(existing) === inventoryHash(snapshot)
    )
      return;
    await writeInventorySnapshot(directory, snapshot);
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

function parseCommands(value: readonly unknown[]): readonly CommandRow[] | undefined {
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
    const description = boundedDescription(record.description);
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

function parseSkills(value: readonly unknown[]): readonly SkillRow[] | undefined {
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
    const description = boundedDescription(record.description);
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
  const entries: [string, string][] = [];
  for (const [name, label] of Object.entries(record)) {
    if (!isBoundedName(name)) return undefined;
    entries.push([name, sanitizeSourceLabel(label)]);
  }
  return Object.fromEntries(entries);
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

/**
 * Re-applies the structural bounds and redaction used when a snapshot is first
 * read. An invalid optional description is dropped rather than invalidating the
 * whole snapshot.
 */
function boundedDescription(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    out += code < 0x20 || (code >= 0x7f && code <= 0x9f) ? " " : char;
  }
  const trimmed = out.trim();
  if (trimmed.length === 0) return undefined;
  if (Buffer.byteLength(trimmed, "utf8") > MAX_DESCRIPTION_BYTES)
    return undefined;
  if (SECRET_LIKE.test(trimmed) || PATH_LIKE.test(trimmed)) return undefined;
  return trimmed;
}

function asRecord(
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Readonly<Record<string, unknown>>;
}

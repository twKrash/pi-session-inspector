import { createHash } from "node:crypto";

/**
 * Sanitized inventory of loaded/available commands, skills, tool sources, and
 * resource-source groups. Counts mean "loaded/available", never activity,
 * invocation, usage, effectiveness, or installation status. Producer paths,
 * tool `description`/`parameters`/`promptGuidelines`, and skill bodies never
 * reach this snapshot.
 */

export type CommandRow = {
  name: string;
  source: "extension" | "prompt" | "skill";
  sourceLabel: string;
  scope: "user" | "project" | "temporary";
  origin: "package" | "top-level";
  description?: string;
};

export type SkillRow = {
  name: string;
  sourceLabel?: string;
  scope?: "user" | "project" | "temporary";
  origin?: "package" | "top-level";
  description?: string;
  explicitInvocations?: number;
};

export type ResourceSourceRow = {
  sourceLabel: string;
  scope: "user" | "project" | "temporary";
  origin: "package" | "top-level";
  commands: number;
  skills: number;
  prompts: number;
  tools: number;
};

export type InventorySnapshot = {
  schemaVersion: 1;
  commands: readonly CommandRow[];
  skills: readonly SkillRow[];
  resources: readonly ResourceSourceRow[];
  toolSources: Readonly<Record<string, string>>;
};

const MAX_COMMANDS = 256;
const MAX_SKILLS = 128;
const MAX_RESOURCES = 64;
const MAX_NAME_BYTES = 64;
const MAX_DESCRIPTION_BYTES = 120;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const NPM =
  /^npm:((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)(?:@[^@\s]+)?$/;
const PASSTHROUGH = new Set(["local", "auto", "builtin", "sdk"]);
const SOURCES = new Set(["extension", "prompt", "skill"]);
const SKILL_PREFIX = "skill:";

type Scope = "user" | "project" | "temporary";
type Origin = "package" | "top-level";
type CountField = "commands" | "skills" | "prompts" | "tools";

type ToolRow = {
  name: string;
  sourceLabel: string;
  scope: Scope;
  origin: Origin;
};

/** Normalizes a producer source value to a bounded, non-identifying label. */
export function sanitizeSourceLabel(value: unknown): string {
  if (typeof value !== "string") return "other";
  if (PASSTHROUGH.has(value)) return value;
  const npm = NPM.exec(value);
  if (npm !== null && npm[1] !== undefined) return `npm:${npm[1]}`;
  return "other";
}

/** Stable content hash over the canonical snapshot JSON. */
export function inventoryHash(snapshot: InventorySnapshot): string {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

/**
 * Reads the sanitized inventory from `pi.getCommands()` and `pi.getAllTools()`.
 * Pure and observer-only: malformed input is dropped, never thrown.
 */
export function readInventory(
  commands: readonly unknown[],
  tools: readonly unknown[],
): InventorySnapshot {
  try {
    const commandRows = sanitizeCommands(
      Array.isArray(commands) ? commands : [],
    );
    const toolRows = sanitizeTools(Array.isArray(tools) ? tools : []);

    return {
      schemaVersion: 1,
      // `commands` is every invokable row (extension, prompt, and skill);
      // `skills` is the `source === "skill"` subset of the same list.
      commands: commandRows.slice(0, MAX_COMMANDS),
      skills: commandRows
        .filter((row) => row.source === "skill")
        .map(toSkillRow)
        .slice(0, MAX_SKILLS),
      resources: groupResources(commandRows, toolRows),
      toolSources: Object.fromEntries(
        toolRows.map((row) => [row.name, row.sourceLabel]),
      ),
    };
  } catch {
    return emptySnapshot();
  }
}

function sanitizeCommands(input: readonly unknown[]): readonly CommandRow[] {
  const rows: CommandRow[] = [];
  const seen = new Set<string>();
  const limit = MAX_COMMANDS + MAX_SKILLS;

  for (const value of input) {
    if (rows.length >= limit) break;
    const record = asRecord(value);
    if (record === undefined) continue;

    const source = readSource(record.source);
    if (source === undefined) continue;
    if (typeof record.name !== "string") continue;

    const name = normalizeCommandName(record.name, source);
    if (name === undefined) continue;

    const key = `${source}\u0000${name}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const sourceInfo = asRecord(record.sourceInfo);
    const scope = readScope(sourceInfo?.scope);
    const origin = readOrigin(sourceInfo?.origin);
    const description = boundedDescription(record.description);

    rows.push({
      name,
      source,
      sourceLabel: sanitizeSourceLabel(sourceInfo?.source),
      scope,
      origin,
      ...(description === undefined ? {} : { description }),
    });
  }
  return rows;
}

/**
 * Reads only `name` and `sourceInfo` from `pi.getAllTools()`. Tool
 * `description`, `parameters`, and `promptGuidelines` are never read.
 */
function sanitizeTools(input: readonly unknown[]): readonly ToolRow[] {
  const rows: ToolRow[] = [];
  const seen = new Set<string>();

  for (const value of input) {
    const record = asRecord(value);
    if (record === undefined) continue;
    if (typeof record.name !== "string") continue;
    if (!isBoundedName(record.name)) continue;
    if (seen.has(record.name)) continue;
    seen.add(record.name);

    const sourceInfo = asRecord(record.sourceInfo);
    rows.push({
      name: record.name,
      sourceLabel: sanitizeSourceLabel(sourceInfo?.source),
      scope: readScope(sourceInfo?.scope),
      origin: readOrigin(sourceInfo?.origin),
    });
  }
  return rows;
}

function groupResources(
  commandRows: readonly CommandRow[],
  toolRows: readonly ToolRow[],
): readonly ResourceSourceRow[] {
  const groups = new Map<string, ResourceSourceRow>();

  const bump = (
    sourceLabel: string,
    scope: Scope,
    origin: Origin,
    field: CountField,
  ): void => {
    const key = `${sourceLabel}\u0000${scope}\u0000${origin}`;
    let row = groups.get(key);
    if (row === undefined) {
      row = {
        sourceLabel,
        scope,
        origin,
        commands: 0,
        skills: 0,
        prompts: 0,
        tools: 0,
      };
      groups.set(key, row);
    }
    row[field] += 1;
  };

  for (const row of commandRows) {
    if (row.source === "extension")
      bump(row.sourceLabel, row.scope, row.origin, "commands");
    else if (row.source === "skill")
      bump(row.sourceLabel, row.scope, row.origin, "skills");
    else bump(row.sourceLabel, row.scope, row.origin, "prompts");
  }
  for (const row of toolRows) {
    bump(row.sourceLabel, row.scope, row.origin, "tools");
  }

  return [...groups.values()]
    .filter((row) => row.commands + row.skills + row.prompts + row.tools > 0)
    .sort(
      (a, b) =>
        compare(a.sourceLabel, b.sourceLabel) ||
        compare(a.scope, b.scope) ||
        compare(a.origin, b.origin),
    )
    .slice(0, MAX_RESOURCES);
}

function toSkillRow(row: CommandRow): SkillRow {
  return {
    name: row.name,
    sourceLabel: row.sourceLabel,
    scope: row.scope,
    origin: row.origin,
    ...(row.description === undefined ? {} : { description: row.description }),
  };
}

function normalizeCommandName(
  raw: string,
  source: "extension" | "prompt" | "skill",
): string | undefined {
  const candidate =
    source === "skill" && raw.startsWith(SKILL_PREFIX)
      ? raw.slice(SKILL_PREFIX.length)
      : raw;
  return isBoundedName(candidate) ? candidate : undefined;
}

function isBoundedName(value: string): boolean {
  return (
    value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= MAX_NAME_BYTES &&
    NAME.test(value)
  );
}

function readSource(
  value: unknown,
): "extension" | "prompt" | "skill" | undefined {
  return typeof value === "string" && SOURCES.has(value)
    ? (value as "extension" | "prompt" | "skill")
    : undefined;
}

function readScope(value: unknown): Scope {
  return value === "user" || value === "project" || value === "temporary"
    ? value
    : "temporary";
}

function readOrigin(value: unknown): Origin {
  return value === "package" || value === "top-level" ? value : "top-level";
}

// TEMPORARY: a local bounded-text helper. Task 12 replaces this with the shared
// `src/core/redact.ts` redaction. Kept here so Task 7 stays self-contained.
const SECRET_LIKE =
  /(?:secret|password|passwd|api[-_ ]?key|auth(?:orization)?|bearer|token)|\bsk-[A-Za-z0-9_-]{6,}/i;
const PATH_LIKE =
  /(?:^|[^A-Za-z0-9])(?:[/\\]|file:\/\/)|[A-Za-z]:[\\/]|(?:^|\s)~\//;

function boundedDescription(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  // Control-character stripping collapses newlines, so the result is single-line.
  const stripped = stripControlCharacters(value).trim();
  if (stripped.length === 0) return undefined;
  if (Buffer.byteLength(stripped, "utf8") > MAX_DESCRIPTION_BYTES)
    return undefined;
  if (SECRET_LIKE.test(stripped)) return undefined;
  if (PATH_LIKE.test(stripped)) return undefined;
  return stripped;
}

function stripControlCharacters(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    out += code < 0x20 || (code >= 0x7f && code <= 0x9f) ? " " : char;
  }
  return out;
}

function asRecord(
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Readonly<Record<string, unknown>>;
}

function compare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function emptySnapshot(): InventorySnapshot {
  return {
    schemaVersion: 1,
    commands: [],
    skills: [],
    resources: [],
    toolSources: {},
  };
}

import { open, lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { isBoundedToken } from "../core/evidence.ts";

/**
 * Bounded diagnostic emitted for every parent-session resolution failure.
 * Callers own visibility (evidence health); no path text, filesystem error, or
 * candidate id ever accompanies it.
 */
const PARENT_SESSION_UNAVAILABLE = "parent-session-unavailable" as const;

export type ParentSessionDiagnostic = typeof PARENT_SESSION_UNAVAILABLE;

export type ParentSessionResolution =
  | { state: "known"; id: string }
  | { state: "unavailable" };

/** Test seam: returns the first non-empty header line, or `undefined`. */
export type ParentSessionHeaderReader = (
  candidatePath: string,
) => Promise<string | undefined>;

export type ResolveParentSessionOptions = {
  parentPath: string;
  sessionRoot: string;
  childSessionId?: string;
  readHeader?: ParentSessionHeaderReader;
  diagnostics?: Set<ParentSessionDiagnostic>;
};

const MAX_PATH_BYTES = 4_096;
const MAX_HEADER_BYTES = 16 * 1_024;
const MAX_SESSION_ID_BYTES = 128;
const encoder = new TextEncoder();

/**
 * Resolves a raw Pi `parentSession` path to a validated parent session id,
 * confined to an approved session root. Observer-only: every failure is
 * swallowed into `{ state: "unavailable" }` and no path, filesystem error, or
 * unvalidated candidate id escapes. Parent identity is never inferred from a
 * basename, directory name, or path shape.
 */
export async function resolveParentSession({
  parentPath,
  sessionRoot,
  childSessionId,
  readHeader,
  diagnostics,
}: ResolveParentSessionOptions): Promise<ParentSessionResolution> {
  try {
    const resolved = await resolveCandidate({
      parentPath,
      sessionRoot,
      childSessionId,
      readHeader,
    });
    if (resolved.state === "unavailable") {
      diagnostics?.add(PARENT_SESSION_UNAVAILABLE);
    }
    return resolved;
  } catch {
    diagnostics?.add(PARENT_SESSION_UNAVAILABLE);
    return { state: "unavailable" };
  }
}

async function resolveCandidate({
  parentPath,
  sessionRoot,
  childSessionId,
  readHeader,
}: ResolveParentSessionOptions): Promise<ParentSessionResolution> {
  if (typeof parentPath !== "string" || typeof sessionRoot !== "string") {
    return { state: "unavailable" };
  }
  if (
    parentPath.length === 0 ||
    parentPath.includes("\0") ||
    encoder.encode(parentPath).byteLength > MAX_PATH_BYTES
  ) {
    return { state: "unavailable" };
  }
  if (sessionRoot.length === 0 || sessionRoot.includes("\0")) {
    return { state: "unavailable" };
  }

  // Containment is judged twice, each time within one form. The lexical root
  // and the lexical candidate answer every `..`/absolute question; the approved
  // (canonical) root and the canonical candidate answer the link question. A
  // canonical root mixed with a lexical candidate would reject a parent that is
  // genuinely inside the root wherever the root itself has a link component,
  // which is what macOS presents for `/var` under `/private/var`.
  const lexicalRoot = resolve(sessionRoot);
  const candidate = resolve(parentPath);
  const lexical = relative(lexicalRoot, candidate);
  if (!isContained(lexical)) return { state: "unavailable" };

  // lstat every component beneath the root; reject symbolic links at any depth
  // and require the final target to be a regular file.
  let current = lexicalRoot;
  let finalInfo: Awaited<ReturnType<typeof lstat>> | undefined;
  const components = lexical.split(sep);
  for (const [index, component] of components.entries()) {
    if (component === "") return { state: "unavailable" };
    current = join(current, component);
    const info = await lstat(current);
    if (info.isSymbolicLink()) return { state: "unavailable" };
    const isFinal = index === components.length - 1;
    if (isFinal) {
      if (!info.isFile()) return { state: "unavailable" };
      finalInfo = info;
    } else if (!info.isDirectory()) {
      return { state: "unavailable" };
    }
  }
  if (finalInfo === undefined) return { state: "unavailable" };

  // realpath re-containment defends against a lexical path that traverses a
  // link the component walk did not observe (or a race with replacement). Both
  // sides are canonical here, so the comparison is between like and like.
  const approvedRoot = await realpath(sessionRoot);
  const realCandidate = await realpath(current);
  if (!isContained(relative(approvedRoot, realCandidate))) {
    return { state: "unavailable" };
  }

  const line = readHeader
    ? await readHeader(current)
    : await readBoundedHeader(current, finalInfo);
  if (line === undefined) return { state: "unavailable" };

  return validateHeader(line, childSessionId);
}

function isContained(relativePath: string): boolean {
  return (
    relativePath.length > 0 &&
    relativePath !== "." &&
    !relativePath.startsWith("..") &&
    !isAbsolute(relativePath)
  );
}

async function readBoundedHeader(
  candidatePath: string,
  checkedInfo: Awaited<ReturnType<typeof lstat>>,
): Promise<string | undefined> {
  const handle = await open(candidatePath, "r");
  try {
    const openedInfo = await handle.stat();
    if (!openedInfo.isFile()) return undefined;
    // Reduce replacement races where platform identity fields are available.
    if (
      checkedInfo.dev !== 0 &&
      checkedInfo.ino !== 0 &&
      (openedInfo.dev !== checkedInfo.dev || openedInfo.ino !== checkedInfo.ino)
    ) {
      return undefined;
    }
    return await readFirstHeaderLine(handle);
  } finally {
    await handle.close();
  }
}

async function readFirstHeaderLine(
  handle: Awaited<ReturnType<typeof open>>,
): Promise<string | undefined> {
  const buffer = Buffer.alloc(MAX_HEADER_BYTES);
  let total = 0;
  while (total < MAX_HEADER_BYTES) {
    const { bytesRead } = await handle.read(
      buffer,
      total,
      MAX_HEADER_BYTES - total,
      total,
    );
    if (bytesRead <= 0) break;
    total += bytesRead;
    if (buffer.subarray(0, total).includes(0x0a)) break;
  }
  const text = buffer.subarray(0, total).toString("utf8");
  const atBound = total >= MAX_HEADER_BYTES && !text.includes("\n");
  if (atBound) return undefined;
  const line = text
    .split("\n")
    .find((candidate) => candidate.trim().length > 0);
  return line?.trim();
}

function validateHeader(
  line: string,
  childSessionId: string | undefined,
): ParentSessionResolution {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { state: "unavailable" };
  }
  if (typeof value !== "object" || value === null) {
    return { state: "unavailable" };
  }
  const header = value as Record<string, unknown>;
  if (header.type !== "session" || header.version !== 3) {
    return { state: "unavailable" };
  }
  if (!isBoundedToken(header.id, MAX_SESSION_ID_BYTES)) {
    return { state: "unavailable" };
  }
  if (childSessionId !== undefined && header.id === childSessionId) {
    return { state: "unavailable" };
  }
  return { state: "known", id: header.id };
}

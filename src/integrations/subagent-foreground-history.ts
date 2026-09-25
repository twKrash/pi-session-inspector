import { Buffer } from "node:buffer";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { homedir, tmpdir, userInfo } from "node:os";
import { isAbsolute, join, normalize, parse, resolve, sep } from "node:path";

const MAX_HISTORY_BYTES = 8 * 1024 * 1024;
const MAX_HISTORY_PATH_BYTES = 4096;
const MAX_RUNS = 50;
const MAX_CHILDREN = 256;
const MAX_ID_BYTES = 256;
const MAX_EXIT_CODE = 2_147_483_647;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HISTORY_STATUSES = new Set(["completed", "failed", "paused", "stopped"]);
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

type TerminalOutcome = "succeeded" | "failed" | "interrupted";
type RecordValue = Record<string, unknown>;
export type ForegroundHistoryRequest = { runId: string; index: number };

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeScope(value: string): string {
  return (
    value
      .trim()
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "unknown"
  );
}

function scopeId(): string {
  if (typeof process.getuid === "function") return `uid-${process.getuid()}`;
  for (const key of ["USERNAME", "USER", "LOGNAME"]) {
    const value = process.env[key];
    if (value) return `user-${sanitizeScope(value)}`;
  }
  try {
    const username = userInfo().username;
    if (username) return `user-${sanitizeScope(username)}`;
  } catch {
    // Producer falls through to home-directory scoping.
  }
  const home = process.env.USERPROFILE ?? process.env.HOME;
  if (home) return `home-${sanitizeScope(home)}`;
  try {
    const fallback = homedir();
    if (fallback) return `home-${sanitizeScope(fallback)}`;
  } catch {
    // Producer uses the shared scope when no user or home is available.
  }
  return "shared";
}

/** Exact pi-subagents TEMP_ROOT_DIR/RESULTS_DIR locator; no discovery or fallback. */
function foregroundHistoryPath(): string {
  const override = process.env.PI_SUBAGENTS_TEMP_ROOT?.trim();
  const root = override
    ? resolve(override)
    : join(tmpdir(), `pi-subagents-${scopeId()}`);
  return join(root, "async-subagent-results", "foreground-history.json");
}

function validIdentity(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Buffer.byteLength(value) <= MAX_ID_BYTES
  );
}

function validateRun(run: unknown): run is RecordValue & {
  runId: string;
  mode: "single" | "parallel" | "chain";
  cwd: string;
  sessionId: string;
  updatedAt: number;
  children: unknown[];
} {
  if (!isRecord(run)) return false;
  return (
    typeof run.runId === "string" &&
    RUN_ID.test(run.runId) &&
    (run.mode === "single" ||
      run.mode === "parallel" ||
      run.mode === "chain") &&
    typeof run.cwd === "string" &&
    Buffer.byteLength(run.cwd) <= MAX_ID_BYTES * 16 &&
    validIdentity(run.sessionId) &&
    typeof run.updatedAt === "number" &&
    Number.isFinite(run.updatedAt) &&
    Array.isArray(run.children) &&
    run.children.length <= MAX_CHILDREN &&
    run.children.every((child) => {
      if (
        !isRecord(child) ||
        typeof child.agent !== "string" ||
        Buffer.byteLength(child.agent) > MAX_ID_BYTES
      )
        return false;
      if (
        typeof child.index !== "number" ||
        !Number.isSafeInteger(child.index) ||
        child.index < 0
      )
        return false;
      if (
        typeof child.status !== "string" ||
        !HISTORY_STATUSES.has(child.status)
      )
        return false;
      return (
        child.exitCode === undefined ||
        (typeof child.exitCode === "number" &&
          Number.isSafeInteger(child.exitCode) &&
          child.exitCode >= 0 &&
          child.exitCode <= MAX_EXIT_CODE)
      );
    })
  );
}

function terminalOutcome(
  status: unknown,
  exitCode: unknown,
): TerminalOutcome | undefined {
  if (typeof status !== "string" || !HISTORY_STATUSES.has(status))
    return undefined;
  if (status === "paused" || status === "stopped") return "interrupted";
  if (exitCode === undefined && status === "failed") return "failed";
  if (
    typeof exitCode !== "number" ||
    !Number.isSafeInteger(exitCode) ||
    exitCode < 0 ||
    exitCode > MAX_EXIT_CODE
  )
    return undefined;
  if (status === "completed" && exitCode === 0) return "succeeded";
  if (status === "failed" && exitCode !== 0) return "failed";
  return undefined;
}

/** Reads exact current-session matches; returned map keys remain adapter-private. */
export async function readForegroundHistoryOutcomes(
  sessionId: string,
  requests: readonly ForegroundHistoryRequest[],
): Promise<Map<string, TerminalOutcome>> {
  try {
    if (!validIdentity(sessionId) || requests.length > MAX_RUNS * MAX_CHILDREN)
      return new Map();
    const requested = new Set(
      requests
        .filter(
          ({ runId, index }) =>
            RUN_ID.test(runId) && Number.isSafeInteger(index) && index >= 0,
        )
        .map(({ runId, index }) => `${runId}#${index}`),
    );
    if (requested.size === 0) return new Map();
    const path = foregroundHistoryPath();
    if (
      path.includes("\0") ||
      Buffer.byteLength(path) > MAX_HISTORY_PATH_BYTES ||
      !isAbsolute(path) ||
      normalize(path) !== path
    )
      return new Map();
    const { root } = parse(path);
    let component = root;
    const directorySnapshots: { path: string; dev: number; ino: number }[] = [];
    const parts = path.slice(root.length).split(sep).filter(Boolean);
    for (const part of parts.slice(0, -1)) {
      component = join(component, part);
      const info = await lstat(component);
      if (info.isSymbolicLink() || !info.isDirectory()) return new Map();
      directorySnapshots.push({
        path: component,
        dev: info.dev,
        ino: info.ino,
      });
    }
    if ((await realpath(path)) !== path) return new Map();
    const before = await lstat(path);
    if (
      before.isSymbolicLink() ||
      !before.isFile() ||
      !Number.isSafeInteger(before.size) ||
      before.size < 0 ||
      before.size > MAX_HISTORY_BYTES
    )
      return new Map();
    const handle = await open(
      path,
      constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | NOFOLLOW,
    );
    try {
      const opened = await handle.stat();
      if (
        !opened.isFile() ||
        opened.dev !== before.dev ||
        opened.ino !== before.ino ||
        opened.size !== before.size ||
        opened.size > MAX_HISTORY_BYTES
      )
        return new Map();
      const bytes = Buffer.alloc(opened.size);
      const { bytesRead } = await handle.read(bytes, 0, opened.size, 0);
      const after = await handle.stat();
      const pathAfter = await lstat(path);
      if (
        bytesRead !== opened.size ||
        after.size !== opened.size ||
        pathAfter.isSymbolicLink() ||
        pathAfter.dev !== opened.dev ||
        pathAfter.ino !== opened.ino ||
        (await realpath(path)) !== path
      )
        return new Map();
      for (const directory of directorySnapshots) {
        const info = await lstat(directory.path);
        if (
          info.isSymbolicLink() ||
          info.dev !== directory.dev ||
          info.ino !== directory.ino
        )
          return new Map();
      }
      const envelope: unknown = JSON.parse(bytes.toString("utf8"));
      if (
        !isRecord(envelope) ||
        envelope.version !== 1 ||
        !Array.isArray(envelope.runs) ||
        envelope.runs.length > MAX_RUNS
      )
        return new Map();
      const matches = new Map<
        string,
        { count: number; outcome?: TerminalOutcome }
      >();
      for (const run of envelope.runs) {
        if (!validateRun(run)) return new Map();
        if (run.sessionId !== sessionId) continue;
        for (const child of run.children) {
          if (!isRecord(child)) return new Map();
          const key = `${run.runId}#${child.index as number}`;
          if (!requested.has(key)) continue;
          const previous = matches.get(key);
          matches.set(key, {
            count: (previous?.count ?? 0) + 1,
            outcome: terminalOutcome(child.status, child.exitCode),
          });
        }
      }
      const outcomes = new Map<string, TerminalOutcome>();
      for (const [key, match] of matches) {
        if (match.count === 1 && match.outcome !== undefined)
          outcomes.set(key, match.outcome);
      }
      return outcomes;
    } finally {
      await handle.close();
    }
  } catch {
    return new Map();
  }
}

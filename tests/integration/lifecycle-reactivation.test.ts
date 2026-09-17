import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

import registerSessionInspector from "../../src/index.ts";
import { waitFor } from "../helpers/wait.ts";

/**
 * Regression coverage for the M8.8 lifecycle blocker: Pi replaces the session
 * runtime and removes that runtime's listeners, while Inspector's module stays
 * cached. A registration owned by a replaced runtime therefore must never be
 * reused, and each runtime must dispose its own registration when it ends.
 *
 * The same fixture proves the read-boundary attempt memo is runtime-scoped:
 * a failed attempt is remembered inside its runtime and retried once by the
 * runtime that resumes the session.
 *
 * Every assertion here is an observable subscription or emission fact - which
 * handlers are subscribed on the live runtime's bus and which bounded telemetry
 * the session's own WAL shard received - never a setup-call count.
 */

type SessionRef = { id: string; directory: string; file: string };
type Handler = (event: unknown, context: unknown) => unknown;
type InputHandler = (event: { text: string }) => void;
type BusHandler = (data: unknown) => void;
type CommandHandler = (
  args: string,
  ctx: ExtensionCommandContext,
) => Promise<void>;

type Runtime = {
  /** Fires session_start without waiting for the detached setup chain. */
  beginStart(session: SessionRef): Promise<void>;
  start(session: SessionRef): Promise<void>;
  shutdown(reason: string): Promise<void>;
  emitSkill(): void;
  emitPermission(data: unknown): void;
  inputHandlers(): InputHandler[];
  busHandlers(channel: string): BusHandler[];
  readCurrent(session: SessionRef): Promise<void>;
};

type Fixture = {
  root: string;
  reportPath: string;
  session(id: string): SessionRef;
  writeSource(
    session: SessionRef,
    options?: { marker?: boolean },
  ): Promise<void>;
  runtime(options?: { failUnsubscribe?: boolean }): Runtime;
  metrics(session: SessionRef): Promise<string[]>;
  checkpointExists(session: SessionRef): Promise<boolean>;
  shardExists(session: SessionRef): boolean;
  close(): Promise<void>;
};

const PI_SESSIONS = "pi-sessions";

/** Bounded inventory the counter allowlist is derived from. */
const INVENTORY = [
  {
    name: "skill:graphify",
    source: "skill",
    sourceInfo: { source: "npm:pi-graphify", scope: "user", origin: "package" },
  },
] as const;

const SKILL_COMMAND = "/skill:graphify";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function trackedSource(sessionId: string, marker: boolean): string {
  const records: Record<string, unknown>[] = [
    {
      type: "session",
      version: 3,
      id: sessionId,
      timestamp: "2026-09-15T09:59:59.000Z",
    },
  ];
  if (marker) {
    records.push({
      type: "custom",
      id: "marker",
      parentId: null,
      timestamp: "2026-09-15T10:00:00.000Z",
      customType: "session-inspector:tracking-start",
      data: { schemaVersion: 1 },
    });
  }
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

export function counts(metrics: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const metric of metrics) out[metric] = (out[metric] ?? 0) + 1;
  return out;
}

async function buildFixture(): Promise<Fixture> {
  const agentDir = await mkdtemp(join(tmpdir(), "inspector-lifecycle-"));
  const root = join(agentDir, "session-inspector", "v1");
  const reportPath = join(agentDir, "report.json");
  await mkdir(root, { recursive: true });
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;

  const sessions = new Map<string, SessionRef>();
  const session = (id: string): SessionRef => {
    const existing = sessions.get(id);
    if (existing !== undefined) return existing;
    const directory = join(agentDir, PI_SESSIONS, id);
    const created = { id, directory, file: join(directory, `${id}.jsonl`) };
    sessions.set(id, created);
    return created;
  };

  const metrics = async (target: SessionRef): Promise<string[]> => {
    const shardRoot = join(root, "sessions", target.id, "wal");
    let writers: string[];
    try {
      writers = await readdir(shardRoot);
    } catch {
      return [];
    }
    const found: string[] = [];
    for (const writer of writers) {
      const directory = join(shardRoot, writer);
      let files: string[];
      try {
        files = await readdir(directory);
      } catch {
        continue;
      }
      for (const file of files) {
        if (!file.endsWith(".jsonl")) continue;
        const content = await readFile(join(directory, file), "utf8");
        for (const line of content.split("\n")) {
          if (line.trim() === "") continue;
          const record = JSON.parse(line) as {
            kind?: string;
            telemetry?: { metric?: string };
          };
          const metric = record.telemetry?.metric;
          if (record.kind === "telemetry" && typeof metric === "string") {
            found.push(metric);
          }
        }
      }
    }
    return found;
  };

  const checkpointExists = async (target: SessionRef): Promise<boolean> => {
    try {
      await readFile(join(root, "sessions", target.id, "checkpoint.json"));
      return true;
    } catch {
      return false;
    }
  };

  const shardReady = (target: SessionRef): boolean => {
    try {
      return readdirSync(join(root, "sessions", target.id, "wal")).length > 0;
    } catch {
      return false;
    }
  };

  const runtime = (options?: { failUnsubscribe?: boolean }): Runtime => {
    const hooks = new Map<string, Handler[]>();
    const inputs: InputHandler[] = [];
    const bus = new Map<string, BusHandler[]>();
    let command: CommandHandler | undefined;

    const api = {
      on: (event: string, handler: Handler) => {
        const list = hooks.get(event) ?? [];
        list.push(handler);
        hooks.set(event, list);
        if (event !== "input") return undefined;
        const input = handler as unknown as InputHandler;
        inputs.push(input);
        return () => {
          if (options?.failUnsubscribe === true) {
            throw new Error("unsubscribe failed");
          }
          const index = inputs.indexOf(input);
          if (index >= 0) inputs.splice(index, 1);
        };
      },
      events: {
        on: (channel: string, handler: BusHandler) => {
          const list = bus.get(channel) ?? [];
          list.push(handler);
          bus.set(channel, list);
          return () => {
            if (options?.failUnsubscribe === true) {
              throw new Error("unsubscribe failed");
            }
            const index = list.indexOf(handler);
            if (index >= 0) list.splice(index, 1);
          };
        },
      },
      appendEntry: () => {},
      getCommands: () => [...INVENTORY],
      getAllTools: () => [],
      registerCommand: (
        name: string,
        registered: { handler: CommandHandler },
      ) => {
        if (name === "session-inspector") command = registered.handler;
      },
    };
    registerSessionInspector(api as unknown as ExtensionAPI);

    const contextOf = (target: SessionRef): SessionManagerCtx => ({
      sessionManager: {
        getSessionId: () => target.id,
        getSessionFile: () => target.file,
        getSessionDir: () => target.directory,
        getLeafId: () => null,
      },
    });

    return {
      beginStart: async (target) => {
        const handlers = hooks.get("session_start") ?? [];
        assert.ok(
          handlers.length > 0,
          "the production session_start handler is registered",
        );
        for (const handler of handlers) {
          await handler({ reason: "startup" }, contextOf(target));
        }
      },
      start: async (target) => {
        const handlers = hooks.get("session_start") ?? [];
        assert.ok(
          handlers.length > 0,
          "the production session_start handler is registered",
        );
        for (const handler of handlers) {
          await handler({ reason: "startup" }, contextOf(target));
        }
        // Tracking promotion and WAL setup are detached (observer-only), so a
        // test waits for this runtime's own live subscriptions rather than
        // assuming `session_start` finished them.
        await waitFor(
          () => inputs.length > 0,
          "the runtime's live subscriptions",
        );
      },
      shutdown: async (reason) => {
        for (const handler of [...(hooks.get("session_shutdown") ?? [])]) {
          await handler({ type: "session_shutdown", reason }, {});
        }
      },
      emitSkill: () => {
        for (const input of [...inputs]) input({ text: SKILL_COMMAND });
      },
      emitPermission: (data) => {
        for (const handler of [...(bus.get("permissions:decision") ?? [])]) {
          handler(data);
        }
      },
      inputHandlers: () => [...inputs],
      busHandlers: (channel) => [...(bus.get(channel) ?? [])],
      readCurrent: async (target) => {
        assert.ok(command, "the production command handler is registered");
        await command(`json current --output "${reportPath}"`, {
          mode: "interactive",
          ...contextOf(target),
          ui: {
            notify: () => {},
            custom: async () => {
              throw new Error("a report read must not open the UI");
            },
          },
        } as unknown as ExtensionCommandContext);
      },
    };
  };

  return {
    root,
    reportPath,
    session,
    writeSource: async (target, writeOptions) => {
      await mkdir(target.directory, { recursive: true });
      // The maintenance lease stages inside Inspector's own session directory,
      // so the fixture must let that pass create it rather than fail closed.
      await mkdir(join(root, "sessions", target.id), { recursive: true });
      await writeFile(
        target.file,
        trackedSource(target.id, writeOptions?.marker ?? true),
      );
    },
    runtime,
    metrics,
    checkpointExists,
    shardExists: shardReady,
    close: async () => {
      if (previousAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      }
      await rm(agentDir, { recursive: true, force: true });
    },
  };
}

type SessionManagerCtx = {
  sessionManager: {
    getSessionId(): string;
    getSessionFile(): string | undefined;
    getSessionDir(): string;
    getLeafId(): string | null;
  };
};

test("a repeated session_start in one runtime keeps exactly one live subscription set", async () => {
  const fixture = await buildFixture();
  try {
    const a = fixture.session("repeat-a");
    await fixture.writeSource(a);
    const runtime = fixture.runtime();
    await runtime.start(a);
    await runtime.start(a);

    assert.equal(runtime.inputHandlers().length, 1);
    runtime.emitSkill();
    await runtime.readCurrent(a);
    assert.deepEqual(counts(await fixture.metrics(a)), {
      "skill.invocation": 1,
    });
  } finally {
    await fixture.close();
  }
});

test("replacing the runtime disposes the previous runtime's registration and emits exactly once per event", async () => {
  const fixture = await buildFixture();
  try {
    const a = fixture.session("replace-a");
    const b = fixture.session("replace-b");
    await fixture.writeSource(a);
    await fixture.writeSource(b);

    const first = fixture.runtime();
    await first.start(a);
    first.emitPermission({ result: "deny", resolution: "policy_deny" });
    first.emitSkill();
    await first.readCurrent(a);
    assert.deepEqual(counts(await fixture.metrics(a)), {
      "permission.decision": 1,
      "skill.invocation": 1,
    });

    await first.shutdown("resume");
    const second = fixture.runtime();
    assert.equal(
      second.busHandlers("permissions:decision").length,
      0,
      "a replaced runtime's bus subscriptions must not be inherited",
    );
    await second.start(b);
    second.emitPermission({ result: "allow", resolution: "user_approved" });
    second.emitSkill();
    await second.readCurrent(b);

    assert.deepEqual(counts(await fixture.metrics(b)), {
      "permission.decision": 1,
      "skill.invocation": 1,
    });
    assert.deepEqual(
      counts(await fixture.metrics(a)),
      { "permission.decision": 1, "skill.invocation": 1 },
      "the replaced session's WAL must not gain or lose telemetry",
    );
  } finally {
    await fixture.close();
  }
});

test("resuming the same session id subscribes afresh instead of reusing an inert registration", async () => {
  const fixture = await buildFixture();
  try {
    const a = fixture.session("resume-a");
    const b = fixture.session("resume-b");
    await fixture.writeSource(a);
    await fixture.writeSource(b);

    const first = fixture.runtime();
    await first.start(a);
    first.emitPermission({ result: "deny", resolution: "policy_deny" });
    first.emitSkill();
    await first.readCurrent(a);
    assert.deepEqual(counts(await fixture.metrics(a)), {
      "permission.decision": 1,
      "skill.invocation": 1,
    });

    await first.shutdown("resume");
    const second = fixture.runtime();
    await second.start(b);
    second.emitSkill();
    await second.readCurrent(b);
    await second.shutdown("resume");

    const third = fixture.runtime();
    await third.start(a);
    assert.equal(
      third.inputHandlers().length,
      1,
      "the resumed session must own exactly one live input subscription",
    );
    third.emitPermission({ result: "allow", resolution: "user_approved" });
    third.emitSkill();
    await third.readCurrent(a);

    assert.deepEqual(
      counts(await fixture.metrics(a)),
      { "permission.decision": 2, "skill.invocation": 2 },
      "the resumed session must keep counting without duplicating",
    );
    assert.deepEqual(counts(await fixture.metrics(b)), {
      "skill.invocation": 1,
    });
  } finally {
    await fixture.close();
  }
});

for (const reason of ["new", "resume", "fork", "reload", "quit"]) {
  test(`session_shutdown (${reason}) ends the runtime's live registration`, async () => {
    const fixture = await buildFixture();
    try {
      const a = fixture.session(`reason-${reason}`);
      await fixture.writeSource(a);

      const first = fixture.runtime();
      await first.start(a);
      first.emitSkill();
      await first.readCurrent(a);

      await first.shutdown(reason);
      assert.equal(
        first.inputHandlers().length,
        0,
        "shutdown must remove the ended runtime's input subscription",
      );

      const second = fixture.runtime();
      await second.start(a);
      assert.equal(second.inputHandlers().length, 1);
      second.emitSkill();
      await second.readCurrent(a);
      assert.deepEqual(
        counts(await fixture.metrics(a)),
        { "skill.invocation": 2 },
        "the next runtime must count once, not zero or twice",
      );
    } finally {
      await fixture.close();
    }
  });
}

test("disposal is idempotent and a repeated shutdown cannot break the next runtime", async () => {
  const fixture = await buildFixture();
  try {
    const a = fixture.session("idempotent-a");
    await fixture.writeSource(a);

    const first = fixture.runtime();
    await first.start(a);
    first.emitSkill();
    await first.readCurrent(a);
    await first.shutdown("resume");
    await assert.doesNotReject(first.shutdown("resume"));
    await assert.doesNotReject(first.shutdown("quit"));

    const second = fixture.runtime();
    await second.start(a);
    second.emitSkill();
    await second.readCurrent(a);
    assert.deepEqual(counts(await fixture.metrics(a)), {
      "skill.invocation": 2,
    });
  } finally {
    await fixture.close();
  }
});

test("a failing unsubscribe stays observer-only and never blocks the next runtime", async () => {
  const fixture = await buildFixture();
  try {
    const a = fixture.session("failing-a");
    await fixture.writeSource(a);

    const first = fixture.runtime({ failUnsubscribe: true });
    await first.start(a);
    first.emitSkill();
    await first.readCurrent(a);
    await assert.doesNotReject(first.shutdown("resume"));

    const second = fixture.runtime();
    await second.start(a);
    assert.equal(second.inputHandlers().length, 1);
    second.emitSkill();
    await second.readCurrent(a);
    assert.deepEqual(
      counts(await fixture.metrics(a)),
      { "skill.invocation": 2 },
      "a stale registration must be replaced, never reused",
    );
  } finally {
    await fixture.close();
  }
});

/**
 * Pi may replace a runtime before its detached `session_start` pass finished
 * attaching listeners, which is why a registration arriving for an ended
 * runtime is refused (src/index.ts `runtimeEnded`). This test pins the
 * observable invariant of that window - the session keeps exactly one live
 * owner and counts once per event - but it cannot force the harmful ordering (a
 * stale registration landing after the replacing runtime's own), so it is an
 * invariant test, not a discriminator for the guard itself.
 */
test("a runtime replaced mid-setup leaves one live owner for the session", async () => {
  const fixture = await buildFixture();
  try {
    const a = fixture.session("race-a");
    await fixture.writeSource(a);

    const replaced = fixture.runtime();
    await replaced.beginStart(a);
    await replaced.shutdown("resume");
    await waitFor(
      () => fixture.shardExists(a),
      "the raced runtime's WAL shard",
    );
    // The assertion below is an absence, and the detached chain that must not
    // reach it has no completion signal while the guard holds, so this settle is
    // the window that separates "disposed" from "not yet attached". A wait on
    // the empty handler list would pass before the chain ever got there.
    await sleep(60);
    assert.equal(
      replaced.inputHandlers().length,
      0,
      "the ended runtime must not keep a live subscription",
    );

    const resumed = fixture.runtime();
    await resumed.start(a);
    resumed.emitSkill();
    await resumed.readCurrent(a);
    assert.deepEqual(
      counts(await fixture.metrics(a)),
      { "skill.invocation": 1 },
      "the runtime that owns the session must count exactly once",
    );

    // A further runtime neither loses nor duplicates the session's telemetry.
    await resumed.shutdown("new");
    const third = fixture.runtime();
    await third.start(a);
    third.emitSkill();
    await third.readCurrent(a);
    assert.deepEqual(counts(await fixture.metrics(a)), {
      "skill.invocation": 2,
    });
  } finally {
    await fixture.close();
  }
});

test("a failed read-boundary attempt is remembered inside its runtime and retried once by the next runtime", async () => {
  const fixture = await buildFixture();
  try {
    const c = fixture.session("boundary-c");
    // Untracked source: the boundary pass runs and cannot fold anything.
    await fixture.writeSource(c, { marker: false });

    const first = fixture.runtime();
    await first.readCurrent(c);
    assert.equal(await fixture.checkpointExists(c), false);

    // The session becomes foldable, but the same runtime already spent its one
    // bounded attempt: a read must not retry maintenance on every load.
    await fixture.writeSource(c, { marker: true });
    await first.readCurrent(c);
    await first.readCurrent(c);
    assert.equal(
      await fixture.checkpointExists(c),
      false,
      "the same runtime must not retry a recorded boundary attempt",
    );

    const resumed = fixture.runtime();
    await resumed.readCurrent(c);
    assert.equal(
      await fixture.checkpointExists(c),
      true,
      "the runtime that resumes the session gets one fresh attempt",
    );
  } finally {
    await fixture.close();
  }
});

test("a healthy session folds once per runtime and is not re-folded on every read", async () => {
  const fixture = await buildFixture();
  try {
    const d = fixture.session("boundary-d");
    await fixture.writeSource(d);

    const first = fixture.runtime();
    await first.readCurrent(d);
    assert.equal(await fixture.checkpointExists(d), true);

    // Removing the boundary makes a re-run observable: the memo, not the
    // on-disk state, is what stops the second pass in this runtime.
    await rm(join(fixture.root, "sessions", d.id, "checkpoint.json"), {
      force: true,
    });
    await first.readCurrent(d);
    assert.equal(await fixture.checkpointExists(d), false);

    const resumed = fixture.runtime();
    await resumed.readCurrent(d);
    assert.equal(await fixture.checkpointExists(d), true);
  } finally {
    await fixture.close();
  }
});

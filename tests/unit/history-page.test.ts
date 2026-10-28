import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  decodeHistoryCursor,
  encodeHistoryCursor,
  loadHistorySessionPage,
} from "../../src/ui/history-page.ts";

const maintenance = {
  writerId: "maintainer-1",
  now: () => new Date("2026-01-01T00:00:00.000Z"),
  isPidAlive: () => false,
};

type SessionTimes = {
  header?: string;
  entry: string;
  version?: number;
  extraEntries?: readonly Record<string, unknown>[];
};

async function addSession(
  root: string,
  sessionDirectory: string,
  sessionId: string,
  times: SessionTimes,
): Promise<void> {
  const header = {
    type: "session",
    version: times.version ?? 3,
    id: sessionId,
    ...(times.header === undefined ? {} : { timestamp: times.header }),
  };
  const marker = {
    type: "custom",
    id: "marker",
    parentId: null,
    timestamp: times.entry,
    customType: "session-inspector:tracking-start",
    data: { schemaVersion: 1 },
  };
  await writeFile(
    join(sessionDirectory, `${sessionId}.jsonl`),
    `${JSON.stringify(header)}\n${JSON.stringify(marker)}\n${(times.extraEntries ?? []).map((entry) => JSON.stringify(entry)).join("\n")}${times.extraEntries?.length ? "\n" : ""}`,
  );
  const directory = join(root, "sessions", sessionId);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "meta.json"),
    `${JSON.stringify({
      schemaVersion: 2,
      sessionId,
      sourceFile: `${sessionId}.jsonl`,
      state: "tracking",
    })}\n`,
  );
}

function options(root: string, sessionDirectory: string) {
  let replays = 0;
  return {
    root,
    sessionDirectory: () => sessionDirectory,
    maintenance,
    sessionEvidence: async () => {
      replays += 1;
      return { evidence: { atomic: [], folded: [] } };
    },
    replayCount: () => replays,
    resetReplayCount: () => {
      replays = 0;
    },
  };
}

test("uses the newest valid Pi-native timestamp and deterministic tie/missing ordering", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-history-page-order-"));
  const sessionDirectory = join(root, "public-sessions");
  await mkdir(sessionDirectory);
  try {
    await addSession(root, sessionDirectory, "activity", {
      header: "2025-01-01T00:00:00.000Z",
      entry: "2026-03-01T00:00:00.000Z",
    });
    await addSession(root, sessionDirectory, "creation", {
      header: "2026-02-01T00:00:00.000Z",
      entry: "2025-01-01T00:00:00.000Z",
    });
    await addSession(root, sessionDirectory, "no-header", {
      entry: "2026-01-02T00:00:00.000Z",
    });
    await addSession(root, sessionDirectory, "z-sub-ms-early", {
      entry: "2026-01-01T00:00:00.000000001Z",
    });
    await addSession(root, sessionDirectory, "a-sub-ms-late", {
      entry: "2026-01-01T00:00:00.000000002Z",
    });
    await addSession(root, sessionDirectory, "same-z", {
      header: "2026-01-01T00:00:00.000Z",
      entry: "2026-01-01T00:00:00.000Z",
    });
    await addSession(root, sessionDirectory, "same-offset", {
      header: "2025-12-31T19:00:00.000-05:00",
      entry: "2025-12-31T19:00:00.000-05:00",
    });
    await addSession(root, sessionDirectory, "invalid-a", {
      header: "not-a-date",
      entry: "also-not-a-date",
    });
    await addSession(root, sessionDirectory, "invalid-b", {
      entry: "not-a-date",
    });

    const result = await loadHistorySessionPage(
      options(root, sessionDirectory),
    );
    assert.deepEqual(
      result.sessions.map((session) => session.sessionId),
      [
        "activity",
        "creation",
        "no-header",
        "a-sub-ms-late",
        "z-sub-ms-early",
        "same-offset",
        "same-z",
        "invalid-a",
        "invalid-b",
      ],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("orders only structurally valid timestamps from identity-matched Pi v3 sessions", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "inspector-history-page-date-evidence-"),
  );
  const sessionDirectory = join(root, "public-sessions");
  await mkdir(sessionDirectory);
  try {
    await addSession(root, sessionDirectory, "valid-recent", {
      header: "2025-01-01T00:00:00.000Z",
      entry: "2026-01-01T00:00:00.000Z",
    });
    await addSession(root, sessionDirectory, "invalid-entry", {
      header: "2025-01-01T00:00:00.000Z",
      entry: "2025-01-01T00:00:00.000Z",
      extraEntries: [
        {
          type: "message",
          id: "",
          parentId: null,
          timestamp: "2099-01-01T00:00:00.000Z",
        },
      ],
    });
    await addSession(root, sessionDirectory, "unsupported-version", {
      entry: "2025-01-01T00:00:00.000Z",
      header: "2099-01-01T00:00:00.000Z",
      version: 99,
    });

    const result = await loadHistorySessionPage(
      options(root, sessionDirectory),
    );
    assert.deepEqual(
      result.sessions.map((session) => session.sessionId),
      ["valid-recent", "invalid-entry", "unsupported-version"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cursor codec accepts only bounded canonical version-one continuation tokens", () => {
  const cursor = {
    direction: "after" as const,
    sortAt: "2026-01-01T00:00:00.000Z",
    sessionId: "session-1",
  };
  const encoded = encodeHistoryCursor(cursor);
  assert.equal(encoded.includes("="), false);
  assert.deepEqual(decodeHistoryCursor(encoded), { version: 1, ...cursor });
  assert.equal(decodeHistoryCursor("%%%"), undefined);
  assert.equal(decodeHistoryCursor("A".repeat(449)), undefined);
  assert.equal(decodeHistoryCursor(`${encoded}=`), undefined);

  const noncanonical = Buffer.from(
    JSON.stringify({
      sessionId: cursor.sessionId,
      sortAt: cursor.sortAt,
      direction: cursor.direction,
      version: 1,
    }),
  ).toString("base64url");
  assert.equal(decodeHistoryCursor(noncanonical), undefined);
  const invalidId = Buffer.from(
    JSON.stringify({
      version: 1,
      direction: cursor.direction,
      sortAt: cursor.sortAt,
      sessionId: "../outside",
    }),
  ).toString("base64url");
  assert.equal(decodeHistoryCursor(invalidId), undefined);
});

test("478 sessions traverse forward and backward without gaps or duplicate rows", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "inspector-history-page-traversal-"),
  );
  const sessionDirectory = join(root, "public-sessions");
  await mkdir(sessionDirectory);
  const testOptions = options(root, sessionDirectory);
  const expected = Array.from(
    { length: 478 },
    (_, index) => `session-${String(index).padStart(3, "0")}`,
  ).reverse();

  try {
    for (let index = 0; index < 478; index += 1) {
      const sessionId = `session-${String(index).padStart(3, "0")}`;
      const timestamp = new Date(
        Date.UTC(2026, 0, 1) + index * 1000,
      ).toISOString();
      await addSession(root, sessionDirectory, sessionId, {
        header: "2025-01-01T00:00:00.000Z",
        entry: timestamp,
      });
    }

    const pages = [];
    let cursor: string | undefined;
    while (true) {
      testOptions.resetReplayCount();
      const page = await loadHistorySessionPage(testOptions, cursor);
      assert.ok(page.sessions.length <= 50);
      assert.equal(testOptions.replayCount(), page.sessions.length);
      pages.push(page);
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    assert.equal(pages.length, 10);
    assert.deepEqual(
      pages.flatMap((page) =>
        page.sessions.map((session) => session.sessionId),
      ),
      expected,
    );
    assert.equal(pages[0]?.previousCursor, null);
    assert.notEqual(pages[0]?.nextCursor, null);
    assert.notEqual(pages.at(-1)?.previousCursor, null);
    assert.equal(pages.at(-1)?.nextCursor, null);
    assert.equal(pages.at(-1)?.sessions.length, 28);

    const backwardPages = [];
    let previous = pages.at(-1)?.previousCursor ?? null;
    while (previous !== null) {
      testOptions.resetReplayCount();
      const page = await loadHistorySessionPage(testOptions, previous);
      assert.equal(testOptions.replayCount(), page.sessions.length);
      assert.ok(page.sessions.length <= 50);
      backwardPages.unshift(page);
      previous = page.previousCursor;
    }
    assert.deepEqual(
      backwardPages.flatMap((page) =>
        page.sessions.map((session) => session.sessionId),
      ),
      expected.slice(0, -28),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("cursor boundaries preserve tied and missing dates, even after an anchor is removed", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-history-page-ties-"));
  const sessionDirectory = join(root, "public-sessions");
  await mkdir(sessionDirectory);
  const testOptions = options(root, sessionDirectory);
  const tiedIds = Array.from(
    { length: 55 },
    (_, index) => `tied-${String(index).padStart(2, "0")}`,
  );
  const missingIds = Array.from(
    { length: 55 },
    (_, index) => `missing-${String(index).padStart(2, "0")}`,
  );
  const expected = [...tiedIds, ...missingIds];

  try {
    for (const sessionId of tiedIds) {
      await addSession(root, sessionDirectory, sessionId, {
        entry: "2026-01-01T00:00:00.000Z",
      });
    }
    for (const sessionId of missingIds) {
      await addSession(root, sessionDirectory, sessionId, {
        entry: "not-a-date",
      });
    }

    const first = await loadHistorySessionPage(testOptions);
    assert.equal(first.sessions.length, 50);
    const firstNextCursor = first.nextCursor;
    if (firstNextCursor === null) throw new Error("first page must continue");
    const second = await loadHistorySessionPage(testOptions, firstNextCursor);
    assert.equal(second.sessions.length, 50);
    const secondNextCursor = second.nextCursor;
    if (secondNextCursor === null) throw new Error("second page must continue");
    const third = await loadHistorySessionPage(testOptions, secondNextCursor);
    assert.equal(third.sessions.length, 10);
    assert.equal(third.nextCursor, null);
    assert.deepEqual(
      [...first.sessions, ...second.sessions, ...third.sessions].map(
        (session) => session.sessionId,
      ),
      expected,
    );

    const thirdPreviousCursor = third.previousCursor;
    if (thirdPreviousCursor === null)
      throw new Error("third page must have a previous page");
    const previous = await loadHistorySessionPage(
      testOptions,
      thirdPreviousCursor,
    );
    assert.deepEqual(
      previous.sessions.map((session) => session.sessionId),
      expected.slice(50, 100),
    );

    const lastFirstPageSession = first.sessions.at(-1);
    if (lastFirstPageSession === undefined) {
      throw new Error("first page must contain an anchor");
    }
    const removedAnchorId = lastFirstPageSession.sessionId;
    await rm(join(sessionDirectory, `${removedAnchorId}.jsonl`));
    await rm(join(root, "sessions", removedAnchorId), {
      recursive: true,
      force: true,
    });
    const afterRemoval = await loadHistorySessionPage(
      testOptions,
      firstNextCursor,
    );
    assert.deepEqual(
      afterRemoval.sessions.slice(0, 5).map((session) => session.sessionId),
      tiedIds.slice(50),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

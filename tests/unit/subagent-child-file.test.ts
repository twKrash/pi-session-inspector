import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  appendFile,
  mkdir,
  mkdtemp,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import {
  readChildSessionFile,
  readExactly,
  type StatReadHandle,
} from "../../src/pi/child-session-file.ts";
import { patchOpen, patchReadlink } from "../helpers/patch-open.ts";

let root: string;
let parent: string;
let base: string;
let child: string;

before(async () => {
  root = await mkdtemp(join(tmpdir(), "child-file-"));
  parent = join(root, "parent.jsonl");
  base = join(root, "parent");
  child = join(base, "run-1", "run-0", "session.jsonl");
  await mkdir(join(base, "run-1", "run-0"), { recursive: true });
  await writeFile(child, "child text\n");
});
after(() => rm(root, { recursive: true, force: true }));

const readFull = (path: unknown, maxBytes = 1024, parentFile = parent) =>
  readChildSessionFile(path, parentFile, maxBytes);
const read = async (path: unknown, maxBytes = 1024, parentFile = parent) =>
  (await readFull(path, maxBytes, parentFile)).text;

test("a confined regular file is read as text", async () => {
  assert.equal(await read(child), "child text\n");
});

test("a size cap is inclusive", async () => {
  assert.equal(await read(child, 11), "child text\n");
  assert.equal(await read(child, 10), undefined);
});

test("a path outside the parent's own directory is never read", async () => {
  await mkdir(join(root, "parent-evil"), { recursive: true });
  await writeFile(join(root, "parent-evil", "x.jsonl"), "x");
  await writeFile(join(root, "other.jsonl"), "x");
  for (const outside of [
    join(root, "other.jsonl"),
    join(root, "parent-evil", "x.jsonl"),
    "run-1/run-0/session.jsonl",
    undefined,
  ]) {
    assert.equal(await read(outside), undefined, String(outside));
  }
});

test("a parent that is not an absolute .jsonl path has no child directory", async () => {
  assert.equal(await read(child, 1024, join(root, "parent")), undefined);
  assert.equal(await read(child, 1024, "parent.jsonl"), undefined);
});

test("symlinks are rejected at the file, a component, and the root", async () => {
  await mkdir(join(root, "elsewhere", "run-0"), { recursive: true });
  await writeFile(join(root, "elsewhere", "run-0", "session.jsonl"), "outside");
  await symlink(child, join(base, "link.jsonl"));
  await symlink(join(root, "elsewhere"), join(base, "linked-dir"));
  assert.equal(await read(join(base, "link.jsonl")), undefined);
  assert.equal(
    await read(join(base, "linked-dir", "run-0", "session.jsonl")),
    undefined,
  );

  const otherParent = join(root, "other-parent.jsonl");
  await symlink(base, join(root, "other-parent"));
  assert.equal(
    await read(
      join(root, "other-parent", "run-1", "run-0", "session.jsonl"),
      1024,
      otherParent,
    ),
    undefined,
  );
});

test("a directory, a missing file, and a FIFO are not regular files", async () => {
  await mkdir(join(base, "dir.jsonl"));
  const fifo = join(base, "fifo.jsonl");
  execFileSync("mkfifo", [fifo]);
  assert.equal(await read(join(base, "dir.jsonl")), undefined);
  assert.equal(await read(join(base, "missing.jsonl")), undefined);
  assert.equal(await read(fifo), undefined);
});

const fakeHandle = (options: {
  isFile?: boolean;
  sizes: number[];
  bytesRead?: number;
  text?: string;
}): StatReadHandle => {
  const sizes = [...options.sizes];
  return {
    stat: async () => ({
      isFile: () => options.isFile ?? true,
      size: sizes.shift() ?? 0,
    }),
    read: async (buffer) => {
      const written = buffer.write(options.text ?? "abc");
      return { bytesRead: options.bytesRead ?? written };
    },
  };
};

test("a stable regular file of the expected size is read whole", async () => {
  assert.deepEqual(await readExactly(fakeHandle({ sizes: [3, 3] }), 3), {
    bytes: 3,
    text: "abc",
  });
});

test("a read that is refused or unstable still reports exactly what it consumed", async () => {
  const cases: [string, Parameters<typeof fakeHandle>[0], number][] = [
    ["not a regular file: nothing read", { isFile: false, sizes: [3, 3] }, 0],
    ["truncated before the read: nothing read", { sizes: [2, 2] }, 0],
    ["grown before the read: nothing read", { sizes: [4, 4] }, 0],
    ["short read: only what came back", { sizes: [3, 3], bytesRead: 2 }, 2],
    ["grew while reading: the whole read", { sizes: [3, 4] }, 3],
    ["shrank while reading: the whole read", { sizes: [3, 2] }, 3],
  ];
  for (const [label, options, bytes] of cases) {
    assert.deepEqual(
      await readExactly(fakeHandle(options), 3),
      { bytes },
      label,
    );
  }
});

test("only the bytes actually read are reported as spent", async () => {
  assert.deepEqual(await readFull(child), {
    bytes: 11,
    text: "child text\n",
  });
  assert.deepEqual(
    await readFull(child, 10),
    { bytes: 0 },
    "too large: never read",
  );
  assert.deepEqual(await readFull(join(base, "missing.jsonl")), { bytes: 0 });
  assert.deepEqual(await readFull(undefined), { bytes: 0 });
});

test("a legitimate child is read through a symlinked ancestor of the root", async () => {
  await symlink(root, join(root, "alias"));
  const viaAlias = join(root, "alias", "parent.jsonl");
  const text = await read(
    join(root, "alias", "parent", "run-1", "run-0", "session.jsonl"),
    1024,
    viaAlias,
  );
  assert.equal(text, "child text\n");
});

/** Two same-sized files, one inside the parent's directory and one outside it. */
async function raceFixture(name: string) {
  const dir = join(base, name);
  const moved = join(base, `${name}-moved`);
  const outside = join(root, `${name}-outside`);
  await mkdir(dir, { recursive: true });
  await mkdir(outside);
  await writeFile(join(dir, "session.jsonl"), "inside!");
  await writeFile(join(outside, "session.jsonl"), "outside");
  const swapIn = async () => {
    await rename(dir, moved);
    await symlink(outside, dir);
  };
  const swapBack = async () => {
    await unlink(dir);
    await rename(moved, dir);
  };
  return { path: join(dir, "session.jsonl"), swapIn, swapBack };
}

test("a directory swapped for a symlink before the open never yields outside bytes", async () => {
  const { path, swapIn } = await raceFixture("race-before-open");
  let swapped = false;
  const restore = patchOpen((real) => async (target, ...args) => {
    if (target === path && !swapped) {
      swapped = true;
      await swapIn();
    }
    return real(target, ...args);
  });
  try {
    assert.deepEqual(await readFull(path), { bytes: 0 });
    assert.equal(swapped, true, "the race was staged");
  } finally {
    restore();
  }
});

test("an open that landed outside is caught even when the path is restored afterwards", async () => {
  const { path, swapIn, swapBack } = await raceFixture("race-restored");
  let swapped = false;
  const restore = patchOpen((real) => async (target, ...args) => {
    if (target !== path || swapped) return real(target, ...args);
    swapped = true;
    await swapIn();
    const handle = await real(target, ...args);
    await swapBack();
    return handle;
  });
  try {
    // The path now names the inside file, so only the inode check can tell.
    assert.deepEqual(await readFull(path), { bytes: 0 });
    assert.equal(swapped, true, "the race was staged");
  } finally {
    restore();
  }
});

test("a file that grows while it is read is rejected but its bytes stay spent", async () => {
  const path = join(base, "grows.jsonl");
  await writeFile(path, "123456");
  const restore = patchOpen((real) => async (target, ...args) => {
    const handle = await real(target, ...args);
    if (target !== path) return handle;
    const read = handle.read.bind(handle) as (
      ...a: unknown[]
    ) => Promise<unknown>;
    handle.read = (async (...a: unknown[]) => {
      const result = await read(...a);
      await appendFile(path, "x");
      return result;
    }) as typeof handle.read;
    return handle;
  });
  try {
    const result = await readFull(path);
    assert.equal(result.text, undefined);
    assert.equal(result.bytes, 6);
  } finally {
    restore();
  }
});

test("a swap after the descriptor is checked cannot redirect the read", async () => {
  const { path, swapIn } = await raceFixture("race-after-check");
  let swapped = false;
  const restore = patchOpen((real) => async (target, ...args) => {
    const handle = await real(target, ...args);
    if (target !== path) return handle;
    const read = handle.read.bind(handle) as (
      ...a: unknown[]
    ) => Promise<unknown>;
    handle.read = (async (...a: unknown[]) => {
      if (!swapped) {
        swapped = true;
        await swapIn(); // after the kernel placed the open file inside the root
      }
      return read(...a);
    }) as typeof handle.read;
    return handle;
  });
  try {
    // The read is bound to the descriptor: the swapped-in outside file is never seen.
    assert.deepEqual(await readFull(path), { bytes: 7, text: "inside!" });
    assert.equal(swapped, true, "the race was staged");
  } finally {
    restore();
  }
});

test("a file removed after it was opened is not read", async () => {
  const path = join(base, "removed.jsonl");
  await writeFile(path, "gone");
  const restore = patchOpen((real) => async (target, ...args) => {
    const handle = await real(target, ...args);
    if (target === path) await unlink(path); // the kernel now reports "(deleted)"
    return handle;
  });
  try {
    assert.deepEqual(await readFull(path), { bytes: 0 });
  } finally {
    restore();
  }
});

test("on Linux without a kernel path for the descriptor nothing is read", async () => {
  const restore = patchReadlink(async () => {
    throw Object.assign(new Error("no procfs"), { code: "ENOENT" });
  });
  try {
    assert.deepEqual(await readChildSessionFile(child, parent, 1024, "linux"), {
      bytes: 0,
    });
  } finally {
    restore();
  }
});

test("a kernel path that differs from the expected one is refused", async () => {
  const restore = patchReadlink(async () => "/elsewhere/session.jsonl");
  try {
    assert.deepEqual(await readChildSessionFile(child, parent, 1024, "linux"), {
      bytes: 0,
    });
  } finally {
    restore();
  }
});

// Platforms without procfs verify by looking the path up again (ADR 0028).
const readOther = async (path: string) =>
  (await readChildSessionFile(path, parent, 1024, "darwin")).text;

test("without procfs a file at its expected path is read", async () => {
  const restore = patchReadlink(async () => {
    throw new Error("procfs must not be consulted off Linux");
  });
  try {
    assert.equal(await readOther(child), "child text\n");
  } finally {
    restore();
  }
});

test("without procfs a symlinked directory component is refused", async () => {
  const real = join(root, "elsewhere");
  await mkdir(real, { recursive: true });
  await writeFile(join(real, "s.jsonl"), "outside");
  await symlink(real, join(base, "linked"));
  assert.equal(await readOther(join(base, "linked", "s.jsonl")), undefined);
});

test("without procfs a file swapped in after the open is refused", async () => {
  const path = join(base, "swapped.jsonl");
  await writeFile(path, "first");
  const restore = patchOpen((real) => async (target, ...args) => {
    const handle = await real(target, ...args);
    if (target === path) {
      await rename(path, `${path}.moved`);
      await writeFile(path, "other"); // a new inode at the expected path
    }
    return handle;
  });
  try {
    assert.equal(await readOther(path), undefined);
  } finally {
    restore();
  }
});

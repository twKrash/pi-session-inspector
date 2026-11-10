import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";

type Patchable = Pick<typeof fs, "open" | "readlink">;

/**
 * Replaces one `fs/promises` function for the code under test so a test can
 * interleave real filesystem changes with a read (a race it could not otherwise
 * reach). `wrap` receives the real function; the returned function restores it.
 */
function patchFs<K extends keyof Patchable>(
  name: K,
  wrap: (real: Patchable[K]) => Patchable[K],
): () => void {
  const real = fs[name];
  Object.assign(fs, { [name]: wrap(real) });
  syncBuiltinESMExports();
  return () => {
    Object.assign(fs, { [name]: real });
    syncBuiltinESMExports();
  };
}

export const patchOpen = (
  wrap: (real: Patchable["open"]) => Patchable["open"],
) => patchFs("open", wrap);

/** Stubs `readlink` with a string-returning function (the overload the code under test uses). */
export const patchReadlink = (stub: (path: string) => Promise<string>) =>
  // The stub covers only the string overload; the code under test never asks for a buffer.
  patchFs("readlink", () => stub as Patchable["readlink"]);

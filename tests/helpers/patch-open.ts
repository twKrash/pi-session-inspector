import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";

type Open = typeof fs.open;

/**
 * Replaces `fs.open` for the code under test so a test can interleave real
 * filesystem changes with a read (a race it could not otherwise reach).
 * `wrap` receives the real `open`; the returned function restores it.
 */
export function patchOpen(wrap: (real: Open) => Open): () => void {
  const real = fs.open;
  fs.open = wrap(real);
  syncBuiltinESMExports();
  return () => {
    fs.open = real;
    syncBuiltinESMExports();
  };
}

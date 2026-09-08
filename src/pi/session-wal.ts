import { join } from "node:path";

export type SessionWalDependencies = {
  createWriter(options: { root: string }): Promise<unknown>;
  registerLive(api: unknown, writer: unknown): void | Promise<void>;
};

/** Starts payload-free live WAL observation for a promoted tracked session. */
export async function setupSessionWal(
  {
    root,
    sessionId,
    api,
  }: {
    root: string;
    sessionId: string;
    api: unknown;
  },
  { createWriter, registerLive }: SessionWalDependencies,
): Promise<void> {
  try {
    const writer = await createWriter({
      root: join(root, "sessions", sessionId),
    });
    await registerLive(api, writer);
  } catch {
    // WAL setup is observer-only and must not alter Pi execution.
  }
}

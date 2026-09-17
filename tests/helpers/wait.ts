/**
 * Condition-based waiting for tests. A fixed delay is a guess at how long
 * detached work takes, and the guess fails on a slower runner while the
 * assertion reads a stale value; polling the condition the test actually needs
 * is deterministic and usually finishes sooner.
 *
 * Only a condition that does become `true` is waitable. An absence — a count
 * that must stay zero, a leak that must never appear — has no completion signal
 * while it holds, so it is asserted after a settle instead. A predicate that
 * throws rejects the wait immediately rather than retrying to the deadline.
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  description: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await condition()) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `timed out after ${timeoutMs}ms waiting for ${description}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

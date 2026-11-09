/**
 * Runs at most `limit` tasks at once; the rest wait and start in arrival order.
 * It bounds concurrency only. It holds no byte budget, so independent callers
 * share nothing but the number of simultaneous reads.
 */
export function createGate(
  limit: number,
): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async (task) => {
    if (active < limit) active++;
    // A finishing task hands its slot straight to the next waiter instead of
    // freeing it, so the limit holds whatever order the continuations run in.
    else await new Promise<void>((resume) => waiting.push(resume));
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next === undefined) active--;
      else next();
    }
  };
}

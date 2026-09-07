import type { Scope, SessionEntry } from "../core/events.ts";

export function selectScope(
  entries: readonly SessionEntry[],
  leafId: string | null,
  scope: Scope,
): SessionEntry[] {
  if (scope === "tree" || leafId === null) return [...entries];

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const path: SessionEntry[] = [];
  const visited = new Set<string>();
  let next = byId.get(leafId);
  while (next && !visited.has(next.id)) {
    path.push(next);
    visited.add(next.id);
    next = next.parentId === null ? undefined : byId.get(next.parentId);
  }
  return path.reverse();
}

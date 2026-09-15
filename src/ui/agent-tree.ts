import type { UiAgentRow } from "./ui-projection.ts";

/**
 * The execution topology of one selection's agent runs, as a pure projection
 * shared by the browser bundle and the offline snapshot.
 *
 * This module owns presentation structure only. It reads the parent verdict L2
 * already published and never re-decides it: `in-range` means the selected rows
 * carry the parent, `outside-range` means only the full report does,
 * `orchestration-run` means the parent is a run container that is not an agent,
 * `none` means no usable relationship, and `unknown` is L2's own boundary guard.
 * A verdict is never promoted, demoted, or turned into an agent row here.
 *
 * Two node kinds exist, and the difference is the point:
 *
 * - `run` is one materialized AgentRun;
 * - `container` is the run container a group of `orchestration-run` children
 *   share. It has no agent, status, model, or usage, because it is not an agent:
 *   the producer's container identity is not an AgentRun and is never published,
 *   so a container is keyed by a bounded Inspector-owned ordinal and rendered
 *   with neutral wording.
 *
 * A container with a single child is flattened into that child, because a group
 * node around one row adds no topology.
 */

/** Materialized runs below a node, and the states a summary must not hide. */
type Counts = {
  /** Materialized runs below this node, excluding the node itself. */
  descendants: number;
  /** Descendant runs whose published status is `failed`. */
  failed: number;
  /** Descendant runs whose published status is `interrupted`. */
  interrupted: number;
  /** Descendant runs that published no usage at all. */
  withoutUsage: number;
};

/** One materialized AgentRun and everything the tree nests beneath it. */
export type UiAgentTreeNode = Counts & {
  kind: "run";
  run: UiAgentRow;
  children: readonly UiAgentTreeNode[];
};

/** One run container: a grouping of children that share a parent identity. */
export type UiAgentTreeContainer = Counts & {
  kind: "container";
  /** Inspector-owned ordinal (`container-1`); never a producer run id. */
  key: string;
  /** The container's direct children, which are always materialized runs. */
  children: readonly UiAgentTreeNode[];
};

export type UiAgentTreeEntry = UiAgentTreeNode | UiAgentTreeContainer;

export type UiAgentForest = {
  entries: readonly UiAgentTreeEntry[];
};

/**
 * Whether a run's own row matched a filter, or whether it is only on the path to
 * a match. A renderer must show the difference: a context-only ancestor is kept
 * so a nested result stays attached to the topology that gives it meaning.
 */
export type UiAgentMatchState = "match" | "context";

export type UiAgentTreeFilteredRun = UiAgentTreeNode & {
  state: UiAgentMatchState;
  children: readonly UiAgentTreeFilteredRun[];
};

export type UiAgentTreeFilteredEntry =
  | UiAgentTreeFilteredRun
  | (Omit<UiAgentTreeContainer, "children"> & {
      children: readonly UiAgentTreeFilteredRun[];
    });

export type UiAgentForestView = {
  entries: readonly UiAgentTreeFilteredEntry[];
  /** Runs whose own row matched. */
  matched: number;
  /** Runs rendered: matches plus the ancestors kept as context. */
  shown: number;
  /** Runs in the forest, whether or not they are shown. */
  total: number;
  /** Shown runs that are ancestors of a match rather than matches. */
  context: number;
};

const EMPTY: Counts = {
  descendants: 0,
  failed: 0,
  interrupted: 0,
  withoutUsage: 0,
};

/** Bottom-up totals over already-built children, so no node is walked twice. */
function summarize(children: readonly UiAgentTreeNode[]): Counts {
  const counts = { ...EMPTY };
  for (const child of children) {
    counts.descendants += 1 + child.descendants;
    counts.failed += child.failed + (child.run.status === "failed" ? 1 : 0);
    counts.interrupted +=
      child.interrupted + (child.run.status === "interrupted" ? 1 : 0);
    counts.withoutUsage +=
      child.withoutUsage + (child.run.usage === null ? 1 : 0);
  }
  return counts;
}

/**
 * The runs that may be nested under their parent.
 *
 * A projection must terminate on any input, and a parent chain is producer data:
 * `in-range` says the parent row exists, not that the chain is acyclic. A run
 * whose chain of parents revisits a run is therefore not nested at all — it
 * stays a top-level entry with its own published verdict, which is honest, where
 * picking an arbitrary point to break the cycle would invent a topology.
 *
 * Bounded ceiling: this walks each run's chain once, so an N-run selection with
 * a chain of depth D costs O(N·D) and is never quadratic in practice (the
 * producer caps a publication's runs, and a real chain is a handful deep).
 */
function nestableRuns(
  runs: readonly UiAgentRow[],
  byId: ReadonlyMap<string, UiAgentRow>,
): ReadonlySet<string> {
  const nestable = new Set<string>();
  for (const run of runs) {
    if (run.parent !== "in-range" || run.parentId === null) continue;
    if (!byId.has(run.parentId)) continue;
    const chain = new Set<string>([run.id]);
    let cursor: string | null = run.parentId;
    let acyclic = true;
    while (cursor !== null) {
      if (chain.has(cursor)) {
        acyclic = false;
        break;
      }
      chain.add(cursor);
      const parent: UiAgentRow | undefined = byId.get(cursor);
      cursor =
        parent === undefined || parent.parent !== "in-range"
          ? null
          : parent.parentId;
    }
    if (acyclic) nestable.add(run.id);
  }
  return nestable;
}

/**
 * One selection's runs, as a forest rooted in the session.
 *
 * The session itself is not a node here: it is not an agent run, and both
 * renderers already hold the session's own summary fields. Every entry this
 * returns is either a materialized run or a run container.
 */
export function buildAgentForest(runs: readonly UiAgentRow[]): UiAgentForest {
  const byId = new Map(runs.map((row) => [row.id, row]));
  const nestable = nestableRuns(runs, byId);
  const childrenOf = new Map<string, UiAgentRow[]>();
  for (const row of runs) {
    if (!nestable.has(row.id) || row.parentId === null) continue;
    const siblings = childrenOf.get(row.parentId) ?? [];
    siblings.push(row);
    childrenOf.set(row.parentId, siblings);
  }

  const build = (row: UiAgentRow): UiAgentTreeNode => {
    const children = (childrenOf.get(row.id) ?? []).map(build);
    return { kind: "run", run: row, children, ...summarize(children) };
  };

  // Runs that share one run container group into a container, but only when the
  // group has more than one member; a group node around a single row says
  // nothing the row's own verdict does not already say.
  const groups = new Map<string, UiAgentRow[]>();
  for (const row of runs) {
    if (nestable.has(row.id)) continue;
    if (row.parent !== "orchestration-run" || row.parentId === null) continue;
    const members = groups.get(row.parentId) ?? [];
    members.push(row);
    groups.set(row.parentId, members);
  }

  const entries: UiAgentTreeEntry[] = [];
  const emitted = new Set<string>();
  let ordinal = 0;
  for (const row of runs) {
    if (nestable.has(row.id)) continue;
    if (row.parent !== "orchestration-run" || row.parentId === null) {
      entries.push(build(row));
      continue;
    }
    const members = groups.get(row.parentId) ?? [];
    if (members.length < 2) {
      entries.push(build(row));
      continue;
    }
    if (emitted.has(row.parentId)) continue;
    emitted.add(row.parentId);
    ordinal += 1;
    const children = members.map(build);
    entries.push({
      kind: "container",
      key: `container-${ordinal}`,
      children,
      ...summarize(children),
    });
  }
  return { entries };
}

/**
 * The forest narrowed to the runs a predicate accepts, with the ancestors those
 * runs need. A kept ancestor reports `context`, so a renderer can state that its
 * own row did not match instead of implying it did.
 */
export function filterAgentForest(
  forest: UiAgentForest,
  matches: (run: UiAgentRow) => boolean,
): UiAgentForestView {
  let matched = 0;
  let shown = 0;
  let total = 0;

  const keepRun = (node: UiAgentTreeNode): UiAgentTreeFilteredRun | null => {
    const children: UiAgentTreeFilteredRun[] = [];
    for (const child of node.children) {
      const kept = keepRun(child);
      if (kept !== null) children.push(kept);
    }
    const isMatch = matches(node.run);
    if (!isMatch && children.length === 0) return null;
    if (isMatch) matched += 1;
    shown += 1;
    return { ...node, children, state: isMatch ? "match" : "context" };
  };

  const entries: UiAgentTreeFilteredEntry[] = [];
  for (const entry of forest.entries) {
    if (entry.kind === "container") {
      const children: UiAgentTreeFilteredRun[] = [];
      for (const child of entry.children) {
        const kept = keepRun(child);
        if (kept !== null) children.push(kept);
      }
      if (children.length === 0) continue;
      entries.push({ ...entry, children });
      continue;
    }
    const kept = keepRun(entry);
    if (kept !== null) entries.push(kept);
  }

  const count = (nodes: readonly UiAgentTreeEntry[]): void => {
    for (const node of nodes) {
      // Only runs are counted: a container is where runs are grouped, not a run.
      if (node.kind === "container") count(node.children);
      else {
        total += 1;
        count(node.children);
      }
    }
  };
  count(forest.entries);
  return { entries, matched, shown, total, context: shown - matched };
}

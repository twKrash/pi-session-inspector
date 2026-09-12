import { join } from "node:path";
import { readCheckpoint } from "../storage/checkpoint.ts";
import { boundInventorySnapshot } from "../storage/inventory-snapshot.ts";
import { readFile } from "node:fs/promises";
import type { Scope } from "../core/events.ts";
import { reduceEntries } from "../core/reduce.ts";
import { toSessionReport } from "../core/reports.ts";
import { readPiEntryEvidence } from "../integrations/pi-entries.ts";
import { readSubagentEvidenceWithArchives } from "../integrations/subagents.ts";
import { parseSessionJsonl } from "../pi/adapter.ts";
import { resolveScope } from "../pi/scope.ts";
import { createCurrentTuiModel, type CurrentTuiModel } from "./current.ts";
import type { SessionObservation } from "./observation.ts";

/** Options for {@link loadCurrentSessionReport}; one object so later wiring cannot mis-bind. */
export type LoadCurrentSessionReportOptions = {
  leafId: string | null;
  observation?: SessionObservation;
  inspectorRoot?: string;
};

/** Replays a persisted current session into the renderer-neutral TUI model. */
export async function loadCurrentSessionReport(
  sessionFile: string | undefined,
  scope: Scope,
  options: LoadCurrentSessionReportOptions,
): Promise<CurrentTuiModel | undefined> {
  if (!sessionFile) return undefined;
  const { leafId, observation, inspectorRoot } = options;

  try {
    const session = parseSessionJsonl(await readFile(sessionFile, "utf8"));
    if (!session.hasSessionHeader || session.hasMalformedJson) return undefined;
    // The authoritative scope resolution is the gate: no tracking boundary, an
    // unusable marker id, or an unresolvable active leaf means the current
    // report is unavailable, never an all-zero report.
    const resolution = resolveScope(
      session.entries,
      session.graphNodes,
      leafId,
      scope,
    );
    if (resolution.state === "unavailable") return undefined;
    // The entry list is derived from the authoritative resolution, not
    // `selectScope` (which rebuilds nodes from known entries only and can
    // return `[]` when the active leaf is structurally valid but unknown).
    // This preserves the resolution order exactly and keeps only entries the
    // reducer understands, so an unknown active leaf degrades to the
    // understood facts on its path instead of a fabricated all-zero report.
    const byId = new Map(session.entries.map((entry) => [entry.id, entry]));
    const entries = resolution.entryIds.flatMap((id) => {
      const entry = byId.get(id);
      return entry === undefined ? [] : [entry];
    });
    const checkpoint =
      inspectorRoot === undefined
        ? undefined
        : await readCheckpoint({
            directory: join(inspectorRoot, "sessions", session.id),
          });
    // Subagent runs are auto-discovered from persisted tool results; the
    // evidence usage stays a child-agent breakdown, never a session total.
    // Only validated published archive references add presence evidence.
    const subagentEvidence = await readSubagentEvidenceWithArchives(entries);
    return createCurrentTuiModel(
      toSessionReport(reduceEntries(session.id, entries), {
        ...(Object.values(
          checkpoint?.sealingVersion === 1 ? (checkpoint.sealedWal ?? {}) : {},
        ).some((cursor) => cursor > 0)
          ? { walDetail: "expired" as const }
          : {}),
        agents: {
          state: subagentEvidence.state,
          runs: subagentEvidence.runs,
        },
        agentActivity: subagentEvidence.activity,
        presence: observation?.presence,
        counters: observation?.counters,
        // The in-memory snapshot is the unbounded read; consume the same bounded
        // form the writer persists so reports never include trimmed descriptions.
        inventory:
          observation?.inventory === undefined
            ? undefined
            : boundInventorySnapshot(observation.inventory),
        integrations: readPiEntryEvidence(entries),
      }),
      scope,
    );
  } catch {
    return undefined;
  }
}

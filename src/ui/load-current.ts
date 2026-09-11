import { join } from "node:path";
import { readCheckpoint } from "../storage/checkpoint.ts";
import { boundInventorySnapshot } from "../storage/inventory-snapshot.ts";
import { readFile } from "node:fs/promises";
import type { Scope } from "../core/events.ts";
import { reduceEntries } from "../core/reduce.ts";
import { toSessionReport } from "../core/reports.ts";
import { readPiEntryEvidence } from "../integrations/pi-entries.ts";
import { readSubagentRuns } from "../integrations/subagents.ts";
import { parseSessionJsonl } from "../pi/adapter.ts";
import { selectScope } from "../pi/sessions.ts";
import { createCurrentTuiModel, type CurrentTuiModel } from "./current.ts";
import type { SessionObservation } from "./observation.ts";

/** Options for {@link loadCurrentSessionReport}; one object so later wiring cannot mis-bind. */
export type LoadCurrentSessionReportOptions = {
  leafId: string | null;
  observation?: SessionObservation;
  inspectorRoot?: string;
  subagentArtifact?: unknown;
};

/** Replays a persisted current session into the renderer-neutral TUI model. */
export async function loadCurrentSessionReport(
  sessionFile: string | undefined,
  scope: Scope,
  options: LoadCurrentSessionReportOptions,
): Promise<CurrentTuiModel | undefined> {
  if (!sessionFile) return undefined;
  const { leafId, observation, inspectorRoot, subagentArtifact } = options;

  try {
    const session = parseSessionJsonl(await readFile(sessionFile, "utf8"));
    if (!session.hasSessionHeader || session.hasMalformedJson) return undefined;
    if (
      scope === "active" &&
      (leafId === null || !session.entries.some((entry) => entry.id === leafId))
    ) {
      return undefined;
    }
    const checkpoint =
      inspectorRoot === undefined
        ? undefined
        : await readCheckpoint({
            directory: join(inspectorRoot, "sessions", session.id),
          });
    const entries = selectScope(session.entries, leafId, scope);
    return createCurrentTuiModel(
      toSessionReport(reduceEntries(session.id, entries), {
        ...(Object.values(
          checkpoint?.sealingVersion === 1 ? (checkpoint.sealedWal ?? {}) : {},
        ).some((cursor) => cursor > 0)
          ? { walDetail: "expired" as const }
          : {}),
        agents: readSubagentRuns(subagentArtifact),
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

import { readFile } from "node:fs/promises";
import type { Scope } from "../core/events.ts";
import { reduceEntries } from "../core/reduce.ts";
import { toSessionReport } from "../core/reports.ts";
import { readPiEntryEvidence } from "../integrations/pi-entries.ts";
import { readSubagentRuns } from "../integrations/subagents.ts";
import { parseSessionJsonl } from "../pi/adapter.ts";
import { selectScope } from "../pi/sessions.ts";
import { createCurrentTuiModel, type CurrentTuiModel } from "./current.ts";

/** Replays a persisted current session into the renderer-neutral TUI model. */
export async function loadCurrentSessionReport(
  sessionFile: string | undefined,
  scope: Scope,
  leafId: string | null,
  subagentArtifact?: unknown,
): Promise<CurrentTuiModel | undefined> {
  if (!sessionFile) return undefined;

  try {
    const session = parseSessionJsonl(await readFile(sessionFile, "utf8"));
    if (!session.hasSessionHeader || session.hasMalformedJson) return undefined;
    if (
      scope === "active" &&
      (leafId === null || !session.entries.some((entry) => entry.id === leafId))
    ) {
      return undefined;
    }
    const entries = selectScope(session.entries, leafId, scope);
    return createCurrentTuiModel(
      toSessionReport(reduceEntries(session.id, entries), {
        agents: readSubagentRuns(subagentArtifact),
        integrations: readPiEntryEvidence(entries),
      }),
      scope,
    );
  } catch {
    return undefined;
  }
}

import { reduceEntries } from "../../src/core/reduce.ts";
import { toSessionReport, type SessionReport } from "../../src/core/reports.ts";
import type { SessionEntry } from "../../src/core/events.ts";
import type { InspectorBundleInput } from "../../src/ui/bundle.ts";
import {
  createCurrentTuiModel,
  type CurrentTuiModel,
} from "../../src/ui/current.ts";

/**
 * The shared scenario helpers the L2 projection, snapshot and privacy suites
 * read: one base bundle input and the few tool scenarios whose persisted rows a
 * projection assertion pins. They are defined once here so a scenario is never
 * hand-built twice and cannot drift between tests.
 */

/**
 * The producer-only fields no report, UI payload or document may carry. One
 * list, shared by the payload-key scan and the privacy corpus, so the two
 * suites cannot drift; `sessionName` is the producer's session label (spec
 * §18.7), a raw unbounded string this projection never reads.
 */
export const FORBIDDEN_PRODUCER_KEYS = [
  "task",
  "finalOutput",
  "progressSummary",
  "transcriptPath",
  "artifactPaths",
  "sessionFile",
  "sessionName",
] as const;

/**
 * The one base bundle input the projection tests load: history and global are
 * explicit unavailable sections, so a test never touches the filesystem.
 */
export const bundleInput: InspectorBundleInput = {
  theme: "dark",
  initialScope: "active",
  root: "/inspector-root",
  sessionDirectory: () => "/pi-sessions",
  maintenance: {
    writerId: "bundle-scenarios",
    now: () => new Date("2026-02-02T00:00:00.000Z"),
    isPidAlive: () => false,
  },
  loadHistory: async () => ({
    availability: "unavailable",
    sessions: [],
    diagnostics: [],
  }),
  loadGlobal: async () => ({
    availability: "unavailable",
    sessions: [],
    usage: { totalTokens: 0, cost: 0 },
    dates: [],
    diagnostics: [],
    inventory: { commands: null, skills: null, resources: null },
  }),
};

/** The session every scenario replays; the value is never a pinned field. */
const SESSION_ID = "session-scenarios";

/** A call made one day whose result is observed on the next (spec §5.7). */
const CALLED_AT = "2026-02-01T23:59:00.000Z";
const OBSERVED_AT = "2026-02-02T00:01:00.000Z";

/** The producer's persisted usage shape, exactly as the reducer reads it. */
type ProducerUsage = {
  totalTokens: number;
  cost: { total: number };
};

type Call = {
  callId: string;
  name: string;
  calledAt?: string;
  resultAt?: string;
  isError?: boolean;
  usage?: ProducerUsage;
};

/** One assistant tool call plus its persisted result, as Pi records them. */
function callEntries(calls: readonly Call[]): SessionEntry[] {
  return calls.flatMap((call) => {
    const calledAt = call.calledAt ?? CALLED_AT;
    return [
      {
        id: `call-${call.callId}`,
        parentId: null,
        timestamp: calledAt,
        type: "message",
        message: {
          role: "assistant",
          provider: "acme",
          model: "alpha",
          content: [
            {
              type: "toolCall",
              id: call.callId,
              name: call.name,
            },
          ],
        },
      },
      {
        id: `result-${call.callId}`,
        parentId: `call-${call.callId}`,
        timestamp: call.resultAt ?? OBSERVED_AT,
        type: "message",
        message: {
          role: "toolResult",
          toolCallId: call.callId,
          toolName: call.name,
          isError: call.isError === true,
          content: [],
          ...(call.usage === undefined ? {} : { usage: call.usage }),
        },
      },
    ];
  });
}

function reportWith(calls: readonly Call[]): SessionReport {
  return toSessionReport(reduceEntries(SESSION_ID, callEntries(calls)));
}

function modelOf(report: SessionReport): CurrentTuiModel {
  return createCurrentTuiModel(report, "tree");
}

/**
 * Native tool calls only: one succeeded call carrying usage and one failed call
 * whose persisted error record joins it by the canonical tool id. The read call
 * sits on a later UTC day than every other scenario's call, so a tools test can
 * pin the summary's last-used instant against the persisted timestamp.
 */
export function currentModelWithTools(): CurrentTuiModel {
  return modelOf(
    reportWith([
      {
        callId: "call_read",
        name: "read",
        calledAt: "2026-03-01T10:00:00.000Z",
        resultAt: "2026-03-01T10:00:01.000Z",
        usage: { totalTokens: 180, cost: { total: 0.04 } },
      },
      {
        callId: "call_bash",
        name: "bash",
        calledAt: CALLED_AT,
        resultAt: OBSERVED_AT,
        isError: true,
      },
    ]),
  );
}

/**
 * One name whose older call is persisted after its newer one, so the summary's
 * `lastUsed` can only be the maximum timestamp: an implementation taking the
 * last row's timestamp would report the older instant.
 */
export function currentModelWithOutOfOrderToolCalls(): CurrentTuiModel {
  return modelOf(
    reportWith([
      {
        callId: "call_read_1",
        name: "read",
        calledAt: "2026-02-01T10:00:09.000Z",
        resultAt: "2026-02-01T10:00:10.000Z",
      },
      {
        callId: "call_read_2",
        name: "read",
        calledAt: "2026-02-01T10:00:00.000Z",
        resultAt: "2026-02-01T10:00:01.000Z",
      },
    ]),
  );
}

/** One failed bash call with no child run: the error join's negative case. */
export function modelWithToolError(): CurrentTuiModel {
  return modelOf(
    reportWith([{ callId: "call_bash", name: "bash", isError: true }]),
  );
}

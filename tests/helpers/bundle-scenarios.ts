import { reduceEntries } from "../../src/core/reduce.ts";
import {
  toSessionReport,
  type AgentToolActivity,
  type SessionReport,
} from "../../src/core/reports.ts";
import type { AgentRun, SessionEntry } from "../../src/core/events.ts";
import type { InspectorBundleInput } from "../../src/ui/bundle.ts";
import {
  createCurrentTuiModel,
  type CurrentTuiModel,
} from "../../src/ui/current.ts";

/**
 * The shared decode-and-scenario helpers for the browser-payload row tests
 * (Tasks 8-11 read the same projected rows). They are defined once here so a
 * scenario is never hand-built twice and cannot drift between tests.
 */

/**
 * The one embedded-payload decoder every browser-payload test shares: the same
 * regex the document emits its payload with, so an assertion reads exactly what
 * the browser would. Sections are heterogeneous JSON and each test reads only
 * the fields it pins.
 */
// biome-ignore lint/suspicious/noExplicitAny: decoding the embedded JSON in tests
export function embedOf(html: string): Record<string, any> {
  const match =
    /<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/.exec(
      html,
    );
  return JSON.parse(match?.[1] ?? "{}");
}

/**
 * The one base bundle input the row tests load: history and global are explicit
 * unavailable sections, so a test never touches the filesystem and the document
 * stays byte-identical for identical inputs.
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
          content: [{ type: "toolCall", id: call.callId, name: call.name }],
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

/** One bounded agent run, so a scenario pins exactly the fields it declares. */
function agentRun(run: Partial<AgentRun> & { id: string }): AgentRun {
  return {
    status: "succeeded",
    confidence: "cooperative",
    ...run,
  };
}

function reportWith(
  calls: readonly Call[],
  runs: readonly AgentRun[],
  activity?: AgentToolActivity,
): SessionReport {
  return toSessionReport(reduceEntries(SESSION_ID, callEntries(calls)), {
    ...(activity === undefined ? {} : { agentActivity: activity }),
    ...(runs.length === 0
      ? {}
      : { agents: { state: "supported" as const, runs } }),
  });
}

/**
 * One dated native child-launching call, so every scenario's session has an
 * observed span and its tool side is never empty.
 */
const CHILD_CALL: Call = {
  callId: "call_subagent",
  name: "subagent",
  calledAt: CALLED_AT,
  resultAt: OBSERVED_AT,
};

/** The bounded producer-shaped run id grammar, one id per ordinal. */
function runId(ordinal: number): string {
  return `subagent-${ordinal.toString(16).padStart(64, "0")}`;
}

function modelOf(
  report: SessionReport,
  scope: "active" | "tree",
): CurrentTuiModel {
  return createCurrentTuiModel(report, scope);
}

/**
 * Native tool calls only: one succeeded call carrying usage and one failed call
 * whose persisted error record joins it by the canonical tool id.
 */
export function currentModelWithTools(): CurrentTuiModel {
  return modelOf(
    reportWith(
      [
        {
          callId: "call_read",
          name: "read",
          calledAt: "2026-02-01T10:00:00.000Z",
          resultAt: "2026-02-01T10:00:01.000Z",
          usage: { totalTokens: 180, cost: { total: 0.04 } },
        },
        {
          callId: "call_bash",
          name: "bash",
          calledAt: CALLED_AT,
          resultAt: OBSERVED_AT,
          isError: true,
        },
      ],
      [],
    ),
    "tree",
  );
}

/**
 * Tool calls plus two child runs: the first publishes every optional field, the
 * second publishes none, so a row test can pin both the values and the nulls.
 */
export function currentModelWithAgents(): CurrentTuiModel {
  return modelOf(
    reportWith(
      [
        {
          callId: "call_subagent",
          name: "subagent",
          calledAt: "2026-02-01T09:00:00.000Z",
          resultAt: "2026-02-01T09:00:05.000Z",
        },
      ],
      [
        agentRun({
          id: `subagent-${"a".repeat(64)}`,
          agent: "reviewer",
          artifacts: "available",
          observedAt: OBSERVED_AT,
          evidenceToolId: "tool:call_subagent",
          model: "alpha",
          thinking: "high",
          failure: { reason: "exit-nonzero", detail: 1 },
          usage: { totalTokens: 50, cost: 0.01 },
        }),
        agentRun({ id: `subagent-${"b".repeat(64)}`, status: "unknown" }),
      ],
    ),
    "tree",
  );
}

/**
 * The design's acceptance fixture (§7.7-1): `calls` native child-launching
 * calls beside `runs` projected child runs, `runsWithUsage` of which reported
 * usage. The activity counts enter as validated evidence exactly as the
 * adapter's do, and the session carries one dated native call.
 */
export function modelWithActivityAndRuns(input: {
  calls: number;
  runs: number;
  runsWithUsage: number;
}): CurrentTuiModel {
  const runs: AgentRun[] = [];
  for (let ordinal = 0; ordinal < input.runs; ordinal++) {
    runs.push(
      agentRun({
        id: runId(ordinal),
        observedAt: OBSERVED_AT,
        ...(ordinal < input.runsWithUsage
          ? { usage: { totalTokens: 5, cost: 0.05 } }
          : {}),
      }),
    );
  }
  return modelOf(
    reportWith([CHILD_CALL], runs, {
      state: "supported",
      calls: input.calls,
      succeeded: input.calls,
      failed: 0,
      interrupted: 0,
      tools: [{ name: "subagent", calls: input.calls }],
    }),
    "tree",
  );
}

/** One child run per given status, so every bucket is non-zero and distinct. */
export function modelWithStatuses(
  statuses: readonly AgentRun["status"][],
): CurrentTuiModel {
  return modelOf(
    reportWith(
      [CHILD_CALL],
      statuses.map((status, ordinal) =>
        agentRun({ id: runId(ordinal), status, observedAt: OBSERVED_AT }),
      ),
    ),
    "tree",
  );
}

/** The parent the active projection excludes, and the child that names it. */
const OUT_OF_SCOPE_PARENT = runId(1);
const ORPHAN_CHILD = runId(2);

/**
 * The active projection of a session whose child run named a parent the active
 * path excludes: the parent is known to the session, but only in the tree
 * projection (§7.4's middle verdict).
 */
export function modelWithOrphanChild(): CurrentTuiModel {
  return modelOf(
    reportWith(
      [CHILD_CALL],
      [
        agentRun({
          id: ORPHAN_CHILD,
          parentId: OUT_OF_SCOPE_PARENT,
          observedAt: OBSERVED_AT,
        }),
      ],
    ),
    "active",
  );
}

/** The same session's tree projection, which carries the parent too. */
export function modelWithOrphanChildAndParent(): CurrentTuiModel {
  return modelOf(
    reportWith(
      [CHILD_CALL],
      [
        agentRun({
          id: OUT_OF_SCOPE_PARENT,
          agent: "reviewer",
          observedAt: OBSERVED_AT,
        }),
        agentRun({
          id: ORPHAN_CHILD,
          parentId: OUT_OF_SCOPE_PARENT,
          observedAt: OBSERVED_AT,
        }),
      ],
    ),
    "tree",
  );
}

/** One failed bash call with no child run: the error join's negative case. */
export function modelWithToolError(): CurrentTuiModel {
  return modelOf(
    reportWith([{ callId: "call_bash", name: "bash", isError: true }], []),
    "tree",
  );
}

/**
 * One failed bash call whose publishing result observed two child runs, so the
 * error join is proven one-to-many with no causal claim.
 */
export function modelWithToolErrorAndTwoChildren(): CurrentTuiModel {
  return modelOf(
    reportWith(
      [{ callId: "call_bash", name: "bash", isError: true }],
      [
        agentRun({
          id: `subagent-${"a".repeat(64)}`,
          observedAt: OBSERVED_AT,
          evidenceToolId: "tool:call_bash",
        }),
        agentRun({
          id: `subagent-${"b".repeat(64)}`,
          observedAt: OBSERVED_AT,
          evidenceToolId: "tool:call_bash",
        }),
      ],
    ),
    "tree",
  );
}

import { reduceEntries } from "../../src/core/reduce.ts";
import {
  toSessionReport,
  type AgentToolActivity,
  type SessionReport,
  type SessionReportEvidence,
} from "../../src/core/reports.ts";
import type { AgentRun, SessionEntry } from "../../src/core/events.ts";
import type {
  CommandRow,
  InventorySnapshot,
  ResourceSourceRow,
  SkillRow,
} from "../../src/integrations/inventory.ts";
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
  /**
   * Hostile producer argument payload and result body, planted exactly as Pi
   * persists them. Neither is a pinned output: they exist so a privacy test can
   * prove no tool view ever reads a field outside the bounded row set.
   */
  input?: unknown;
  resultText?: string;
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
              ...(call.input === undefined ? {} : { input: call.input }),
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
          content:
            call.resultText === undefined
              ? []
              : [{ type: "text", text: call.resultText }],
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
  evidence?: SessionReportEvidence,
): SessionReport {
  return toSessionReport(reduceEntries(SESSION_ID, callEntries(calls)), {
    ...(activity === undefined ? {} : { agentActivity: activity }),
    ...(runs.length === 0
      ? {}
      : { agents: { state: "supported" as const, runs } }),
    ...(evidence ?? {}),
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
 * whose persisted error record joins it by the canonical tool id. The read call
 * sits on a later UTC day than every other scenario's call, so a tools test can
 * pin the summary's last-used instant against the persisted timestamp.
 */
export function currentModelWithTools(): CurrentTuiModel {
  return modelOf(
    reportWith(
      [
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
      ],
      [],
    ),
    "tree",
  );
}

/**
 * One tool name called three times where only the first call persisted usage:
 * the summary must state `1 of 3` instead of extrapolating the one known value
 * to the whole call set.
 */
export function currentModelWithPartialToolUsage(): CurrentTuiModel {
  return modelOf(
    reportWith(
      [
        {
          callId: "call_read_1",
          name: "read",
          calledAt: "2026-02-01T10:00:00.000Z",
          resultAt: "2026-02-01T10:00:01.000Z",
          usage: { totalTokens: 180, cost: { total: 0.04 } },
        },
        {
          callId: "call_read_2",
          name: "read",
          calledAt: "2026-02-01T10:00:05.000Z",
          resultAt: "2026-02-01T10:00:06.000Z",
        },
        {
          callId: "call_read_3",
          name: "read",
          calledAt: "2026-02-01T10:00:09.000Z",
          resultAt: "2026-02-01T10:00:10.000Z",
          isError: true,
        },
      ],
      [],
    ),
    "tree",
  );
}

/**
 * Two tool names where only one is partial: `read` reported usage in one of its
 * three calls while `bash` reported it in its only call, so the panel's own
 * fraction (`2 of 4`) can never stand in for the row's (`1 of 3`).
 */
export function currentModelWithMixedToolUsage(): CurrentTuiModel {
  return modelOf(
    reportWith(
      [
        {
          callId: "call_read_1",
          name: "read",
          calledAt: "2026-02-01T10:00:00.000Z",
          resultAt: "2026-02-01T10:00:01.000Z",
          usage: { totalTokens: 180, cost: { total: 0.04 } },
        },
        {
          callId: "call_read_2",
          name: "read",
          calledAt: "2026-02-01T10:00:05.000Z",
          resultAt: "2026-02-01T10:00:06.000Z",
        },
        {
          callId: "call_read_3",
          name: "read",
          calledAt: "2026-02-01T10:00:09.000Z",
          resultAt: "2026-02-01T10:00:10.000Z",
        },
        {
          callId: "call_bash_1",
          name: "bash",
          calledAt: "2026-02-01T09:00:00.000Z",
          resultAt: "2026-02-01T09:00:01.000Z",
          usage: { totalTokens: 20, cost: { total: 0.01 } },
        },
      ],
      [],
    ),
    "tree",
  );
}

/**
 * One name whose older call is persisted after its newer one, so the summary's
 * `lastUsed` can only be the maximum timestamp: an implementation taking the
 * last row's timestamp would report the older instant.
 */
export function currentModelWithOutOfOrderToolCalls(): CurrentTuiModel {
  return modelOf(
    reportWith(
      [
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
      ],
      [],
    ),
    "tree",
  );
}

/**
 * The persisted call whose argument payload and result body both carry hostile
 * sentinels. It is one record so the model and the raw entries cannot drift.
 */
const HOSTILE_CALL: Call = {
  callId: "call_read",
  name: "read",
  input: {
    path: "/home/dev/SECRET_ARGUMENT/notes.md",
    command: "cat SECRET_ARGUMENT",
  },
  resultText: "SECRET_RESULT: file body",
};

/**
 * One call whose persisted argument payload and result body carry hostile
 * sentinels: the tool rows are built from named bounded fields only, so neither
 * sentinel can reach any tools view.
 */
export function currentModelWithHostileToolArguments(): CurrentTuiModel {
  return modelOf(reportWith([HOSTILE_CALL], []), "tree");
}

/**
 * The same scenario's raw persisted entries, so a privacy test can prove the
 * sentinels were planted and the projection is what dropped them.
 */
export function hostileToolArgumentEntries(): SessionEntry[] {
  return callEntries([HOSTILE_CALL]);
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

/**
 * One failed bash call whose publishing result observed three child runs, each
 * with its own role, so the error join is proven one-to-many over the common
 * `subagent` case and the rendered list names none of them as the cause.
 */
export function modelWithErrorAndThreeChildren(): CurrentTuiModel {
  return modelOf(
    reportWith(
      [{ callId: "call_bash", name: "bash", isError: true }],
      ["reviewer", "researcher", "validator"].map((agent, index) =>
        agentRun({
          id: runId(index + 1),
          agent,
          observedAt: OBSERVED_AT,
          evidenceToolId: "tool:call_bash",
        }),
      ),
    ),
    "tree",
  );
}

/**
 * One failed generation, with the persisted message a caller passes through the
 * reducer: a test can never assert a message the reducer would have dropped for
 * being unusable. Omitting the message is the `Message: Unavailable` case.
 */
export function modelWithGenerationError(message?: string): CurrentTuiModel {
  return modelOf(
    toSessionReport(
      reduceEntries(SESSION_ID, [
        ...callEntries([CHILD_CALL]),
        {
          id: "g-error",
          parentId: null,
          timestamp: OBSERVED_AT,
          type: "message",
          message: {
            role: "assistant",
            provider: "acme",
            model: "alpha",
            content: [],
            stopReason: "error",
            ...(message === undefined ? {} : { errorMessage: message }),
          },
        },
      ]),
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

/** One bounded inventory command row: the producer grammar, never a path. */
function commandInventoryRows(count: number): CommandRow[] {
  const rows: CommandRow[] = [];
  for (let ordinal = 1; ordinal <= count; ordinal++) {
    rows.push({
      name: `cmd-${ordinal}`,
      source: "extension",
      sourceLabel: "npm:pi-commands",
      scope: "user",
      origin: "package",
    });
  }
  return rows;
}

/** One bounded inventory skill row; the first is the explicitly invoked name. */
function skillInventoryRows(count: number): SkillRow[] {
  const rows: SkillRow[] = [];
  for (let ordinal = 1; ordinal <= count; ordinal++) {
    rows.push({
      name: ordinal === 1 ? "council-mode" : `skill-${ordinal}`,
      sourceLabel: "npm:pi-skills",
      scope: "user",
      origin: "package",
    });
  }
  return rows;
}

/** The bounded source labels the sanitizer passes through unchanged. */
const RESOURCE_SOURCE_LABELS = ["local", "auto", "builtin", "sdk"] as const;

/** One resource-source row per source label, with per-source inventory counts. */
function resourceInventoryRows(count: number): ResourceSourceRow[] {
  const rows: ResourceSourceRow[] = [];
  for (let ordinal = 0; ordinal < count; ordinal++) {
    rows.push({
      sourceLabel:
        RESOURCE_SOURCE_LABELS[ordinal % RESOURCE_SOURCE_LABELS.length],
      scope: "user",
      origin: "package",
      commands: ordinal,
      skills: ordinal === 0 ? 2 : 0,
      prompts: 0,
      tools: 0,
    });
  }
  return rows;
}

/**
 * Design §8.1's environment: 119 commands, 42 skills and 11 resource sources
 * alongside the explicit folded counters that are the only invocation evidence
 * (`council-mode: 2` plus one other invocation). Commands carry no counter
 * evidence at all, so their observed-invocation side is Unavailable.
 */
export function modelWithInventory(): CurrentTuiModel {
  const inventory: InventorySnapshot = {
    schemaVersion: 1,
    commands: commandInventoryRows(119),
    skills: skillInventoryRows(42),
    resources: resourceInventoryRows(11),
    toolSources: {},
  };
  return modelOf(
    reportWith([CHILD_CALL], [], undefined, {
      inventory,
      counters: {
        counters: {},
        skillInvocations: { "council-mode": 2 },
        otherInvocations: 1,
        presence: { permission: false },
      },
    }),
    "tree",
  );
}

/**
 * Design §8.2's four independent columns: a definite detection with supported
 * telemetry (including an observed `false` counter, shown verbatim), an unknown
 * detection with supported telemetry, and rows whose telemetry is unsupported
 * or unavailable with no persisted counters at all.
 */
export function modelWithIntegrations(): CurrentTuiModel {
  return modelOf(
    reportWith([CHILD_CALL], [], undefined, {
      integrations: [
        {
          integration: "context",
          presence: "present",
          version: 1,
          state: "supported",
          counters: { calls: 2 },
        },
        {
          integration: "rtk",
          presence: "unknown",
          version: 1,
          state: "supported",
          counters: { compactions: 4, truncated: false },
        },
        {
          integration: "ponytail",
          presence: "absent",
          version: 1,
          state: "unsupported",
        },
        { integration: "caveman", presence: "absent", state: "unavailable" },
        { integration: "lens", presence: "present", state: "unavailable" },
      ],
    }),
    "tree",
  );
}

/**
 * ADR 0009/0014's contradiction case: `ponytail` is absent from the current
 * inventory while its persisted telemetry is supported with counters, and
 * `caveman` is absent with no telemetry evidence at all. Detection and
 * telemetry stay independent and neither row is dropped or reconciled.
 */
export function modelWithAbsentDetectedTelemetry(): CurrentTuiModel {
  return modelOf(
    reportWith([CHILD_CALL], [], undefined, {
      integrations: [
        {
          integration: "ponytail",
          presence: "absent",
          version: 1,
          state: "supported",
          counters: { changes: 0 },
        },
        { integration: "caveman", presence: "absent", state: "unavailable" },
      ],
    }),
    "tree",
  );
}

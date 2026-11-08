import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  AgentRun,
  AgentRunSourceObservation,
  ChildSessionProjection,
  SubagentSourceEvidence,
} from "../../src/core/events.ts";
import { applyChildSessionProjections } from "../../src/integrations/subagent-child-enrichment.ts";

const LAUNCH = "source-launch";
const NOTICE = "source-notice";
const unavailable: AgentRun["effortCoverage"] = {
  duration: "unavailable",
  generations: "unavailable",
  tools: "unavailable",
  errors: "unavailable",
  usage: "unavailable",
  cost: "unavailable",
};

const observation = (
  sourceIdentity: string,
  run: Partial<AgentRun> = {},
  order = 0,
): AgentRunSourceObservation => ({
  sourceIdentity,
  order,
  run: {
    id: "run-1",
    status: "succeeded",
    confidence: "cooperative",
    effortCoverage: unavailable,
    ...run,
  },
});

const evidenceOf = (
  observations: AgentRunSourceObservation[],
  aliases: SubagentSourceEvidence["aliases"] = [],
): SubagentSourceEvidence => ({
  activity: {
    state: "supported",
    calls: 0,
    succeeded: 0,
    failed: 0,
    interrupted: 0,
    tools: [],
  },
  observations,
  aliases,
  state: "supported",
  diagnostics: [],
});

const projection = (
  overrides: Partial<ChildSessionProjection> = {},
): ChildSessionProjection => ({
  usage: {
    totalTokens: 100,
    cost: 0.5,
    inputTokens: 60,
    outputTokens: 40,
    inputCost: 0.2,
    outputCost: 0.3,
  },
  usageCoverage: "complete",
  model: "child-model",
  toolCalls: 3,
  ...overrides,
});

const apply = (
  observations: AgentRunSourceObservation[],
  projections: [string, ChildSessionProjection][] = [[LAUNCH, projection()]],
  aliases?: SubagentSourceEvidence["aliases"],
) => [
  ...applyChildSessionProjections(
    evidenceOf(observations, aliases),
    new Map(projections),
  ).observations,
];

test("absent model, tools, tokens, and costs are filled as partial coverage", () => {
  const [filled] = apply([observation(LAUNCH)]);
  assert.equal(filled?.run.model, "child-model");
  assert.equal(filled?.run.toolCalls, 3);
  assert.deepEqual(filled?.run.usage, {
    totalTokens: 100,
    cost: 0.5,
    inputTokens: 60,
    outputTokens: 40,
    inputCost: 0.2,
    outputCost: 0.3,
  });
  assert.equal(filled?.run.effortCoverage.usage, "partial");
  assert.equal(filled?.run.effortCoverage.cost, "partial");
  assert.equal(filled?.run.effortCoverage.tools, "partial");
  assert.equal(filled?.run.effortCoverage.duration, "unavailable");
  assert.equal(filled?.run.id, "run-1");
  assert.equal(filled?.run.status, "succeeded");
});

test("a persisted field is never overwritten", () => {
  const [kept] = apply([
    observation(LAUNCH, {
      model: "persisted-model",
      toolCalls: 9,
      usage: { totalTokens: 5, inputCost: 1 },
      effortCoverage: { ...unavailable, usage: "partial", cost: "partial" },
    }),
  ]);
  assert.equal(kept?.run.model, "persisted-model");
  assert.equal(kept?.run.toolCalls, 9);
  assert.equal(kept?.run.usage?.totalTokens, 5);
  assert.equal(kept?.run.usage?.inputCost, 1);
  assert.equal(kept?.run.usage?.cost, 0.5, "an absent field is still filled");
});

test("a field persisted on a sibling observation of the same run blocks the fill", () => {
  const aliases = [
    { sourceIdentity: LAUNCH, canonicalIdentity: "c", publicId: "run-1" },
    { sourceIdentity: NOTICE, canonicalIdentity: "c", publicId: "run-1" },
  ];
  const [launch, notice] = apply(
    [
      observation(LAUNCH, { id: "launch-id" }, 0),
      observation(NOTICE, { id: "notice-id", model: "persisted-model" }, 1),
    ],
    [[LAUNCH, projection()]],
    aliases,
  );
  assert.equal(launch?.run.model, undefined);
  assert.equal(launch?.run.toolCalls, 3);
  assert.equal(notice?.run.model, "persisted-model");
});

const GROUP = [
  { sourceIdentity: LAUNCH, canonicalIdentity: "c", publicId: "run-1" },
  { sourceIdentity: NOTICE, canonicalIdentity: "c", publicId: "run-1" },
];

test("every observation of the run carries the same merged usage", () => {
  const [launch, later] = apply(
    [
      observation(LAUNCH, { id: "launch-id" }, 0),
      observation(NOTICE, { id: "later-id", usage: { cost: 9 } }, 1),
    ],
    [[LAUNCH, projection()]],
    GROUP,
  );
  const expected = {
    totalTokens: 100,
    cost: 9,
    inputTokens: 60,
    outputTokens: 40,
    inputCost: 0.2,
    outputCost: 0.3,
  };
  assert.deepEqual(
    launch?.run.usage,
    expected,
    "the launch holds the fill and the persisted cost",
  );
  assert.deepEqual(
    later?.run.usage,
    expected,
    "the later publication keeps the fill",
  );
  assert.notEqual(
    later?.run.usage,
    launch?.run.usage,
    "each holds its own copy",
  );
});

test("the latest observation decides each persisted usage field, an earlier one fills the gaps", () => {
  const [first, second] = apply(
    [
      observation(LAUNCH, { id: "a", usage: { totalTokens: 7, cost: 1 } }, 0),
      observation(NOTICE, { id: "b", usage: { cost: 2 } }, 1),
    ],
    [
      [
        LAUNCH,
        projection({ usage: { totalTokens: 100, cost: 3, inputTokens: 5 } }),
      ],
    ],
    GROUP,
  );
  for (const row of [first, second]) {
    assert.deepEqual(row?.run.usage, {
      totalTokens: 7,
      cost: 2,
      inputTokens: 5,
    });
  }
});

test("observation order, not iteration order, decides which persisted value is latest", () => {
  const rows = [
    observation(NOTICE, { id: "b", usage: { cost: 2 } }, 1),
    observation(LAUNCH, { id: "a", usage: { cost: 1 } }, 0),
  ];
  const [later] = apply(
    rows,
    [[LAUNCH, projection({ usage: { totalTokens: 1, cost: 3 } })]],
    GROUP,
  );
  assert.equal(later?.run.usage?.cost, 2);
});

test("a run with nothing to fill leaves every observation untouched", () => {
  const rows = [
    observation(
      LAUNCH,
      { id: "a", model: "m", toolCalls: 1, usage: { totalTokens: 1, cost: 1 } },
      0,
    ),
    observation(NOTICE, { id: "b", usage: { totalTokens: 1, cost: 1 } }, 1),
  ];
  const nothingNew = projection({ usage: { totalTokens: 9, cost: 9 } });
  assert.deepEqual(apply(rows, [[LAUNCH, nothingNew]], GROUP), rows);
});

test("only the observation a projection is keyed to changes", () => {
  const rows = [observation(LAUNCH), observation(NOTICE, { id: "other" })];
  const [launch, other] = apply(rows);
  assert.equal(launch?.run.model, "child-model");
  assert.equal(other, rows[1]);
  const unknown = apply(rows, [["source-missing", projection()]]);
  assert.deepEqual(unknown, rows);
});

test("a projection with nothing new leaves the run untouched", () => {
  const complete = observation(LAUNCH, {
    model: "m",
    toolCalls: 1,
    usage: {
      totalTokens: 1,
      cost: 1,
      inputTokens: 1,
      outputTokens: 1,
      inputCost: 1,
      outputCost: 1,
    },
  });
  assert.equal(apply([complete])[0], complete);
  const nothing = projection({ usageCoverage: "unavailable" });
  delete nothing.usage;
  delete nothing.model;
  delete nothing.toolCalls;
  const bare = observation(LAUNCH);
  assert.equal(apply([bare], [[LAUNCH, nothing]])[0], bare);
});

test("tokens and costs raise their own coverage independently and never downgrade it", () => {
  const tokensOnly = apply(
    [observation(LAUNCH)],
    [
      [
        LAUNCH,
        projection({
          usage: { totalTokens: 7, cost: 0 },
          toolCalls: undefined,
        }),
      ],
    ],
  )[0];
  assert.equal(tokensOnly?.run.usage?.cost, 0, "a known zero cost is filled");
  const partialUsage = apply(
    [
      observation(LAUNCH, {
        usage: { cost: 2 },
        effortCoverage: { ...unavailable, usage: "complete", cost: "complete" },
      }),
    ],
    [[LAUNCH, projection({ toolCalls: undefined })]],
  )[0];
  assert.equal(partialUsage?.run.effortCoverage.usage, "complete");
  assert.equal(partialUsage?.run.effortCoverage.cost, "complete");
  assert.equal(partialUsage?.run.usage?.cost, 2);
  assert.equal(partialUsage?.run.usage?.totalTokens, 100);

  const costOnly = apply(
    [observation(LAUNCH, { usage: { totalTokens: 1 } })],
    [[LAUNCH, projection({ usage: { totalTokens: 1, cost: 4 } })]],
  )[0];
  assert.equal(
    costOnly?.run.effortCoverage.usage,
    "unavailable",
    "no token field was filled",
  );
  assert.equal(costOnly?.run.effortCoverage.cost, "partial");
});

test("no projections, or too many observations, return the evidence unchanged", () => {
  const evidence = evidenceOf([observation(LAUNCH)]);
  assert.equal(applyChildSessionProjections(evidence, new Map()), evidence);
  const many = evidenceOf(
    Array.from({ length: 513 }, (_, i) =>
      observation(`s${i}`, { id: `r${i}` }),
    ),
  );
  assert.equal(
    applyChildSessionProjections(many, new Map([["s0", projection()]])),
    many,
  );
});

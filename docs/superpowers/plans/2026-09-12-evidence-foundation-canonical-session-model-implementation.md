# Evidence Foundation & Canonical Session Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a privacy-safe L0 safe-evidence layer, one in-memory L1 canonical session model, and L2 report projections so every renderer consumes reconciled evidence instead of re-reading Pi JSONL, WAL, checkpoint, and inventory independently.

**Architecture:** Source adapters emit `AtomicEvidence` and `FoldedAggregateEvidence`; one L1 builder (`src/core/canonical.ts`) reconciles graph, identity, timestamps, usage, skill invocations, subagent publications, live timing, and checkpoint-surviving aggregates; existing `SessionReport` stays the machine/renderer DTO and gains bounded evidence health. Pi JSONL remains authoritative, the Inspector WAL stays authoritative only for bounded live observation, checkpoints stay rebuildable aggregates, and no L2 loader reads storage directly.

**Tech Stack:** Node `>=22.19.0`, TypeScript (strict, ESM, `.ts` imports), `node:test` + `node:assert/strict` via `node --import tsx --test`, Biome for format/lint. No new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-09-12-evidence-foundation-canonical-session-model-design.md`

## Global Constraints

- Pi persisted data is billing and native-fact authority. Never write Pi session JSONL; the `session-inspector:tracking-start` marker is the sole write.
- Inspector is observer-only: every hook, adapter, telemetry, storage, projection, and clock failure is swallowed and never alters Pi execution.
- No prompt, response, message body, tool argument/result, child task/output, provider payload, path, URL, environment value, secret, or unbounded producer string enters WAL, checkpoint, inventory, health JSON, report JSON, logs, fixtures, or test snapshots. Allowed bounded text is only ADR-0015 command/skill descriptions and the bounded/redacted generation `errorMessage`.
- `unavailable` is never `0`; missing evidence never serializes as zero; expired detail never serializes as absent activity.
- Child usage is a non-additive breakdown and never enters session/native/model/history/global totals.
- Earliest valid tracking marker is the only boundary; missing marker means scope unavailable, never "all entries".
- Raw producer identities persist only through `canonicalOpaqueDigest()`; raw IDs never sit beside their opaque form.
- Checkpoint stores exactly one resource-count location: `aggregates.resourceCounts` (extended in place), plus one `evidence` sibling object.
- `inventory.observedAt` is the latest successful observation time; byte-equivalent content still advances it; mtime is never evidence time.
- L2 (loaders, reports, UI, HTML, JSON) never reads WAL, checkpoint, inventory, or producer archives directly.
- Versions follow SemVer; this milestone is `0.8.0` and requires ADR 0016.
- The existing 23-task report/navigation plan and its design are downstream and must not be executed or edited here.

## File Structure

#### Create

- `src/core/opaque-id.ts` — the single domain-separated session-scoped opaque-ID helper.
- `src/core/evidence.ts` — L0 contracts: authorities, sources, time evidence, provenance, `AtomicEvidence`, `FoldedAggregateEvidence`, and bounded-label guards.
- `src/pi/graph.ts` — structurally valid Pi graph-node extraction (id/parent/ordinal/type/time state).
- `src/pi/scope.ts` — graph-aware marker boundary and active/tree scope resolution with availability verdicts.
- `src/pi/parent-session.ts` — hardened parent-session resolution confined to the Pi adapter.
- `src/integrations/skill-invocations.ts` — explicit skill invocation facts from validated telemetry.
- `src/core/retained-aggregates.ts` — checkpoint aggregates → `CanonicalRetainedAggregates` with exact fold/seal boundary.
- `src/core/canonical.ts` — the L1 builder producing `CanonicalSessionBuildResult`.
- `src/core/evidence-health.ts` — bounded, deterministic health projection helpers shared by report and tests.
- `tests/unit/opaque-id.test.ts`, `tests/unit/evidence-contracts.test.ts`, `tests/unit/pi-graph.test.ts`, `tests/unit/scope-graph.test.ts`, `tests/unit/skill-invocations.test.ts`, `tests/unit/retained-aggregates.test.ts`, `tests/unit/parent-session.test.ts`, `tests/unit/canonical-builder.test.ts`, `tests/unit/evidence-health.test.ts`, `tests/unit/folded-aggregate-boundary.test.ts`, `tests/integration/replay-graph.test.ts`

#### Modify

- `src/core/events.ts` — canonical `AgentRun` additions; health and aggregate DTO types referenced by reports.
- `src/pi/adapter.ts` — keep header version/created time and emit graph nodes for every structurally valid entry.
- `src/pi/live.ts` — privacy-safe discriminated hook event carrying `toolCallId`.
- `src/pi/live-wal.ts` — subject-keyed tool timing with bounded overflow.
- `src/storage/wal.ts` — accept additive `subjectId` on `live_timing`.
- `src/storage/recovery.ts` — validate/parse `subjectId`; classify legacy lifecycle rows.
- `src/storage/checkpoint.ts` — extend `aggregates.resourceCounts` in place, add `evidence`.
- `src/storage/maintenance.ts` — write observation/coverage metadata; keep one physical shape.
- `src/storage/inventory-snapshot.ts` — persist and advance `observedAt`.
- `src/storage/retention.ts` — inventory retention by `observedAt`; record expiration boundary.
- `src/integrations/inventory.ts` — `InventorySnapshot.observedAt`.
- `src/integrations/live-counters.ts` — permission request attribution; skill invocation telemetry.
- `src/integrations/subagents.ts` — publication time, evidence tool id, model/thinking/failure/conflicts.
- `src/core/reports.ts` — `evidenceHealth`, `retainedAggregates` projections fed from L1.
- `src/ui/load-current.ts`, `src/ui/load-history.ts`, `src/index.ts` — all loaders call the L1 builder; no direct storage reads.
- `package.json`, `CHANGELOG.md`, `docs/architecture/adr/0016-*.md`, `docs/specs/pi-session-inspector-v1.md`

---

### Task 1: Canonical opaque identity helper

**Files:**

- Create: `src/core/opaque-id.ts`
- Test: `tests/unit/opaque-id.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `type OpaqueIdentityDomain = "live-tool" | "permission-request" | "subagent-run"`, `canonicalOpaqueDigest(domain, sessionId, rawId): string` returning 64 lowercase hex, `OPAQUE_ID_DOMAINS: readonly OpaqueIdentityDomain[]`.

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalOpaqueDigest,
  OPAQUE_ID_DOMAINS,
} from "../../src/core/opaque-id.ts";

const SESSION = "01a0950b-60f3-72b7-9d18-4b9836d6845f";

test("digest is deterministic 64 lowercase hex", () => {
  const a = canonicalOpaqueDigest("live-tool", SESSION, "call_abc");
  const b = canonicalOpaqueDigest("live-tool", SESSION, "call_abc");
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
});

test("domains and sessions are collision-isolated", () => {
  const base = canonicalOpaqueDigest("live-tool", SESSION, "id");
  assert.notEqual(base, canonicalOpaqueDigest("permission-request", SESSION, "id"));
  assert.notEqual(base, canonicalOpaqueDigest("live-tool", `${SESSION}-2`, "id"));
  assert.notEqual(base, canonicalOpaqueDigest("live-tool", SESSION, "id "));
  assert.equal(OPAQUE_ID_DOMAINS.length, 3);
});

test("invalid input is rejected, never hashed leniently", () => {
  assert.throws(() => canonicalOpaqueDigest("live-tool", SESSION, ""));
  assert.throws(() => canonicalOpaqueDigest("live-tool", "", "id"));
  assert.throws(() => canonicalOpaqueDigest("live-tool", SESSION, "a\u0000b"));
  assert.throws(() =>
    canonicalOpaqueDigest("live-tool", SESSION, "x".repeat(513)),
  );
  assert.throws(() =>
    canonicalOpaqueDigest("nope" as never, SESSION, "id"),
  );
});

test("utf8 bytes are hashed without normalization", () => {
  const composed = canonicalOpaqueDigest("live-tool", SESSION, "\u00e9");
  const decomposed = canonicalOpaqueDigest("live-tool", SESSION, "e\u0301");
  assert.notEqual(composed, decomposed);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/opaque-id.test.ts`
Expected: FAIL — cannot find module `../../src/core/opaque-id.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { createHash } from "node:crypto";

export const OPAQUE_ID_DOMAINS = [
  "live-tool",
  "permission-request",
  "subagent-run",
] as const;

export type OpaqueIdentityDomain = (typeof OPAQUE_ID_DOMAINS)[number];

const MAX_RAW_BYTES = 512;
const DOMAIN: ReadonlySet<string> = new Set(OPAQUE_ID_DOMAINS);
const encoder = new TextEncoder();
const NUL = new Uint8Array([0]);

/**
 * One binding, domain-separated, session-scoped opaque identity. Hook adapters,
 * WAL recovery, and L1 reconcilers must all call this helper so byte-identical
 * inputs yield byte-identical IDs. Raw producer IDs never persist.
 */
export function canonicalOpaqueDigest(
  domain: OpaqueIdentityDomain,
  sessionId: string,
  rawId: string,
): string {
  if (!DOMAIN.has(domain)) throw new TypeError("unknown opaque-id domain");
  if (typeof sessionId !== "string" || sessionId.length === 0)
    throw new TypeError("sessionId must be a non-empty string");
  if (typeof rawId !== "string" || rawId.length === 0)
    throw new TypeError("rawId must be a non-empty string");
  if (rawId.includes("\u0000")) throw new TypeError("rawId must not contain NUL");
  if (encoder.encode(rawId).byteLength > MAX_RAW_BYTES)
    throw new TypeError("rawId exceeds the byte bound");

  const hash = createHash("sha256");
  for (const part of [
    "pi-session-inspector",
    "opaque-id",
    "v1",
    domain,
    sessionId,
    rawId,
  ]) {
    hash.update(encoder.encode(part));
    hash.update(NUL);
  }
  return hash.digest("hex");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/opaque-id.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/opaque-id.ts tests/unit/opaque-id.test.ts
git commit -m "feat: add canonical opaque identity helper"
```

---

### Task 2: L0 evidence contracts

**Files:**

- Create: `src/core/evidence.ts`
- Test: `tests/unit/evidence-contracts.test.ts`

**Interfaces:**

- Consumes: `src/core/opaque-id.ts` (types only).
- Produces: `EvidenceAuthority`, `EvidenceSource`, `TimeEvidence`, `FactProvenance`, `L0FactBase`, `L0Evidence`, `AtomicEvidence`, `FoldedAggregateEvidence`, `SkillInvocationObservation`, plus guards `isBoundedToken(value, maxBytes): value is string` and `boundedProducerLabel(value): string | undefined`.

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { boundedProducerLabel, isBoundedToken } from "../../src/core/evidence.ts";

test("bounded token accepts safe ASCII identifiers only", () => {
  assert.equal(isBoundedToken("call_abc-1", 64), true);
  assert.equal(isBoundedToken("", 64), false);
  assert.equal(isBoundedToken("a".repeat(65), 64), false);
  assert.equal(isBoundedToken("a b", 64), false);
  assert.equal(isBoundedToken(42, 64), false);
});

test("producer labels are bounded and secret/path rejected", () => {
  assert.equal(boundedProducerLabel("openai"), "openai");
  assert.equal(boundedProducerLabel("Bearer abc"), undefined);
  assert.equal(boundedProducerLabel("/home/u/project"), undefined);
  assert.equal(boundedProducerLabel("x".repeat(200)), undefined);
  assert.equal(boundedProducerLabel(7), undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/evidence-contracts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { boundedDescription, secretLikeValue } from "./redact.ts";

const LABEL_MAX_BYTES = 96;
const TOKEN = /^[A-Za-z0-9_][A-Za-z0-9._:-]*$/;
const encoder = new TextEncoder();

export type EvidenceAuthority =
  | "native"
  | "live"
  | "cooperative"
  | "observed"
  | "derived";

export type EvidenceSource =
  | "pi-jsonl"
  | "inspector-wal"
  | "checkpoint"
  | "inventory"
  | "subagent-result"
  | "subagent-archive"
  | "integration-telemetry"
  | "current-environment";

export type TimeEvidence =
  | {
      state: "known";
      at: string;
      basis:
        | "pi-session-header"
        | "pi-entry"
        | "pi-publication-entry"
        | "wal-observer"
        | "inventory-observer"
        | "current-observer"
        | "checkpoint-observer";
    }
  | { state: "unavailable" };

export type FactProvenance = {
  source: EvidenceSource;
  authority: EvidenceAuthority;
  recordId?: string;
  schemaVersion?: number;
};

export type L0FactBase = {
  factId: string;
  sessionId: string;
  provenance: FactProvenance;
  time: TimeEvidence;
};

export type SkillInvocationObservation = L0FactBase & {
  kind: "skill-invocation";
  skill: string;
  wal: { eventId: string; writerId: string; writerSequence: number };
  provenance: FactProvenance & {
    source: "integration-telemetry";
    authority: "live";
    schemaVersion: 1;
  };
  time: { state: "known"; at: string; basis: "wal-observer" };
};

export type FoldedAggregateEvidence =
  | {
      kind: "checkpoint-wal-aggregates";
      sessionId: string;
      foldedThrough: Record<string, number>;
      sealedThrough: Record<string, number>;
      integrationCounters?: Record<string, Record<string, number>>;
      skillInvocations?: Record<string, number>;
      skillOverflowInvocations?: number;
      presence?: { permission?: true };
      checkpointedAt: TimeEvidence;
      provenance: { source: "checkpoint"; authority: "derived"; schemaVersion: 1 };
    }
  | {
      kind: "checkpoint-resource-aggregates";
      sessionId: string;
      resourceCounts: {
        commands?: number;
        skills?: number;
        resources?: number;
        toolSources?: number;
      };
      observedAt: TimeEvidence;
      checkpointedAt: TimeEvidence;
      provenance: { source: "checkpoint"; authority: "derived"; schemaVersion: 1 };
    };

/** Atomic facts carry exactly one source observation; graphs are built in L1. */
export type AtomicEvidence =
  | SkillInvocationObservation /* remaining families land in Task 3/5/6/7 */;

export type L0Evidence = {
  atomic: AtomicEvidence[];
  folded: FoldedAggregateEvidence[];
};

export function isBoundedToken(value: unknown, maxBytes: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    encoder.encode(value).byteLength <= maxBytes &&
    TOKEN.test(value)
  );
}

export function boundedProducerLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (encoder.encode(value).byteLength > LABEL_MAX_BYTES) return undefined;
  if (secretLikeValue(value)) return undefined;
  return boundedDescription(value, LABEL_MAX_BYTES);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/evidence-contracts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/evidence.ts tests/unit/evidence-contracts.test.ts
git commit -m "feat: add L0 evidence contracts and bounded-label guards"
```

---

### Task 3: Pi graph nodes for every structurally valid entry

**Files:**

- Create: `src/pi/graph.ts`
- Modify: `src/pi/adapter.ts`
- Test: `tests/unit/pi-graph.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `type PiGraphNode = { entryId: string; parentId: string | null; appendOrdinal: number; semanticType: { state: "known"; type: string } | { state: "unknown" }; timestamp: string | undefined }`, `buildGraphNodes(parsedLines: readonly Record<string, unknown>[]): PiGraphNode[]`; `ParsedSession` gains `formatVersion?: number`, `createdAt?: string`, `graphNodes: PiGraphNode[]`.

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSessionJsonl } from "../../src/pi/adapter.ts";
import { buildGraphNodes } from "../../src/pi/graph.ts";

const header = JSON.stringify({
  type: "session",
  id: "s1",
  version: 3,
  timestamp: "2026-09-12T10:00:00.000Z",
});
const known = JSON.stringify({
  type: "message",
  id: "a",
  parentId: null,
  timestamp: "2026-09-12T10:00:01.000Z",
  message: { role: "user", content: [] },
});
const unknown = JSON.stringify({
  type: "future_widget",
  id: "b",
  parentId: "a",
  timestamp: "2026-09-12T10:00:02.000Z",
  widgetPayload: { secret: "never-retained" },
});
const leaf = JSON.stringify({
  type: "message",
  id: "c",
  parentId: "b",
  timestamp: "2026-09-12T10:00:03.000Z",
  message: { role: "assistant", content: [] },
});

test("unknown semantic entries keep a node but no payload", () => {
  const nodes = buildGraphNodes(
    [known, unknown, leaf].map((line) => JSON.parse(line)),
  );
  assert.deepEqual(
    nodes.map((n) => [n.entryId, n.parentId, n.appendOrdinal, n.semanticType.state]),
    [
      ["a", null, 0, "known"],
      ["b", "a", 1, "unknown"],
      ["c", "b", 2, "known"],
    ],
  );
  assert.equal(JSON.stringify(nodes).includes("secret"), false);
});

test("adapter keeps header facts and graph nodes", () => {
  const parsed = parseSessionJsonl([header, known, unknown, leaf].join("\n"));
  assert.equal(parsed.formatVersion, 3);
  assert.equal(parsed.createdAt, "2026-09-12T10:00:00.000Z");
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.graphNodes.length, 3);
  assert.equal(parsed.unknownEntryCount, 1);
});

test("structurally invalid entries become no node", () => {
  const nodes = buildGraphNodes([
    { type: "message", id: "", parentId: null, timestamp: "t" },
    { type: "message", id: "x", parentId: 5, timestamp: "t" },
    { type: "message", id: "y", parentId: null, timestamp: "t" },
  ]);
  assert.deepEqual(
    nodes.map((n) => n.entryId),
    ["y"],
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/pi-graph.test.ts`
Expected: FAIL — `src/pi/graph.ts` not found and `formatVersion` undefined.

- [ ] **Step 3: Write minimal implementation**

`src/pi/graph.ts`:

```ts
const MAX_ID_BYTES = 128;
const MAX_TYPE_BYTES = 64;
const encoder = new TextEncoder();

export type PiGraphNode = {
  entryId: string;
  parentId: string | null;
  appendOrdinal: number;
  semanticType: { state: "known"; type: string } | { state: "unknown" };
  timestamp: string | undefined;
};

export function buildGraphNodes(
  values: readonly Record<string, unknown>[],
): PiGraphNode[] {
  const nodes: PiGraphNode[] = [];
  for (const value of values) {
    const entryId = value.id;
    const parentId = value.parentId;
    const type = value.type;
    if (!isBounded(entryId) || !isBounded(type)) continue;
    if (parentId !== null && !isBounded(parentId)) continue;
    nodes.push({
      entryId,
      parentId: parentId === undefined ? null : parentId,
      appendOrdinal: nodes.length,
      semanticType: { state: "unknown", type },
      timestamp:
        typeof value.timestamp === "string" && value.timestamp.length <= 64
          ? value.timestamp
          : undefined,
    });
  }
  return nodes;
}

function isBounded(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    encoder.encode(value).byteLength <= MAX_ID_BYTES
  );
}

export function knownTypeSet(types: readonly string[]): ReadonlySet<string> {
  return new Set(types);
}
```

Wire the adapter: `parseSessionJsonl` collects parsed line records, then calls `buildGraphNodes`, marks `semanticType` for `knownTypes`, and returns `formatVersion`/`createdAt`/`graphNodes` while keeping the existing `entries`/`unknownEntryCount`/`hasMalformedJson` behavior.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/pi-graph.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the existing adapter/replay suites**

Run: `node --import tsx --test tests/integration/replay.test.ts tests/unit/reduce-usage.test.ts`
Expected: PASS (no regression).

- [ ] **Step 6: Commit**

```bash
git add src/pi/graph.ts src/pi/adapter.ts tests/unit/pi-graph.test.ts
git commit -m "feat: keep graph nodes for every structurally valid Pi entry"
```

---

### Task 4: Graph-aware tracking boundary and scope

**Files:**

- Create: `src/pi/scope.ts`
- Test: `tests/unit/scope-graph.test.ts`, `tests/integration/replay-graph.test.ts`

**Interfaces:**

- Consumes: `PiGraphNode` (Task 3).
- Produces: `type ScopeResolution = { state: "available"; entryIds: string[]; markerEntryId: string; duplicateMarkers: number } | { state: "unavailable"; reason: "tracking-marker-missing" | "active-leaf-unavailable" }`, `resolveScope(nodes, leafId, scope): ScopeResolution`.

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGraphNodes } from "../../src/pi/graph.ts";
import { resolveScope } from "../../src/pi/scope.ts";

const marker = (id: string, parentId: string | null) => ({
  type: "custom",
  customType: "session-inspector:tracking-start",
  id,
  parentId,
  timestamp: "2026-09-12T10:00:00.000Z",
  data: { schemaVersion: 1 },
});
const node = (id: string, parentId: string | null, type = "message") => ({
  type,
  id,
  parentId,
  timestamp: "2026-09-12T10:00:01.000Z",
  message: { role: "user", content: [] },
});

test("unknown node between known nodes keeps active ancestry resolvable", () => {
  const nodes = buildGraphNodes([
    marker("m", null),
    node("a", "m"),
    node("b", "a", "future_widget"),
    node("c", "b"),
  ]);
  const resolved = resolveScope(nodes, "c", "active");
  assert.equal(resolved.state, "available");
  assert.deepEqual(
    resolved.state === "available" ? resolved.entryIds : [],
    ["a", "b", "c"],
  );
});

test("missing marker is unavailable, never all-entries", () => {
  const resolved = resolveScope(buildGraphNodes([node("a", null)]), "a", "tree");
  assert.deepEqual(resolved, { state: "unavailable", reason: "tracking-marker-missing" });
});

test("earliest marker wins and duplicates are counted", () => {
  const nodes = buildGraphNodes([
    marker("m1", null),
    node("a", "m1"),
    marker("m2", "a"),
    node("b", "m2"),
  ]);
  const resolved = resolveScope(nodes, "b", "tree");
  assert.equal(resolved.state, "available");
  assert.equal(resolved.state === "available" ? resolved.markerEntryId : "", "m1");
  assert.equal(resolved.state === "available" ? resolved.duplicateMarkers : 0, 1);
  assert.deepEqual(
    resolved.state === "available" ? resolved.entryIds : [],
    ["a", "m2", "b"],
  );
});

test("invalid leaf never falls back to tree", () => {
  const nodes = buildGraphNodes([marker("m", null), node("a", "m")]);
  assert.deepEqual(resolveScope(nodes, "missing", "active"), {
    state: "unavailable",
    reason: "active-leaf-unavailable",
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/scope-graph.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/pi/scope.ts` resolves the first schema-version-1 marker node, verifies the leaf exists, walks `parentId` over the graph with a visited set (cycle-safe), and returns post-marker node ids in append order (tree) or root-first ancestry order (active). Marker detection reuses the `customType` string and `data.schemaVersion === 1` rule; unknown semantic nodes are ordinary graph nodes here and are never filtered by type.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/scope-graph.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the replay integration regression**

`tests/integration/replay-graph.test.ts` builds a fixture with known → unknown → known nodes plus the tracking marker, resolves active scope, and asserts the reduced session still contains both known messages and that `resolveScope` output ids match the expected path.

Run: `node --import tsx --test tests/integration/replay-graph.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pi/scope.ts tests/unit/scope-graph.test.ts tests/integration/replay-graph.test.ts
git commit -m "feat: resolve scope over the full structural graph"
```

---

### Task 5: Explicit skill invocation facts

**Files:**

- Create: `src/integrations/skill-invocations.ts`
- Test: `tests/unit/skill-invocations.test.ts`

**Interfaces:**

- Consumes: `SkillInvocationObservation` (Task 2), `SKILL_NAME_PATTERN` from `src/core/live-counter-fold.ts`, validated telemetry envelopes.
- Produces: `readSkillInvocations(input: { sessionId: string; records: readonly { eventId: string; writerId: string; writerSequence: number; timestamp: string; telemetry?: Record<string, unknown> }[] }): SkillInvocationObservation[]`.

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { readSkillInvocations } from "../../src/integrations/skill-invocations.ts";

const record = (overrides: Record<string, unknown> = {}) => ({
  eventId: "evt-1",
  writerId: "w-1",
  writerSequence: 1,
  timestamp: "2026-09-12T10:00:00.000Z",
  telemetry: {
    schemaVersion: 1,
    source: "pi-input",
    metric: "skill.invocation",
    value: 1,
    kind: "counter",
    dimensions: { skill: "context-mode" },
  },
  ...overrides,
});

test("valid skill invocation becomes a live-authority fact", () => {
  const facts = readSkillInvocations({ sessionId: "s1", records: [record()] });
  assert.equal(facts.length, 1);
  assert.equal(facts[0]?.skill, "context-mode");
  assert.equal(facts[0]?.provenance.authority, "live");
  assert.equal(facts[0]?.time.state, "known");
  assert.deepEqual(facts[0]?.wal, { eventId: "evt-1", writerId: "w-1", writerSequence: 1 });
});

test("non-skill, overflow and invalid names produce no fact", () => {
  const facts = readSkillInvocations({
    sessionId: "s1",
    records: [
      record({ eventId: "e2", telemetry: { schemaVersion: 1, source: "pi-input", metric: "skill.invocation", value: 2, kind: "counter", dimensions: { skill: "x" } } }),
      record({ eventId: "e3", telemetry: { schemaVersion: 1, source: "other", metric: "skill.invocation", value: 1, kind: "counter", dimensions: { skill: "x" } } }),
      record({ eventId: "e4", telemetry: { schemaVersion: 1, source: "pi-input", metric: "skill.invocation", value: 1, kind: "counter", dimensions: { skill: "../etc" } } }),
    ],
  });
  assert.deepEqual(facts, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/skill-invocations.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { SKILL_NAME_PATTERN } from "../core/live-counter-fold.ts";
import type { SkillInvocationObservation } from "../core/evidence.ts";

const SKILL_SOURCE = "pi-input";
const SKILL_METRIC = "skill.invocation";

export function readSkillInvocations(input: {
  sessionId: string;
  records: readonly {
    eventId: string;
    writerId: string;
    writerSequence: number;
    timestamp: string;
    telemetry?: Record<string, unknown>;
  }[];
}): SkillInvocationObservation[] {
  const facts: SkillInvocationObservation[] = [];
  for (const record of input.records) {
    const telemetry = record.telemetry;
    if (telemetry === undefined) continue;
    if (telemetry.kind !== "counter" || telemetry.value !== 1) continue;
    if (telemetry.source !== SKILL_SOURCE || telemetry.metric !== SKILL_METRIC)
      continue;
    const skill =
      typeof telemetry.dimensions === "object" && telemetry.dimensions !== null
        ? (telemetry.dimensions as Record<string, unknown>).skill
        : undefined;
    if (typeof skill !== "string" || !SKILL_NAME_PATTERN.test(skill)) continue;
    facts.push({
      factId: `skill-invocation:${record.eventId}`,
      sessionId: input.sessionId,
      kind: "skill-invocation",
      skill,
      wal: {
        eventId: record.eventId,
        writerId: record.writerId,
        writerSequence: record.writerSequence,
      },
      provenance: {
        source: "integration-telemetry",
        authority: "live",
        recordId: record.eventId,
        schemaVersion: 1,
      },
      time: { state: "known", at: record.timestamp, basis: "wal-observer" },
    });
  }
  return facts.sort((a, b) =>
    a.wal.writerId === b.wal.writerId
      ? a.wal.writerSequence - b.wal.writerSequence
      : a.wal.writerId.localeCompare(b.wal.writerId),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/skill-invocations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/integrations/skill-invocations.ts tests/unit/skill-invocations.test.ts
git commit -m "feat: add first-class explicit skill invocation evidence"
```

---

### Task 6: Subagent publication evidence

**Files:**

- Modify: `src/core/events.ts` (AgentRun additions), `src/integrations/subagents.ts`, `src/core/reports.ts` (`projectAgent`)
- Test: `tests/unit/subagents.test.ts` (extend)

**Interfaces:**

- Consumes: `SessionEntry` with persisted tool results.
- Produces: `AgentRun` gains `observedAt?: string`, `evidenceToolId?: string`, `model?: string`, `thinking?: string`, `failure?: AgentFailure`; `SubagentEvidence` gains `diagnostics: readonly { code: "cooperative-evidence-conflict"; count: number }[]`.

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveEvidence } from "../../src/integrations/subagents.ts";

const assistant = (id: string, callId: string) => ({
  id,
  parentId: null,
  timestamp: "2026-09-12T10:00:00.000Z",
  type: "message",
  message: {
    role: "assistant",
    content: [{ type: "toolCall", id: callId, name: "subagent" }],
  },
});

const result = (id: string, callId: string, details: unknown, timestamp: string) => ({
  id,
  parentId: null,
  timestamp,
  type: "message",
  message: { role: "toolResult", toolCallId: callId, toolName: "subagent", details },
});

test("run carries publication time, evidence tool id, model and failure", () => {
  const evidence = deriveEvidence([
    assistant("a", "call_1"),
    result(
      "r",
      "call_1",
      {
        results: [
          {
            runId: "run-1",
            agent: "delegate",
            success: false,
            exitCode: 2,
            model: "gpt-5",
            thinking: "high",
            usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0.01 },
          },
        ],
      },
      "2026-09-12T10:00:05.000Z",
    ),
  ]);
  const run = evidence.runs[0];
  assert.equal(run?.observedAt, "2026-09-12T10:00:05.000Z");
  assert.equal(run?.evidenceToolId, "tool:call_1");
  assert.equal(run?.model, "gpt-5");
  assert.equal(run?.thinking, "high");
  assert.deepEqual(run?.failure, { reason: "exit-nonzero", detail: 2 });
});

test("repeated publications keep the latest observation exactly once", () => {
  const evidence = deriveEvidence([
    assistant("a", "call_1"),
    result("r1", "call_1", { results: [{ runId: "run-1", agent: "delegate", success: true }] }, "2026-09-12T10:00:05.000Z"),
    assistant("b", "call_2"),
    result("r2", "call_2", { completions: [{ runId: "run-1", agent: "delegate", success: true }] }, "2026-09-12T10:01:00.000Z"),
  ]);
  assert.equal(evidence.runs.length, 1);
  assert.equal(evidence.runs[0]?.observedAt, "2026-09-12T10:01:00.000Z");
  assert.equal(evidence.runs[0]?.evidenceToolId, "tool:call_2");
  assert.deepEqual(evidence.diagnostics, []);
});

const isAgentLabel = (value: unknown) => typeof value === "string";
assert.equal(isAgentLabel("delegate"), true);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/subagents.test.ts`
Expected: FAIL — `observedAt`/`evidenceToolId` undefined, `diagnostics` undefined.

- [ ] **Step 3: Implement**

- `src/core/events.ts`: add to `AgentRun` the optional fields, including:

```ts
export type AgentFailure = {
  reason: "exit-nonzero" | "process-signal" | "completion-failed" | "output-absent";
  detail?: number | string;
};
```

- `src/integrations/subagents.ts`: pass the publishing result's entry timestamp and `tool:<toolCallId>` into `pushRun`, plus bounded `model`/`thinking` via `boundedProducerLabel`, and `failure` derived only from closed producer evidence (`exitCode` non-zero → `exit-nonzero`, bounded `processSignal` → `process-signal`, `success === false` → `completion-failed`, `outputState === "absent"` → `output-absent`). Repeated run ids merge per spec §8.5: latest publication wins `observedAt`/`evidenceToolId`; conflicting non-missing `agent`/`parentId` drops the field and increments `cooperative-evidence-conflict`; terminal→running regression sets `status: "unknown"` and increments the same diagnostic; usage is selected, never summed.
- `src/core/reports.ts`: extend `projectAgent` to re-validate `observedAt` as an ISO instant, `evidenceToolId` via an opaque `tool:` id check, `model`/`thinking` via the bounded label path, and `failure` reason/detail enums.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/subagents.test.ts tests/unit/reports-integrations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/events.ts src/integrations/subagents.ts src/core/reports.ts tests/unit/subagents.test.ts
git commit -m "feat: add subagent publication time, evidence tool id and bounded failure"
```

---

### Task 7: Live timing subject correlation

**Files:**

- Modify: `src/pi/live.ts`, `src/pi/live-wal.ts`, `src/storage/wal.ts`, `src/storage/recovery.ts`, `src/index.ts` (pass `sessionId`)
- Test: `tests/unit/live-wal.test.ts` (extend), `tests/unit/wal.test.ts` (extend)

**Interfaces:**

- Consumes: `canonicalOpaqueDigest` (Task 1).
- Produces: `LiveObserverEvent = { kind: LiveObserverEventKind; toolCallId?: string }`; `LiveTiming.subjectId?: string`; tool subject id `live-tool-<64hex>`.

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { registerLiveWal } from "../../src/pi/live-wal.ts";

type Handler = (event: { kind: string; toolCallId?: string }) => Promise<void>;
const registrations = new Map<string, Handler>();
const events: { kind: string; timing: Record<string, unknown> }[] = [];

registerLiveWal(
  { on: (channel, handler) => void registrations.set(channel, handler as Handler) },
  {
    append: (event) => void events.push({ kind: event.kind, timing: event.timing }),
    flush: async () => {},
  },
  {
    sessionId: "s1",
    now: () => new Date("2026-09-12T10:00:00.000Z"),
    randomId: () => "event-1",
  },
);

test("concurrent tools pair by subject, not arrival order", async () => {
  await registrations.get("tool_execution_start")?.({ kind: "tool_execution_start", toolCallId: "call_a" });
  await registrations.get("tool_execution_start")?.({ kind: "tool_execution_start", toolCallId: "call_b" });
  await registrations.get("tool_execution_end")?.({ kind: "tool_execution_end", toolCallId: "call_b" });
  const runs = events.filter((e) => e.timing.status === "running");
  const done = events.filter((e) => e.timing.status === "unknown");
  assert.equal(runs.length, 2);
  assert.equal(done.length, 1);
  assert.equal(typeof runs[0]?.timing.subjectId, "string");
  assert.match(String(runs[0]?.timing.subjectId), /^live-tool-[a-f0-9]{64}$/);
  assert.notEqual(runs[0]?.timing.subjectId, runs[1]?.timing.subjectId);
  assert.equal(done[0]?.timing.subjectId, runs[1]?.timing.subjectId);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/live-wal.test.ts`
Expected: FAIL — no `subjectId`, no `toolCallId` on the observer event.

- [ ] **Step 3: Implement**

1. `src/pi/live.ts`: widen the event to `{ kind; toolCallId?: string }` and copy only `toolCallId` (bounded 512 UTF-8 bytes) from `tool_execution_start`/`tool_execution_end` payloads. Never copy `args`, `result`, messages, prompts, or model objects.
2. `src/pi/live-wal.ts`: `LiveWalOptions` gains `sessionId: string`; tool starts go into `Map<string, OpenTiming>` keyed by `live-tool-<digest>`, ends look up by digest. Keep the 64-open-subject bound per category: on overflow drop the new start, set a `liveOverflow` counter exposed through the returned registration, and never evict an open subject.
3. `src/storage/wal.ts`: add `subjectId?: string` to `LiveTiming` and validate it as an ASCII token ≤128 bytes in `isLiveTiming`.
4. `src/storage/recovery.ts`: `parseTiming` accepts and carries an optional validated `subjectId` on `running` and `unknown` records; records without it stay valid and anonymous.
5. `src/index.ts`: pass `sessionId: input.sessionId` into `registerLiveWal`.

- [ ] **Step 4: Run tests**

Run: `node --import tsx --test tests/unit/live-wal.test.ts tests/unit/live-observer.test.ts tests/unit/wal.test.ts tests/unit/recovery.test.ts`
Expected: PASS, including an assertion that a legacy row without `subjectId` still parses.

- [ ] **Step 5: Commit**

```bash
git add src/pi/live.ts src/pi/live-wal.ts src/storage/wal.ts src/storage/recovery.ts src/index.ts tests/unit/live-wal.test.ts
```

```bash
git commit -m "feat: correlate live tool timing by opaque subject id"
```

---

### Task 8: Permission request attribution and skill telemetry

**Files:**

- Modify: `src/integrations/live-counters.ts`
- Test: `tests/unit/live-counters.test.ts` (extend)

**Interfaces:**

- Consumes: `canonicalOpaqueDigest` (Task 1), pinned payload field `requestId` on `permissions:ui_prompt` and `permissions:decision`.
- Produces: telemetry envelopes with `attribution.request = permission-request-<64hex>`; unchanged `skill.invocation` shape.

- [ ] **Step 1: Write the failing test**

```ts
const handlers = new Map<string, (payload: unknown) => void>();

test("prompt and decision share a hashed request attribution", () => {
  const envelopes: Record<string, unknown>[] = [];
  registerLiveCounters(
    {
      events: { on: (_channel, handler) => { handlers.set(_channel, handler); return () => {}; } },
      on: () => () => {},
    },
    { appendTelemetry: (envelope) => void envelopes.push(envelope as Record<string, unknown>), flush: async () => {} },
    { sessionId: "s1", inventoryNames: [], now: () => new Date("2026-09-12T10:00:00.000Z") },
  );
  handlers.get("permissions:ui_prompt")?.({ requestId: "req-1", request: {} });
  handlers.get("permissions:decision")?.({ requestId: "req-1", result: "allow", resolution: "user_approved" });
  const [prompt, decision] = envelopes;
  assert.equal(prompt?.attribution.request, decision?.attribution.request);
  assert.match(String(prompt?.attribution.request), /^permission-request-[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(envelopes).includes("req-1"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/live-counters.test.ts`
Expected: FAIL — `attribution.request` undefined.

- [ ] **Step 3: Implement**

Add `readRequestAttribution(payload, sessionId)` in `src/integrations/live-counters.ts`: accept only a string `requestId` of ≤512 UTF-8 bytes, return `{ request: \`permission-request-${canonicalOpaqueDigest("permission-request", sessionId, requestId)}\` }`, otherwise`undefined`. Attach it as`attribution` on the existing prompt/decision envelopes. Raw `requestId` must never enter the envelope; drop the whole attribution when invalid rather than hashing a fallback.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/live-counters.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/integrations/live-counters.ts tests/unit/live-counters.test.ts
git commit -m "feat: add hashed permission request attribution"
```

---

### Task 9: Checkpoint physical shape

**Files:**

- Modify: `src/storage/checkpoint.ts`, `src/storage/maintenance.ts`
- Test: `tests/unit/checkpoint.test.ts`, `tests/unit/maintenance.test.ts` (extend)

**Interfaces:**

- Consumes: existing `Checkpoint` type.
- Produces: `aggregates.resourceCounts?: { commands: number; skills: number; resources?: number; toolSources?: number; observedAt?: string }` and top-level `evidence?: { checkpointedAt?; detailCoverage?; usageCoverage? }`; exactly one physical representation.

- [ ] **Step 1: Write the failing test**

```ts
test("resource counts extend in place and evidence is a single sibling", async () => {
  const checkpoint = {
    schemaVersion: 1,
    cursors: { pi: { lineCount: 0, revision: "0".repeat(64) }, wal: {} },
    aggregates: {
      totalTokens: 0,
      totalCost: 0,
      generations: 0,
      tools: 0,
      compactions: 0,
      resourceCounts: { commands: 3, skills: 2, resources: 1, toolSources: 4, observedAt: "2026-09-12T10:00:00.000Z" },
    },
    evidence: { checkpointedAt: "2026-09-12T10:00:01.000Z" },
  };
  await writeCheckpoint({ directory, checkpoint, lease });
  const read = await readCheckpoint({ directory });
  assert.deepEqual(read?.aggregates.resourceCounts, checkpoint.aggregates.resourceCounts);
  assert.equal(read?.evidence?.checkpointedAt, "2026-09-12T10:00:01.000Z");
  assert.equal("evidence" in (read?.aggregates ?? {}), false);
});

test("legacy checkpoint without evidence still parses", async () => {
  await writeFile(join(directory, "checkpoint.json"), JSON.stringify(legacy));
  const read = await readCheckpoint({ directory });
  assert.equal(read?.evidence, undefined);
  assert.deepEqual(read?.aggregates.resourceCounts, { commands: 1, skills: 1 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/checkpoint.test.ts`
Expected: FAIL — `evidence` is dropped and extended `resourceCounts` keys are rejected.

- [ ] **Step 3: Implement**

1. `src/storage/checkpoint.ts`: extend the `Checkpoint` type exactly as spec §14.1 shows; extend `parseResourceCounts` to accept optional bounded `resources`/`toolSources`/`observedAt` while keeping `commands`/`skills` required when present; add `parseEvidence` accepting only the three bounded keys with the §14.1 enums; keep unknown-key rejection permissive only for these declared additive keys. Never relocate or mirror `resourceCounts`.
2. `src/storage/maintenance.ts`: write `evidence.checkpointedAt` from `now()`, `evidence.usageCoverage` from the reducer's coverage, and `aggregates.resourceCounts.observedAt` from the inventory snapshot's `observedAt` (never the checkpoint write time).

- [ ] **Step 4: Run tests**

Run: `node --import tsx --test tests/unit/checkpoint.test.ts tests/unit/maintenance.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/storage/checkpoint.ts src/storage/maintenance.ts tests/unit/checkpoint.test.ts tests/unit/maintenance.test.ts
git commit -m "feat: pin checkpoint evidence shape and extend resource counts in place"
```

---

### Task 10: Inventory observation freshness

**Files:**

- Modify: `src/integrations/inventory.ts`, `src/storage/inventory-snapshot.ts`, `src/pi/session-start.ts`, `src/storage/retention.ts`
- Test: `tests/unit/inventory-snapshot.test.ts`, `tests/unit/retention.test.ts` (extend)

**Interfaces:**

- Consumes: existing `InventorySnapshot`.
- Produces: `InventorySnapshot.observedAt?: string`; `refreshInventorySnapshot({ directory, snapshot, observedAt })`; `pruneExpiredInventory` keyed on `observedAt`.

- [ ] **Step 1: Write the failing test**

```ts
test("byte-equivalent observation advances observedAt", async () => {
  const snapshot = { schemaVersion: 1, commands: [], skills: [], resources: [], toolSources: {} };
  await refreshInventorySnapshot({ directory, snapshot, observedAt: "2026-09-12T10:00:00.000Z" });
  await refreshInventorySnapshot({ directory, snapshot, observedAt: "2026-09-12T11:00:00.000Z" });
  assert.equal((await readInventorySnapshot(directory))?.observedAt, "2026-09-12T11:00:00.000Z");
});

test("failed observation does not advance observedAt", async () => {
  const snapshot = { schemaVersion: 1, commands: [], skills: [], resources: [], toolSources: {} };
  await refreshInventorySnapshot({ directory, snapshot, observedAt: "2026-09-12T10:00:00.000Z" });
  await writeFile(join(directory, "inventory.json"), "{not json");
  await refreshInventorySnapshot({ directory, snapshot, observedAt: "2026-09-12T11:00:00.000Z" }).catch(() => {});
  assert.equal(await readInventorySnapshot(directory), undefined);
});

test("retention cutoff between T1 and T2 keeps the snapshot", async () => {
  await writeFile(
    join(directory, "inventory.json"),
    JSON.stringify({
      schemaVersion: 1,
      observedAt: "2026-09-12T11:00:00.000Z",
      commands: [],
      skills: [],
      resources: [],
      toolSources: {},
    }),
  );
  await pruneExpiredInventory({ directory, cutoff: "2026-09-12-10", remove: (p) => rm(p) });
  assert.notEqual(await readInventorySnapshot(directory), undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/inventory-snapshot.test.ts tests/unit/retention.test.ts`
Expected: FAIL — `observedAt` is dropped by `boundInventorySnapshot`, and retention still uses mtime.

- [ ] **Step 3: Implement**

1. `src/integrations/inventory.ts`: add `observedAt?: string` to `InventorySnapshot`. Keep it out of `inventoryHash` so payload identity is unchanged.
2. `src/storage/inventory-snapshot.ts`: preserve `observedAt` through `boundInventorySnapshot`/`parseInventorySnapshot` (validated ISO instant, bounded); `refreshInventorySnapshot` rewrites whenever payload hash changed **or** `observedAt` advanced; reuse payload bytes when content is equal.
3. `src/pi/session-start.ts`: `refreshSessionInventory` accepts `now?: () => Date` and stamps `observedAt` from it (default `() => new Date()`); `readSessionInventory` stays payload-only.
4. `src/storage/retention.ts`: `pruneExpiredInventory` reads the snapshot `observedAt` and prunes only when it is strictly before the cutoff date; a missing/invalid `observedAt` means keep (never infer from mtime).

- [ ] **Step 4: Run tests**

Run: `node --import tsx --test tests/unit/inventory-snapshot.test.ts tests/unit/retention.test.ts tests/unit/session-start.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/integrations/inventory.ts src/storage/inventory-snapshot.ts src/pi/session-start.ts src/storage/retention.ts tests/unit/inventory-snapshot.test.ts tests/unit/retention.test.ts
git commit -m "feat: make inventory observation freshness normative"
```

---

### Task 11: Retained aggregates with exact fold boundary

**Files:**

- Create: `src/core/retained-aggregates.ts`
- Test: `tests/unit/retained-aggregates.test.ts`, `tests/unit/folded-aggregate-boundary.test.ts`

**Interfaces:**

- Consumes: `Checkpoint` (Task 9), `SkillInvocationObservation` (Task 5), `FoldedCounters`.
- Produces: `buildRetainedAggregates(input): CanonicalRetainedAggregates` plus the shared DTOs `AggregateValue<T>`, `CanonicalRetainedAggregates` (spec §11).

- [ ] **Step 1: Write the failing test**

```ts
test("folded prefix and retained suffix are disjoint and labelled", () => {
  const aggregates = buildRetainedAggregates({
    sessionId: "s1",
    checkpoint: {
      aggregates: {
        skillInvocations: { alpha: 4 },
        skillOverflowInvocations: 1,
        integrationCounters: { permission: { decisions: 2 } },
        presence: { permission: true },
      },
      cursors: { pi: { lineCount: 0, revision: "0".repeat(64) }, wal: { "w-1": 2 } },
      sealedWal: { "w-1": 2 },
      evidence: { checkpointedAt: "2026-09-12T10:00:00.000Z" },
    },
    retained: {
      skillNames: ["alpha", "beta"],
      counters: { permission: { decisions: 1 } },
      permissionPresence: false,
    },
  });
  assert.deepEqual(aggregates.skillInvocations?.named?.value, { alpha: 4, beta: 1 });
  assert.equal(aggregates.skillInvocations?.named?.state, "aggregate-only");
  assert.deepEqual(aggregates.boundary.foldedThrough, { "w-1": 2 });
  assert.deepEqual(aggregates.boundary.sealedThrough, { "w-1": 2 });
  assert.equal(aggregates.permissionPresence?.value, true);
  assert.equal(aggregates.integration?.permission?.value.decisions, 3);
});

test("no checkpoint yields no synthetic aggregate values", () => {
  const aggregates = buildRetainedAggregates({ sessionId: "s1", checkpoint: undefined, retained: { skillNames: [], counters: {}, permissionPresence: false } });
  assert.equal(aggregates.skillInvocations, undefined);
  assert.equal(aggregates.boundary.detail, "expired");
});

test("boundary inconsistency is rejected, never repaired", () => {
  assert.throws(() =>
    buildRetainedAggregates({
      sessionId: "s1",
      checkpoint: { cursors: { wal: { "w-1": 9 } }, sealedWal: {}, aggregates: {} },
      retained: { skillNames: [], counters: {}, permissionPresence: false, lastSequence: { "w-1": 3 } },
    }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/retained-aggregates.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`buildRetainedAggregates` folds retained counts into the checkpoint prefix exactly once (checkpoint value + retained suffix), returns `state: "aggregate-only"` for every value that includes a folded or pruned contribution, sets `boundary.detail` to `full` only when no folded/pruned contribution exists, and throws on a cursor ahead of the last observed retained sequence without a matching seal. It never emits rows or timestamps.

- [ ] **Step 4: Run tests**

Run: `node --import tsx --test tests/unit/retained-aggregates.test.ts tests/unit/folded-aggregate-boundary.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/retained-aggregates.ts tests/unit/retained-aggregates.test.ts tests/unit/folded-aggregate-boundary.test.ts
git commit -m "feat: reconcile checkpoint aggregates with retained atomic evidence"
```

---

### Task 12: Hardened parent-session resolution

**Files:**

- Create: `src/pi/parent-session.ts`
- Test: `tests/unit/parent-session.test.ts`

**Interfaces:**

- Consumes: Node `fs/promises`, `node:path`.
- Produces: `resolveParentSession({ parentPath, sessionRoot, readHeader? }): Promise<{ state: "known"; id: string } | { state: "unavailable" }>`.

- [ ] **Step 1: Write the failing test**

```ts
test("valid contained parent resolves to its session id", async () => {
  const result = await resolveParentSession({ parentPath: join(root, "parent.jsonl"), sessionRoot: root });
  assert.deepEqual(result, { state: "known", id: "parent-session" });
});

test("symlink, outside-root, directory and oversize are unavailable", async () => {
  assert.deepEqual(await resolveParentSession({ parentPath: linkPath, sessionRoot: root }), { state: "unavailable" });
  assert.deepEqual(await resolveParentSession({ parentPath: outsidePath, sessionRoot: root }), { state: "unavailable" });
  assert.deepEqual(await resolveParentSession({ parentPath: root, sessionRoot: root }), { state: "unavailable" });
  assert.deepEqual(await resolveParentSession({ parentPath: hugePath, sessionRoot: root }), { state: "unavailable" });
});

test("wrong version, bad header and self-reference are unavailable", async () => {
  assert.deepEqual(await resolveParentSession({ parentPath: v2Path, sessionRoot: root }), { state: "unavailable" });
  assert.deepEqual(await resolveParentSession({ parentPath: selfPath, sessionRoot: root, childSessionId: "parent-session" }), { state: "unavailable" });
  assert.deepEqual(await resolveParentSession({ parentPath: "just-a-name.jsonl", sessionRoot: root }), { state: "unavailable" });
});

test("no path text or filesystem detail escapes", async () => {
  const result = await resolveParentSession({ parentPath: outsidePath, sessionRoot: root });
  assert.equal(JSON.stringify(result).includes(root), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/parent-session.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Follow spec §8.7 exactly: 4,096-byte input bound; real path of the approved root; lexical relative containment (`relative()` must not start with `..` or be absolute); `lstat` every component beneath the root rejecting symbolic links; final target must be a regular file; `realpath` re-containment; read-only open with `fstat` regular-file check; read only the first non-empty line bounded to 16 KiB; require a v3 header with a valid bounded id different from `childSessionId`; close in `finally`; return only the validated id.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/parent-session.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pi/parent-session.ts tests/unit/parent-session.test.ts
git commit -m "feat: harden parent-session resolution to approved roots"
```

---

### Task 13: L1 canonical builder

**Files:**

- Create: `src/core/canonical.ts`, `src/core/evidence-health.ts`
- Test: `tests/unit/canonical-builder.test.ts`, `tests/unit/evidence-health.test.ts`

**Interfaces:**

- Consumes: Tasks 2–12 outputs and existing `reduceEntries`/`toSessionReport` inputs.
- Produces: `CanonicalSession`, `CanonicalSessionBuildResult`, `CanonicalSkillInvocation`, `CanonicalRetainedAggregates`, `buildCanonicalSession(input): CanonicalSessionBuildResult`, and `projectEvidenceHealth(session): SessionEvidenceHealth`.

- [ ] **Step 1: Write the failing test**

```ts
test("missing marker yields unavailable with health, not a session", () => {
  const result = buildCanonicalSession({ sessionId: "s1", parsed, scope: "tree", leafId: null, evidence: { atomic: [], folded: [] } });
  assert.equal(result.state, "unavailable");
  assert.equal(result.state === "available", false);
  assert.ok(result.health.diagnostics.some((d) => d.code === "tracking-marker-missing"));
});

test("ready session exposes skill detail, aggregates and reconciled usage", () => {
  const result = buildCanonicalSession({ sessionId: "s1", parsed: withMarker, scope: "tree", leafId: null, evidence });
  assert.equal(result.state, "ready");
  const session = result.state === "ready" ? result.session : undefined;
  assert.equal(session?.skillInvocations.length, 1);
  assert.equal(session?.retainedAggregates.boundary.detail, "aggregate-only");
  assert.equal(session?.usage.state, "known");
  const health = projectEvidenceHealth(session!);
  assert.equal(health.aggregates.skills.retainedInvocations, 1);
  assert.equal(health.core, "supported");
});

test("unknown semantic node never emits a payload fact", () => {
  const result = buildCanonicalSession({ sessionId: "s1", parsed: withUnknownNode, scope: "tree", leafId: null, evidence: { atomic: [], folded: [] } });
  const session = result.state === "ready" ? result.session : undefined;
  assert.equal(session?.graph.nodes.length, 3);
  assert.equal(session?.generations.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/canonical-builder.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

The builder pipeline is exactly spec §11.1. It resolves scope over graph nodes, maps scoped entries to semantic facts, calls `reduceEntries` for native usage/tools/errors, attaches `skillInvocations` from Task 5 facts, `retainedAggregates` from Task 11, subagent runs from Task 6, live timings from Task 7 records, and ends by producing health through `src/core/evidence-health.ts` (fixed source order, sorted diagnostics, saturating counts, `truncated` on saturation). `core` is `unavailable` only for Pi/marker reportability.

- [ ] **Step 4: Run tests**

Run: `node --import tsx --test tests/unit/canonical-builder.test.ts tests/unit/evidence-health.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add L1 canonical session builder and evidence health"
```

---

### Task 14: Report DTO carries canonical health and aggregates

**Files:**

- Modify: `src/core/reports.ts`
- Test: `tests/unit/reports-integrations.test.ts` (extend)

**Interfaces:**

- Consumes: `CanonicalSession` (Task 13).
- Produces: `SessionReport.evidenceHealth: SessionEvidenceHealth` and `SessionReport.retainedAggregates?: CanonicalRetainedAggregates`.

- [ ] **Step 1: Write the failing test**

```ts
test("report exposes bounded health and labels aggregate-only counts", () => {
  const report = toSessionReport(reduced, { evidenceHealth: health, retainedAggregates: aggregates });
  assert.equal(report.evidenceHealth.aggregates.detail, "aggregate-only");
  assert.equal(JSON.stringify(report).includes("req-"), false);
  assert.equal(report.evidenceHealth.sources.map((s) => s.source).join(), "pi-jsonl,inspector-wal");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/reports-integrations.test.ts`
Expected: FAIL — `evidenceHealth` not projected.

- [ ] **Step 3: Implement**

Extend `SessionReportEvidence` with `evidenceHealth`/`retainedAggregates`, re-validate both defensively in `projectEvidence` (closed enums, bounded counts, fixed source order), and spread them into `SessionReport`. When no health is supplied, emit `unavailable` health rather than omitting the field, so every renderer receives the same shape.

- [ ] **Step 4: Run tests**

Run: `node --import tsx --test tests/unit/reports-integrations.test.ts tests/unit/html-bundle.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: project canonical evidence health into the report DTO"
```

---

### Task 15: Current loader convergence

**Files:**

- Modify: `src/ui/load-current.ts`, `src/index.ts`
- Test: `tests/unit/index-current-ui.test.ts` (extend), `tests/unit/current-ui.test.ts`

**Interfaces:**

- Consumes: `buildCanonicalSession` (Task 13).
- Produces: `loadCurrentSessionReport` takes `evidence: L0Evidence` built by `src/index.ts`; no direct `readCheckpoint`/`recoverSession`/`readInventorySnapshot` import remains in `src/ui/`.

- [ ] **Step 1: Write the failing test**

```ts
test("loaders never import storage readers", async () => {
  const source = await readFile("src/ui/load-current.ts", "utf8");
  assert.equal(/readCheckpoint|recoverSession|readInventorySnapshot|readWal/.test(source), false);
});

test("current report is produced from supplied L0 evidence", async () => {
  const model = await loadCurrentSessionReport(sessionFile, "tree", {
    leafId: null,
    evidence: { atomic: [], folded: [] },
  });
  assert.equal(model?.report.evidenceHealth.core, "supported");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/index-current-ui.test.ts`
Expected: FAIL — `load-current.ts` still imports `readCheckpoint`.

- [ ] **Step 3: Implement**

1. `src/index.ts` `readSessionObservation` becomes `readSessionEvidence`: it refreshes inventory, reads checkpoint + WAL, and returns `L0Evidence` (`atomic`: skill invocations + live timings; `folded`: checkpoint aggregates/resources) — no reconciliation. Folded counters are still merged for compatibility through `foldedFromCheckpointAggregates` inside the builder, not the loader.
2. `src/ui/load-current.ts` parses JSONL, calls `buildCanonicalSession`, and converts a ready session through `toSessionReport`; unavailable/unsupported returns `undefined` exactly as today.
3. Keep the existing `walDetail: "expired"` signal derived from `retainedAggregates.boundary`.

- [ ] **Step 4: Run tests**

Run: `node --import tsx --test tests/unit/index-current-ui.test.ts tests/unit/current-ui.test.ts tests/unit/current-tui.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor: route current reports through the canonical builder"
```

---

### Task 16: History and global loader convergence

**Files:**

- Modify: `src/ui/load-history.ts`
- Test: `tests/unit/history-reports.test.ts`, `tests/unit/history.test.ts` (extend)

**Interfaces:**

- Consumes: `buildCanonicalSession` (Task 13).
- Produces: `scanHistory` builds each session report from the builder; `globalInventory` reads aggregate values only from the same reports.

- [ ] **Step 1: Write the failing test**

```ts
test("history session report comes from the canonical builder", async () => {
  const reports = await loadHistoryReports(options);
  assert.equal(reports.sessions[0]?.report.evidenceHealth.aggregates.detail, "aggregate-only");
  assert.equal("resourceCounts" in (reports.sessions[0]?.report.skills ?? {}), false);
});

test("source files keep no direct storage reads", async () => {
  const source = await readFile("src/ui/load-history.ts", "utf8");
  assert.equal(/readCheckpoint|readInventorySnapshot|recoverSession/.test(source), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/history-reports.test.ts`
Expected: FAIL — direct reads remain.

- [ ] **Step 3: Implement**

`scanHistory` keeps discovery/marker validation, then builds one `L0Evidence` per session (checkpoint aggregates + resource counts + retained inventory detail) and calls the builder once; `toSessionReport` output is unchanged in shape apart from the new fields. `globalInventory` sums the canonical resource counts from those reports and keeps `unknown` when a session reports none.

- [ ] **Step 4: Run tests**

Run: `node --import tsx --test tests/unit/history-reports.test.ts tests/unit/history.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor: route history and global reports through the canonical builder"
```

---

### Task 17: Retention records the exact expiration boundary

**Files:**

- Modify: `src/storage/retention.ts`, `src/storage/maintenance.ts`
- Test: `tests/unit/retention.test.ts` (extend)

**Interfaces:**

- Consumes: `Checkpoint.evidence.detailCoverage` (Task 9).
- Produces: `detailCoverage.walDetailExpiredBefore` and `detailCoverage.inventoryDetailExpiredAt` written when pruning actually removes detail.

- [ ] **Step 1: Write the failing test**

```ts
test("pruning records the expiration boundary once detail is gone", async () => {
  await pruneExpiredWalSegments({ directory, lease, now: () => new Date("2026-09-12T12:00:00.000Z"), validate: async () => true });
  const checkpoint = await readCheckpoint({ directory });
  assert.equal(typeof checkpoint?.evidence?.detailCoverage?.walDetailExpiredBefore, "string");
});

test("kept detail leaves the boundary unset", async () => {
  assert.equal((await readCheckpoint({ directory: fresh }))?.evidence?.detailCoverage, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/retention.test.ts`
Expected: FAIL — boundary never written.

- [ ] **Step 3: Implement**

Record the UTC date of each successful prune into `evidence.detailCoverage` (WAL before cursor, inventory date) under the maintenance lease, and keep `step` idempotent: re-running with no new pruning must not change the file bytes.

- [ ] **Step 4: Run tests**

Run: `node --import tsx --test tests/unit/retention.test.ts tests/unit/maintenance.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: record exact detail expiration boundary on prune"
```

---

### Task 18: Determinism, privacy corpus and boundary assertions

**Files:**

- Test: `tests/integration/evidence-foundation.test.ts`, `tests/unit/integration-privacy.test.ts` (extend)
- Fixture: `tests/fixtures/pi/0.85.1/unknown-entry-ancestry.jsonl` (synthetic)

**Interfaces:**

- Consumes: every artifact produced by Tasks 1–17.
- Produces: regression coverage for spec §17 invariants 29–35 and §18.8 checks.

- [ ] **Step 1: Write the failing test**

```ts
test("unchanged inputs produce byte-identical canonical JSON twice", async () => {
  const first = JSON.stringify(await buildFixtureSession());
  const second = JSON.stringify(await buildFixtureSession());
  assert.equal(first, second);
});

test("privacy scanner finds no prohibited key in any artifact", async () => {
  for (const artifact of [walText, checkpointText, inventoryText, reportText]) {
    assert.equal(/(prompt|content|"args"|resultBody|secret|token|\/home\/)/i.test(artifact), false);
  }
});

test("aggregate-only and unavailable never serialize as zero", () => {
  assert.equal(report.evidenceHealth.aggregates.detail, "aggregate-only");
  assert.notEqual(report.skills.invocationState, "unavailable");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/integration/evidence-foundation.test.ts`
Expected: FAIL until fixtures and helpers exist.

- [ ] **Step 3: Implement**

Add the synthetic `unknown-entry-ancestry.jsonl` fixture (marker → known → unknown → known leaf) with a provenance comment header stating it is synthetic, plus the fixture builder helper used by the determinism test. Extend `tests/unit/integration-privacy.test.ts` with the opaque-ID and aggregate-only assertions from spec §18.7.

- [ ] **Step 4: Run tests**

Run: `node --import tsx --test tests/integration/evidence-foundation.test.ts tests/unit/integration-privacy.test.ts tests/unit/uat-evidence.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "test: add determinism, privacy and aggregate boundary coverage"
```

---

### Task 19: ADR 0016, spec update, changelog and version 0.8.0

**Files:**

- Create: `docs/architecture/adr/0016-evidence-foundation-and-canonical-session-model.md`
- Modify: `docs/specs/pi-session-inspector-v1.md`, `CHANGELOG.md`, `package.json`, `docs/architecture/README.md`

**Interfaces:**

- Consumes: the implementation delivered by Tasks 1–18.
- Produces: the released `0.8.0` boundary and ADR 0016.

- [ ] **Step 1: Write ADR 0016**

Record: L0 atomic/folded split; L1 as the single semantic boundary; L2 never reads storage; skill invocation as first-class evidence; retained aggregates with fold/seal boundaries; opaque-ID helper; hardened parent resolution; supersession of ADR 0014's narrow "never read `request`" rule for the hashed `attribution.request` form only.

- [ ] **Step 2: Update the v1 spec**

Add the L0/L1/L2 contract summary, the four new report fields, checkpoint `evidence`/extended `resourceCounts`, inventory observation semantics, and the invariant list from spec §17.

- [ ] **Step 3: Changelog and version**

Add a `0.8.0` entry; bump `package.json` version to `0.8.0`.

- [ ] **Step 4: Verify packaging and docs**

Run: `npm pack --dry-run`
Expected: succeeds; `docs/` excluded per package `files` list, `src/` included.

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/adr/0016-evidence-foundation-and-canonical-session-model.md docs/architecture/README.md docs/specs/pi-session-inspector-v1.md CHANGELOG.md package.json
git commit -m "docs: record evidence foundation architecture and release 0.8.0"
```

---

### Task 20: Final verification

**Files:**

- No new files.

**Interfaces:**

- Consumes: everything above.
- Produces: verified release state.

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 2: Type and lint**

Run: `npm run typecheck && npm run lint && npm run format:check`
Expected: all clean.

- [ ] **Step 3: LSP sweep on changed TypeScript paths**

Run the `lens_diagnostics` source=lsp probe over the paths touched by Tasks 1–19.
Expected: no errors; warnings triaged.

- [ ] **Step 4: Storage and privacy audit**

Confirm by grep that no file under `src/ui/` or `src/core/reports.ts` imports `src/storage/*`, and that no raw producer identity appears beside an opaque id in fixtures or artifacts.

```bash
grep -rn "storage/" src/ui src/core/reports.ts || echo "no direct storage imports"
```

- [ ] **Step 5: Confirm downstream files untouched**

```bash
git diff --exit-code HEAD~19 -- docs/superpowers/specs/2026-09-12-report-semantics-diagnostics-navigation-design.md docs/superpowers/plans/2026-09-12-report-semantics-diagnostics-navigation-implementation.md
echo "downstream untouched"
```

- [ ] **Step 6: Commit any residual fixups**

```bash
git status --short
git commit -m "chore: final evidence foundation verification" || echo "nothing to commit"
```

---

## Self-Review

### 1. Spec coverage

| Spec section | Task |
| --- | --- |
| §7 L0 contracts, atomic/folded split | 2, 5, 11 |
| §7.2 source gates, unknown-entry rule | 3, 4, 13 |
| §8.1 identity + §8.1.1 opaque IDs | 1, 7, 8, 13 |
| §8.2 graph/scope, §8.3 relationships | 4, 13 |
| §8.4 tool reconciliation, §8.5 child runs | 6, 13 |
| §8.6 integration relations | 6, 8, 11 |
| §8.7 parent resolution | 12 |
| §9 timestamps/attribution | 6, 7, 13 |
| §10 usage ledger/invariants | 13, 14 |
| §11 canonical contract + build result | 13 |
| §12 evidence-health JSON | 13, 14 |
| §13 WAL subjectId + telemetry | 7, 8 |
| §14 checkpoint/inventory evolution | 9, 10, 11, 17 |
| §15 recovery/retention/freshness | 7, 10, 11, 17 |
| §16 privacy/provenance | 1, 5, 14, 18 |
| §17 invariants 29–35 | 11, 13, 14, 18 |
| §18 tests | 1–18 (each task) + 18 |
| §18.8 release checks | 19, 20 |
| §19 downstream mapping | 20 Step 5 (assert unchanged) |
| §20 implementation boundaries | task ordering 1→20 |

No gap found: every spec section maps to at least one task, and the two bounded clarifications (checkpoint physical shape, inventory freshness) are Tasks 9 and 10.

### 2. Placeholder scan

No "TBD"/"TODO"/"similar to Task N"/"add appropriate error handling" text remains. Every code step carries runnable code, the exact command, and the expected outcome. Steps that summarize an implementation (Task 4 Step 3, Task 13 Step 3, Task 16 Step 3) stay behavior-exact and are backed by the executable tests in the same task.

### 3. Type consistency

Names are stable across tasks: `canonicalOpaqueDigest` (1) → `SkillInvocationObservation` (2, 5) → `PiGraphNode`/`buildGraphNodes` (3) → `resolveScope`/`ScopeResolution` (4) → `AgentRun.observedAt`/`evidenceToolId`/`failure` (6) → `LiveTiming.subjectId` (7) → `aggregates.resourceCounts`/`evidence` (9) → `InventorySnapshot.observedAt` (10) → `CanonicalRetainedAggregates`/`AggregateValue` (11) → `resolveParentSession` (12) → `buildCanonicalSession`/`projectEvidenceHealth` (13) → `SessionReport.evidenceHealth` (14). No aliases are introduced between tasks.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-12-evidence-foundation-canonical-session-model-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**

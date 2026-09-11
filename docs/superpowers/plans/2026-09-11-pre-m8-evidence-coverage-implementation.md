# Pre-M8 Evidence Coverage & Resource Inventory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining observability gaps (mode evidence, permission bus, commands/skills/resources inventory, pi-subagents auto-discovery, bounded error messages) and rebuild the Inspector command surface around positional `ui`/`tui`/`json` modes with a fully offline HTML bundle.

**Architecture:** Producers are audited against pinned upstream formats; sanitized evidence enters a versioned adapter registry and, for live-only facts, the existing validated WAL telemetry record, which is folded cursor-based into additive checkpoint aggregates. Renderers consume one DTO. `/session-inspector ui` renders a single self-contained `InspectorBundle` with both Current views (`active`, `tree`) precomputed at generation time, so in-page scope and date-range controls work offline.

**Tech Stack:** TypeScript ESM on Node `>=22.19.0`, `node:test` + `tsx`, Biome, `@earendil-works/pi-coding-agent` 0.85.1 APIs (`modules/getCommands`, `getAllTools`, `events`, `input`), `@earendil-works/pi-tui`. No new runtime dependency; no network; no SQLite; no daemon.

**Spec:** `docs/superpowers/specs/2026-09-11-pre-m8-evidence-coverage-design.md`

## Global Constraints

- Pi JSONL is authority. Inspector never writes Pi session data; the single exception remains the `session-inspector:tracking-start` marker.
- Observer-only: every new hook, bus subscription, filesystem read, and write must swallow its own errors and never alter Pi execution.
- Privacy: never persist, log, or render prompts, assistant/user text, tool arguments, tool-result bodies, command output, tool `description`/`parameters`/`promptGuidelines`, permission `value`/`matchedPattern`/`request`/`forwarding`/`agentName`/`origin`, raw `sourceInfo.source` when URL/path-shaped, or filesystem paths. Allowed bounded metadata: sanitized command/skill/resource-source names, their source labels/scope/origin, per-skill counts, `[REDACTED]`/`[PATH]`/`[URL]` markers.
- `unavailable != 0`. Missing, unsupported, or expired evidence renders as explicit unavailable/unsupported/not-observed, never as zero and never as a guess.
- Determinism: identical inputs produce byte-identical JSON and HTML. All folds are integer sums or deterministic ordering (`timestamp`, `writerId`, `writerSequence`, `eventId`).
- Additive schema: checkpoint `schemaVersion` stays `1` with optional validated aggregate fields; unknown/malformed persisted state degrades, never crashes.
- Bounded everything: reuse existing budgets (`256` writers, `1024` segments, `64 MiB`, `100 000` records, `16 MiB` file, `64 KiB` line, `206` history sessions); new caps are `≤64` skill invocation keys, `≤16` counter keys per integration, `≤366` daily rows, `≤64` resource rows, `≤256` commands, `≤128` skills, `≤64 KiB` inventory file, `≤128 KiB` archive file, `≤200` bytes error message.
- Version `0.6.1 → 0.7.0` before the final task commits; no M8 work (fuzzers, release publishing, CI wiring) in this plan.

### Shared interfaces (defined by the task that introduces them; later tasks must use these exact names)

```ts
// Task 1-2: src/core/events.ts
type IntegrationKey = "context" | "rtk" | "ponytail" | "caveman" | "permission" | "subagents" | "lens";
type IntegrationPresence = "present" | "absent" | "unknown";
type IntegrationObservation = {
  integration: IntegrationKey;
  presence: IntegrationPresence;
  state: EvidenceState;
  version?: number;
  counters?: Readonly<Record<string, number | boolean>>;
};
type ErrorRecord = { id: string; timestamp: string; kind: ErrorKind; confidence: Confidence; message?: string };
type Tool = { id: string; timestamp: string; name: string; status: "succeeded" | "failed" | "interrupted"; source?: string; usage?: Usage; durationMs?: number };

// Task 3: src/core/live-counter-fold.ts
// Counters ALWAYS move in two separate buckets: `checkpoint` (already folded into the
// checkpoint) and `delta` (telemetry strictly after the checkpoint WAL cursors).
// Reports consume `effective = merge(checkpoint, delta)`; maintenance persists merge(existing, delta).
type FoldedCounters = {
  counters: Partial<Record<IntegrationKey, Record<string, number>>>;
  skillInvocations: Record<string, number>;
  otherInvocations: number;                       // exact count of invocations whose key was beyond the 64-key cap
  presence: { permission: boolean };              // durable presence, never an activity counter
};
function emptyFoldedCounters(): FoldedCounters;
function mergeFoldedCounters(base: FoldedCounters | undefined, delta: FoldedCounters): FoldedCounters;
function foldTelemetryCounters(envelopes: readonly unknown[], initial?: FoldedCounters): FoldedCounters;
function counterDeltaAfterCursors(
  records: readonly { writerId: string; writerSequence: number; telemetry?: Record<string, unknown> }[],
  cursors: Readonly<Record<string, number>>,
): FoldedCounters;
function foldedFromCheckpointAggregates(aggregates: CheckpointAggregates | undefined): FoldedCounters;

// Task 4: src/storage/recovery.ts (RecoveryResult gains; delta only, never the whole replay)
type RecoveryResult = { /* existing */ cursors: Record<string, number>; deltaCounters: FoldedCounters };

// Task 6: src/ui/observation.ts (subagents are derived by the loaders, not injected)
type SessionObservation = {
  inventory?: InventorySnapshot;                                  // Task 7
  presence: Readonly<Record<IntegrationKey, IntegrationPresence>>; // Task 2 + durable permission presence
  counters?: FoldedCounters;                                       // Task 3, effective (checkpoint + delta)
};

// Task 7: src/integrations/inventory.ts
type CommandRow = { name: string; source: "extension" | "prompt" | "skill"; sourceLabel: string; scope: "user" | "project" | "temporary"; origin: "package" | "top-level"; description?: string };
type SkillRow = { name: string; sourceLabel?: string; scope?: "user" | "project" | "temporary"; origin?: "package" | "top-level"; description?: string; explicitInvocations?: number };
type ResourceSourceRow = { sourceLabel: string; scope: "user" | "project" | "temporary"; origin: "package" | "top-level"; commands: number; skills: number; prompts: number; tools: number };
type InventorySnapshot = { schemaVersion: 1; commands: readonly CommandRow[]; skills: readonly SkillRow[]; resources: readonly ResourceSourceRow[]; toolSources: Readonly<Record<string, string>> };
function readInventory(commands: readonly unknown[], tools: readonly unknown[]): InventorySnapshot;
function sanitizeSourceLabel(value: unknown): string;
function inventoryHash(snapshot: InventorySnapshot): string;

// Task 10-11: src/integrations/subagents.ts, src/integrations/subagent-archive.ts
type AgentToolActivity = { state: EvidenceState; calls: number; succeeded: number; failed: number; interrupted: number; tools: readonly { name: string; calls: number }[]; usage?: Usage };
type SubagentEvidence = { activity: AgentToolActivity; runs: readonly AgentRun[]; state: EvidenceState };
function readSubagentEvidence(entries: readonly SessionEntry[]): SubagentEvidence;
async function readSubagentEvidenceWithArchives(entries: readonly SessionEntry[]): Promise<SubagentEvidence>;
async function readPublishedArchiveState(path: unknown, runId: string): Promise<"available" | "missing">;

// Task 12: src/core/redact.ts
function secretLikeValue(value: string): boolean;
function redactBoundedText(value: unknown, maxBytes?: number): string | undefined;

// Task 13: src/ui/bundle.ts
type DailyRow = { date: string; sessions: number; totalTokens: number; cost: number; generations: number; tools: number };
type CurrentView = { availability: "available" | "unavailable"; diagnostic?: string; report?: SessionReport; daily?: readonly DailyRow[]; dailyTruncated?: boolean };
type InspectorBundle = { schemaVersion: 1; theme: "light" | "dark"; initialScope: Scope; current: { active: CurrentView; tree: CurrentView }; history: HistoryReport; global: GlobalReport };
async function loadInspectorBundle(input: InspectorBundleInput): Promise<InspectorBundle>;

// Task 16: src/commands/grammar.ts
type InspectorMode = "ui" | "tui" | "json";
type InspectorTarget = "current" | "ledger" | "history" | "global";
type InspectorCommand =
  | { kind: "report"; mode: InspectorMode; target: InspectorTarget; scope: Scope; theme?: "dark" | "light"; output?: string; noOpen: boolean }
  | { kind: "help" };
function parseInspectorCommand(args: string): { ok: true; command: InspectorCommand } | { ok: false; message: string };
```

---

### Task 1: Mode evidence from schema-less Ponytail/Caveman entries

**Files:**

- Modify: `src/core/events.ts` (IntegrationKey union)
- Modify: `src/core/integration-counter-allowlists.ts`
- Modify: `src/integrations/pi-entries.ts`
- Modify: `src/core/reports.ts` (integration key set)
- Create: `tests/fixtures/pi/0.85.1/ponytail-caveman.jsonl`
- Modify: `tests/unit/pi-entry-integrations.test.ts`

**Interfaces:**

- Produces: `IntegrationKey` includes `"ponytail" | "caveman"`; `readPiEntryEvidence(entries)` emits those rows with `{ version: 1, state: "supported", counters: { changes: n } }`; legacy `mode` remains accepted by `isKnownIntegrationVersion`/`isAllowedIntegrationCounter` and by `reports.ts` projection.
- Consumes: existing `createEvidenceRegistry`, `readPiEntryEvidence`.

- [ ] **Step 1: Write the failing test**

Create `tests/fixtures/pi/0.85.1/ponytail-caveman.jsonl` (synthetic; producer `ponytail@356918e` writes `{ mode }`, `pi-caveman@1.0.8` writes `{ level }`, neither writes `schemaVersion`):

```jsonl
{"type":"session","version":3,"id":"mode-session"}
{"type":"custom","id":"p1","parentId":null,"timestamp":"2026-09-11T10:00:00Z","customType":"ponytail-mode","data":{"mode":"lite"}}
{"type":"custom","id":"c1","parentId":"p1","timestamp":"2026-09-11T10:00:01Z","customType":"caveman-level","data":{"level":"full"}}
{"type":"custom","id":"p2","parentId":"c1","timestamp":"2026-09-11T10:00:02Z","customType":"ponytail-mode","data":{"mode":"ultra"}}
{"type":"custom","id":"p3","parentId":"p2","timestamp":"2026-09-11T10:00:03Z","customType":"ponytail-mode","data":{"mode":"not-a-mode"}}
{"type":"custom","id":"c2","parentId":"p3","timestamp":"2026-09-11T10:00:04Z","customType":"caveman-level","data":{"level":"wenyan-ultra"}}
{"type":"custom","id":"c3","parentId":"c2","timestamp":"2026-09-11T10:00:05Z","customType":"caveman-level","data":{"level":null}}
{"type":"custom","id":"legacy","parentId":"c3","timestamp":"2026-09-11T10:00:06Z","customType":"mode","data":{"schemaVersion":1,"changes":5}}
```

Replace the mode assertions in `tests/unit/pi-entry-integrations.test.ts` with:

```ts
test("reads schema-less Ponytail and Caveman mode entries as independent evidence", async () => {
  const fixture = await readFile(
    new URL("../fixtures/pi/0.85.1/ponytail-caveman.jsonl", import.meta.url),
    "utf8",
  );
  const { entries } = parseSessionJsonl(fixture);

  const rows = readPiEntryEvidence(entries);

  assert.deepEqual(
    rows.map((row) => row.integration),
    ["ponytail", "caveman"],
  );
  assert.deepEqual(rows[0]?.counters, { changes: 2 });
  assert.deepEqual(rows[1]?.counters, { changes: 2 });
  assert.equal(
    rows.every((row) => row.state === "supported" && row.version === 1),
    true,
  );
  assert.equal(JSON.stringify(rows).includes("not-a-mode"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/pi-entry-integrations.test.ts`
Expected: FAIL — rows come back as `["mode"]` / empty, and unknown `schemaVersion` gating drops the entries.

- [ ] **Step 3: Implement minimal code**

In `src/core/events.ts`:

```ts
export type IntegrationKey =
  | "context"
  | "rtk"
  | "ponytail"
  | "caveman"
  | "permission"
  | "subagents"
  | "lens";
```

In `src/core/integration-counter-allowlists.ts`, add `ponytail: { 1: new Set(["changes"]) }`, `caveman: { 1: new Set(["changes"]) }`, keep `mode: { 1: new Set(["changes"]) }` and widen the record key type to `IntegrationKey | "mode"`.

In `src/integrations/pi-entries.ts`:

```ts
const MODE_CUSTOM_TYPES: Readonly<Record<string, { integration: "ponytail" | "caveman"; field: string; values: ReadonlySet<string> }>> = {
  "ponytail-mode": { integration: "ponytail", field: "mode", values: new Set(["off", "lite", "full", "ultra", "review"]) },
  "caveman-level": { integration: "caveman", field: "level", values: new Set(["off", "lite", "full", "ultra", "wenyan-lite", "wenyan", "wenyan-ultra", "micro"]) },
};
```

In `readCustom()`, replace the `MODECUSTOM_TYPES`/`schemaVersion` branch with a producer-accurate path that runs **before** the `schemaVersion` guard:

```ts
const modeProducer = MODE_CUSTOM_TYPES[entry.customType];
if (modeProducer !== undefined) {
  const value = isRecord(entry.data) ? entry.data[modeProducer.field] : undefined;
  if (typeof value === "string" && modeProducer.values.has(value)) {
    this.add(modeProducer.integration, SUPPORTED_SCHEMA_VERSION, { changes: 1 });
  }
  return;
}
```

Register adapters for `ponytail` and `caveman` with the same `count("changes")` reader used by `mode`, and drop `"mode"` from `OBSERVATION_ORDER` (add `"ponytail"`, `"caveman"`).

In `src/core/reports.ts`, widen `INTEGRATION_KEYS` to the new union plus `"mode"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/pi-entry-integrations.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/core/events.ts src/core/integration-counter-allowlists.ts src/integrations/pi-entries.ts src/core/reports.ts tests/fixtures/pi/0.85.1/ponytail-caveman.jsonl tests/unit/pi-entry-integrations.test.ts
git commit -m "fix: read schema-less ponytail and caveman mode entries"
```

---

### Task 2: Remove the invented Permission custom-entry path and add the presence model

**Files:**

- Modify: `src/integrations/pi-entries.ts` (drop `PERMISSION_CUSTOM_TYPES`)
- Modify: `src/core/events.ts` (`IntegrationPresence`, `IntegrationObservation`)
- Create: `src/integrations/presence.ts`
- Modify: `src/core/reports.ts` (project presence, drop `version` requirement for unavailable rows)
- Create: `tests/unit/presence.test.ts`
- Modify: `tests/fixtures/integrations/pi-entries.jsonl` (remove permission custom entry)
- Modify: `tests/unit/pi-entry-integrations.test.ts`

**Interfaces:**

- Produces: `readIntegrationPresence(input: PresenceSignals): Record<IntegrationKey, IntegrationPresence>` where `PresenceSignals = { commands: readonly string[]; tools: readonly string[]; permissionsReady: boolean; inventoryAvailable: boolean }`; `IntegrationObservation.presence` and optional `version`.
- Consumes: `IntegrationKey` from Task 1.

- [ ] **Step 1: Write the failing test**

`tests/unit/presence.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { readIntegrationPresence } from "../../src/integrations/presence.ts";

test("maps native inventory signals to presence without guessing", () => {
  const rows = readIntegrationPresence({
    commands: ["ponytail", "caveman", "skill:council-mode"],
    tools: ["subagent", "subagent_wait", "ctx_execute", "lens_diagnostics", "read"],
    permissionsReady: false,
    inventoryAvailable: true,
  });

  assert.deepEqual(rows, {
    context: "present",
    rtk: "unknown",
    ponytail: "present",
    caveman: "present",
    permission: "unknown",
    subagents: "present",
    lens: "present",
  });
});

test("reports absence only with an available inventory, and presence from a ready bus", () => {
  const rows = readIntegrationPresence({
    commands: [],
    tools: ["read", "bash"],
    permissionsReady: true,
    inventoryAvailable: true,
  });

  assert.equal(rows.ponytail, "absent");
  assert.equal(rows.caveman, "absent");
  assert.equal(rows.context, "absent");
  assert.equal(rows.subagents, "absent");
  assert.equal(rows.rtk, "unknown");
  assert.equal(rows.permission, "present");

  const unknown = readIntegrationPresence({
    commands: [],
    tools: [],
    permissionsReady: false,
    inventoryAvailable: false,
  });
  assert.deepEqual(unknown, {
    context: "unknown",
    rtk: "unknown",
    ponytail: "unknown",
    caveman: "unknown",
    permission: "unknown",
    subagents: "unknown",
    lens: "unknown",
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/presence.test.ts`
Expected: FAIL — `Cannot find module '../../src/integrations/presence.ts'`.

- [ ] **Step 3: Implement minimal code**

`src/integrations/presence.ts`:

```ts
import type { IntegrationKey, IntegrationPresence } from "../core/events.ts";

export type PresenceSignals = {
  commands: readonly string[];
  tools: readonly string[];
  permissionsReady: boolean;
  inventoryAvailable: boolean;
};

type Signal = (input: PresenceSignals) => boolean;

const SIGNALS: Partial<Record<IntegrationKey, Signal>> = {
  ponytail: ({ commands }) => commands.includes("ponytail"),
  caveman: ({ commands }) => commands.includes("caveman"),
  context: ({ tools }) => tools.some((tool) => tool.startsWith("ctx_")),
  subagents: ({ tools }) =>
    tools.some((tool) =>
      ["subagent", "subagent_wait", "subagent_supervisor"].includes(tool),
    ),
  lens: ({ tools }) =>
    tools.some(
      (tool) =>
        tool.startsWith("lens_") ||
        tool.startsWith("pi_lens_") ||
        tool.startsWith("lsp_") ||
        tool.startsWith("ast_grep"),
    ),
};

export function readIntegrationPresence(
  input: PresenceSignals,
): Record<IntegrationKey, IntegrationPresence> {
  const keys: IntegrationKey[] = [
    "context",
    "rtk",
    "ponytail",
    "caveman",
    "permission",
    "subagents",
    "lens",
  ];
  const rows = {} as Record<IntegrationKey, IntegrationPresence>;
  for (const key of keys) {
    if (key === "permission") {
      rows[key] = input.permissionsReady ? "present" : "unknown";
      continue;
    }
    const signal = SIGNALS[key];
    if (signal === undefined) {
      rows[key] = "unknown";
      continue;
    }
    if (signal(input)) rows[key] = "present";
    else rows[key] = input.inventoryAvailable ? "absent" : "unknown";
  }
  return rows;
}
```

In `src/core/events.ts`:

```ts
export type IntegrationPresence = "present" | "absent" | "unknown";

export type IntegrationObservation = {
  integration: IntegrationKey;
  presence: IntegrationPresence;
  state: EvidenceState;
  version?: number;
  counters?: Readonly<Record<string, number | boolean>>;
};
```

In `src/integrations/pi-entries.ts`: delete `PERMISSION_CUSTOM_TYPES` and the `permission` adapter registration; keep `permission` out of `OBSERVATION_ORDER` (its row is produced by Task 6). Remove the permission entry from `tests/fixtures/integrations/pi-entries.jsonl` and its assertions.

In `src/core/reports.ts`: `projectIntegration` accepts `presence` (validated against the three values, default `"unknown"` when absent) and only requires `version` when `state !== "unavailable"`; `projectCounters` unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/presence.test.ts tests/unit/pi-entry-integrations.test.ts tests/unit/reports-integrations.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/integrations/pi-entries.ts src/integrations/presence.ts src/core/events.ts src/core/reports.ts tests/unit/presence.test.ts tests/unit/pi-entry-integrations.test.ts tests/fixtures/integrations/pi-entries.jsonl
git commit -m "fix: read permission evidence from its public bus and add presence model"
```

---

### Task 3: Live counter producers and the fold table

**Files:**

- Create: `src/core/live-counter-fold.ts`
- Create: `src/integrations/live-counters.ts`
- Create: `tests/fixtures/integrations/permission-events.json`
- Create: `tests/unit/live-counters.test.ts`
- Create: `tests/unit/live-counter-fold.test.ts`

**Interfaces:**

- Produces: `foldTelemetryCounters(envelopes, initial?)`; `mergeFoldedCounters(base, delta)`; `counterDeltaAfterCursors(records, cursors)`; `readSkillCommandName(text)`; `registerLiveCounters(api, writer, { inventoryNames, now })`.
- Semantics fixed here (defect fix): `FoldedCounters` carries `otherInvocations` (exact invocation count for keys beyond the 64-key cap — **not** a key count, and never a per-event increment of an omitted key) and `presence.permission` (durable presence from `permission.ready`, never an activity counter). Both are integer/boolean metadata that survive incremental folds and checkpoints.
- Consumes: `validateTelemetry` from `src/pi/telemetry.ts`; `IntegrationKey`/`FoldedCounters`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/live-counter-fold.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  foldTelemetryCounters,
  MAX_SKILL_KEYS,
} from "../../src/core/live-counter-fold.ts";

const envelope = (over: Record<string, unknown>) => ({
  schemaVersion: 1,
  source: "permission-system",
  metric: "permission.decision",
  kind: "counter",
  value: 1,
  ...over,
});

test("folds allowlisted permission counters and ignores unknown metrics", () => {
  const folded = foldTelemetryCounters([
    envelope({ dimensions: { result: "allow", resolution: "policy_allow" } }),
    envelope({ dimensions: { result: "deny", resolution: "user_denied" } }),
    envelope({ dimensions: { result: "deny", resolution: "gate_error" } }),
    envelope({ metric: "unknown.metric", dimensions: { result: "allow" } }),
    envelope({ kind: "gauge", dimensions: { result: "allow" } }),
  ]);

  assert.deepEqual(folded.counters.permission, {
    decisions: 3,
    allowed: 1,
    denied: 2,
    gateErrors: 1,
  });
});

test("folds skill invocations by validated name and counts overflow exactly", () => {
  const rows = Array.from({ length: MAX_SKILL_KEYS + 3 }, (_, index) =>
    envelope({
      source: "pi-input",
      metric: "skill.invocation",
      dimensions: { skill: `skill-${index}` },
    }),
  );
  const folded = foldTelemetryCounters(rows);

  assert.equal(Object.keys(folded.skillInvocations).length, MAX_SKILL_KEYS);
  assert.equal(folded.otherInvocations, 3);

  // Incremental fold: an omitted key keeps counting exactly, and repeated folds add once per event.
  const resumed = foldTelemetryCounters(rows.slice(0, MAX_SKILL_KEYS + 1), folded);
  assert.equal(resumed.otherInvocations, 4);
  assert.equal(Object.keys(resumed.skillInvocations).length, MAX_SKILL_KEYS);

  const bogus = foldTelemetryCounters([
    envelope({ source: "pi-input", metric: "skill.invocation", dimensions: { skill: "/etc/passwd" } }),
    envelope({ source: "pi-input", metric: "skill.invocation", dimensions: { skill: "" } }),
  ]);
  assert.deepEqual(bogus.skillInvocations, {});
  assert.equal(bogus.otherInvocations, 0);
});

test("records durable permission presence without inventing counters", () => {
  const folded = foldTelemetryCounters([
    envelope({ metric: "permission.ready", dimensions: undefined }),
    envelope({ dimensions: { result: "allow", resolution: "policy_allow" } }),
  ]);

  assert.equal(folded.presence.permission, true);
  assert.deepEqual(folded.counters.permission, { decisions: 1, allowed: 1 });

  const merged = mergeFoldedCounters(undefined, folded);
  assert.equal(merged.presence.permission, true);
  assert.deepEqual(merged.counters.permission, { decisions: 1, allowed: 1 });
});

test("merges checkpoint and delta buckets by integer addition", () => {
  const checkpoint = foldTelemetryCounters([
    envelope({ dimensions: { result: "allow", resolution: "policy_allow" } }),
    envelope({ source: "pi-input", metric: "skill.invocation", dimensions: { skill: "council-mode" } }),
  ]);
  const delta = foldTelemetryCounters([
    envelope({ dimensions: { result: "deny", resolution: "user_denied" } }),
    envelope({ source: "pi-input", metric: "skill.invocation", dimensions: { skill: "council-mode" } }),
  ]);

  const effective = mergeFoldedCounters(checkpoint, delta);
  assert.deepEqual(effective.counters.permission, { decisions: 2, allowed: 1, denied: 1 });
  assert.deepEqual(effective.skillInvocations, { "council-mode": 2 });

  // Idempotence guard: merging the same delta twice is a caller error the tests pin by asserting
  // the caller always merges against the persisted checkpoint exactly once (see Task 5 tests).
  assert.deepEqual(mergeFoldedCounters(checkpoint, emptyFoldedCounters()), checkpoint);
});
```

`tests/unit/live-counters.test.ts` (uses the fixture `tests/fixtures/integrations/permission-events.json`, a sanitized array of `{channel, data}` rows derived from the pinned `permissions:decision|ui_prompt|ready` payload types, each including `value`/`matchedPattern`/`agentName` sentinels that must never reach the writer):

```ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { registerLiveCounters } from "../../src/integrations/live-counters.ts";

test("translates public permission bus events into bounded envelopes only", async () => {
  const rows = JSON.parse(
    await readFile(
      new URL("../fixtures/integrations/permission-events.json", import.meta.url),
      "utf8",
    ),
  ) as Array<{ channel: string; data: unknown }>;
  const handlers = new Map<string, (data: unknown) => void>();
  const envelopes: unknown[] = [];
  const inputHandlers: Array<(event: { text: string }) => void> = [];

  registerLiveCounters(
    {
      events: { on: (channel, handler) => (handlers.set(channel, handler), () => {}) },
      on: (event, handler) => inputHandlers.push(handler),
    },
    { appendTelemetry: (envelope) => envelopes.push(envelope), flush: async () => {} },
    { inventoryNames: () => new Set(["council-mode", "hf-cli"]), now: () => new Date("2026-09-11T10:00:00Z") },
  );

  for (const row of rows) handlers.get(row.channel)?.(row.data);

  const serialized = JSON.stringify(envelopes);
  assert.equal(serialized.includes("sentinel"), false);
  assert.equal(serialized.includes("/etc/"), false);
  assert.deepEqual(
    envelopes
      .filter((envelope) => (envelope as { metric: string }).metric === "permission.decision")
      .map((envelope) => (envelope as { dimensions: Record<string, string> }).dimensions),
    [
      { result: "allow", resolution: "policy_allow" },
      { result: "deny", resolution: "user_denied" },
    ],
  );

  inputHandlers[0]?.({ text: "/skill:council-mode --scope tree" });
  inputHandlers[0]?.({ text: "/skill:unknown-mode secret prompt text" });
  inputHandlers[0]?.({ text: "ordinary prompt text" });

  assert.deepEqual(
    envelopes.filter((envelope) => (envelope as { metric: string }).metric === "skill.invocation"),
    [
      {
        schemaVersion: 1,
        source: "pi-input",
        metric: "skill.invocation",
        kind: "counter",
        value: 1,
        dimensions: { skill: "council-mode" },
        timestamp: Date.parse("2026-09-11T10:00:00Z"),
      },
    ],
  );
  assert.equal(JSON.stringify(envelopes).includes("secret prompt text"), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/unit/live-counter-fold.test.ts tests/unit/live-counters.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement minimal code**

`src/core/live-counter-fold.ts`:

```ts
import type { IntegrationKey } from "./events.ts";

export const MAX_SKILL_KEYS = 64;
export const MAX_COUNTER_KEYS = 16;
const SKILL_NAME = /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/;
const SKILL_SOURCE = "pi-input";
export type FoldedCounters = {
  counters: Partial<Record<IntegrationKey, Record<string, number>>>;
  skillInvocations: Record<string, number>;
  otherInvocations: number;
  presence: { permission: boolean };
};

export function emptyFoldedCounters(): FoldedCounters {
  return {
    counters: {},
    skillInvocations: {},
    otherInvocations: 0,
    presence: { permission: false },
  };
}

/** Adds two counter buckets; presence is a logical OR, every count is an integer sum. */
export function mergeFoldedCounters(
  base: FoldedCounters | undefined,
  delta: FoldedCounters,
): FoldedCounters {
  const merged = base === undefined ? emptyFoldedCounters() : cloneFoldedCounters(base);
  merged.otherInvocations += delta.otherInvocations;
  merged.presence = { permission: merged.presence.permission || delta.presence.permission };
  for (const [name, count] of Object.entries(delta.skillInvocations)) {
    merged.skillInvocations[name] = (merged.skillInvocations[name] ?? 0) + count;
  }
  for (const [integration, counters] of Object.entries(delta.counters) as Array<
    [IntegrationKey, Record<string, number>]
  >) {
    const target = (merged.counters[integration] ??= {});
    for (const [key, count] of Object.entries(counters)) {
      target[key] = (target[key] ?? 0) + count;
    }
  }
  return merged;
}

/**
 * Folds only telemetry strictly after each writer's checkpoint cursor, so a
 * caller that replays records from a checkpoint can never re-add folded facts.
 */
export function counterDeltaAfterCursors(
  records: readonly {
    writerId: string;
    writerSequence: number;
    telemetry?: Record<string, unknown>;
  }[],
  cursors: Readonly<Record<string, number>>,
): FoldedCounters {
  return foldTelemetryCounters(
    records.flatMap((record) => {
      const cursor = cursors[record.writerId];
      const afterCursor = cursor === undefined || record.writerSequence > cursor;
      return afterCursor && record.telemetry !== undefined ? [record.telemetry] : [];
    }),
  );
}

export function foldTelemetryCounters(
  envelopes: readonly unknown[],
  initial: FoldedCounters = emptyFoldedCounters(),
): FoldedCounters {
  const folded = cloneFoldedCounters(initial);
  for (const envelope of envelopes) addEnvelope(folded, envelope);
  return folded;
}

function cloneFoldedCounters(source: FoldedCounters): FoldedCounters {
  return {
    counters: Object.fromEntries(
      Object.entries(source.counters).map(([key, value]) => [key, { ...(value ?? {}) }]),
    ) as FoldedCounters["counters"],
    skillInvocations: { ...source.skillInvocations },
    otherInvocations: source.otherInvocations,
    presence: { permission: source.presence.permission },
  };
}

function addEnvelope(folded: FoldedCounters, input: unknown): void {
  if (!isRecord(input) || input.kind !== "counter" || input.value !== 1) return;
  const metric = input.metric;
  const dimensions = isRecord(input.dimensions) ? input.dimensions : undefined;
  if (metric === "permission.decision") {
    const result = dimensions?.result;
    const resolution = dimensions?.resolution;
    if (result !== "allow" && result !== "deny") return;
    if (typeof resolution !== "string") return;
    bump(folded, "permission", "decisions");
    bump(folded, "permission", result === "allow" ? "allowed" : "denied");
    if (resolution === "gate_error") bump(folded, "permission", "gateErrors");
    return;
  }
  if (metric === "permission.prompt") {
    const source = dimensions?.promptSource;
    if (source !== "tool_call" && source !== "skill_input" && source !== "skill_read") return;
    bump(folded, "permission", "prompts");
    bump(folded, "permission", `prompt${source === "tool_call" ? "ToolCall" : source === "skill_input" ? "SkillInput" : "SkillRead"}`);
    return;
  }
  if (metric === "permission.ready") {
    // Presence only: durable boolean, never an activity counter.
    folded.presence.permission = true;
    return;
  }
  if (input.source === SKILL_SOURCE && metric === "skill.invocation") {
    const skill = dimensions?.skill;
    if (typeof skill !== "string" || !SKILL_NAME.test(skill)) return;
    if (folded.skillInvocations[skill] !== undefined) {
      folded.skillInvocations[skill] = folded.skillInvocations[skill] + 1;
      return;
    }
    if (Object.keys(folded.skillInvocations).length >= MAX_SKILL_KEYS) {
      // The key is not tracked, but the invocation is still counted exactly.
      folded.otherInvocations += 1;
      return;
    }
    folded.skillInvocations[skill] = 1;
  }
}

function bump(folded: FoldedCounters, integration: IntegrationKey, key: string): void {
  const counters = (folded.counters[integration] ??= {});
  if (counters[key] === undefined && Object.keys(counters).length >= MAX_COUNTER_KEYS) return;
  counters[key] = (counters[key] ?? 0) + 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
```

`src/integrations/live-counters.ts`:

```ts
const SKILL_PREFIX = "/skill:";

/** Extracts only a bounded skill identity; the remainder is never retained. */
export function readSkillCommandName(text: string): string | undefined {
  if (!text.startsWith(SKILL_PREFIX)) return undefined;
  const rest = text.slice(SKILL_PREFIX.length);
  const end = rest.search(/\s/);
  const name = end === -1 ? rest : rest.slice(0, end);
  return /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/.test(name) ? name : undefined;
}

export type LiveCounterWriter = {
  appendTelemetry(envelope: unknown): void;
  flush(): Promise<void>;
};

export type LiveCounterApi = {
  events: { on(channel: string, handler: (data: unknown) => void): () => void };
  on(event: "input", handler: (event: { text: string }, ctx: unknown) => void): void;
};

export function registerLiveCounters(
  api: LiveCounterApi,
  writer: LiveCounterWriter,
  options: { inventoryNames(): ReadonlySet<string>; now(): Date },
): void {
  const append = (envelope: unknown): void => {
    try {
      writer.appendTelemetry(envelope);
    } catch {
      // Producer failures are observer-only.
    }
  };
  const decision = (data: unknown): void => {
    try {
      const row = asRecord(data);
      const result = row?.result;
      if (result !== "allow" && result !== "deny") return;
      append({
        schemaVersion: 1,
        source: "permission-system",
        metric: "permission.decision",
        kind: "counter",
        value: 1,
        dimensions: { result, resolution: String(row?.resolution ?? "") },
        timestamp: options.now().getTime(),
      });
    } catch {}
  };
  const prompt = (data: unknown): void => {
    try {
      const source = asRecord(data)?.source;
      if (source !== "tool_call" && source !== "skill_input" && source !== "skill_read") return;
      append({
        schemaVersion: 1,
        source: "permission-system",
        metric: "permission.prompt",
        kind: "counter",
        value: 1,
        dimensions: { promptSource: source },
        timestamp: options.now().getTime(),
      });
    } catch {}
  };
  const ready = (): void => {
    try {
      append({
        schemaVersion: 1,
        source: "permission-system",
        metric: "permission.ready",
        kind: "counter",
        value: 1,
        timestamp: options.now().getTime(),
      });
    } catch {}
  };
  try {
    api.events.on("permissions:ready", ready);
    api.events.on("permissions:ui_prompt", prompt);
    api.events.on("permissions:decision", decision);
  } catch {}
  try {
    api.on("input", (event) => {
      try {
        const name = readSkillCommandName(typeof event?.text === "string" ? event.text : "");
        if (name === undefined || !options.inventoryNames().has(name)) return;
        append({
          schemaVersion: 1,
          source: "pi-input",
          metric: "skill.invocation",
          kind: "counter",
          value: 1,
          dimensions: { skill: name },
          timestamp: options.now().getTime(),
        });
      } catch {
        // Input observation must never affect Pi execution.
      }
    });
  } catch {}
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}
```

Add `permission.ready` to the fold table as a **durable presence** signal: it sets `presence.permission = true` and must never create or bump a counter key. Assert exactly that in the fold test (presence true, counters untouched by the ready event).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test tests/unit/live-counter-fold.test.ts tests/unit/live-counters.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/live-counter-fold.ts src/integrations/live-counters.ts tests/fixtures/integrations/permission-events.json tests/unit/live-counter-fold.test.ts tests/unit/live-counters.test.ts
git commit -m "feat: emit bounded live integration counters from public producer events"
```

---

### Task 4: Fold WAL telemetry counters during recovery

**Files:**

- Modify: `src/storage/recovery.ts`
- Modify: `tests/unit/recovery.test.ts`

**Interfaces:**

- Produces: `RecoveryResult.deltaCounters: FoldedCounters` (Task 3 type) — **only the telemetry strictly after each writer's checkpoint WAL cursor**, never the whole replay. `RecoveryResult.cursors` is unchanged and is the cursor the delta is measured against.
- Consumes: `counterDeltaAfterCursors`, `parseWalRecord`, `validateTelemetry`.
- Semantics fixed here (defect fix): a checkpoint already folded everything at or below its cursors. `deltaCounters` must therefore be the post-cursor bucket; recovery may physically re-read a segment, but folding is cursor-filtered so re-reading can never re-add a folded fact.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/recovery.test.ts`:

```ts
test("folds validated telemetry counters from every writer shard", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-recovery-"));
  const wal = join(directory, "wal", "writer-a");
  await mkdir(wal, { recursive: true });
  const lines = [
    { eventId: "e1", timestamp: "2026-09-11T10:00:00Z", writerId: "writer-a", writerSequence: 1, kind: "telemetry", telemetry: permissionEnvelope("policy_allow", "allow") },
    { eventId: "e2", timestamp: "2026-09-11T10:00:01Z", writerId: "writer-a", writerSequence: 2, kind: "telemetry", telemetry: permissionEnvelope("user_denied", "deny") },
    { eventId: "e3", timestamp: "2026-09-11T10:00:02Z", writerId: "writer-a", writerSequence: 3, kind: "telemetry", telemetry: { schemaVersion: 1, source: "pi-input", metric: "skill.invocation", kind: "counter", value: 1, dimensions: { skill: "council-mode" } } },
    { eventId: "e4", timestamp: "2026-09-11T10:00:03Z", writerId: "writer-a", writerSequence: 4, kind: "telemetry", telemetry: { schemaVersion: 1, source: "pi-input", metric: "skill.invocation", kind: "counter", value: 1, dimensions: { skill: "../escape" } } },
  ];
  await writeFile(join(wal, "2026-09-11.jsonl"), `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

  const recovered = await recoverSession({
    directory,
    piCursor: { lineCount: 1, revision: "a" },
  });

  assert.equal(recovered.availability, "available");
  assert.deepEqual(recovered.deltaCounters.counters.permission, {
    decisions: 2,
    allowed: 1,
    denied: 1,
  });
  assert.deepEqual(recovered.deltaCounters.skillInvocations, { "council-mode": 1 });
});

test("folds only telemetry strictly after the checkpoint cursors", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-recovery-delta-"));
  const wal = join(directory, "wal", "writer-a");
  await mkdir(wal, { recursive: true });
  const lines = [
    { eventId: "e1", timestamp: "2026-09-11T10:00:00Z", writerId: "writer-a", writerSequence: 1, kind: "telemetry", telemetry: permissionEnvelope("policy_allow", "allow") },
    { eventId: "e2", timestamp: "2026-09-11T10:00:01Z", writerId: "writer-a", writerSequence: 2, kind: "telemetry", telemetry: permissionEnvelope("policy_allow", "allow") },
    { eventId: "e3", timestamp: "2026-09-11T10:00:02Z", writerId: "writer-a", writerSequence: 3, kind: "telemetry", telemetry: permissionEnvelope("user_denied", "deny") },
  ];
  await writeFile(join(wal, "2026-09-11.jsonl"), `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  await writeCheckpointFixture(directory, { "writer-a": 2 });

  const recovered = await recoverSession({
    directory,
    piCursor: { lineCount: 1, revision: "a" },
  });

  // Records 1 and 2 are already folded into the checkpoint; only record 3 is delta.
  assert.deepEqual(recovered.deltaCounters.counters.permission, { decisions: 1, denied: 1 });
  assert.equal(recovered.deltaCounters.counters.permission?.allowed, undefined);
  assert.deepEqual(recovered.cursors, { "writer-a": 3 });
});
```

with a local helper:

```ts
const permissionEnvelope = (resolution: string, result: "allow" | "deny") => ({
  schemaVersion: 1,
  source: "permission-system",
  metric: "permission.decision",
  kind: "counter",
  value: 1,
  dimensions: { result, resolution },
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/recovery.test.ts`
Expected: FAIL — `recovered.deltaCounters` is `undefined`.

- [ ] **Step 3: Implement minimal code**

Extend the internal `WalRecord` type with `telemetry?: Record<string, unknown>`, keep `parseWalRecord` populating it (it already validates through `validateTelemetry`), then in `recoverSession`:

```ts
const deltaCounters = counterDeltaAfterCursors(
  records.map((record) => ({
    writerId: record.writerId,
    writerSequence: record.writerSequence,
    ...(record.kind === "telemetry" && record.telemetry !== undefined ? { telemetry: record.telemetry } : {}),
  })),
  cursors,
);
return { availability, aggregates, cursors, running, diagnostics, deltaCounters };
```

`cursors` here means the **pre-delta** cursors seeded from the checkpoint, not the advanced `recovered.cursors`; take the checkpoint cursors from the checkpoint read at the start of recovery (or from the same seeded map the reader used).

Return `deltaCounters: emptyFoldedCounters()` whenever recovery is unavailable, so callers never see `undefined` and a caller can always compute `effective = merge(checkpointAggregates, deltaCounters)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/recovery.test.ts tests/unit/wal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/storage/recovery.ts tests/unit/recovery.test.ts
git commit -m "feat: fold validated WAL telemetry counters during recovery"
```

---

### Task 5: Checkpoint aggregate fields and maintenance write

**Files:**

- Modify: `src/storage/checkpoint.ts`
- Modify: `src/storage/maintenance.ts`
- Modify: `tests/unit/checkpoint.test.ts`, `tests/unit/maintenance.test.ts`
- Create: `tests/fixtures/checkpoints/legacy-v1.json`, `tests/fixtures/checkpoints/folded-v1.json`

**Interfaces:**

- Produces: `Checkpoint["aggregates"]` gains `integrationCounters?: Record<string, Record<string, number>>`, `skillInvocations?: Record<string, number>`, `skillOverflowInvocations?: number`, `presence?: { permission?: boolean }`, `resourceCounts?: { commands: number; skills: number }`, all optional and strictly validated; `maintainSession` persists `mergeFoldedCounters(existingAggregates, recovered.deltaCounters)` exactly once per maintenance pass.
- Consumes: `RecoveryResult.deltaCounters` (Task 4), `mergeFoldedCounters` (Task 3).
- Semantics fixed here (defect fix): checkpoint aggregates mean **already folded**. Maintenance adds only the post-cursor delta, so a second pass with no new telemetry writes identical aggregates and reports reading the checkpoint afterwards never double-count.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/checkpoint.test.ts`:

```ts
test("accepts validated folded aggregates and rejects unsafe ones", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-checkpoint-"));
  const lease = await acquireLease(directory);

  const written = await writeCheckpoint({
    directory,
    lease,
    checkpoint: {
      schemaVersion: 1,
      cursors: { pi: { lineCount: 1, revision: "a" }, wal: { "writer-a": 2 } },
      aggregates: {
        totalTokens: 1, totalCost: 0, generations: 1, tools: 0, compactions: 0,
        integrationCounters: { permission: { decisions: 2, allowed: 1, denied: 1 } },
        skillInvocations: { "council-mode": 3 },
        skillOverflowInvocations: 4,
        presence: { permission: true },
        resourceCounts: { commands: 12, skills: 4 },
      },
    },
  });
  assert.equal(written, true);

  const read = await readCheckpoint({ directory });
  assert.deepEqual(read?.aggregates.skillInvocations, { "council-mode": 3 });
  assert.equal(read?.aggregates.skillOverflowInvocations, 4);
  assert.equal(read?.aggregates.presence?.permission, true);
  assert.deepEqual(read?.aggregates.resourceCounts, { commands: 12, skills: 4 });

  for (const bad of [
    { skillInvocations: { "../escape": 1 } },
    { skillInvocations: { ok: -1 } },
    { skillInvocations: { ok: 1.5 } },
    { skillInvocations: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`s${i}`, 1])) },
    { skillOverflowInvocations: -1 },
    { skillOverflowInvocations: 1.5 },
    { presence: { permission: "yes" } },
    { presence: { context: true } },
    { resourceCounts: { commands: 1 } },
    { integrationCounters: { permission: { decisions: "2" } } },
  ]) {
    const candidate = {
      schemaVersion: 1,
      cursors: { pi: { lineCount: 1, revision: "a" }, wal: {} },
      aggregates: { totalTokens: 0, totalCost: 0, generations: 0, tools: 0, compactions: 0, ...bad },
    };
    const isolated = await mkdtemp(join(tmpdir(), "inspector-checkpoint-bad-"));
    const isolatedLease = await acquireLease(isolated);
    try {
      assert.equal(
        await writeCheckpoint({ directory: isolated, lease: isolatedLease, checkpoint: candidate }),
        false,
      );
    } finally {
      await isolatedLease.release();
      await rm(isolated, { force: true, recursive: true });
    }
  }
});
```

Append to `tests/unit/maintenance.test.ts`:

```ts
test("folds recovered telemetry into checkpoint aggregates exactly once across repeated passes", async () => {
  const { maintainSession } = await import("../../src/storage/maintenance.ts");
  // Arrange: session file with tracking marker + telemetry WAL lines in writer-a
  // (reuse the existing maintenance fixture helpers in this file):
  //   sequence 1 = permission allow, sequence 2 = skill invocation "council-mode",
  //   sequence 3 = permission.ready (presence only).
  const first = await maintainSession({ root, sessionId, sessionFile, writerId: "m1", now: () => new Date() });
  assert.equal(first.status, "available");
  const afterFirst = await readCheckpoint({ directory });
  assert.deepEqual(afterFirst?.aggregates.integrationCounters?.permission, { decisions: 1, allowed: 1 });
  assert.deepEqual(afterFirst?.aggregates.skillInvocations, { "council-mode": 1 });
  assert.equal(afterFirst?.aggregates.presence?.permission, true);

  // Second and third passes see the same WAL but the cursors already cover it: nothing is re-added.
  await maintainSession({ root, sessionId, sessionFile, writerId: "m2", now: () => new Date() });
  await maintainSession({ root, sessionId, sessionFile, writerId: "m3", now: () => new Date() });
  const afterThird = await readCheckpoint({ directory });
  assert.deepEqual(afterThird?.aggregates.integrationCounters?.permission, { decisions: 1, allowed: 1 });
  assert.deepEqual(afterThird?.aggregates.skillInvocations, { "council-mode": 1 });
  assert.equal(afterThird?.aggregates.skillOverflowInvocations, undefined);

  // A genuinely new post-cursor event is folded exactly once.
  await appendTelemetry(writerA, permissionEnvelope("user_denied", "deny"));
  await maintainSession({ root, sessionId, sessionFile, writerId: "m4", now: () => new Date() });
  const afterNew = await readCheckpoint({ directory });
  assert.deepEqual(afterNew?.aggregates.integrationCounters?.permission, { decisions: 2, allowed: 1, denied: 1 });
});

test("reports read effective counters without mutating the checkpoint", async () => {
  // Arrange the same session, then read the current report twice through the production
  // loader with the checkpoint present.
  const before = await readCheckpoint({ directory });
  const first = await loadCurrentSessionReport(sessionFile, "active", null, observation, root);
  const second = await loadCurrentSessionReport(sessionFile, "active", null, observation, root);

  assert.deepEqual(first?.report.integrations.find((row) => row.integration === "permission")?.counters, {
    decisions: 1,
    allowed: 1,
  });
  assert.deepEqual(second?.report.integrations.find((row) => row.integration === "permission")?.counters, {
    decisions: 1,
    allowed: 1,
  });
  assert.deepEqual(await readCheckpoint({ directory }), before);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/unit/checkpoint.test.ts tests/unit/maintenance.test.ts`
Expected: FAIL — new aggregate fields are dropped by `parseCheckpoint`.

- [ ] **Step 3: Implement minimal code**

In `src/storage/checkpoint.ts`, extend the `Checkpoint` type and `parseCheckpoint`, and add parsers (`presence` accepts only the allowlisted boolean key `permission`; `skillOverflowInvocations` is a safe non-negative integer):

```ts
const SKILL_NAME = /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/;
const MAX_SKILL_KEYS = 64;
const MAX_COUNTER_KEYS = 16;
const MAX_COUNT = 1_000_000_000;

function parseIntCounterMap(value: unknown): Record<string, number> | undefined {
  if (!isPlainRecord(value)) return undefined;
  const rows = Object.entries(value);
  if (rows.length > MAX_COUNTER_KEYS) return undefined;
  const parsed: Record<string, number> = {};
  for (const [key, count] of rows) {
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 || count > MAX_COUNT) return undefined;
    if (!TOKEN.test(key)) return undefined;
    parsed[key] = count;
  }
  return parsed;
}

function parseSkillInvocations(value: unknown): Record<string, number> | undefined {
  if (!isPlainRecord(value)) return undefined;
  const rows = Object.entries(value);
  if (rows.length > MAX_SKILL_KEYS) return undefined;
  const parsed: Record<string, number> = {};
  for (const [name, count] of rows) {
    if (!SKILL_NAME.test(name)) return undefined;
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 || count > MAX_COUNT) return undefined;
    parsed[name] = count;
  }
  return parsed;
}

function parseResourceCounts(value: unknown): { commands: number; skills: number } | undefined {
  if (!isPlainRecord(value) || !hasRequiredKeys(value, ["commands", "skills"])) return undefined;
  if (!isSafeCount(value.commands, MAX_COUNT) || !isSafeCount(value.skills, MAX_COUNT)) return undefined;
  return { commands: value.commands, skills: value.skills };
}
```

Wire them into `parseCheckpoint` (each absent → omitted, present-but-invalid → return `undefined` for the whole checkpoint) and into the returned `aggregates` object.

In `src/storage/maintenance.ts`, after `recoverSession`, persist the post-cursor delta exactly once:

```ts
const merged = mergeFoldedCounters(
  foldedFromCheckpointAggregates(existing?.aggregates),
  recovered.deltaCounters,
);
if (existing?.aggregates.resourceCounts !== undefined && merged.resourceCounts === undefined) {
  merged.resourceCounts = { ...existing.aggregates.resourceCounts };
}
```

`mergeFoldedCounters` is the Task 3 helper (integer sums for `counters`/`skillInvocations`/`otherInvocations`, logical OR for `presence`). `foldedFromCheckpointAggregates` reconstructs the already-folded bucket from the checkpoint, so a second pass with no new telemetry produces byte-identical aggregates. `resourceCounts` is owned by inventory maintenance (Task 8) and is carried over unchanged. Serialize only the non-empty maps/fields into the `checkpoint.aggregates` object passed to `writeCheckpoint` (empty → field omitted, never `{}`/`0` filler).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test tests/unit/checkpoint.test.ts tests/unit/maintenance.test.ts tests/unit/retention.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/storage/checkpoint.ts src/storage/maintenance.ts tests/unit/checkpoint.test.ts tests/unit/maintenance.test.ts tests/fixtures/checkpoints
git commit -m "feat: persist folded live counters as validated checkpoint aggregates"
```

---

### Task 6: Wire live counters into the session WAL and the current report

**Files:**

- Create: `src/ui/observation.ts`
- Modify: `src/pi/session-wal.ts`
- Modify: `src/index.ts` (writer handle, flush-before-read, observation construction)
- Modify: `src/ui/load-current.ts`
- Modify: `src/core/reports.ts` (`SessionReportEvidence` gains presence/counters/inventory; subagent evidence is derived by the loader)
- Modify: `tests/unit/session-wal.test.ts`, `tests/unit/index-current-ui.test.ts`, `tests/unit/reports-inventory.test.ts`

**Interfaces:**

- Produces: `SessionWalDependencies.registerLiveCounters?: (api, writer, context) => void`; `SessionObservation` type; `loadCurrentSessionReport(sessionFile, scope, leafId, observation: SessionObservation | undefined, inspectorRoot?)`; extension-level `flushLiveEvidence()` used by the command handler. The current loader now **derives subagent evidence itself** (`readSubagentEvidenceWithArchives(entries)`, Task 11), so the injected observation covers only inventory, presence, and counters.
- Consumes: `registerLiveCounters` (Task 3), `recoverSession().deltaCounters` + checkpoint aggregates (Tasks 4–5), `readIntegrationPresence` (Task 2), `readSubagentEvidenceWithArchives` (Task 11).
- Semantics fixed here (defect fix): the observation's counters are the **effective** bucket, `merge(checkpointAggregates, deltaCounters)`. The command path must never add delta to a checkpoint it has already merged and persisted.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/session-wal.test.ts`:

```ts
test("registers live counter producers with the session writer and never throws", async () => {
  const registered: string[] = [];
  await setupSessionWal(
    { root: "/root", sessionId: "session-a", sessionFile: "/src.jsonl", api: {} },
    {
      createWriter: async () => ({ appendTelemetry: () => {}, flush: async () => {} }),
      registerLive: () => registered.push("timing"),
      registerLiveCounters: (_api, _writer, context) => {
        registered.push(`counters:${context.sessionId}`);
      },
      scheduleMaintenance: () => {},
    },
  );
  assert.deepEqual(registered, ["timing", "counters:session-a"]);
});
```

Append to `tests/unit/index-current-ui.test.ts`:

```ts
test("current report shows presence rows and effective counters from the observation", async () => {
  // Arrange a session file + Inspector root whose checkpoint already folded one permission
  // decision, with one more decision still in un-checkpointed WAL (delta). Reuse helpers in this file.
  const observation = {
    presence: { context: "unknown", rtk: "unknown", ponytail: "present", caveman: "absent", permission: "present", subagents: "present", lens: "unknown" },
    counters: mergeFoldedCounters(
      foldedFromCheckpointAggregates({ integrationCounters: { permission: { decisions: 1, allowed: 1 } }, presence: { permission: true } }),
      foldTelemetryCounters([{ schemaVersion: 1, source: "permission-system", metric: "permission.decision", kind: "counter", value: 1, dimensions: { result: "deny", resolution: "user_denied" } }]),
    ),
  } as const;
  const model = await loadCurrentSessionReport(sessionFile, "active", leafId, observation, root);

  const permission = model?.report.integrations.find((row) => row.integration === "permission");
  assert.equal(permission?.state, "supported");
  assert.equal(permission?.presence, "present");
  assert.deepEqual(permission?.counters, { decisions: 2, allowed: 1, denied: 1 });
  assert.equal(model?.report.integrations.find((row) => row.integration === "caveman")?.presence, "absent");
  assert.equal(model?.report.integrations.find((row) => row.integration === "caveman")?.state, "unavailable");

  // Reading again with the same effective observation does not add the delta a second time,
  // and the checkpoint on disk is untouched by report reads.
  const before = await readCheckpoint({ directory: join(root, "sessions", "session-a") });
  const again = await loadCurrentSessionReport(sessionFile, "active", leafId, observation, root);
  assert.deepEqual(again?.report.integrations.find((row) => row.integration === "permission")?.counters, {
    decisions: 2,
    allowed: 1,
    denied: 1,
  });
  assert.deepEqual(await readCheckpoint({ directory: join(root, "sessions", "session-a") }), before);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/unit/session-wal.test.ts tests/unit/index-current-ui.test.ts`
Expected: FAIL — unknown dependency key / signature mismatch.

- [ ] **Step 3: Implement minimal code**

`src/ui/observation.ts`:

```ts
import type { IntegrationKey, IntegrationPresence } from "../core/events.ts";
import type { FoldedCounters } from "../core/live-counter-fold.ts";
import type { InventorySnapshot } from "../integrations/inventory.ts";
import type { SubagentEvidence } from "../integrations/subagents.ts";

export type SessionObservation = {
  inventory?: InventorySnapshot;
  presence: Readonly<Record<IntegrationKey, IntegrationPresence>>;
  counters?: FoldedCounters;
};

export function emptyObservation(): SessionObservation {
  return {
    presence: {
      context: "unknown",
      rtk: "unknown",
      ponytail: "unknown",
      caveman: "unknown",
      permission: "unknown",
      subagents: "unknown",
      lens: "unknown",
    },
  };
}
```

`src/pi/session-wal.ts`: add to `SessionWalDependencies`:

```ts
registerLiveCounters?(api: unknown, writer: unknown, context: { sessionId: string; inventoryNames(): ReadonlySet<string> }): void;
```

call it inside `setupSessionWal` after `registerLive`, wrapped in try/catch, passing `{ sessionId, inventoryNames: () => inventoryNames }` where `inventoryNames` comes from a new optional `readInventoryNames` dependency (Task 8 supplies it; until then default to `() => new Set<string>()`).

`src/core/reports.ts`: extend `SessionReportEvidence` with `presence?`, `counters?`, `inventory?` (no `subagents`; the loader derives it and passes it through the same projection path); `projectEvidence` composes:

- one `IntegrationObservation` row per `IntegrationKey` in fixed order, merging adapter rows (Task 1/2) with `presence` and folded `counters`;
- `presence` defaults to the adapter row's presence, else `"unknown"`;
- a row is `supported` only when it has counters or a supported adapter state; otherwise `unavailable`.

`src/ui/load-current.ts`: change the last parameter to `observation: SessionObservation | undefined`, derive subagent evidence from the entries, and build evidence:

```ts
const subagents = await readSubagentEvidenceWithArchives(entries);
toSessionReport(reduceEntries(session.id, entries), {
  ...(sealed ? { walDetail: "expired" as const } : {}),
  presence: observation?.presence,
  counters: observation?.counters,
  inventory: observation?.inventory,
  subagents,
  integrations: readPiEntryEvidence(entries),
});
```

`readSubagentEvidenceWithArchives` is the Task 11 production consumer: archive validation runs on every current-session report, and a missing/expired/unsafe archive yields `artifacts: "missing"` rather than blocking the report.

`src/index.ts`: keep the live writer in a module-level `liveWriter` reference, and expose

```ts
export async function flushLiveEvidence(): Promise<void> {
  try {
    await liveWriter?.flush();
  } catch {
    // Flush failures must not affect reports or Pi.
  }
}
```

and call it at the start of every command handler branch that reads reports.

Observation construction (the only place counters and presence are assembled):

```ts
await flushLiveEvidence();
const checkpoint = await readCheckpoint({ directory });
const folded = foldedFromCheckpointAggregates(checkpoint?.aggregates);
const recovered = await recoverSession({ directory, piCursor });
const counters = mergeFoldedCounters(folded, recovered.deltaCounters);
const presence = readIntegrationPresence({
  commands: inventory.commands.map((row) => row.name),
  tools: Object.keys(inventory.toolSources),
  // Durable presence: the bus may have been observed in a previous process of this session.
  permissionsReady: liveReady || counters.presence.permission,
  inventoryAvailable: true,
});
```

Rules: report reads never write a checkpoint, and `mergeFoldedCounters(folded, delta)` is the only combination used for rendering — so repeated reads show identical numbers.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test tests/unit/session-wal.test.ts tests/unit/index-current-ui.test.ts tests/unit/reports-integrations.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/observation.ts src/pi/session-wal.ts src/index.ts src/ui/load-current.ts src/core/reports.ts tests/unit/session-wal.test.ts tests/unit/index-current-ui.test.ts
git commit -m "feat: fold live permission and skill counters into current reports"
```

---

### Task 7: Inventory sanitizer (commands, skills, resource sources, tool attribution)

**Files:**

- Create: `src/integrations/inventory.ts`
- Create: `tests/fixtures/integrations/commands-inventory.json`, `tests/fixtures/integrations/tools-inventory.json`
- Create: `tests/unit/inventory.test.ts`

**Interfaces:**

- Produces: `readInventory(commands, tools): InventorySnapshot`, `sanitizeSourceLabel(value): string`, `inventoryHash(snapshot): string`, plus `CommandRow`, `SkillRow`, `ResourceSourceRow`, `InventorySnapshot`.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing test**

`tests/unit/inventory.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { readInventory, sanitizeSourceLabel } from "../../src/integrations/inventory.ts";

const fixture = (name: string) =>
  readFile(new URL(`../fixtures/integrations/${name}`, import.meta.url), "utf8");

test("normalizes producer source labels without leaking paths or URLs", () => {
  assert.equal(sanitizeSourceLabel("local"), "local");
  assert.equal(sanitizeSourceLabel("auto"), "auto");
  assert.equal(sanitizeSourceLabel("builtin"), "builtin");
  assert.equal(sanitizeSourceLabel("npm:@scope/pkg@1.2.3"), "npm:@scope/pkg");
  assert.equal(sanitizeSourceLabel("git+ssh://git@github.com/a/b.git"), "other");
  assert.equal(sanitizeSourceLabel("/home/dev/private-ext"), "other");
  assert.equal(sanitizeSourceLabel("C:\\Users\\dev\\ext"), "other");
  assert.equal(sanitizeSourceLabel("x".repeat(200)), "other");
});

test("sanitizes command, skill, tool, and resource-source inventory", async () => {
  const commands = JSON.parse(await fixture("commands-inventory.json"));
  const tools = JSON.parse(await fixture("tools-inventory.json"));

  const snapshot = readInventory(commands, tools);
  const serialized = JSON.stringify(snapshot);

  for (const leak of ["/home/", "C:\\", "file://", "secret", "PRIVATE", "promptGuidelines"]) {
    assert.equal(serialized.includes(leak), false, leak);
  }

  assert.deepEqual(
    snapshot.commands.map((row) => row.name),
    ["session-inspector", "council-mode", "web-search"],
  );
  assert.equal(
    snapshot.commands.find((row) => row.name === "web-search")?.source,
    "prompt",
  );
  assert.equal(
    snapshot.skills.map((row) => row.name).join(","),
    "council-mode,hf-cli",
  );
  assert.equal(snapshot.toolSources.subagent, "npm:pi-subagents");
  assert.equal(snapshot.toolSources.read, "builtin");
  assert.equal("read" in snapshot.toolSources, true);

  const subagents = snapshot.resources.find((row) => row.sourceLabel === "npm:pi-subagents");
  assert.deepEqual(subagents, {
    sourceLabel: "npm:pi-subagents",
    scope: "user",
    origin: "package",
    commands: 1,
    skills: 2,
    prompts: 1,
    tools: 3,
  });

  assert.deepEqual(readInventory(commands, tools), snapshot);
});
```

Fixtures: `commands-inventory.json` is a sanitized array shaped like `SlashCommandInfo` with `sourceInfo: { path, source, scope, origin, baseDir? }` (include `/home/dev/...`, `C:\...`, and `file://` paths plus a `secret`-looking description and an over-long description); `tools-inventory.json` is a sanitized array shaped like `ToolInfo` (include `promptGuidelines: ["PRIVATE GUIDELINE"]` and `parameters` that must never be read).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/inventory.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement minimal code**

`src/integrations/inventory.ts`:

```ts
const MAX_COMMANDS = 256;
const MAX_SKILLS = 128;
const MAX_RESOURCES = 64;
const MAX_NAME_BYTES = 64;
const MAX_DESCRIPTION_BYTES = 120;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const NPM = /^npm:((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)(?:@[^@\s]+)?$/;
const PASSTHROUGH = new Set(["local", "auto", "builtin", "sdk"]);

export function sanitizeSourceLabel(value: unknown): string {
  if (typeof value !== "string") return "other";
  if (PASSTHROUGH.has(value)) return value;
  const npm = NPM.exec(value);
  if (npm !== null && npm[1] !== undefined) return `npm:${npm[1]}`;
  return "other";
}

export function inventoryHash(snapshot: InventorySnapshot): string {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

export function readInventory(commands: readonly unknown[], tools: readonly unknown[]): InventorySnapshot {
  const commandRows = sanitizeCommands(commands);
  const toolRows = sanitizeTools(tools);
  return {
    schemaVersion: 1,
    commands: commandRows,
    skills: commandRows.filter((row) => row.source === "skill").map(toSkillRow).slice(0, MAX_SKILLS),
    resources: groupResources(commandRows, toolRows),
    toolSources: Object.fromEntries(toolRows.map((row) => [row.name, row.sourceLabel])),
  };
}
```

with:

- `sanitizeCommands`: bounded `name` (NAME, `skill:` prefix stripped for skills and rejected when empty), `source` restricted to `extension|prompt|skill`, `sourceLabel` from `sourceInfo.source`, `scope` restricted to `user|project|temporary` (else `temporary`), `origin` restricted to `package|top-level` (else `top-level`), description via `redactBoundedText` (Task 12 lands later; until then use a local `boundedDescription` that strips control characters, rejects `secretLikeValue`-style and path-like text, and truncates at 120 bytes — Task 12 replaces it);
- `sanitizeTools`: reads only `name` + `sourceInfo`, never `description`/`parameters`/`promptGuidelines`;
- `groupResources`: groups `(sourceLabel, scope, origin)` across commands/skills/prompts/tools, sorts by `(sourceLabel, scope, origin)`, caps at 64, and **drops any group whose `sourceLabel` would be `other` and which has zero entries** (never emit phantom rows).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/inventory.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/integrations/inventory.ts tests/fixtures/integrations/commands-inventory.json tests/fixtures/integrations/tools-inventory.json tests/unit/inventory.test.ts
git commit -m "feat: sanitize command, skill, tool, and resource-source inventory"
```

---

### Task 8: Persist the inventory snapshot, refresh it, and expire it

**Files:**

- Create: `src/storage/inventory-snapshot.ts`
- Modify: `src/storage/retention.ts`
- Modify: `src/storage/maintenance.ts` (write `resourceCounts`)
- Modify: `src/pi/session-start.ts`, `src/index.ts` (refresh triggers)
- Create: `tests/unit/inventory-snapshot.test.ts`
- Modify: `tests/unit/retention.test.ts`

**Interfaces:**

- Produces: `readInventorySnapshot(directory)`, `writeInventorySnapshot(directory, snapshot)`, `refreshInventorySnapshot({ directory, snapshot })` (hash compare + atomic write), and inventory-file deletion inside the maintenance pass. `maintainSession` gains an optional `inventory` input for `resourceCounts`.
- Consumes: `InventorySnapshot`, `inventoryHash` (Task 7).

- [ ] **Step 1: Write the failing test**

`tests/unit/inventory-snapshot.test.ts`:

```ts
test("writes, hash-compares, and validates the bounded inventory snapshot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-inventory-"));
  const snapshot = readInventory([{ name: "ponytail", source: "extension", sourceInfo: { path: "/home/dev/x", source: "npm:ponytail", scope: "user", origin: "package" } }], []);

  assert.equal(await readInventorySnapshot(directory), undefined);
  await refreshInventorySnapshot({ directory, snapshot });
  const first = await stat(join(directory, "inventory.json"));
  await refreshInventorySnapshot({ directory, snapshot });
  const second = await stat(join(directory, "inventory.json"));
  assert.equal(first.mtimeMs, second.mtimeMs, "unchanged snapshot must not rewrite");

  const read = await readInventorySnapshot(directory);
  assert.deepEqual(read, snapshot);

  await writeFile(join(directory, "inventory.json"), "{ not json");
  assert.equal(await readInventorySnapshot(directory), undefined);

  const oversize = { ...snapshot, commands: [] };
  await writeFile(join(directory, "inventory.json"), JSON.stringify({ ...oversize, padding: "x".repeat(70 * 1024) }));
  assert.equal(await readInventorySnapshot(directory), undefined);
});
```

Append to `tests/unit/retention.test.ts` a case asserting `inventory.json` older than the cutoff is deleted by the maintenance pass while a newer one is kept, and that `resourceCounts` in the checkpoint is written from the snapshot counts.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/inventory-snapshot.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement minimal code**

`src/storage/inventory-snapshot.ts`:

```ts
const FILE_NAME = "inventory.json";
const MAX_BYTES = 64 * 1024;

export async function readInventorySnapshot(directory: string): Promise<InventorySnapshot | undefined> {
  try {
    const path = join(directory, FILE_NAME);
    const text = await readFile(path, "utf8");
    if (Buffer.byteLength(text, "utf8") > MAX_BYTES) return undefined;
    return parseInventorySnapshot(JSON.parse(text));
  } catch {
    return undefined;
  }
}

export async function refreshInventorySnapshot(input: { directory: string; snapshot: InventorySnapshot }): Promise<void> {
  try {
    const existing = await readInventorySnapshot(input.directory);
    if (existing !== undefined && inventoryHash(existing) === inventoryHash(input.snapshot)) return;
    await writeInventorySnapshot(input.directory, input.snapshot);
  } catch {
    // Snapshot maintenance is observer-only.
  }
}
```

`parseInventorySnapshot` re-validates `schemaVersion === 1`, caps (`≤256` commands, `≤128` skills, `≤64` resources), re-runs `sanitizeSourceLabel` on every label, rejects non-grammar names, and drops unknown fields. `writeInventorySnapshot` writes to `inventory.json.tmp` with `mode: 0o600` then renames.

`src/storage/retention.ts`: in the maintenance cleanup path, unlink `inventory.json` when its `mtime` date is strictly before the cutoff (same `cutoffDate(now)` helper, same lease requirement, re-check size/mtime before unlink), returning the deletion in the existing count.

`src/storage/maintenance.ts`: accept optional `inventoryCounts?: { commands: number; skills: number }` and include `resourceCounts` in written aggregates when provided (preserving existing values otherwise).

`src/index.ts` + `src/pi/session-start.ts`: after tracking promotion, build the current snapshot from `pi.getCommands()` + `pi.getAllTools()`, call `refreshInventorySnapshot({ directory: join(root, "sessions", sessionId), snapshot })`, and keep the snapshot in memory for presence, `inventoryNames()` (for Task 3) and report injection. Also register `pi.on("resources_discover", ...)` and refresh when `event.reason === "reload"`; all paths wrapped so failures never reach Pi.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test tests/unit/inventory-snapshot.test.ts tests/unit/retention.test.ts tests/unit/maintenance.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/storage/inventory-snapshot.ts src/storage/retention.ts src/storage/maintenance.ts src/pi/session-start.ts src/index.ts tests/unit/inventory-snapshot.test.ts tests/unit/retention.test.ts
git commit -m "feat: persist bounded inventory snapshots with refresh and expiry"
```

---

### Task 9: Report DTO wiring for commands, skills, resources, and tool attribution

**Files:**

- Modify: `src/core/reports.ts`
- Modify: `src/ui/load-current.ts`, `src/ui/load-history.ts`
- Create: `tests/unit/reports-inventory.test.ts`
- Modify: `tests/unit/history-reports.test.ts`

**Interfaces:**

- Produces: `SessionReport.commands`, `.skills`, `.resources`; `Tool.source`; `GlobalReport.inventory: { commands: number | null; skills: number | null; resources: number | null }`; history/global folds read `aggregates.resourceCounts` and `aggregates.skillInvocations`.
- Consumes: `InventorySnapshot` (Task 7), `FoldedCounters` (Task 3), `SessionObservation` (Task 6).

- [ ] **Step 1: Write the failing test**

`tests/unit/reports-inventory.test.ts`:

```ts
test("composes inventory, invocation counts, and tool source attribution", () => {
  const reduced = reduceEntries("session-a", [
    { id: "a1", parentId: null, timestamp: "2026-09-11T10:00:00Z", type: "message", message: { role: "assistant", provider: "acme", model: "alpha", usage: { totalTokens: 5, cost: { total: 0.1 } }, content: [{ type: "toolCall", id: "call-1", name: "subagent" }] } },
    { id: "a2", parentId: "a1", timestamp: "2026-09-11T10:00:01Z", type: "message", message: { role: "toolResult", toolCallId: "call-1", toolName: "subagent", isError: false, content: [] } },
  ]);

  const report = toSessionReport(reduced, {
    presence: emptyObservation().presence,
    inventory: readInventory(
      [{ name: "ponytail", source: "extension", sourceInfo: { path: "/x", source: "npm:ponytail", scope: "user", origin: "package" } }],
      [{ name: "subagent", parameters: {}, sourceInfo: { path: "/y", source: "npm:pi-subagents", scope: "user", origin: "package" } }],
    ),
    counters: { counters: {}, skillInvocations: { "council-mode": 2 }, otherInvocations: 1, presence: { permission: false } },
  });

  assert.equal(report.tools[0]?.source, "npm:pi-subagents");
  assert.equal(report.commands.count, 1);
  assert.equal(report.commands.state, "supported");
  assert.equal(report.skills.invocationState, "supported");
  assert.equal(report.skills.invocationCount, 3);
  assert.equal(report.skills.otherInvocations, 1);
  assert.deepEqual(
    report.skills.items.find((row) => row.name === "council-mode")?.explicitInvocations,
    2,
  );
  assert.equal(report.resources.items.length, 2);
});

test("reports inventory as unavailable when no observation is supplied", () => {
  const report = toSessionReport(reduceEntries("session-b", []));
  assert.equal(report.commands.state, "unavailable");
  assert.equal(report.commands.count, null);
  assert.equal(report.skills.invocationState, "unavailable");
  assert.equal(report.skills.invocationCount, null);
  assert.equal(report.skills.otherInvocations, null);
  assert.equal(report.resources.state, "unavailable");
  assert.deepEqual(report.resources.items, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/reports-inventory.test.ts`
Expected: FAIL — `report.commands` undefined.

- [ ] **Step 3: Implement minimal code**

In `src/core/reports.ts`, add to `SessionReport` and `toSessionReport`:

```ts
  commands: { state: EvidenceState; items: readonly CommandRow[]; count: number | null };
  skills: { state: EvidenceState; items: readonly SkillRow[]; invocationState: EvidenceState; invocationCount: number | null; otherInvocations: number | null };
  resources: { state: EvidenceState; items: readonly ResourceSourceRow[] };
```

Projection rules: inventory present → `state: "supported"`, items capped, `count = items.length`; absent → `"unavailable"` with `count: null` and empty items. Skills items = union of inventory skills and counted invocation names (invocation-only rows carry `name` + `explicitInvocations`, no sourceLabel); `invocationCount = sum(values) + otherInvocations` (exact, including invocations whose key exceeded the 64-key cap), `otherInvocations` is surfaced on its own so the UI can say "+ N other invocations", and `invocationState = "supported"` when any count exists (including a nonzero `otherInvocations`). Tools: attach `source` from `observation.inventory.toolSources[tool.name]` when present. Presence: `permission` is `"present"` when the live signal **or** the persisted `presence.permission` aggregate is set; for history/global the other rows are recomputed from that session's inventory snapshot signals when it exists, else `"unknown"`.

`src/ui/load-history.ts`: build each session's evidence from its checkpoint aggregates:

```ts
const counters = checkpoint === undefined ? undefined : foldedFromCheckpointAggregates(checkpoint.aggregates);
```

with `foldedFromCheckpointAggregates` in `src/core/live-counter-fold.ts` mapping the persisted aggregate maps back to `FoldedCounters` (`integrationCounters`, `skillInvocations`, `skillOverflowInvocations` → `otherInvocations`, `presence.permission`; validated names and safe integers only — anything invalid is dropped rather than repaired). History and global reports read **only** the checkpoint aggregates (never WAL) so a history read can never double count and never mutates state. Also accept an optional `inventory` for global/history totals and set `GlobalReport.inventory` from summed `resourceCounts` (or `null` when absent).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/reports-inventory.test.ts tests/unit/history-reports.test.ts tests/unit/reports-integrations.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/reports.ts src/ui/load-current.ts src/ui/load-history.ts src/core/live-counter-fold.ts tests/unit/reports-inventory.test.ts tests/unit/history-reports.test.ts
git commit -m "feat: report command, skill, resource, and tool-source evidence"
```

---

### Task 10: pi-subagents auto-discovery from persisted tool results

**Files:**

- Rewrite: `src/integrations/subagents.ts`
- Create: `tests/fixtures/pi/0.85.1/subagent-tool-results.jsonl`
- Rewrite: `tests/unit/subagents.test.ts`
- Delete: `tests/fixtures/integrations/subagents.json`, `tests/unit/…` references in `tests/unit/reports-integrations.test.ts`, `tests/unit/integration-privacy.test.ts`, `tests/unit/command-options.test.ts`, `tests/unit/index-current-ui.test.ts`

**Interfaces:**

- Produces: `readSubagentEvidence(entries): SubagentEvidence`; `AgentToolActivity`; opaque `subagent-<sha256>` run ids retained from the previous derivation. (`readSubagentEvidenceWithArchives` is implemented in Task 11; until then the report uses the pure function and leaves `artifacts` absent.)
- Consumes: `SessionEntry`, `Usage`; Task 11 supplies archive validation inside the `WithArchives` variant.

- [ ] **Step 1: Write the failing test**

`tests/unit/subagents.test.ts` (replaces the injection-based tests):

```ts
test("derives native tool activity and cooperative runs from persisted results", async () => {
  const fixture = await readFile(
    new URL("../fixtures/pi/0.85.1/subagent-tool-results.jsonl", import.meta.url),
    "utf8",
  );
  const { entries } = parseSessionJsonl(fixture);

  const evidence = readSubagentEvidence(entries);

  assert.equal(evidence.activity.state, "supported");
  assert.equal(evidence.activity.calls, 3);
  assert.equal(evidence.activity.succeeded, 1);
  assert.equal(evidence.activity.failed, 1);
  assert.equal(evidence.activity.interrupted, 1);
  assert.deepEqual(evidence.activity.tools, [
    { name: "subagent", calls: 2 },
    { name: "subagent_wait", calls: 1 },
  ]);
  assert.deepEqual(evidence.activity.usage, { totalTokens: 1500, cost: 0.25 });

  assert.equal(evidence.state, "supported");
  assert.equal(evidence.runs.length, 2);
  assert.equal(evidence.runs.every((run) => /^subagent-[a-f0-9]{64}$/.test(run.id)), true);
  assert.equal(JSON.stringify(evidence).includes("PRIVATE_TASK"), false);
  assert.equal(JSON.stringify(evidence).includes("run-raw-id"), false);

  const completed = evidence.runs.find((run) => run.status === "succeeded");
  assert.deepEqual(completed?.usage, { totalTokens: 700, cost: 0.1 });
  assert.equal(completed?.agent, "reviewer");
});

test("degrades to native activity when details are absent or malformed", () => {
  const entries = parseSessionJsonl(
    [
      JSON.stringify({ type: "session", version: 3, id: "s" }),
      JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp: "2026-09-11T10:00:00Z", message: { role: "assistant", provider: "p", model: "m", content: [{ type: "toolCall", id: "c1", name: "subagent" }] } }),
      JSON.stringify({ type: "message", id: "m2", parentId: "m1", timestamp: "2026-09-11T10:00:01Z", message: { role: "toolResult", toolCallId: "c1", toolName: "subagent", isError: true, details: { completions: "not-an-array" }, content: [] } }),
    ].join("\n"),
  ).entries;

  const evidence = readSubagentEvidence(entries);
  assert.equal(evidence.activity.calls, 1);
  assert.equal(evidence.activity.failed, 1);
  assert.deepEqual(evidence.runs, []);
  assert.equal(evidence.state, "unavailable");
});
```

Fixture `subagent-tool-results.jsonl`: one `subagent` call whose result carries `details.results[]` with `usage: { input, output, cacheRead, cacheWrite, cost, turns }` plus a `task: "PRIVATE_TASK"` field that must never surface; one `subagent_wait` result with `details.completions[]` containing a child `runId: "run-raw-id"`, `agent: "reviewer"`, `success: true`, `usage` partial in one child (must yield no usage) and complete in the other; one unresolved `subagent` call (interrupted); one `isError: true` result.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/subagents.test.ts`
Expected: FAIL — exports changed / old injection tests fail.

- [ ] **Step 3: Implement minimal code**

`src/integrations/subagents.ts`:

```ts
const SUBAGENT_TOOLS = new Set(["subagent", "subagent_wait", "subagent_supervisor"]);
const AGENT_LABEL = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,63}$/;
const MAX_RUNS = 256;
const MAX_ARTIFACT_BYTES = 128 * 1024;

export function readSubagentEvidence(entries: readonly SessionEntry[]): SubagentEvidence {
  // Walk assistant toolCall items, join toolResult messages by toolCallId,
  // count status from isError, sum tool-result usage for those call ids,
  // then read details.results[]/details.completions[] into AgentRun rows.
}
```

Mapping rules (assert each in tests): `totalTokens = input + output + cacheRead + cacheWrite`; partial usage groups yield no `usage`; status from `success === true → "succeeded"`, `success === false → "failed"`, `state`/`exitCode` mapped through a closed vocabulary, anything else `"unknown"`; agent label bounded by `AGENT_LABEL` else absent; ids hashed with the existing `opaqueSubagentId`; unknown `details` fields ignored.

Also delete `readPublicSubagentArtifact`/`readSubagentRuns` and their fixture, and update the three other test files to stop importing them (replace assertions with `readSubagentEvidence` equivalents or delete the injected-artifact cases).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/subagents.test.ts tests/unit/reports-integrations.test.ts tests/unit/integration-privacy.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/integrations/subagents.ts tests
git commit -m "feat: auto-discover subagent runs from persisted tool results"
```

---

### Task 11: Validated published archive references

**Files:**

- Create: `src/integrations/subagent-archive.ts`
- Create: `tests/fixtures/integrations/subagent-archive-v1.json`, plus a test-local symlink fixture
- Modify: `src/ui/load-current.ts`, `src/ui/load-history.ts` (production consumer wiring, Task 6/9)
- Create: `tests/unit/subagent-archive.test.ts`, `tests/unit/subagent-archive-wiring.test.ts`
- Modify: `src/integrations/subagents.ts` (attach `artifacts`)

**Interfaces:**

- Produces: `readPublishedArchiveState(path, runId): Promise<"available" | "missing">` and `readSubagentEvidenceWithArchives(entries): Promise<SubagentEvidence>` (which attaches `artifacts` per run and falls back to `readSubagentEvidence` when no run publishes a reference).
- Consumes: `readSubagentEvidence` (Task 10).
- **Production consumer:** `loadCurrentSessionReport` (Task 6) and `loadHistoryReports` (Task 9) both call `readSubagentEvidenceWithArchives`, so this is on the real report path — not a tested-only helper. Archive reads never throw, never block a report, and never persist a path.
- Validation semantics (exact, all rejected with `"missing"`): path must be a non-empty absolute string; the target must not be a symlink (checked with `lstat` and by opening with `O_NOFOLLOW` where the platform provides it) and must be followed no further than one level; the target must be a regular file (no FIFO/socket/device/directory); size must be `<= 128 * 1024` and stable across the read; the JSON must be an object with `version === 1` and `runId` strictly equal to the expected run id. Any read/parse/stat error is `"missing"`.

- [ ] **Step 1: Write the failing test**

`tests/unit/subagent-archive.test.ts`:

```ts
test("accepts only versioned, run-matching, bounded regular-file archives", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "inspector-archive-"));
  const relative = "archive.json";
  const good = join(directory, "archive.json");
  await writeFile(good, JSON.stringify({ version: 1, runId: "run-a", createdAt: 1, entries: [{ agent: "reviewer", resultIndex: 0, source: "output-artifact", path: "/home/dev/PRIVATE" }] }));

  assert.equal(await readPublishedArchiveState(good, "run-a"), "available");
  assert.equal(await readPublishedArchiveState(good, "run-b"), "missing");
  assert.equal(await readPublishedArchiveState(join(directory, "absent.json"), "run-a"), "missing");
  assert.equal(await readPublishedArchiveState("/home/dev/PRIVATE", "run-a"), "missing");
  assert.equal(await readPublishedArchiveState(relative, "run-a"), "missing");

  // Symlink to a valid archive is refused; the target itself is fine.
  const symlinkPath = join(directory, "link.json");
  await symlink(good, symlinkPath);
  assert.equal(await readPublishedArchiveState(symlinkPath, "run-a"), "missing");

  await writeFile(join(directory, "wrong-version.json"), JSON.stringify({ version: 2, runId: "run-a", entries: [] }));
  assert.equal(await readPublishedArchiveState(join(directory, "wrong-version.json"), "run-a"), "missing");

  await writeFile(join(directory, "oversize.json"), JSON.stringify({ version: 1, runId: "run-a", padding: "x".repeat(140 * 1024) }));
  assert.equal(await readPublishedArchiveState(join(directory, "oversize.json"), "run-a"), "missing");

  // FIFO coverage is platform-conditional: skipped where mkfifo is unavailable (e.g. Windows).
  let fifoAvailable = true;
  try {
    execFileSync("mkfifo", [join(directory, "fifo")]);
  } catch {
    fifoAvailable = false;
  }
  if (fifoAvailable) {
    assert.equal(await readPublishedArchiveState(join(directory, "fifo"), "run-a"), "missing");
  } else {
    t.diagnostic("mkfifo unavailable: FIFO case skipped");
  }
});
```

Also add the wiring regression test in the same file (proves the production consumer, Task 11 must not be dead code):

```ts
test("production report path consumes archive enrichment", async () => {
  // Arrange a session whose subagent_wait result publishes archivePath, write a matching
  // version-1 archive, then load through the production loader (Task 6 wiring).
  const model = await loadCurrentSessionReport(sessionFile, "active", null, emptyObservation(), root);
  assert.equal(model?.report.agents[0]?.artifacts, "available");

  await rm(archivePath, { force: true });
  const missing = await loadCurrentSessionReport(sessionFile, "active", null, emptyObservation(), root);
  assert.equal(missing?.report.agents[0]?.artifacts, "missing");
  assert.equal(missing?.report.agentEvidence, "supported");
  assert.equal(missing?.report.agentActivity.calls, 1);
});
```

Required imports for this file: `execFileSync` (`node:child_process`), `mkdtemp`/`symlink`/`writeFile`/`rm` (`node:fs/promises`), `tmpdir`, `join`/`isAbsolute` (`node:path`), `test`, and `loadCurrentSessionReport`/`emptyObservation` for the wiring case.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/subagent-archive.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement minimal code**

`src/integrations/subagent-archive.ts` validates in this exact order and returns `"available"`/`"missing"` — never retaining the path, the JSON, or any entry field:

1. `typeof path === "string" && path.length > 0 && isAbsolute(path)`.
2. `const info = await lstat(path)`; reject when `info.isSymbolicLink()` or `!info.isFile()`; reject `info.size > 128 * 1024`.
3. `await open(path, O_RDONLY | O_NONBLOCK | (O_NOFOLLOW ?? 0))`; re-`stat` the handle and require `isFile()`, `size <= 128 * 1024`, and a size equal to the `lstat` size.
4. Read exactly `size` bytes; require `bytesRead === size` and a stable size after the read.
5. `JSON.parse` must yield a plain object with `version === 1` and `runId === expectedRunId`.

`O_NOFOLLOW` is `0` where the constant does not exist, and the `lstat` check in step 2 remains the portable guard; a symlink is therefore always `"missing"`. In `readSubagentEvidenceWithArchives`, set `artifacts: "available" | "missing"` per run from `archivePath` and run at most `MAX_RUNS` validations concurrently with `Promise.all`; a rejection from any single validation yields `"missing"` for that run only.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/subagent-archive.test.ts tests/unit/subagents.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/integrations/subagent-archive.ts src/integrations/subagents.ts tests/fixtures/integrations/subagent-archive-v1.json tests/unit/subagent-archive.test.ts
git commit -m "feat: follow only validated published subagent archive references"
```

---

### Task 12: Shared bounded redaction and persisted error messages

**Files:**

- Create: `src/core/redact.ts`
- Modify: `src/core/reduce.ts` (`ErrorRecord.message`)
- Modify: `src/pi/telemetry.ts` (reuse the shared `secretLikeValue`)
- Modify: `src/integrations/inventory.ts` (use `redactBoundedText` for descriptions)
- Create: `tests/unit/redact.test.ts`, `tests/fixtures/pi/0.85.1/error-message.jsonl`
- Modify: `tests/unit/error-ledger.test.ts`

**Interfaces:**

- Produces: `secretLikeValue`, `redactBoundedText(value, maxBytes = 200)`, markers `[REDACTED]`, `[PATH]`, `[URL]`.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing test**

`tests/unit/redact.test.ts`:

```ts
test("redacts secrets, paths, and URLs while preserving ordinary prose", () => {
  const cases: Array<[string, string]> = [
    ["Request failed: /home/dev/project/.env not readable", "Request failed: [PATH] not readable"],
    ["ENOENT: open '/tmp/report.json'", "ENOENT: open '[PATH]'"],
    ["missing C:\\Users\\dev\\secret.txt", "missing [PATH]"],
    ["missing C:/Users/dev/x", "missing [PATH]"],
    ["cannot read \\\\server\\share\\x", "cannot read [PATH]"],
    ["fetch file:///home/dev/x failed", "fetch [URL] failed"],
    ["401 from https://user:pass@api.example.com/v1?token=abc", "401 from [URL]"],
    ["Bearer sk-live-abcdef leaked", "[REDACTED]"],  // whole-value replacement when the value is secret-shaped
    ["unsupported: text/html", "unsupported: text/html"],
    ["ratio 1.2/3.4 and/or 3/4", "ratio 1.2/3.4 and/or 3/4"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(redactBoundedText(input), expected, input);
  }

  assert.equal(redactBoundedText("a".repeat(400))?.endsWith("…[TRUNCATED]"), true);
  assert.equal(redactBoundedText("line one\nline two")?.includes("\n"), false);
  assert.equal(redactBoundedText(undefined), undefined);
});
```

`tests/unit/error-ledger.test.ts` addition, using `tests/fixtures/pi/0.85.1/error-message.jsonl` (an assistant message with `stopReason: "error"`, `errorMessage: "429 rate limit from https://api.example.com/v1/chat?key=PRIVATE (see /home/dev/logs/x)"`, and a tool error whose result body contains `PRIVATE_TOOL_BODY`):

```ts
test("exposes only the bounded redacted persisted error message", async () => {
  const { entries } = parseSessionJsonl(await readFile(fixture, "utf8"));
  const reduced = reduceEntries("error-session", entries);
  const message = reduced.errors.find((error) => error.kind === "generation-error")?.message;

  assert.equal(message?.includes("429 rate limit"), true);
  assert.equal(message?.includes("PRIVATE"), false);
  assert.equal(message?.includes("http"), false);
  assert.equal(message?.includes("/home/dev"), false);
  assert.equal(JSON.stringify(reduced.errors).includes("PRIVATE_TOOL_BODY"), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/unit/redact.test.ts tests/unit/error-ledger.test.ts`
Expected: FAIL — module not found / no `message` field.

- [ ] **Step 3: Implement minimal code**

`src/core/redact.ts` exports the (moved verbatim) `secretLikeValue` plus:

```ts
const URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>()]+/gi;
const WINDOWS = /(?:^|[\s"'(=,])(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/])[^\s"'<>()]*/g;
const POSIX = /(?:^|[\s"'(=,])(?:~\/|\/)[^\s"'<>():,;]*(?:\/[^\s"'<>():,;]*)+/g;
const TRUNCATION = "…[TRUNCATED]";

export function redactBoundedText(value: unknown, maxBytes = 200): string | undefined {
  if (typeof value !== "string") return undefined;
  const single = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (single.length === 0) return undefined;
  const redacted = single
    .replace(URL, URL_MARKER)
    .replace(WINDOWS, (match) => match.replace(/(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/])[^\s"'<>()]*/, PATH_MARKER))
    .replace(POSIX, (match) => match.replace(/(?:~\/|\/)[^\s"'<>():,;]*(?:\/[^\s"'<>():,;]*)+/, PATH_MARKER));
  const sealed = secretLikeValue(redacted) ? REDACTED : redacted;
  const limit = Math.max(1, maxBytes - Buffer.byteLength(TRUNCATION, "utf8"));
  return Buffer.byteLength(sealed, "utf8") <= maxBytes ? sealed : truncateUtf8(sealed, limit) + TRUNCATION;
}
```

(`secretLikeValue` only replaces the whole string when it matches a secret shape; per-token secrets such as a bare `Bearer` value are already covered by that predicate on the composed string. Order: control-strip → URL → path → secret-shape → truncate. `truncateUtf8` cuts at a UTF-8 boundary.)

`src/core/reduce.ts`: in `readGenerationError`, also read the message:

```ts
function readGenerationError(message: Record<string, unknown>): { kind: ErrorKind; message?: string } | undefined {
  const stopReason = message.stopReason;
  if (typeof stopReason !== "string" || !Object.hasOwn(STOP_REASON_ERROR_KINDS, stopReason)) return undefined;
  const text = redactBoundedText(message.errorMessage);
  return { kind: STOP_REASON_ERROR_KINDS[stopReason], ...(text === undefined ? {} : { message: text }) };
}
```

and attach `message` to the pushed `ErrorRecord`. `src/pi/telemetry.ts` imports `secretLikeValue` from `src/core/redact.ts` (delete its private copy). `src/integrations/inventory.ts` replaces its temporary description helper with `redactBoundedText(description, 120)` plus the path-like rejection rule already asserted in Task 7.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test tests/unit/redact.test.ts tests/unit/error-ledger.test.ts tests/unit/telemetry.test.ts tests/unit/inventory.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/redact.ts src/core/reduce.ts src/pi/telemetry.ts src/integrations/inventory.ts tests/unit/redact.test.ts tests/unit/error-ledger.test.ts tests/fixtures/pi/0.85.1/error-message.jsonl
git commit -m "feat: persist bounded redacted error messages"
```

---

### Task 13: InspectorBundle loader with dual current views and offline range rows

**Files:**

- Create: `src/ui/bundle.ts`
- Create: `tests/fixtures/bundles/inspector-bundle.json`
- Create: `tests/unit/bundle.test.ts`

**Interfaces:**

- Produces: `loadInspectorBundle(input): Promise<InspectorBundle>`, types `CurrentView`, `InspectorBundle`, `InspectorBundleInput = { theme; initialScope; current: { sessionFile?, leafId } ; root; sessionDirectory(); observation?; maintenance }`.
- Consumes: `loadCurrentSessionReport` (Task 6), `loadHistoryReports`/`loadGlobalReport`, `emptyObservation` (Task 6).

- [ ] **Step 1: Write the failing test**

`tests/unit/bundle.test.ts`:

```ts
test("precomputes both current views without extra loader calls after generation", async () => {
  let currentCalls = 0;
  const bundle = await loadInspectorBundle({
    theme: "dark",
    initialScope: "tree",
    root,
    sessionDirectory: () => sessionDirectory,
    maintenance,
    loadCurrent: async (scope) => {
      currentCalls += 1;
      return modelFor(scope);
    },
    loadHistory: async () => ({ availability: "unavailable", sessions: [], diagnostics: [] }),
    loadGlobal: async () => ({ availability: "unavailable", sessions: [], usage: { totalTokens: 0, cost: 0 }, dates: [], diagnostics: [] }),
  });

  assert.equal(currentCalls, 2);
  assert.equal(bundle.initialScope, "tree");
  assert.equal(bundle.theme, "dark");
  assert.equal(bundle.current.active.availability, "available");
  assert.equal(bundle.current.tree.availability, "available");
  assert.equal(bundle.current.active.report?.sessionId, "session-a");

  // Offline range rows are embedded per view and per section.
  assert.ok((bundle.current.active.daily?.length ?? 0) > 0);
  assert.equal(bundle.current.active.dailyTruncated, false);
  assert.equal(bundle.schemaVersion, 1);
});

test("degrades one unavailable view without failing the bundle", async () => {
  const bundle = await loadInspectorBundle({
    theme: "light",
    initialScope: "active",
    root,
    sessionDirectory: () => sessionDirectory,
    maintenance,
    loadCurrent: async (scope) => (scope === "active" ? undefined : modelFor("tree")),
    loadHistory: async () => ({ availability: "unavailable", sessions: [], diagnostics: [] }),
    loadGlobal: async () => ({ availability: "unavailable", sessions: [], usage: { totalTokens: 0, cost: 0 }, dates: [], diagnostics: [] }),
  });

  assert.equal(bundle.current.active.availability, "unavailable");
  assert.equal(bundle.current.active.diagnostic, "current-unavailable");
  assert.equal(bundle.current.tree.availability, "available");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/bundle.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement minimal code**

```ts
export type CurrentView = {
  availability: "available" | "unavailable";
  diagnostic?: string;
  report?: SessionReport;
  daily?: readonly DailyRow[];
  dailyTruncated?: boolean;
};

export type InspectorBundle = {
  schemaVersion: 1;
  theme: "light" | "dark";
  initialScope: Scope;
  current: { active: CurrentView; tree: CurrentView };
  history: HistoryReport;
  global: GlobalReport;
};
```

`loadInspectorBundle` accepts injectable loaders (defaulting to the real ones) so tests can count calls, replays the current session for `active` and `tree` (each capped, each producing `daily` rows from the report's own dates, capped at 366 with `dailyTruncated: true` on overflow), then loads history and global. Every loader call is wrapped so a throw becomes an unavailable section; the function never throws.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/bundle.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/bundle.ts tests/fixtures/bundles/inspector-bundle.json tests/unit/bundle.test.ts
git commit -m "feat: add inspector bundle loader with offline scope and range data"
```

---

### Task 14: HTML renderer for the bundle (dual views, offline ranges, new tabs, theme)

**Files:**

- Modify: `src/ui/html.ts`
- Modify: `tests/unit/html.test.ts`
- Create: `tests/unit/html-bundle.test.ts`

**Interfaces:**

- Produces: `renderInspectorBundle(bundle): string`; keeps `renderHtml(input: HtmlReport)` for section projections.
- Consumes: `InspectorBundle` (Task 13), new DTO fields (Tasks 1–12).

- [ ] **Step 1: Write the failing test**

`tests/unit/html-bundle.test.ts`:

```ts
```ts
// Test-local helpers (module scope in tests/unit/html-bundle.test.ts)
function embeddedJson(html: string): Record<string, any> {
  const match = /<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/.exec(html);
  return JSON.parse(match?.[1] ?? "{}");
}

function bundleFixture(): InspectorBundle {
  return JSON.parse(
    readFileSync(new URL("../fixtures/bundles/inspector-bundle.json", import.meta.url), "utf8"),
  ) as InspectorBundle;
}
```

test("renders one offline document with both current views and initial theme", () => {
  const html = renderInspectorBundle(bundleFixture());
  const data = embeddedJson(html);

  assert.match(html, /class="[^"]*theme-dark/);
  assert.equal(data.initialScope, "tree");
  assert.equal(data.current.active.report.sessionId, "session-a");
  assert.equal(data.current.tree.report.sessionId, "session-a");
  assert.equal(data.history.sessions.length, 2);
  assert.equal(data.global.daily.length > 0, true);
  assert.equal(renderInspectorBundle(bundleFixture()), html);

  // No network surface and no raw records.
  for (const leak of ["http://", "https://", "<script src", "PRIVATE", "promptGuidelines"]) {
    assert.equal(html.includes(leak), false, leak);
  }
});

test("renders inventory, resources, agent activity, integration presence, and error messages", () => {
  const html = renderInspectorBundle(bundleFixture());
  const data = embeddedJson(html);

  assert.equal(data.current.tree.report.commands.items.length, 1);
  assert.equal(data.current.tree.report.resources.items.length, 2);
  assert.equal(data.current.tree.report.agentActivity.calls, 3);
  assert.equal(data.current.tree.report.integrations.some((row) => row.presence === "absent"), true);
  assert.equal(data.current.tree.report.errors[0].message, "429 rate limit from [URL]");
  assert.equal(data.current.tree.report.skills.otherInvocations, 1);
  assert.equal(html.includes("inventory ≠ invocations"), true);
});

```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/html-bundle.test.ts`
Expected: FAIL — `renderInspectorBundle` is not exported.

- [ ] **Step 3: Implement minimal code**

In `src/ui/html.ts`:

**Canonical payload shape (defect fix).** `CurrentView` is the only shape for a current view: `{ availability, diagnostic?, report?, daily?, dailyTruncated? }`. All report-derived tables (`commands`, `skills`, `resources`, `agentActivity`, `agents`, `integrations`, `errors`, `models`, `tools`, `ledger`) live **only** under `view.report.*`; there is no flattened `view.commands`/`view.agentActivity` mirror. `currentViewProjection(view, scope)` therefore returns exactly:

```ts
{
  availability: view.availability,
  ...(view.diagnostic === undefined ? {} : { diagnostic: view.diagnostic }),
  scope,
  ...(view.report === undefined ? {} : { report: sessionView(view.report) }),
  ...(view.daily === undefined ? {} : { daily: view.daily, dailyTruncated: view.dailyTruncated ?? false }),
}
```

The browser reads `state.bundle.current[state.scope].report.<field>` for every report table and `state.bundle.current[state.scope].daily` for the chart/range — one lookup path, no fallback aliases.

Then:

- add `renderInspectorBundle(bundle)`, which embeds one escaped payload

```ts
{
  kind: "bundle",
  theme,
  initialScope,
  current: { active: currentViewProjection(bundle.current.active, "active"), tree: currentViewProjection(bundle.current.tree, "tree") },
  history: historyProjection(bundle.history),
  global: globalProjection(bundle.global),
}
```

- set `<body class="theme-dark">` when `theme === "dark"` (toggle button label starts on the opposite theme; existing toggle JS keeps working);
- extend tab rendering: Commands/Skills tables from `commands.items`/`skills.items` with the "inventory ≠ invocations" note, Integrations table with presence + state + counters + the Resource sources table (`resources.items`), Agents panel with `agentActivity` metrics above the rich rows, Errors table with the `message` column labelled "Message" and `Unavailable` when absent;
- switch the scope control to swap `current.active` / `current.tree` objects from the embedded payload (disabled with its diagnostic when a view is unavailable) and keep the 7D/14D/30D/Custom range logic operating only on embedded `daily` rows and `history.sessions` summaries; no fetch of any kind.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/html-bundle.test.ts tests/unit/html.test.ts && npm run typecheck`
Expected: PASS (existing `renderHtml` snapshot assertions still hold).

- [ ] **Step 5: Commit**

```bash
git add src/ui/html.ts tests/unit/html-bundle.test.ts tests/unit/html.test.ts
git commit -m "feat: render the offline inspector bundle with dual current views"
```

---

### Task 15: TUI parity for the new evidence

**Files:**

- Modify: `src/ui/current-tui.ts`
- Modify: `tests/unit/current-tui.test.ts`

**Interfaces:**

- Produces: Commands/Skills/Integrations/Agents/Errors tab content sourced from the new DTO fields, with `Unavailable` never rendered as `0`.
- Consumes: `SessionReport` (Tasks 1–12).

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/current-tui.test.ts`:

```ts
test("renders inventory, presence, agent activity, and bounded error messages", () => {
  const model = modelWith({
    commands: { state: "supported", count: 1, items: [{ name: "ponytail", source: "extension", sourceLabel: "npm:ponytail", scope: "user", origin: "package" }] },
    skills: { state: "supported", invocationState: "supported", invocationCount: 2, items: [{ name: "council-mode", explicitInvocations: 2 }] },
    resources: { state: "supported", items: [{ sourceLabel: "npm:ponytail", scope: "user", origin: "package", commands: 1, skills: 0, prompts: 0, tools: 0 }] },
    agentActivity: { state: "supported", calls: 3, succeeded: 1, failed: 1, interrupted: 1, tools: [{ name: "subagent", calls: 2 }] },
    integrations: [{ integration: "caveman", presence: "absent", state: "unavailable" }],
    errors: [{ id: "generation:a1", timestamp: "2026-09-11T10:00:00Z", kind: "generation-error", confidence: "native", message: "429 rate limit from [URL]" }],
  });

  assert.match(renderTab(model, "commands").join("\n"), /ponytail/);
  assert.match(renderTab(model, "skills").join("\n"), /council-mode/);
  assert.match(renderTab(model, "agents").join("\n"), /Calls: 3/);
  assert.match(renderTab(model, "integrations").join("\n"), /Not observed/);
  assert.match(renderTab(model, "errors").join("\n"), /429 rate limit/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/current-tui.test.ts`
Expected: FAIL — tabs render `Unavailable`.

- [ ] **Step 3: Implement minimal code**

Replace the `default: return ["Unavailable"]` branches for `commands`, `skills` with real renderers (inventory rows with source/scope; skills with `invocations: n` or `Unavailable`), extend `renderIntegrations()` to print `presence`, `state`, `version`, counters, and the resource-source rows, extend `renderAgents()` to print activity counts/tools above rich runs, and extend `renderErrors()` to print the bounded message line (`Message: Unavailable` when absent).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/current-tui.test.ts tests/unit/current-ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/current-tui.ts tests/unit/current-tui.test.ts
git commit -m "feat: render command, skill, resource, agent, and error evidence in the TUI"
```

---

### Task 16: Command grammar (positional modes, targets, options)

**Files:**

- Create: `src/commands/grammar.ts`
- Rewrite: `tests/unit/command-options.test.ts` → `tests/unit/command-grammar.test.ts`

**Interfaces:**

- Produces: `parseInspectorCommand(args)`; `InspectorCommand`; `InspectorMode`; `InspectorTarget`.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing test**

`tests/unit/command-grammar.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInspectorCommand } from "../../src/commands/grammar.ts";

const report = (args: string) => {
  const parsed = parseInspectorCommand(args);
  assert.equal(parsed.ok, true, args);
  return parsed.ok ? parsed.command : undefined;
};

test("parses the documented positional modes, targets, and options", () => {
  assert.deepEqual(report(""), { kind: "report", mode: "tui", target: "current", scope: "active", noOpen: false });
  assert.deepEqual(report("ui"), { kind: "report", mode: "ui", target: "current", scope: "active", noOpen: false });
  assert.deepEqual(report("ui --theme dark --scope tree"), { kind: "report", mode: "ui", target: "current", scope: "tree", theme: "dark", noOpen: false });
  assert.deepEqual(report("tui ledger"), { kind: "report", mode: "tui", target: "ledger", scope: "active", noOpen: false });
  assert.deepEqual(report("json history --output '/tmp/report file.json'"), { kind: "report", mode: "json", target: "history", scope: "tree", output: "/tmp/report file.json", noOpen: false });
  assert.deepEqual(report("json global"), { kind: "report", mode: "json", target: "global", scope: "tree", noOpen: false });
  assert.deepEqual(report("help"), { kind: "help" });
  assert.deepEqual(report("--help"), { kind: "help" });
});

test("rejects invalid combinations and removed syntax with a usable message", () => {
  const cases = [
    "ui history",
    "tui global",
    "json ledger",
    "json history --scope active",
    "json global --scope active",
    "tui --theme dark",
    "json --theme light",
    "tui --output /tmp/x.json",
    "json --no-open",
    "--format tui",
    "current",
    "ledger",
    "--subagents-artifact /tmp/x.json",
    "ui --theme blue",
    "ui --scope branch",
    "ui --output",
    "ui 'unterminated",
  ];
  for (const input of cases) {
    const parsed = parseInspectorCommand(input);
    assert.equal(parsed.ok, false, input);
    if (!parsed.ok) {
      assert.match(parsed.message, /Usage|help/i, input);
      assert.equal(parsed.message.includes("options are unavailable"), false, input);
    }
  }
});

test("keeps documented target defaults and output ownership", () => {
  assert.equal(report("json").target, "current");
  assert.equal(report("json").scope, "active");
  assert.equal(report("ui --no-open --output /tmp/a.html").noOpen, true);
  assert.equal(report("json --output 'C:\\reports\\my file.json'").output, "C:\\reports\\my file.json");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/command-grammar.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement minimal code**

`src/commands/grammar.ts` implements the tokenizer (moved from `src/index.ts`), the mode/target matrix, scope defaults (`active` for `current`/`ledger`, fixed `tree` for `json history|global`), option validation (`--theme` `ui` only; `--output` `ui|json`; `--no-open` `ui` only; `--scope` values `active|tree`), and returns `{ ok: false, message }` with a one-line usage summary plus `Run /session-inspector help.` for every rejected input, including removed syntax (`--format`, bare legacy targets, `--subagents-artifact`).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/command-grammar.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/grammar.ts tests/unit/command-grammar.test.ts
git rm -q tests/unit/command-options.test.ts
git commit -m "feat: replace --format with positional inspector modes"
```

---

### Task 17: Completions and help

**Files:**

- Create: `src/commands/completions.ts`, `src/commands/help.ts`
- Create: `tests/unit/command-completions.test.ts`, `tests/unit/command-help.test.ts`

**Interfaces:**

- Produces: `completeInspectorCommand(prefix): AutocompleteItem[] | null`; `inspectorHelpLines(): readonly string[]`; `createInspectorHelpComponent({ theme, done })`.
- Consumes: `parseInspectorCommand`/mode-target matrix (Task 16).

- [ ] **Step 1: Write the failing test**

`tests/unit/command-completions.test.ts`:

```ts
test("offers only valid completions for the current token", () => {
  const values = (prefix: string) =>
    (completeInspectorCommand(prefix) ?? []).map((item) => item.value);

  assert.deepEqual(values(""), ["ui", "tui", "json", "help"]);
  assert.deepEqual(values("u"), ["ui"]);
  assert.deepEqual(values("tui "), ["current", "ledger"]);
  assert.deepEqual(values("json "), ["current", "history", "global"]);
  assert.deepEqual(values("ui -"), ["--scope", "--theme", "--output", "--no-open"]);
  assert.deepEqual(values("json -"), ["--scope", "--output"]);
  assert.deepEqual(values("ui --theme "), ["dark", "light"]);
  assert.deepEqual(values("ui --scope "), ["active", "tree"]);
  assert.deepEqual(values("tui --theme "), []);
  assert.equal(completeInspectorCommand("ui --nope "), null);
  assert.equal(completeInspectorCommand("nonsense "), null);
});
```

`tests/unit/command-help.test.ts`:

```ts
test("help lists only valid combinations and every mode", () => {
  const lines = inspectorHelpLines().join("\n");
  assert.match(lines, /session-inspector ui/);
  assert.match(lines, /session-inspector tui/);
  assert.match(lines, /session-inspector json/);
  assert.match(lines, /--theme dark\|light/);
  assert.equal(lines.includes("--format"), false);
  assert.equal(lines.includes("--subagents-artifact"), false);
  assert.equal(lines.split("\n").length <= 30, true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/unit/command-completions.test.ts tests/unit/command-help.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement minimal code**

`completeInspectorCommand` tokenizes the prefix (using the Task 16 tokenizer, keeping trailing whitespace as a signal that a new token is starting), then completes: modes, per-mode targets, per-mode option names, `--theme`/`--scope` values; returns `null` when the context has no valid suggestion. `inspectorHelpLines()` returns a static, width-safe array (≤30 lines) covering modes, targets, options, defaults, and 4 valid examples. `createInspectorHelpComponent` renders those lines in a `Component` with `esc`/`q` → `done()` and `truncateToWidth` for every line.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test tests/unit/command-completions.test.ts tests/unit/command-help.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/completions.ts src/commands/help.ts tests/unit/command-completions.test.ts tests/unit/command-help.test.ts
git commit -m "feat: add contextual completions and help for the inspector command"
```

---

### Task 18: Wire the new command surface in `src/index.ts`

**Files:**

- Modify: `src/index.ts`
- Modify: `tests/unit/index-report-command.test.ts`, `tests/unit/index-current-ui.test.ts`

**Interfaces:**

- Produces: production handlers for `ui`/`tui`/`json`/`help` with `getArgumentCompletions`, bundle generation, flush-before-read, and no `--subagents-artifact`; still exports `openReport`.
- Consumes: `parseInspectorCommand` (16), completions/help (17), `loadInspectorBundle` (13), `renderInspectorBundle` (14), `flushLiveEvidence` (6).

- [ ] **Step 1: Write the failing test**

Rewrite the command test to drive the production handler:

```ts
test("ui writes one self-contained bundle and opens it without an artifact flag", async () => {
  const notices: string[] = [];
  const ctx = commandContext({ notices });
  await handler("ui --theme dark --scope tree --output " + JSON.stringify(output), ctx);

  const html = await readFile(output, "utf8");
  assert.match(html, /theme-dark/);
  const data = JSON.parse(/<script id="report-data"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "{}");
  assert.equal(data.current.tree.report.sessionId, "real-session");
  assert.equal(data.current.active.report.sessionId, "real-session");
  assert.equal(notices.some((notice) => notice.includes("Inspector report written")), true);
});

test("legacy syntax and removed flags return usage instead of the generic message", async () => {
  for (const args of ["--format json", "current", "--subagents-artifact /tmp/x.json"]) {
    notices.length = 0;
    await handler(args, commandContext({ notices }));
    assert.equal(notices.join("\n").includes("options are unavailable"), false, args);
    assert.match(notices.join("\n"), /help/i, args);
  }
});

test("json export and tui path still work, and help opens without touching Pi execution", async () => {
  // json: writes deterministic JSON for scope tree; tui: opens the custom component; help: opens the help component.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/index-report-command.test.ts tests/unit/index-current-ui.test.ts`
Expected: FAIL — old parser rejects `ui`, and the flag tests fail.

- [ ] **Step 3: Implement minimal code**

In `src/index.ts`:

- replace `parseReportCommand` with `parseInspectorCommand` and delete `SUBAGENTS_ARTIFACT_OPTION`, `readPublicSubagentArtifact` import, and the `ReportKind`/`ReportFormat` types;
- register both command names with `description` and `getArgumentCompletions: (prefix) => completeInspectorCommand(prefix)`;
- build `observation` from current inventory + presence + `recoverSession` counters, and `flushLiveEvidence()` before reading;
- `help` → `ctx.ui.custom(createInspectorHelpComponent)`;
- `ui` → `loadInspectorBundle` + `renderInspectorBundle` + `generatedReportPath(cacheDirectory, "inspector", "html", "global")` + open unless `--no-open`;
- `json` → existing report loaders for `current|history|global`, `renderJson`, deterministic output, no open;
- `tui` → existing custom component for `current`/`ledger` (history/global TUI still unavailable with its own distinct message);
- invalid syntax → `ctx.ui.notify(parsed.message, "warning")`; runtime unavailability keeps its distinct messages.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/index-report-command.test.ts tests/unit/index-current-ui.test.ts tests/unit/index-tracking.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/unit/index-report-command.test.ts tests/unit/index-current-ui.test.ts
git commit -m "feat: serve ui, tui, json and help from the inspector command"
```

---

### Task 19: ADRs, spec/research/CHANGELOG updates, and the version bump

**Files:**

- Create: `docs/architecture/adr/0014-durable-live-integration-evidence.md`, `docs/architecture/adr/0015-resource-inventory-and-offline-ui-bundle.md`
- Modify: `docs/specs/pi-session-inspector-v1.md`, `docs/research/pi-ecosystem.md`, `docs/architecture/adr/README.md`
- Modify: `CHANGELOG.md`, `package.json`, `package-lock.json`

**Interfaces:**

- Produces: documented contracts + `0.7.0`.
- Consumes: everything above.

- [ ] **Step 1: Write the ADRs**

ADR 0014 records: foreign public bus events + the `input` skill observation become bounded WAL telemetry counters, folded cursor-based into `integrationCounters` and the capped `skillInvocations` map; process-local and 14-day limits; no backfill; flush-before-read as the single-source rule; `event`/`gauge` not folded; consequences of the bounded name→count aggregate. ADR 0015 records: commands/skills/resource-source inventory from `getCommands()` + `getAllTools()`; snapshot refresh triggers; `presence` vs `state`; inventory ≠ invocation ≠ activity; the dual-view offline `ui` bundle and its range/scope semantics; pi-subagents auto-discovery with validated archive references; the child-session-replay deferral; why `--subagents-artifact` was removed. Add both to `docs/architecture/adr/README.md`.

- [ ] **Step 2: Update spec, research, and changelog**

Spec: §3 command grammar and target matrix + the `ui` bundle contract, §4 DTO additions (presence, resource inventory, tool source, agent activity, error message), §5 checkpoint/delta counter semantics (`delta` vs `effective`, durable `presence.permission`, exact `otherInvocations` overflow), §6 the one bounded `input` observation plus foreign bus subscription, §7 checkpoint fields + inventory artifact + retention/refresh rules, §8.4 canonical `CurrentView` shape, §9 UX/theme/help/completions, §10 integration policy rows (Ponytail/Caveman split, Permission System bus, pi-subagents discovery + validated archive consumer, generic resources), §11 migration + downgrade-write notes. Research: replace the pi-subagents row with the verified installed `0.59.0` evidence (integrity `sha512-EOzArN0fU3AUQT+bjtq/8DfW8nSySTV43Qw97QFyChYBFX+GfmO3b7CgtelUfBqfg4gYmcq50B4MguAExIYM1g==`, `gitHead 45c0b41`), note `0.67.0` as latest, pin `@gotgenes/pi-permission-system@31.1.3` (`sha512-AoEQ+Q31qAahpF01g7jN8YCCHDhKJApag6Cmcfe5qTxP7DlDbm+1GbHrrPYCQG+0Y1a1/Vc/Qytwam32UDpWVw==`), and record the corrected artifact finding. CHANGELOG `[0.7.0]`: added evidence coverage, resource inventory, offline UI bundle, new command syntax; changed/removed (`--format`, legacy targets, `--subagents-artifact`, `mode`→`ponytail`/`caveman`); note the checkpoint downgrade behavior.

- [ ] **Step 3: Bump the version**

```bash
npm version 0.7.0 --no-git-tag-version
```

- [ ] **Step 4: Verify docs-only change**

Run: `npm run format:check && npm run lint && npm run typecheck && npm test`
Expected: PASS (all tests still green after version bump).

- [ ] **Step 5: Commit**

```bash
git add docs CHANGELOG.md package.json package-lock.json
git commit -m "docs: record ADR 0014/0015, refresh pins, and bump to 0.7.0"
```

---

### Task 20: Privacy corpus, determinism, and final regression verification

**Files:**

- Modify: `tests/unit/integration-privacy.test.ts`, `tests/integration/replay.test.ts`
- Create: `tests/fixtures/pi/0.85.1/uat-session.jsonl` (UAT-shaped: caveman present, ponytail absent, subagent activity, no permission bus)
- Create: `tests/unit/uat-evidence.test.ts`

**Interfaces:**

- Produces: the milestone's acceptance evidence.
- Consumes: everything above.

- [ ] **Step 1: Extend the privacy corpus**

Seed every new fixture with sentinel strings (`PRIVATE_TASK`, `secret`, `/home/dev/private`, `C:\Users\dev\private`, `file:///home/dev/private`, `permissions:decision` `value`/`matchedPattern`, `promptGuidelines`) and assert absence from: every adapter output, `SessionReport`, `renderJson`, `renderInspectorBundle`, and each TUI tab line. Also assert the UAT fixture reports Caveman `supported` with `changes ≥ 1`, Ponytail `absent`, commands/skills/resources `supported`, `agentActivity.calls = 1`, and integrations that distinguish `absent` from `unavailable`.

- **Regression additions:** `tests/unit/uat-evidence.test.ts` also asserts that repeated report reads and a second maintenance pass keep folded counters byte-identical (`integrationCounters`, `skillInvocations`, `skillOverflowInvocations`, `presence`), proving the checkpoint/delta split does not double-count.

- [ ] **Step 2: Run the whole suite and packaging checks**

```bash
npm run format:check && npm run lint && npm run typecheck && npm test
npm pack --dry-run
```

Expected: all checks PASS; the pack manifest still contains only `src`, `README.md`, `LICENSE`, `CHANGELOG.md`.

- [ ] **Step 3: Run manual UAT and record evidence**

- Current session: `/session-inspector ui --theme dark`, `ui --scope tree`, `tui`, `tui ledger`, `json --scope tree --output /tmp/report.json`, `help`, `/session-inspector` completion popup, and `--format tui` / `--subagents-artifact x` rejection.
- Offline check: open the generated HTML with the network disabled; switch Active ancestry ↔ Full tree and exercise 7D/14D/30D/Custom ranges — no reload, no fetch, no Pi call.
- Ponytail-positive session: run `/ponytail lite` (then restore the original mode) and confirm the Ponytail row shows `supported` with `changes ≥ 1`.
- Resumed session: after a restart, confirm folded permission/skill counts still appear (checkpoint aggregates + post-cursor delta), that repeated renders/reads show identical numbers, that the Permission row still reports `present` from durable presence, and that inventory/counters survive detail expiry as documented.

- [ ] **Step 4: Commit the final evidence**

```bash
git add tests
git commit -m "test: extend privacy corpus and add pre-M8 UAT evidence"
```

---

## Self-Review Notes

- **Spec coverage:** §1 audit → Tasks 1, 2, 10; §3 evidence model → Tasks 1, 2, 9; §4 producers → 1 (Ponytail/Caveman), 2 (Permission), 3 (live counters), 7 (commands/skills/resources), 10–11 (pi-subagents); §5 durable pipeline → 3–6; §6 inventory snapshot → 8; §7 errors → 12; §8 command surface → 16–18 (bundle contract 13–14); §9 DTO/renderers → 9, 14, 15; §10 privacy → 20 (+12); §11 storage/versioning → 5, 8, 19; §12 fixtures/tests → every task; §13 docs → 19; §15 acceptance → 20.
- **Deferred by design (not gaps):** child Pi session replay for subagent usage, `event`/`gauge` telemetry folding, Lens-specific view, M8 hardening/release. Each is recorded in the spec and ADR 0015/0014.
- **Type consistency:** `FoldedCounters` (with its `delta`/`checkpoint`/`effective` discipline), `InventorySnapshot`, `SessionObservation`, `SubagentEvidence`, `InspectorBundle` (report fields only under `CurrentView.report`), and the grammar types are defined once (Shared interfaces) and referenced by the same names in every later task.
- **Double-count guard:** Task 4 folds only post-cursor telemetry, Task 5 persists `merge(checkpoint, delta)` once per maintenance pass, Task 6 hands reports the effective bucket, and Tasks 5/6 carry the regression tests proving repeated maintenance and repeated report reads neither double-count nor mutate the checkpoint.
- **No dead code:** every adapter/fold helper introduced for archive or counter evidence has a named production consumer (`loadCurrentSessionReport`, `loadHistoryReports`, `maintainSession`, the command handler).

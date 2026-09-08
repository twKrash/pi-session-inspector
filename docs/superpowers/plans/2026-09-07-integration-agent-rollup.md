# Integration and Agent Roll-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add versioned local integration evidence and non-additive public subagent roll-up to session reports.

**Architecture:** Pure evidence adapters normalize explicit local entries/artifacts into bounded records. Registry validation owns supported-version decisions; canonical report projection owns aggregation. Pi replay remains source authority and UI displays only report rows or unavailable state.

**Tech Stack:** Node 22, TypeScript, node:test, existing Pi public APIs; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-07-integration-agent-rollup-design.md`

## Global Constraints

- Consume only explicit local Pi entries or public artifacts provided to Inspector.
- Never import private integration APIs, probe live extensions, scrape output, enumerate integrations, or call network.
- Persist/report no raw producer strings, prompts, responses, tool payloads, paths, commands, provider payloads, or secrets.
- Unknown version, malformed/missing artifact, and missing parent linkage return `unsupported`/`unavailable`; never infer.
- Pi-native parent usage is authoritative; child usage is breakdown only and never added to session totals.
- Current/session UI remains current-only; history/global/HTML stay out of scope.

---

### Task 1: Evidence registry and bounded records

**Files:**

- Create: `src/integrations/evidence.ts`
- Modify: `src/core/events.ts`
- Test: `tests/unit/evidence.test.ts`

**Interfaces:**

- Produces: `EvidenceState = "supported" | "unavailable" | "unsupported"`, bounded `IntegrationObservation`, `AgentRun`, and `EvidenceRegistry`.
- Consumes: explicit `unknown` local input only.

- [ ] **Step 1: Write failing registry tests**

```ts
assert.equal(registry.read({ integration: "ctx", version: 1, value: {} }).state, "supported");
assert.equal(registry.read({ integration: "ctx", version: 99, value: {} }).state, "unsupported");
assert.equal(registry.read(undefined).state, "unavailable");
assert.equal(registry.read({ integration: "ctx", version: 1, value: { raw: "secret" } }).state, "unsupported");
```

- [ ] **Step 2: Run focused test and confirm failure**

Run: `node --import tsx --test tests/unit/evidence.test.ts`
Expected: FAIL because registry module does not exist.

- [ ] **Step 3: Implement minimal bounded registry**

Create allowlisted integration keys (`context`, `rtk`, `mode`, `permission`, `subagents`, `lens`), numeric counters, fixed evidence states, and adapter registration by integration/version. Reject unrecognized object shapes and arbitrary strings. Keep diagnostic codes fixed literals.

- [ ] **Step 4: Run focused tests and confirm pass**

Run: `node --import tsx --test tests/unit/evidence.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/integrations/evidence.ts src/core/events.ts tests/unit/evidence.test.ts
git commit -m "feat: add integration evidence registry"
```

### Task 2: Pi-entry integration adapters

**Files:**

- Create: `src/integrations/pi-entries.ts`
- Test: `tests/unit/pi-entry-integrations.test.ts`
- Create: `tests/fixtures/integrations/pi-entries.jsonl`

**Interfaces:**

- Consumes: `SessionEntry[]` and `EvidenceRegistry` from Task 1.
- Produces: `readPiEntryEvidence(entries): readonly IntegrationObservation[]`.

- [ ] **Step 1: Write sanitized fixture and failing tests**

```ts
const rows = readPiEntryEvidence(entries);
assert.deepEqual(rows.map((row) => row.integration), ["context", "rtk", "mode", "permission", "lens"]);
assert.equal(rows.find((row) => row.integration === "rtk")?.state, "supported");
assert.equal(readPiEntryEvidence([unknownEntry])[0]?.state, "unsupported");
```

Fixture fields contain only types, schema versions, booleans, bounded counts, and fixed IDs.

- [ ] **Step 2: Run focused test and confirm failure**

Run: `node --import tsx --test tests/unit/pi-entry-integrations.test.ts`
Expected: FAIL because adapter module does not exist.

- [ ] **Step 3: Implement exact allowlisted adapters**

Recognize only `ctx_*` custom evidence, persisted `rtkCompaction`, known mode custom entries, public permission events, and generic Lens tool name/count. Do not retain unrecognized custom-entry data or any tool input/output. Emit `unsupported` for known integration with unknown version and omit unrelated entries.

- [ ] **Step 4: Run focused tests and confirm pass**

Run: `node --import tsx --test tests/unit/pi-entry-integrations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/integrations/pi-entries.ts tests/unit/pi-entry-integrations.test.ts tests/fixtures/integrations/pi-entries.jsonl
git commit -m "feat: read local integration evidence"
```

### Task 3: Public subagent artifact roll-up

**Files:**

- Create: `src/integrations/subagents.ts`
- Test: `tests/unit/subagents.test.ts`
- Create: `tests/fixtures/integrations/subagents.json`

**Interfaces:**

- Consumes: explicit local public artifact JSON.
- Produces: `readSubagentRuns(input): { state: EvidenceState; runs: readonly AgentRun[] }`.

- [ ] **Step 1: Write sanitized failing fixture tests**

```ts
const result = readSubagentRuns(foregroundArtifact);
assert.equal(result.runs[0]?.parentId, "parent-run");
assert.equal(result.runs[1]?.parentId, result.runs[0]?.id);
assert.equal(result.runs.reduce((sum, run) => sum + (run.usage?.cost ?? 0), 0), 3);
assert.equal(parentUsage.cost, 10);
assert.equal(readSubagentRuns(missingArtifact).state, "unavailable");
```

Cover foreground, async, nested, status, tool-result, malformed, missing-link, and unknown-version variants.

- [ ] **Step 2: Run focused test and confirm failure**

Run: `node --import tsx --test tests/unit/subagents.test.ts`
Expected: FAIL because adapter module does not exist.

- [ ] **Step 3: Implement public-artifact parser**

Accept only allowlisted artifact versions/fields. Preserve explicit parent IDs only; no timestamp parentage. Map known status literals; omit usage when absent/invalid. Cap run count and numeric usage. Return unavailable/unsupported with no runs on missing/unknown/malformed input.

- [ ] **Step 4: Run focused tests and confirm pass**

Run: `node --import tsx --test tests/unit/subagents.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/integrations/subagents.ts tests/unit/subagents.test.ts tests/fixtures/integrations/subagents.json
git commit -m "feat: add public subagent rollup"
```

### Task 4: Report projection and current TUI rows

**Files:**

- Modify: `src/core/reports.ts`
- Modify: `src/ui/current.ts`
- Modify: `src/ui/current-tui.ts`
- Test: `tests/unit/reports-integrations.test.ts`
- Test: `tests/unit/current-tui.test.ts`

**Interfaces:**

- Consumes: Task 1 records plus Task 2/3 adapter results.
- Produces: `SessionReport.agents` and `SessionReport.integrations` bounded rows.

- [ ] **Step 1: Write failing report/UI tests**

```ts
assert.equal(report.usage.cost, 10);
assert.equal(report.agents[0]?.usage?.cost, 3);
assert.equal(report.integrations[0]?.integration, "context");
assert.ok(renderedAgents.includes("Unavailable") || renderedAgents.includes("parent-run"));
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `node --import tsx --test tests/unit/reports-integrations.test.ts tests/unit/current-tui.test.ts`
Expected: FAIL because report rows are absent.

- [ ] **Step 3: Implement minimal projection/rendering**

Thread explicit adapter output into report construction without altering `usage`. Render bounded IDs/status/evidence/counts in Agents and Integrations tabs; keep unavailable/unsupported labels when rows absent. Do not expose raw source/artifact content.

- [ ] **Step 4: Run focused tests and confirm pass**

Run: `node --import tsx --test tests/unit/reports-integrations.test.ts tests/unit/current-tui.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/reports.ts src/ui/current.ts src/ui/current-tui.ts tests/unit/reports-integrations.test.ts tests/unit/current-tui.test.ts
git commit -m "feat: report integration and agent evidence"
```

### Task 5: M5 acceptance and documentation

**Files:**

- Modify: `docs/plans/pi-session-inspector-v1-implementation.md`
- Modify: `CHANGELOG.md`
- Test: all M5 tests.

**Interfaces:**

- Consumes: Task 1–4 exports.
- Produces: documented M5 completion and verified privacy/non-additive behavior.

- [ ] **Step 1: Add final regression assertions**

Add one privacy corpus assertion that every adapter/report output JSON excludes a seeded secret string, and one regression that a missing public artifact yields `unavailable`, not an empty supported row.

- [ ] **Step 2: Run full verification**

Run: `npm test && npm run typecheck && npm run lint && npm run format:check && npm pack --dry-run`
Expected: PASS.

- [ ] **Step 3: Update docs**

Mark M5 deliverables complete. Add changelog entry naming local evidence adapters and non-additive child agent breakdown. State no private API/runtime integration import is used.

- [ ] **Step 4: Re-run full verification**

Run: `npm test && npm run typecheck && npm run lint && npm run format:check && npm pack --dry-run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/plans/pi-session-inspector-v1-implementation.md CHANGELOG.md src tests
git commit -m "feat: add integration evidence rollup"
```

## Self-review

- Spec coverage: Tasks 1–3 implement validated local evidence and public subagent attribution; Task 4 exposes bounded report/TUI rows without parent additive usage; Task 5 proves privacy/missing-data behavior and documents scope.
- Placeholder scan: all adapters and cases are named; artifact schemas are explicitly allowlisted by each adapter.
- Type consistency: Task 1 records feed Tasks 2–4; Task 3 `AgentRun` and Task 2 observations feed Task 4 report projection.

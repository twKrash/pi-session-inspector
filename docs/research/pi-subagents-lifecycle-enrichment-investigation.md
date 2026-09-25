# PR C2: pi-subagents lifecycle enrichment investigation

**Artifact type:** local design investigation; not a product specification or implementation.

**Recommendation:** A narrow current-session enrichment is technically supportable from the public v3 `status.json` contract, but C2 should only fill existing `AgentRun.model` and `AgentRun.toolCalls` fields on an already-proven C1 async launch row. Do not consume lifecycle status/process-terminal proof, duration, turn count, usage, or cost. Keep history reports on persisted Pi JSONL only. Before implementation, resolve the ADR 0022 live-consumer/ping boundary noted in §13 and record this source/precedence rule in the relevant ADR.

No production code, tests, or product documentation were changed for this investigation. This file is the requested local artifact.

## 1. Evidence pins

### Inspector checkout

- Repository: `twKrash/pi-session-inspector`
- Revision examined: `7bb79c0b5301257906d08577f9fc49175e649d76` on `main`.
- Tracked working tree was clean. An unrelated untracked local file, `docs/research/pi-subagents-observability-investigation.md`, pre-existed this task and was not read as authority or modified.
- Canonical design sources reviewed: ADR 0022, ADR 0021, `src/core/events.ts`, `src/core/subagent-reconciliation.ts`, the persisted pi-subagents adapter, archive reader, current/history wiring, and C1 tests/fixture.

### Producer

- Requested immutable source: [`pi-subagents` commit `6f16d586bef814d74b3a2683cf297450ebfccb09](https://github.com/nicobailon/pi-subagents/tree/6f16d586bef814d74b3a2683cf297450ebfccb09), commit date `2026-09-24T18:11:55Z`; its `package.json` declares version `0.71.0`.
- Producer source and docs below were fetched at that exact SHA, not inferred from prior notes or a floating branch.
- **Pin caveat:** current npm metadata for `pi-subagents@0.71.0` reports a different `gitHead` (`4af5e85a427b9f87334585ae8d0eb365d4dd2a1e`) and integrity. The requested SHA itself declares `0.71.0`, but the registry version alone does not reproduce this exact source. This report follows the explicitly requested commit; implementation fixtures/release provenance should continue to pin the SHA, not only the package version.

## 2. Producer lifecycle architecture

At the pinned commit, a successful top-level async single-agent `subagent` launch returns a normal Pi tool result whose `details` contains `mode: "single"`, equal `runId`/`asyncId`, `asyncDir`, and an empty `results` array. The producer creates an initial v3 `status.json` under that directory before/around runner startup; the initial status is `state: "running"`, carries the root run ID and start time, and has one pending step. The path and initial artifact are not a permanent ledger.

The directory is a mutable operational surface. Producer documentation lists `status.json`, `events.jsonl`, output logs, and other runtime files. A `bg_wait` (and supported legacy wait publication) can later place a terminal `WaitCompletion` in the parent tool result's `details.completions[]`. The producer type comment explains why: completion result files are consumed/deleted after text delivery, so `details.completions[]` carries completion identity into the parent Pi tool result. That persisted Pi JSONL publication is the C1 historical terminal evidence; it is distinct from temporary completion-replay files.

`events.jsonl` is not a compact status ledger: the docs say it contains wrapper events plus child Pi JSON events annotated with run/step metadata. C2 should not read it. `processTerminal` is a separate process-exit proof, not task success. No RPC, child-session replay, event replay, or output replay is needed to read the documented `status.json` projection.

Sources: producer `docs/observability.md`; `src/runs/background/async-execution.ts` (initial status and single async launch result); `src/shared/types.ts` (`Details`, `WaitCompletion`, `WaitCompletionChild`, `AsyncStatus`); `src/runs/background/completion-replay.ts`.

## 3. Persisted-reference analysis

**Supported reference chain:** persisted parent Pi tool result `details.asyncDir` → fixed documented child `status.json`.

This is not an explicit `statusPath`: the persisted field is a directory. Constructing `status.json` beneath it is nevertheless supported by the producer contract, not a filename guess:

1. `Details.asyncDir?: string` is declared in pinned `src/shared/types.ts`.
2. `docs/observability.md` documents the async-run directory contents, including `status.json`, and says top-level async `details.asyncDir` points to that directory. It also directs consumers to read the JSON artifacts instead of scraping terminal text.
3. The pinned single-run launcher returns that same `asyncDir` in its `details` object.

Thus C2 may append exactly the documented relative filename `status.json` to an explicitly published `asyncDir`. It must not derive a run directory from a temp root, filename, run ID, or scan. The producer's directory name is not the identity bridge.

The reference is eligible only when the same persisted parent result passes C1 launch validation: exact `subagent` call/result join, successful matching tool result, `mode === "single"`, `results` is an empty array, valid `runId`, and `asyncId === runId`. C1 currently ignores `asyncDir`; C2 would read it privately from that already-validated result. A missing, oversized, non-absolute, unreadable, or otherwise invalid path is simply no lifecycle enrichment.

Use a bounded, no-symlink file reader patterned after `readPublishedArchiveState` (regular file, size checked before and after opening, no-follow where available, fixed read cap, swallowed filesystem/parse failures). Do not emit the path or a per-path error. A cap such as the existing 128 KiB archive cap is a reasonable fail-closed starting point; excess size means skip, not truncate-and-parse.

Sources: producer `docs/observability.md`, `src/shared/types.ts::Details`, `src/runs/background/async-execution.ts`; Inspector `src/integrations/subagents.ts::readAsyncLaunchRunId`; `src/integrations/subagent-archive.ts::readPublishedArchiveState`.

## 4. Identity analysis

The exact bridge is producer `runId`:

- C1 accepts a single async launch only when its `runId` equals `asyncId`.
- The lifecycle envelope requires `AsyncStatus.runId` and the process proof also carries `runId`.
- `WaitCompletion.runId` is required. C1 creates the exact launch/completion alias only when the same raw run ID occurs on both supported publications.
- Inspector derives private source identities and opaque public IDs from the run ID plus session identity. Raw producer IDs and paths do not enter `AgentRun`.

C2 must require exact equality between the lifecycle root `runId` and the raw `runId` from the validated launch publication. If lifecycle `sessionId` is present, require it to equal the parent Pi session ID passed to the reader; `sessionId` is optional in `AsyncStatus`, so its absence does not invalidate the exact run-ID bridge. `asyncDir` is only a locator. Never join by directory basename, file name, timestamp, label, agent/model name, array position, task text, or apparent parentage.

The lifecycle record may enrich only a C1 launch observation which already exists. It must not create an observation/alias/`AgentRun`, even if a well-formed status file exists at the path.

Sources: Inspector `src/integrations/subagents.ts::readAsyncLaunchRunId`, `collectRuns`, `opaqueSubagentSourceIdentity`, and alias construction; `src/core/subagent-reconciliation.ts::buildAliasIndex` / `reconcileAgentRuns`; producer `src/shared/types.ts::AsyncStatus`, `WaitCompletion`, `Details`.

## 5. Lifecycle artifact v3 contract

- The version field is **`lifecycleArtifactVersion`**, value `3`; it is not a generic `version` field. The producer constant is `SUBAGENT_LIFECYCLE_ARTIFACT_VERSION = 3`.
- The producer documents lifecycle JSON files as machine-readable and says unknown fields and event types should be ignored for forward compatibility. Therefore additive unknown fields in a v3 status object are compatible if C2 allowlists only the fields it uses.
- In source, `AsyncStatus.lifecycleArtifactVersion` is optional, even though the v3 writer sets it and the observability docs list it. For C2, require the field to equal `3`; missing version is not evidence of v3.
- `AsyncStatus` required root fields include `runId`, `mode`, `state`, and `startedAt`. `sessionId`, `endedAt`, `lastUpdate`, counts, totals, steps, and `processTerminal` are optional. The producer does not publish a formal JSON Schema or a documented malformed/unknown-version recovery rule. C2 must fail closed: unknown/missing version, malformed JSON, wrong shape, or wrong identity means skip enrichment, while preserving C1 rows.
- For this C2, accept only root `mode: "single"`. The producer's initial single status has one step; fields that live under `steps[]` are consumable only if the status contains exactly one valid step. This is a schema/cardinality check, not a name/position identity heuristic; root `runId` proves run identity.
- `ProcessTerminal` has its own `version: 1` union and is not a second v3 status schema. It can be nested under `AsyncStatus.processTerminal`; do not confuse the two version fields.

Sources: producer `src/shared/types.ts::SUBAGENT_LIFECYCLE_ARTIFACT_VERSION`, `AsyncStatus`, `ProcessTerminal`; producer `docs/observability.md` lifecycle-artifact section; pinned `src/runs/background/async-execution.ts` initial v3 writer.

## 6. Field authority and presence matrix

“Present vs zero” below describes the producer's typed/serialized shape. It does **not** elevate a mutable status snapshot to billing or historical authority.

| Candidate | Exact producer field / artifact | Required or optional; zero/presence | Scope, staleness, and authority | Inspector home and C2 decision |
|---|---|---|---|---|
| Lifecycle state/status | `AsyncStatus.state` in `status.json`, v3. Values include queued/running/complete/failed/partial/paused/stopped/rejected. | Required root string in `AsyncStatus`. | Mutable lifecycle snapshot; no cross-file atomicity guarantee with parent Pi JSONL. Weaker than persisted `WaitCompletion.state` plus `success`. Some states do not map cleanly to `AgentRun.status`. | Existing `AgentRun.status` home, but **do not consume in C2**. Preserve C1 status; terminal status comes from persisted completion. |
| Process-terminal proof | Optional `AsyncStatus.processTerminal`; `ProcessTerminal` v1 (`state`, `runId`, runner process instance, observed time/instances or an unknown reason). Also written as a separate producer sidecar and exposed through events/capability surfaces. | Optional. `observed` is positive process-close evidence; pending/unknown are not proof. | Stronger than `status.json.state === "running"` only for the fact “this runner process was observed closed.” It does not prove successful task completion or `WaitCompletion.success`. | No current public `AgentRun` field. **Do not consume/map to success, failure, or interruption in C2.** |
| Start time | `AsyncStatus.startedAt` (epoch milliseconds) in `status.json`. | Required numeric root field. | Producer start observation; not a persisted run duration or Pi publication timestamp. | No `AgentRun.startedAt`; never map to `observedAt`. **Reject.** |
| Completion time | `AsyncStatus.endedAt?` (epoch milliseconds). `completedAt` is not an `AsyncStatus` field; replay records have their own temporary completion time. | Optional. Missing differs from a number. | Mutable lifecycle timestamp; no durable per-run completion-time contract in C1. | No matching `AgentRun` field. Do not derive duration from it. **Reject.** |
| Duration | `steps[].durationMs?` in `AsyncStatus`; not a top-level `AsyncStatus` property in the pinned type. | Optional number; omitted in the initial pending step. A numeric zero is representable, but no public contract says every zero means final measured zero. | Per step; for a valid single-mode one-step status it describes the one step, but remains a mutable lifecycle snapshot. It is weaker than persisted final progress. | `AgentRun.durationMs` exists. **Defer/reject in current C2 because ADR 0021 explicitly says “No duration from timestamps or live status.”** Reconsider only with an explicit ADR 0021 decision; never compute from timestamps. |
| Actual/current model | `steps[].model?` in `status.json`, v3. | Optional string. The producer serializes it only when present. | Per step; may be a current/provisional model observation. Weaker than a model in later persisted completion evidence. | `AgentRun.model` exists. **Consume as fill-only enrichment** after existing bounded label validation; persisted Pi value wins. Never use as identity. |
| Requested model | `steps[].requestedModel?` in `status.json`, v3. | Optional string. | Producer docs define it as launch-requested model (explicit override or configured model) before registry normalization; intent, not necessarily effective model. | No separate `AgentRun.requestedModel`; do not mislabel it as actual model. **Reject/defer.** |
| Tool count | `steps[].toolCount?` (per step) and `AsyncStatus.toolCount?` (root summary), v3. | Optional number. Omission is distinguishable from explicit `0`; initial single status omits it. Treat explicit zero as a published snapshot value, never turn missing into zero. | Root value may be aggregate; use only the single step value after the one-step shape check. A running snapshot is provisional and can be stale; final persisted progress is stronger. | `AgentRun.toolCalls` exists and already receives persisted `progressSummary.toolCount`. **Consume the step count only when `toolCalls` is absent**, with partial effort coverage; persisted value wins. Apply current bounds. |
| Turn count | `AsyncStatus.turnCount?` and `steps[].turnCount?`, v3. | Optional number; omission and zero are distinguishable in the shape, but an explicit value may be a snapshot. | Producer turns are not native model-generation counts. No reason to use aggregate/root form. | `AgentRun.generations` is not a turn-count synonym; no `turnCount` field exists. **Do not add a public field in C2; reject/defer.** |
| Token totals | `AsyncStatus.totalTokens?: TokenUsage` and `steps[].tokens?: TokenUsage`; v3. `TokenUsage` requires `input`, `output`, `total`; `window` and `windowPeak` are optional. | Whole object optional; when present its required numeric components can be zero. There is no component-level missing/unknown bit once object exists. | Root is a run summary and can coexist with nested children; status is mutable/provisional. Producer docs do not define zero-fill/accounting coverage semantics. We cannot prove these totals exclude descendants or are billing authority. | `AgentRun.usage` exists but is child breakdown and must not affect native totals. **Exclude all lifecycle token totals in C2.** |
| Cost | `AsyncStatus.totalCost?: CostSummary` and `steps[].totalCost?: CostSummary`; v3. `CostSummary` requires `inputTokens`, `outputTokens`, and `costUsd`. | Whole object optional; components are required numbers and can be zero, with no component presence flags. | Root/step summaries may be provisional and do not provide a documented per-field “unpriced vs zero-cost” distinction. Nested-child/accounting semantics are not strong enough for Inspector billing attribution. | `AgentRun.usage.cost` exists, but must not be populated from this source. **Exclude.** |
| Input/output/reasoning/cache breakdown | `TokenUsage.input`, `.output`, `.total`, optional `.window`/`.windowPeak`; `CostSummary.inputTokens`, `.outputTokens`, `.costUsd`. | As above; no optional reasoning/cache-read/cache-write components in these lifecycle types. | Not equivalent to Inspector's normalized `AgentRunUsage` detailed token/cost components. | Do not map into `inputTokens`, `outputTokens`, reasoning/cache fields or component costs. **Exclude.** |
| Error count / failure detail | No per-run `errorCount` in `AsyncStatus`; `error?: string` is free text; lifecycle state is not a count. | No bounded count contract. | Any status error text is arbitrary and may be sensitive. | `AgentRun.errorCount` exists but no valid producer count source. **Exclude; never copy `error`.** |

Sources: producer `src/shared/types.ts::AsyncStatus`, `TokenUsage`, `CostSummary`, `ProcessTerminal`; `src/runs/background/async-execution.ts` initial status; `src/runs/background/async-status.ts` summary projection; producer `docs/observability.md` (`requestedModel` semantics). Inspector `src/core/events.ts::AgentRun`; `src/integrations/subagents.ts::readEffort`, `toAgentRun`, `readChildUsage`; ADR 0021.

## 7. Status and field precedence

1. **Persisted `bg_wait`/legacy wait completion wins for execution outcome.** C1 consumes the supported persisted `details.completions[]` row and maps its `success`, `state`, exit/failure evidence through the existing adapter. A contradictory lifecycle root state must not replace that outcome.
2. **`status.json` can be stale.** It is mutable and independently written from parent Pi JSONL; the producer does not document a transaction/ordering guarantee between status updates and a parent `bg_wait` result. In particular, `finalizeProcessTerminal()` writes process proof and its `overlayStatus()` only assigns `status.processTerminal`; it does not set `status.state`. Thus an observed process-terminal proof can coexist with a stale `state: "running"`. Treat this as possible and make no status-wins assumption.
3. **Process proof has narrower authority.** `state: "observed"` is stronger than `status.state` for runner-process closure only. It does not establish the agent's semantic success, output validity, or `WaitCompletion.success`.
4. **C2 field precedence:** enrich only missing `model`/`toolCalls` fields on the already-existing C1 launch observation, preserving that observation's existing persisted order/source identity. Do not create a new lifecycle observation order from `lastUpdate`, timestamps, path, or result-file order. If a later persisted completion contains the same field, existing L1 “latest valid persisted publication” precedence selects it. If a persisted field is already present, lifecycle never overwrites it. No merge/sum.
5. Missing, stale, malformed, unsupported, or mismatched lifecycle data never downgrades C1 status, removes a run, changes its parent, or changes integration support/diagnostics.

Sources: Inspector ADR 0022; `src/core/subagent-reconciliation.ts::updateField`, `updateStatus`, `mergeAliases`, `reconcileAgentRuns`; producer `src/runs/background/process-terminal.ts::finalizeProcessTerminal` / `overlayStatus`; producer `src/shared/types.ts::WaitCompletion` and `Details`.

## 8. Retention and durability

`status.json` is created for the async run and updated while the producer manages it. Its directory is under a producer temp root and is not promised as permanent session history. Pinned `async-retention.ts` sets a 30-day retention horizon and can remove an eligible terminal run directory (which contains `status.json`) after that age. It preserves runs while they are active, referenced by a wait, resumable, nested/workflow-linked, mission-linked, or otherwise protected; therefore 30 days is a cleanup policy, not a guaranteed retention SLA. Background cleanup can race snapshot construction; the file may disappear between reads.

On restart, the producer's `restoreActiveJobs()` enumerates queued/running runs; completed jobs are not restored as active in-memory jobs. Their on-disk status directory may still exist temporarily, but completion-delivery memory/result files are not a durable history contract. Parent Pi JSONL `details.completions[]`, when already written, remains C1 historical authority independently of status retention. A launch-only historical row can remain present as C1 `unknown`/unparented after its lifecycle directory is gone.

Conclusion: lifecycle artifacts are optional enrichment only. They cannot promise historical completeness, cannot remove C1 history, and should not be consulted for historical-session reports even when a recent temp directory happens to remain reachable.

Sources: producer `src/runs/background/async-retention.ts::ASYNC_RETENTION_DAYS` / terminal-retention decision; `src/runs/background/async-job-tracker.ts::restoreActiveJobs`; `src/shared/types.ts::Details` comment for completion payloads; Inspector ADR 0022.

## 9. Privacy and security analysis

`status.json` is a broad producer status object, not a safe report DTO. The type includes or permits working directories, session roots/files, output/transcript paths, child descriptions, recent output, free-text errors, structured output, extension/capability data, and nested children. The artifact path and raw run/session IDs are also private inputs.

C2 must parse only its allowlist (`lifecycleArtifactVersion`, `runId`, optional `sessionId`, `mode`, and the selected single-step `model`/`toolCount`). Do not retain raw objects, path strings, unknown fields, `requestedModel`, error text, task/goal text, output, transcripts, nested child payloads, or process-proof diagnostics. Sanitize `model` with the existing bounded producer-label helper; bound count values with current AgentRun limits. No raw ID/path in errors, logs, diagnostics, WAL, or report DTO. File/parse failures are swallowed because Inspector remains observer-only.

Read one fixed file from one explicit persisted reference. Do not scan producer roots; do not follow directory/file symlinks; cap bytes and verify the opened file remains within the validated bound. Do not read `events.jsonl`, output logs, replay/result files, archives, or child Pi session files for C2. No network, RPC, polling, listener, or rendered-text parsing.

Sources: Inspector invariant 3 / ADRs 0010, 0011, 0022; `src/integrations/subagent-archive.ts::readPublishedArchiveState`; producer `src/shared/types.ts::AsyncStatus`; producer `docs/observability.md` event/artifact descriptions.

## 10. Candidate C2 scope

### Decision

Proceed only as a **current-session, fill-only, two-field projection**, subject to §13:

```text
validated C1 async launch reference
    -> explicitly published asyncDir/status.json (v3, bounded read)
    -> exact status.runId == existing C1 launch runId (+ sessionId check if present)
    -> fill missing AgentRun.model and AgentRun.toolCalls only
```

### Exact fields and precedence

- `steps[].model` → existing `AgentRun.model`, only for a v3 `mode: "single"` envelope with exactly one valid step and only if no persisted C1 observation already supplied `model`. Apply `boundedProducerLabel`; persist no requested-model intent.
- `steps[].toolCount` → existing `AgentRun.toolCalls`, same one-step condition, bounded integer including explicit zero, only if persisted C1 evidence has not supplied `toolCalls`. Existing effort coverage remains `partial`; missing must stay missing.
- Attach these values to the already-proven C1 `async` source observation, retaining its original source identity/order. Let ordinary exact C1 alias and L1 reconciliation produce the existing row. This guarantees lifecycle cannot create IDs/rows and persisted completion field precedence still works.

### Scope boundaries

- **Current sessions only.** Current report callers already accept a dedicated subagent-evidence reader; use that current-only seam. Keep history replay on its existing persisted reader. The current/history distinction must not be hidden inside a generic adapter hook, because the same hook is currently invoked by history evidence too.
- No change to `AgentRun` public DTO is needed. `model` and `toolCalls` already exist; `executionKind: "async"` is already C1. Do not add `turnCount`, `requestedModel`, `startedAt`, `endedAt`, or process-terminal fields.
- Native usage totals and child usage remain untouched.
- Any reader failure is omission only; preserve the full C1 base evidence with no raw diagnostic.

### Duration decision

Although lifecycle `steps[].durationMs` has an existing DTO home, ADR 0021 explicitly rejects duration from live status. Therefore current C2 excludes it. If duration enrichment is a requirement, amend ADR 0021 first to approve the exact v3 single-step field as current-only producer evidence; do not silently treat status duration as the existing persisted `progressSummary.durationMs` contract.

## 11. Rejected and deferred fields

- **`state` / process-terminal:** too weak/stale for outcome precedence; no direct C2 need. Preserve C1 completion status and leave launch-only rows `unknown` unless future design explicitly adds a safe status projection.
- **`durationMs`:** deferred by ADR 0021; no timestamp subtraction.
- **`requestedModel`:** request intent, not actual effective model; no DTO home.
- **`turnCount`:** not `generations`; no DTO home; adding public field is not justified for C2.
- **`totalTokens`, `totalCost`, token/cost components:** optional aggregate snapshots with no accounting/presence guarantee adequate for Inspector. The producer's types make components numeric once an object exists, so zero cannot distinguish “unpriced/not observed” from actual zero. Nested child usage and root summaries are not a safe billing ledger. Exclude entirely.
- **Error strings, prompts, outputs, session paths, `events.jsonl`, completion replay, result files, nested child sessions:** privacy, durability, or scope violation; not C2 sources.
- **Any join by file/directory name, timestamp, agent/model label, or array ordering:** forbidden; runId exact bridge only.

## 12. Required tests for a future implementation

No tests were changed in this investigation. A C2 PR should add focused sanitized tests covering:

1. Valid persisted C1 `mode: single` launch with explicit `asyncDir`, matching v3 `status.json`, exact `runId`: fill model/toolCalls on the existing async AgentRun only.
2. Matching later persisted completion with model/toolCalls: persisted values win; status/failure/parent/public ID stay as C1 determined.
3. Launch-only row plus valid lifecycle file: row remains exactly one, parent unavailable, no alias/parent fabrication, status remains C1 unknown.
4. Missing file, path disappearance between checks, malformed JSON, oversize file, symlink/non-file, missing/unknown lifecycle version, wrong mode, wrong runId, and mismatched present sessionId: no enrichment and no loss of C1 row.
5. Additive unknown v3 fields are ignored; deliberately sensitive sentinels in unused fields never appear in DTO/debug/diagnostics.
6. Missing `model`/`toolCount` remain absent; explicit numeric zero is not converted to missing or to fabricated absence; invalid/unbounded values are omitted.
7. Multiple same-label runs with different runIds do not cross-join; conflicting duplicate references fail closed; no parent is inferred.
8. A lifecycle state of running/failed and `processTerminal: observed` do not override a persisted `bg_wait` terminal completion. No process proof maps to success/failure/interrupted.
9. Historical report path does not read status files, even if the file exists; current-session reader is the only enabled path.
10. Lifecycle enrichment leaves native session usage totals and child usage aggregation byte-for-byte unchanged.
11. Observer-only behavior: filesystem/parse failure leaves Pi result construction and report generation unaffected.

Expected test areas: existing `tests/unit/subagents.test.ts`, `tests/unit/subagent-archive.test.ts`, a focused lifecycle-reader test, and a current-vs-history integration assertion. Fixtures should be synthetic/sanitized and contain no real paths, prompts, outputs, secrets, or raw production IDs.

## 13. Open questions / stop conditions

1. **ADR 0022 live-consumer gate (stop before implementation):** ADR 0022 says any future live consumer validates `ping` for the same Pi session before activating a capability. This proposal uses only an explicitly persisted `asyncDir` reference and documented on-disk v3 contract (no RPC), but it is current-only and reads a mutable live artifact. Confirm whether that is classified as persisted-reference enrichment outside the RPC capability gate. If the ADR requires ping for this file read, the hard no-RPC invariant blocks C2 until the ADR boundary is clarified; do not quietly add RPC.
2. **Duration policy:** ADR 0021 currently forbids live-status duration. It remains excluded unless that ADR is explicitly revised.
3. **Artifact release identity:** npm `0.71.0` metadata currently points at a different Git SHA than the user-specified source SHA. Preserve both facts in provenance; do not substitute registry/latest source.
4. **Retention/non-determinism:** current-only gating is necessary. Adding lifecycle reads to the generic canonical hook would also affect history because `readHistorySessionEvidence()` calls the same contribution path. Keep history behavior unchanged.
5. **Field semantics:** producer docs establish schema/presence shape, not a durable billing contract or zero semantics for usage/cost. Any proposal to consume those fields needs new producer evidence, not a local heuristic.
6. **Stop if exact reference/identity is missing:** no `asyncDir`, status version not exactly 3, mode not single, or runId/session validation failure means no enrichment. Do not fall back to scanning, replay, or fuzzy correlation.

## 14. Source references

### Inspector sources

- `docs/architecture/adr/0022-pi-subagents-observability-contract-and-reconciliation-boundary.md` — historical authority, no scan, exact alias, current-only future live evidence, ping activation rule, privacy and accounting invariants.
- `docs/architecture/adr/0021-agent-run-effort-and-coverage.md` — existing duration/tool coverage and explicit rejection of duration from timestamps/live status.
- `src/integrations/subagents.ts`: `readSubagentEvidence`, `readSubagentEvidenceWithArchives`, `readAsyncLaunchRunId` (around lines 474–505), `collectRuns` (around 506 onward), `readEffort`, `toAgentRun`, `mapRunStatus`, `readChildUsage`, `collectArchiveReferences`.
- `src/integrations/adapters/subagents.ts::canonical` — current canonical adapter reads archive-aware persisted evidence.
- `src/integrations/subagent-archive.ts::readPublishedArchiveState` — existing bounded regular-file, no-follow, exact-runId validator.
- `src/core/events.ts::AgentRun`, `AgentRunUsage`, `AgentRunEffortCoverage` — public DTO field homes and missing/partial coverage semantics.
- `src/core/subagent-reconciliation.ts::MUTABLE_FIELDS`, `updateField`, `updateStatus`, `mergeAliases`, `reconcileAgentRuns` — latest valid field precedence, status conflict handling, and exact aliases.
- `src/integrations/contract.ts::CanonicalIntegrationContext` — only entries/sessionId today; no current/history flag.
- `src/index.ts::readHistorySessionEvidence`, `readSubagentContribution`, and current report wiring — current and history currently use different reader seams; avoid enabling lifecycle in the shared history hook.
- `tests/unit/subagents.test.ts` (C1 async launch/wait tests, especially around lines 220 and 394), `tests/fixtures/pi-subagents/persisted-async-visibility.jsonl`, and `tests/unit/subagent-archive.test.ts` — C1 visibility, exact alias, privacy, and archive-failure patterns.
- `src/integrations/pi-subagents-compatibility.ts::validatePiSubagentsPing` — current fail-closed RPC capability boundary; no RPC is proposed here.

### Pinned producer sources

All paths below refer to commit `6f16d586bef814d74b3a2683cf297450ebfccb09`:

- [`docs/observability.md`](https://github.com/nicobailon/pi-subagents/blob/6f16d586bef814d74b3a2683cf297450ebfccb09/docs/observability.md) — artifact directory/files, `asyncDir` relationship, status fields, consumer forward-compatibility guidance, event content, and `requestedModel` meaning.
- [`src/shared/types.ts`](https://github.com/nicobailon/pi-subagents/blob/6f16d586bef814d74b3a2683cf297450ebfccb09/src/shared/types.ts): `SUBAGENT_LIFECYCLE_ARTIFACT_VERSION` (~625), `TokenUsage` (~309), `CostSummary` (~890), `ProcessTerminal` (~687), `WaitCompletionChild` (~1369), `WaitCompletion` (~1392), `Details` (~1427), `AsyncStatus` (~1868–2029).
- [`src/runs/background/async-execution.ts`](https://github.com/nicobailon/pi-subagents/blob/6f16d586bef814d74b3a2683cf297450ebfccb09/src/runs/background/async-execution.ts) — status initialization, lifecycle version, and single async launch tool-result `details`.
- [`src/runs/background/async-status.ts`](https://github.com/nicobailon/pi-subagents/blob/6f16d586bef814d74b3a2683cf297450ebfccb09/src/runs/background/async-status.ts) — status projection/field serialization.
- [`src/runs/background/process-terminal.ts`](https://github.com/nicobailon/pi-subagents/blob/6f16d586bef814d74b3a2683cf297450ebfccb09/src/runs/background/process-terminal.ts): `finalizeProcessTerminal`, `overlayStatus`.
- [`src/runs/background/async-retention.ts`](https://github.com/nicobailon/pi-subagents/blob/6f16d586bef814d74b3a2683cf297450ebfccb09/src/runs/background/async-retention.ts) — 30-day cleanup horizon and protected/eligible terminal-run logic.
- [`src/runs/background/async-job-tracker.ts`](https://github.com/nicobailon/pi-subagents/blob/6f16d586bef814d74b3a2683cf297450ebfccb09/src/runs/background/async-job-tracker.ts)::`restoreActiveJobs` — queued/running-only job restoration.
- [`src/runs/background/completion-replay.ts`](https://github.com/nicobailon/pi-subagents/blob/6f16d586bef814d74b3a2683cf297450ebfccb09/src/runs/background/completion-replay.ts) and [`src/runs/background/result-watcher.ts`](https://github.com/nicobailon/pi-subagents/blob/6f16d586bef814d74b3a2683cf297450ebfccb09/src/runs/background/result-watcher.ts) — temporary completion/result handling, not historical authority.

---

**Bottom line:** The documented `details.asyncDir/status.json` relationship and exact `runId` bridge are sufficient for optional current-session file enrichment. Minimal C2 fills only existing `model` and per-step `toolCalls` fields on an already-proven C1 launch row. Historical reports, lifecycle status, process proof, duration (under current ADR 0021), turns, usage, and cost stay untouched.

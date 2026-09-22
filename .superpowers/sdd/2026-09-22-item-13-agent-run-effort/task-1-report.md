# Task 1 / PR 13A implementation report

## Files changed

- `docs/research/pi-ecosystem.md`: added the Item 13 evidence matrix, four audit lanes, version/provenance separation, privacy boundary, and 13B contract limits.
- `docs/roadmap.md`: recorded 13A as research-only, documented the four audit lanes and PR boundaries, and preserved 13B/13C/13D as future work.
- `tests/fixtures/pi/0.85.1/subagent-agent-run-effort-audit.jsonl`: created a 12-row sanitized Pi v3 JSONL fixture.

No production files, package metadata, lockfiles, ADRs, or specs were changed.

## Evidence decisions

The matrix labels candidate evidence `supported`, `partial`, or `unavailable` and covers outcome/error, duration/generations/tools, usage/cost/nesting, repeated publication, archive presence, malformed/incomplete publication, and provenance. It explicitly keeps `AgentRun.status`/`confidence` as execution semantics, treats producer terminal state as execution completion rather than semantic success, rejects timestamp-derived duration, keeps `usage.turns` separate from native generation count, prohibits `toolCalls[]`, and leaves per-run error count unavailable without an attributable producer count.

Child usage remains a non-additive breakdown. Repeated completion publication selects/replaces the same run observation rather than adding usage. Parent/child identity is used only where the producer contract supplies it. Archive evidence is presence/missing only.

Pi `0.85.1` is recorded as the persisted-session fixture baseline. `pi-subagents` `0.70.1` is labelled as the current local observation and `0.59.0` as historical evidence; neither is rewritten as the other.

## Fixture provenance and privacy checks

The fixture is synthetic and sanitized. It includes completed, failed (exit/signal), cancelled, running/incomplete, partial-usage, malformed/unavailable, repeated-publication, and nested parent/child cases. Producer version is recorded on each producer-derived row. IDs and labels are bounded placeholders; message content is empty. A recursive JSONL privacy scan found no forbidden keys (`task`, `error`, `toolCalls`, `arguments`, paths, session/archive references). No prompts, outputs, raw args/results, secrets, or unbounded producer strings are present.

## Commands and results

- `node --import tsx --test tests/unit/subagents.test.ts` — passed, 29 tests.
- `npm run format:check` — passed; Biome checked 191 files.
- `git diff --check` — passed.
- Recursive JSON parse and forbidden-key privacy scan — passed; 12 rows.

An initial ad-hoc scan incorrectly treated the allowed bounded field name `outputState` as forbidden; that scan was discarded and replaced with the exact forbidden-key scan above.

## Concerns

No implementation concerns. The fixture intentionally records producer examples for later adapter tests but does not add those tests or any production behavior; those remain 13B scope.

## Fix round 1 (2026-09-22)

### Changed files

- `docs/research/pi-ecosystem.md`: added a version-scoped 0.70.1 declaration table naming `SingleResult`, `SubagentDetails.results`, `WaitCompletion`, `WaitDetails.completions`, `WorkflowChild`, `WorkflowChildren.children`, and `ArchiveReference`, with exact persisted paths, provenance, and coverage limits. Cancellation is explicitly unavailable unless pinned producer evidence proves it; 0.59.0 remains historical and Pi 0.85.1 remains the session-fixture pin.
- `tests/fixtures/pi/0.85.1/subagent-agent-run-effort-audit.jsonl`: added matching assistant tool calls, moved every run into `details.results[]`, `details.completions[]`, or `workflowChildren.children[]`, and represented parent/child through a completion with nested `results[]`. The cancellation row no longer carries `success:false`; it is documented as unavailable absent a pinned cancellation declaration.
- `.superpowers/sdd/2026-09-22-item-13-agent-run-effort/task-1-report.md`: this fix-round record.

### Exact resolution

All three review findings were addressed without production, DTO, ADR/spec, package, or 13B test changes. The fixture now joins through tool-call IDs and exercises completed, failed, running, partial, malformed, repeated, cancelled/unavailable, workflow-child, and nested parent/child publications. Only bounded IDs/labels and empty content remain.

### Commands and results

- `node --import tsx --test tests/unit/subagents.test.ts` — passed, 29 tests.
- `npm run format:check` — passed; Biome checked 191 files.
- `git diff --check` — passed.
- Recursive JSONL parse/privacy scan (12 rows; forbidden keys and unbounded values) — passed.

### Concerns

## Fix round 2 (2026-09-22)

### Changed files

- `docs/research/pi-ecosystem.md`: pinned `pi-subagents@0.70.1` to gitHead `1ac7b5e2652e9571164847ac2905ab4aded92791`, the npm tarball URL, integrity, and exact declaration line ranges. Replaced the invented `ArchiveReference` symbol with `WaitCompletion.archivePath` and documented the bounded archive verdict. The contract table now lists `state`, `success`, `exitCode`, `processSignal`, and `outputState`, distinguishing declared fields from dynamic Inspector-accepted fields and noting `WorkflowChildSummary` does not declare usage.
- `tests/fixtures/pi/0.85.1/subagent-agent-run-effort-audit.jsonl`: removed the parser-reachable `state: "cancelled"` producer row; cancellation is unavailable because no pinned declaration evidence proves its semantics. The remaining 11 rows stay parser-reachable, sanitized, and version-separated.

### Exact resolution

The immutable 0.70.1 source pin and declaration ranges now provide provenance for every claimed producer field. `archivePath` is documented only as `WaitCompletion.archivePath` (line 1235), with path/content discarded. `state: "cancelled"` is no longer accepted from the fixture as producer evidence; no cancellation behavior is inferred. No production, DTO, ADR/spec, package, lockfile, or 13B test changes were made.

### Commands and results

- `node --import tsx --test tests/unit/subagents.test.ts` — passed, 29 tests.
- `npm run format:check` — passed; Biome checked 191 files.
- `git diff --check` — passed.
- Recursive JSONL parse/privacy scan — passed; 11 rows, no forbidden keys.

### Concerns

Cancellation remains unavailable by evidence design. Dynamic status fields retained in the sanitized fixture are explicitly identified as Inspector-accepted rather than declarations from the pinned producer types.

## Fix round 3 (2026-09-22)

### Exact resolution

Added one matching assistant/tool-result fixture pair whose `details.auditOnly.cancellation` object contains only the bounded candidate `cancelled` and reason `unavailable`. It is outside all parser publication arrays, contains no producer payload or sensitive content, and is intentionally ignored by the existing evidence parser. Documented that this is synthetic audit metadata, not a `pi-subagents` field; no producer `state: "cancelled"` row was restored. The fixture now has 12 rows. Immutable `pi-subagents@0.70.1` provenance and declaration ranges remain unchanged.

### Commands and results

- `node --import tsx --test tests/unit/subagents.test.ts` — passed; 29 tests.
- `npm run format:check` — passed; Biome checked 191 files.
- `git diff --check` — passed.
- Recursive JSONL parse/privacy scan — passed; 12 rows and no forbidden keys.

### Concerns


## Fix round 4 (2026-09-22)

### Corrected conclusions

- **Status/outcome:** split into A declared producer contract, B dynamic Inspector compatibility evidence, and C synthetic audit-only metadata. `exitCode`, `processSignal`, and `outputState` are declared on `SingleResult`; nested child `success` is declared on `WaitCompletionChild`; `state`/`success` on foreground results and outer completion are dynamic compatibility evidence, not declared `SingleResult` fields. Cancellation remains unavailable; `details.auditOnly.cancellation` is C, parser-invisible, and not producer evidence.
- **Duration:** `durationMs` is unavailable on the persisted audit surface. Pinned producer construction proves `progress.durationMs` and terminal `progressSummary.durationMs`, but no projection into persisted `details.results[]`, `details.completions[]`, nested results, or workflow summaries is proven. No timestamp/live-status inference is used.
- **Tool count:** `toolCount` is unavailable on persisted publications. Producer construction is proven (`progress.toolCount` and terminal `progressSummary.toolCount`), but publication/persistence is not; `toolCalls[].length` is never used.
- **Turn count:** `turnCount` is unavailable on persisted publications. Producer construction is proven (`progress.turnCount = result.usage.turns` and terminal summary), but no persisted projection is proven and it is not equated with usage turns or native generations.
- **`usage.turns` / generations:** `usage.turns` is separately supported only in persisted usage groups where present; it is usage metadata, never a native generation count. Missing or malformed groups remain unavailable/partial.
- **Error count:** unavailable; no bounded attributable producer count is persisted, and aggregate tool-result failures are not substituted.
- **Usage:** partial; bounded complete usage groups are retained from proven publication surfaces, malformed/partial groups stay partial or unavailable, and child usage is never added to parent totals.
- **Cost:** partial; only bounded producer `usage.cost` is accepted, never synthesized from duration or tokens.

### Exact files

- `docs/research/pi-ecosystem.md`: corrected separate effort rows, persisted-surface limits, and A/B/C outcome evidence split.
- `tests/fixtures/pi/0.85.1/subagent-agent-run-effort-audit.jsonl`: unchanged; no unproven progress fields were added. Existing bounded usage fields and C audit-only cancellation annotation remain sanitized and parser-invisible where required.
- `.superpowers/sdd/2026-09-22-item-13-agent-run-effort/task-1-report.md`: this coordination report only.

### Commands and results

- `node --import tsx --test tests/unit/subagents.test.ts` — passed.
- Recursive JSONL parse/privacy scan — passed; 12 rows, no forbidden keys or unbounded sensitive values.
- `git diff --check` — passed.
- `npm test` — passed.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run format:check` — passed.
- `npm pack --dry-run` — passed.

### Concerns

No production, canonical DTO, adapter, ADR, spec, package metadata, UI, parser behavior, or 13B files changed. Progress fields remain absent because persisted publication evidence was not proven.


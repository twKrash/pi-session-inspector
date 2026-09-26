# Pi ecosystem research baseline

**Purpose:** evidence for Pi Session Inspector v1. Retrieved 2026-09-07. This is a design/research artifact; **no production implementation occurred while it was written**.

## Evidence rules

- **Documented**: public docs describe contract.
- **Pinned implementation**: verified against exact package/source release; can drift later.
- **Observed**: present in installed sample/session code, not a public guarantee.
- **Unavailable**: Pi does not persist/expose it.
- **Cooperative**: another package must emit it.

Navigation links may follow `main`; implementation decisions rely on pinned sources below.

| Component | Immutable release evidence | Primary surfaces |
| --- | --- | --- |
| Pi | `@earendil-works/pi-coding-agent@0.85.1`; integrity `sha512-FGRN+OHbWaefBPGaTggAdLjrIHW+s2PzLyglz/5dfLzb9of7uuXMXYC0fJIeZTw+shS32o2cuQ9jF7YSDuL/oQ==`; commit [`d981de1`](https://github.com/earendil-works/pi/tree/d981de1229ef899957bbe968bc8dcda02a21f477) | `packages/coding-agent/src/core/extensions/types.ts`, `src/core/session-manager.ts`, `src/core/agent-session.ts`; [extensions](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/extensions.md), [sessions](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/session.md), [TUI](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/tui.md), [packages](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/packages.md) |
| pi-subagents | `0.70.1` current pinned evidence; gitHead `1ac7b5e2652e9571164847ac2905ab4aded92791`; integrity `sha512-cWNjguyrTfx6VmFzD+jCWIzJK3mBL5zjAhw5Z1E+5I3Iq5O2gCSmM0DphGDY6fh9w7eUewH1OR6Vsi/+Uje6oQ==`; `0.59.0` verified installed historical UAT evidence, gitHead `45c0b41`, integrity `sha512-EOzArN0fU3AUQT+bjtq/8DfW8nSySTV43Qw97QFyChYBFX+GfmO3b7CgtelUfBqfg4gYmcq50B4MguAExIYM1g==` | `details.completions[]` (`WaitCompletion`: own `runId`, `agent`, `mode`, `state`, `success`, `archivePath`, `results`, `workflowChildren`), with usage on `WaitCompletionChild` under `results[]`; foreground `details.runId` plus `details.results[]` (result index and producer fields), `foreground-history.json`, `output-archives/<runId>.json` | current producer is pinned to `0.70.1`; `0.59.0` is historical UAT evidence, not current. Foreground uses `details.runId` plus result index; completion surfaces carry their own run IDs |
| Permission System | `@gotgenes/pi-permission-system@31.1.3`; integrity `sha512-AoEQ+Q31qAahpF01g7jN8YCCHDhKJApag6Cmcfe5qTxP7DlDbm+1GbHrrPYCQG+0Y1a1/Vc/Qytwam32UDpWVw==`; [`085c241`](https://github.com/gotgenes/pi-packages/tree/085c24109e011f86f52c090ce57143153c6fe726/packages/pi-permission-system) | `src/service/permission-events.ts`: process-local `permissions:ready`, `permissions:ui_prompt`, `permissions:decision` |
| RTK optimizer | `pi-rtk-optimizer@0.9.0`; integrity `sha512-yj5DEdutRco5WvYEMEO0krZJP5Z6CpuNZoxlXSGmHEi2srB5Gao1xah/RnmVDn2se1FcqlmtS8+K/nzzkq0Pug==`; [`d155d25`](https://github.com/MasuRii/pi-rtk-optimizer/tree/d155d253cb2f1358e34e717d47a82ebccb08cb8e) | `src/{index,output-compactor,output-metrics}.ts` |
| Context Mode | `context-mode@1.0.169`; integrity `sha512-94JIaFuLjF9SO2BsGTrbGtyT44K95+9OC8BdbaL/UT76xOkanJLfUR5CzmNw+GELXZQqH4nBrKg9wjBnSFkVnQ==`; [`589d821`](https://github.com/mksglu/context-mode/tree/589d8214d56740a28b5f7bf63167743d586b0b40) | package tool registration; `skills/context-mode/SKILL.md` |
| Lens | `pi-lens@4.1.4`; integrity `sha512-CVTjvRdbTJoQy5cGVEKg6Q+tFdGvjZd7WsKSkXlsw/FKOCZ/DR55TTa7R2lyRDR8eTa3liF5yEGKY1n9H4RuNA==`; [`7a26192`](https://github.com/apmantza/pi-lens/tree/7a261926b8ec6aeaf473f1fdbff9d58cc8be0f68) | `docs/public-api-stability.md`; documented `pilens:*` events |
| Caveman / Ponytail | Caveman `1.0.8`, integrity `sha512-N0F/Ui86dEtKzoAnRpe+9t4AXsv9cshTGBFwbDf7aiiE1C5iQ8QrZuszdc/yX9FWNUP0pzSZX/M/zWynngnGQw==`, [`eb48fc0`](https://github.com/jonjonrankin/pi-caveman/tree/eb48fc0204e6fda9d83da981913459ed5d0f8746); Ponytail research pin [`974d940`](https://github.com/DietrichGebert/ponytail/tree/974d940a1c5344210874150b98ff0d2c861fab6a), local HEAD `356918e` (commit drift) | `extensions/caveman.ts`: schema-less `caveman-level {level}`; `pi-extension/index.js`: schema-less `ponytail-mode {mode}`, `hooks/ponytail-config.js` |
| Hermes (future) | [`94ff4fe`](https://github.com/NousResearch/hermes-agent/tree/94ff4fe8f969db6227adf3b8ab5c2a9cd0920295) | [hooks](https://github.com/NousResearch/hermes-agent/blob/94ff4fe8f969db6227adf3b8ab5c2a9cd0920295/website/docs/user-guide/features/hooks.md), [plugins](https://github.com/NousResearch/hermes-agent/blob/94ff4fe8f969db6227adf3b8ab5c2a9cd0920295/website/docs/user-guide/features/plugins.md), [observability](https://github.com/NousResearch/hermes-agent/blob/94ff4fe8f969db6227adf3b8ab5c2a9cd0920295/docs/observability/README.md) |

Before implementation, pin source **line ranges** from the downloaded tarballs in fixtures. GitHub line numbers move with formatting even at a commit; symbols plus tarball integrity are reproducible.

Implementation evidence recorded against installed package `0.85.1` with the integrity above: `ExtensionAPI.on()` observer overloads and `appendEntry()` at `dist/core/extensions/types.d.ts:906-985`; read-only `ExtensionContext.sessionManager` at `:209-246`; session directory/read APIs at `dist/core/session-manager.d.ts:167-176,183-241,317-355`; and `getAgentDir()` at `dist/config.d.ts:69-82`. No public subscription reports every persisted session append or exposes file-tail changes; live observer facts therefore remain bounded best-effort evidence. `getCommands()`/`getAllTools()` inventory provenance: `dist/core/extensions/types.d.ts:1001` and the extension context tool registry.

## Corrected pi-subagents artifact finding (re-audited 2026-09-11)

The original pin assumed a manual `--subagents-artifact` input shaped `{version:1, runs:[{id,parentId,status,usage}]}`. Re-auditing the installed producers found that **no pinned producer writes that shape**, so the flag was removed rather than preserved. The verified surfaces are:

- `details.completions[]` on `subagent_wait` results (`WaitCompletion`): `runId`, `agent`, `mode`, `state`, `success`, `archivePath`, `results`, `workflowChildren`; usage is on `WaitCompletionChild` under `results[]`, with child fields `runId`, `usage`, `success`, and `outputState`.
- `details.runId` identifies the foreground container; `details.results[]` on `subagent` results carries `index`, `agent`, and `usage` (no row-level foreground `runId`); completion surfaces carry their own `runId`s. `workflowChildren{version,inventoryComplete}` for workflow fan-out.
- `foreground-history.json` `{version:1, runs:[{runId,mode,cwd,sessionId,updatedAt,children[]}]}`. **Superseded 2026-09-26:** upstream issue #2485 confirms this file is internal resume bookkeeping. It is no longer an Inspector surface. The supported detached-foreground terminal source is the documented per-child metadata artifact `<artifacts dir>/{runId}_{agent}[_{index}]_meta.json`, referenced by `artifactPaths.metadataPath` in the same persisted result (audited on `pi-subagents@0.71.0`, release commit `4af5e85a427b9f87334585ae8d0eb365d4dd2a1e`; see ADR 0023).
- `completion-replay/<runId>.json` `{version:1, runId, sessionId, completedAt, expiresAt, archivePath, completion}`.
- `output-archives/<runId>.json` `{version:1, runId, createdAt, entries:[{agent,resultIndex,source,path}]}`.

`details.completions[]` is the only verified `archivePath` publisher, so Inspector follows archive references from that surface only and validates them as a bounded presence/identity reference (plain `version: 1` object whose `runId` equals the referencing run id); the archive body beyond that verdict is ignored. Unknown `details` fields are ignored and unknown status vocabulary maps to `unknown`, never guessed.

Real-session evidence used for UAT: 174 `subagent` and 46 `subagent_wait` tool results with populated `details`. Fixture provenance for `tests/fixtures/pi/0.85.1/{ponytail-caveman,error-message,subagent-tool-results}.jsonl` and `tests/fixtures/integrations/*` records producer name, version, integrity, symbol/field, and that the content is synthetic.

## Item 13 evidence audit (13A, 2026-09-22)

This is a research-only addendum for the subagent run outcome/effort follow-up. It does not change `AgentRun.status` or `confidence`, and it does not define the 13B DTO. The checked-in fixture `tests/fixtures/pi/0.85.1/subagent-agent-run-effort-audit.jsonl` is synthetic and sanitized: Pi session format is pinned to `0.85.1`; producer observations are labelled independently as `pi-subagents` `0.70.1` (current local declaration) and `0.59.0` (historical comparison row). IDs and labels are bounded placeholders, content is empty, and no task text, output, arguments, paths, secrets, raw errors, archive bodies, or `toolCalls[]` are present.

### Evidence matrix

Coverage labels are deliberately singular: `supported` means the bounded fact is present on a proven persisted surface; `partial` means only the final foreground surface is proven (supported-on-foreground); `unavailable` means no persisted publication proof exists. Lane A is the declared producer contract, Lane B is dynamic compatibility evidence, and Lane C is synthetic audit-only metadata outside parser publication arrays.

Pinned implementation citations for these conclusions are from `pi-subagents@0.70.1`, gitHead [`1ac7b5e2652e9571164847ac2905ab4aded92791`](https://github.com/nicobailon/pi-subagents/tree/1ac7b5e2652e9571164847ac2905ab4aded92791), tarball integrity `sha512-cWNjguyrTfx6VmFzD+jCWIzJK3mBL5zjAhw5Z1E+5I3Iq5O2gCSmM0DphGDY6fh9w7eUewH1OR6Vsi/+Uje6oQ==`: timeout construction `src/runs/foreground/execution.js:397-410` and timeout paths `:1084-1142`; interrupt construction `src/runs/foreground/execution.js:1250-1258` and final lifecycle aggregation `:1769-1771`; stopped result construction `src/runs/foreground/async-stop-action.js:61-90`; `SingleResult` declaration `src/shared/types.d.ts:1099-1160`; `compactForegroundResult`/`Details` `src/shared/utils.js:381-401`; and final foreground publication (`details.runId` plus `results:[r]`) `src/runs/foreground/subagent-executor.js:3621-3635`.

| Fact | Coverage | Exact persisted surface / conclusion | Lane and limitation |
| --- | --- | --- | --- |
| Foreground container identity | supported | `details.runId` on foreground `subagent` tool-result details in Pi JSONL | Lane A; container identity, not a child or completion ID |
| Foreground child identity | supported | `details.results[].index`, paired with `details.runId`; no row-level child `runId` | Lane A; key is `(details.runId, index)` and no branch is inferred |
| Completion identity | supported | `details.completions[].runId`; nested completion `results[].runId` | Lane A; completion IDs are separate from foreground identity |
| Cross-surface correlation | unavailable | foreground `details.runId`/`results[].index` and completion run IDs are separate surfaces; explicitly `none` shared key | Lane A; no joins by equal strings, container IDs, timestamps, agent, task, position, order, or adjacency |
| Repeated replacement | partial | same proven producer run identity on the same publication surface; cross-surface foreground/completion replacement is `none` | Lane A; only same-surface replacement/select is proven, and never by container ID alone |
| Terminal outcome | partial | foreground final `details.results[]`: declared `exitCode`, `processSignal`, `outputState`, `interrupted`, `timedOut`, `stopped`; completion surfaces retain their own `state`/`success` | Lane A plus Lane B foreground `state`/`success`; supported-on-foreground only, not semantic task success. `WaitCompletion.success` Lane A; foreground state/success Lane B; child success Lane A |
| interrupted | partial | foreground final `details.results[].interrupted` | Lane A, supported-on-foreground; exact trace: producer construction → declared `SingleResult` → `compactForegroundResult` → foreground `details.results[]` → persisted Pi JSONL; distinct from cancellation |
| timedOut | partial | foreground final `details.results[].timedOut` | Lane A, supported-on-foreground; exact trace: producer construction → declared `SingleResult` → `compactForegroundResult` → foreground `details.results[]` → persisted Pi JSONL; distinct from cancellation |
| stopped | partial | foreground final `details.results[].stopped` | Lane A, supported-on-foreground; exact trace: producer construction → declared `SingleResult` → `compactForegroundResult` → foreground `details.results[]` → persisted Pi JSONL; distinct from cancellation |
| Cancellation | unavailable | persisted producer surface: `none`; only parser-invisible `details.auditOnly.cancellation` is synthetic Lane C metadata | no producer cancellation contract; interruption, timeout, and stop are not cancellation |
| durationMs | partial | final foreground `details.results[].progressSummary.durationMs` | Lane A; supported-on-foreground via retained `progressSummary`; no timestamps/live status inference; other surfaces unavailable |
| toolCount | partial | final foreground `details.results[].progressSummary.toolCount` | Lane A; supported-on-foreground via retained `progressSummary`; never `toolCalls[].length`; other surfaces unavailable |
| turnCount | unavailable | persisted surface: `none`; live `progress.turnCount` is stripped by final compaction and `ProgressSummary` has no `turnCount` | Lane A; never infer from timestamps, tools, or usage |
| usage.turns | supported | persisted usage groups in foreground `details.results[].usage.turns` and declared completion child `details.completions[].results[].usage.turns` | Lane A for declared usage metadata; workflow-summary-owned usage is unavailable, not a generation count |
| native generations | unavailable | persisted surface: `none` | Lane A; `usage.turns` is not native generations |
| Per-run error count | unavailable | persisted surface: `none` on foreground/completion surfaces | Lane A; never derive from aggregate tool-result errors |
| Usage | partial | `details.results[].usage.*`; declared completion child `details.completions[].results[].usage.*` | Lane A for declared foreground/completion-child usage; workflow usage requires an exact-key-matched result row; supported-on-foreground and partial across surfaces; child breakdown is non-additive and malformed groups remain unavailable |
| Cost | partial | `details.results[].usage.cost`; declared completion child `details.completions[].results[].usage.cost` | Lane A for declared foreground/completion-child usage; workflow cost requires an exact-key-matched result row; supported-on-foreground and partial across surfaces; never synthesize from time or missing tokens |
| Native-vs-child accounting | supported | child usage is a separate breakdown with `contributesToSession:false`, never parent additive total | Lane A; native usage counted once |
| Failure class | supported | bounded `exitCode`, `processSignal`, `outputState`, and completion success/state fields; raw error surface is `none` | Lane A/B; enum only, no raw error text |
| Running/incomplete publication | supported | bounded `state`/output state on the persisted publication surface | Lane A/B; no duration or outcome inferred |

### Version-scoped producer contract (13B input)

The following is the `pi-subagents` `0.70.1` declaration-level map, pinned to gitHead [`1ac7b5e2652e9571164847ac2905ab4aded92791`](https://github.com/nicobailon/pi-subagents/tree/1ac7b5e2652e9571164847ac2905ab4aded92791), tarball [`pi-subagents-0.70.1.tgz`](https://registry.npmjs.org/pi-subagents/-/pi-subagents-0.70.1.tgz), integrity `sha512-cWNjguyrTfx6VmFzD+jCWIzJK3mBL5zjAhw5Z1E+5I3Iq5O2gCSmM0DphGDY6fh9w7eUewH1OR6Vsi/+Uje6oQ==`. Declaration evidence is `src/shared/types.d.ts` from that tarball: `SingleResult` lines 1099–1160, `WaitCompletionChild` lines 1205–1222, `WaitCompletion` lines 1227–1238, `Details` lines 1296–1312, and `WorkflowChildSummary` lines 167–184. It is deliberately separate from historical `0.59.0` and the Pi/session `0.85.1` pin. The fixture is a persisted Pi v3 session surface; each row carries `producerVersion` solely as provenance.

The fixture uses these bounded status/error fields: `state`, `success`, `exitCode`, `processSignal`, `outputState`, `interrupted`, `timedOut`, and `stopped`. `exitCode`, `processSignal`, `outputState`, `interrupted`, `timedOut`, and `stopped` are declared on `SingleResult`; `success` and `outputState` are declared on `WaitCompletionChild`; `state`, `success`, and `archivePath` are declared on `WaitCompletion`; `Details.results` and `Details.completions` are declared publication arrays; and `WorkflowChildSummary.children` declares child identity/state but no usage. Foreground `state`/`success` remain dynamic Lane B compatibility fields, while outer `WaitCompletion.success` and `WaitCompletionChild.success` are Lane A and retain separate semantics. No `ArchiveReference` declaration is asserted: `archivePath` is `WaitCompletion.archivePath`, reduced to the bounded available/missing verdict.

| Public declaration symbol | Exact field path | Persisted publication surface | Declaration / dynamic distinction | 13B coverage |
| --- | --- | --- | --- | --- |
| `SingleResult` | `details.results[].index`, `.agent`, `.exitCode`, `.processSignal`, `.usage`, `.outputState`, `.interrupted`, `.timedOut`, `.stopped` | foreground `subagent` tool-result `details` and its `results[]` in Pi JSONL | `details.runId` is the separately declared foreground container identity paired with each `results[].index`; it is not a `SingleResult` field. Final `compactForegroundResult` spreads the result, strips task/messages/progress/toolCalls, and retains lifecycle flags plus `progressSummary`. | supported for identity/lifecycle/usage when persisted; effort is partial on final foreground results; no cross-surface completion join |
| `WaitCompletion` | `details.completions[].runId`, `.agent`, `.mode`, `.state`, `.success`, `.archivePath`, `.results`, `.workflowChildren` | `subagent_wait` tool-result `details.completions[]` | all listed outer fields are declared Lane A; usage belongs to nested `WaitCompletionChild` results | supported for outer WaitCompletion terminal identity/state/outcome and same-surface replacement of that outer completion observation; usage is child-scoped under `WaitCompletionChild` |
| `WaitCompletionChild` | `details.completions[].results[].runId`, `.agent`, `.usage`, `.success`, `.outputState` | nested completion `results[]` | listed fields are declared; usage is child-scoped, with no outer completion usage field | supported for nested identity/usage; bounded output state only |
| `Details` | `details.results`, `.completions` | tool-result `details` object | both publication arrays are declared; malformed/missing values remain unavailable | supported publication join |
| `WorkflowChildSummary` | `details.workflowChildren.children[].childId`, `.runId`, `.agent`, `.state` | workflow publication `details.workflowChildren.children[]` | declaration supplies identity/state only, not usage; synthetic historical child-summary usage is unvalidated and rejected | partial: child identity/state; usage requires an exact-key-matched result |

The checked producer implementation proves live construction of `progress.durationMs`, `progress.toolCount`, and `progress.turnCount = result.usage.turns`. In the pinned single foreground final path, `compactForegroundResult` spreads the `SingleResult`, strips task/messages/progress/toolCalls, and retains `interrupted`, `timedOut`, `stopped`, and `progressSummary`; these lifecycle flags therefore persist through `details.results[]` into Pi JSONL, with separate meanings and Lane A support on that proven foreground surface. Terminal/failure/interruption effort fields are proven only when final foreground `results[]` has `progressSummary`; `subagent_wait` completions, nested completion results, and workflow summaries remain partial or unavailable. `turnCount` remains unavailable because final compaction strips `progress` and `ProgressSummary` has no `turnCount`; `usage.turns` is separately supported usage metadata, not native generations or `turnCount`. `observedAt` is only the publishing Pi entry timestamp; no duration is inferred from timestamps or live status files. Cancellation is unavailable: the fixture contains no producer cancellation row, and its `auditOnly` annotation is synthetic and parser-invisible. Cross-surface foreground-to-completion correlation is unavailable absent a producer-proven shared child ID; no timestamp, agent, task, position, order, adjacency, or container-ID join is permitted.

### Four audit lanes and PR boundary

1. **Outcome/error:** publish only bounded producer terminal evidence and failure classes; retain existing execution status semantics; error counts stay unavailable without an explicit producer count.
2. **Effort:** accept only producer-reported duration/turn/tool counts from persisted publication surfaces; never infer duration from `observedAt` or timestamps, and never inspect `toolCalls[]`.
3. **Usage/nesting:** preserve opaque run identity, repeated-publication replacement, explicit workflow child identity, and non-additive child usage; archive data is presence-only.
4. **Provenance/privacy:** keep Pi `0.85.1` as the session fixture baseline and record producer versions per evidence row; synthetic rows are bounded, empty-content, and safe to commit.

13A produces this matrix and fixture only. 13B owns any canonical DTO, adapter implementation, coverage mechanism, and new tests; 13C/13D remain out of scope. Any candidate lacking stable persisted attribution must be published as `unavailable`.


| # | Question | Answer | Evidence |
| --- | --- | --- | --- |
| 1 | What Pi version/runtime is v1 built for? | Latest stable only: Pi `0.85.1`, Node `>=22.19.0`. No older-version promise and no Bun requirement. | Pinned Pi package manifest; documented |
| 2 | How is a Pi extension loaded? | A Pi package declares `keywords: ["pi-package"]` and `pi.extensions`; Pi loads TS entrypoints through its runtime loader. | Pi packages docs; documented |
| 3 | Which hooks are safe for observer-only telemetry? | Use lifecycle observer events only; do not return values or register mutating hooks to observe. | `ExtensionAPI`/extensions docs; documented/pinned |
| 4 | What hook failure behavior is required? | Inspector catches all its own errors, returns nothing, queues no blocking I/O; telemetry failure cannot change execution. | Product invariant; Pi hooks are extension code, so isolation is Inspector responsibility |
| 5 | What is Pi session persistence? | Session v3 is append-only JSONL entries forming an `id`/`parentId` tree. | Session docs/`SessionManager`; documented/pinned |
| 6 | What is active branch versus full tree? | `getBranch()` yields selected ancestry; `getEntries()` provides append-order tree. `/tree` stays one file; fork/clone create linked files. | Session API/source; pinned |
| 7 | Which session identifiers are native? | Session entry IDs and tool-call IDs are native. Durable turn, agent-run, and branch IDs are absent. | Session types/sample entries; pinned/observed |
| 8 | Which usage/cost facts are reconstructable? | Assistant and nested tool-result/compaction/branch usage, provider/model, normalized usage/cost, stop/error and tool result state are persisted. | Session entry types; pinned |
| 9 | Which timing facts are reconstructable? | Not reliable provider-attempt or tool wall times/retries. Capture live boundaries best-effort; label confidence. | Lifecycle/session comparison; unavailable |
| 10 | Can Inspector alter Pi session files? | No. Pi native session data is primary. Only `appendEntry()` may write a namespaced tracking marker. | `SessionManager`/extension context; pinned |
| 11 | Is Pi session writing cross-process safe? | No general cross-process lock exists. Inspector owns separate per-writer shards. | `SessionManager` implementation; pinned |
| 12 | Can Pi event bus transport child telemetry? | No. Bus is process-local. Use each process's WAL or public subagent artifacts. | Event bus implementation; pinned |
| 13 | Can extensions/skills be enumerated exactly? | No. Commands/tools expose source provenance; extensions with neither are invisible. Skills are available; explicit invocation is visible; model-driven file loads are only observed evidence. | Extension context/skills behavior; pinned/observed |
| 14 | Which Pi UI is stable enough? | Full-screen `ctx.ui.custom()` is v1 UI. Overlay is experimental. | TUI docs; documented |
| 15 | How should browser opening work? | Use argv-based Pi exec: `open`, `xdg-open`, or `rundll32`; failure reports output path. | Pi exec API/platform behavior; pinned |
| 16 | What passive pi-subagents data exists? | Public RPC/status/result data plus child session/artifact files can identify runs, usage, cost, timing, status and nesting. | pi-subagents observability docs; documented |
| 17 | What is observable from Permission System? | `permissions:ready`, `permissions:ui_prompt`, `permissions:decision`, with request/decision metadata. Do not import internal Bash parser. | `permission-events.ts`; pinned |
| 18 | What RTK data is passive? | Final tool result `details.rtkCompaction` has exact source/compacted chars, lines, techniques, truncation. Rewrite intent is not persisted. | RTK source; pinned |
| 19 | What Context Mode data is passive? | `ctx_*` tool use. Rich savings are owned by Context Mode storage/output; no public bus protocol located. | Context Mode package; pinned |
| 20 | What Ponytail/Caveman data is passive? | Pi custom entries `ponytail-mode` and `caveman-level` preserve mode changes; both are schema-less, so the adapter reads them without requiring `schemaVersion`. Exact active duration after crash is inferred only. | Installed Caveman `1.0.8`/local Ponytail HEAD; pinned/observed |
| 21 | What Lens data is passive? | Generic tool calls are native. Versioned `pilens:*` public events can enrich diagnostics when supported; richer Lens view is v1.x. | Lens public API doc; documented |
| 22 | Is Hermes in v1? | No. Its session/request/tool/skill/approval/subagent observer vocabulary maps to canonical records later. | Hermes hooks; documented |
| 23 | What competing projects already solve? | `pi-stats-ext`, Radian and token stats cover usage; `@ygncode/pi-insights` covers HTML; tracing/OTEL packages cover payload tracing/export. Inspector differentiates with branch-correct, confidence-aware, crash-safe local reconstruction. | Ecosystem survey; observed |
| 24 | What storage design meets crash/concurrency constraints? | Pi source + append-only per-writer dated WAL segments, maintenance lease, atomic checkpoint, replay/reconcile, and maximum 14-calendar-day detailed-data retention. No daemon/SQLite. | Derived design from answers 5, 9–12 |
| 25 | What privacy boundary is defensible? | Local-only metadata, never prompts/outputs/raw args/results; redaction/allowlists before WAL. Exports warn that local metadata can still be sensitive. | Product requirement; enforce with tests |

## Lifecycle hook matrix

| Pi lifecycle observation | Capture | Persisted equivalent | Inspector behavior |
| --- | --- | --- | --- |
| `session_start`, `session_info_changed`, `session_shutdown` | session state/boundary | session info/custom entry partly | WAL marker/status only |
| `agent_start`, `agent_end`, `agent_settled` | agent boundary/checkpoint trigger | assistant entries only | best-effort duration; eager maintenance |
| `turn_start`, `turn_end` | derived turn boundary | no durable turn ID | deterministic derived ID, `live` confidence |
| `before_provider_request`, message completion | possible request start / assistant result | successful assistant usage/model | never claim exact retry/request span |
| `tool_execution_start`, `tool_execution_end` | tool timing/status | call/result and tool-call ID | correlate by native tool-call ID where present |
| compaction/tree/model/thinking changes | event boundary | compaction/custom/session entries | prefer replayed native fact |

Hook names and payload fields must be checked against the exact `0.85.1` declaration during Milestone 2; unknown optional fields degrade to `unavailable`.

## Persisted versus live matrix

| Fact | Pi JSONL | Live WAL | Integration artifact/event | Report confidence |
| --- | --- | --- | --- | --- |
| user/assistant/tool content | yes | never copy | never copy | native, private detail omitted |
| model, usage, cost, stop/error | yes | optional boundary only | child breakdown only | native |
| tool call/result identity | yes | start/end duration | optional enrichments | native + live |
| provider request attempt/retry time | no | conservative observer correlation | no | live/inferred/unavailable |
| permissions | no | Permission System event | Permission System | cooperative |
| subagent hierarchy | partial | local process only | public subagent artifacts | cooperative/native |
| RTK compaction savings | final details | no | RTK details | native |
| Context Mode savings | no | no | no protocol found | unavailable |
| mode state | custom entries | live active period | no | native/live |
| extension/skill use | partial source/list | observed hooks/file load | self-announcement | inferred/cooperative |

## Integration observability matrix

| Integration | v1 treatment | Data | Confidence / version risk |
| --- | --- | --- | --- |
| Pi core | required | session v3 plus observer hooks | native/pinned `0.85.1` |
| pi-subagents | passive | public artifacts, status/results | cooperative; artifact shapes version-pinned |
| Permission System | passive live | permission bus | cooperative; process-local |
| RTK | passive replay | `rtkCompaction` details | native; no rewrite telemetry |
| Context Mode | passive tool count | `ctx_*` calls | native usage only; savings unavailable |
| Ponytail/Caveman | passive replay | custom mode entries | native; duration may be inferred |
| Lens | generic native; rich v1.x | public bus when enabled | cooperative/versioned |
| Hermes | future adapter | hooks/correlation IDs | unsupported in v1 |

## Corrected assumptions and exclusions

1. No exact universal LLM-start/finish lifecycle pair exists; do not manufacture trace spans.
2. A session tree is not a stable named branch; use active leaf/path semantics.
3. `/fork`/`/clone` are separate session files, not a single tree.
4. No graceful shutdown guarantee exists; recovery begins from durable sources.
5. A local bus is not inter-process telemetry.
6. Mode entries prove configuration state, not semantic outcome/effectiveness.
7. HTML must not need a server/CDN; analytics must not require LLM calls.
8. No SQLite, daemon, cloud, mandatory Bun, Hermes adapter, provider wire capture, or raw-content copy in v1.

## Research follow-up checklist

- Download exact source tarballs into test-fixture provenance records before coding.
- Record declaration symbol and line range for each used Pi hook/type.
- Add sanitized real JSONL fixtures; never check prompts, outputs, paths, secrets, or account IDs into Git.
- Revalidate package versions, Pi API surfaces, npm name availability, trusted publishing rules, current Hermes API, and benchmark baselines at release time.

## Installed pi-subagents 0.71.0 workflow-key follow-up (2026-09-23)

This is a separate observation from the 13A audit above, which remains pinned to `pi-subagents@0.70.1` and its historical fixtures. The locally installed producer was `0.71.0`; individual persisted tool results do not stamp producer version, so this is environment-level provenance, not an event field.

In the 0.71.0 contract, `SingleResult.workflowKey` names the workflow child that owns a result. `workflowDetailsResults()` carries that key from `child.key`, and `workflowChildSummary()` publishes the same key as `childId`. Since the result publisher flattens each workflow child’s `results[]`, Inspector requires exactly one result row and one child-summary row per valid key rather than assuming one-to-one array cardinality.

The real local Pi JSONL contained two workflow publications with two unique exact `workflowKey`/`childId` matches each. The later publication’s result rows carried `progressSummary.durationMs`, `progressSummary.toolCount`, and usage/cost; corresponding workflow child summaries carried the producer-required parent tool-call ID, workflow state, complete-inventory flag, identity, run ID, agent, and child state, but no effort or usage. Result rows had an explicit `index` but no own run ID. The 85-character workflow container run ID was below the 128-character bound but rejected by Inspector’s allowed-character grammar because it contained `%`; this prevented the result rows’ fallback identities, not the exact child-key evidence. The workflow child rows retained their own accepted run IDs.

The producer v1 parser requires child `childId` and `state`; `runId`, `agent`, and other descriptive child fields are optional bounded metadata. The real values above are observations, not additional correlation requirements.

Adapter attribution requires the supported version-1 summary envelope, including `inventoryComplete: true`, recognized workflow state and fields, bounded producer IDs, supported child rows, and arrays within bounds. `mode` must be `"workflow"` and `workflowRunId` must exactly equal `details.runId`; `parentToolCallId` is validated but not compared with the current tool-call ID because async publication can differ. Within one result, bounded `workflowKey` values must exactly match unique `childId` values. Missing, mismatched, or duplicate keys withhold only that key; unrelated exact keys remain eligible. Unsupported summary or child shapes produce no correlation. No effort is inferred from child summaries, and the adapter never correlates by index, order, agent, task, timestamp, or fuzzy run ID. Existing workflow/result `AgentRun` identities and statuses remain separate and unchanged; child usage remains non-additive. No producer identifiers, prompts, outputs, or raw session entries are recorded here.

This observation does not revise the 0.70.1 declaration map or infer that older producer versions publish the same fields. That historical evidence remains unchanged.

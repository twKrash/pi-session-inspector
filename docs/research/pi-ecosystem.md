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
| pi-subagents | `0.59.0` verified installed (UAT evidence source); integrity `sha512-EOzArN0fU3AUQT+bjtq/8DfW8nSySTV43Qw97QFyChYBFX+GfmO3b7CgtelUfBqfg4gYmcq50B4MguAExIYM1g==`; `gitHead 45c0b41`; latest published `0.67.0` | `details.completions[]` (`WaitCompletion`: `runId`, `agent`, `success`, `usage{input,output,cacheRead,cacheWrite,cost,turns}`, `artifactPaths`, `sessionFile`, `archivePath`), `details.results[]` (`subagent`: `index`, `runId`, `agent`, `usage`), `foreground-history.json`, `output-archives/<runId>.json`; [observability](https://github.com/nicobailon/pi-subagents/blob/45c0b41/docs/observability.md) |
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

- `details.completions[]` on `subagent_wait` results (`WaitCompletion`): `runId`, `agent`, `success`, `usage{input,output,cacheRead,cacheWrite,cost,turns}`, `artifactPaths`, `sessionFile`, `archivePath`.
- `details.results[]` on `subagent` results: `index`, `runId`, `agent`, `usage`; `workflowChildren{version,inventoryComplete}` for workflow fan-out.
- `foreground-history.json` `{version:1, runs:[{runId,mode,cwd,sessionId,updatedAt,children[]}]}`.
- `completion-replay/<runId>.json` `{version:1, runId, sessionId, completedAt, expiresAt, archivePath, completion}`.
- `output-archives/<runId>.json` `{version:1, runId, createdAt, entries:[{agent,resultIndex,source,path}]}`.

`details.completions[]` is the only verified `archivePath` publisher, so Inspector follows archive references from that surface only and validates them as a bounded presence/identity reference (plain `version: 1` object whose `runId` equals the referencing run id); the archive body beyond that verdict is ignored. Unknown `details` fields are ignored and unknown status vocabulary maps to `unknown`, never guessed.

Real-session evidence used for UAT: 174 `subagent` and 46 `subagent_wait` tool results with populated `details`. Fixture provenance for `tests/fixtures/pi/0.85.1/{ponytail-caveman,error-message,subagent-tool-results}.jsonl` and `tests/fixtures/integrations/*` records producer name, version, integrity, symbol/field, and that the content is synthetic.

## Item 13 evidence audit (13A, 2026-09-22)

This is a research-only addendum for the subagent run outcome/effort follow-up. It does not change `AgentRun.status` or `confidence`, and it does not define the 13B DTO. The checked-in fixture `tests/fixtures/pi/0.85.1/subagent-agent-run-effort-audit.jsonl` is synthetic and sanitized: Pi session format is pinned to `0.85.1`; producer observations are labelled independently as `pi-subagents` `0.70.1` (current local declaration) and `0.59.0` (historical comparison row). IDs and labels are bounded placeholders, content is empty, and no task text, output, arguments, paths, secrets, raw errors, archive bodies, or `toolCalls[]` are present.

| Candidate fact | Coverage | Producer field / persisted surface | Stable identity and privacy treatment | Exact limitation / 13B boundary |
| --- | --- | --- | --- | --- |
| Foreground container identity | supported · Lane A | `Details.runId` on the foreground `subagent` tool-result `details` object in Pi JSONL | opaque bounded container digest | identifies the foreground run/container, not a child; do not equate it to any completion ID |
| Foreground child identity | supported · Lane A | `SingleResult.index` in foreground `details.results[]`, paired with `Details.runId` | `(Details.runId, index)` is the stable child key | no row-level foreground `runId` is asserted; no branch inferred from position or adjacency |
| Completion identity | supported · Lane A | `WaitCompletion.runId` in `details.completions[]`; nested `WaitCompletionChild.runId` in each completion's `results[]` | completion and nested-child IDs remain separate opaque digests | completion IDs are not foreground child IDs |
| Cross-surface correlation | unavailable · Lane A | foreground `details.runId`/`results[].index` and completion `runId` fields are separate persisted surfaces | no cross-surface key is retained | equal strings, container IDs, timestamp, agent, task, array position, publication order, or adjacency never join surfaces; only a producer-proven shared child ID could correlate them |
| Repeated publication | partial · Lane A | later observations on the same proven producer run identity | replace/select only observations sharing that identity | no blanket foreground/completion replacement and no matching by container ID |
| Terminal outcome | partial · Lane A/B | foreground declared `exitCode`, `processSignal`, `outputState` plus retained dynamic `state`/`success`; completion `state`/`success` on their own surfaces | bounded execution outcome, not semantic task success | foreground `state`/`success` are Lane B compatibility-only; `WaitCompletion.success` and `WaitCompletionChild.success` are Lane A and are not unified |
| Cancellation | unavailable · Lane A/C | no distinct persisted producer cancellation contract; fixture `auditOnly` annotation is synthetic | no cancellation enum is published | do not collapse interruption, timeout, or stop into generic cancellation |
| `durationMs` | partial · Lane A | final foreground `details.results[].progressSummary.durationMs` in Pi JSONL | bounded non-negative producer value | retained progress summary proves final foreground results only; never infer from `observedAt` or timestamps; other surfaces unavailable |
| `toolCount` | partial · Lane A | final foreground `details.results[].progressSummary.toolCount` in Pi JSONL | bounded producer value | never derive from `toolCalls[]` length; other surfaces unavailable |
| `turnCount` | unavailable · Lane A | live construction only (`progress.turnCount`); final foreground compaction strips `progress`, and `ProgressSummary` has no `turnCount` | no stable final publication | do not infer from timestamps, tool calls, or `usage.turns` |
| `usage.turns` / generations | supported / unavailable · Lane A | bounded `usage.turns` where persisted in foreground or completion usage groups | usage metadata only | `usage.turns` is not `turnCount` and does not prove native generations |
| Per-run error count | unavailable · Lane A | no explicit attributable count on persisted foreground/completion surfaces | never derive from aggregate tool-result errors | aggregate counts do not qualify |
| Usage | partial · Lane A | validated usage groups in foreground `results[]`, `completions[]`, nested completion results, and explicitly supplied workflow children | bounded numeric fields; child breakdown is non-additive | malformed/partial groups remain partial or unavailable; child usage is never added to native usage |
| Cost | partial · Lane A | `usage.cost` in a validated persisted usage group | bounded producer value | never synthesize from time or missing tokens |

### Evidence matrix

Coverage labels describe the persisted evidence available to Inspector: `supported` means the bounded field is present on a proven publication surface; `partial` means only some surfaces/states are proven; `unavailable` means no persisted publication proof exists. The evidence is kept in three lanes: **A — declared producer contract** (the pinned `0.70.1` declarations and producer construction), **B — dynamic compatibility evidence** (persisted fields Inspector accepts but which are not declared `SingleResult` fields), and **C — synthetic audit-only metadata** (fixture annotations outside parser publication arrays). Lane B does not establish new 13B semantics; lane C is parser-invisible.

| Candidate fact | Coverage | Producer field / persisted surface | Stable identity and privacy treatment | Exact limitation / 13B boundary |
| --- | --- | --- | --- | --- |
| Terminal success/failure/interruption | partial | A: declared `exitCode`, `processSignal`, `outputState`, `interrupted`, `timedOut`, and `stopped` on foreground `SingleResult`; A: child `success` on nested completion results; B: foreground dynamic `state`/`success`; A: outer `WaitCompletion.success` | bounded execution outcome only; raw errors are discarded | lifecycle flags remain separate through final compaction and persisted foreground `details.results[]`; cancellation remains unavailable |
| Failure class | supported | A/B: bounded `exit-nonzero`, `process-signal`, `completion-failed`, `output-absent` from published fields | enum only; raw producer `error` is discarded | no raw error text; a terminal producer state is not a quality judgement |
| Per-run error count | unavailable | no explicit bounded attributable count in the checked surfaces | never derived from aggregate parent tool-result failures | aggregate failure counts do not qualify |
| `durationMs` | partial | A: producer constructs `progress.durationMs` and terminal `progressSummary.durationMs`; pinned foreground final compaction retains `progressSummary` in `subagent` `details.results[]` | bounded non-negative number; no timestamp or live-state joins | proven for final foreground `results[]` terminal/failure/interruption paths; not proven for `subagent_wait` `completions[]`, nested completion results, or workflow summaries; never infer from timestamps |
| `toolCount` | partial | A: producer constructs `progress.toolCount`; pinned foreground final compaction retains terminal `progressSummary.toolCount` in `subagent` `details.results[]` | bounded number; never derived from `toolCalls[].length` | proven for final foreground `results[]` terminal/failure/interruption paths; unavailable on unproven wait/nested/workflow surfaces |
| `turnCount` | unavailable | A: live construction sets `progress.turnCount = result.usage.turns`; final `progress` is stripped and `ProgressSummary` declares no `turnCount` | producer construction only; no persisted turn count | do not infer from timestamps, tool calls, or `usage.turns`; native generations remain unavailable; no stable final publication proof |
| `usage.turns` | supported | A: bounded `usage.turns` in persisted `results[]`/nested completion results where usage is present; B: compatibility rows only where accepted outside the declared surface | bounded number; no content | usage metadata only, never native generation count or `turnCount`; malformed/missing usage is unavailable |
| Usage | partial | complete child `usage` groups from `results[]`, `completions[]`, and workflow children | opaque run digest; bounded numeric fields | malformed/partial groups remain partial or unavailable; no additive parent total |
| Cost | partial | `usage.cost` within a validated usage group | bounded numeric value | producer cost only; never synthesized from time or missing tokens |
| Nested identity | partial | foreground `details.runId` + `results[].index`; completion `runId`; workflow `children[]` public index/run ID | each surface retains its own opaque identity; foreground key is `(container,index)` | no branch, cross-surface join, or parent inferred from adjacency |
| Repeated publication | partial | later observation for the same proven producer run identity | same session-scoped opaque digest | replace/select only that producer identity; never join or replace foreground and completion observations by equal container IDs |
| Native-vs-child accounting | supported | child usage is emitted as `child-breakdown` with `contributesToSession: false` | child row remains separately labelled | child usage is never added to native tool-result usage |
| Archive reference | partial | `completions[].archivePath` presence validation | only `available`/`missing` verdict is retained | archive contents, path, and raw reference are never retained |
| Running/incomplete publication | supported | `state`/bounded output state without terminal evidence | same opaque run digest | remains running/incomplete; no duration or outcome inferred |
| Malformed publication | supported | missing/invalid `details`, invalid arrays, or invalid numeric groups | no producer payload copied | degrades to `unavailable`, never guessed |
| Producer version | supported for provenance | fixture metadata/row `producerVersion`; public declarations | version is provenance, not a run metric | `0.59.0` historical evidence and `0.70.1` current observation are separate; neither rewrites the other |

### Version-scoped producer contract (13B input)

The following is the `pi-subagents` `0.70.1` declaration-level map, pinned to gitHead [`1ac7b5e2652e9571164847ac2905ab4aded92791`](https://github.com/nicobailon/pi-subagents/tree/1ac7b5e2652e9571164847ac2905ab4aded92791), tarball [`pi-subagents-0.70.1.tgz`](https://registry.npmjs.org/pi-subagents/-/pi-subagents-0.70.1.tgz), integrity `sha512-cWNjguyrTfx6VmFzD+jCWIzJK3mBL5zjAhw5Z1E+5I3Iq5O2gCSmM0DphGDY6fh9w7eUewH1OR6Vsi/+Uje6oQ==`. Declaration evidence is `src/shared/types.d.ts` from that tarball: `SingleResult` lines 1099–1160, `WaitCompletionChild` lines 1205–1222, `WaitCompletion` lines 1227–1238, `Details` lines 1296–1312, and `WorkflowChildSummary` lines 167–184. It is deliberately separate from historical `0.59.0` and the Pi/session `0.85.1` pin. The fixture is a persisted Pi v3 session surface; each row carries `producerVersion` solely as provenance.

The fixture uses these bounded status/error fields: `state`, `success`, `exitCode`, `processSignal`, `outputState`, `interrupted`, `timedOut`, and `stopped`. `exitCode`, `processSignal`, `outputState`, `interrupted`, `timedOut`, and `stopped` are declared on `SingleResult`; `success` and `outputState` are declared on `WaitCompletionChild`; `state`, `success`, and `archivePath` are declared on `WaitCompletion`; `Details.results` and `Details.completions` are declared publication arrays; and `WorkflowChildSummary.children` declares child identity/state but no usage. Foreground `state`/`success` remain dynamic Lane B compatibility fields, while outer `WaitCompletion.success` and `WaitCompletionChild.success` are Lane A and retain separate semantics. No `ArchiveReference` declaration is asserted: `archivePath` is `WaitCompletion.archivePath`, reduced to the bounded available/missing verdict.

| Public declaration symbol | Exact field path | Persisted publication surface | Declaration / dynamic distinction | 13B coverage |
| --- | --- | --- | --- | --- |
| `SingleResult` | `details.runId`; `details.results[].index`, `.agent`, `.exitCode`, `.processSignal`, `.usage`, `.outputState`, `.interrupted`, `.timedOut`, `.stopped` | foreground `subagent` tool-result `details` and its `results[]` in Pi JSONL | `details.runId` is the foreground container identity; `results[].index` supplies child identity within it. Final `compactForegroundResult` spreads the result, strips task/messages/progress/toolCalls, and retains lifecycle flags plus `progressSummary`. | supported for identity/lifecycle/usage when persisted; effort is partial on final foreground results; no cross-surface completion join |
| `WaitCompletion` | `details.completions[].runId`, `.state`, `.success`, `.archivePath`, `.results` | `subagent_wait` tool-result `details.completions[]` | `runId`, `state`, `success`, and `archivePath` are declared Lane A; nested child fields use `WaitCompletionChild` | supported for terminal state and same-surface replacement usage; cancellation unavailable |
| `WaitCompletionChild` | `details.completions[].results[].runId`, `.agent`, `.success`, `.usage`, `.outputState` | nested completion `results[]` | listed fields are declared; no `state`, `exitCode`, or `processSignal` declaration | supported for nested identity/usage; bounded output state only |
| `Details` | `details.results`, `.completions` | tool-result `details` object | both publication arrays are declared; malformed/missing values remain unavailable | supported publication join |
| `WorkflowChildSummary` | `details.workflowChildren.children[].childId`, `.runId`, `.agent`, `.state` | workflow publication `details.workflowChildren.children[]` | declaration supplies identity/state only, not usage; fixture usage is dynamic Inspector-accepted evidence | partial: child identity/state; usage only when explicitly supplied by producer surface |

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

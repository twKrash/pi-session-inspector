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
| pi-subagents | `0.66.0`; integrity `sha512-PfvGutk0QJ2Ps0lC/a9L5T9n3RCo7w7Nt0hXg08cbj9uyUEwdrWRCYEpfZ2jMTC/1sOUpnCrVZF/669Qeek0lw==`; [`0fc0eeb`](https://github.com/nicobailon/pi-subagents/tree/0fc0eebb9604970c506708b7508d6aa38921fde2) | [extension API](https://github.com/nicobailon/pi-subagents/blob/0fc0eebb9604970c506708b7508d6aa38921fde2/docs/extension-api.md), [observability](https://github.com/nicobailon/pi-subagents/blob/0fc0eebb9604970c506708b7508d6aa38921fde2/docs/observability.md) |
| Permission System | `@gotgenes/pi-permission-system@31.1.2`; integrity `sha512-T5ZLLnPCGye/8Fw4gVHfhrrParecwXWSNSS68a0KlAQawTLR1K78UkJPDa9u/nx5ioeqEFqHWDzQMnoMqII6GQ==`; [`085c241`](https://github.com/gotgenes/pi-packages/tree/085c24109e011f86f52c090ce57143153c6fe726/packages/pi-permission-system) | `src/service/permission-events.ts` |
| RTK optimizer | `pi-rtk-optimizer@0.9.0`; integrity `sha512-yj5DEdutRco5WvYEMEO0krZJP5Z6CpuNZoxlXSGmHEi2srB5Gao1xah/RnmVDn2se1FcqlmtS8+K/nzzkq0Pug==`; [`d155d25`](https://github.com/MasuRii/pi-rtk-optimizer/tree/d155d253cb2f1358e34e717d47a82ebccb08cb8e) | `src/{index,output-compactor,output-metrics}.ts` |
| Context Mode | `context-mode@1.0.169`; integrity `sha512-94JIaFuLjF9SO2BsGTrbGtyT44K95+9OC8BdbaL/UT76xOkanJLfUR5CzmNw+GELXZQqH4nBrKg9wjBnSFkVnQ==`; [`589d821`](https://github.com/mksglu/context-mode/tree/589d8214d56740a28b5f7bf63167743d586b0b40) | package tool registration; `skills/context-mode/SKILL.md` |
| Lens | `pi-lens@4.1.4`; integrity `sha512-CVTjvRdbTJoQy5cGVEKg6Q+tFdGvjZd7WsKSkXlsw/FKOCZ/DR55TTa7R2lyRDR8eTa3liF5yEGKY1n9H4RuNA==`; [`7a26192`](https://github.com/apmantza/pi-lens/tree/7a261926b8ec6aeaf473f1fdbff9d58cc8be0f68) | `docs/public-api-stability.md`; documented `pilens:*` events |
| Caveman / Ponytail | Caveman `1.0.8`, integrity `sha512-N0F/Ui86dEtKzoAnRpe+9t4AXsv9cshTGBFwbDf7aiiE1C5iQ8QrZuszdc/yX9FWNUP0pzSZX/M/zWynngnGQw==`, [`eb48fc0`](https://github.com/jonjonrankin/pi-caveman/tree/eb48fc0204e6fda9d83da981913459ed5d0f8746); Ponytail [`974d940`](https://github.com/DietrichGebert/ponytail/tree/974d940a1c5344210874150b98ff0d2c861fab6a) | `extensions/caveman.ts`; `pi-extension/index.js` |
| Hermes (future) | [`94ff4fe`](https://github.com/NousResearch/hermes-agent/tree/94ff4fe8f969db6227adf3b8ab5c2a9cd0920295) | [hooks](https://github.com/NousResearch/hermes-agent/blob/94ff4fe8f969db6227adf3b8ab5c2a9cd0920295/website/docs/user-guide/features/hooks.md), [plugins](https://github.com/NousResearch/hermes-agent/blob/94ff4fe8f969db6227adf3b8ab5c2a9cd0920295/website/docs/user-guide/features/plugins.md), [observability](https://github.com/NousResearch/hermes-agent/blob/94ff4fe8f969db6227adf3b8ab5c2a9cd0920295/docs/observability/README.md) |

Before implementation, pin source **line ranges** from the downloaded tarballs in fixtures. GitHub line numbers move with formatting even at a commit; symbols plus tarball integrity are reproducible.

## Answers to required research questions

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
| 20 | What Ponytail/Caveman data is passive? | Pi custom entries `ponytail-mode` and `caveman-level` preserve mode changes. Exact active duration after crash is inferred only. | Pinned extensions; pinned |
| 21 | What Lens data is passive? | Generic tool calls are native. Versioned `pilens:*` public events can enrich diagnostics when supported; richer Lens view is v1.x. | Lens public API doc; documented |
| 22 | Is Hermes in v1? | No. Its session/request/tool/skill/approval/subagent observer vocabulary maps to canonical records later. | Hermes hooks; documented |
| 23 | What competing projects already solve? | `pi-stats-ext`, Radian and token stats cover usage; `@ygncode/pi-insights` covers HTML; tracing/OTEL packages cover payload tracing/export. Inspector differentiates with branch-correct, confidence-aware, crash-safe local reconstruction. | Ecosystem survey; observed |
| 24 | What storage design meets crash/concurrency constraints? | Pi source + append-only per-writer WAL, maintenance lease, atomic checkpoint, replay/reconcile, 14-day sealed hot retention. No daemon/SQLite. | Derived design from answers 5, 9–12 |
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
- Revalidate package versions, Pi API surfaces, npm name availability, trusted publishing rules, and current Hermes API at release time.

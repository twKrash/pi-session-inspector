# Changelog

All notable changes will follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.1]

### Changed

- Legacy shards with no usable owner record (missing, empty, or unparseable `.owner`) are no longer unconditionally unprunable. They may expire once their segment mtime precedes the cutoff day and its exact size, mtime, device and inode are re-verified immediately before unlink, so a delayed append or path swap aborts the deletion. A live owner PID, an `ESRCH`-only death proof, and a genuinely unreadable owner record all keep preserving detail.
- ADR 0012 and the spec retention paragraph now describe exactly what the code guarantees, including the residual non-atomic window between the final recheck and unlink.

### Added

- Crash-injection tests for every seal phase (interrupted validation, mid-stream validation failure, checkpoint-publication failure, unlink failure, orphaned closed marker, repeated maintenance passes) and an end-to-end cold-detail notice test asserting the state reaches the DTO, JSON and the embedded HTML report data.

## [0.6.0]

### Added

- Usage composition now reconciles visibly: total usage equals generations + tool results + compactions + branch summaries, each shown as its own component so the gap against the Models summary is explained rather than implied.
- Per-usage input, output, cache-read and cache-write token fields (absent when Pi did not persist them) and correct labeling instead of presenting the total as "Input".
- Bounded error evidence (allowlisted kinds only, never raw messages) so the Errors tab reports real rows.
- Session-span duration from native first/last records plus per-tool duration when the DTO provides it; otherwise explicitly unavailable. Anonymous live WAL timings are never guessed into per-record durations.
- Context Mode integration evidence from `ctx_*` tool calls, counted once when also observed through custom entries.
- Daily activity line chart for current, history and global reports, with daily rows computed in TypeScript rather than in browser JavaScript.
- History drill-down from the session table into the shared detail sections, and a shared `LedgerItem` projection consumed by both TUI and HTML.

### Changed

- HTML ledger renders the shared core ledger projection verbatim instead of re-deriving rows in the browser.
- "Evidence, not estimates" is driven by real evidence state for every report kind.
- Tool usage distinguishes observed values, observed zero and missing evidence: missing now renders Unavailable instead of 0.
- The tools, models, agents, errors, integrations and ledger tabs render real data; commands and skills state explicitly that no Pi-persisted evidence exists.
- Filters (7D/14D/30D/custom) apply to the chart, totals and history table, and scroll position is preserved across re-renders.
- Usage arithmetic is bounded: out-of-range or non-finite inputs are treated as invalid rather than propagated, and duplicate tool results accumulate usage at most once.

### Fixed

- `ctx_*` tool calls no longer leave Context Mode integration evidence empty.
- A tool result without usage no longer fabricates a zero value.

## [0.5.0]

### Added

- M7 sealed-detail retention: versioned contiguous-prefix seal evidence (`sealingVersion: 1`), closed-segment markers, and a strict 14-calendar-day cutoff for detailed Inspector records.
- Daily immutable WAL segment rotation, including clock rollback, with bounded intra-day fragments so large days stay replayable, checkpointable, and prunable.
- Retention runs incrementally under the maintenance lease on rotation and after startup, independently of full replay budgets; unversioned legacy seals degrade to unavailable instead of guessing.
- Fixed-seed benchmark corpus (10k records, ~100 MiB session, 1,000 checkpoints) with `benchmark:smoke`/`benchmark:release` scripts and published measurements in `docs/benchmarks/m7-baseline.md`.

### Changed

- Missing WAL is authorized only by validated sealed evidence; ordinary checkpoint cursors are no longer deletion authority.
- Cold-detail expiry is preserved across maintenance passes and surfaces as `walDetail: "expired"` in JSON and HTML reports; the current TUI carries the state in its report DTO without a dedicated visible row.
- Stale lease and cache-lock reclamation requires a conclusively dead owner (`ESRCH`) plus an age threshold.

## [0.4.0]

### Added

- M6 self-contained offline HTML and deterministic JSON exports for current, history, and global report DTOs, with cache expiry/size maintenance and argv-safe HTML opening.
- Current command supports HTML/JSON exports with the same bounded public `--subagents-artifact` evidence as TUI; `/ledger` opens directly on the lazy Ledger tab.

### Changed

- History and global reports accept only durable full-tree scope; malformed persisted JSONL is unavailable rather than partially counted.
- Explicit `--output` files are user-owned and are preserved even when written within the generated-report cache.
- Global chart controls expose only backed native daily cost and token data.

## [0.3.0]

### Added

- Current-session commands accept `--subagents-artifact PATH` to read one bounded local public pi-subagents artifact; its path and raw contents are never persisted or rendered, and read failures remain unavailable.

## [0.2.0]

### Added

- Local, versioned evidence adapters for Context Mode, RTK, mode entries, Permission System, public pi-subagents artifacts, and generic Lens tool use.
- Bounded agent and integration report/TUI rows with non-additive child-agent usage breakdown; Pi-native parent usage remains billing authority.
- Current-session full-screen TUI with fixed analytics tabs, active/tree scope selection, narrow-terminal layout, and lazy Ledger materialization.

### Security

- Integration evidence uses no private API or runtime integration import and excludes raw producer content from reports.

### Migration

- 0.2.0 rejects malformed RTK v1 compaction metadata as unsupported instead of reporting zero-filled counters.

### Changed

- Deferred history UI selection and drill-down to the next web UI milestone; the current TUI intentionally covers only the current session.

## [0.1.0]

### Added

- M3 checkpoint, recovery, maintenance lease, and manifest-only history support.
- Per-writer WAL lifecycle timing with clock-rollback-safe recovery.

### Changed

- Released the approved v1 product, research, architecture, and implementation baseline.

## Versioning policy

Before `1.0.0`, a minor release may change public or persisted schemas only with migration support, fixture proof, and a migration note. Security/privacy and data-loss fixes may ship patch releases.

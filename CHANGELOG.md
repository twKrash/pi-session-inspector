# Changelog

All notable changes will follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

# Agent guidance

Read [research](docs/research/pi-ecosystem.md), [spec](docs/specs/pi-session-inspector-v1.md), [implementation plan](docs/plans/pi-session-inspector-v1-implementation.md), and relevant ADRs before modifying code. They are canonical design sources.

## Non-negotiable invariants

1. Pi persisted data is billing/source authority. Never write Pi session JSONL; `appendEntry` tracking marker is sole exception.
2. Inspector is observer-only. Hook/telemetry/storage errors must be swallowed and never alter Pi execution.
3. No prompt, response, raw tool args/results, provider payload, secret, or unbounded/unredacted producer string enters Inspector WAL/report diagnostics. Bounded redacted telemetry state is permitted only by ADR 0010.
4. Native usage is counted once. Child usage is a breakdown, never parent additive total.
5. Active scope is active ancestry after marker; tree scope is all entries after marker. Do not invent branch IDs.
6. One random immutable writer ID owns one exclusive WAL shard. Only maintenance acquires checkpoint lease.
7. TUI/HTML/JSON consume same report DTO. Ledger remains lazy.
8. Unknown formats/integrations degrade to `unsupported`/`unavailable`, never guesses.
9. Versions follow SemVer. Update package version before releasing a new feature.

## Required checks

Run focused tests, typecheck, lint, and `npm pack --dry-run` for packaging changes. Add/update sanitized fixtures for replay, recovery, privacy, and integration changes. Update spec/ADR for architecture boundary changes.

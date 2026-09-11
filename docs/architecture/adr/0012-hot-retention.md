# ADR 0012: maximum 14-day detailed retention

**Status:** accepted.

## Context

Original v1 requirement is a maximum 14-day detailed-data window. Retaining data for 14 inactive days lets a long-running or frequently resumed session keep Inspector detail indefinitely, violating that boundary.

## Decision

Retain Inspector detailed WAL and generated report cache for at most 14 calendar days from record/report creation. Writers rotate dated immutable segments at least daily. Maintenance deletes an expired segment only after validated checkpoint inclusion; checkpoints retain aggregates/cursors, not detailed telemetry. Explicit user-selected exports are outside Inspector cache retention and are warned/user-owned.

## Alternatives considered

- 14 inactive days: rejected; no fixed maximum.
- Delete whole session at day 14: rejected; discards useful aggregate/native replay.
- Keep one mutable WAL and rewrite prefixes: rejected; races concurrent append.

## Consequences

Cold reports may omit expired integration/timing detail but retain aggregate/native facts. Retention tests must prove no Inspector-held detail exceeds cutoff and no valid source is lost.

## M7 sealing protocol and migration

`sealingVersion: 1` plus `sealedWal[writerId]` in schema-v1 checkpoints
certifies a fully validated, contiguous expired writer-sequence prefix. Ordinary
WAL cursors are never missing-detail authority. Pre-protocol, unversioned
`sealedWal` is not authority: replay available WAL, otherwise report unavailable.
There is no guessed migration for already deleted ranges.

A writer exclusively creates `.owner` containing its PID. Before moving to another
dated fragment it publishes `<segment>.closed` containing only `1\n`, after its
last append has completed. It never appends that path again, including on clock
rollback; a new fragment is used. Maintenance requires this marker or a valid
owner PID proven dead by ESRCH. Missing/empty legacy owner, PID reuse, and
indeterminate liveness preserve detail rather than risk deleting an active file.

Maintenance streams and fully validates each candidate's records and contiguous
sequences, selecting prefixes by sequence rather than date/directory order. A
recent or mutable prefix blocks deletion of later expired segments. Under its
lease it rechecks Pi source, publishes the versioned seal atomically, rechecks
source, then unlinks. Published seals never regress, even when unlink throws or
source changes: an interruption may have occurred after deletion. Remaining WAL
can still be replayed; missing sealed detail is explicitly cold. Pi aggregate
validity is separately tied to its source revision; a seal never supplies Pi
billing authority. Repeated maintenance freshly reduces Pi and preserves seals.

Retention is independent of full WAL replay's byte/record budgets. Each writer
pass processes at most 64 segments and normally 64 MiB. A single oversized
immutable legacy segment is streamed to completion with bounded line memory
before publication/deletion; this is a whole-segment soft byte-budget exception,
not a partial-file deletion. Further passes advance the durable prefix. Directory
header scans use bounded memory but work scales with segment count. Corrupt or
partial segments remain unavailable and are not guessed away.

Current and history loaders project validated seals into the renderer-neutral
`SessionReport.walDetail: "expired"` state, including after Pi source changes.
JSON and HTML reports render this state explicitly; the current TUI carries it
in its report DTO without a dedicated visible row. No record payload or
producer diagnostic is copied to the seal or report notice.
Process interruption is covered; power-loss durability/fsync is not promised.

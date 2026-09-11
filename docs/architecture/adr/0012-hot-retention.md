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
rollback; a new fragment is used. Maintenance requires this marker or an owner
PID proven dead by ESRCH, which remain eligible exactly as before. A live owner
PID is always refused. Only `ESRCH` proves death: `EPERM` and every other liveness
probe failure mean the owner may still be running (for example under another OS
user) and are refused. A `.owner` read that fails for any reason other than a
genuinely missing file is likewise refused.

For a legacy shard whose `.owner` record is genuinely missing, empty, or
unparseable, deletion is authorized only by provable file quiescence: the
segment mtime is strictly before the cutoff UTC day, and its exact size, mtime,
device, and inode are re-verified identical immediately before unlink. Device
and inode catch a path swapped for a same-size, same-mtime replacement. This
recheck detects a delayed append or path swap in the overwhelming majority of
cases, but a stat-then-unlink sequence is not atomic, so a write landing inside
that final window can still be lost. If quiescence is not provable, detail is
preserved rather than risk deleting an active or unreadable owner record.

Maintenance streams and fully validates each candidate's records and contiguous
sequences, selecting prefixes by sequence rather than date/directory order. A
recent or mutable prefix blocks deletion of later expired segments. Under its
lease it rechecks Pi source, publishes the versioned seal atomically, rechecks
source, then unlinks. Published seals never regress, even when unlink throws or
source changes: an interruption may have occurred after deletion. A seal covers
only the validated prefix, so publishing a seal and then aborting the unlink is
safe: recovery seeds its cursor from the seal and replays the remaining records
contiguously. Remaining WAL can still be replayed; missing sealed detail is
explicitly cold. Pi aggregate validity is separately tied to its source
revision; a seal never supplies Pi billing authority. Repeated maintenance
freshly reduces Pi and preserves seals.

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
producer diagnostic is copied to the seal or report notice. When all detail for
a session is sealed and pruned, that notice reaches JSON and HTML while native
Pi aggregates, models, and tools stay available and expired live detail is
`unavailable` rather than fabricated as zero.

Deterministic tests inject interruption at every seal phase: before validation,
during streaming validation, after validation before seal publication, after
seal publication before unlink, and after unlink before the `.closed` marker is
removed. Each interruption leaves raw WAL or a validated sealed checkpoint, and
no partial state is treated as authority; repeated passes are idempotent and
never regress a seal. Process interruption is covered; power-loss
durability/fsync is not promised.

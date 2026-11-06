# ADR 0028: explicit child-session replay for persisted async subagents

## Status

Proposed. The producer contract for dedicated child-session ownership and
resume/reuse behavior must be verified before runtime implementation. This ADR
supersedes ADR 0022 only for the historical prohibition on reading explicitly
referenced child Pi session files. All other ADR 0022 decisions remain in force:
exact identity and reconciliation, fail-closed validation, referenced-locator-only
reads, persisted Pi authority, and non-additive child usage.

## Context

Pi session JSONL remains the billing and historical authority (ADR 0002). The
current Inspector adapter can prove async `AgentRun` rows from persisted
launch/completion evidence and can use a referenced lifecycle `status.json` to
enrich current-session reports. That producer directory is temporary, so it is
not a reliable source for history.

A separate durable surface exists: pi-subagents `subagent-notify` entries may
publish `details.runs[]` with an explicit session-file locator (`sessionLabel`
and `sessionValue`). The referenced child Pi JSONL can contain native assistant
usage that is absent from the parent JSONL and may remain after the temporary
lifecycle directory is removed. The producer also documents that the locator
may instead be a share URL or a share error; those are not file references.

The locator is useful but is not, by itself, proof that all usage in the file
belongs to exactly one run. A Pi session header proves its parent session, not
the child run ID or an immutable execution boundary. The producer's fresh-file,
resume, and reuse behavior therefore needs a version-scoped audit before any
child usage is accepted. Existing measurements from one repository are
investigative evidence, not a general coverage guarantee.

## Decision

- **Use explicit Pi session files as a durable source, conditionally.** A future
  bounded L0 reader may replay a child Pi session file only when a supported
  producer contract establishes that the published locator belongs to one
  dedicated child execution. It must not require the temporary `asyncDir` to
  exist. The parent session remains the source of the `AgentRun`; child-file
  evidence only enriches an already-proven row and never creates a row.
- **Require exact persisted identity and a closed locator contract.** The reader
  requires a proven single async launch and an exact `runId` match in a
  `subagent-notify` entry from the same parent session. It accepts only the
  documented session-file label and a bounded absolute local path. URLs, share
  errors, free text, inferred paths, filename conventions, scans, and
  `workflowRunId`/workflow-child locators are rejected. Repeated run IDs,
  conflicting locators, a child file claimed by more than one run, and known
  reused/forked sessions without a verified execution boundary are withheld.
- **Validate the referenced file before parsing.** Require a normalized `.jsonl`
  path in the same session directory as the parent, not the parent file itself;
  reject symlinked path components and non-regular files; open without following
  links; enforce bounded file size, entry count, and aggregate history-read
  budgets; and swallow every I/O/parse failure. Require a supported Pi session
  header whose `parentSession` exactly equals the parent session-file path. This
  proves parentage only; the run-to-file binding still depends on the audited
  producer contract and exact persisted notification.
- **Reuse native Pi semantics without changing accounting.** Parse only bounded
  native metadata and usage. Preserve missingness; never infer cost from model
  prices, execution duration from transcript timestamps, outcome from file
  existence, or generations from usage turns. A singular model is exposed only
  when unambiguous. Persisted producer facts retain their existing per-field
  precedence. Child usage remains a non-additive breakdown and never changes
  native parent/session/model/history/global totals.
- **Keep current and historical projections consistent.** The durable reader
  belongs to the shared evidence path used by current and history reports. It
  must not be enabled by calling a wrapper that also reads current-only
  lifecycle or foreground artifacts. The existing validated v3 `status.json`
  reader remains current-session-only; workflow children and runs without an
  eligible explicit child-session file remain `unavailable`.
- **No Inspector persistence in this design.** The child file is already a Pi
  source. This ADR adds no WAL envelope, checkpoint table, retained aggregate,
  lifecycle capture, retention exception, or Pi session write. Paths and child
  file contents remain private to L0 and never enter WAL, reports, or
  diagnostics. All read failures degrade to unavailable and cannot affect Pi.

## Alternatives considered

- **Freeze live lifecycle snapshots in Inspector WAL/checkpoints:** deferred.
  It duplicates Pi-owned usage, cannot repair sessions recorded before capture,
  adds retention and privacy state, and does not cover workflow children under
  the existing single-run artifact gate. Reconsider only for specific
  non-reconstructable facts after durable replay is measured.
- **Read temporary `asyncDir/status.json` from history:** rejected. It is
  temporary and mutable; the existing current-only gate remains unchanged.
- **Derive a child path or `_meta.json` path from a run ID:** rejected by ADR
  0022; run IDs do not authorize path construction or scanning.
- **Parse notification prose or use a share URL/error as a path:** rejected;
  content is not a structured usage contract and a locator must be a local
  session file.
- **Write child summaries into Pi JSONL or Inspector storage:** rejected for
  this slice. Inspector cannot write Pi JSONL, and no Inspector-side copy is
  needed when the explicit durable Pi file is valid.

## Consequences

- Eligible completed single async runs may gain native model/usage details in
  history even when Inspector did not observe execution and the temporary run
  directory is gone. Existing sessions without a structured notice, workflow
  child runs without an explicit child-session locator, unsafe files, and
  unverified reused execution files remain unavailable.
- The version-scoped producer audit must establish locator stability and
  dedicated execution ownership across fresh runs, resume, and fork/reuse before
  implementation accepts totals. If it cannot, the reader must fail closed;
  this ADR does not permit estimating a per-run cutoff from notification time.
- History reads require deterministic, request-scoped deduplication and bounded
  concurrency/bytes. No recursive child-of-child replay is allowed.
- Sanitized fixtures must cover valid parent linkage, wrong/missing parent,
  malformed or unsupported Pi sessions, share URL/error labels, duplicate and
  conflicting run/file references, reused files, unsafe paths/symlinks,
  oversized input, privacy, and unchanged native totals.

## Open questions

1. Does each supported plain-async `sessionFile` identify a fresh, dedicated
   child execution, and how do resume/fork/reuse affect that file? Audit the
   pinned producer contract and implementation; do not infer the answer from
   path shape or a session header.
2. What bounded file, line, concurrency, and per-history budgets fit existing
   parser and loader limits?
3. Which native child fields can be projected without treating missing usage
   as zero or conflating nested child accounting?

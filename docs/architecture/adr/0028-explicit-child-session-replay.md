# ADR 0028: explicit child-session replay for persisted async subagents

## Status

Accepted (design approved by the maintainer 2026-11-07), with the producer
audit recorded below. This ADR supersedes ADR 0022 only for the historical
prohibition on reading explicitly referenced child Pi session files. All other
ADR 0022 decisions remain in force: exact identity and reconciliation,
fail-closed validation, referenced-locator-only reads, persisted Pi authority,
and non-additive child usage.

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
the child run ID or an immutable execution boundary.

### Producer audit (pi-subagents 0.86.0)

Audited in source and against 141 distinct locators in one repository's
sessions (aggregate counts only):

- A fresh async child gets a new directory-backed Pi session file, unique per
  run, so the common case is dedicated.
- **Resume appends to the same file.** `resume` reopens the recorded
  `sessionFile` and publishes a new run ID with the same path. 14 of 141 paths
  were claimed by more than one run ID. A child can also take follow-up user
  messages: 35 of 141 files hold more than one user message, 21 of them under a
  single run ID.
- **`context: "fork"` copies parent history** into a new child file whose header
  still names the parent. The one such file in the sample shared 60 of its 78
  entry ids with its parent.
- The path is absolute in practice but the producer does not guarantee it lies
  under the parent's directory.

Verdict: file ownership is **not guaranteed but is detectable from persisted
data**. Under the rule below, 107 of 141 sampled files qualify; the rest are
withheld, not guessed. Measurements from one repository are investigative
evidence, not a general coverage guarantee.

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
  conflicting locators, and a child file claimed by more than one run in the
  parent session are withheld.
- **Validate the referenced file before parsing.** Require a normalized `.jsonl`
  path beneath the directory the producer names after the parent session file
  (the parent path without `.jsonl`; all 166 sampled locators qualify), never the
  parent file itself;
  reject symlinked path components and non-regular files; open without following
  links; enforce bounded file size, entry count, and aggregate history-read
  budgets; and swallow every I/O/parse failure. Require a supported Pi session
  header whose `parentSession` exactly equals the parent session-file path. This
  proves parentage only; the run-to-file binding comes from the exact persisted
  notification.
- **Dedicated-execution rule (from the audit).** A file is attributed to a run
  only when it holds exactly one user message (resume and follow-ups append
  more), shares no entry id with the parent session (fork inheritance), is a
  linear tree with no compaction or branch summary, and is claimed by exactly
  one run in the parent session. Anything else is `unavailable`; no per-run
  cutoff is invented.
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
- **Layering.** Dependency rules keep integrations away from Pi session sources
  and from the canonical reducer. The bounded reader (path policy, safe file
  read, parse, and the dedicated-execution projection) therefore lives in the
  Pi layer (`src/pi`); the integration only selects locators from the persisted
  notices and merges results, and the composition root injects the reader.
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
- The dedicated-execution rule is checked on every read, so a file that is later
  resumed stops qualifying instead of being counted with the wrong run. The rule
  is re-verified per supported producer version; an unaudited version fails
  closed.
- History reads require deterministic, request-scoped deduplication and bounded
  concurrency/bytes. No recursive child-of-child replay is allowed.
- Sanitized fixtures must cover valid parent linkage, wrong/missing parent,
  malformed or unsupported Pi sessions, share URL/error labels, duplicate and
  conflicting run/file references, reused files, unsafe paths/symlinks,
  oversized input, privacy, and unchanged native totals.

## Resolved during implementation

- **Read budgets.** A session reads at most 64 child files serially, 4 MiB per
  file, 32 MiB in total, in persisted notice order; what is not reached stays
  unavailable. One repository's child files were at most 2.4 MiB (p99 1.7 MiB).
- **Measured cost.** Across 145 sessions of that repository, 125 locators were
  selected and 104 runs projected from 42.2 MiB of child files. Reading,
  parsing, and projecting all of it took 460 ms, against 1410 ms to parse the
  parent sessions; per session p50 11.5 ms, p90 65.6 ms, max 94.6 ms. No cache
  was added. The budgets are a deliberate shortcut and should be revisited if
  History load cost becomes a problem on larger histories.
- **Projected fields.** Tokens and costs sum valid native assistant usage (a
  missing value is partial coverage, never zero); a model is shown only when
  every assistant message reports it; the tool count is distinct native
  tool-call ids. Duration, generations, thinking, and outcome are never derived
  from the file.

## Open questions

1. Can the follow-up-message exclusion be relaxed (a steered child that is
   still one run) without admitting resumed files? Needs a producer-published
   run boundary; until then those runs stay `unavailable`.

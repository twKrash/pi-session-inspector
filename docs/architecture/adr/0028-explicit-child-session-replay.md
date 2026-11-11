# ADR 0028: explicit child-session replay for persisted async and workflow subagents

## Status

Accepted (design approved by the maintainer 2026-11-07), with the producer
audit recorded below. This ADR supersedes ADR 0022 only for the historical
prohibition on reading explicitly referenced child Pi session files. All other
ADR 0022 decisions remain in force: exact identity and reconciliation,
fail-closed validation, referenced-locator-only reads, persisted Pi authority,
and non-additive child usage.

Amended before release (user acceptance of the first build): a **workflow
child** has no published locator, yet its session file sits in the directory the
producer keys by the child's own run id. That path is derivable, and the same
dedicated-execution rule vouches for the file, so workflow children are
followed too (Decision, "Workflow children"). ADR 0022 and ADR 0023 barred
inferred paths to temporary artifacts and scanning; this amendment adds one
durable, confined, self-proving file named by the producer's own directory
keying, and the reasons are recorded under that decision.

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

### Producer audit (pi-subagents 0.86.0, spot-checked on 0.87.0)

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
- **A workflow child publishes no locator.** The parent session persists, per
  workflow, a notice row with `childRuns[]` carrying only `runId`,
  `workflowKey`, `agent`, and `status`: no model, usage, duration, or path. The
  producer keys each child's session directory by that child's run id
  (`sessionRoot = <parent path without .jsonl>/<runId>`, one `run-<index>` per step, index 0
  for a single agent; the source comment: nested resume accepts a session file
  only inside a directory named by that run's id). This was read in the
  installed 0.87.0 source; 0.86.0 was not re-read. Across one machine's 24
  sessions with workflow notices, 117 distinct child run ids had 88 files at
  `<parent path without .jsonl>/<runId>/run-0/session.jsonl`; 83 of those passed the
  dedicated-execution rule and 5 were refused for 2 to 4 user messages (a
  follow-up). The other 29 had no file (pruned, or moved by the producer's `sessionDir` or
  `defaultSessionDir` setting).

An independent review re-read the installed 0.87.0 source and confirmed the
three notice labels, that resume reopens the recorded file under a new run id,
and that a forked child keeps the parent's entry ids; it did not re-run the
measurements.

Verdict: file ownership is **not guaranteed but is detectable from persisted
data**. Under the rule below, 107 of 141 sampled files qualify; the rest are
withheld, not guessed. Measurements from one repository are investigative
evidence, not a general coverage guarantee.

## Decision

- **Use explicit Pi session files as a durable source, conditionally.** A bounded
  L0 reader replays a child Pi session file only when a supported
  producer contract establishes that the published locator belongs to one
  dedicated child execution. It must not require the temporary `asyncDir` to
  exist. The parent session remains the source of the `AgentRun`; child-file
  evidence only enriches an already-proven row and never creates a row.
- **Workflow children (amendment).** A child listed in `childRuns[]` of a
  `subagent-notify` row whose `workflowRunId` equals its `runId`, for a
  workflow whose successful launch result this session persists, is followed at
  `<parent session path without .jsonl>/<childRunId>/run-0/session.jsonl`. The
  child run id must pass the same raw run-id grammar as any run id, so it
  cannot carry a path separator or be `..` as a segment. The derived path goes through the same
  confinement, verification, budgets, and claim rules as a published one: a
  child repeated inside one notice is withheld, and a plain run that publishes
  the same path as a workflow child withholds both. Only the path is derived.
  The file must still prove one dedicated execution (header naming this
  parent, one user message, no entry id shared with the parent, one connected
  chain), and the projection fills only fields no persisted observation of the
  child defines. A custom producer `sessionDir` or `defaultSessionDir`, a
  pruned file, a follow-up,
  or a forked child falls out of those rules and stays `unavailable`.
  **Why this stays within the intent of ADR 0022 and ADR 0023.** ADR 0022
  (referenced-locator-only reads) and ADR 0023 ("no filename is inferred" for
  the temporary `_meta.json`) barred inferred paths for temporary artifacts and
  scanning. This reads one durable Pi session file, named by a directory
  the producer documents as keyed by the run, inside the parent's own
  directory, and the file proves its own parentage and singleness. **Residual:**
  attribution of a workflow child rests on that directory keying instead of a
  path the producer reported for the run, so a producer that changed the keying
  could attribute a file to the wrong child while the header and chain rules
  still passed. A run id that were both a plain async run and a workflow child
  would fill both rows from one file; the producer mints distinct ids, so none
  exists. The producer audit must be repeated when a release is adopted.
  Only `run-0` is read, which is complete for a single-agent child; a child
  that itself ran several steps would be under-reported, and none has been
  seen. Duration is still never derived from the file.
- **Require exact persisted identity and a closed locator contract.** For a
  plain async run the reader requires a proven single async launch and an exact
  `runId` match in a `subagent-notify` entry from the same parent session. It
  accepts only the documented session-file label and a bounded absolute local
  path. URLs, share errors, free text, inferred paths, filename conventions,
  scans, and `workflowRunId` rows as plain async runs are rejected (a workflow
  child follows the amendment above, and only it), yet a workflow row or
  a run whose launch this session does not prove still claims the path it
  publishes, so it keeps every other run from taking that file. A run
  publishing different locators, and a child file claimed by more than one run
  in the parent session, are withheld; a run repeated in a later notice with
  the same path is accepted. A run id repeated inside one notice is
  withheld even when its rows agree (as the status rule does), and its path
  stays claimed so no other run can take it. Selection fails closed past 512
  distinct runs or 512 distinct paths and then withholds every locator, and
  enrichment fails closed past 512 observations and then applies no child
  fill.
- **Validate the referenced file before parsing.** Require a normalized `.jsonl`
  path beneath the directory the producer names after the parent session file
  (the parent path without `.jsonl`; every sampled locator qualifies), never the
  parent file itself;
  reject a symlinked root and non-regular files; open without following the
  final link where the platform provides `O_NOFOLLOW` (not Windows, where the
  lookup below rejects a linked file); then verify the opened descriptor. Only the last path component
  is guarded at open time, so a directory swapped in around the open can
  redirect it, and a second pathname lookup (`realpath`, `lstat`) can be
  answered differently by the same swap, even one swapped back and forth. On
  Linux the check therefore uses the kernel's own record of where the
  descriptor lives (`/proc/self/fd`), which must equal the expected canonical
  path inside the root's real directory, so it has no symlinked component and
  no `(deleted)` suffix; a Linux without procfs fails closed. Node exposes no
  such record elsewhere (macOS, Windows), so there the path is looked up again
  and must equal the expected canonical path and name the opened inode. That
  fallback leaves a back-and-forth swap able to redirect the open, an accepted
  residual: the header, one-user-message, chain, and claim rules are the
  attribution proof and the path check is defense in depth. Enforce a bounded file size, a line
  bound counted before the text is parsed, and aggregate history-read budgets,
  where the bytes the read call returned are spent even if the file is then
  rejected and a file refused before its read costs nothing; and swallow every
  I/O/parse failure.
  A hard link to a file under the directory is indistinguishable from the
  file and is accepted; the header and chain rules below still apply. Require exactly one session
  header (native Pi trusts only the first, so a second rejects the file) of a
  supported version whose `parentSession` exactly equals the parent
  session-file path. This
  proves parentage only; the run-to-file binding comes from the exact persisted
  notification.
- **Dedicated-execution rule (from the audit).** A file is attributed to a run
  only when it holds exactly one user message (resume and follow-ups append
  more), shares no entry id with the parent entries in the replayed scope, that is all
  entries after the tracking marker (fork inheritance), forms
  one connected chain with no compaction or branch summary, and is claimed by
  exactly one run in the parent session. The chain has unique entry ids, one
  root, no branching, and reaches every record, so an orphan, a cycle, or a
  second tree rejects the file. A well-formed record of an extension-defined
  type (for example `context_edit`) takes part in the chain and in the
  inherited-id check; any other record the parser must drop (a non-object
  line, a non-string id, a missing field) rejects the file, because it could
  hide a root, a prompt, or a compaction. So does an entry the parser keeps
  but the graph cannot represent (an empty id, or an id or parent id longer
  than 128 bytes): its usage would count while no chain rule ever saw it. Anything else is `unavailable`; no
  per-run cutoff is invented.
- **Reuse native Pi semantics without changing accounting.** Parse only bounded
  native metadata and usage. Preserve missingness; never infer cost from model
  prices, execution duration from transcript timestamps, outcome from file
  existence, or generations from usage turns. A singular model is exposed only
  when unambiguous. Precedence is per field: the latest persisted observation
  that defines a field decides it, the child file fills only fields no
  persisted observation defines, and in the current view the temporary
  lifecycle artifact then fills only what is still absent while keeping the
  fields the child file supplied. Reconciliation keeps one usage object per
  run, taken from its latest observation, so every observation of an enriched
  run carries the same merged usage; otherwise a later publication with fewer
  fields would erase the fill. Runs without a child file reconcile as before.
  Child usage remains a non-additive breakdown and never changes native
  parent/session/model/history/global totals.
- **Keep current and historical projections consistent.** The durable reader
  belongs to the shared evidence path used by current and history reports. It
  must not be enabled by calling a wrapper that also reads current-only
  lifecycle or foreground artifacts. The existing validated v3 `status.json`
  reader remains current-session-only; runs without an eligible child-session
  file (published, or derived for a workflow child) remain `unavailable`.
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
  0022 for `_meta.json` and for scanning, and still rejected for plain async
  runs, which publish their own path. Accepted only for workflow children, whose
  notice publishes none (see Decision, "Workflow children").
- **Parse notification prose or use a share URL/error as a path:** rejected;
  content is not a structured usage contract and a locator must be a local
  session file.
- **Write child summaries into Pi JSONL or Inspector storage:** rejected for
  this slice. Inspector cannot write Pi JSONL, and no Inspector-side copy is
  needed when the explicit durable Pi file is valid.

## Consequences

- Eligible completed single async runs and workflow children may gain native model/usage details in
  history even when Inspector did not observe execution and the temporary run
  directory is gone. Existing sessions without a structured notice, workflow
  children whose derived file is missing, forked, or followed up, unsafe files,
  and unverified reused execution files remain unavailable.
- The dedicated-execution rule is checked on every read, so a file that is later
  resumed stops qualifying instead of being counted with the wrong run. That
  structural rule is the whole gate: no producer version is persisted in the
  notice or the launch result (the only version in a child file is Pi's own
  session format), so the Inspector cannot tell which pi-subagents release
  wrote a locator. If a release changed resume or fork semantics while keeping
  the same file shape, attribution could be wrong; the rule is built to fail
  closed on the shapes known to be unsafe, and the producer audit above must be repeated
  when a new release is adopted.
- Descriptor verification is strong only on Linux (procfs). On macOS and
  Windows it is a second path lookup plus an inode comparison, which a
  directory swapped back and forth around the open can defeat; a swapped-in
  file still has to carry a header naming this parent and pass every chain
  rule. This was chosen over failing closed there, which would have left those
  platforms with no child-file evidence at all.
- History replays up to 206 sessions at once and each keeps its own budgets.
  At most four child files are read at the same time across all of them, which
  bounds simultaneous buffers; there is no request-wide byte total, so the
  worst case is 206 sessions of 32 MiB each, throttled rather than refused. No
  recursive child-of-child replay is allowed.
- Sanitized fixtures must cover valid parent linkage, wrong/missing parent,
  malformed or unsupported Pi sessions, share URL/error labels, duplicate and
  conflicting run/file references, reused files, unsafe paths/symlinks,
  oversized input, privacy, and unchanged native totals.

## Resolved during implementation

- **Read budgets.** A session reads at most 64 child files serially, 4 MiB and
  10,000 lines per file, 32 MiB in total, in persisted notice order; what is
  not reached stays unavailable. One repository's child files were at most
  2.4 MiB and 478 lines (p99 1.7 MiB and 423 lines). Without the line bound a
  4 MiB file of tiny records took 1.4 s and about 700 MiB to parse.
- **Measured cost.** Across 145 sessions of that repository, 125 locators were
  selected and 104 runs projected from 42.2 MiB of child files. Reading,
  parsing, and projecting all of it took 460 ms, against 1410 ms to parse the
  parent sessions; per session p50 11.5 ms, p90 65.6 ms, max 94.6 ms. No cache
  was added. The budgets are a deliberate shortcut and should be revisited if
  History load cost becomes a problem on larger histories. Following workflow
  children as well (one machine, two project directories, 81 available
  sessions) gave 23 more runs with usage and added roughly 230 to 280 ms to the
  History load of each directory (1.5 to 1.9 s before, 1.8 to 2.2 s after; one
  measurement each).
- **Projected fields.** Tokens and costs sum valid native assistant usage (a
  missing value is partial coverage, never zero); a model is shown only when
  every assistant message reports it; the tool count is distinct native
  tool-call ids. Duration, generations, thinking, and outcome are never derived
  from the file.

## Open questions

1. Can an open descriptor be bound to its path on platforms without procfs
   (`F_GETPATH` on macOS, `GetFinalPathNameByHandle` on Windows)? Node exposes
   neither, so the fallback lookup stays until it does.
2. Should History share a request-wide byte budget across the sessions it
   replays, beyond the four-read concurrency limit? It needs the budget plumbed
   through the history loader.
3. Can the follow-up-message exclusion be relaxed (a steered child that is
   still one run) without admitting resumed files? Needs a producer-published
   run boundary; until then those runs stay `unavailable`.
4. Can a workflow child's duration be shown? Only the workflow container's
   `durationMs` is persisted, and the rule that duration is never derived from
   a child file still applies. A durable per-child duration needs the producer
   to persist one.

# ADR 0028: frozen pi-subagents run evidence

## Status

Proposed (retention, trigger and crash handling decided with the maintainer;
awaiting spec text and implementation). Supersedes the history-read prohibition of
[ADR 0022](0022-pi-subagents-observability-contract-and-reconciliation-boundary.md)
(the "Historical authority" bullet's statement that temporary producer artifacts
are not durable history, and the v1.5.2 "history never reads the temporary
artifact" clause). Every other ADR 0022 decision stays in force: identity and
reconciliation, fail-closed validation, referenced-locator-only reads, and
non-additive child usage. Interacts with
[ADR 0012](0012-hot-retention.md); see Open questions.

## Context

pi-subagents publishes a completed async child's model, tokens, cost, duration,
and tool count only in producer files that Pi's session JSONL does not hold:
the run directory `<tmpdir>/pi-subagents-<scope>/async-subagent-runs/<id>/`
(`status.json`, lifecycle artifact version 3) and the per-child
`subagent-artifacts/<runId>_<agent>_meta.json` file. The run directory is
temporary by design: pi-subagents deletes async run directories after 30 days
(90 for resumable runs) and the OS may clear the temp root sooner.

ADR 0022 therefore lets a *current* report enrich an async run from the
referenced artifact and forbids history from reading it. The consequence,
measured on one maintainer's 511 persisted async launches, is that history can
show model, tokens and cost for none of the runs whose artifacts have been
cleaned (about 96% of them had no run directory left). The persisted
`subagent-notify` entry already resolves status and agent for part of that gap
(spec, plain async notices) but never carries model, tokens or cost.

Pi's session JSONL stays the billing and history authority (ADR 0002) and
Inspector must not write it, so the missing facts cannot be written back there.

## Decision

- **Capture while the run is live, finalize on completion (hybrid).** While the
  session runs and the producer artifact exists, a live Inspector process
  captures a bounded summary of each proven async child into Inspector-owned
  storage. Capture is progressive: a first capture when the launch is proven, a
  refresh at bounded intervals and on persisted lifecycle signals while the
  child runs, and a final capture when the persisted `subagent-notify` entry
  reports the run terminal. A refresh replaces the previous capture for that run,
  so a child that dies leaves its last observed values. History reads the frozen
  summary, never the producer file. This replaces ADR 0022's "history never
  reads" rule; the producer file is read only at capture time.
- **Same trust gate as current enrichment.** Capture reuses ADR 0022's gate
  unchanged: an already-proven persisted async launch, the explicit persisted
  `asyncDir`, lifecycle artifact version 3, `mode: "single"`, exact root `runId`,
  exactly one step, and `status.sessionId` equal to the parent session file. The
  per-child `metadataPath` of ADR 0023 may be used the same way for detached
  foreground children. No scanning, no inferred path, no new locator.
- **Bounded fields only.** A frozen record holds: the private opaque run
  identity, `agent` (existing label bound), `model` and `thinking` (existing
  producer-label bound), terminal outcome (the existing closed mapping),
  `tokens.total`, `costUsd`, `durationMs`, `toolCount`, and the capture time.
  It never holds the task, prompt, output, paths, session labels, or any free
  text (ADR 0010, ADR 0011). A rejected value drops that field, not the record.
- **Evidence, not authority.** A frozen record may enrich an `AgentRun` that
  persisted Pi evidence already proves; it never creates a row, never changes
  native totals, and child usage stays a non-additive breakdown (invariant 4).
  When persisted session evidence and a frozen field disagree, the persisted
  value wins, as in ADR 0022.
- **Capture is best effort and invisible.** Capture runs only in the
  observer path, swallows every error, and never alters Pi or pi-subagents
  execution (invariant 2). A run that completes while Inspector is not
  running, or whose artifact is already gone, stays `unavailable`; history
  never guesses.
- **Idempotent.** For each run the last valid capture wins per field; a
  terminal capture is never replaced by a later non-terminal one.
- **Crashed or abandoned runs.** Outcome comes only from closed producer
  evidence: artifact `state: failed`, a non-zero `exitCode`, a known
  `processSignal`, or the producer's `process-terminal.json` proof. These map
  to the existing `failed`/`interrupted` statuses and show the last captured
  model, tokens, cost and duration with a "captured while running" marker. When
  the last capture is non-terminal and no such evidence exists, the row is
  `incomplete`: it shows the last captured values and the capture time, and is
  never reported as failed. pi-subagents documents that process exit must not
  be inferred from PID disappearance, `endedAt`, result-file existence or lease
  absence, and Inspector follows that rule.

## Alternatives considered

- **Read the producer file from history:** rejected; the file is temporary and
  is gone for most old runs, and it makes reports depend on a mutable external
  file.
- **Derive paths for child sessions or `_meta.json` from the parent session
  path and run id:** rejected; ADR 0022 forbids inferred paths and scanning, and
  coverage is partial (about a quarter of launches had any durable artifact).
- **Write the summary into the Pi session JSONL:** rejected; Inspector is
  observer-only and `appendEntry` is reserved for the tracking marker.
- **Parse the `subagent-notify` content text for usage:** rejected; prose is not
  a contract and the structured details carry no usage.
- **Do nothing:** rejected; model, tokens and cost for async children are
  unrecoverable after the producer cleans up.

## Consequences

- Only runs that complete while Inspector observes the session gain durable
  model/tokens/cost. Already-cleaned runs and sessions recorded without
  Inspector stay `unknown`/`unavailable`. This is stated in the UI coverage
  text, not hidden.
- A new Inspector-owned record kind is needed, with a schema, a per-session row
  cap, validation on read, and tests for corrupt, oversized, duplicate, and
  forged records. Replay must treat a forged record as untrusted input.
- The v1 spec gains a normative section and the privacy tests gain a fixture
  proving no task, path, or free text can enter a frozen record.

## Decisions on the original open questions

1. **Retention (ADR 0012): decided.** Frozen summaries live in the checkpoint
   as a capped, bounded table of retained aggregates, keyed by private opaque
   run identity, with a fixed per-session row cap. ADR 0012 gets a one-line
   clarification that this table is a retained aggregate, not detailed
   telemetry, so the 14-day cutoff does not delete it. Rows past the cap are
   dropped oldest first and the report states the truncation.
2. **Capture trigger: decided.** The persisted `subagent-notify` entry is the
   terminal signal that finalizes a capture. Progressive refreshes while the
   child runs use the validated asyncDir `status.json`. Exact hook (Pi session
   event versus the existing `appendTelemetry` path) is a spec-section detail,
   not an architecture question.
3. **Crash window: decided by the hybrid design.** Progressive capture shrinks
   the loss window to one refresh interval, and the final capture is triggered
   by a persisted entry. Each capture is appended as a WAL envelope first; the
   checkpoint folds it later, so a crash between capture and checkpoint is
   recovered by WAL replay (ADR 0004).

## Open questions

1. Refresh interval and per-session row cap values; pick from measured
   status-file read cost before the spec section is written.
2. Whether a pi-subagents release exposes a stable event for child progress that
   would replace interval refreshes; check on each supported producer version.
3. The exact UI wording for `incomplete` and "captured while running".

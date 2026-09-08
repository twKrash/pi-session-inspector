# Milestone 3: checkpoint, recovery, history

## Scope

Implement derived, local checkpointing and recovery for tracked sessions. Pi JSONL remains authoritative. Inspector never writes Pi data except the existing namespaced tracking marker.

## Data flow

1. A maintenance holder acquires one per-session lease using atomic create/mkdir.
2. It rereads Pi facts and writer WAL shards from recorded cursors.
3. It derives aggregate checkpoint state only: source cursors, WAL cursors, report aggregates, and validation metadata. It stores no prompts, responses, raw tool payloads, provider payloads, secrets, or unbounded strings.
4. It writes a temp checkpoint in the target directory, validates it, atomically renames it, then releases the lease in `finally`.
5. If no valid checkpoint exists, history replay starts from valid durable Pi/WAL data. Checkpoints are optimization only.

## Recovery

- Pending tracking metadata is examined against the native marker. A completed marker promotes pending metadata; otherwise pending state is retained/removed only through explicit safe recovery rules.
- Partial final WAL lines are ignored and produce a bounded diagnostic code.
- Missing, malformed, stale, or cursor-mismatched checkpoints are unavailable and trigger replay; they never overwrite source facts.
- Unmatched live starts remain `running`; only terminal reconciliation may classify them `interrupted`.
- Pi source rewrite/cursor mismatch invalidates only derived checkpoint state.

## Lease

- Lease includes writer/PID/timestamp metadata needed only for bounded maintenance control.
- A contender skips maintenance when lease acquisition fails.
- Stale recovery requires both expiry and dead PID; PID reuse is not treated as dead ownership without matching identity evidence.
- Every lease path releases in `finally`. A late writer cannot replace a checkpoint with newer cursors.

## History/discovery

- Discover only Inspector session manifests/directories. Do not scan all Pi sessions globally.
- Reconcile tracked sessions from their manifest, marker, WAL shards, and checkpoints.
- History exposes unavailable/unsupported state rather than guessing from unknown formats.

## Testing

Fixtures cover partial WAL lines, missing/corrupt/stale checkpoints, Pi rewrites, cursor mismatches, pending-marker crashes, lease contention/stale owner/PID reuse, late writers, and 206 tracked sessions.

## Non-goals

No retention deletion, HTML/TUI, integrations, provider tracing, daemon, SQLite, network service, or private Pi API. Retention/sealing is Milestone 7.

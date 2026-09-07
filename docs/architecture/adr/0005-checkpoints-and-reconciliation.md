# ADR 0005: checkpoints and reconciliation

**Status:** accepted.

## Context

WAL replay must survive crashes, corrupt tails, Pi rewrites, and concurrent Inspector processes without a later maintainer replacing newer aggregate/cursor state.

## Decision

Checkpoint, reconciliation, and retention acquire a short per-session maintenance lease. Holder rereads source/WAL cursors, writes a temp checkpoint in the same directory, validates it, atomically renames it, then releases in `finally`. Invalid checkpoints replay durable input. Unmatched starts remain running while session/writer is active and become interrupted only at terminal reconciliation.

## Alternatives considered

- Lock every WAL append: rejected; violates observer-only hot path.
- Trust last checkpoint blindly: rejected; corrupt/stale cursor loss risk.
- Mark starts interrupted at process observation loss: rejected; would misreport active work.

## Consequences

Maintenance contenders may skip work and replay instead. Tests must cover stale lease recovery, partial records, source mismatch, and late-maintainer cursor regression.

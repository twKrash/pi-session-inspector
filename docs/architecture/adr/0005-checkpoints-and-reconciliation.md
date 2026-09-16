# ADR 0005: checkpoints and reconciliation

**Status:** accepted.

## Context

WAL replay must survive crashes, corrupt tails, Pi rewrites, and concurrent Inspector processes without a later maintainer replacing newer aggregate/cursor state.

## Decision

Checkpoint, reconciliation, and retention acquire a short per-session maintenance lease. Holder rereads source/WAL cursors, writes a temp checkpoint in the same directory, validates it, atomically renames it, then releases in `finally`. The Pi cursor contains its complete-line count plus a lowercase 64-character SHA-256 revision of complete JSONL lines; this bounded fingerprint is the only Pi-content derivative persisted and makes same-count rewrites stale. Checkpoint aggregates are non-negative and bounded by `Number.MAX_SAFE_INTEGER`; token and event totals are safe integers, while cost remains finite. Invalid checkpoints replay durable input. Unmatched starts remain running while session/writer is active and become interrupted only at terminal reconciliation.

## Alternatives considered

- Lock every WAL append: rejected; violates observer-only hot path.
- Trust last checkpoint blindly: rejected; corrupt/stale cursor loss risk.
- Mark starts interrupted at process observation loss: rejected; would misreport active work.

## Consequences

Maintenance contenders may skip work and replay instead. Tests must cover stale lease recovery, partial records, source mismatch, and late-maintainer cursor regression.

Durability scope: the targeted failure is process crash, not power loss. Publication relies on same-directory atomic rename, so a concurrent reader sees either the previous or the new complete checkpoint, never a partial one. Inspector deliberately performs no `fsync` (no file or directory sync): an OS crash or power loss may lose the newest checkpoint or WAL bytes, and the contract there is only that derived state is rebuildable from Pi plus whatever WAL survived. Recovery stays conservative rather than compensating: a declared cursor never moves backwards, a sealed prefix may be accepted as pruned but is never re-folded, re-counted, or invented, and a checkpoint whose retained unsealed WAL is gone is unavailable instead of folded from a shorter tail.

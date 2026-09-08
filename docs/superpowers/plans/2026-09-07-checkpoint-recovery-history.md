# Checkpoint Recovery History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add derived checkpoints, safe recovery, and tracked-session history.

**Architecture:** Pi JSONL and WAL are source facts. Checkpoints are validated atomic derived summaries guarded by a per-session lease; invalid state replays source facts.

**Tech Stack:** Node 22, TypeScript, node:test, node:fs/promises.

**Spec:** `docs/superpowers/specs/2026-09-07-checkpoint-recovery-history-design.md`

## Global Constraints

- Never write Pi session JSONL except existing marker seam.
- Swallow Inspector failures; retain no raw prompts, outputs, tool payloads, secrets, or unbounded strings.
- No dependencies, daemon, SQLite, network, or private Pi APIs.
- Checkpoints are derived and replaceable; native usage remains authoritative.

---

### Task 1: Maintenance lease

**Files:** Create `src/storage/lease.ts`; test `tests/unit/lease.test.ts`.

- [x] Test atomic acquisition, contention skip, expired dead owner recovery, and `finally` release.
- [x] Implement `acquireMaintenanceLease({directory, writerId, now, isPidAlive})` returning `{release(): Promise<void>} | undefined` using atomic mkdir and bounded metadata.
- [x] Run focused tests, full tests, typecheck, lint.

### Task 2: Atomic checkpoint

**Files:** Create `src/storage/checkpoint.ts`; test `tests/unit/checkpoint.test.ts`.

- [x] Test valid temp-write/validate/rename; malformed checkpoint unavailable; newer cursor cannot be replaced by older cursor.
- [x] Implement `writeCheckpoint` and `readCheckpoint` with versioned bounded cursors/aggregates only.
- [x] Run focused tests, full tests, typecheck, lint.

### Task 3: WAL replay recovery

**Files:** Create `src/storage/recovery.ts`; test `tests/unit/recovery.test.ts`.

- [x] Test partial final WAL line ignored, corrupt checkpoint falls back, cursor mismatch invalidates checkpoint, unmatched starts remain running.
- [x] Implement deterministic recovery from valid checkpoint plus WAL; return unavailable rather than guessing unknown formats.
- [x] Run focused tests, full tests, typecheck, lint.

### Task 4: Pending tracking recovery and history

**Files:** Modify `src/storage/tracking.ts`; create `src/storage/history.ts`; test `tests/unit/history.test.ts`.

- [x] Test pending metadata promotion only with native marker evidence; 206-manifest discovery without Pi global scan.
- [x] Implement Inspector-root manifest discovery and pending recovery under lease.
- [x] Run focused tests, full tests, typecheck, lint.

### Task 5: Milestone acceptance

**Files:** Add sanitized fixtures/tests; update implementation progress.

- [x] Test lease contention, stale/PID reuse, late writer cursor, partial/corrupt source, pending crash, and scale discovery.
- [x] Run `npm test`, typecheck, Biome lint/format, `npm pack --dry-run`, and review.
- [ ] Commit and push (intentionally deferred by task instruction).

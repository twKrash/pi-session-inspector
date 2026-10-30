# Live UI Incremental Optimization — Progress Tracker

## Project state

- **Overall status:** IN_PROGRESS — M0 and M1 are DONE and verified; M2 is planned only.
- **Current milestone:** none active. Next authorized milestone is M2, planning-only in this run.
- **Reference implementation commit:** `caebe204eae780775e13e09d757f3cce6d9848e3` (PR #69 design baseline).
- **Baseline implementation commit:** `c344c8d5121034b544514211265abe3a5358e1ee` — the pre-M1 code both benchmark artifacts were measured against/on.
- **Current branch/worktree:** `perf/live-ui-m1` at `/home/dvory/code/pi-session-inspector/.worktrees/live-ui-m1` (M1 changes are uncommitted in the working tree on top of `c344c8d`).
- **Last completed verification:** `npm test` on the M1 working tree — exit 0; 1,271 passed, 1 skipped, 0 failed (20.5 s). `npm run typecheck` clean. `npm run benchmark:live-ui -- --mode=release` wrote `benchmark/baselines/live-ui-m1-request-local.json`.
- **Next concrete action:** commit M1, then write the M2 implementation plan (no M2 code) — see "Next action for M2" at the end of this file.
- **Open blockers:** none for M1. M3 stays blocked on the source-only JSONL invalidation gap (see below).
- **Explicitly deferred:** M2 code; all cross-refresh/persistent caches; incremental aggregation; M3 session report cache; M4 incremental fold; live filesystem watchers/polling/cross-process signals; release/version metadata; unrelated HTML-size optimization.

## Milestones

### M0 — Baseline and instrumentation

- **Status:** DONE.
- **Objective:** Measure a reproducible full UI bundle workload on pre-M1 code and provide safe numeric stage instrumentation.
- **Scope / files:** `src/ui/load-instrumentation.ts`, `src/ui/{bundle,load-current,load-history}.ts`, `benchmark/{corpus,live-ui}.ts`, `package.json` (`benchmark:live-ui`), `tests/unit/{load-instrumentation,benchmark-corpus}.test.ts`, `benchmark/baselines/live-ui-m0-c344c8d.json`.
- **Acceptance criteria and result:** 100 manifest-backed sessions × 40 records (4,000 records, 3,829,684 JSONL bytes) from one fixed-seed generator; four scenarios (warm full load, one-session append, multiple-session update, three concurrent range groups); per-request JSONL read count/bytes, parse and replay counts, p50/p95/max/stdev for wall, load, projection, serialization and diff, stage timings, DTO bytes and heap delta. Instrumentation is optional, numeric-only (stage, durationMs, bytes), swallows observer throws, and a regression test asserts the measured report equals the unmeasured one.
- **Baseline measurements** (`live-ui-m0-c344c8d.json`, release mode, node v24.22.1, linux-x64, 10 samples):
  - warm full load: group wall p50 335.8 ms, load p50 299.9 ms, projection 14.1 ms, serialization 9.0 ms, diff 14.3 ms, DTO 3,524,309 B
  - one-session append: 324.3 / 288.5 ms; multiple-session update: 310.5 / 277.4 ms; three concurrent range groups: group wall p50 741.7 ms
  - **202 JSONL reads and 202 parses per request (7,735,974 bytes read), 100 history replays**
  - heap delta 3.38 MB; peak RSS 171.5 MB
- **Tests / verification:** `npm test` on `c344c8d` — 1,269 passed, 0 failed, 1 skipped; M0 instrumentation tests added and passing.
- **Notes:** the reported 202 reads/7.74 MB in the prior investigation are now instrumented facts, not inference. The earlier 354.4/271.3/308.4/290.6 ms figures are superseded by this artifact.
- **Oracle/reviewer findings:** see the Oracle review section (covers M0+M1).
- **Commit references:** artifact pinned to baseline `c344c8d`.

### M1 — Request-local deduplication

- **Status:** DONE.
- **Objective:** eliminate duplicate current-session parsing between the active/tree views and duplicate history parsing between marker validation and replay, within one bounded bundle load, preserving independent report semantics.
- **Scope / files:** `src/ui/load-current.ts`, `src/ui/bundle.ts`, `src/ui/load-history.ts`, `tests/unit/{load-instrumentation,request-local-dedup}.test.ts`, `benchmark/live-ui.ts` (expectation only).
- **Implementation:**
  - `loadCurrentSessionReports()` reads and parses the current source once, then runs an independent canonical build per scope through the existing `buildCanonicalSession`/`toSessionReport` path. `loadCurrentSessionReport()` keeps its public per-scope contract and now shares the same read/build split.
  - `loadInspectorBundle()` uses the single-read path when it owns the current loader; an injected `loadCurrent` loader keeps its per-scope call contract (tests rely on it).
  - History: `scanHistory` and `loadHistorySessionReport` pass the parse that marker validation already produced and validated (`observeParsedSession`) into `scanDiscoveredSession`. Replay reuses it instead of re-reading; when no validated parse exists (for example the History page, which observes parses for ordering but replays only a bounded page) the original read/parse/validate path runs unchanged.
- **Acceptance criteria and result:** identical canonical reports and identical serialized DTO/ETag versus the per-scope loader path (`request-local-dedup.test.ts`); one current read+parse per bundle; one history read+parse per discovered session; no cross-request state; malformed source still degrades to `session-unreadable`; a later load re-reads and sees the append.
- **Baseline and result** (`live-ui-m1-request-local.json`, same corpus/workload/runtime, 10 samples):

  | Scenario | Wall p50 M0 → M1 | Load p50 M0 → M1 |
  |---|---:|---:|
  | warm full load | 335.8 → 308.3 ms (−8.2%) | 299.9 → 268.7 ms |
  | one-session append | 324.3 → 278.9 ms (−14.0%) | 288.5 → 245.0 ms |
  | multiple-session updates | 310.5 → 277.2 ms (−10.7%) | 277.4 → 242.6 ms |
  | three concurrent range groups | 741.7 → 672.9 ms (−9.3%) | 560.6 → 500.1 ms |

  - **JSONL reads 202 → 101 (−50%), parses 202 → 101 (−50%), bytes read 7,735,974 → 3,867,987 (−50%)**; history replays unchanged at 100.
  - DTO bytes unchanged (3,524,309 / 3,524,920 / 3,525,524) — the dedup changes cost, not output.
  - projection p50 14.1 → 16.7 ms, serialization 9.0 → 8.6 ms, diff 14.3 → 13.9 ms (within run-to-run variance; no code change on those paths).
  - heap delta 3.38 → 3.40 MB (+0.4%, i.e. within noise) — no retained state was added.
- **Tests / verification:** `npm test` 1,271 passed / 1 skipped / 0 failed; `npm run typecheck` clean; focused suites `load-instrumentation`, `request-local-dedup`, `history-reports`, `history-page`, `history-discovery`, `bundle` green.
- **Newly dominant cost:** history discovery plus read/parse of every discovered source (≈150 ms of the ≈270 ms load), and a full bundle re-load per distinct range group (three-range refresh ≈2.7× a single load).
- **Recorded semantics change:** both current views now share one read outcome, so they are all-or-nothing (both available or both unavailable). Previously each scope read independently and a source that became unreadable between the two reads could leave one view available and the other not. The composition root already captured one session snapshot per request (`src/index.ts:1237-1239`), so this matches the request-level contract rather than narrowing it.
- **Request-local snapshot note:** a source rewritten between the discovery read and the replay is not re-read within that same load; the report reflects the bytes that were validated microseconds earlier. This is a single-load snapshot, not a cache, and the next load re-reads. No timestamp/stat check was added because it would trade the saved read for a weaker freshness signal.
- **Commit references:** uncommitted on `perf/live-ui-m1` (base `c344c8d`).
- **Next action:** commit, then M2 planning.

### M2 — One canonical load per refresh pass (planned only in this run)

- **Status:** TODO (planning only; no M2 code is authorized in this run).
- **Objective:** while subscribers on more than one range are attached, compute the range-independent canonical bundle once per refresh pass and derive each range's snapshot as a pure projection of it, preserving per-range ETags, deltas, resync and bounds.
- **Decisive design finding (Oracle, 2026-10-30):** the bundle is *already* range-independent. `loadUi(intent)` (`src/index.ts:1234-1277`) passes no range into `loadInspectorBundle` and the intent only reaches the pure `projectInspectorUi` (`:1276`). M2 therefore touches no bundle/loader/projection file; it is a live-channel pass concern.
- **Scope / expected files (3 production files + tests):**
  - `src/ui/live-channel.ts` — `Context` (`:19-24`) gains the optional pass seam; `refresh()` (`:381-479`) computes the pass source once and projects per group.
  - `src/ui/server.ts` — the parallel `InspectorServerContext` declaration (`:40-53`) moves in lockstep.
  - `src/index.ts` — split `loadUi` into `loadPass()` (flush evidence, capture one session identity, one `loadInspectorBundle`) and `projectPass(source, intent)` (pure `projectInspectorUi`); `loadUi(intent)` becomes `projectPass(await loadPass(), intent)` so HTTP, the ~25 existing `loadUi` test fakes, and the no-seam fallback are unchanged.
  - Tests: `tests/unit/live-channel.test.ts` (+ a pass-seam helper), `tests/unit/index-*.test.ts` as needed.
- **Design constraints (must hold):**
  - The pass source is owned by the refresh-pass object, consumed inside the group loop, and dropped in the existing `finally`. It is never stored in `baselines`/`etagKeys` or any module map — that would be a cross-refresh cache in disguise and would re-open the M3 staleness hole.
  - A subscriber that authenticates or resubscribes mid-pass does **not** join the in-flight pass; `initialize` runs its own full load. Joining could let a stale-ETag resubscribe adopt a bundle that predates the invalidation which triggered the pass and then publish it with a fresh ETag.
  - A range change stays a new baseline key on the next pass; per-range `serializeUiSnapshot` and the `baseEtag`/delta/full-snapshot-resync decision are byte-identical.
  - `invalidationVersion` is sampled once per pass and stamped on every baseline built from it, so an invalidation arriving mid-pass sets `dirty` and yields exactly one follow-up pass.
  - `loadPass()` failure is all-or-nothing per pass (every group in the pass closes 1011, as today's per-group failure does); a per-range projection failure stays bounded to that group. The existing generation/`activeRefresh` guard pattern covers abandonment.
  - Bounds unchanged: 8 sockets, 1 KiB frames, 4 MiB queued per socket; no growth in retained state after the pass ends.
- **Acceptance criteria / proving tests:**
  1. `loadPass` call count is 1 for N distinct range keys in one pass.
  2. Two ranges get different ETags and different DTOs from that one source.
  3. A range added between passes gets its own projection; a stale ETag still receives a full snapshot.
  4. An invalidation during a pass produces exactly one follow-up pass.
  5. A rejected `loadPass` closes every pass group once and recovery works.
  6. Generation bump or `close()` during a pass stores and leaks nothing.
  7. With the seam absent, behavior is exactly today's per-key path.
  8. `projectPass(source, intent)` serializes byte-identically to `projectInspectorUi({bundle, intent})`.
- **Measurement prerequisite:** `benchmark/live-ui.ts` currently issues three `loadInspectorBundle` calls in one `Promise.all` and bypasses `loadUi`, while the channel awaits groups sequentially and includes the evidence flush. A channel-level measurement (real passes, sequential groups, one vs three ranges) must land with M2 so the before/after number is attributable. M2 cannot improve single-range latency; the HTTP-then-subscribe double load and the stale-ETag resubscribe load stay out of scope.
- **Documentation:** an ADR 0027 amendment is required: "one canonical load per refresh pass; ranges are pure projections of it; the shared input is pass-scoped and never reused", explicitly stating the report is still fully recomputed.
- **Dependencies:** committed M1 on an updated `main`; Oracle-reviewed plan above; channel-level measurement.
- **Baseline:** three-range group wall p50 672.9 ms post-M1 (benchmark proxy; true sequential channel cost is ≈3× a single load and is unmeasured).
- **Outstanding risks:** keying the shared bundle; two `Context` declarations plus ~25 test fakes drifting; assuming the concurrent benchmark number generalizes to the sequential channel; projection+serialization+diff becoming ≈30% of a pass afterwards (a new, separate candidate milestone — not M3/M4).
- **Next action:** after M1 lands, write the SDD plan for this seam with the two-phase measurement first.

### M3 — Bounded per-session report cache (deferred; requires new go/no-go)

- **Status:** BLOCKED.
- **Objective:** Consider a bounded report cache only if M1/M2 measurements show persistent replay cost justifies it.
- **Scope / expected files:** not authorized; future design only after separate approval.
- **Dependencies:** M1/M2 results, independent Oracle review, architecture-compatible source and evidence invalidation.
- **Acceptance criteria:** exact source/evidence dependency identity, safe invalidation/fallback, cache/memory and in-flight bounds, cold-restart sufficiency, request consistency, and no new report producer.
- **Baseline and results:** pending.
- **Tests / verification:** not started.
- **Oracle/reviewer findings:** pending.
- **Commit references:** none.
- **Blocker evidence (Oracle, 2026-10-30):** Pi-JSONL mutations with no Inspector WAL flush include (a) Pi core appending messages/tool results to the live session, (b) Pi rewriting/replacing the file on compaction, fork/branch, `/resume` or session replacement (a path change visible only through `sessionManager.getSessionFile()`), (c) external truncation/deletion/edit, (d) Inspector-owned L0 sources changing independently (subagent archives, checkpoint, inventory), (e) the permitted tracking-marker append, and (f) non-source freshness dimensions such as UTC date rollover. A cross-refresh cache would make an ETag self-consistent but wrong, which disables the one recovery mechanism the design has (`diffUiSnapshot` yields no delta and the stale-ETag resync never fires).
- **Outstanding risks / blocker:** `SessionInvalidationSignal` fires only after successful Inspector WAL flush. A source-only Pi JSONL append/replacement/truncation without such a flush may not signal; a cross-refresh cache can therefore serve stale data. No filesystem watcher, polling, or cross-process substitute is accepted by ADR 0027.
- **Next action:** keep blocked until a complete architecture-compatible freshness/invalidation or reliable fallback design is approved.

### M4 — Incremental aggregation (deferred; requires measured bottleneck)

- **Status:** DEFERRED.
- **Objective:** Consider incremental aggregate maintenance only if post-M1/M2 profiling identifies aggregation as the remaining bottleneck.
- **Scope / expected files:** none authorized.
- **Dependencies:** M1/M2 measurements, separate evidence-based go/no-go.
- **Acceptance criteria:** preserve dates, coverage, availability, truncation, usage ownership and child-usage semantics; prove equivalence against full recomputation; do not subtract non-invertible aggregates naively.
- **Baseline and results:** pending.
- **Tests / verification:** not started.
- **Oracle/reviewer findings:** pending.
- **Commit references:** none.
- **Outstanding risks:** non-invertible coverage/partiality semantics.
- **Next action:** defer pending post-M2 evidence.

### M5 — Final performance and correctness validation (deferred)

- **Status:** DEFERRED.
- **Objective:** Compare representative end-to-end performance against the original baseline and validate all affected interfaces before a release recommendation.
- **Scope / expected files:** future tests/benchmark artifacts and relevant spec/ADR updates only where a real architecture boundary changes.
- **Dependencies:** approved/completed milestones.
- **Acceptance criteria:** comparable pinned-runtime baselines; correctness/concurrency, CLI/TUI compatibility, required focused/full tests, typecheck/lint/format, and a release recommendation. No version bump unless release is separately requested.
- **Baseline and results:** pending.
- **Tests / verification:** not started.
- **Oracle/reviewer findings:** pending.
- **Commit references:** none.
- **Outstanding risks:** environment variance and cross-platform source filesystem behavior.
- **Next action:** defer until M1/M2 decisions finish.

## Independent review

### Oracle review — 2026-10-30 (M0+M1, `deepseek/deepseek-flash`, read-only)

Verdicts, each with the evidence the Oracle cited:

1. **M1 parse reuse is sound and ADR-compatible — no re-read or stat check needed.** Only already-validated parses are handed to replay (observed only when the marker is present, `formatVersion === 3`, and `sourceReadFailure` is clean — the same check the fallback runs), so the skipped work is the second resolution+read, not validation. The fallback is still live in production through `src/ui/history-page.ts:113`. A stat check is a detector, not a guarantee: it narrows the window by one syscall and still loses to a later write, while the spec asks the L2 loader to hand the file's bytes to L0 once per load and ADR 0027's freshness model is snapshot-per-load plus ETag resync.
2. **The source-only JSONL invalidation gap is real; M3 stays BLOCKED.** Emitter is `onFlushed` only. Uncovered mutations are enumerated in the M3 section. A cache would produce an ETag that is self-consistent but wrong and would therefore disable stale-ETag resynchronization — the design's only recovery path.
3. **M2 is a pass/channel concern, not a bundle-layer change.** The bundle carries no range; only `projectInspectorUi` does. Design, ownership, mid-pass subscriber exclusion, failure semantics, invariants and proving tests are recorded in the M2 section.
4. **M2 as "one load per refresh pass" is the whole of M2**, and it cannot help a single-range client. The measured three-range gain is a proxy: the benchmark loads concurrently while the channel awaits groups sequentially and additionally flushes evidence, so a channel-level measurement is a prerequisite for any M2 before/after claim.

Findings raised and disposition:

- *(should-fix, applied)* `scanDiscoveredSession`'s comment claimed "a source that changed since discovery is never replayed", which M1 made false. Rewritten to describe the request-local snapshot and the single-load window.
- *(nit, applied)* The observe predicate's `formatVersion === 3` requirement was unexplained; it is now documented as costing an extra read rather than loosening a check.
- *(note, recorded)* `resolveManifestSourceFile` no longer re-runs on the replay path, so `manifest-unavailable` is unreachable for prevalidated rows and a retargeted manifest is observed one load late. Same bounded window; no fabricated or zeroed data.
- *(note, recorded)* Current-view availability is now all-or-nothing per load (see M1 "Recorded semantics change").
- *(risk, addressed in M2 guidance)* The likely M2 mistake is keying the shared bundle; the M2 constraints and decision log forbid it.
- *(risk, addressed)* ADR 0027 forbids "incremental report computation". M2 stays full recomputation once per pass; M4 would need an amendment before it could proceed, so M4 remains DEFERRED rather than struck.
- *(risk, noted)* A pass holds one bundle plus up to N projected/serialized snapshots (~3.5 MB each): bounded, but M2 must assert no retained growth after the pass ends.

## Decision log

- **2026-10-30 — M1 remains request-local.** Reuse is scoped to one `loadInspectorBundle()` execution; no module/global cache or persisted derived state. Rationale: ADR 0027 makes Pi JSONL the source authority and the invalidation signal is only an Inspector WAL flush. Reconsider only after a separate, Oracle-reviewed architecture decision establishes complete freshness/fallback behavior.
- **2026-10-30 — Source-only invalidation is incomplete.** Code inspection by Scout and parent found the only in-repository Pi JSONL append is the tracking marker through `appendEntry`; the UI invalidation is emitted after successful Inspector WAL flush, not after arbitrary Pi JSONL changes. External Pi/core/user writes are outside codebase visibility. Consequence: M3 stays BLOCKED; M1 does not depend on the signal.
- **2026-10-30 — M2 is scoped as one range-independent load per refresh pass.** Accepted from the Oracle review: the bundle already carries no range, so shared-pass computation is a channel concern. Explicitly not a general shared-computation framework, and not permission to key or retain the pass source. Single-range latency is unchanged, and that is accepted.
- **2026-10-30 — The pass source is never cached.** It lives in the refresh-pass object and dies in its `finally`. Any keying of a bundle/projection (`baselines`, `etagKeys`, a module map) is a cross-refresh cache and is out of scope until M3's invalidation design exists.
- **2026-10-30 — M4 stays DEFERRED, not struck.** ADR 0027's "no incremental report computation" clause means M4 needs an ADR amendment plus measured dominance of aggregation; until then it is not on the roadmap.
- **2026-10-30 — Keep HTML-size budget separate.** It is an independent workstream, not needed to prove source parse deduplication; track separately and do not mix into M0/M1.

## Invalidations and freshness evidence

- `src/ui/invalidation.ts` defines process-local `{ runtimeId, sessionId }` notifications.
- `src/index.ts` connects the only production emitter to the live-WAL writer's `onFlushed` callback; `src/storage/wal.ts` invokes it after successful WAL flush.
- `src/ui/live-channel.ts` subscribes for authenticated same-runtime sockets; it does not watch Pi JSONL. A refresh load occurs at `loadBaseline()` in the channel refresh loop; diff is `diffUiSnapshot(previous.snapshot, next.snapshot)`, then `sendMessage()` serializes JSON, checks `bufferedAmount + payloadBytes` against the queue limit, and calls `state.ws.send(payload)` (`src/ui/live-channel.ts:221-238`, refresh/diff around lines 430-470).
- `src/pi/session-start.ts` → `src/pi/tracking-pi.ts` → `src/storage/tracking.ts` contains the only in-repository source JSONL append: the one permitted tracking marker. Pi session lifecycle observer hooks feed bounded Inspector live WAL but do not prove every external JSONL source mutation.
- Existing `tests/unit/invalidation.test.ts`, `live-channel.test.ts`, `live-wal.test.ts`, `live-observer.test.ts`, `session-start.test.ts`, and `maintenance.test.ts` test process-local signal/WAL/observer/source cursor behavior; none proves arbitrary external JSONL modifications emit the UI signal.
- This gap is a reason not to add a cross-refresh cache; it is not a blocker for one-load parse reuse.

## Measurement boundaries

- **Session discovery:** `discoverHistorySessions()` in `src/ui/load-history.ts`, delegating to manifest discovery in `src/storage/history.ts`.
- **Pi JSONL filesystem reads:** `historyMarkerEvidence()` and `scanDiscoveredSession()` in `src/ui/load-history.ts`; current source read in `loadCurrentSessionReport()` in `src/ui/load-current.ts`.
- **JSONL parsing:** each corresponding `parseSessionJsonl()` call in those loaders.
- **Session reduction / canonical build:** `buildCanonicalSession()` in current/history loaders; L1 builder work is per independently scoped current view and per history session.
- **Evidence loading:** injected `sessionEvidence` provider call in `scanDiscoveredSession()`; current observation/WAL evidence is supplied by the composition root before bundle loading.
- **Report aggregation:** history/global projection from the shared `HistoryScan` in `loadHistoryAndGlobalReports()` and its report constructors in `src/ui/load-history.ts`.
- **UI projection:** `projectInspectorUi()` in `src/ui/ui-projection.ts`.
- **DTO serialization and revision:** `serializeUiSnapshot()` in `src/ui/snapshot-revision.ts`.
- **Snapshot diffing:** `diffUiSnapshot()` in `src/ui/snapshot-revision.ts`, called from the live-channel refresh loop.
- **WebSocket delivery:** `sendMessage()` at `src/ui/live-channel.ts:221-238`: `JSON.stringify`, queue-bound check and `ws.send`; M0 will report DTO serialization/diff and payload bytes but will not claim network latency without an actual socket-delivery benchmark.

## HTML size budget (separate issue)

Not part of this workstream. Do not change HTML/chart/bundle budgets or redesign serialization under M0/M1 unless the M0 profile proves it is directly required to compare the target optimization; if it is, record evidence and request a separate scope decision.

## Session handoff

- Handoff file not created yet.
- On continuation, reread this tracker and verify branch/worktree/HEAD, then continue the single active milestone.

# Pi Session Inspector v1 implementation plan

Execute after documentation baseline. This plan uses vertical slices, tests before implementation, and source contracts pinned in [research](../research/pi-ecosystem.md). **No production implementation existed when this plan was authored.**

## Preconditions

1. Record complete tarball integrity, commit permalink, symbol and line range for every used Pi/integration API.
2. Recheck latest stable Pi and npm package-name availability.
3. Create sanitized fixtures only; raw prompts, outputs, project paths, credentials, account IDs and real telemetry never enter Git.
4. Use Node `>=22.19.0`, npm, TypeScript, `node:test`, `tsx`, Biome. No runtime dependency beyond Pi/Node.

## Module boundaries

| Module | Owns | Must not own |
| --- | --- | --- |
| `core/events.ts` | canonical types, IDs, schemas | I/O or Pi imports |
| `core/reduce.ts` | source precedence, aggregates | UI/storage decisions |
| `core/reports.ts` | immutable renderer DTO | TUI/HTML imports |
| `core/ledger.ts` | lazy chronological projection | duplicate aggregates |
| `pi/adapter.ts` | hooks/replay normalization | persistence policy |
| `pi/sessions.ts` | scope/discovery helpers | analytics |
| `storage/*` | WAL, lease, checkpoint, reconcile, retention | raw Pi writes |
| `integrations/*` | versioned evidence adapters | private package APIs |
| `privacy.ts` | allowlist, redaction, safe output | source payload retention |
| `ui/*` | renderer/input presentation | business-rule forks |

Dependency direction: `pi/storage/integrations/privacy → core → reports → ui`; command registration composes boundaries only.

## Milestone 0 — package skeleton

#### Tests first

- `tests/unit/package-contract.test.ts`: manifest has ESM, Node `>=22.19.0`, MIT, Pi keyword/extensions, exact repository URLs and file allowlist.
- `tests/unit/tarball-contract.test.ts`: `npm pack --json` contains source/readme/license and excludes fixtures/source session data.

#### Implement

1. Create package metadata, TypeScript/Biome configs, scripts and `.gitignore`.
2. Add `src/index.ts`, `src/commands.ts`, empty boundaries and both slash commands.
3. Render one placeholder custom UI stating Inspector is not tracking yet.

#### Verify

```bash
npm run format:check && npm run lint && npm run typecheck && npm test
npm pack --dry-run
pi install ./
```

Manual: both command aliases open placeholder and return without affecting agent flow.

## Milestone 1 — replay-to-JSON slice

#### Tests first

Fixtures for Pi `0.85.1`: unknown entry, assistant usage/cost, nested tool usage, compaction and branch summary usage, tree with selected active leaf, unfinished tool, duplicate timestamps. Assert active/tree output, native IDs, deterministic derived IDs/order, no double count, and repeated JSON byte equality.

#### Implement

1. Tolerant incremental JSONL reader and `SessionSource` normalizer.
2. Scope resolver, canonical records, deterministic reducer and report DTO.
3. Lazy ledger and JSON renderer with stable key/array ordering.

**Acceptance**: golden JSON matches exact expected bytes; replay ignores unknown content safely; fixture total matches Pi-native usage source.

## Milestone 2 — live tracking

#### Tests first

Test old-session/abandoned-branch/duplicate marker boundaries, ephemeral state, hook exception isolation, tool/provider timing, unmatched crash start, writer collision/PID reuse, WAL queues, telemetry field limits, secret strings in every field, and redacted diagnostics.

#### Implement

1. Observer-only Pi adapter and tracking transaction (`pending → append marker → atomic metadata`).
2. Random exclusively claimed writer ID, per-writer buffered WAL, bounded flush/disable behavior.
3. `pi-session-inspector:telemetry:v1` validator/consumer and best-effort boundaries.

**Acceptance**: injected hook/storage errors do not change tool/agent result; process kill loses no more than configured buffer; adversarial telemetry writes no raw secret.

## Milestone 3 — checkpoint, recovery, history

#### Tests first

Partial WAL line; missing/corrupt/stale checkpoint; Pi rewrite; cursor mismatch; pending manifest crash; maintenance lease contention, stale dead owner, late-writer cursor regression; 206 tracked sessions.

#### Implement

1. Atomic checkpoint with source/per-WAL cursors and replay fallback.
2. Exclusive maintenance lease with dead-PID/age recovery; no hot-path WAL lock.
3. Reconciliation, manifest-only discovery, history picker and source diagnostics.

**Acceptance**: concurrent maintainer cannot replace newer cursor checkpoint; crashed session discoverable/reconciled; discovery avoids global Pi rescan.

## Milestone 4 — current TUI and ledger

#### Tests first

Renderer-neutral models; keyboard reducer; narrow terminal layout; active/tree toggle; unavailable/unsupported labels; ledger lazy materialization.

#### Implement

1. Full-screen custom UI tabs: Overview, Models, Tools, Commands, Agents, Skills, Integrations, Errors, Ledger.
2. History selection/drill-down and scope controls.

**Acceptance**: manual Pi matrix covers branch creation, tool failure, model switch, compaction and interrupted tool; UI makes confidence visible.

## Milestone 5 — integration and agent roll-up

#### Tests first

Pin upstream sanitized fixtures for `ctx_*`, `rtkCompaction`, mode entries, permission events, pi-subagents foreground/async/nested/status/tool-result variants. Assert unsupported/missing data is safe, hierarchy correct and child cost not additive.

#### Implement

1. Evidence registry with version support and confidence states.
2. Context/RTK/mode/permission/subagent adapters; generic Lens tool evidence.

**Acceptance**: one parent and N child `AgentRun`s; missing artifact becomes unavailable, not guessed; no private/internal API imports.

## Milestone 6 — HTML, i18n, export

#### Tests first

HTML escaping/CSP hostile strings, DOM snapshots, filtering/sort/search/chart DTO, redaction, locale fallback, open failures, cache expiry/size and explicit-output preservation.

#### Implement

1. Self-contained escaped HTML/CSS/vanilla JS and English catalog keys.
2. Platform opener through argv-safe Pi exec, deterministic JSON output, report-cache cleanup.

**Acceptance**: report works offline with `file://`, sends no request, preserves explicit export, and displays local-sensitivity warning.

## Milestone 7 — sealing, retention, scale

#### Tests first

Active/stale markers; resume sealed source; validate-before-delete; source-change race; dated-segment rotation; strict 14-calendar-day cutoff; analyzer-only deletion; cold integration notice; crash injection at every seal phase.

#### Implement

1. Sealed checkpoint/reopen/prune flow under maintenance lease, with daily immutable WAL segments and checkpoint-first expiry.
2. Fixed-seed benchmark corpus: 10k records/100-MiB session and 1,000 checkpoints.

**Acceptance**: every injected interruption leaves raw WAL or validated sealed checkpoint; Pi files untouched; no Inspector detailed record/cache exceeds 14 calendar days; initial target SLOs in spec are measured and published, not release gates yet.

## Milestone 8 — hardening and release

#### Run

- JSONL/telemetry fuzzers, privacy corpus, schema evolution fixtures, clean-machine install, tarball audit, manual TUI matrix, full benchmark release job.
- CI: format/lint/typecheck/test/snapshots/benchmark smoke/pack-install.
- Manual initial npm publish with 2FA, then configure exact-repository GitHub Actions trusted publisher/OIDC and validate provenance path.

#### Release evidence

- No failing test/lint/type/package checks.
- Benchmark artifact records target-SLO measurements and variance; hard regression gates begin only after two accepted release baselines, per spec.
- Report contains no external URL/request and privacy corpus contains no secret after all persistence/render paths.
- Public docs list supported Pi release, privacy boundary, data confidence, migration and disclosure route.

## Commands

Final scripts should be intentionally small:

```text
npm run format       # biome format --write
npm run format:check # biome format --check
npm run lint         # biome lint
npm run typecheck    # tsc --noEmit
npm test             # node --import tsx --test
npm run benchmark:smoke
npm run benchmark:release
```

Do not add a test framework, bundler, database, server, or installer abstraction unless a measured blocker proves Node/Pi standard facilities insufficient.

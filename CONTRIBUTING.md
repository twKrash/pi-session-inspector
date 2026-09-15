# Contributing

Pi Session Inspector is currently a design baseline. Do not add production code before [implementation plan](docs/plans/pi-session-inspector-v1-implementation.md) milestone work begins.

## Prerequisites

- Node `>=22.19.0`
- npm
- Latest supported Pi release

From a repository checkout, `npm install` configures `.githooks/` through the
`prepare` script. Run `npm run prepare` after a fresh clone when needed. The
pre-commit hook runs `npm run build:web:check` and `npm run knip`.

## Rules

- Read [research](docs/research/pi-ecosystem.md), [spec](docs/specs/pi-session-inspector-v1.md), [implementation plan](docs/plans/pi-session-inspector-v1-implementation.md), [ADRs](docs/architecture/README.md), and `AGENTS.md` first. These are canonical; do not create a competing planning source.
- Tests precede implementation changes. Keep one small deterministic fixture/check per non-trivial behavior.
- Sanitize fixtures: never commit prompts, outputs, tool payloads, user paths, credentials, account IDs, or real session telemetry.
- Do not add a runtime dependency, database, server, LLM step, or raw-content persistence without an ADR and measured need.
- Keep Pi observer-only. Never modify Pi events/control flow or session files except namespaced tracking marker.
- Schema, privacy, scope, persistence, source-precedence, telemetry-state, retention, and performance-gate changes require spec/ADR updates and migration proof where persisted data changes.

## Planned verification

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build:web:check
npm run depcruise
npm run knip
npm run publint
npm run benchmark:browser:check   # browser asset + chart, against the accepted baseline
npm pack --dry-run
```

PRs must state tests run, privacy impact, fixture provenance, supported Pi version, and any ADR/spec change. See `CHANGELOG.md` for release format.

## Dependency admission

A new package is admitted only through this sequence, in order; skipping a step
is a rejection, and a heuristic that stands in for a capability is not a gate:

1. **Provenance/license audit** — exact version, license, repository, release
   history, install hooks, registry integrity, advisories.
2. **Precise capability gates** — parse the shipped bytes for the capability to
   forbid (module loading, host loaders, `import.meta`, dynamic code
   evaluation); never assert a substring that merely correlates with it.
3. **Hostile-runtime probes** — execute the shipped asset with the environment
   poisoned (for example `Date` that throws) and require it to still work.
4. **Semantic invariants** — the existing executable suites must keep proving
   that ranges, aggregates, evidence, and unavailable-versus-zero stay
   Inspector-owned.
5. **Measured footprint** — record asset size, gzip, and the browser benchmark
   deltas before adopting.

The adopted examples of this pattern are `i18next` and `chart.js` (ADR 0018,
`docs/roadmap.md` Pre-M8.6).

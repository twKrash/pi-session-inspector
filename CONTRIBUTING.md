# Contributing

Pi Session Inspector is currently a design baseline. Do not add production code before [implementation plan](docs/plans/pi-session-inspector-v1-implementation.md) milestone work begins.

## Prerequisites

- Node `>=22.19.0`
- npm
- Latest supported Pi release

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
npm pack --dry-run
```

PRs must state tests run, privacy impact, fixture provenance, supported Pi version, and any ADR/spec change. See `CHANGELOG.md` for release format.

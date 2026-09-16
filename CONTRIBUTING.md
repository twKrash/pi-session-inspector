# Contributing

## Prerequisites

- Node `>=22.19.0`
- npm
- Latest supported Pi release

From a repository checkout, `npm install` configures `.githooks/` through the
`prepare` script. Run `npm run prepare` after a fresh clone when needed. The
pre-commit hook runs `npm run build:web:check` and `npm run knip`.

## Workflow

`main` is protected. Changes land through a pull request that carries one
approving review and a green `quality` and `test` run. Repository admins may
bypass the ruleset, which is how a maintained push can still land directly;
prefer the pull request path. Force-pushing and deleting `main` are blocked for
everyone.

CI (`.github/workflows/ci.yml`) runs on every push to `main` and on every pull
request:

| Job | Commands |
| --- | --- |
| `quality` | `npm run format:check`, `lint`, `typecheck`, `build:web:check`, `knip`, `depcruise`, `publint` |
| `test` | `npm test`, `npm run test:invariants` |
| `test (node 24.x)` | the same `test` job on the next Node major, reported but not required |

Run the same commands locally before opening a pull request:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run build:web:check
npm run knip
npm run depcruise
npm run publint
npm test
npm run test:invariants
```

Also run these when a change can affect what they measure:

```bash
npm run benchmark:browser:check   # shipped asset + chart, against the accepted baseline
npm pack --dry-run                # packaging, file allowlist, tarball contents
```

A pull request states the tests run, the privacy impact, fixture provenance, the
supported Pi version, and any ADR/spec change. See `CHANGELOG.md` for the release
format.

## Releases

1. Give `CHANGELOG.md` a section for the new version and set that version in
   `package.json` and both `package-lock.json` root fields — one commit, nothing
   else, so the artifact stays identifiable.
2. Qualify that commit from a clean checkout: the gate suite, a real
   `npm pack`, a tarball audit, and a clean-machine install. Record the commit,
   version, tarball name, file count, and hashes in the evidence package under
   `docs/release/`.
3. Tag the release commit `v<version>` and push the tag.
   `.github/workflows/release.yml` then publishes that artifact to npm and
   creates the GitHub release. It refuses a tag that disagrees with
   `package.json`, a version with no `CHANGELOG` section, and a version that is
   already on the registry.
4. Verify the registry's `dist.integrity` and `dist.shasum` against the
   qualified hashes, then install the published package and exercise
   `/session-ins` from it.

The publish step needs npm's trusted publisher configured for this repository
and this workflow file. Until that exists the workflow fails at publish, and a
release is published by hand:

```bash
npm pack
npm publish <tarball> --access public   # scoped packages: never publish restricted
```

Published contents are immutable. If the wrong bytes ship, deprecate that
version and publish a corrected one; do not rely on unpublishing.

## Rules

- Read [research](docs/research/pi-ecosystem.md), [spec](docs/specs/pi-session-inspector-v1.md), [implementation plan](docs/plans/pi-session-inspector-v1-implementation.md), [ADRs](docs/architecture/README.md), and `AGENTS.md` first. These are canonical; do not create a competing planning source.
- Tests precede implementation changes. Keep one small deterministic fixture/check per non-trivial behavior.
- Sanitize fixtures: never commit prompts, outputs, tool payloads, user paths, credentials, account IDs, or real session telemetry.
- Do not add a runtime dependency, database, server, LLM step, or raw-content persistence without an ADR and measured need.
- Keep Pi observer-only. Never modify Pi events/control flow or session files except namespaced tracking marker.
- Schema, privacy, scope, persistence, source-precedence, telemetry-state, retention, and performance-gate changes require spec/ADR updates and migration proof where persisted data changes.

## Dependency admission

A new package is admitted only through this sequence, in order; skipping a step
is a rejection, and a heuristic that stands in for a capability is not a gate:

1. **Provenance/license audit** — exact version, license, repository, release
   history, install hooks, registry integrity, advisories.
2. **Precise capability gates** — parse the shipped bytes for the capability to
   forbid (module loading, host loaders, `import.meta`, dynamic code
   evaluation); never assert a substring that merely correlates with it.
3. **Hostile-runtime probes** — execute the shipped asset with the environment
   poisoned (for example a `Date` that throws) and require it to still work.
4. **Semantic invariants** — the existing executable suites must keep proving
   that ranges, aggregates, evidence, and unavailable-versus-zero stay
   Inspector-owned.
5. **Measured footprint** — record asset size, gzip, and the browser benchmark
   deltas before adopting.

The adopted examples of this pattern are `i18next` and `chart.js` (ADR 0018,
`docs/roadmap.md` Pre-M8.6).

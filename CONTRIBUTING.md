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
   else, so the artifact stays identifiable. The same commit updates every other
   current-release statement: the `README.md` status line, the
   `docs/roadmap.md` `**Current release:**` line, and `RELEASE_VERSION` in
   `tests/unit/package-contract.test.ts`. `npm test` fails when one of them
   disagrees with `package.json`, so a half-finished bump cannot reach `main`.
   Wording that records history — a completed-milestone entry, an evidence
   package, an older changelog section — is never rewritten.
2. Qualify that commit from a clean checkout: the gate suite, a real
   `npm pack`, a tarball audit, and a clean-machine install. Record the commit,
   version, tarball name, file count, and hashes in the evidence package under
   `docs/release/`.
3. Tag the release commit `v<version>` and push the tag.
   `.github/workflows/release.yml` runs three jobs:
   - `qualify` — refuses a tag that disagrees with `package.json` or a version
     with no `CHANGELOG` section, runs the gate suite, packs the tarball,
     records its SHA-1, SHA-512 and `release-metadata.json`, inspects the packed
     contents, and uploads the artifact.
   - `publish` — runs in the `npm-publish` environment with `id-token: write`
     only. It downloads that exact tarball, re-verifies both checksums, obtains
     a short-lived npm credential by exchanging the job's GitHub OIDC token
     (no repository secret exists), publishes with `--access public
     --provenance`, and then compares the registry's `dist.shasum` and
     `dist.integrity` with the packed file.
   - `release` — creates the GitHub release from the CHANGELOG section, with the
     tarball and `release-metadata.json` attached. An existing release is never
     overwritten: it is accepted only if it targets this tag, carries both
     expected assets, and its tarball and metadata match the qualified artifact.

   The npm trusted publisher configuration must name this repository, this
   workflow file (`release.yml`), and the `npm-publish` environment; that triple
   is what npm checks before it hands over the publish credential.
4. Verify the registry's `dist.integrity` and `dist.shasum`, then install the
   published package and exercise `/session-ins` from it.

### Pipeline notes from the `1.0.1` release

- **The trusted publisher fields must match the OIDC claims exactly.** Owner
  (`twKrash`), repository **name only** (`pi-session-inspector`), workflow file
  (`release.yml`), environment (`npm-publish`). The form has a separate owner
  field, so repeating the owner inside the repository box binds a repository
  that does not exist, and npm then answers `OIDC token exchange error -
  package not found` for an otherwise valid token. The `publish` job prints the
  claims npm sees, so a mismatch is a direct comparison.
- **A successful publish is not immediately readable.** The registry's read path
  can lag, so verification retries for up to a minute before it compares
  `dist.shasum` and `dist.integrity` with the packed file, and fails loudly if
  they disagree.
- **Archives are content-reproducible, not byte-reproducible.** Two environments
  packing the same commit produce the same entries with identical contents and
  tar metadata but a different gzip stream, so their hashes differ. Integrity is
  therefore compared against the artifact the qualification job built and
  uploaded, never against a tarball repacked elsewhere.
- **The packing toolchain is pinned** (Node `22.22.1`, npm `11.19.1`) in
  `qualify`, and `publish` never repacks: it publishes that exact `.tgz`.

If the workflow cannot run (no tag, or trusted publishing unavailable), a
release is published by hand from a clean checkout:

```bash
npm pack
npm publish <tarball> --access public   # scoped packages: never publish restricted
```

`publishConfig.access` in `package.json` keeps that from being forgotten.

Published contents are immutable. If the wrong bytes ship, deprecate that
version and publish a corrected one; do not rely on unpublishing.

## Rules

- Read [research](docs/research/pi-ecosystem.md), [spec](docs/specs/pi-session-inspector-v1.md), [ADRs](docs/architecture/README.md), and `AGENTS.md` first. These are canonical; do not create a competing planning source.
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

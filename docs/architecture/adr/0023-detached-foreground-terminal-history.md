# ADR 0023: detached foreground terminal-history enrichment

## Status

Accepted for pre-UAT; amended to follow the documented per-child metadata
artifact after upstream [pi-subagents issue
#2485](https://github.com/nicobailon/pi-subagents/issues/2485).

## Context

ADR 0022 permits filesystem enrichment only through a documented, versioned
artifact with an explicit locator published in the same persisted result.

Detached foreground launch results can carry a producer sentinel such as
`exitCode: -2`. That value is not the child's final process outcome. The 1.5.0
implementation settled the outcome through `foreground-history.json`, a private
temporary index, under a narrow producer-index exception.

Upstream [pi-subagents issue #2485](https://github.com/nicobailon/pi-subagents/issues/2485)
(maintainer response, 2026-09-26) states that
`foreground-history.json` is internal resume bookkeeping that should stay
internal, and documents the observability source instead: the per-child run
metadata file `<artifacts dir>/{runId}_{agent}[_{index}]_meta.json`. For a
detached foreground child the producer writes a provisional record when the child
detaches and overwrites it with the terminal result when the child finishes. The
documented metadata carries `runId`, `exitCode`, `processSignal`, `error`,
`model`, `requestedModel`, `timestamp`, `durationMs`, `toolCount`, and `usage.*`.
Metadata is on by default; `artifactConfig.includeMetadata: false` or disabled
artifacts turn it off.

The audited `pi-subagents@0.71.0` package (npm tarball integrity
`sha512-4Ng1bM0oigvrdE5DfSoDgdiUOZOXig2M4DTZvlAWSx3Ineyvl7N0Le2FetfPo1N7oU0wO91aCJqcAInU6wsl5A==`,
release commit `4af5e85a427b9f87334585ae8d0eb365d4dd2a1e`) already publishes an
exact `artifactPaths.metadataPath` inside the persisted detached foreground
result, and writes that same path as the terminal record. Inspector therefore
follows that explicit reference and no longer reproduces any producer-private
path resolution.

## Decision

- **Documented artifact only:** the private `foreground-history.json` bridge is
  removed. Inspector no longer computes, resolves, or reads it. For a current
  report only, and only for an already-derived row whose persisted publisher is
  `subagent`, has a detached `details.results[]` child, and publishes an exact
  `artifactPaths.metadataPath` in that same persisted result, Inspector may read
  that one referenced file. No directory is scanned and no filename is inferred.
- **Exact enrichment only:** the metadata record must declare `runId` exactly
  equal to the already-validated persisted `details.runId`. The child binding is
  the exact per-child reference the producer published in that child's own
  result; display name, array position, path suffix, timestamp, task, and output
  are never identity. A mismatch, unusable identity, malformed value,
  unsupported shape, missing or disabled artifact, symlink escape, non-regular or
  oversized file, changed file, or any I/O failure leaves the row unchanged.
- **Detached is not outcome:** persist `executionDisposition: "detached"`
  separately from ordinary `status`. The launch sentinel `-2` and provisional
  metadata prove nothing. A terminal `exitCode: 0` maps to `succeeded`, a valid
  non-negative non-zero `exitCode` to `failed`, and a valid signaled termination
  without a usable exit code to the existing `interrupted` status. Every other
  value, including absent outcome fields, stays `unknown`. Output presence is
  never terminal evidence.
- **Allowlisted fields only:** `runId`, `exitCode`, and `processSignal` are
  consumed. Additive unknown fields are ignored, and no other documented metadata
  field (usage, model, duration, tool count, error, acceptance, transcript) is
  consumed by this decision. Raw producer fields, paths, error text, task, and
  output never enter reports, WAL, or diagnostics.
- **Authority and accounting:** Pi JSONL remains historical and native-accounting
  authority. Metadata enrichment is current-session only and is never consulted
  for a prior-session report. It creates no AgentRun, changes no public ID or
  parent, overrides no already-terminal persisted status, adds no usage, and is
  never written to Inspector WAL or Pi JSONL. Native totals remain authoritative
  and child usage remains non-additive.
- **Bounded read:** the same file-safety discipline as referenced lifecycle
  enrichment: bounded reference and file size, absolute normalized path,
  `realpath` plus per-component `lstat` symlink rejection, no-follow handle,
  inode/size re-verification, bounded JSON parse, object-only shape, and exact
  `runId` match. Reader failures are swallowed so Pi execution is unaffected.
- **Documented but unversioned artifact:** the producer publishes no schema
  version for `_meta.json`. ADR 0022's `documented/versioned artifact`
  expectation is narrowed for this one artifact: eligibility rests on its
  documented field shape, the exact `artifactPaths.metadataPath` reference
  published by the same persisted result, the exact `runId` identity, and
  fail-closed mapping. This narrows only the version expectation; ADR 0022's
  no-scanning, enrichment-only, and authority rules are unchanged.

## Known limitation

The metadata record persists `exitCode` but not the producer's
`interrupted`/`stopped`/`timedOut` classification. A detached foreground child
that is later interrupted through `subagent({ action: "interrupt", id })` ends
with `exitCode: 0` and `interrupted: true` in the producer, so its terminal
`_meta.json` is indistinguishable from a clean success and this decision renders
`Succeeded`. The deleted private bridge observed the producer's aggregate status
(`paused`) and rendered `interrupted`, so this is an accepted narrowing, not a
guessed one. It is not worked around by consuming unrelated fields: `acceptance`
and every other non-allowlisted field remain out of scope. The durable fix
belongs upstream: include a terminal status or interruption discriminator in
`_meta.json` ([issue
#2485](https://github.com/nicobailon/pi-subagents/issues/2485)).

## Consequences

Detached disposition and terminal outcome can both be rendered (for example,
`Detached` and `Succeeded`) without converting a detached launch sentinel into
failure. Because metadata is optional and can be disabled, a missing or
provisional file remains `unknown` rather than becoming a failure or a zero.
History remains based solely on persisted Pi evidence: the metadata reference is
a current-session filesystem reference and Inspector retains no durable
historical pointer to it. Raw producer fields and filesystem errors do not enter
reports, WAL, or diagnostics.

## Related decisions

ADR [0022](0022-pi-subagents-observability-contract-and-reconciliation-boundary.md)
is unchanged in its no-scanning, enrichment-only, and authority rules. This
decision narrows its `documented/versioned artifact` expectation for this one
documented-but-unversioned producer artifact, and this metadata path is the
referenced-enrichment path ADR 0022 already allows. The first verified producer
implementation and evidence baseline are recorded in
[the Pi ecosystem research](../../research/pi-ecosystem.md); the exact package
integrity and release commit are listed above.

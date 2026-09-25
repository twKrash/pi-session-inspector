# ADR 0023: detached foreground terminal-history enrichment

## Status

Accepted for pre-UAT, narrowly superseding ADR 0022 only for the pi-subagents foreground-history terminal-status evidence class.

## Context

ADR 0022 permits filesystem enrichment only through a documented, versioned artifact with an explicit locator published in the same persisted result. The audited `pi-subagents@0.71.0` package publishes no such producer-facing contract or locator for `foreground-history.json`; the file is an internal temporary index. Its exact published-package implementation was audited from npm tarball integrity `sha512-4Ng1bM0oigvrdE5DfSoDgdiUOZOXig2M4DTZvlAWSx3Ineyvl7N0Le2FetfPo1N7oU0wO91aCJqcAInU6wsl5A==`, release commit `4af5e85a427b9f87334585ae8d0eb365d4dd2a1e`.

Detached foreground launch results can carry a producer sentinel such as `exitCode: -2`. That value is not the child's final process outcome. The producer's compact current-session history retains an exact `(sessionId, runId, index)` match and terminal `status`/`exitCode`, but is best-effort temp data, not durable history. The pre-UAT regression needs to keep detached disposition separate from child outcome and show a final result when that exact evidence remains available.

## Decision

- **Narrow producer-index exception:** for a current report only, Inspector may directly read the fixed `async-subagent-results/foreground-history.json` path using the audited 0.71.0 temp-root resolution (`PI_SUBAGENTS_TEMP_ROOT` when non-empty; otherwise the producer's per-user `pi-subagents-<scope>` root under `os.tmpdir()`). This exception does not make the file a documented upstream API. It is a pre-UAT compatibility pin; re-audit producer source before changing the reader or treating another package release as supported. The artifact contains schema `version: 1`; Inspector does not invent a package SemVer match because the producer does not publish one in the artifact.
- **Exact enrichment only:** history may fill `status` only for an already-derived current-session row whose persisted publisher is `subagent`, has a detached `details.results[]` child, and whose `details.runId` plus child `index` exactly match one history run's `sessionId`, `runId`, and child `index`. Display name, array position, path, timestamp, task, and output are not identity. Duplicate exact matches, malformed records, invalid identity, unsupported schema/status, inconsistent terminal fields, or any I/O failure leave the row unchanged.
- **Detached is not outcome:** persist `executionDisposition: "detached"` separately from ordinary `status`. The launch sentinel `-2` and unfinished launch fields do not prove success, failure, or interruption. Without final proof the row remains `detached` + `unknown`. Exact history `completed` + exit code `0` maps to `succeeded`; `failed` maps to `failed` when exit code is absent or nonzero; `paused` or `stopped` maps to `interrupted`. Output presence is never terminal evidence.
- **Authority and accounting:** Pi JSONL remains historical and native-accounting authority. History is never consulted for prior-session reports, creates no AgentRun, changes no public ID or parent, overrides no already-terminal persisted status, adds no usage, and is never written to Inspector WAL or Pi JSONL.
- **Bounded private read:** open only the one computed file; never scan directories or infer alternate locations. Reject symlinks/non-regular files, path changes, files over 8 MiB, malformed JSON, unsupported envelope version, more than 50 runs or 256 children per run, oversized identity/path data, and invalid bounded exit codes. Read through a no-follow file handle, verify inode/size before and after, and return only internal outcome enums. Swallow reader failures so Pi execution is unaffected. Raw producer fields and filesystem errors do not enter reports, WAL, or diagnostics.

## Consequences

Detached disposition and terminal outcome can both be rendered (for example, `Detached` and `Succeeded`) without converting a detached launch sentinel into failure. The bounded temporary index may disappear or be replaced at any time; absent evidence remains `unknown`. This exception has no historical guarantee and must be replaced by an upstream-documented contract or removed before claiming general producer-version compatibility.

## Related decisions

ADR [0022](0022-pi-subagents-observability-contract-and-reconciliation-boundary.md) remains unchanged except for this explicitly bounded exception. The producer implementation pin and evidence baseline are recorded in [the Pi ecosystem research](../../research/pi-ecosystem.md); the exact package integrity and release commit are listed above.

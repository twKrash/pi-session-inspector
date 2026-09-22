# PR 43 / Item 13A scoped re-audit and fix round

## Scope

Research, documentation, and sanitized fixture evidence only. Do not start 13B. Do not modify `src/`, production code, canonical DTOs, adapters, ADRs, specs, package metadata, UI, or existing parser behavior. Allowed product files: `docs/research/pi-ecosystem.md`, `docs/roadmap.md` only if necessary, and `tests/fixtures/pi/0.85.1/subagent-agent-run-effort-audit.jsonl`.

## Objective

Make the 13A evidence matrix an accurate input to 13B by tracing pinned `pi-subagents@0.70.1` progress fields through producer construction, `SingleResult`/`Details` projection, Pi `tool_result` `details.results[]`, and persisted Pi JSONL.

Classify each separately as exactly `supported`, `partial`, or `unavailable`:

- `durationMs`
- `toolCount`
- `turnCount`
- `usage.turns`

Never use `observedAt` or entry timestamps for duration; never derive tool count from `toolCalls[].length`; never equate `usage.turns` with native generations or `turnCount` without explicit proof; live/async status files are not historical evidence without a stable persisted join.

Use pinned source facts:

- pi-subagents version: `0.70.1`
- gitHead: `1ac7b5e2652e9571164847ac2905ab4aded92791`
- tarball: `https://registry.npmjs.org/pi-subagents/-/pi-subagents-0.70.1.tgz`
- integrity: `sha512-cWNjguyrTfx6VmFzD+jCWIzJK3mBL5zjAhw5Z1E+5I3Iq5O2gCSmM0DphGDY6fh9w7eUewH1OR6Vsi/+Uje6oQ==`
- declaration source: `src/shared/types.d.ts` from that tarball; `SingleResult` 1099–1160, `WaitCompletionChild` 1205–1222, `WaitCompletion` 1227–1238, `Details` 1296–1312, `WorkflowChildSummary` 167–184.
- producer implementation source: `src/runs/foreground/execution.js` from same pinned package. It constructs `progress.toolCount`, `progress.turnCount = result.usage.turns`, and `progress.durationMs`; constructs terminal/interruption `result.progressSummary` around lines 402–405, 1333–1337, 1407–1411; `snapshotResult` carries `progress` and `progressSummary` around 172–182; `Details.results` is declared at 1304 and `Details.completions` at 1312.

Do not treat declarations alone as persisted proof. Document independently which fields are actually evidenced on each persisted surface. If a field is not proven to reach persisted `details.results[]`/`details.completions[]`/nested completion results/workflow summaries, mark it unavailable or partial.

## Outcome authority split

Explicitly distinguish:

A. Declared producer contract evidence.
B. Persisted-but-dynamic compatibility evidence accepted by Inspector, not authority for new 13B semantics unless separately justified.
C. Synthetic audit-only fixture metadata.

For `details.results[]`/`SingleResult`, document declared lifecycle/outcome fields such as `exitCode`, `processSignal`, `interrupted`, `timedOut`, `stopped`, and `outputState`, plus any proven progress fields. For `details.completions[]`/`WaitCompletion`, document `state`, `success`, `archivePath`, and results. For nested `WaitCompletionChild`, document declared child fields. Label foreground dynamic `state`/`success` compatibility values as B if retained; do not present them as declared `SingleResult` fields or unify success semantics across surfaces. Keep cancellation annotation under `details.auditOnly` parser-invisible, synthetic, and unavailable.

## Fixture

Keep Pi/session baseline `0.85.1`, historical research `0.59.0`, and current producer `0.70.1` separate. Add only bounded numeric progress fields needed to prove persisted evidence. Keep no task text, output, raw errors, tool args/results, paths, secrets, or raw payload copies.

## Validation

Run focused subagent tests, recursive JSONL parse/privacy scan, `git diff --check`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm pack --dry-run`. Append a fix-round report to the existing coordination report; do not modify it as a product artifact. Commit only the allowed 13A files plus ignored coordination artifacts.

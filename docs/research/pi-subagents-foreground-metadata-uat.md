# pi-session-inspector detached-foreground metadata UAT

**Date:** 2026-09-26
**Subject:** ADR 0023 amendment — settle detached foreground runs from the documented
per-child `_meta.json` instead of the private `foreground-history.json`.
**Build under test:** branch `fix/detached-foreground-metadata` (unreleased at
the time of the run; ADR 0023 amendment; shipped as `1.5.1`). The commit hash is
deliberately not pinned here because this record lives in the same commit.
**Producer:** `pi-subagents@0.71.0` installed locally; audited release commit
`4af5e85a427b9f87334585ae8d0eb365d4dd2a1e`; npm tarball integrity
`sha512-4Ng1bM0oigvrdE5DfSoDgdiUOZOXig2M4DTZvlAWSx3Ineyvl7N0Le2FetfPo1N7oU0wO91aCJqcAInU6wsl5A==`.
**Pi:** `@earendil-works/pi-coding-agent@0.87.1`.
**Session:** `01a0ddbd-84fb-74d7-8809-88d8d3486248`, active scope.
**Baseline:** [pi-subagents-a-d-pre-cleanup-uat.md](pi-subagents-a-d-pre-cleanup-uat.md)
(the pre-fix A–E record this run re-tests).

## Method

Real native `pi-subagents` execution in the session above: `subagent` foreground
and async launches, one intercom detach answered through `subagent_supervisor`,
and `bg_wait` terminal completions. No Inspector source or configuration was
changed during the run and no synthetic evidence was introduced.

Each child was pinned to `deepseek/deepseek-flash` (the producer also resolved
`requestedModel: deepseek/deepseek-flash`). The report was produced twice: once
by the operator running `/session-ins json current` (real command artifact at
`~/.pi/agent/session-inspector/v1/reports/01a0ddbd-84fb-74d7-8809-88d8d3486248.json`),
and once independently through the same production loader
(`loadCurrentSessionReport` + `renderJson`) headlessly. Both artifacts agree.
The UI was inspected by the operator (screenshot outside the repository at
`/tmp/pi-clipboard-6f639d20-56c9-40cc-81f9-865adbc2187c.png`).

## Results

| Case | Producer run | Producer evidence | Inspector result | Verdict |
| --- | --- | --- | --- | --- |
| A — foreground success | `e55233e2-77cd-4e60-9f30-b37d79343fa1` | attached result, terminal `_meta.json exitCode 0`, `durationMs 5206`, `toolCount 2` | `scout`, `succeeded`, no disposition | PASS |
| B — detached foreground success | `b2012f2e-0515-42b3-abea-96bfd0908aed` | provisional persisted result `detached` / `exitCode -2`; later terminal `_meta.json exitCode 0`, `durationMs 11648`, `toolCount 3` | `scout`, **`detached` + `succeeded`**, one public row | PASS (was `unknown` pre-fix) |
| C — foreground timeout | `7d3df283-8b07-4e20-8160-5a54d70fce38` | `timeoutMs: 1000`; persisted result `isError: true`, `results[]` empty | **no AgentRun** | unchanged (fail-closed, no child identity) |
| D — async success + completion | `c4ba9964-6e1c-4580-9d85-1ae36a32b8ad` | async launch, then `bg_wait` terminal completion | `scout`, `executionKind: async`, `succeeded`, one row | PASS |
| E — async timeout | `c4a9f6a4-bd76-4677-985a-837d70a61341` | async launch, terminal failure | `scout`, `executionKind: async`, `failed` | PASS |
| F — async launch, no persisted completion | `59fc1614-aa8a-4f50-8765-a01c1c3e26c9` | native completion notification only, no `bg_wait`/`subagent_wait` publication | agent absent, `async`, `unknown` | expected under the persisted-evidence contract |

Detached row, verbatim from the command artifact:
`{"agent":"scout","status":"succeeded","executionDisposition":"detached","executionKind":null,...}`.
The same run in a report built with all filesystem enrichment disabled is
`{"status":"unknown","executionDisposition":"detached"}` — so the referenced
`_meta.json` is the only input that changed the outcome.

## Cross-checks

- **Artifact agreement:** the five run tuples (agent / status / disposition /
  executionKind) are identical between the real command artifact and the
  independent headless report (`diff` clean).
- **UI agreement:** the screenshot shows the `scout` row tagged
  `Detached` `Succeeded`; cards read 5 child runs, 3 succeeded, 1 failed, 1
  unknown, known child tokens 74,648, known child cost $0.01.
- **Accounting unchanged:** enriched and persisted-only reports are
  byte-identical for `usage`, `usageComposition`, `agentActivity`, and
  `agentUsage` at the same instant. The command artifact reports a session
  grand total of 31,205,690 tokens / $0.7946 and agent tool activity of 10
  calls (9 succeeded, 1 failed).
- **Privacy:** the serialized report contains zero occurrences of any run id,
  `subagent-artifacts`, `_meta.json`, `transcript.jsonl`, or a `PRIVATE_`
  sentinel.

## Confirmations

- `foreground-history.json` is never read; the terminal outcome came only from
  the `artifactPaths.metadataPath` published in the same persisted result.
- `executionDisposition: "detached"` remained a disposition, independent of the
  filled `status`.
- Terminal `exitCode: 0` became `succeeded`; a failed async completion became
  `failed`; provisional `-2` and absent metadata invented nothing.
- The metadata artifact cannot create an AgentRun: the timeout case still has no
  row, and no directory was scanned to find it.
- Native totals and child-usage breakdown are unchanged by the enrichment.

## Observations and residual gaps

Not defects of this patch; recorded for follow-up.

1. **Foreground timeout still has no row.** The persisted timeout result carries
   no child identity, so no exact reference exists and the row is not created
   (tracked as the E2 disclosure gap).
2. **Native-notification-only async run stays `unknown`.** With no persisted
   `bg_wait`/`subagent_wait` completion there is no durable terminal evidence;
   the row legitimately remains `unknown` with no agent.
3. **Detached effort stays provisional.** `durationMs`/`toolCalls` on the
   detached row are the detach-snapshot values and coverage is `partial`;
   terminal `durationMs`/`toolCount` are deliberately not consumed by ADR 0023.
4. **Contradictory provisional failure marker.** The settled detached row keeps
   the persisted provisional `failure: {reason: "output-absent"}` while its
   `status` is `succeeded`, because this decision fills only `status`. The UI
   cards do not count it as a failed run, and the terminal `_meta.json` publishes
   no output state, so Inspector cannot re-derive it. Flagged for a separate
   decision (clear or mark provisional); not changed here to keep the patch
   narrow.
5. **Known limitation (ADR 0023).** A detached run later interrupted through
   `subagent({ action: "interrupt" })` ends with `exitCode: 0` and no
   interruption discriminator in `_meta.json`, so it renders `succeeded`. The
   durable fix is upstream (include a terminal status in the metadata record).

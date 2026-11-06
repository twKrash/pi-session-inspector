# Compatibility audit: Pi 1.5.0 and pi-subagents 0.86.0

Audited against the checked-in Pi 1.2.0 fixtures, the persisted-evidence
contract in ADR 0022/0023, the installed Pi 1.5.0 runtime, and upstream release
sources for Pi 1.5.0 and pi-subagents 0.86.0. This records compatibility, not
feature parity: Inspector remains a persisted-session observer.

| Upstream change / version | Current Inspector behavior | Finding | Required regression test | Minimal disposition |
|---|---|---|---|---|
| Pi 1.5.0 moves tool argument validation to `@earendil-works/pi-schema`; plain JSON Schema coercion and error messages change. | Inspector does not validate extension tool schemas or consume validation-error text; it parses persisted message/tool-result shapes. | **No action:** the validator is not an Inspector boundary and these changes do not alter persisted entry semantics. | Keep Pi 1.2.0 tool-call/result replay; add a Pi 1.5.0 session fixture with coercion-independent serialized arguments. | No production change. |
| Pi 1.5.0 adds `Usage.cost.totalFromProvider` (`true` = provider-billed total; `false`/absent = catalog estimate under the 1.5.0 contract). | Usage normalization keeps `cost.total` but drops this bit; reports aggregate the number without its provenance. | **Required:** provider-reported and catalog-estimated totals become indistinguishable. Because persisted sessions do not identify the Pi release that wrote each usage record, absent metadata remains unknown across the supported 1.2.0 baseline rather than relabelling older records. | Replay true, false, absent and malformed values; assert numeric totals are unchanged and provenance is not guessed. | Preserve a bounded cost-provenance state through report aggregation; identified and unknown/mixed sources are not overstated. |
| Pi 1.5.0 adds message metadata such as concrete `responseModel`; tool/message types have additive fields. | Unknown fields are ignored; persisted entry parsing is shape-tolerant. | **No action:** additive metadata is not used for Inspector identity/accounting. | Include additive message metadata in the Pi 1.5.0 fixture and assert replay is unchanged. | No production change. |
| pi-subagents 0.86.0 `waitTool.name` permits a configured wait tool name; the documented default is `bg_wait`, with `subagent_wait` as an example override. | Inspector recognizes only `bg_wait` and `subagent_wait`; the adapter cannot classify another configured name. | **Required:** valid completion publications under another configured name are missed. Do not infer a run from a name or unchecked details. | A renamed wait result joins a successful persisted async launch by exact run ID; malformed/unjoined metadata produces no run. | Recognize only strictly validated completion evidence correlated to an exact observed launch; retain old aliases. |
| pi-subagents 0.86.0 changes workflow sandbox/recovery rules: older runs cannot resume across the update; relaunch uses `options.reuseFrom`, which may republish already-completed children. | Inspector reads persisted publication data only; ADR 0022 keys runs by producer identity, replaces same-surface repeats, and does not consult workflow recovery files. | **Test-only:** prove repeated reused-child publications remain one exact identity; Inspector must not resume workflows or infer status from bookkeeping/task order. | Replay a sanitized reuse publication and assert one reconciled child; separately assert native session totals exclude child usage. | Add regression fixture/test; no recovery subsystem or private-state reading. |
| pi-subagents 0.86.0 emits nested `subagent_launch` through Pi's `tool_call` permission event before launching a workflow child. | Pi extension hooks observe this in-process event; the persisted AssistantMessage/toolResult stream has no separate entry for the synthetic permission observation. Inspector reads persisted tool calls/results only. | **No action:** permission observation is not historical execution evidence and cannot establish success/failure. | Not applicable to persisted replay; retain tests that incomplete evidence does not create runs. | No production change. |
| pi-subagents 0.86.0 adds lifecycle/status metadata (including `safetySource`) and RPC/event capabilities. | Inspector consumes only allowlisted persisted identity/status/usage fields; unknown producer fields are ignored. | **No action:** additive fields do not alter the declared persisted projections or reconciliation boundaries. | Add an unknown-field case to the 0.86.0 fixture; verify existing validated fields still replay. | No production change. |
| pi-subagents 0.86.0 adds `subagent:jobs-changed` as a live refresh event. | Inspector observes persisted Pi JSONL and has no event subscription/polling for job state. | **Deferred:** useful for a separate live-refresh design, but not required for historical compatibility and would change the live observation boundary. | None in this PR. | Do not add event handling, polling, or orchestration. |
| Pi 1.2.0 remains the supported baseline. | Existing 1.2.0 sanitized fixtures and parsing remain supported. | **No action:** newer additive producer metadata must not narrow the accepted historical format. | Keep the 1.2.0 replay test in the same compatibility suite. | Preserve baseline unchanged. |

## Upstream references

- Pi 1.5.0 release: <https://github.com/earendil-works/pi/releases/tag/v1.5.0>
- Pi 1.5.0 AI types: <https://github.com/earendil-works/pi/blob/v1.5.0/packages/ai/src/types.ts>
- Pi 1.5.0 extension schema contract: <https://github.com/earendil-works/pi/blob/v1.5.0/packages/coding-agent/docs/extensions.md#tool-parameter-schemas-and-typebox>
- pi-subagents 0.86.0 release: <https://github.com/nicobailon/pi-subagents/releases/tag/v0.86.0>
- pi-subagents 0.86.0 configuration (`waitTool`): <https://github.com/nicobailon/pi-subagents/blob/v0.86.0/docs/configuration.md>
- pi-subagents 0.86.0 workflow contract: <https://github.com/nicobailon/pi-subagents/blob/v0.86.0/docs/workflows.md>
- Pi extension event semantics: <https://github.com/earendil-works/pi/blob/v1.5.0/packages/coding-agent/docs/extensions.md#tool-call-events>

CI runs the existing Pi 1.2.0 host leg and a matching Pi 1.5.0 host leg; both
run typecheck, the full test suite (including these fixtures), and architecture
invariants.

Runtime check: the compatible build was run under Pi 1.5.0 with pi-subagents
0.86.0 (`pi -ne -e <worktree> -e npm:pi-subagents`) and checked manually by the
maintainer. The development session that produced this change ran on that same
pair; its persisted launch, `subagent-notify`, and `subagent_supervisor_request`
entries were compared with the sanitized fixtures and share their shapes. The
fixtures stay synthetic and sanitized.

Finding from the same comparison: for plain async runs, pi-subagents 0.86.0
delivers completion as a persisted `subagent-notify` entry whose
`details.runs[]` row carries `agent`, `status`, `durationMs`, `runId` and
`asyncDir`, not as a `bg_wait` result. Inspector now consumes the exact-`runId`
`agent` and `status` (see the spec); model, tokens and cost remain unavailable
for these runs because no persisted entry carries them.

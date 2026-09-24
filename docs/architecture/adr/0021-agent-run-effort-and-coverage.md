# ADR 0021: Agent-run effort and coverage

## Status
Accepted for Item 13B.

## Decision
The Item 13B baseline, verified against `pi-subagents@0.70.1`, publishes bounded effort only from persisted foreground `results[]` `progressSummary.durationMs` and `progressSummary.toolCount`. Each row includes independent `effortCoverage`; that evidence was partial on the proven 0.70.1 foreground subset. Usage and cost remain child breakdowns and are never added to native session totals.

### 0.71.0 workflow evidence follow-up (2026-09-23)

The installed `pi-subagents@0.71.0` producer publishes `SingleResult.workflowKey` from the owning workflow child key and `WorkflowChildSummary.children[].childId` from that same key. The real JSONL publication contains both arrays in one `mode: "workflow"` details object; producer version is environmental because individual tool results do not stamp it.

The adapter attributes only existing bounded `progressSummary` and `usage` fields when a persisted workflow summary passes the supported v1 envelope checks: known envelope/child fields, bounded producer IDs, `inventoryComplete: true`, a recognized workflow state, and bounded arrays. `mode` must be `"workflow"` and `workflowRunId` must exactly equal `details.runId`; `parentToolCallId` is validated but never compared with the current tool-call ID because async publication can differ. A bounded `workflowKey` must exactly match one `childId`; missing, mismatched, or duplicate keys withhold only that key, while unrelated exact keys remain eligible. An unsupported envelope or child row rejects that publication’s correlation. A workflow child summary's own `usage` field is not accepted, even when numerically well-formed; only exact-key-matched result `usage` populates the child. The adapter does not infer effort from summary rows. It does not change row identity, status, parentage, or ordering, and does not merge result and workflow publication rows. No status/success inference or additive child accounting is introduced. The 0.70.1 evidence remains historical and unchanged.

Generations, per-run errors, and inferred duration are unavailable. `usage.turns` is usage metadata, not native generation evidence. Publication timestamps remain provenance only. Repeated observations use the existing opaque identity and latest accepted publication precedence; usage is replaced, never summed. Malformed or unbounded values are omitted and coverage is unavailable. Raw producer text, paths, IDs, payloads, and secrets never enter the DTO.

Canonical and report projections revalidate all fields. No new persistence path is introduced.

## Rejected inference

- No duration from timestamps or live status.
- No generations from turns, tools, ordering, or timestamps.
- No error count from error results.
- No parentage or cross-surface joins without a producer-proven identity.
- No additive child accounting.

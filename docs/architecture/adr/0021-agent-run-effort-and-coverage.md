# ADR 0021: Agent-run effort and coverage

## Status
Accepted for Item 13B.

## Decision
AgentRun publishes only bounded values present on persisted pi-subagents foreground result surfaces: `progressSummary.durationMs` as `durationMs` and `progressSummary.toolCount` as `toolCalls`. Each row always includes independent `effortCoverage`; these values are partial because they describe the proven foreground publication subset. Usage and cost remain child breakdowns and are never added to native session totals.

Generations, per-run errors, and inferred duration are unavailable. `usage.turns` is usage metadata, not native generation evidence. Publication timestamps remain provenance only. Repeated observations use the existing opaque identity and latest accepted publication precedence; usage is replaced, never summed. Malformed or unbounded values are omitted and coverage is unavailable. Raw producer text, paths, IDs, payloads, and secrets never enter the DTO.

Canonical and report projections revalidate all fields. No new persistence path is introduced.

## Rejected inference

- No duration from timestamps or live status.
- No generations from turns, tools, ordering, or timestamps.
- No error count from error results.
- No parentage or cross-surface joins without a producer-proven identity.
- No additive child accounting.

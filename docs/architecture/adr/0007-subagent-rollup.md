# ADR 0007: subagent roll-up

**Status:** accepted.

## Context

Pi's event bus is process-local. pi-subagents exposes public status/results/artifacts, but child sessions can be foreground, async, nested, missing, or different versions.

## Decision

Create `AgentRun` attribution only from public pi-subagents contracts/artifacts. Pi-native parent usage stays billing authority; child usage is a displayed breakdown and never added to parent total. Missing causal linkage is unavailable/unsupported, not timestamp-inferred.

## Alternatives considered

- Sum parent and children: rejected; double counts cost/tokens.
- Infer links from overlapping timestamps: rejected; false attribution.
- Instrument pi-subagents internals: rejected; private API/version drift.

## Consequences

Some child detail is intentionally absent. Fixtures pin foreground, async, nesting, and missing-artifact variants.

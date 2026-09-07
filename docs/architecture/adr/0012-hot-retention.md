# ADR 0012: maximum 14-day detailed retention

**Status:** accepted.

## Context

Original v1 requirement is a maximum 14-day detailed-data window. Retaining data for 14 inactive days lets a long-running or frequently resumed session keep Inspector detail indefinitely, violating that boundary.

## Decision

Retain Inspector detailed WAL and generated report cache for at most 14 calendar days from record/report creation. Writers rotate dated immutable segments at least daily. Maintenance deletes an expired segment only after validated checkpoint inclusion; checkpoints retain aggregates/cursors, not detailed telemetry. Explicit user-selected exports are outside Inspector cache retention and are warned/user-owned.

## Alternatives considered

- 14 inactive days: rejected; no fixed maximum.
- Delete whole session at day 14: rejected; discards useful aggregate/native replay.
- Keep one mutable WAL and rewrite prefixes: rejected; races concurrent append.

## Consequences

Cold reports may omit expired integration/timing detail but retain aggregate/native facts. Retention tests must prove no Inspector-held detail exceeds cutoff and no valid source is lost.

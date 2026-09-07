# ADR 0008: harness adapter

**Status:** accepted.

## Context

Pi is v1 target. Hermes offers related observer hooks and correlation IDs, but has a separate plugin/runtime model and is explicitly out of scope.

## Decision

Keep canonical records harness-neutral and isolate Pi replay/live observation behind a Pi adapter. Implement only Pi adapter in v1; declare Hermes unsupported rather than shipping a partial compatibility claim.

## Alternatives considered

- Build a multi-harness SDK now: rejected; abstraction without second implementation.
- Couple core reducer to Pi types: rejected; prevents an honest future adapter.
- Ship Hermes adapter in v1: rejected; expands support/testing matrix.

## Consequences

Pi-specific branch features are optional capabilities, not core assumptions. Hermes can map later without changing source precedence or report DTOs.

# ADR 0009: hybrid integrations

**Status:** accepted.

## Context

Some integration facts are persisted natively, some arrive only on public process-local events/artifacts, and some are not observable. Rendered output/private APIs are unstable and may expose content.

## Decision

Prefer Pi-native replay, then bounded live/cooperative public contracts. Every metric carries native/live/cooperative/inferred/unavailable/unsupported evidence. Never scrape output or import private integration APIs.

## Alternatives considered

- One generic tracer: rejected; duplicates payloads and loses source authority.
- Report all installed integrations as exact activity: rejected; enumeration is incomplete.
- Parse extension output: rejected; privacy and format fragility.

## Consequences

Integration capability is version-pinned in fixtures. Missing data appears explicitly rather than as zero or a guess.

# ADR 0006: branch scope semantics

**Status:** accepted.

## Context

Pi session entries form an `id`/`parentId` tree. Current workflow questions and billing/history questions need different selections; Pi does not provide durable branch IDs.

## Decision

Active scope is active-leaf ancestry intersected with entries after earliest valid tracking marker. Tree scope is all append-order entries after that marker. Current view defaults active; history/global resource views default tree. Reports describe a branch as selected leaf/path, never manufacture a native branch ID.

## Alternatives considered

- Always show full tree: rejected; current work would include abandoned siblings.
- Always show active path: rejected; resource totals omit valid historical work.
- Generate branch IDs: rejected; implies stability Pi does not promise.

## Consequences

Renderer choice remains independent from scope. Fork/clone remain separate sessions and are not silently combined.

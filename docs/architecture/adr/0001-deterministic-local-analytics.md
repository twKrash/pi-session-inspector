# ADR 0001: deterministic local analytics

**Status:** accepted.

Use deterministic reducers over local sources. Do not use LLM-generated analysis, cloud analytics, or server-side processing. Same normalized inputs must yield identical JSON. This makes metrics auditable and privacy boundary small.

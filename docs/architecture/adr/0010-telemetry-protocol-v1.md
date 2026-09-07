# ADR 0010: telemetry protocol v1

**Status:** accepted.

Use bounded, process-local, best-effort Pi bus envelope. Validate/redact before storage, no acknowledgements/cross-process claims, coalesce only counters/gauges. Protocol never requires Inspector dependency in producer.

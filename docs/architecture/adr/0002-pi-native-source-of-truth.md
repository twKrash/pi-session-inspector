# ADR 0002: Pi-native source of truth

**Status:** accepted.

Pi session JSONL is authority for persisted messages, usage, cost and tool results. Inspector never rewrites it; only namespaced `appendEntry` tracking marker is allowed. Inspector storage supplements non-reconstructable metadata.

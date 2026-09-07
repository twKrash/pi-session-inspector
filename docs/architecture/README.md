# Architecture decisions

Pi Session Inspector uses small, explicit ADRs. Canonical behavior lives in [v1 spec](../specs/pi-session-inspector-v1.md); these record why boundaries exist.

| ADR | Decision |
| --- | --- |
| [0001](adr/0001-deterministic-local-analytics.md) | deterministic local analytics |
| [0002](adr/0002-pi-native-source-of-truth.md) | Pi persisted data is source of truth |
| [0003](adr/0003-derived-ledger.md) | ledger is derived/lazy |
| [0004](adr/0004-per-writer-wal.md) | per-writer WAL |
| [0005](adr/0005-checkpoints-and-reconciliation.md) | leased checkpoints/reconciliation |
| [0006](adr/0006-branch-scope-semantics.md) | active/tree scope semantics |
| [0007](adr/0007-subagent-rollup.md) | non-additive subagent roll-up |
| [0008](adr/0008-harness-adapter.md) | Pi adapter now, Hermes later |
| [0009](adr/0009-hybrid-integrations.md) | evidence-aware integrations |
| [0010](adr/0010-telemetry-protocol-v1.md) | bounded local telemetry protocol |
| [0011](adr/0011-local-only-privacy.md) | local-only/redacted metadata |
| [0012](adr/0012-hot-retention.md) | sealed 14-day hot retention |

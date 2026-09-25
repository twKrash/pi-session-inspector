# ADR 0022: pi-subagents observability contract and reconciliation boundary

## Status

Accepted for PR B.

## Context

Pi session JSONL is the historical authority for native accounting and persisted cooperative subagent facts (ADR 0002). The persisted pi-subagents adapter already recognizes supported parent-session publications and can derive bounded `AgentRun` rows. The existing adapter also reads only archive references published in supported results; temporary producer files do not themselves form durable history.

The Inspector needs one compatibility contract for any future live enrichment and one owner for repeated-run semantics. That boundary must preserve existing persisted parsing, public run IDs, report rows, native totals, archive verdicts, and privacy guarantees.

## Decision

- **Historical authority:** persisted Pi session JSONL remains the authority for historical reports. Future live evidence may enrich current-session views only; it must not replace persisted history. Temporary producer artifacts, caches, and proofs are not durable history. Inspector may follow only a validated reference published in supported persisted evidence; it does not discover artifacts by scanning producer directories.
- **Fail-closed compatibility:** only the recognized RPC protocol v1 contract is eligible for future live enrichment. An unknown or malformed protocol disables the whole live contract as `unsupported`. Within v1, each allowlisted capability is projected independently: a recognized schema is `supported`, an absent capability is `unavailable`, and an unknown schema is `unsupported`. Additive unknown fields are ignored; producer payloads are not retained.
- **Activation prerequisite:** any future live consumer must validate `ping` for the same Pi session before activating a capability. It must use only the Inspector-owned validated capability matrix. This PR adds the pure validator and fixtures; it performs no ping, listener, polling, or live consumption.
- **L0 ownership:** producer adapters validate producer-specific shapes, bound and redact values, and emit ordered observations. Each observation carries a private opaque source identity derived only from validated producer identity and the stable publication order. L0 does not merge observations and does not expose raw producer IDs, payloads, or paths.
- **L1 ownership:** canonical reconciliation groups observations by exact private source identity. A cross-source merge requires an explicit, validated exact alias from source identity to private canonical identity and an already observed public `AgentRun.id`. Ambiguous or invalid aliases remain separate and produce bounded diagnostics. Names, labels, timestamps, array positions, paths, or similarity never establish identity. Public IDs are projected unchanged; private identities do not enter reports.
- **Accounting:** repeated observations select the latest valid published fields and preserve existing status/conflict behavior. Usage is selected, never summed. Child usage remains a breakdown and never contributes to parent or session totals.
- **Privacy and persistence:** no prompt, response, raw tool arguments/results, provider payload, secret, raw producer ID, path, or unbounded producer string enters Inspector WAL or report diagnostics. Pi session JSONL is never written by Inspector.
- **PR B boundary:** existing persisted parsing remains. This decision adds no missing async `AgentRuns`, `bg_wait` visibility, lifecycle-artifact ingestion, or changes to parent rendering or `executionKind`.

## Alternatives considered

- Keep repeated-run reconciliation inside the persisted adapter: rejected because L1 would not own shared canonical semantics.
- Use public IDs or infer identity from names, labels, timestamps, paths, or order: rejected because those values do not prove that two observations are the same run.
- Treat temporary producer artifacts or a live snapshot as historical authority: rejected because they are not durable history and may disappear or be incomplete.
- Fail every v1 capability when one capability is absent or unknown: rejected because supported v1 capabilities are independent and can degrade separately.
- Add live consumption or lifecycle reads in PR B: rejected; this PR establishes the contract and reconciliation boundary only.

## Consequences

- Persisted parsing remains intact while its output becomes a safe, ordered observation contract.
- L1 owns reconciliation, exact alias handling, and bounded conflict diagnostics; the current persisted path uses source identity directly and supplies no aliases.
- Existing public AgentRun IDs, row ordering, report DTOs, archive verdicts, and non-additive usage semantics remain unchanged.
- Future live enrichment requires same-session ping validation and capability-specific compatibility before any evidence is consumed.

## Related decisions

ADRs [0002](0002-pi-native-source-of-truth.md), [0007](0007-subagent-rollup.md), [0009](0009-hybrid-integrations.md), [0010](0010-telemetry-protocol-v1.md), [0011](0011-local-only-privacy.md), [0016](0016-evidence-foundation-and-canonical-session-model.md), and [0021](0021-agent-run-effort-and-coverage.md).

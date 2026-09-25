# ADR 0022: pi-subagents observability contract and reconciliation boundary

## Status

Accepted for PR B.

## Context

Pi session JSONL is the historical authority for native accounting and persisted cooperative subagent facts (ADR 0002). The persisted pi-subagents adapter already recognizes supported parent-session publications and can derive bounded `AgentRun` rows. The existing adapter also reads only archive references published in supported results; temporary producer files do not themselves form durable history.

The Inspector needs one compatibility contract for any future live enrichment and one owner for repeated-run semantics. That boundary must preserve existing persisted parsing, public run IDs, report rows, native totals, archive verdicts, and privacy guarantees.

## Decision

- **Historical authority:** persisted Pi session JSONL remains the authority for historical reports. Future live evidence may enrich current-session views only; it must not replace persisted history. Temporary producer artifacts, caches, and proofs are not durable history. Inspector may follow only a validated reference published in supported persisted evidence; it does not discover artifacts by scanning producer directories.
- **Fail-closed compatibility:** only the recognized RPC protocol v1 contract is eligible for future live enrichment. An unknown or malformed protocol disables the whole live contract as `unsupported`. Within v1, each allowlisted capability is projected independently: a recognized schema is `supported`, an absent capability is `unavailable`, and an unknown schema is `unsupported`. Additive unknown fields are ignored; producer payloads are not retained.
- **Process-local capability activation:** any future consumer of process-local producer capabilities—including RPC calls, ping-advertised capabilities, events/listeners, and live projection APIs—must validate `ping` for the same Pi session before activating a capability. It must use only the Inspector-owned validated capability matrix: recognized protocol v1, with per-capability schema validation. This PR adds the pure validator and fixtures; it performs no ping, listener, polling, or live consumption.
- **Referenced filesystem enrichment:** following a filesystem reference does not activate a process-local capability and does not require RPC `ping`. It may only enrich an `AgentRun` already proven from persisted Pi evidence; it must never create an `AgentRun`, become historical authority, weaken C1 identity rules, or alter native accounting. Enrichment is optional and fail-closed, and may read only a documented/versioned artifact through an explicit locator published by the same validated persisted producer result. No directory scanning or inferred paths are permitted. Its independent gate requires an already-validated persisted single async launch, explicit persisted `asyncDir`, lifecycle artifact version 3, `mode: "single"`, exact root `runId` match, exactly one step, and a present `status.sessionId` exactly equal to the parent Pi session-file path containing the persisted publication. Do not compare `status.sessionId` with Inspector's session UUID. Any missing, malformed, mismatched, or unsupported reference/artifact skips enrichment without affecting the proven C1 row.
- **C2 producer contract pin:** the currently investigated contract is `pi-subagents@0.71.0`, tag `v0.71.0`, release commit `4af5e85a427b9f87334585ae8d0eb365d4dd2a1e`, with `lifecycleArtifactVersion: 3`. Do not use `6f16d586bef814d74b3a2683cf297450ebfccb09` as the `0.71.0` package fingerprint.

- **L0 ownership:** producer adapters validate producer-specific shapes, bound and redact values, and emit ordered observations. Each observation carries a private opaque source identity derived only from validated producer identity and the stable publication order. L0 does not merge observations and does not expose raw producer IDs, payloads, or paths.
- **L1 ownership:** canonical reconciliation groups observations by exact private source identity. A cross-source merge requires an explicit, validated exact alias from source identity to private canonical identity and an already observed public `AgentRun.id`. Ambiguous or invalid aliases remain separate and produce bounded diagnostics. Distinct sources that collide on one public ID without an alias are withheld together and produce a bounded conflict diagnostic; canonical normalization never silently deduplicates them. Names, labels, timestamps, array positions, paths, or similarity never establish identity. Public IDs are projected unchanged; private identities do not enter reports.
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
- Future process-local capabilities require same-session ping validation and capability-specific compatibility before any evidence is consumed. Referenced filesystem enrichment follows its separate fail-closed reference/run/session/version gate; it does not activate process-local capabilities.

## Related decisions

ADRs [0002](0002-pi-native-source-of-truth.md), [0007](0007-subagent-rollup.md), [0009](0009-hybrid-integrations.md), [0010](0010-telemetry-protocol-v1.md), [0011](0011-local-only-privacy.md), [0016](0016-evidence-foundation-and-canonical-session-model.md), and [0021](0021-agent-run-effort-and-coverage.md).

# Milestone 5: integrations and agent roll-up

## Scope

Add local, versioned evidence adapters for Pi integrations and public pi-subagents artifacts. Extend report DTOs with bounded agent-run and integration rows. Existing current-session TUI tabs consume those rows when evidence exists.

## Evidence boundary

Adapters accept only explicit, already-local Pi entries or public integration artifacts supplied to Inspector. They never probe running extensions, scrape terminal output, import private integration APIs, call a network, or enumerate installed integrations.

Each adapter registers supported schema versions and returns one of `supported`, `unavailable`, or `unsupported`. Missing files, unknown versions, malformed artifacts, and missing parent linkage degrade to fixed diagnostics/confidence states; they never infer facts from timestamps or strings.

## Records and reports

`AgentRun` includes bounded run ID, explicit public parent ID when available, status, confidence, and optional child usage breakdown. Parent Pi-native usage stays billing authority. Child totals never add to parent/session usage.

Integration rows include integration key, schema version where known, evidence/confidence state, and bounded numeric counters only. No prompts, responses, raw tool input/output, paths, commands, provider payloads, or arbitrary producer strings enter records, WAL, reports, or diagnostics.

## Supported adapters

- Context Mode: `ctx_*` evidence only; no claimed savings.
- RTK: persisted `rtkCompaction` detail only; no rewrite-decision/savings claim.
- Modes: Pi custom entries only.
- Permission System: public permission events only.
- pi-subagents: public artifacts/status/results for foreground, async, nested, and tool-result variants only.
- Lens: generic native tool evidence only; no Lens-specific dashboard.

## Data flow

1. Pi adapter normalizes supported Pi entries without retaining private bodies.
2. Evidence registry validates integration/version and calls its pure adapter.
3. Canonical reduction/report projection includes agent and integration DTO rows.
4. TUI displays real evidence or existing unavailable/unsupported tab content.

## Tests

Pin sanitized fixtures for each supported entry/artifact variant. Cover known/unknown version, malformed/missing data, foreground/async/nested child runs, missing linkage, generic Lens use, and proof that child usage is not parent additive.

## Non-goals

No history/global UI, HTML/export, integration-specific runtime imports, live probing, provider tracing, private APIs, output scraping, network, dependencies, retention, or rich Lens dashboard.

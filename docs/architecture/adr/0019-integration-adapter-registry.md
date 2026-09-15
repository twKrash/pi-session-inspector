# ADR 0019: integration adapter registry, settings precedence, and the debug-log privacy boundary

**Status:** accepted.

## Context

Seven built-in integrations (`context`, `rtk`, `ponytail`, `caveman`, `permission`, `subagents`, `lens`, plus the legacy `mode` row) shipped, but every integration's knowledge was spread across core modules that had to be edited in lockstep:

| Site | Integration-specific knowledge |
| --- | --- |
| `src/core/events.ts` | `IntegrationKey` union |
| `src/integrations/presence.ts` | `SIGNALS` table and the key list |
| `src/integrations/pi-entries.ts` | `MODE_CUSTOM_TYPES`, `OBSERVATION_ORDER`, `ctx_*` folding, RTK shape readers, `lens` tool name |
| `src/integrations/evidence.ts` | `INTEGRATION_ALIASES` (`ctx` → `context`) |
| `src/core/integration-counter-allowlists.ts` | per-integration/version counter tables |
| `src/integrations/live-counters.ts` | permission bus channels, permission resolutions |
| `src/core/live-counter-fold.ts` | permission metric → counter translation |
| `src/core/reports.ts` | `INTEGRATION_KEYS`, `INTEGRATION_ORDER`, projection/validation |
| `src/core/retained-aggregates.ts` | retained aggregate key set |
| `src/ui/observation.ts` | observation default key list |
| `src/index.ts` | presence signal collection, live registration wiring, durable permission presence |
| `src/storage/checkpoint.ts` | persisted presence/aggregate shape |

The result was closed-world: one new integration meant touching enums, presence switches, Pi-entry parsing, counter allowlists, report order, validation, retained aggregates, observation defaults, tests, and sometimes live subscriptions. Two of those lists could silently disagree (a key present in the report order but missing from the counter table, or vice versa), and `Present / Unavailable` gave no reason for the mismatch, so integration defects could only be diagnosed by reading every site.

Separately, the Inspector had no settings surface (only the `--theme` CLI flag) and no internal debug facility, so a real-session defect such as a persisted `durationMs: 0` had no instrumented boundary to point at.

This ADR records the architecture that replaces the scattered tables, and the two boundaries (configuration precedence, debug-log privacy) that the diagnostic facility depends on. It does not change the semantics of ADR 0009 (hybrid integrations), ADR 0010 (telemetry protocol v1), ADR 0011 (local-only privacy), ADR 0014 (durable live integration evidence), or ADR 0015 (presence model); it relocates their implementation to one owner per integration.

## Decision

### One adapter owns one integration's knowledge

`src/integrations/contract.ts` defines a capability-based interface. An adapter declares identity, report order, and its versioned schema, and *optionally* implements the capabilities it actually has:

```ts
interface IntegrationAdapter {
  readonly key: string;                 // bounded token
  readonly order: number;               // report order
  readonly schemas: Readonly<Record<number, { counters: readonly string[] }>>;
  readonly aliases?: readonly string[]; // accepted evidence key spellings
  readonly legacyOnly?: boolean;        // key validates, but has no row/presence

  detectPresence?(context: PresenceContext): IntegrationPresence;
  readPersistedEvidence?(context: PersistedEvidenceContext): IntegrationEvidence | undefined;
  registerLive?(context: LiveIntegrationContext): IntegrationRegistration | undefined;
  contributeCanonical?(context: CanonicalIntegrationContext): CanonicalIntegrationContribution;
}
```

Capabilities are separate methods rather than one mandatory set so a counter-only integration (ponytail) and a rich one (subagents) both fit without either stubbing methods it does not have or forcing rich evidence into generic counters. `subagents` keeps its `agents`/`agentActivity` contribution through `contributeCanonical`; its row-level empty schema is simply what that adapter reports for counters.

The Ponytail adapter, for example, is the only place that knows: which extension command signals Ponytail presence, that `ponytail-mode` custom entries are Ponytail evidence, that its v1 schema has a `changes` counter, and that a malformed entry yields `malformed-evidence` rather than a guess.

### One authoritative registry, everything else derived

`src/integrations/registry.ts` validates a static adapter list once and exposes the derived views every generic consumer needs: known keys, report order, presence defaults, schema/counter tables, alias lookup, adapter lookup, live registrations, persisted-evidence readers, and retained-aggregate key sets.

```ts
export const integrations = createIntegrationRegistry([
  contextAdapter,
  rtkAdapter,
  ponytailAdapter,
  cavemanAdapter,
  permissionAdapter,
  subagentsAdapter,
  lensAdapter,
  legacyModeAdapter,
]);
```

There is no second hand-maintained `INTEGRATION_KEYS`, `INTEGRATION_ORDER`, `SIGNALS`, `COUNTER_KEYS`, or retained-aggregate key table. Adding a normal built-in integration is one adapter file, one registry entry, and its tests/docs.

Construction is fail-fast on defects the developer controls (duplicate key, duplicate order, duplicate `key:version` schema, empty or duplicated counter name, malformed key/alias token) and per-adapter fault-isolated on defects the producer controls (presence read, persisted read, live registration, canonical contribution). A throwing adapter degrades only its own row to `unknown`/`unavailable` with a bounded reason; it never aborts report construction, never affects another adapter, and never alters Pi execution.

### Trusted keys are registry membership, not a duplicated union

`IntegrationKey` is no longer a hand-written union that has to be extended in `core`. The registry derivation provides a compile-time key type from the adapter list itself:

```ts
export type IntegrationKey = RegisteredIntegrationKey<typeof integrationAdapters>;
```

and the runtime boundary is registry membership. Producer input stays untrusted: an evidence payload's key must match a registered adapter (or alias) after bounded-token validation, its version must be one the adapter declares, and its counter names must be in that version's allowlist. Extensibility never weakens validation — a producer cannot invent a key, a counter name, a schema version, a reason code, or a free-text diagnostic by adding a registry-shaped object.

### Presence and evidence stay separate, with a bounded reason

The presence model of ADR 0015 is unchanged: `present` from a native signal or from evidence itself, `absent` only when the inventory is available and the defined signal is missing, `unknown` otherwise, and `permission`/`rtk` never inferred `absent`. Presence is still never installation proof and never activity.

What is new is that every adapter result carries a bounded `IntegrationEvidenceReason` from a closed enum — for example `not-present`, `presence-only`, `no-persisted-evidence`, `no-live-evidence`, `unsupported-schema`, `malformed-evidence`, `registration-failed`. Reasons are canonical Inspector vocabulary, never producer text, and are available to debug logging and tests. The normal UI wording does not change in this milestone.

### Skills, resources, and MCP tools are not integrations

An integration adapter describes a **known semantic protocol** with a versioned evidence contract that Inspector interprets. A skill is a **dynamically discovered generic resource**: it is inventoried (`inventory.json`) and its `/skill:<name>` invocations are counted by generic skill infrastructure, which needs no adapter. Graphify is therefore an ordinary discovered skill unless and until it exposes extra structured telemetry worth interpreting, at which point a specialized skill observer adapter is the extension point. Likewise MCP servers stay tool sources; no Inspector integration exists per MCP server without an MCP-specific semantic telemetry contract.

### Dependency direction

```text
core/events (types only)
      ↑
integrations/contract  ←  integrations/adapters/*  →  registry.ts
      ↑                                                   ↑
core/{reports,canonical,retained-aggregates}, ui/* ←──────┘
```

Adapters may import `core` types and helpers, but never `core/reports`, the UI, the loaders, or the composition root. `registry.ts` imports contracts and adapters only. `dependency-cruiser` enforces that no adapter imports a report/UI/loader/entry module, so the direction cannot silently invert.

### Settings precedence

The Inspector gains one authoritative settings loader for `<agentDir>/session-inspector/settings.json` (the Pi `getAgentDir()` convention; the versioned data root stays `session-inspector/v1`). The schema is intentionally small:

```json
{ "theme": "dark", "debug": false }
```

Resolution is `explicit CLI option > settings.json > product default`. `--theme light` overrides `"theme": "dark"`; `--debug` enables debug logging for that invocation even when settings say `false`; `"debug": true` enables it by default. Malformed, unreadable, oversized, or unknown-shaped settings degrade to product defaults with one bounded debug diagnostic and never prevent Inspector from starting. Browser-local state (the in-page theme toggle) stays ephemeral and never overwrites the durable configured default.

### Debug-log privacy boundary

Debug logging is a local diagnostic facility, not telemetry:

- off by default; enabled only by resolved debug configuration;
- Inspector-owned path under the storage root, structured JSONL, bounded records, bounded size with rotation/truncation, mode `0o600`, no network;
- never rendered in TUI/browser/snapshot/JSON reports, never folded into counters, never canonical evidence;
- every logger failure is swallowed and never alters Inspector execution;
- **never** prompts, responses, tool args, tool result bodies, environment variables, secrets/tokens, arbitrary producer text, unrestricted paths, or raw third-party payloads. Only explicitly allowlisted structured fields are written, correlated by existing canonical opaque/digest identities rather than raw producer IDs.

The debug facility is what makes the integration reasons of this ADR and the tool-duration boundary observable; the privacy rules of ADR 0011 are unchanged by enabling it.

## Alternatives considered

- **Abstract base class per integration.** Rejected: forces unrelated capability stub implementations and hides which capabilities an adapter actually has.
- **One mandatory method set for every adapter.** Rejected: subagents' rich run/activity evidence would either be flattened into counters (losing ADR 0007 semantics) or stubbed everywhere else.
- **Dynamic third-party plugin loading in this milestone.** Rejected: the closed-world problem is an internal maintenance cost; external loading adds trust, versioning, and sandboxing requirements that are out of scope. The registry stays a static, statically-typed list of trusted adapters.
- **Keep the hand-written `IntegrationKey` union and only move the tables.** Rejected: the union is one of the scattered lists; adding an adapter would still require a core edit.
- **Derive validation from producer-declared schemas at runtime.** Rejected: producer values are untrusted; validation metadata must come from the adapter, not the payload.
- **Reuse Pi's own `settings.json`.** Rejected: Inspector must not write or reinterpret Pi's user configuration; a file it owns keeps the observer boundary.
- **A debug log next to the inspected session files or in a temp dir.** Rejected: it would either write near Pi data or lose the storage-root privacy (mode, retention, discovery) Inspector already applies.

## Consequences

- Adding a normal built-in integration is one adapter, one registry entry, tests, and docs.
- Report order, presence defaults, version/counter validation, retained-aggregate keys, and observation defaults are registry-derived by construction; a new adapter cannot forget them.
- `Present / Unavailable` becomes explainable through bounded reasons, which the debug facility can surface without putting raw data in the UI.
- Existing public report semantics, privacy rules, determinism, and retention behaviour are unchanged; the migration is expected to keep the existing suite green, and any semantic difference it exposes is treated as a defect to be fixed deliberately in the UAT phase, not silently during the move.
- The adapter list is static and trusted; external plugin loading remains a future feature with its own ADR.

# ADR 0019: integration descriptors, catalog, and subsystem orchestration, settings precedence, and the debug-log privacy boundary

**Status:** accepted. Supersedes the runtime-registry model described by an earlier revision of this ADR.

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

The result was closed-world: one new integration meant touching enums, presence switches, Pi-entry parsing, counter allowlists, report order, validation, retained aggregates, observation defaults, tests, and sometimes live subscriptions.

A first attempt replaced those tables with a runtime `IntegrationRegistry` object that validated registrations **and** orchestrated every operation (`readPresence`, `readPersistedEvidence`, `registerLive`, `foldTelemetry`, `contributeCanonical`, lifecycle, disposal, fault isolation). That solved the closed-world problem but produced a framework: ~500 lines of generic orchestration whose main consumer was itself, duplicate configuration (`order` metadata *and* array position), and a place where every subsystem's behavior had to be routed even though the subsystem already knew how to do the work.

## Decision

### An integration describes itself

```ts
type Integration = {
  key: string;
  aliases?: readonly string[];
  schemas: IntegrationSchemas;
  legacyOnly?: boolean;
  hooks?: {
    presence?(context: PresenceContext): IntegrationPresence;
    persisted?(context: PersistedEvidenceContext): IntegrationEvidence | undefined;
    live?(context: LiveIntegrationContext): IntegrationRegistration | undefined;
    telemetry?(envelope: unknown): IntegrationTelemetryFold | undefined;
    canonical?(context: CanonicalIntegrationContext):
      | CanonicalIntegrationContribution
      | undefined
      | Promise<CanonicalIntegrationContribution | undefined>;
  };
};
```

Metadata is data; behavior is a small set of **separate optional typed hooks**. An integration implements only the hooks its protocol actually has, so nothing stubs a capability it does not own.

### `src/integrations/index.ts` declares which integrations Inspector supports

```ts
export const integrations = defineIntegrations([
  contextIntegration,
  rtkIntegration,
  ponytailIntegration,
  cavemanIntegration,
  permissionIntegration,
  subagentsIntegration,
  lensIntegration,
  legacyModeIntegration,
]);
```

Opening that file answers, in ten seconds: which integrations exist, their report order, and where to add another one. **The array order is the report order**; there is no numeric `order` field to keep in sync with the array, and nothing sorts.

### The catalog validates and looks up; it does not orchestrate

`src/integrations/catalog.ts` holds:

- `defineIntegration` — one definition's local validation (key grammar, schema versions, counter-name grammar, alias grammar, legacy-only alias rejection) while preserving the literal key;
- `defineIntegrations` — collection-level validation (duplicate key, alias collisions, legacy-only integrations may not own hooks), freezing, and the explicit list;
- pure lookup helpers — `reportIntegrations`, `rowKeys`, `findIntegration`, `resolveIntegrationKey`, `isKnownIntegrationVersion`, `isAllowedIntegrationCounter`, `integrationCounters`, `primaryVersion`.

It exposes no `readPresence`-style methods.

### Subsystems iterate the list and invoke the hook they own

| Operation | Owner | Shape |
| --- | --- | --- |
| Presence | `src/integrations/presence.ts` | observed sighting wins, else `hooks.presence`, bounded reason, fault-isolated |
| Persisted evidence | `src/integrations/persisted.ts` | `hooks.persisted` → row/schema/counter validation → rows and reasons |
| Live registration | `src/integrations/live-counters.ts` | `hooks.live` → disposers, registered once, disposal isolated |
| Telemetry folding | `src/core/live-counter-fold.ts` | `hooks.telemetry` → stamp `integration.key` → generic counter/presence application |
| Rich canonical contribution | `src/integrations/contributions.ts` | `hooks.canonical` → keyed contributions |

The loops are deliberately boring:

```ts
for (const integration of list) {
  const hook = integration.hooks?.telemetry;
  if (hook === undefined) continue;
  try {
    const value = hook(envelope);
    if (value !== undefined) return { integration: integration.key, ...value };
  } catch {
    // One failing integration never blocks another.
  }
}
```

Fault isolation, bounded reasons, deterministic order, and "unavailable is not zero" stay exactly as they are; they simply live where the operation happens instead of inside one registry object.

### Rejected: import-time self-registration

`registerIntegration(x)` called at module scope was rejected: hidden global state, import-order coupling, module-cache interaction in tests, and unclear ownership of the supported set. The explicit array is the single ownership point, and it is also the report-order contract.

### Rejected: one generic callback

`integration.cb({ type: "presence", … })` was rejected: it erases capability-specific types, forces every integration into switch statements and union return values, and makes "which hooks does this integration have?" invisible at the declaration site. Optional typed hooks keep both the typing and the declaration readable.

### Keys and validation

`IntegrationKey` is derived from the composition array by plain indexed access (no conditional-type derivation of a key universe). Producer input stays untrusted everywhere: an evidence payload's key must resolve through the catalog (or an alias), its version must be declared, and its counter names must be in that version's allowlist. A legacy-only key validates historical rows but never resolves as a report key.

### Presence and evidence stay separate, with a bounded reason

The presence model of ADR 0015 is unchanged: `present` from an inventory signal or from a live/durable observation, `absent` only when the inventory is readable and the defined signal is missing, `unknown` otherwise, and `permission`/`rtk` never inferred `absent`. Every presence and evidence result carries a bounded `IntegrationEvidenceReason` from a closed enum; reasons are canonical Inspector vocabulary, never producer text, and the normal UI wording does not change in this milestone.

### Skills, resources, and MCP tools are not integrations

An integration adapter describes a **known semantic protocol** with a versioned evidence contract that Inspector interprets. A skill is a **dynamically discovered generic resource**: it is inventoried and its `/skill:<name>` invocations are counted by generic skill infrastructure, which needs no integration entry. Graphify is therefore an ordinary discovered skill unless it exposes structured telemetry worth interpreting, at which point a specialized skill observer is the extension point. Likewise MCP servers stay tool sources; no Inspector integration exists per MCP server without an MCP-specific semantic telemetry contract. `docs/integrations.md` is the contributor-facing guide for this distinction.

### Dependency direction

```text
core/events (types only)
      ↑
integrations/contract  ←  integrations/adapters/*  →  integrations/catalog
      ↑                                                      ↑
integrations/{presence,persisted,contributions,index} ──────┘
      ↑
core/{reports,canonical,retained-aggregates}, ui/*
```

Adapters may import the contract and their own helpers, never a subsystem, report, UI module, or the composition root. `integrations/index.ts` imports the catalog and the adapters only — it imports no subsystem, so no cycle exists. `dependency-cruiser` enforces the direction.

#### Layer boundaries across `core`, `pi`, and `storage`

```text
core      — semantic contracts, canonical model, reduction, report projection
pi        — Pi adapter / L0 source reading, parsing, and lifecycle wiring
storage   — Inspector-owned persistence: WAL, checkpoint, inventory snapshot, lease, retention
```

| Direction | Status |
| --- | --- |
| `core → integrations` | allowed: catalog/contract lookups (this ADR) |
| `core → pi`, `core → storage` | type-only allowed; the single runtime edge is `core/canonical.ts → pi/scope.ts`, a pure I/O-free scope rule (ADR 0006/0016 semantics). Moving it into `core/` is the trivial follow-up if a zero-exception boundary is wanted. |
| `pi → storage` | sanctioned: the Pi adapter (L0) reads Inspector-owned sources (ADR 0016) |
| `storage → pi` | forbidden at runtime except `pi/telemetry.ts` (producer envelope validation on the single WAL write/recovery path) and `pi/sessions.ts` (marker/scope reading used by maintenance); type-only imports such as the `TrackingStorage` port stay allowed |
| `integrations → pi`/`storage` | forbidden at runtime: integrations interpret payloads handed to them by L0/L1 |
| `integrations → core/{canonical,reports,reduce,retained-aggregates}`, `ui`, `commands`, `src/index.ts` | forbidden: those are consumers, not inputs |

The dependency graph intentionally retains one directory-level SCC spanning `core`, `integrations`, `pi`, and `storage`. It contains no file-level cycle and every edge is one of the sanctioned directions above; breaking it would require speculative restructuring (an injected validation/source provider), so it is not treated as a release blocker. `dependency-cruiser` enforces the permitted edges, not the absence of the SCC.

### Settings precedence

The Inspector gains one authoritative settings loader for `<agentDir>/session-inspector/settings.json` (the Pi `getAgentDir()` convention; the versioned data root stays `session-inspector/v1`). The schema is intentionally small:

```json
{ "theme": "dark", "debug": false }
```

Resolution is `explicit CLI option > settings.json > product default`. A missing file is the default configuration; malformed, unreadable, or oversized settings degrade to the product defaults with one bounded debug diagnostic and never prevent Inspector from starting. Browser-local state (the in-page theme toggle) stays ephemeral and never overwrites the durable configured default.

### Debug-log privacy boundary

Debug logging is a local diagnostic facility, not telemetry:

- off by default; enabled only by resolved debug configuration;
- Inspector-owned path under the storage root, structured JSONL, bounded records, bounded size with rotation/truncation, directory `0o700`, files `0o600` (enforced on pre-existing paths too), no network;
- if a required private mode cannot be enforced, the sink fails closed and stops writing rather than persisting diagnostics at a wider mode;
- never rendered in TUI/browser/snapshot/JSON reports, never folded into counters, never canonical evidence;
- every logger failure is swallowed and never alters Inspector execution;
- **never** prompts, responses, tool args, tool result bodies, environment variables, secrets/tokens, arbitrary producer text, unrestricted paths, or raw third-party payloads. Only explicitly allowlisted structured fields are written, correlated by existing canonical opaque/digest identities rather than raw producer IDs.

Instrumentation sits at the subsystem boundaries (the loops above) and on the tool-duration pipeline, not inside a registry object. A healthy operation reports itself once: a bounded `*-summary` event (a replay, a correlation) carries per-operation counts, so one report read over N healthy records writes O(1) diagnostic lines. The per-record events stay for the anomalies an operator acts on — a malformed or unavailable replay, an uncorrelated call (capped per operation), duplicate or conflicting evidence, and rejected integration evidence.

## Alternatives considered

- **Runtime registry object with orchestration methods.** Rejected: framework-shaped, duplicate configuration, and every subsystem's behavior routed through a layer that adds nothing. The catalog keeps only what registration needs.
- **Import-time self-registration.** Rejected: hidden side effects, import-order coupling, global mutable state, test isolation problems.
- **One generic capability callback.** Rejected: loses capability-specific typing, forces internal switches and union handling into every integration.
- **Numeric order metadata plus sort.** Rejected: two sources of truth for one contract.
- **Elaborate compile-time key derivation.** Rejected: runtime boundaries already validate untrusted producer keys; the type stays ergonomic without conditional-type machinery.
- **Dynamic third-party plugin loading.** Out of scope: the supported set is a static, trusted list.
- **Reuse Pi's own `settings.json`.** Rejected: Inspector must not write or reinterpret Pi's user configuration.
- **A debug log next to inspected session files or in a temp dir.** Rejected: it would either write near Pi data or lose the storage-root privacy (mode, retention, discovery) Inspector already applies.

## Consequences

- Adding an ordinary integration is one definition file, one line in `src/integrations/index.ts`, focused tests, and one `docs/integrations.md` matrix row — with no edits to reports, retention, canonical projection, generic telemetry folding, observation defaults, or UI integration lists.
- Generic machinery shrinks: no registry object, no derived key tables, no numeric order, no duplicate configuration.
- Presence/evidence semantics, privacy rules, determinism, retention behavior, and the settings/debug boundaries above are unchanged.
- One integration failing cannot break another; live registrations are disposed exactly once; reasons stay bounded and closed.

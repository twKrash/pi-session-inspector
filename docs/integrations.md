# Integrations

An **integration** is a known semantic protocol: Inspector understands the evidence that producer writes and turns it into bounded, reportable facts. Adding one is meant to be boring — a descriptor, one re-export line, one registration line, focused tests, and a row in the matrix below.

- Composition root: [`src/integrations/index.ts`](../src/integrations/index.ts) — the one place that declares which integrations Inspector supports, in report order.
- Contract: [`src/integrations/contract.ts`](../src/integrations/contract.ts) — the descriptor and its optional typed hooks.
- Catalog: [`src/integrations/catalog.ts`](../src/integrations/catalog.ts) — definition validation and lookup only.
- Rationale: [ADR 0019](architecture/adr/0019-integration-adapter-registry.md).

## Supported integrations

| Integration | Presence source | Persisted evidence | Live hook | Rich evidence | Telemetry / notes |
| --- | --- | --- | --- | --- | --- |
| `context` | any listed tool name starting with `ctx_` | `ctx_*` custom entries and native `ctx_*` tool calls, folded by **maximum** (one invocation is never counted twice) | no | no | `calls` |
| `rtk` | none by design — never inferred `absent` | `message.details.rtkCompaction` (native and versioned shapes collapse to one contract) | no | no | `compactions`, `sourceChars`, `compactedChars`, `sourceLines`, `compactedLines`, `truncated` |
| `ponytail` | extension command `ponytail` | `ponytail-mode` custom entries | no | no | `changes`; the extension writes one entry per explicit mode change, so a present command with no change is `Present / Unavailable` |
| `caveman` | extension command `caveman` | `caveman-level` custom entries | no | no | `changes`; same explicit-change rule, and entries before Inspector's tracking marker are outside the tracked scope |
| `permission` | generic observed live/durable `permissions:ready` sighting | — | yes: `permissions:ready`, `permissions:ui_prompt`, `permissions:decision` | no | `decisions`, `allowed`, `denied`, `prompts`, `promptToolCall`, `promptSkillInput`, `promptSkillRead`, `gateErrors` |
| `subagents` | native `subagent`, `subagent_wait`, `subagent_supervisor` tools | persisted tool results (`details.results[]` / `details.completions[]`) | no | yes: runs and native subagent activity reach the Agents view | The integration row declares **no counters**; its schema is intentionally empty |
| `lens` | any listed tool named `lens`, or starting with `lens_`, `pi_lens_`, `lsp_`, `ast_grep_` | tool calls matching that same vocabulary | no | no | `calls` |
| `mcp` | adapter tool vocabulary: `mcp`, `mcpScript`, or `mcp__<server>` proxies | `mcp-approval-v1` session entries, re-validated against the declared shape | yes: `pi-mcp-adapter/status/v1` | no | `toolApprovals`, `iframeApprovals`, `iframeDenials`; the runtime status snapshot is a presence sighting, never a counter, and server/tool names plus hashes are never retained |
| `mode` (legacy) | — | — | — | — | Validates historical rows and counters only; never a report row, presence entry, or hook |

Evidence states: `supported` (evidence observed and parsed), `unavailable` (the integration may be installed but produced no observable evidence), `unsupported` (evidence exists but its shape or version is not understood).

### Reading a row

Presence and evidence are independent claims:

- **Present / Unavailable** — the integration is installed (a command or tool name matched) but Inspector saw no evidence of activity in the tracked scope. A mode-change integration that was never asked to change mode looks exactly like this, and so does an extension whose evidence predates Inspector's tracking marker.
- **Present / Supported** — installation plus evidence; counters are the evidence's own counts.
- **Unknown** — no signal at all (no readable inventory, and no live or durable observation). Installation is never guessed.
- `absent` is only reported when the inventory is readable and the defined signal is missing. `permission` and `rtk` are never inferred `absent`.

Counters are never fabricated: an unobserved integration is `unavailable`, never `0`.

## How to add an integration

1. Create `src/integrations/adapters/foo.ts`.
2. Export `defineIntegration({ ... })` with the metadata and only the hooks you need.
3. Add it once to the array in `src/integrations/index.ts` (position = report order).
4. Add focused tests for its mapping (`input evidence → bounded result`).
5. Add a row to the matrix above.

A complete example:

```ts
// src/integrations/adapters/foo.ts
import { defineIntegration } from "../catalog.ts";
import { toolCallNames } from "./shared.ts";

const FOO_TOOL = "foo_run";

export const fooIntegration = defineIntegration({
  key: "foo",
  aliases: ["foo-legacy"],
  schemas: { 1: { counters: ["runs"] } },
  hooks: {
    presence: ({ tools }) => (tools.includes(FOO_TOOL) ? "present" : "absent"),
    persisted: ({ entries }) => {
      let runs = 0;
      for (const entry of entries) {
        const names = toolCallNames(entry);
        if (names === undefined) continue;
        runs += names.filter((name) => name === FOO_TOOL).length;
      }
      if (runs === 0) return undefined;
      return {
        integration: "foo",
        state: "supported",
        version: 1,
        counters: { runs },
        reason: "evidence-supported",
      };
    },
  },
});
```

```ts
// src/integrations/index.ts
export const integrations = defineIntegrations([
  contextIntegration,
  // …
  fooIntegration,
  legacyModeIntegration,
]);
```

### The architectural acceptance rule

> Adding an ordinary integration must not require edits to reports, retention, canonical projection, generic telemetry folding, observation defaults, or UI integration lists.

If a new integration seems to need one of those edits, the hook it needs is missing — add a hook to the contract and let the subsystem that owns that operation iterate it, rather than adding a name to a list somewhere else.

### Hooks

| Hook | Called by | Purpose |
| --- | --- | --- |
| `presence(context)` | `src/integrations/presence.ts` | Inventory-based presence verdict for this integration |
| `persisted(context)` | `src/integrations/persisted.ts` | Read this integration's persisted evidence into a bounded row |
| `live(context)` | `src/integrations/live-counters.ts` | Register live subscriptions; return a disposer |
| `telemetry(envelope)` | `src/core/live-counter-fold.ts` | Translate one telemetry envelope into counters and/or a presence sighting |
| `canonical(context)` | `src/integrations/contributions.ts` | Contribute rich evidence (for example subagent runs) that is not a counter |

Every subsystem fault-isolates per integration: one integration throwing degrades its own row to a bounded reason and never blocks another. Reasons are a closed vocabulary (`evidence-supported`, `no-persisted-evidence`, `unsupported-schema`, `malformed-evidence`, `presence-failed`, `evidence-failed`, `registration-failed`, `fold-failed`, `contribution-failed`, …) — never producer text.

## Integration vs Skill vs Tool/MCP

- **Integration adapter** — Inspector understands a specific semantic protocol or evidence format. It has a key, versioned counters, and usually a presence signal.
- **Skill** — a dynamically discovered generic resource. Inspector inventories skills and counts `/skill:<name>` invocations with generic infrastructure; no integration entry is needed, and one should not be added just because a skill exists.
- **Tool / MCP server** — normally a tool or a tool source. Tool names participate in an integration's presence vocabulary when that is meaningful, but there is no integration per MCP server; add one only when the server has a real semantic telemetry contract (a versioned evidence envelope Inspector can interpret). `mcp` is the one current example: it is the `pi-mcp-adapter` protocol, not a row per connected server — its versioned approval entry and status event are the contract, and no server identity is retained.
- **Specialized skill observer** — the exception: when a skill intentionally exposes richer structured telemetry, give it a hook (or an integration) then, with its own versioned contract.

Graphify is therefore an ordinary discovered skill: inventory plus `/skill:graphify` invocation counting. It would only get specialized treatment if Inspector deliberately consumed structured Graphify-specific telemetry.

## Privacy and bounds

Integration code may only read the bounded fields a hook needs. Evidence never carries prompts, tool arguments or results, environment values, secrets, unrestricted paths, or raw producer payloads; producer-supplied keys, versions, and counter names are re-validated against the catalog at every boundary. The debug log has its own allowlisted field vocabulary and never becomes canonical evidence (ADR 0019).

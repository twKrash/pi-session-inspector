# Pre-M8 evidence coverage & resource inventory — design

**Status:** design for approval. No production code exists for this milestone yet.
**Scope:** the milestone inserted between M7 and M8. M8 hardening/release is explicitly out of scope.
**Predecessors:** [v1 spec](../../specs/pi-session-inspector-v1.md), [implementation plan](../../plans/pi-session-inspector-v1-implementation.md), [ecosystem research](../../research/pi-ecosystem.md), ADR 0006–0013.

## 1. Problem

M4–M7 shipped replay, live WAL, checkpoint/recovery/history, retention, current TUI and HTML/JSON report paths. Auditing every claimed adapter against the actual pinned producer format found four classes of gap, plus two UX gaps.

### 1.1 Audit results (evidence, not inference)

| Area | Claimed | Actual producer | Result |
| --- | --- | --- | --- |
| Ponytail mode | `mode` counter from versioned custom entries | `pi.appendEntry("ponytail-mode", { mode })`, modes `off\|lite\|full\|ultra\|review`, **no `schemaVersion`** (`pi-extension/index.js:96`, `hooks/ponytail-config.js:14`) | Adapter drops every entry: `readCustom()` requires `schemaVersion` (`src/integrations/pi-entries.ts:115`) |
| Caveman mode | same | `pi.appendEntry("caveman-level", { level })`, levels `off\|lite\|full\|ultra\|wenyan-lite\|wenyan\|wenyan-ultra\|micro`, **no `schemaVersion`** (`extensions/caveman.ts:284,334`) | Same drop. Real sessions in this repo contain `caveman-level` in 7/7 files; Inspector reports nothing |
| Permission System | counters from `permissions:ready\|ui_prompt\|decision` custom entries | process-local **bus events** on those channel names with typed payloads, "published types plus package semver define the contract" (`src/service/permission-events.ts`) | Adapter reads a surface no producer writes: always absent |
| pi-subagents | `--subagents-artifact` accepts `{version:1, runs:[{id,parentId,status,usage}]}` | **no pinned producer writes that shape.** Verified producers: `foreground-history.json` `{version:1, runs:[{runId,mode,cwd,sessionId,updatedAt,children[]}]}`; `completion-replay/<runId>.json` `{version:1,runId,sessionId,completedAt,expiresAt,archivePath,completion}`; `output-archives/<runId>.json` `{version:1,runId,createdAt,entries[{agent,resultIndex,source,path}]}` | Manual, invented input; normal pi-subagents runs require a hand-made file |
| Commands / Skills | tabs | `pi.getCommands()` returns `{name, description?, source: extension\|prompt\|skill, sourceInfo{path, source, scope, origin, baseDir?}}` (`types.d.ts:1001`); skills are `skill:<name>` entries with `source:"skill"` | No inventory path exists; both tabs are permanently `Unavailable` |
| Errors | classification only | Pi persists `errorMessage?: string` on assistant messages (`docs/session-format.md:89`) | Report cannot show the persisted message |
| Command UX | `current\|history\|global\|ledger` + `--format` | — | Invalid input returns the generic "Inspector command options are unavailable."; no completions, no help, no initial theme |

Real-session evidence collected for UAT: 174 `subagent` and 46 `subagent_wait` tool results with populated `details` (`details.results[]`, `details.completions[]` carrying `runId`, `agent`, `success`, `usage{input,output,cacheRead,cacheWrite,cost,turns}`, `artifactPaths`, `sessionFile`, `archivePath`, `workflowChildren{version,inventoryComplete}`).

### 1.2 Producer versions to pin

| Producer | Installed (UAT, evidence source) | Latest | Action |
| --- | --- | --- | --- |
| Pi | `0.85.1` (unchanged) | — | keep |
| pi-subagents | `0.59.0`, integrity `sha512-EOzArN0fU3AUQT+bjtq/8DfW8nSySTV43Qw97QFyChYBFX+GfmO3b7CgtelUfBqfg4gYmcq50B4MguAExIYM1g==`, `gitHead 45c0b41` | `0.67.0` | re-pin research to the verified installed shapes; unknown fields ignored |
| Permission System | `@gotgenes/pi-permission-system@31.1.3`, integrity `sha512-AoEQ+Q31qAahpF01g7jN8YCCHDhKJApag6Cmcfe5qTxP7DlDbm+1GbHrrPYCQG+0Y1a1/Vc/Qytwam32UDpWVw==` | `32.0.2` | pin 31.1.3 payload contract |
| Caveman | `1.0.8` | `1.0.8` | keep; commit `8d326c4` |
| Ponytail | local HEAD `356918e` | — | keep; note commit drift from research |
| Context Mode / Lens / RTK | `1.0.169` / `4.1.6` / `0.9.0` | — | unchanged |

## 2. Scope

### In scope

1. Evidence model that distinguishes *not observed* from *adapter broken/unavailable*.
2. Producer-accurate fixes for Ponytail, Caveman, Permission System, pi-subagents.
3. Native resource inventory: commands, skills, and a generic source inventory from `getCommands()` + `getAllTools()`, with bounded explicit skill invocations and per-tool source attribution.
4. Durable live evidence: foreign public bus events → existing WAL telemetry record → fold → checkpoint aggregate → reports (works across `/resume` and for history/global within retention).
5. Bounded error message derived from Pi-persisted assistant data, with path/URL/secret redaction.
6. Command interface: positional `ui|tui|json` modes, one complete self-contained UI bundle for `ui`, theme, help, native completions, and removal of the invented `--subagents-artifact` contract.
7. Fixtures, tests, spec/ADR/doc updates, version bump.

### Out of scope (explicit)

M8 hardening/release; Hermes; Lens-specific view; RTK rewrite telemetry; child Pi session replay for subagent usage; per-session retention configuration; German/Russian catalogs; new runtime dependencies (no SQLite, daemon, network, or browser/server addition); raw tool-call/prompt/output capture anywhere.

## 3. Evidence model

`IntegrationKey` becomes `context | rtk | ponytail | caveman | permission | subagents | lens`; the legacy `mode` key is accepted by the report projection for compatibility but is no longer produced by any adapter.

`IntegrationObservation` becomes a per-integration row for **every** known key so absence is explicit, ordered deterministically:

```ts
type IntegrationPresence = "present" | "absent" | "unknown";

type IntegrationObservation = {
  integration: IntegrationKey;
  presence: IntegrationPresence;
  state: EvidenceState;        // supported | unavailable | unsupported
  version?: number;            // adapter schema version, only when supported
  counters?: Readonly<Record<string, number | boolean>>;
};
```

- `presence` — from native inventory, never from guesses: `pi.getCommands()` command names and `pi.getAllTools()` tool names observed at command time, plus a live bus sighting for Permission System. `unknown` when inventory itself is unavailable (history/global for a foreign process).
- `state: "supported"` — producer evidence was observed and parsed this session (or was folded from durable WAL/checkpoint evidence for that session).
- `state: "unavailable"` — producer may be present but produced no observable evidence (nothing persisted, nothing on the bus, or surviving detail expired).
- `state: "unsupported"` — evidence exists but its version/shape is not supported by the adapter (this is the "adapter broken/drifted" signal).

`presence` never implies activity; `state` never implies installation. Report copy keeps the existing rule: evidence availability is not installation status.

## 4. Producer fixes

### 4.1 Ponytail and Caveman (schema-less mode entries)

- Read `customType === "ponytail-mode"` `data.mode` and `customType === "caveman-level"` `data.level` **without** requiring `schemaVersion`. Unknown/missing/oversize values are ignored, never coerced.
- Accepted values are exact closed sets pinned in fixtures: Ponytail `off|lite|full|ultra|review`; Caveman `off|lite|full|ultra|wenyan-lite|wenyan|wenyan-ultra|micro`.
- Split the single `mode` integration key into `ponytail` and `caveman`. Each keeps the generic counter contract: v1 `{ changes }`. Rationale: two independent producers and two independent presence signals; a merged row cannot say which producer fired.
- Legacy `mode` v1 evidence (`changes` counter) stays accepted by the report projection for compatibility, but the entry adapter no longer emits it.

### 4.2 Permission System (public bus, not custom entries)

- Remove `PERMISSION_CUSTOM_TYPES` from the entry adapter entirely. Permission evidence never comes from Pi entries.
- Subscribe to the public channels through Pi's public event bus seam: `permissions:ready`, `permissions:ui_prompt`, `permissions:decision` (payloads typed and semver-owned by the producer; no `protocolVersion`).
- Map to a fixed bounded counter set, never to producer text:
  - `decisions` (total), `allowed`, `denied`;
  - `prompts` (total), `promptToolCall`, `promptSkillInput`, `promptSkillRead`;
  - `gateErrors` (`resolution === "gate_error"`).
  `resolution` classes fold into allowed/denied/gateErrors; `origin`, `value`, `matchedPattern`, `agentName`, `forwarding`, `request` are **never** read into any persisted or rendered value.
- `permissions:ready` is idempotent-by-contract and repeats per session; treat it as presence only (`presence: "present"`), never as a counter.
- Absent bus = `unavailable`, never `0`.

### 4.3 Commands, skills, and resource sources inventory

- Source: `pi.getCommands()` **and** `pi.getAllTools()` at command time, one call per report each, deduplicated by `(name, source)`.
- Per command keep only: `name` (bounded ASCII token, ≤64 bytes), `source` (`extension|prompt|skill`), `sourceLabel`, `scope` (`user|project|temporary`), `origin` (`package|top-level`), and an optional bounded `description`.
- `sourceLabel` is a normalized label, never a raw path or URL:
  - `local`, `auto`, `builtin` pass through when exact;
  - `npm:<name>` when the producer value matches `npm:<valid-npm-name>[@<semver>]` (version dropped);
  - anything else → `other`. URLs, file paths, credential-shaped and over-long values never pass through.
- `sourceInfo.path` and `sourceInfo.baseDir` are dropped at the adapter boundary, never persisted, never rendered.
- `description`: kept only if single-line after control-character stripping, ≤120 bytes, and not secret-like and not path-like; otherwise `description` is omitted. Never required.
- Skills are the `source === "skill"` subset; the `skill:` prefix is stripped to the bounded skill name (inventory cross-check set).
- **Inventory is not invocation count.** Commands have no invocation counter: Pi does not persist slash-command invocations, and Inspector will not infer them.

**Generic resource-source inventory.** The sanitized `(sourceLabel, scope, origin)` groups observed across commands, skills, prompts, and tools form one generic source inventory. This is how other loaded/available extensions (pi-web-access, todo, MCP-backed tools, plannotator, web-search, gsd, and any future package) appear without a dedicated integration adapter:

```ts
type ResourceSourceRow = {
  sourceLabel: string;                 // §4.3 normalization
  scope: "user" | "project" | "temporary";
  origin: "package" | "top-level";
  commands: number; skills: number; prompts: number; tools: number;
};
type ResourceInventory = { state: EvidenceState; items: readonly ResourceSourceRow[] };
```

- Rows are sorted by `(sourceLabel, scope, origin)` and capped (≤64 rows); counts are **loaded/available resources**, never activity, invocation, usage, effectiveness, or installation status. Report copy states this explicitly.
- MCP-registered and third-party tools appear under their normalized vendor source label when `sourceInfo.source` normalizes, else `other`; builtin and SDK tools appear as `builtin`/`sdk`.
- **Tool source attribution.** Every observed tool call row gains `tools[].source`: the source label of that tool name from `getAllTools()`. It is `absent` when the name is not in the current inventory (removed/renamed source) and the UI renders `Unavailable`. Never inferred from tool-name prefixes, and never persisted.
- Only `name` and `sourceInfo` are read from `getAllTools()`. `description`, `parameters`, and `promptGuidelines` can carry instruction or content text and are **never** read, persisted, or rendered.

### 4.4 Explicit skill invocations (live, bounded)

Boundary change approved in brainstorming: Inspector subscribes to Pi's `input` event **only** to count explicit `/skill:<name>` invocations.

Rules, all testable:

1. Handler returns nothing (default `continue`). It never transforms, blocks, handles, or throws.
2. It reads `event.text`, and only ever inspects a prefix. Everything after the skill name — arguments, prompt text, the remainder of the line — is discarded immediately and never stored, logged, or rendered.
3. The name is accepted only if the token matches `^[A-Za-z][A-Za-z0-9._:-]{0,63}$` **and** exactly matches a currently listed `source === "skill"` inventory name. Unknown names count nothing.
4. Accepted invocation increments a counter for that skill name in durable evidence (§5). No path, body, or description is involved.
5. Model-driven skill loads (`read`/`bash` on `SKILL.md`) are **not** observable safely and stay explicitly `unavailable`. Inspector never infers usage from tool names, file reads, or context.
6. Failure isolation: any throw inside the handler is swallowed; a probe test asserts the handler never rejects and never returns a value.

### 4.5 pi-subagents (automatic discovery)

Replace the manual artifact requirement with a replay-derived pipeline:

**Layer 1 — native tool activity (always, `native` confidence).** From persisted entries: every `toolCall` whose name is `subagent`, `subagent_wait`, or `subagent_supervisor`, joined to its tool result by `toolCallId`. Produces `AgentToolActivity`:

```ts
type AgentToolActivity = {
  state: EvidenceState;                 // supported when ≥1 subagent tool call exists
  calls: number;
  succeeded: number;                    // result.isError !== true
  failed: number;                       // result.isError === true
  interrupted: number;                  // call with no matching result in scope
  tools: readonly { name: string; calls: number }[];
  usage?: Usage;                        // aggregate tool-result usage, breakdown only
};
```

`usage` is the sum of persisted tool-result `usage` for those call ids — already part of the session's `usageComposition.toolResults`, therefore **never** added to session totals and rendered with the existing "breakdown only · never added" note.

**Layer 2 — rich child runs (cooperative, replay).** From `details.completions[]` (`subagent_wait`) and `details.results[]`/`details.runId` (`subagent`), when the shape validates:

- `id`: deterministic opaque `subagent-<sha256>` from the producer run id (existing derivation, unchanged);
- `parentId`: the completion's own run id when a child `runId` differs, else absent;
- `agent`: bounded label token (≤64 bytes, safe-token grammar) or absent;
- `status`: mapped from documented `success`/`state`/`exitCode`/`isError` vocabulary; unknown → `unknown`, never guessed;
- `usage`: mapped only from a fully valid `{input, output, cacheRead, cacheWrite, cost}` group, with `totalTokens = input + output + cacheRead + cacheWrite` (producer sums all four, `subagent-wait.ts:319-336`); partial groups → `usage` absent, never zero-filled;
- `artifacts`: `available` | `missing` | absent, from the validated archive reference below.

Unknown `details` fields are ignored. Malformed entries produce no rows (never a fabricated row). Absent `details` degrades to Layer 1 only — the Agents tab is never empty when native subagent activity exists.

**Layer 3 — validated published artifact reference.** When a run publishes `archivePath`:

- must be an absolute path, existing regular file (no FIFO/symlink traversal), size ≤128 KiB;
- JSON with `version === 1` and `runId` strictly equal to the referencing tool-result run id;
- only `entries.length` and per-entry `agent` tokens are read; `entries[].path` and every other field are ignored and never persisted.
Validation failure → `artifacts: "missing"` for that run; the report never exposes the path.

**Manual artifact flag removed.** `--subagents-artifact` and the `{version:1, runs:[…]}` reader are removed from the command contract and the codebase (`readPublicSubagentArtifact`, `readSubagentRuns`, their fixture and tests). No pinned producer ever wrote that shape, and automatic discovery now covers foreground, async, workflow, and nested runs; keeping an invented input format would preserve a false contract. If a genuine published artifact contract later needs a manual entry point, it re-enters with verified provenance and its own ADR. The flag is rejected as an unknown option with usage help.

**Not in scope:** replaying child Pi session files (`results[].sessionFile`) for native child usage. Recorded as a deliberate deferral: it would add bounded re-replay cost and a second usage precedence rule; producer metadata plus native tool activity satisfies this milestone.

### 4.6 Adapter schemas, presence signals, and allowlists

Every key keeps the existing versioned-counter contract. v1 counter keys (report projection rejects anything else):

| Key | v1 counters | Producer |
| --- | --- | --- |
| `context` | `calls` | `ctx_*` tool use and `ctx_*` custom entries, folded by maximum |
| `rtk` | `compactions`, `sourceChars`, `compactedChars`, `sourceLines`, `compactedLines`, `truncated` | `details.rtkCompaction` |
| `ponytail` | `changes` | `ponytail-mode` custom entries |
| `caveman` | `changes` | `caveman-level` custom entries |
| `permission` | `decisions`, `allowed`, `denied`, `prompts`, `promptToolCall`, `promptSkillInput`, `promptSkillRead`, `gateErrors` | public bus counters via WAL fold |
| `subagents` | — (rows come from `agentActivity`/`agents`) | persisted tool results |
| `lens` | `calls` | `lens` tool calls and `pilens:*` evidence |
| `mode` (legacy) | `changes` | projection-only compatibility |

Presence signals (native inventory only; a signal is a bounded name match, never a heuristic):

| Key | `present` when | `absent` when |
| --- | --- | --- |
| `ponytail` | command `ponytail` listed | inventory available and no such command |
| `caveman` | command `caveman` listed | inventory available and no such command |
| `context` | any listed tool name starts with `ctx_` | inventory available and none does |
| `subagents` | any listed tool name is `subagent`, `subagent_wait`, `subagent_supervisor` | inventory available and none is |
| `permission` | live `permissions:ready` seen this process | never inferred from absence |
| `lens` | any listed tool name starts with `lens_`, `pi_lens_`, `lsp_`, or `ast_grep` | inventory available and none does |
| `rtk` | evidence observed | never inferred from absence |

Rules that keep this honest: `present` also holds when evidence exists even if the signal table has no entry; `absent` requires both an available inventory and a defined signal; every other combination stays `unknown`. Renamed or unknown producers therefore degrade to `unknown`, never to a false `absent`.

### 4.7 RTK, Context Mode, Lens

Unchanged semantics, including `unavailable != 0`:

- RTK: persisted `details.rtkCompaction` only; `compactions`, `sourceChars`, `compactedChars`, `sourceLines`, `compactedLines`, `truncated`.
- Context Mode: `ctx_*` tool use and `ctx_*` custom entries folded by maximum (existing single-invocation rule), `calls` counter only; savings stay unavailable.
- Lens: `lens` tool calls and version-pinned `pilens:*` evidence if present; rich Lens view stays out of scope.

## 5. Durable live-evidence pipeline (option B)

Live-only evidence (permission counters, skill invocations) must survive `/resume` and participate in history/global folds. It reuses the existing WAL telemetry record; no new record kind, no new store.

### 5.1 Write path

1. Producer adapters translate public producer events into bounded telemetry envelopes and call the session writer's `appendTelemetry`, which already validates through `validateTelemetry` before persisting (`src/storage/wal.ts:325-335`).
2. Envelopes:
   - Permission System: `source: "permission-system"`, `metric: "permission.decision"` / `"permission.prompt"` / `"permission.ready"`, `kind: "counter"`, `value: 1`, dimensions limited to `result: allow|deny`, `resolution: <class>`, `promptSource: tool_call|skill_input|skill_read`.
   - Skill invocation: `source: "pi-input"`, `metric: "skill.invocation"`, `kind: "counter"`, `value: 1`, dimensions `{ skill: <inventory-validated name> }`.
   - Only `kind: "counter"` participates in the fold. `event`/`gauge` remain write-only for now (ordering ambiguity is not worth solving here).
3. The extension keeps the current writer handle so a command handler can `flush()` before folding. Flush-before-read replaces any in-memory counter shadow: one source of truth, no double counting.
4. WAL layout is unchanged: `sessions/<sessionId>/wal/<writerId>/<YYYY-MM-DD>[.NNNN].jsonl`. Resume adds a new writer shard; previous shards remain readable.

### 5.2 Fold path

`recoverSession` (or a sibling sharing its segment reader, budgets, ordering and cursor semantics) additionally folds allowlisted telemetry counters:

- hard-coded fold table (integration → metric → dimension mapping → bounded counter key); unknown metrics/dimensions are ignored, never generic-keyed;
- counters sum across writers; overlap is impossible because the fold is cursor-based (already-checkpointed records are skipped);
- caps: reused budgets (`256` writers, `1024` segments, `64 MiB`, `100 000` records, `16 MiB` file, `64 KiB` line), plus a per-session counter cap (`≤64` skill keys, `≤16` counter keys per integration);
- output: `counters: Record<IntegrationKey, Record<string, number>>` plus the sealed-cursor information already available.

### 5.3 Checkpoint aggregates

- Additive optional field `aggregates.integrationCounters` (validated: allowlisted keys, safe non-negative integers, bounded key count). `schemaVersion` stays `1`; absence means "not folded yet".
- Maintenance writes `existing + newly folded` under the lease (never re-adding already-checkpointed records), preserving the existing no-cursor-regression rule.
- Consequence: after a segment is sealed and pruned at the 14-calendar-day cutoff, its counters survive as aggregates. Sealed cursors continue to mean "detail gone"; counters are not detail.

### 5.4 Report semantics

- Current session: flush → fold WAL from checkpoint cursor → add checkpoint aggregates.
- History/global: per manifest-discovered session, fold with existing read budgets; a global fold keeps a total byte/record budget and degrades the remainder to `unavailable` with a diagnostic rather than scanning unbounded.
- If a session has sealed detail and no folded counters (older Inspector data), the row reports `unavailable`, never `0`.
- Determinism (PRD-01): for a fixed WAL set and checkpoint, the fold is order-independent (integer sums) and byte-stable in JSON output.

## 6. Inventory snapshot (persisted, bounded)

Skills/commands inventory is process-scoped and cannot be reconstructed for a session resumed in another process. To keep the tabs meaningful for history/global:

- At tracking promotion, Inspector writes `sessions/<sessionId>/inventory.json` (analyzer-owned, `schemaVersion: 1`): the sanitized §4.3 rows (`name`, `source`, `sourceLabel`, `scope`, `origin`, optional bounded `description`), capped (≤256 commands, ≤128 skills, ≤64 KiB file). No paths, no bodies, no invocation data.
- Refresh triggers, all bounded and idempotent: (1) session start after tracking promotion; (2) a `resources_discover` event with `reason === "reload"` (Pi's own resource-reload signal, so newly loaded skills/prompts/extensions are picked up); (3) any report load, where the just-observed sanitized row set is hashed and compared with the persisted snapshot — a changed hash triggers one atomic rewrite, an unchanged hash writes nothing. Dynamic runtime registrations (for example an extension registering agents/commands after start, or an MCP server connecting late) are therefore captured at the next report load at the latest; Inspector never polls and never watches the filesystem.
- Written once per session and refreshed only when that comparison reports a change (atomic rename, user-only permissions).
- Retention: deleted by the existing maintenance pass once older than the 14-calendar-day cutoff; totals survive in the additive checkpoint field `aggregates.resourceCounts: { commands: number; skills: number }` (same validation rules as `integrationCounters`).
- History/global: inventory rows within retention; counts after expiry; `state: "unavailable"` (with the count, when known) beyond that. Never a fabricated empty inventory.

## 7. Errors

- `ErrorRecord` gains `message?: string`.
- Source: the assistant message's persisted `errorMessage` only (Pi-persisted, native confidence). Tool-error records keep classification only — arbitrary tool-result text is never read, stored, or rendered.
- Bounds: single line after stripping control characters; ≤200 bytes; secret-like values replaced by `[REDACTED]`, path-like fragments by `[PATH]`, URL-like fragments by `[URL]`, using one shared bounded-redaction module (`src/core/redact.ts`) so entry reduction, adapters and telemetry share the same implementation; over-length values are truncated with an explicit marker.
- Path/URL redaction is mandatory, not optional: `errorMessage` commonly embeds filesystem and provider locations. Recognized and redacted: POSIX absolute paths and `~/` paths with ≥1 separator (`/home/dev/project/.env` → `[PATH]`, `/tmp/report.json` → `[PATH]`), Windows drive paths (`C:\Users\dev\secret.txt`, `C:/Users/dev/x`), UNC paths (`\\server\share\x`), `file://` URLs, and any `scheme://…` URL including ones with userinfo or query tokens. Bare slash pairs without a leading anchor (`text/html`, `and/or`, `1.2/3.4`) are not treated as paths, so ordinary error prose survives.
- Redaction is defense-in-depth, not a sharing guarantee; the existing "local report" warning stays.
- If a record has no message (tool errors, older data, redacted to nothing), the field is absent and the UI renders `Unavailable`.

## 8. Command interface

### 8.1 Grammar

```text
/session-inspector [ui|tui|json] [target] [options]
/session-ins ...                                  # identical alias

modes
  ui       self-contained HTML report in the browser (complete Inspector UI)
  tui      interactive Pi full-screen TUI
  json     deterministic JSON export

targets
  tui   current | ledger          (default current)
  json  current | history | global (default current)
  ui    — none: the HTML report already carries Current session / Session history / Global report navigation

options
  --scope active|tree     default: active for current/ledger/tui-current; tree only for json history|global
  --theme dark|light      ui only
  --output PATH           ui, json
  --no-open               ui only
  help | --help | -h      usage panel
```

- No arguments behaves as today's common case: `/session-inspector` → `tui current`.
- `--format` is removed. `current|history|global|ledger` as a first token is no longer a target; both now produce usage help naming the replacement, never the generic failure message.
- Invalid combinations (unknown mode/target/option, missing or empty value, `--scope active` with `json history|global`, `--theme` with `tui`/`json`, `--output` with `tui`, `--no-open` with `json`) return one-line usage plus `Run /session-inspector help`.
- Runtime unavailability keeps its own distinct message (current session unavailable / history TUI unavailable) so "bad syntax" and "no data" are never conflated.

### 8.2 Theme

- `--theme dark|light` selects the initial HTML theme: the rendered document carries `theme-dark` when dark, and the in-page toggle keeps working from that state (label reflects the current theme).
- `--theme` on `tui`/`json` is rejected with usage — Inspector does not silently invent semantics for modes where it means nothing.

### 8.3 Help and completions

- `help` / `--help` / `-h` opens a compact full-screen `ctx.ui.custom()` panel (esc/q closes; width-safe via `truncateToWidth`) listing modes, targets, options, defaults, and 3–4 valid examples only. No invalid combinations are advertised.
- `getArgumentCompletions(prefix)` is implemented on both command registrations and is token-aware:
  - bare/partial first token → `ui`, `tui`, `json`, `help`;
  - after a mode → that mode's targets;
  - after `-`/`--` → the option names valid for that mode;
  - after `--theme` → `dark`, `light`; after `--scope` → `active`, `tree`;
  - returns `null` when nothing valid matches (never a fabricated suggestion).
- Parsing, completion and help remain deterministic and covered by table-driven tests.

### 8.4 UI bundle contract (`ui` mode)

`/session-inspector ui` produces **one** self-contained document containing the complete Inspector UI — Current, History, and Global — with the existing in-page navigation between them. It is not three separate exports and it does not need three invocations.

```ts
type InspectorBundle = {
  schemaVersion: 1;
  theme: "light" | "dark";
  scope: Scope;                              // applies to the Current section only
  current: { availability: "available" | "unavailable"; report?: SessionReport };
  history: HistoryReport;                    // existing loader and semantics (tree scope)
  global: GlobalReport;                      // existing loader and semantics (tree scope + range)
};

export function loadInspectorBundle(input: InspectorBundleInput): Promise<InspectorBundle>;
export function renderInspectorBundle(bundle: InspectorBundle): string;
```

- **Loader.** `loadInspectorBundle` composes the existing loaders in order — current (replay + live evidence, identical to `tui`/`json current`), history (manifest-bounded, existing budgets), global (existing fold). It is the single production loader for `ui`; the renderer never loads data itself and never re-derives scope.
- **Scope semantics.** `--scope` selects the Current section's entry set (`active` default, `tree` optional). History and Global keep their existing fixed `tree` semantics and are never silently re-scoped; the in-page scope control reloads the current section only.
- **Degradation.** Any section that fails to load becomes `availability: "unavailable"` with a diagnostic while the rest of the document still renders. Sections never show fabricated zeros, and a bundle with an unavailable current section is still a valid, complete document.
- **Internals.** The existing `HtmlReport` union stays as the per-section projection; the bundle composes the three projections into one document with one nav, one theme, and one scope control.
- **Determinism and privacy.** Escaped inline JSON payload, no network, no CDN, no server; byte-identical output for identical inputs; scope and theme are the only render options.
- `history`/`global` remain non-targets of `ui`: machine-readable exports stay available as `/session-inspector json history|global`.

## 9. Report DTO and renderer changes

```ts
type SessionReport = {
  // existing fields unchanged
  tools: Tool[];                       // Tool gains optional `source?: string` (inventory label)
  commands: { state: EvidenceState; items: readonly CommandRow[]; count: number | null };
  skills: {
    state: EvidenceState;              // inventory availability
    items: readonly SkillRow[];        // invocations per name when folded
    invocationState: EvidenceState;    // explicit-invocation evidence availability
    invocationCount: number | null;
  };
  resources: ResourceInventory;        // §4.3 generic source inventory
  agentActivity: AgentToolActivity;
  agents: AgentRun[];                  // rich layer, unchanged shape + optional agent/artifacts
  agentEvidence: EvidenceState;        // rich layer availability
  integrations: IntegrationObservation[];  // now one row per known integration
  errors: ErrorRecord[];               // + optional bounded message
};
```

- The `ui` mode consumes `InspectorBundle` (§8.4), whose `current` section is exactly this `SessionReport`; `tui` and `json` consume the report or its history/global siblings.

- Global report adds: `inventory: { commands: number | null; skills: number | null; resources: number | null }` and per-integration folded totals with the same `presence`/`state` semantics.
- TUI/HTML/JSON all consume this same DTO (invariant 7). HTML: Commands/Skills tabs render inventory tables with explicit "inventory ≠ invocations" copy; Agents tab renders `agentActivity` above the rich rows and never shows an empty panel when native activity exists; Integrations tab renders presence + evidence + version + counters with distinct labels for `not observed`, `unavailable`, `unsupported`, plus the generic Resource sources table (loaded/available only); Errors tab gains the bounded message column.
- All new fields are additive; existing field semantics are unchanged. JSON output for a given input remains byte-identical across runs.

## 10. Privacy invariants (test-enforced)

Never persisted, logged, or rendered, in any path added by this milestone:

- prompts, assistant/user text, tool arguments, tool-result bodies, command outputs;
- tool `description`, `parameters`, and `promptGuidelines` from `getAllTools()` (instruction text; only names and source metadata are read);
- raw `errorMessage`: only the bounded, redacted form may leave the reducer;
- filesystem paths: `sourceInfo.path`/`baseDir`, artifact/session paths, WAL and storage paths, `archivePath`, `entries[].path`, and path fragments inside error messages;
- skill bodies, skill descriptions that are path-like or secret-like;
- permission `value`, `matchedPattern`, `request`, `forwarding`, `agentName`, `origin`;
- raw `sourceInfo.source` values that are URLs or paths;
- raw producer IDs (subagent ids stay hashed).

The existing privacy corpus test is extended to seed these fields in every new fixture and assert absence from adapter output, report JSON, HTML, and TUI lines.

## 11. Storage, schema, and versioning

| Change | Kind | Compatibility |
| --- | --- | --- |
| `aggregates.integrationCounters`, `aggregates.resourceCounts` in checkpoint | additive, validated, `schemaVersion` stays 1 | absence = not folded; strict validation retained |
| `sessions/<id>/inventory.json` | new analyzer-owned artifact, `schemaVersion: 1` | missing → inventory `unavailable`, never empty |
| WAL telemetry counters | existing record kind, allowlisted fold | unknown metrics ignored |
| `IntegrationKey` + `mode` → `ponytail`/`caveman` | report/evidence key change | legacy `mode` v1 accepted in projection |
| Report JSON fields | additive | deterministic JSON preserved |
| `--subagents-artifact` flag + `{version:1, runs:[…]}` reader | removed | breaking CLI/feature removal documented in CHANGELOG; unknown-option usage help replaces it |
| Package version | `0.6.1 → 0.7.0` | minor: new features; changelog records the command-syntax migration (`--format`/targets → positional modes) and the artifact-flag removal |

**Downgrade-write semantics (`schemaVersion` stays 1).** A 0.7.0 checkpoint may carry `integrationCounters` and `resourceCounts`. A 0.6.x process reading such a checkpoint ignores those unknown aggregate fields (its reader keeps its known keys) and its next maintenance write recomputes aggregates from the Pi source alone, thereby **dropping** the folded live counters and resource counts. Accepted consequences, documented rather than hidden: no corruption, no crash, and Pi data is untouched; on a later 0.7.0 run, counters are refolded for every session whose WAL detail is still present; counters for sessions whose segments were already sealed and pruned become permanently `unavailable` (never `0`), while inventory rows are re-derived from the on-disk snapshot and their counts from WAL when available. Rationale for keeping version `1`: the fields are additive and only carry cooperative live evidence, whereas a version bump would make 0.6.x treat the whole checkpoint as unreadable — losing sealed-cursor knowledge, which is the more dangerous failure mode. 0.7.0 therefore never writes state it cannot itself re-read, and never depends on the new fields to authorize a seal or deletion.

## 12. Fixtures and tests

### Fixtures (sanitized, real-session-shaped)

`tests/fixtures/pi/0.85.1/`: `ponytail-caveman.jsonl`, `error-message.jsonl`, `subagent-tool-results.jsonl` (foreground, async `subagent_wait` with `details.completions`, workflow children with `workflowChildren.version`).
`tests/fixtures/integrations/`: `commands-inventory.json`, `tools-inventory.json`, `permission-events.json`, `subagent-archive-v1.json`, `inventory-snapshot.json`, plus an invalid-set directory (bad version, wrong run id, oversize, path-like fields, FIFO case).
`tests/fixtures/bundles/`: `inspector-bundle.json` (three sections, one section unavailable) for loader/renderer determinism.
Provenance note per fixture: producer name, version, integrity, symbol/field, and that content is synthetic.

### Tests

1. **Producers** — Ponytail/Caveman schema-less entries counted, unknown values ignored, both rows independent; permission events folded to the fixed counter set including `gate_error`; no payload field reaches output.
2. **Inventory** — source label normalization table (`local`, `auto`, `npm:pkg@1.2.3` → `npm:pkg`, URL/path → `other`), description policy, path/body exclusion, dedup, caps; generic resource-source grouping from commands + tools (including `builtin`/`sdk`/MCP-registered groups) with counts that never claim activity; tool `source` attribution present for known tools, absent for unknown ones.
3. **Skill invocations** — accepted only with inventory match; `/skill:unknown` counts nothing; argument text never stored; handler never throws/returns; model-driven loads stay unavailable.
4. **Subagents** — Layer 1 activity from real-shaped results (never empty when calls exist); rich rows from completions/results with partial-usage → absent; unknown status → `unknown`; archive validation matrix (missing, oversize, wrong version, wrong run id, symlink/FIFO); `--subagents-artifact` is rejected with usage help and the invented reader is gone.
5. **Durability** — counter written → folded for current report → survives seal/prune via checkpoint aggregates → history row shows folded counters; two-writer (simulated `/resume` across processes) fold sums without double counting; flush-before-read has no gap.
6. **Expiry** — sealed + pruned detail with folded counters reports counters, not zero; sealed without fold reports `unavailable`; inventory beyond retention reports counts.
7. **Errors** — bounded message shown; over-length truncated with marker; secret-like values redacted; tool errors carry no message; path/URL redaction table covering Linux (`/home/dev/project/.env`, `/tmp/report.json`, `~/x/y`), Windows drive (`C:\\Users\\dev\\secret.txt`, `C:/Users/dev/x`), UNC (`\\\\server\\share\\x`), `file://` URLs, credential URLs and token-query URLs, while ordinary prose (`text/html`, `and/or`, `1.2/3.4`, `3/4`) is preserved.
8. **UI bundle** — `loadInspectorBundle` composes current + history + global; single scope applies to current only; an unavailable section degrades without breaking the document; `--scope tree` on `ui` changes only the current section; rendered document is byte-identical across runs; history/global non-targets for `ui`.
9. **Command surface** — parser table for every valid/invalid combination; `--help`/`help` content lists only valid combinations; completion table incl. `--theme`/`--scope` values and `null` on no match; legacy `--format`, old targets, and `--subagents-artifact` produce usage (never the generic message).
10. **Theme** — `ui --theme dark` initial class + working toggle; rejected for `tui`/`json`.
11. **Privacy corpus** — extended as §10.
12. **UAT-shaped replay** — fixtures assembled in the shape of this repository's real sessions assert: a **Ponytail-positive** session (persisted `ponytail-mode` entry) reports Ponytail `supported` with `changes ≥ 1` while Caveman stays independent, and a Caveman-positive/Ponytail-absent session reports Caveman `supported` with Ponytail `not observed` rather than `0`; Commands/Skills/resources inventory populated; Agents non-empty from native activity; Integrations distinguish not-observed from unsupported.
13. **Determinism** — repeated runs produce byte-identical JSON for all three modes.

Required checks after implementation: `npm run format:check && npm run lint && npm run typecheck && npm test`, `npm pack --dry-run`, and manual UAT on real sessions: (a) the current session — caveman detected, commands/skills/resources populating, agents without any artifact flag, integrations distinguishing states, `/session-inspector ui --theme dark`, `ui --scope tree`, `tui`, `tui ledger`, `json --scope tree --output /tmp/report.json`, `help`, completion popups, and `--subagents-artifact` rejection; (b) a **Ponytail-positive session**: run `/ponytail <mode>` in a scratch or current session so the producer persists a `ponytail-mode` entry, then assert the Inspector shows Ponytail `supported` with `changes ≥ 1` (and restore the original mode afterwards); (c) a resumed session: counters written before the restart remain visible after `/resume` and in the history/global sections.

## 13. Documentation and ADRs

- **ADR 0014 — durable live integration evidence.** Foreign public bus events and the `input` skill observation become bounded WAL telemetry counters, folded into checkpoints. Records the process-local and 14-day limits, the no-backfill rule, the flush-before-read single-source rule, and why `event`/`gauge` telemetry is not folded.
- **ADR 0015 — resource inventory, presence model, and UI bundle.** Commands/skills/resource-source inventory from `getCommands()` + `getAllTools()` plus the sanitized snapshot and its refresh triggers; `presence` vs `state`; inventory is not invocation count or activity; the single-document `ui` bundle (loader, scope semantics, degradation); pi-subagents auto-discovery from persisted tool-result metadata with validated artifact references and the child-session-replay deferral; why the manual artifact flag was removed rather than preserved.
- **Spec updates:** §3 command grammar, mode/target matrix and the single-document `ui` bundle contract, §4 canonical model/DTO additions (resource sources, tool attribution, `presence` vs `state`), §6 live observer surface (one bounded `input` observation plus foreign bus subscription), §7 checkpoint fields + inventory artifact + retention and refresh-trigger rules, §9 UX/theme/help/completions, §10 integration policy rows (Ponytail/Caveman split, Permission System bus, pi-subagents discovery, generic resource sources), §11 migration and downgrade-write notes.
- **Research update:** pinned producer table (§1.2), the corrected pi-subagents artifact finding, and fixture provenance.
- **CHANGELOG:** `0.7.0` entry with the command-syntax migration (`--format`/targets → positional modes), the removal of `--subagents-artifact`, the `mode`→`ponytail`/`caveman` report key change, the single-document `ui` bundle, and the checkpoint downgrade-write note.

## 14. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| `input` handler adds latency to every user prompt | prefix-check only, no await, no allocation beyond the first token; probe test asserts no work for non-`/skill:` input |
| Counter fold changes report bytes for existing sessions | fold only affects sessions with telemetry counters; existing fixtures have none |
| Checkpoint additive field breaks strict readers | optional + strictly validated; absence tested; `schemaVersion` unchanged |
| Historical global fold cost | existing read budgets + global budget with diagnostic degradation |
| Producer drift (pi-subagents 0.59 → 0.67) | documented-field-only parsing, unknown fields ignored, unknown vocab → `unknown`/absent, fixtures pinned to verified installed shapes |
| Over-redaction hides useful info | redaction only for secret-like/path-like/oversize values; `Unavailable` is explicit, never silent |
| Split `mode` key breaks JSON consumers | additive tolerances in projection + changelog migration note |
| `ui` bundle triples loader work per invocation | reuse the existing loaders and budgets; bounded by the same limits as `json global`; degradation is per-section, never a failed document |
| Removing `--subagents-artifact` breaks an existing workflow | auto-discovery covers the real producers; the flag is rejected with explicit usage help and a changelog entry rather than silently ignored |
| Checkpoint downgrade to 0.6.x drops folded counters | documented downgrade-write semantics (§11); cooperative evidence only, degrades to `unavailable`, never to a wrong number |
| Error-message redaction is imperfect | bounded, single-line, marker-based, tested against a path/URL/secret corpus; raw text never leaves the reducer; report keeps its local-sensitivity warning |

## 15. Acceptance criteria

1. Mode evidence: Ponytail and Caveman rows supported from schema-less entries; a session with neither reports `not observed`, not `0`.
2. Permission evidence: counters from the public bus; no custom-entry path remains; absence is `unavailable`.
3. Commands/Skills/resources: inventory populated from `getCommands()` + `getAllTools()` with no path/body leakage and no activity claims; tool rows carry a source label when known; explicit skill invocations counted only when inventory-matched; model-driven use explicitly `unavailable`.
4. Agents: normal pi-subagents runs populate the tab without any artifact flag; native tool activity always shown; archive references followed only after strict validation; `--subagents-artifact` is gone from the contract and rejected with usage help.
5. Durability: permission/skill counters survive `/resume` (new writer shard) and remain visible in history/global within retention, as aggregates after detail expiry.
6. Errors: bounded message shown when safely available; secrets, Linux/Windows/UNC paths and URLs redacted to explicit markers; `Unavailable` when nothing safe remains; no tool-result bodies or prompts.
7. Command surface: `/session-inspector ui|tui|json` with the documented targets/options; `ui` loads one complete bundle (Current + History + Global) with `--scope` affecting only Current; `--theme` for `ui`; completions, `help`, useful usage on invalid input; no `--format`.
8. All privacy invariants hold across adapters, WAL, JSON, HTML, TUI; parser/completion/help/bundle/determinism tests pass; real-session UAT includes a Ponytail-positive session; spec/ADR/research/CHANGELOG updated; version `0.7.0`.

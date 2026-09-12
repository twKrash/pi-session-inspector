# ADR 0016: evidence foundation and canonical session model

**Status:** accepted.

## Context

By `0.7.0` the report path had accumulated parallel copies of the same semantic decisions. The TUI current view, the history loader, the global loader, and the offline `ui` bundle each called the reducer and integration adapters themselves, each re-derived active/tree scope from the entry graph, each folded checkpoint counters against WAL cursors, and each recomputed call/result joins, child-run reconciliation, and usage reconciliation. Every one of those copies was a place where a cursor mistake could double count, where missing evidence could serialize as `0`, where a producer path or raw ID could leak, and where TUI/HTML/JSON could disagree about the same session.

Two capabilities made that duplication untenable. First, the milestone added evidence classes that already exist in two disjoint physical lifetimes — retained atomic records (Pi JSONL, WAL detail, inventory rows) and checkpoint-surviving aggregates whose detail has been pruned — and a report must be able to state which one it is holding without fabricating the other. Second, the privacy boundary required that raw producer identities (`toolCallId` for WAL correlation, permission `requestId`, subagent run IDs, `parentSession` paths) either never leave an adapter call frame or leave only in a domain-separated hashed form. Neither property can be enforced in four loaders.

Pi persisted data remains the billing and source authority (ADR 0002), Inspector remains observer-only and local-only (ADR 0001, ADR 0011), and the WAL/checkpoint/retention contracts are unchanged (ADR 0004, ADR 0005, ADR 0012). This ADR records the pipeline boundary that makes those existing decisions enforceable across every consumer.

## Decision

### Three layers, one semantic boundary

**L0 — safe evidence.** Source adapters are the only code that touches raw sources (Pi JSONL, Inspector WAL, checkpoint, inventory snapshot, pi-subagents results/archives, producer telemetry, current environment). An adapter performs structural validation, byte bounds, redaction, enum validation, timestamp parsing without inference, source-specific provenance assignment, prohibited-field removal, and accept/reject accounting, then emits exactly two disjoint classes:

- `AtomicEvidence` — one validated observation per fact (graph nodes, retained WAL records, explicit skill invocations, cooperative publications, retained inventory detail);
- `FoldedAggregateEvidence` — already-folded checkpoint counters/counts with their exact cursor/seal boundary and aggregate-only provenance.

L0 never merges, deduplicates, selects scope, combines atomic and folded values, computes totals, or infers relationships. No raw producer object spread crosses the L0 boundary; adapters construct explicit safe fields.

**L1 — canonical session.** `buildCanonicalSession` is the single semantic boundary. It validates session identity and marker boundary, owns the full native entry graph (every structurally valid entry, including pre-marker and unknown-semantic nodes, so ancestry is complete even though semantic facts are admitted only after the marker), reconciles exact call/result and live-timing identities, reconciles repeated cooperative child observations, exposes explicit skill-invocation detail while retained, reconciles retained atomic telemetry against the checkpoint fold/seal boundary, builds native and child usage ledgers, classifies timestamp attribution, and emits source/relationship/retention evidence health. It is rebuilt in memory and is never written as a canonical session file.

**L2 — report and navigation projections.** L2 consumes the L1 model and produces the bounded DTOs that TUI, HTML, and JSON render verbatim. L2 projects active/tree scope, applies date-range projections on canonical attribution dates, and maps provenance to confidence and health. L2 **never** reads WAL, checkpoint, inventory, or producer archives directly, and never folds counters, subtracts cursor overlap, recomputes joins, or re-derives scope. The only code that may read storage for semantic evidence is the L0 source coordinator in the composition root; history/global reports receive it through an injected `SessionEvidenceProvider`, where a throw or `undefined` degrades exactly that session to `unavailable` and never fabricates a zero. Maintenance and retention may still read storage for storage ownership, but no L2 loader or projection may bypass L1.

The architecture is the diagram in design §6: sources → L0 safe evidence → L1 canonical session → L2 DTOs → TUI/HTML/JSON.

### Scope is decided once: `CanonicalSession.scopedEntryIds`

`CanonicalSession.graph.nodes` holds every structurally valid entry, so the graph is deliberately *not* the scoped set. L1 publishes `scopedEntryIds: string[]` in exact resolution order — the active-ancestry ids after the marker, or every post-marker entry id for tree scope — and L2 maps those ids back to parsed entries (dropping ids with no parsed entry, e.g. unknown-semantic nodes). Loaders never re-derive scope. This closes the failure mode where a loader that walked `graph.nodes` order reported every branch instead of the active path (`72` vs `42` tokens on the branching fixture).

### Effective counters are computed once: `CanonicalSession.effectiveCounters`

The per-key total (`folded prefix + retained atomic suffix`, unioned once) reaches L2 only through `effectiveCounters`, with an explicit trust state:

- `retained` — the total is exactly the retained atomic records; the boundary folded nothing and pruned nothing;
- `aggregate-only` — a folded or pruned contribution is included;
- `unavailable` — no trustworthy total can be stated (no checkpoint boundary exists, so pruning cannot be ruled out).

Values are published only for `retained` and `aggregate-only`; `unavailable` publishes no values, never zeros. L2 never adds facts on top of a published total. Where no trustworthy total exists, L2 still publishes retained explicit skill-invocation detail from `CanonicalSession.skillInvocations` so `report.skills` agrees with `evidenceHealth.aggregates.skillInvocations.retainedInvocations`.

### Skill invocation is first-class evidence

An explicit `/skill:<name>` observation is a fact, not an inventory artifact. The bounded `input` observer inspects only the leading `/skill:` token, accepts the name only when it matches the bounded skill-name grammar and the current `source === "skill"` inventory, discards arguments and prompt text, and returns nothing. A validated `skill.invocation` telemetry envelope becomes `SkillInvocationObservation` (L0) and `CanonicalSkillInvocation` (L1) while the WAL record is retained; after detail expiry the named and overflow counts survive only as checkpoint aggregates labelled aggregate-only. An invocation whose name would exceed the 64-name cap increments `skillOverflowInvocations` exactly, per invocation, and creates no synthetic name or row. Skill **inventory** (available skills) stays inventory evidence and is never summed with invocation activity (invariant 35). Model-driven skill loads (`read`/`bash` on `SKILL.md`) remain explicitly `unavailable`.

### Retained aggregates use exact fold/seal boundaries

Checkpoint counter fields enter L1 only through `FoldedAggregateEvidence`, under the normative supplementation contract (design §14.1.1): retained atomic detail wins while valid; the checkpoint supplies only the disjoint portion at or before `foldedThrough[writerId]` or pruned past `sealedThrough[writerId]`; a record the fold already covers is never added again; an inconsistent boundary (a cursor past observed retained sequences without a matching seal, a seal greater than its fold cursor, an `expired` boundary with populated cursors) is rejected as invalid, never repaired. Total per key = folded prefix + retained atomic suffix unioned once. Every aggregate-only value carries its exact boundary and never appears as an atomic row, timestamp, or `observedAt`.

`CanonicalRetainedAggregates.boundary.detail` states what is observable: `full` (no folded or pruned contribution), `aggregate-only` (folded/pruned contributions remain), `expired` (no boundary at all, so no aggregate value may be published). Checkpoint usage fields (`totalTokens`, `totalCost`, `generations`, `tools`, `compactions`) are verification/health evidence only and are never canonical usage input: Pi JSONL replay is authoritative, so usage cannot double count.

### Checkpoint stays `schemaVersion: 1`, additive

One physical representation is defined. `aggregates.resourceCounts` is extended in place (`resources`, `toolSources`, `observedAt` additive to the required `commands`/`skills`) and exactly one sibling `evidence` object is added (`checkpointedAt`, `usageCoverage`, `detailCoverage`). No second resource-count location and no second metadata object exist.

`evidence.detailCoverage.walDetailExpiredBefore` is the exact timestamp of the newest WAL record in the pruned (sealed and deleted) prefix — the exact instant before which no detail exists. It is written only in the same write that publishes a new seal, only when a prune actually removed detail, and it is monotonic across passes (the maximum of the stored value and the newest pruned record). It is never the cutoff day, a file mtime, or the process clock. `evidence.detailCoverage.inventoryDetailExpiredAt` is the pruned snapshot's `observedAt` — the observation instant whose rows were removed — and is written only on an actual inventory unlink, monotonically. `evidence.checkpointedAt` is materialization time only and no aggregate may claim an event time it does not have.

Because the fields are written only by the prune path, a checkpoint sealed by an older version can never gain `walDetailExpiredBefore`; a newer reader degrades that case to the previously documented absent-boundary behaviour rather than inventing one. An old checkpoint writer may drop the additive `evidence` object and the additive `resourceCounts` keys on rewrite: Pi facts remain recoverable and affected health becomes unavailable, never fabricated.

### Inventory observation time is explicit and shared

`InventorySnapshot.observedAt` is the time of the **latest successful observation**, not the time the content last changed. The snapshot file, the in-memory mirror handed to the builder, and `aggregates.resourceCounts.observedAt` all carry the same observation instant when it is known. A later successful observation with byte-equivalent content advances `observedAt` (content equality may skip rebuilding payload data, but never preserves a stale timestamp); a failed observation leaves the previous value untouched. `mtime` is never evidence time, never a freshness input, and never a retention input once `observedAt` exists. Retention measures inventory expiry against `observedAt`.

`inventory-observation-time-missing` therefore means **genuinely instant-less inventory evidence** — a legacy or otherwise observation-time-free snapshot for which no instant exists. It is not a statement about the shape of the in-memory mirror: production keeps the remembered snapshot payload-only by design and hands the observation instant to the builder separately, so a readable snapshot with a known instant must not raise the diagnostic while the same report publishes a known `retainedAggregates.resources.observedAt`. Reporting it in that case would be a self-contradicting health signal.

### One validated WAL path feeds L1

`recoverSession` exposes the bounded, already-validated retained records it parsed on `RecoveryResult.records` in the `RecoveredWalRecord` shape L1 consumes, capped by the existing replay budget. Nothing is parsed twice and no raw producer content is carried: `telemetry` is a validated envelope and `timing` a validated lifecycle payload carrying an optional bounded `subjectId`. A partial replay exposes no records, exactly like its `deltaCounters`, so an incomplete suffix can never be folded or reconciled downstream. The builder's `walRecords` channel is this recovery output; there is no second WAL reader inside L1 or L2.

### One opaque-ID helper, three domains

Every raw producer identity that must correlate across adapters without Inspector persisting it uses `canonicalOpaqueDigest(domain, sessionId, rawId)`:

- domains are exactly `live-tool`, `permission-request`, `subagent-run`;
- `sessionId` is the validated canonical session ID, `rawId` is a source-adapter-only string of at most 512 UTF-8 bytes with no control characters and no Unicode normalization;
- the preimage is `UTF8("pi-session-inspector") || NUL || UTF8("opaque-id") || NUL || UTF8("v1") || NUL || domain || NUL || sessionId || NUL || rawId`, SHA-256, encoded as 64 lowercase hexadecimal characters;
- hook adapters, WAL recovery/correlation, and L1 reconcilers all import this helper; no caller rebuilds the preimage. A WAL reader given only the encoded form carries it unchanged.

Only the opaque form enters Inspector WAL/checkpoint/report evidence; the raw ID is dropped in the adapter call frame and never persists beside its opaque form. The `live-tool` digest is L0/L1-internal correlation evidence and is never projected beside the native tool identity. Pi's own native `toolCallId` remains the approved public `tool:<id>` because Pi persists it and Inspector does not own that field.

The `subagent-run` digest is session-scoped and supersedes the pre-`0.8.0` process-global digest. Public agent IDs keep the `subagent-<64hex>` shape but change value at this version boundary; all links are regenerated from the same L1 report. Existing generation/tool/compaction public ID values remain byte-stable.

### Parent-session resolution is all-or-unavailable

Raw Pi `parentSession` paths exist only inside the Pi source adapter. Resolution rejects non-string, empty, NUL-containing, or over-4,096-byte input; requires a configured approved Pi session root resolved once; resolves the candidate without basename extraction and requires lexical containment via a platform-safe relative-path check (never string-prefix comparison); `lstat`s every component beneath the root and refuses symbolic links; requires a regular file; re-resolves the real path and rechecks containment; opens read-only and `fstat`s the handle to reduce replacement races; reads only the first non-empty header line, bounded to 16 KiB; requires a supported v3 header and a validated canonical parent ID distinct from the child; and closes the handle in every outcome. Only `{ state: "known", id: <validated session id> }` may leave the adapter. Every failure returns `{ state: "unavailable" }` and increments `parent-session-unavailable`; diagnostics never contain path text, filesystem errors, or candidate IDs, and parent identity is never inferred from basename, directory name, or path shape.

### ADR 0014 partial supersession (hashed permission request attribution)

ADR 0014 states that producer fields including `request` are never read, persisted, or rendered. **This ADR supersedes that narrow rule for exactly one hashed form.** Permission telemetry may carry `attribution.request` equal to

```text
permission-request-<canonicalOpaqueDigest("permission-request", sessionId, rawRequestId)>
```

and nothing else changes:

- the raw request ID is never read, persisted, or rendered, and its preimage never leaves the adapter call frame;
- the hashed value is additive envelope metadata only: it is never folded into a counter, never a join key, and never pairs a prompt with its decision or with any other outcome;
- an absent, empty, oversized, or malformed request ID yields no attribution rather than a guess;
- every other field on ADR 0014's "never read" list — `origin`, `value`, `matchedPattern`, `agentName`, `forwarding` — remains prohibited, as does reading raw `request` itself.

The checked-in v1 spec carried the same prohibition (`docs/specs/pi-session-inspector-v1.md`, §6) and is amended in the same change. Shipping only one of the two texts would document a prohibition the shipped code violates. Everything else in ADR 0014 (the closed fold table, bounds, exact overflow, flush-before-read, durable presence, the `event`/`gauge` decision, and the stated limits) stands unchanged.

## Alternatives considered

- Keep reducers/adapters called directly from each loader: rejected; four copies of scope, fold-boundary, join, and usage semantics is the defect this milestone exists to remove.
- Put L1 in storage or expose a canonical session file: rejected; L1 must be a pure in-memory rebuild, and persisting it would create a second authority beside Pi and the WAL.
- Let L2 read storage behind a "cheap" path: rejected; it recreates the double-count and privacy-boundary risk and makes history/global diverge from current.
- Re-derive scope in L2 from `graph.nodes` order: rejected; would silently report all branches as active scope.
- Publish only the merged fold (pre-`0.8.0` behaviour): rejected; a total without a trust state cannot distinguish retained detail from a pruned contribution and violates the "unavailable, never zero" rule.
- Widen `retainedAggregates` into a state union: rejected; effective counters get their own explicit state so the aggregate-only semantics stay unchanged.
- A checkpoint schema-version bump or a second metadata object: rejected; additive v1 fields keep older readers from discarding sealed-cursor knowledge, and a bump would make an older process treat the whole checkpoint as unreadable.
- Date-granular expiration boundaries (cheaper): rejected; the cutoff day is not an instant any record sits on, and `walDetailExpiredBefore` must be the exact instant before which detail no longer exists.
- Fabricate inventory observation time from mtime or the read clock: rejected; mtime is not evidence and a fabricated instant would make retention and freshness lie.
- Keep the pre-`0.8.0` process-global subagent digest: rejected; cross-session collision surface with no benefit, and the value is regenerated from one L1 report.
- Resolve `parentSession` by basename or path prefix: rejected; both allow traversal-shaped path confusion, and neither proves the target is inside the approved root.
- Keep reading raw `request` out of a "compatibility" path: rejected; there is no consumer that needs the preimage, and the hashed form is sufficient for the intended correlation.

## Consequences

Every consumer renders the same L1-derived DTO with the same evidence health, scope decision, effective counters, and joins; double counting, invented zeros, scope drift, and raw-ID leakage each have a single place to be wrong, and that place is covered by the invariant list in the v1 spec §12. Reports can now state honestly which evidence class they hold (`full`, `aggregate-only`, `expired`) and where the exact boundary is, including the instant before which WAL detail no longer exists.

The cost is explicit. L1 rebuilds a full in-memory model per read (the `ui` bundle builds both scopes), so the loader work moved rather than vanished; the checkpoint gained one additive object and three additive resource keys; public subagent agent ID values change at this version boundary; and the permission telemetry now persists one session-scoped pseudonymous hash that is stable within a session and comparable across sessions of the same Pi session ID. Retention can now measure inventory expiry against a real observation instant, but a checkpoint sealed by an older version can never be retrofitted with `walDetailExpiredBefore`, so those sessions keep the older absent-boundary behaviour. See ADR 0010 (bounded telemetry envelope), ADR 0011 (privacy), ADR 0012 (retention), ADR 0014 (the live-evidence fold this ADR partially supersedes), and ADR 0015 (inventory and offline bundle) for the contracts this layer sits between.

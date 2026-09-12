# Final review fix report

Commit: `24dbee0 fix: close evidence foundation review findings`

## Findings

- **I1:** Active scope now rejects missing parents, cycles, duplicate IDs, and pre-marker leaves as `active-leaf-unavailable`. Unknown semantic nodes remain structurally valid. Added adversarial scope coverage.
- **I2:** Canonical reduction now retains the first scoped logical owner for each Pi entry ID and suppresses duplicate resolution IDs; the existing duplicate-entry diagnostic remains observable.
- **I3:** L2 now receives L1's usage verdict through the shared projection. When L1 rejects an overflow aggregate, `usage` and `usageComposition` are omitted rather than publishing the raw reducer's clamped values; current TUI displays unavailable.
- **I4:** The checkpoint-prefix/retained-suffix union is revalidated against `MAX_FOLDED_COUNT`; over-bound unions are rejected through the bounded checkpoint aggregate diagnostic rather than published.
- **I5:** `workflowChildren.children[]` is collected after `results[]` and `completions[]`, preserving R22 last-wins semantics. Added a workflow-child test.
- **I6:** History evidence recovery now supplies validated retained WAL records, skill/live atomic facts, and no live overflow, through the composition root.
- **I7:** Archive reads moved out of both L2 loaders. Current uses an injected composition-root provider; history receives provider-supplied cooperative evidence and only has in-memory fallback derivation. Loader source scan confirms no archive reader symbol.
- **I8:** Inventory expiration boundary publication now precedes best-effort unlink. Without a checkpoint boundary record, inventory is retained. Tests cover checkpoint and no-checkpoint ordering behavior.
- **M1:** ADR/spec clarify adapter-local permission request reading, Pi-file readers, aliases, reserved/unwritten `usageCoverage`, and inventory retention ordering.
- **M2:** `stripCheckpointedAt` has a named structural return type.
- **M3:** Shared L2 counter/resource/usage projections now live in `src/ui/l2-projection.ts`; both loaders import them.

## Red/green evidence

The focused test run initially exposed intentional baseline failures after changing retention ordering and archive injection. Tests were updated to express durable-boundary-before-delete and composition-root archive injection, then passed. New tests pin adversarial active ancestry and workflowChildren ordering. Full suite green: 582 tests, 0 failures.

## Commands

- `node --import tsx --test tests/unit/scope-graph.test.ts tests/unit/subagents.test.ts tests/unit/retention.test.ts` — passed after fixes.
- `npm test` — passed, 582/582.
- `npm run typecheck` — passed.
- `npm run lint` — passed (three pre-existing informational `__proto__` notices).
- `npm run format:check` — passed.
- `npm pack --dry-run` — passed; `pi-session-inspector-0.8.0.tgz`, 59 files.
- `grep -R 'readSubagentEvidenceWithArchives' src/ui/load-current.ts src/ui/load-history.ts` — no output.
- `git diff --check` — passed.

## Residual concerns

The report DTO's legacy usage fields remain statically required for compatibility, while the overflow path deliberately supplies `undefined` so JSON omits them; renderer paths must continue treating missing runtime usage as unavailable. The current TUI has this guard. Existing HTML projection assumes a present usage value and should receive an explicit unavailable-safe presentation follow-up if overflow HTML rendering is exercised.

# Current Session TUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace command placeholder with a current-session, scope-switching, full-screen Pi TUI.

**Architecture:** A pure current-TUI view-model and reducer project existing `SessionReport` data without reading Pi or rendering ANSI. A Pi adapter loads the public current session, builds that model, and supplies it to one `ctx.ui.custom()` component. The component only handles key input, width-aware rendering, and close.

**Tech Stack:** Node 22, TypeScript, node:test, Pi public extension/TUI APIs, existing `@earendil-works/pi-tui` peer dependency.

**Spec:** `docs/superpowers/specs/2026-09-07-current-tui-design.md`

## Global Constraints

- Use only public Pi APIs; Pi JSONL remains billing/source authority.
- Observer/UI failures are swallowed or rendered unavailable; Pi execution cannot change.
- Do not expose prompt/response/raw tool payloads, paths, commands, provider payloads, or secrets.
- Reuse current normalizer, scope resolver, reducer, report DTO, and lazy ledger.
- Current session only; no history, global, HTML, retention, integration, network, dependency, or UI-framework work.
- Every rendered ANSI line is `<= width`; use callback theme and `tui.requestRender()` after state changes.

---

### Task 1: Renderer-neutral TUI model and reducer

**Files:**

- Create: `src/ui/current.ts`
- Test: `tests/unit/current-ui.test.ts`

**Interfaces:**

- Consumes: `SessionReport` from `src/core/reports.ts` and `Scope` from `src/core/events.ts`.
- Produces: `CURRENT_TABS`, `CurrentTab`, `CurrentTuiState`, `createCurrentTuiModel(report, scope)`, and `reduceCurrentTui(state, action)`.

- [ ] **Step 1: Write failing model/reducer tests**

```ts
assert.deepEqual(CURRENT_TABS, ["overview", "models", "tools", "commands", "agents", "skills", "integrations", "errors", "ledger"]);
assert.equal(reduceCurrentTui(initial, { type: "next-tab" }).tab, "models");
assert.equal(reduceCurrentTui(initial, { type: "set-scope", scope: "tree" }).scope, "tree");
assert.equal(createCurrentTuiModel(report, "active").ledger, undefined);
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `node --import tsx --test tests/unit/current-ui.test.ts`
Expected: FAIL because `src/ui/current.ts` does not exist.

- [ ] **Step 3: Implement minimal pure model/reducer**

```ts
export const CURRENT_TABS = [/* nine fixed tabs */] as const;
export function reduceCurrentTui(state: CurrentTuiState, action: CurrentTuiAction): CurrentTuiState {
  // clamp tab navigation; replace scope only for active/tree
}
```

Represent absent evidence with a fixed `unavailable` state. Do not materialize a ledger in `createCurrentTuiModel`.

- [ ] **Step 4: Run focused tests and confirm pass**

Run: `node --import tsx --test tests/unit/current-ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/current.ts tests/unit/current-ui.test.ts
git commit -m "feat: add current TUI model"
```

### Task 2: Width-safe custom component

**Files:**

- Create: `src/ui/current-tui.ts`
- Test: `tests/unit/current-tui.test.ts`

**Interfaces:**

- Consumes: `CurrentTuiModel`, `CurrentTuiState`, and reducer exports from `src/ui/current.ts`.
- Produces: `createCurrentTuiComponent({model, theme, requestRender, done})` returning Pi `Component` shape.

- [ ] **Step 1: Write failing component tests**

```ts
assert.ok(component.render(120).some((line) => line.includes("Overview")));
assert.ok(component.render(40).some((line) => line.includes("Models")));
component.handleInput("t");
assert.equal(renderedScope(), "Tree");
component.handleInput("q");
assert.equal(closed, true);
assert.ok(component.render(20).every((line) => visibleWidth(line) <= 20));
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `node --import tsx --test tests/unit/current-tui.test.ts`
Expected: FAIL because `src/ui/current-tui.ts` does not exist.

- [ ] **Step 3: Implement minimal component**

Use `matchesKey`, `Key`, and `truncateToWidth`. Render a horizontal fixed tab row at wide widths and a vertical selected-tab selector at narrow widths. Handle left/right, `a`, `t`, `q`, and Escape. Render only fixed labels and bounded report fields. Build Ledger content only when state tab is `ledger`.

- [ ] **Step 4: Run focused tests and confirm pass**

Run: `node --import tsx --test tests/unit/current-tui.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/current-tui.ts tests/unit/current-tui.test.ts
git commit -m "feat: render current session TUI"
```

### Task 3: Current-session command composition

**Files:**

- Modify: `src/index.ts`
- Create: `src/ui/load-current.ts`
- Test: `tests/unit/index-current-ui.test.ts`

**Interfaces:**

- Consumes: public `ctx.sessionManager.getSessionFile()`, `parseSessionJsonl`, `selectScope`, reducer/report exports, and custom component factory.
- Produces: `loadCurrentSessionReport(sessionFile, scope)` and TUI command handler composition.

- [ ] **Step 1: Write failing command/load tests**

```ts
assert.equal(await loadCurrentSessionReport(undefined, "active"), undefined);
assert.equal(await loadCurrentSessionReport(file, "active")?.report.sessionId, "fixture-session");
assert.equal(customCalls, 1);
assert.equal(notifications, 0);
```

Also assert public session lookup/replay failure returns an unavailable model or info notification and does not throw.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `node --import tsx --test tests/unit/index-current-ui.test.ts`
Expected: FAIL because loader/command composition is absent.

- [ ] **Step 3: Implement minimal composition**

Replace only placeholder command handler. For current session use public `getSessionFile()`; when unavailable, notify and return. Read/replay locally, create component inside `ctx.ui.custom()`, and catch all command-side failures. Leave `history`, `global`, `html`, and JSON command behavior unimplemented rather than inventing it.

- [ ] **Step 4: Run focused tests and confirm pass**

Run: `node --import tsx --test tests/unit/index-current-ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/ui/load-current.ts tests/unit/index-current-ui.test.ts
git commit -m "feat: open current session inspector"
```

### Task 4: M4 acceptance and release documentation

**Files:**

- Modify: `docs/plans/pi-session-inspector-v1-implementation.md`
- Modify: `CHANGELOG.md`
- Test: all M4 unit tests.

**Interfaces:**

- Consumes: all Task 1–3 public exports.
- Produces: verified M4 completion with current-only TUI scope documented.

- [ ] **Step 1: Add acceptance regressions**

Add explicit tests that each fixed tab remains visible with unavailable content, Ledger loader is not called before Ledger selection, and every rendered line remains width-safe at 20 columns.

- [ ] **Step 2: Run acceptance suite**

Run: `npm test && npm run typecheck && npm run lint && npm run format:check && npm pack --dry-run`
Expected: PASS.

- [ ] **Step 3: Update milestone/changelog documentation**

Mark M4 current-TUI deliverables complete and state history UI is deferred to web UI. Add an unreleased changelog entry describing current-session TUI and active/tree scope selection.

- [ ] **Step 4: Re-run full verification**

Run: `npm test && npm run typecheck && npm run lint && npm run format:check && npm pack --dry-run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/plans/pi-session-inspector-v1-implementation.md CHANGELOG.md src tests
git commit -m "feat: add current session TUI"
```

## Self-review

- Spec coverage: Task 1 provides fixed tabs and unavailable models; Task 2 provides keyboard/layout/lazy ledger; Task 3 supplies public current-session replay and failure isolation; Task 4 verifies and documents the current-only boundary.
- Placeholder scan: no implementation placeholders; deferred history is explicit non-goal.
- Type consistency: Tasks 2–3 consume only Task 1 named model/reducer exports; Task 3 owns Pi I/O and Task 2 owns rendering.

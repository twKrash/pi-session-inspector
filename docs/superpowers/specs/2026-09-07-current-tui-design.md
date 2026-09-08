# Milestone 4: current-session TUI

## Scope

Replace the command placeholder with a full-screen Pi TUI for the current session only. History picker/drill-down is deferred to the next web-UI milestone.

## Data flow

The command uses public Pi session APIs to locate the current session, replays Pi JSONL through existing normalization/reduction, applies the selected `active` or `tree` scope, and builds a bounded renderer-neutral current-TUI model from the resulting report. It opens `ctx.ui.custom()` only after that model is available.

No TUI action writes Pi data, mutates Inspector tracking, invokes maintenance, or inspects raw prompt/response/tool payload content. Unknown source, ephemeral sessions, replay failures, and unsupported facts render explicit unavailable/unsupported states.

## UI

Tabs are always visible: Overview, Models, Tools, Commands, Agents, Skills, Integrations, Errors, and Ledger. Tabs with no supported evidence render their empty/unavailable state rather than being hidden.

Default selection is Overview with active-branch scope. Left/right changes tab. `a` selects active scope; `t` selects tree scope. `q` and Escape close. Wide terminals render a tab row; narrow terminals render a vertical selector.

Ledger is lazy: it is not projected/materialized until its tab is selected.

## Boundaries

- A renderer-neutral model and keyboard reducer own UI state and layout-independent content.
- Pi custom-TUI adapter owns only rendering, width-sensitive layout, and input delegation.
- Existing replay/reducer/report code remains Pi source-of-truth; child usage is never added to native parent usage.
- Command/session/UI errors are caught and degrade to a notification or unavailable model. They never alter Pi execution.

## Tests

Test reducer navigation and scope transitions, fixed tabs and unavailable labels, narrow/wide rendering selection, lazy ledger construction, current-session command composition, active/tree source selection, and observer-safe command failure behavior.

## Non-goals

No history picker, global view, HTML, JSON renderer changes, retention, integrations, cloud/network calls, new dependencies, UI framework, or raw source content display.

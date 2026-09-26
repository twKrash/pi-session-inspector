# pi-subagents A–D pre-cleanup live UAT

**Date:** 2026-09-25  
**Scope:** Real Pi session and normal native `pi-subagents` execution; no Inspector source/config changes, producer patches, synthetic evidence, or D cleanup.  
**Evidence:** live producer outcomes in session `2026-09-25T21-19-19-627Z_01a0da6f-de4a-74d7-8809-88d01945bb6a`; final Inspector screenshot supplied by operator at `/tmp/pi-clipboard-6577b9c8-3cb5-41d1-aeec-a9feb0a37179.png`. Screenshot remains outside repository. Task text below is summarized; no child transcripts or outputs are copied here.

## Results

| Case | Agent | Execution kind | Detached? | Expected final state | Observed producer state | Inspector observation / result |
|---|---|---|---|---|---|---|
| A — foreground success | `scout`; mission `3e3990eb-02cc-4be6-92ac-552306aeda45` | Foreground, single | No | Succeeded | Completed successfully; project name/description returned. Producer response exposed mission ID, not a distinct run ID. | Screenshot has one `scout` row, **Succeeded**, with model, usage, cost, duration, and tool calls. **PASS** for visible success. |
| B — detached foreground success | `scout`; run `452ce34f-d6ae-4143-b3f6-6eb1d71c1ca1`; mission `1926d87e-18e4-4500-8ae5-2f75fd0a41ba` | Foreground, single | Yes; detached for supervisor interaction | Detached + Succeeded | Completed successfully after supervisor reply; launch-time `-2` disposition was not treated as failure. | Screenshot has a `scout` row marked **Unknown**, with no **Detached** disposition. Model, tokens, cost, duration, and tool calls are shown, but disposition/final outcome are not. **FAIL**: detached disposition and successful terminal outcome are not projected correctly. |
| C — foreground timeout | `scout`; run `4e47e25e-4f76-4ed7-b286-757811dc9d51`; mission `56ad99b6-4bf6-488e-b8ed-109ffa973ae2` | Foreground, single | No | Failed (supported 1,000 ms timeout; not interruption) | Producer returned `timed-out`; run/mission reported failed. | Operator reported no corresponding run in Inspector; at that checkpoint only two subagent runs were visible. No C row appears in final screenshot either. **FAIL**: terminal timeout evidence is missing from projection. |
| D1 — async launch-only | `scout`; run `6de28793-c6ec-4dd7-b8e0-ac5dbb83497d`; mission `3ee9d5c0-08a6-4b6c-92ce-690bdbbcfffd` | Async | Yes, background | One async AgentRun; running/unknown terminal state allowed; no invented lifecycle metrics | Async launch acknowledged and observed before completion. | While running, Inspector showed one placeholder **Unavailable**, status **Unknown**, parent **Unavailable**, with no cost/token/duration; tool calls were shown. **FAIL**: row was not usefully attributed; async execution kind was not visible. |
| D2 — same async completion | Same run and mission as D1 | Async | Yes, background | Same logical identity; Succeeded; async kind retained; no additive child usage | Native completion notification; producer status confirmed `complete`, process terminal observed. Model `gpt-6-luna` appeared in producer status. | Final screenshot still shows one **Unavailable / Unknown** row, parent **Unavailable**. It shows model and 4 tool calls, but tokens, cost, and duration unavailable. No visible async-kind label or stable public row identity to compare against D1. **FAIL**: successful completion did not update Inspector status; stable identity/kind remain unverified. |
| E — async timeout | `scout`; run `ba4feb0b-10ae-47ba-8812-d46de34ddae9`; mission `5d335b3a-692e-48b8-87e1-4ffd8fe82cd5` | Async | Yes, background | Failed (supported 1,000 ms timeout; not interruption) | `bg_wait` returned one failed run; Pi also emitted a timeout failure notification. | Final screenshot has `scout` marked **Failed** and `Artifacts: available`; model, tokens, cost, duration, tool calls, and error count are unavailable. Parent is unavailable. **PASS** for status mapping; **FAIL** for identity/metadata projection. Overall **FAIL**. |

**Task shapes:** A read `README.md` for project name and description. B read `README.md`, ask supervisor whether “local-only Pi session analytics tool” was an accurate description, then report after reply. C read `README.md`, with `timeoutMs: 1000`. D1/D2 read the README, ecosystem research, and product spec to summarize purpose/design constraints. E read the same three documents, with `async: true` and `timeoutMs: 1000`. All children were read-only; no intentional content corruption or fabricated result.

## Projection and accounting observations

- Final screenshot reports **4 child runs**: **1 Succeeded, 1 Failed, 2 Unknown**. It contains A, B, D, and E; C is absent. This aligns with the operator’s report that the timeout foreground run was not visible.
- B is the detached successful foreground run, but its final row is only **Unknown**, with no **Detached** indication.
- D appears once in the final screenshot across launch and completion, but the displayed placeholder/status did not change. Screenshot alone does not expose public row IDs, so identity stability is not proven.
- D producer status naturally exposed model (`gpt-6-luna`); Inspector screenshot exposed model and 4 tool calls. Producer status did not expose tool count/lifecycle fields. Inspector showed tokens, cost, and duration unavailable for D.
- Screenshot labels child usage as “breakdown of the session’s tool-result usage · never added” and states child usage is never added to native totals. This is consistent with non-additive presentation. No before/after native-total comparison was captured, so numeric accounting stability was **not independently verified**.
- No current-vs-historical projection was performed. History expectations remain unverified and belong in a separate Pi session, using only persisted Pi evidence; current-only lifecycle enrichment must not be inferred into history.

## Finding and stop boundary

**Live UAT found projection gaps:** detached disposition is omitted and successful detached run becomes Unknown; the foreground timeout run is missing; async completion remains Unknown/unattributed despite producer terminal success; failed async timeout maps to Failed but has only a name-level presentation. D1/D2 async kind and stable public row identity could not be confirmed from the UI.

Per UAT instructions, record findings and stop here. No source fix, configuration change, producer artifact edit, or D cleanup was performed. Isolate any regression fix before D cleanup. Historical verification remains for a new Pi session; no history-authority claim is made by this record.

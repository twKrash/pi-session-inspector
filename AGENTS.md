# Agent guidance

Read [research](docs/research/pi-ecosystem.md), [spec](docs/specs/pi-session-inspector-v1.md), [implementation plan](docs/plans/pi-session-inspector-v1-implementation.md), and relevant ADRs before modifying code. They are canonical design sources.

## Non-negotiable invariants

1. Pi persisted data is billing/source authority. Never write Pi session JSONL; `appendEntry` tracking marker is sole exception.
2. Inspector is observer-only. Hook/telemetry/storage errors must be swallowed and never alter Pi execution.
3. No prompt, response, raw tool args/results, provider payload, secret, or unbounded/unredacted producer string enters Inspector WAL/report diagnostics. Bounded redacted telemetry state is permitted only by ADR 0010.
4. Native usage is counted once. Child usage is a breakdown, never parent additive total.
5. Active scope is active ancestry after marker; tree scope is all entries after marker. Do not invent branch IDs.
6. One random immutable writer ID owns one exclusive WAL shard. Only maintenance acquires checkpoint lease.
7. TUI/HTML/JSON consume same report DTO. Ledger remains lazy.
8. Unknown formats/integrations degrade to `unsupported`/`unavailable`, never guesses.
9. Versions follow SemVer. Update package version before releasing a new feature.

## Required checks

Run focused tests, typecheck, lint, and `npm pack --dry-run` for packaging changes. Add/update sanitized fixtures for replay, recovery, privacy, and integration changes. Update spec/ADR for architecture boundary changes.

## Change delivery

Prefer small, independently mergeable pull requests.

- A milestone may span multiple PRs.
- Target 2–5 SDD tasks per PR.
- Prefer roughly ≤5–8 production files and ≤1–3k meaningful changed lines per PR
  when the architecture permits it.
- Every PR must leave `main` green and must not depend on unmerged later work.
- After merging a PR, start the next worktree/branch from the updated `main`.
- Run focused verification, full tests, typecheck, lint and format checks for
  every PR.
- Perform a whole-PR review before merge.
- Do not accumulate an entire multi-slice milestone on one feature branch.

## Agent planning artifacts

Superpowers execution artifacts are local working material, not product
documentation.

Keep local-only:

- `.superpowers/specs/`
- `.superpowers/plans/`
- `.superpowers/sdd/`
- task briefs, ledgers, review reports and scratch artifacts

Keep tracked when durable:

- `docs/architecture/adr/`
- product/user-facing specs under `docs/specs/`
- `CHANGELOG.md`

Use `.git/info/exclude` for developer-local Superpowers artifacts when possible
instead of imposing those ignores on every repository consumer.

## Agent instructions

All wait_agent tool calls MUST use at least 10 minutes timeout.
`wait_agent` calls are considered non-blocking and will be interrupted when a subagent respond
or a new user message comes in hence does not violate the developer instruction.

## Session and subagent artifacts

Files under `~/.pi/agent/sessions/` are outside the project workspace.

Do not use `ctx_execute_file` for subagent transcripts, fork session JSONL,
or other Pi session artifacts. Use the regular `read` tool instead.

`ctx_execute_file` is intended for files inside the current project root.

Use Pi's `read` tool for session JSONL and subagent artifacts instead.

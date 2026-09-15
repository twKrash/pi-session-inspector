# Pi Session Inspector

Deterministic, local-only session analytics for [Pi](https://github.com/earendil-works/pi). Reconstructs Pi-native session data with confidence-aware live/cooperative metadata. No LLM analytics. No cloud. No daemon.

> **Status: current, history, global, ledger, localhost UI, immutable snapshots, TUI, and JSON reports are available in `0.11.0`.**

## Install

```bash
pi install npm:pi-session-inspector
/session-inspector
```

Commands and aliases:

```text
/session-inspector [ui|snapshot|tui|json] [target] [options]
/session-ins ...
```

The four modes are separate surfaces: `ui` is the interactive localhost
application, `snapshot` is the only immutable HTML artifact command, `tui`
renders the current session inside Pi, and `json` is the deterministic export.
Only `ui` starts a server; `ui` displays its tokenized URL and opens it unless
`--no-open` is given, while `snapshot` writes its artifact, reports the path,
and opens that exact document unless `--no-open` is given, without ever
starting a server.

```text
/session-ins ui
/session-ins snapshot current --scope active --preset 14
/session-ins snapshot history --from 2026-01-01 --to 2026-01-31 --no-open
/session-ins snapshot global --output "global.html"
/session-ins snapshot session <sessionId>
/session-ins json history --output report.json
```

`snapshot` requires an explicit target: `current`, `history`, `global`, or
`session <sessionId>`. `--output` is valid only for `snapshot` and `json`, so
`ui` never writes a file; `--no-open` suppresses only the platform browser
opener. Atomic snapshots (`snapshot session <sessionId>`) take no `--scope` and
no range options: one requested session, nothing else.

Snapshots are created lazily under Pi's agent directory at
`session-inspector/v1/reports/` when `--output` is omitted. Unsafe/non-portable
identities use an opaque hashed basename. Generated cache expires after 14 days
and is capped at 100 MiB, oldest first; explicit exports are never pruned.
Relative `--output` paths resolve against the extension process working
directory. An explicit output carries its own extension (`.html` for
`snapshot`, `.json` for `json`) and never names Pi's own session data: a direct
session-source path (a `.jsonl` file, or for `snapshot` anything inside Pi's
session directory) is refused before any read or write. A destination that is a
hard or symbolic link to a session source is not followed: the report replaces
that directory entry atomically, so the session source keeps its own bytes and
inode.

`snapshot` HTML is one resolved, self-contained `file://` artifact: it opens
with no server, runs no JavaScript, performs no network request, carries no
report payload the eye cannot already see, and ships a `default-src 'none'`
content-security-policy with one hash for its own inlined stylesheet. Repeated
renders of the same projection are byte-identical, and only the chosen theme
changes the bytes.

## Settings

Inspector reads one optional JSON file it owns, next to its own data:

```text
<agentDir>/session-inspector/settings.json
```

```json
{ "theme": "dark", "debug": true }
```

| Key | Values | Effect |
| --- | --- | --- |
| `theme` | `"light"` (default), `"dark"` | The initial theme of a `ui` page and of a `snapshot` document; the in-page toggle still switches the running page |
| `debug` | `true`, `false` (default) | Writes Inspector's bounded local debug log (`0o600` JSONL under `session-inspector/v1/debug/`) |

Precedence is `explicit CLI option > settings.json > product default`, so
`--theme light` overrides `"theme": "dark"` and a per-invocation `--debug`
enables logging even when settings leave it off. A missing file is the default
configuration, not an error; a malformed, unreadable, or oversized (over 64 KiB)
file degrades to the product defaults with a bounded diagnostic and never
prevents Inspector from starting. Unknown keys are ignored rather than guessed.

The file carries presentation and diagnostics only. Which integrations Inspector
supports, what each descriptor publishes, and how to add one are documented in
[Integrations](docs/integrations.md).

## Localhost UI security boundary

`ui` starts (or reuses) one ephemeral loopback server bound to `127.0.0.1`
on an OS-chosen port, and prints the browser URL it serves. Its token is
created in memory per server instance, delivered once in the URL fragment
(`http://127.0.0.1:<port>/#token=<token>`), removed from the address bar before
the first request, and never written to storage, disk, or a log; a reload or a
new tab loses authentication and asks for a fresh URL. Every API request must
carry that token as `Authorization: Bearer`. The boundary is exact:

- Only `127.0.0.1` is bound; the request's `Host` must be exactly
  `127.0.0.1:<port>`, an unexpected `Origin` is refused, and `Forwarded` /
  `X-Forwarded-*` headers are never trusted.
- A request whose peer address is not loopback is refused boundedly. That
  includes a port-forwarding setup that presents a non-loopback peer: the
  refusal is the contract, not a case for a broader allowlist.
- Static assets are the three known files (`/`, `/style.css`, `/client.js`),
  served by a fixed table with `GET`/`HEAD` only. `client.js` is a deterministic
  build-time bundle from readable sources under `scripts/web/`; route and range
  logic are not runtime module assets, and the chart library is bundled rather
  than loaded. The exact `/favicon.ico` compatibility probe returns empty `204`
  for `GET`/`HEAD` and is not an additional asset. API routes are
  `/api/v1/ui`, `/api/v1/reports/global`, and
  `/api/v1/reports/sessions/<sessionId>` with `GET` only.
- Every response is `no-store`, `nosniff`, and `no-referrer`; errors are bounded
  Problem Details that echo no input, and the diagnostics written to stderr
  carry a bounded code, status and correlation id rather than a session id, a
  path, or a token.

The browser only navigates, requests, formats and renders: every scope, range,
partiality, evidence and unavailable-versus-zero decision comes from the
server's own projection.

The legacy `--subagents-artifact` option is removed; subagent runs are
auto-discovered from persisted tool results. Missing or unreadable evidence
renders unavailable rather than synthetic zeros.

## Guarantees

- Pi session files remain source of truth; Inspector writes only its own metadata/WAL and a namespaced tracking marker.
- Telemetry cannot block/change agent execution.
- WAL excludes prompts, outputs, raw tool arguments/results and provider payloads.
- Metrics label native, live, cooperative, inferred, unavailable, or unsupported evidence.

Reports may still reveal project metadata. Treat exports as sensitive.

## Canonical design documentation

- [Integrations](docs/integrations.md) — supported integrations, how to add one, and integration vs skill vs tool
- [Pi ecosystem research](docs/research/pi-ecosystem.md)
- [v1 specification](docs/specs/pi-session-inspector-v1.md)
- [implementation plan](docs/plans/pi-session-inspector-v1-implementation.md)
- [architecture decisions](docs/architecture/README.md)

These documents and ADRs are canonical. Planning scratch files are not retained as competing authority.

See [contributing](CONTRIBUTING.md), [security](SECURITY.md), and [agent guidance](AGENTS.md).

## License

[MIT](LICENSE) © twKrash.

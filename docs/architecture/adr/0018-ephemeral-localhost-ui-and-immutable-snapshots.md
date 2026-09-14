# ADR 0018: Ephemeral localhost UI and immutable snapshot exports

**Status:** accepted.

## Context

The original `ui` surface generated one self-contained HTML application. It
embedded report data, CSS, DOM rendering, hash routing, range handling, and
report projection logic. `src/ui/html.ts` also converted TypeScript functions
from `route.ts` and `range.ts` to source text with `Function.prototype.toString()`.
That made the generated document a second application implementation and tied
correctness to transpiler output, module-scope aliases, and a large custom
string generator.

Pre-M8.4 introduces a localhost browser application, but it must not move
canonical report semantics into HTTP or browser code. Static HTML remains
required for offline sharing, archival, and debugging, but it does not need to
remain an interactive copy of the application.

This decision preserves the existing source, evidence, privacy, deterministic,
and renderer contracts while changing the browser delivery boundary. Pi
persisted data remains billing/source authority (ADR 0002); Inspector remains
observer-only/local-only (ADR 0001, ADR 0011); child usage remains a breakdown
(ADR 0007); and L0/L1/L2 ownership remains canonical (ADR 0016).

## Decision

### Product surfaces

`ui` is exclusively the interactive localhost application:

```text
/session-inspector ui
```

It starts or reuses one lazy server for the current Pi process, opens a
capability-token URL, and obtains report data through the protected API.
`ui --output` is invalid usage and is not normalized to another command.

`snapshot` is the only static HTML artifact command:

```text
/session-inspector snapshot current
/session-inspector snapshot history
/session-inspector snapshot global
/session-inspector snapshot session <sessionId>
```

`snapshot` requires an explicit target. `current` accepts `--scope
active|tree`; `history` and `global` are intrinsically full-tree; `session
<sessionId>` is atomic and accepts neither scope nor range. `current`, `history`,
and `global` accept the bounded preset/custom range options. All snapshot
targets accept `--theme`, `--output`, and `--no-open`.

When `--output` is omitted, a snapshot is written to the existing generated
report cache under Pi's `session-inspector/v1/reports/` location using a safe
or opaque report identity and the `.html` extension. Explicit output files are
user-owned and retain existing cache-cleanup protection. `--no-open` suppresses
only the platform browser opener: it does not suppress snapshot generation,
server startup, or the user-visible path/URL notification. For `ui`, it starts
the server and displays the tokenized URL without opening it. For `snapshot`,
it writes the artifact without opening it.

`json` remains the deterministic machine-readable export and `tui` remains the
terminal interaction surface. `--output` is valid for `snapshot` and `json`,
never `ui`.

This is an intentional pre-1.0 public command change. The implementation
release is planned as `0.10.0`; no compatibility alias for `ui --output` is
provided.

### Canonical loading and L2 ownership

The canonical data flow is:

```text
safe evidence -> L1 canonical session -> TypeScript L2 projection
             -> InspectorUiSnapshot / SnapshotDto / JSON / TUI
```

`loadInspectorBundle()` remains the only aggregate UI loader. A
`GET /api/v1/ui` request invokes it once, then applies the named TypeScript L2
projection that produces `InspectorUiSnapshot`. The response includes Current
active/tree, History, and Global from one consistent logical observation.

Range metadata is per projection/view. The shared `RangeIntent` is retained,
but a preset may resolve against different latest observed dates for
`current.active`, `current.tree`, History, and Global. The UI DTO therefore
carries bounded resolved range metadata for each affected projection rather
than one global `{from,to}` pair.

Independent resource requests are independent observations:

```text
GET /api/v1/reports/sessions/{sessionId}
GET /api/v1/reports/global
```

They do not promise cross-request snapshot consistency. The session resource
returns one bounded canonical `SessionReport`, is atomic, and rejects `scope`
and range parameters; range input returns `400 range-not-supported`. The global
resource returns the bounded range-resolved `GlobalReport`.
Success responses are endpoint-specific DTOs; no generic data wrapper is
introduced. Errors use the bounded Problem Details contract below.

L2 remains the sole owner of scope, date attribution, membership, usage
accounting, truncation/partial-history verdicts, coverage, evidence health,
and unavailable-versus-zero semantics. HTTP handlers perform only routing,
authentication, bounded input validation, callback selection, serialization,
and bounded errors.

### Range contract

The same strict server-side range grammar applies to `/api/v1/ui` and
`/api/v1/reports/global`, and its equivalent CLI flags apply to range-capable
snapshot targets:

```text
?preset=7|14|30
?from=YYYY-MM-DD&to=YYYY-MM-DD
```

Only one complete form is accepted. Dates are real calendar dates with
inclusive boundaries; `from` must not follow `to`; duplicate/mixed/unsupported
inputs and oversized query text are rejected. Invalid input never silently
falls back or clamps and returns `400 invalid-range` (or command usage for
invalid CLI syntax). The atomic session resource rejects `scope` and range
input; range input returns `400 range-not-supported`.

Absent intent preserves existing defaults: current uses its full observed span;
aggregate views use the 14-day preset. Presets anchor to each projection's
latest observed date, never the machine clock. Custom ranges are resolved by
TypeScript L2 before either API or snapshot rendering.

### Immutable snapshots

A snapshot contains one already-resolved, bounded target projection:

```text
canonical evidence
    -> L1
    -> L2 projection(scope, range, target)
    -> SnapshotDto
    -> snapshot HTML
```

The snapshot renderer receives no loader and performs no route parsing, range
resolution, report filtering, history membership, truncation verdict,
usage/evidence aggregation, reconciliation, or unavailable interpretation.
Report/session/model/tool/diagnostic values are data, never trusted markup.
Every dynamic value is escaped for its exact HTML or attribute context.

Pre-M8.4 snapshot HTML contains no executable JavaScript. It has no router, API
client, WebSocket client, authentication/bootstrap runtime, refresh path, or
embedded DTO intended for later computation. Native HTML/CSS may provide
print styles, disclosure controls, and fixed presentation. Snapshot theme is
selected before rendering. Its CSP is deterministic and separate from the
server CSP, using a hash for the exact inlined stylesheet and no script,
connect, or external-resource permission unless a future decision explicitly
requires one.

Identical bounded `SnapshotDto` and theme inputs produce byte-identical HTML.
The artifact remains self-contained and works through `file://` without a
server or network.

### Browser assets

The interactive application uses ordinary package assets:

```text
src/ui/web/
  shell.html
  style.css
  route.js
  range.js
  client.js
```

The server serves these assets unchanged. The static snapshot does not include
`route.js`, `range.js`, or `client.js`; it may inline the known stylesheet.
Classic scripts load in explicit deterministic order and use one bounded
`globalThis.SessionInspectorWeb` namespace (or an equivalent single owned
namespace).

Browser assets own only interaction/presentation behavior: route
parsing/serialization, hash navigation, Back/Forward state, tab/sidebar state,
range intent, search/sort UI state, token bootstrap, HTTP requests, loading and
error state, DOM rendering, and theme behavior. They use `textContent` and
bounded attribute setters for report data; report-derived `innerHTML` is
forbidden.

Browser assets do not own canonical reconciliation, scope semantics, evidence
or coverage interpretation, usage accounting, date attribution, report
aggregation, truncation, partial history, or unavailable-versus-zero rules.
No bundler or runtime TypeScript transformation is introduced before Pre-M8.6.
Pre-M8.6 may compare this unbundled client with an optional bundled candidate
without revisiting server adoption.

### Localhost server and API

The server uses only Node `node:http` and `node:crypto`. It is a lazy singleton
per Pi process: no registration-time autostart, daemon, service, global
cross-process listener, or server for `snapshot`/`json`/`tui`. It binds only to
`127.0.0.1:0`, exposes an explicit `close()` for tests, and obtains current
session/evidence context through request-time composition-root callbacks.

The initial protected API surface is:

```text
GET /api/v1/ui
GET /api/v1/reports/sessions/{sessionId}
GET /api/v1/reports/global
```

Shell and known static assets support `GET` and `HEAD`. `/api/v1/*` supports
`GET` only. There is no mutation API and no separate refresh route; refresh is
a new request to `/api/v1/ui`. The deferred collection resource is:

```text
GET /api/v1/reports/sessions
```

It may later add bounded, allowlisted `from`, `to`, `availability`, `sort`,
`limit`, and `cursor` parameters without requiring v2. Pagination must limit
returned rows only, preserve evidence discovery/coverage semantics, use stable
deterministic ordering, and never fabricate an exact total when discovery is
capped.

### Authentication and network boundary

The server generates one process/server-instance capability token with
`node:crypto.randomBytes(32)`, encoded in a bounded base64url representation.
The token has 256 random bits, is never derived from session, report, process,
path, or timestamp data, and is retained only in process memory. It expires
when the server closes or the Pi process exits; no idle/time-to-live rotation
exists.

The bootstrap URL is:

```text
http://127.0.0.1:<port>/#token=<token>
```

The fragment is the only transient non-route hash state. The browser consumes
it before route parsing, keeps the token in memory, and uses
`history.replaceState()` to replace it with the canonical default route
without adding a history entry. Back/Forward can never restore the bootstrap
fragment. Reloading the sanitized canonical URL loses authentication and
requires a fresh bootstrap URL.

Report-bearing requests send only:

```http
Authorization: Bearer <token>
```

Tokens are never accepted from query strings, cookies, storage, route state,
exports, referrers, logs, or diagnostics. Bearer comparison is constant-time
after bounded format/length validation.

Every request requires exact `Host: 127.0.0.1:<port>` and a loopback peer.
IPv4-mapped loopback is normalized only as the same loopback representation.
When present, `Origin` must equal `http://127.0.0.1:<port>`; `null`, aliases,
forwarded headers, and non-loopback values are rejected. Missing Origin is
allowed for documented shell/static-asset navigations after Host/peer
validation; non-browser/internal protected API calls may omit it only after
Host/peer and bearer-auth validation. CORS, redirects, arbitrary filesystem
paths, and private-network allowlists are not used.

WSL2-to-Windows-browser localhost forwarding remains an explicit UAT case. If
actual forwarding presents a non-loopback peer, the test records a security
contract conflict; the implementation does not weaken the loopback rule
preemptively.

Server shell/assets use a restrictive same-origin CSP:

```text
default-src 'self'; script-src 'self'; style-src 'self';
connect-src 'self'; object-src 'none'; base-uri 'none';
form-action 'none'; frame-ancestors 'none'
```

Responses set no-store/no-cache and no-referrer protections. Unauthenticated
shell/assets contain no report or session state.

### Errors and diagnostics

Transport failures use bounded RFC 9457-style `application/problem+json` with
fixed safe `type`, `title`, `status`, `detail`, and `code` values plus bounded
`retryable` and opaque `correlationId` fields. No raw exception, path, token,
query, rejected input, or producer string is returned.

Report-level failures remain `HTTP 200` DTO availability/coverage states when
the canonical loader can represent them. Startup failures become concise CLI
notifications. Browser failures render bounded retry/error state.

Startup, asset, API, refresh, and snapshot/export failures emit one-line JSON
stderr events containing only fixed event/phase/code, bounded status,
request/correlation ID, and `redactBoundedText`-sanitized bounded reason.
Logging is best-effort and cannot affect Pi execution.

## Alternatives considered

- Keep one interactive static HTML application: rejected; it duplicates the
  browser application and requires embedding route/range/report semantics.
- Keep `Function.prototype.toString()` module inlining: rejected; it couples
  output to transpiler/module-scope details and prevents ordinary assets.
- Precompute several static range variants: rejected; immutable snapshots carry
  one resolved projection, so variant selection and range runtime are needless.
- Let snapshot JavaScript recompute ranges or report totals: rejected; it would
  create a second L2 owner.
- Keep `ui --output` as an alias: rejected; there are no external compatibility
  obligations and `snapshot` is the explicit artifact surface.
- Add `/api/v2` for the deferred sessions collection: rejected; additive
  resources belong in v1. v2 is reserved for breaking representation or
  semantic changes.
- Add Express/Fastify, a generic query language, a daemon, or a runtime
  TypeScript transformer: rejected as unnecessary scope and boundary risk.
- Broaden WSL2 peer validation to private addresses: rejected; UAT evidence
  must drive any deliberate future security decision.

## Consequences

The static artifact is smaller in responsibility, safer to move/share, and
cannot become a stale second copy of the interactive application. Removing the
inline client program, inlined TypeScript modules, static router, static range
projection, API client, bootstrap code, and static multi-range variants
eliminates the fragile custom HTML-generation path. Interactive DOM code still
exists, but as ordinary browser assets measured directly by Pre-M8.6.

The cost is a deliberate product distinction: localhost UI is required for
interactive navigation, refresh, and arbitrary custom ranges; snapshots are
immutable archival projections. Snapshot output no longer supports in-document
Current/History/Global navigation or offline range recomputation. The command
surface changes before 1.0 and requires the `0.10.0` migration note.

`/api/v1/ui` provides one logical snapshot per request. Independent session and
global resource calls are not cross-request consistent. Every range-bearing
response identifies its per-projection resolved range, so a shared preset can
be interpreted correctly when report date anchors differ.

Report/evidence semantics remain in TypeScript L2 and are testable without a
browser. The browser tests the actual shipped classic assets for interaction
only. Snapshot tests inspect final HTML for determinism, privacy, no network,
no executable JavaScript, and correct context escaping.

## Supersession

This ADR supersedes the delivery and ownership portions of ADR 0015's
interactive “Single offline `ui` bundle” decision. ADR 0015's sanitized
inventory, presence, retention, and subagent-discovery decisions remain in
force.

This ADR supersedes ADR 0017's browser-specific assumptions that the route and
range modules are inlined into static HTML and that static HTML is the full
interactive application. ADR 0017's coverage, attribution, navigation
semantic contracts, and completion-provider findings remain in force where
not changed here.

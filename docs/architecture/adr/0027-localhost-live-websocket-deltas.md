# ADR 0027: Same-process WebSocket deltas for the localhost UI

**Status:** accepted.

## Context

The localhost UI originally loaded a canonical report snapshot on startup and
only observed later changes after an explicit Refresh. A live path must not
become a second report producer, read Pi session files independently, leak
persisted content, or perform work when no browser is listening. The existing
localhost listener is loopback-only and process-local; immutable HTML snapshots
must remain self-contained and offline.

## Decision

Use a same-listener WebSocket endpoint, `/api/v1/ui-live`, for the interactive
localhost UI. Use the `ws` package as a direct dependency because Node's
built-in WebSocket client does not supply the bounded no-server upgrade endpoint
required here. The upgrade must pass exact loopback Host, peer, Origin, and path
checks before `ws` handles it.

The UI bootstrap is a 32-byte random, base64url token delivered only in the
initial URL fragment. It expires after 60 seconds; issuing a newer unredeemed
token invalidates the previous one. The browser removes the fragment before
route parsing and exchanges the token once through a bodyless
`POST /api/v1/ui-session`. The exchange returns a separate 32-byte random
runtime capability. The capability is sent as the HTTP bearer credential and
in the first WebSocket `subscribe` message only; it is never placed in a
WebSocket URL, browser storage, or diagnostics. It remains in memory until the
owning server/runtime closes or is replaced.

The server context is owned by a Pi `runtimeId` and the current
`ExtensionCommandContext.cwd` project root, not the shared Inspector storage
root. Context replacement retires the prior listener/capabilities; shutdown
closes only the matching runtime owner. The server remains lazy, bound to
`127.0.0.1:0`, and unavailable to `snapshot`, `json`, or `tui` modes.

An in-process, payload-free invalidation signal is emitted only after a
successful Inspector WAL flush. With no authenticated WebSocket subscriber, the
signal causes no report load or diff. Otherwise, invalidations coalesce for
200 ms and the canonical `loadInspectorBundle()`/L2 projection path creates the
next snapshot. `GET /api/v1/ui` and the channel share one canonical serialization
revision: quoted SHA-256 of the serialized DTO encoded as base64url. HTTP GET
always returns the full DTO with status 200; conditional `If-None-Match`/304 is
not introduced. When the client's `baseEtag` and canonical range match, send
only changed top-level DTO sections. A stale ETag/range receives the full DTO
snapshot for resynchronization. An unchanged snapshot emits no delta.

Bound the channel to eight total pending plus authenticated sockets, a five
second first-message authorization window, a 1 KiB WebSocket frame limit, and
30-second liveness pings. Each socket's queued bytes plus its next UTF-8
message may not exceed 4 MiB; terminate a slow consumer that would exceed this
limit. This permits the observed 1.24 MiB full snapshot with margin while
bounding repeated deltas. With at most eight sockets, queued WebSocket payload
is bounded to 32
MiB total. The existing retryable abnormal-close path reconnects from the
client's last ETag. Disable compression. The channel clears timers,
subscriptions, and baseline state when unused or when its owner closes. The
CSP permits the exact-port loopback WebSocket endpoint only. The client retains
the last report while reconnecting or after terminal closure; startup, recovery,
and explicit Refresh remain full HTTP snapshots. The static `file://` report is
unchanged and contains no WebSocket code.

Live invalidation is same-process only. Do not add filesystem watchers,
polling, cross-process messaging, a daemon, or incremental report computation.
Pi persisted data remains the source of truth; Inspector WAL is only a
successful-write signal boundary.

## Alternatives considered

- **Server-Sent Events:** rejected. A one-way transport is possible, but does
  not remove the need for a bounded client subscription, a reconnect protocol,
  exact runtime authorization, or snapshot resynchronization. WebSocket upgrade
  handling already has a bounded direct dependency and enables the single
  `subscribe` message carrying capability, ETag, and canonical range.
- **Signal-only push followed by full HTTP reload for every change:** rejected.
  It avoids DTO delta framing but re-sends unchanged sections and does not
  reduce the cost of a changed report. The WebSocket carries only canonical
  DTO section replacements, never raw producer or Pi session data.
- **Filesystem watch or polling:** rejected. It would observe the Inspector
  storage boundary rather than successful in-process persistence, add repeated
  I/O or race-prone file-tail state, and fail to provide cross-process
  correctness. Cross-process updates remain deferred rather than approximated.
- **Cross-process service or bus:** rejected as outside the local, ephemeral
  runtime boundary and unnecessary for same-Pi-process live observation.

## Consequences

The localhost UI can reflect persisted updates without a manual refresh while
sharing the existing report DTO and report loader. Authentication and resource
usage are bounded; zero subscribers cause zero report work. WebSocket delivery
is best-effort and process-local: a reconnect, stale baseline, range change, or
revision gap requires a full canonical snapshot, and no cross-process event is
promised. `ws` is a direct runtime dependency. `snapshot` output, its offline
security boundary, report DTO semantics, and billing authority are unchanged.

See the normative endpoint, auth, CSP, ETag, and error contracts in
[ADR 0018](0018-ephemeral-localhost-ui-and-immutable-snapshots.md) and
[the v1 specification](../../specs/pi-session-inspector-v1.md#localhost-ui-and-immutable-snapshots).

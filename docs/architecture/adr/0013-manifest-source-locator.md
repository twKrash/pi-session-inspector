# ADR 0013: manifest source locator

**Status:** accepted.

## Context

Manifest-only history discovery is bounded, but a session ID alone cannot reopen Pi JSONL through a public lookup API without scanning Pi sessions. Public `SessionManager.list()` would violate bounded discovery.

## Decision

Tracking manifests start at schema version 2 before first release. They retain only `sourceFile`: a validated `.jsonl` basename directly inside Pi's public `sessionManager.getSessionDir()` at tracking start. The Inspector never persists a full source path, never renders or exports the basename, and resolves it only by joining the public current session directory after validating containment.

Sessions whose source is outside that directory are not admitted to durable history replay. Pi JSONL remains authority; no source file is modified.

## Consequences

History/global replay stays manifest-bounded and scan-free. v2 is release baseline: no v1 compatibility reader or migration is required before shipping.

# ADR 0011: local-only privacy

**Status:** accepted.

Persist only bounded/redacted metadata, not content or raw payloads. An errored tool result may contribute only text passed through the shared bounded redactor; raw tool content, arguments, and non-text blocks remain excluded. Use local files/user permissions, offline exports, sensitive-report warnings. Redaction is defense-in-depth, not safe-sharing guarantee.

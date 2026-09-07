# ADR 0012: hot retention

**Status:** accepted.

Keep raw Inspector WAL for 14 inactive days. Then validate sealed checkpoint under lease before deleting only Inspector WAL. Pi sources stay untouched; report cache expires separately; explicit exports stay user-owned.

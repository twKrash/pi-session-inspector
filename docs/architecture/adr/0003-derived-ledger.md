# ADR 0003: derived ledger

**Status:** accepted.

Ledger is a lazy chronological projection of canonical records, not mutable primary storage. This prevents competing totals and keeps TUI, HTML and JSON based on one reducer.

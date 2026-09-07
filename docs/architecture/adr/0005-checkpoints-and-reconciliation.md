# ADR 0005: checkpoints and reconciliation

**Status:** accepted.

Checkpoint/reconcile/prune use short per-session maintenance lease, reread cursors, validate temp, atomic rename, and replay fallback. Starts become interrupted only after terminal reconciliation.

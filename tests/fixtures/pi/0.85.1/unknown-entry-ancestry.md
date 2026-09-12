# `unknown-entry-ancestry.jsonl` provenance

**This fixture is synthetic.** It is hand-written for the Evidence Foundation
tests and contains no real session content, IDs, paths, or producer values.

Shape (Pi session JSONL v3, valid JSONL — one JSON object per line):

1. v3 session header with the synthetic id `unknown-entry-ancestry-session`;
2. the tracking marker (`session-inspector:tracking-start`, schema 1);
3. a known `message` node (`known-parent`);
4. an unknown-typed node (`future_entry`, `unknown-middle`) whose raw payload
   must never become a fact;
5. a known `message` leaf (`known-leaf`) whose parent is the unknown node.

Why: design §18.2 requires that an unknown-semantic node between a known node
and the known selected leaf keeps the Active ancestry resolvable.

The provenance statement lives in this sibling file instead of a header line
inside the fixture (controller ruling R55): `parseSessionJsonl` marks any
non-JSON line as malformed input (`src/pi/adapter.ts`), so a comment line would
change the fixture's health from `supported` to `partial`.

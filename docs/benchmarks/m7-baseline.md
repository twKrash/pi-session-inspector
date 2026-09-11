# M7 benchmark baseline

Measured 2026-09-11 on `node v22.22.1`, `linux-x64` (x86_64), corpus version `1`
(fixed seed `20260907`). Reproduce with `npm run benchmark:release`
(`10` warm / `3` cold samples); the raw artifact is written to
`benchmark/artifacts/release-latest.json` and is not committed.

These are measurements, not release gates. Per the spec, hard regression
gates begin only after two accepted release baselines establish variance.

| Measurement | Median | p95 | Worst | Target | Status |
| --- | --- | --- | --- | --- | --- |
| Cold 100 MiB replay (107,437 records, 102.6 MB) | 746.6 ms | 804.1 ms | 804.1 ms | < 2,000 ms | pass |
| 10k-record warm replay (parse + selectScope + reduce + toSessionReport + renderJson) | 42.9 ms | 46.0 ms | 46.0 ms | n/a (proxy) | reference |
| Incremental memory, 10k records | 3.32 MB | 3.32 MB | 3.32 MB | <= 10 MiB | pass |
| Checkpoint read fold, 1,000 checkpoints (raw readCheckpoint + token sum) | 319.2 ms | 327.5 ms | 327.5 ms | n/a (proxy) | reference |
| HTML render, 10k records | 8.7 ms | 13.2 ms | 13.2 ms | < 3,000 ms | pass |
| HTML size, 10k records | 2.31 MB | - | 2.31 MB | < 5 MiB | pass |

## Not measured by this harness

- **10k delta reconcile** (< 250 ms): requires live maintenance/reconcile
  hooks. The warm 10k replay timing above is a proxy, not this SLO.
- **Global fold, 1,000 checkpoints** (< 2 s): requires `loadGlobalReport`.
  The checkpoint read fold above is a proxy, not this SLO.
- **Observer scheduling** (p95 < 1 ms, p99 < 5 ms): requires live Pi hooks.
- **Startup** (p95 < 25 ms warm / < 75 ms cold): measured by the release
  packaging job, not by the corpus harness.
- **Current TUI warm paint** (< 150 ms): requires a TUI host; HTML render
  time is reported instead.

## Corpus

`benchmark/corpus.ts` generates synthetic filler only — no prompt, response,
real tool argument, or real session text. Tool calls use the canonical
`toolCall` shape with an empty synthetic `arguments: {}` object so the reducer
exercises the real tool path. Inputs are deterministic for a given
`CORPUS_VERSION` and seed, so re-runs are comparable:

- `session-10k.jsonl`: 10,000 records.
- `session-100mb.jsonl`: 107,437 records / 102.6 MB, sized to the 100 MiB
  target.
- 1,000 derived checkpoints accepted by the real `readCheckpoint` reader.

`tests/unit/benchmark-corpus.test.ts` guards corpus determinism and reader
compatibility.

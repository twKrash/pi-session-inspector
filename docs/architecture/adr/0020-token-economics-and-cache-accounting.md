# ADR 0020: token economics and cache accounting

**Status:** accepted.

## Context

Pi persisted usage is the billing and source authority. Inspector already keeps
`totalTokens`, total native cost, and the four native token buckets in its
canonical usage model, but it drops Pi's per-bucket native costs and reasoning
signal. History, global, daily, HTML, JSON, and TUI surfaces therefore cannot
show the same token economics, and the existing cache percentage has no
published denominator or coverage contract.

A second usage ledger would create a competing authority. Renderer-specific
math would make JSON, HTML, and TUI disagree. Treating missing optional fields
as zero would turn provider differences and partial history into false
precision.

## Decision

### Pi remains the authority

Inspector reads Pi session usage and derives bounded report data. It does not
write Pi session JSONL, change Pi totals, or create a billing ledger. This is a
read-time additive report change: no WAL, checkpoint, retention, or session
schema change is required.

The internal `Usage` value retains the existing authoritative fields:

- `totalTokens` and total `cost`;
- optional `inputTokens`, `outputTokens`, `cacheReadTokens`, and
  `cacheWriteTokens`.

It additionally retains, when Pi provides valid native values:

- optional `reasoningTokens` from Pi's `usage.reasoning`;
- optional `inputCost`, `outputCost`, `cacheReadCost`, and `cacheWriteCost`
  from Pi's per-bucket native cost fields.

Each optional field is validated independently. A malformed optional field is
omitted without rejecting an otherwise valid usage record. Missing fields stay
missing. Native zero stays zero. Inspector never derives a bucket cost from
total cost, derives reasoning tokens from output tokens, or adds reasoning
tokens to `totalTokens` (Pi defines reasoning as an output subset). Pi's
`cacheWrite` remains the displayed cache-write bucket; no separate
`cacheWrite1h` metric is introduced by this decision.

### One canonical economics projection

Canonical aggregation continues to sum `totalTokens` and total native cost as
before. Optional token and cost fields are summed only across observed values;
absence is not serialized as zero.

The report layer adds one shared token-economics projection. It contains
input, output, cache-read, and cache-write buckets with optional token and
native-cost values, plus an optional reasoning-token value. Each bucket carries
independent token and cost coverage with this vocabulary:

- `complete`: every included native usage owner supplied the field;
- `partial`: at least one included owner supplied it and at least one did not;
- `unavailable`: no included owner supplied it.

A partial aggregate may publish the sum of observed values, but it must carry
`partial` coverage and may never be headlined as a complete total. An
unavailable field is omitted and renders `Unavailable`. An observed native zero
remains a known zero. History/global coverage also remains partial when known
usage is combined with unavailable or incomplete contributing sessions; an
unavailable session never contributes a synthetic zero.

All current, history, global, and daily range projections use this same
projection. JSON, HTML, and TUI consume the resulting DTO; no renderer parses
raw Pi usage or implements its own bucket math. The TUI may render coverage
inline rather than adding a separate coverage panel.

### Cache reuse is explicitly derived

Cache reuse is the cache-read share of input-side tokens:

```text
cacheRead / (input + cacheRead + cacheWrite) * 100
```

The denominator excludes output tokens. The projection publishes the
calculated denominator and the coverage state used to calculate it. The
percentage is calculated only when all three aggregate token values are
present and the denominator is greater than zero; it is rounded to one decimal
place. A zero denominator is known-but-not-applicable, not `0%`. If any input
bucket is absent, the percentage is unavailable. The existing
`cacheHitPercent` compatibility value is fed by this same helper.

### Presentation and charts

The four required token buckets are available in session, history, and global
views. The existing daily multi-metric chart can select input, output,
cache-read, and cache-write tokens. Reasoning tokens are exposed as an
optional non-additive detail value, not as a chart metric, because they are a
subset of output. Cost breakdowns use only native per-bucket costs and retain
unavailable-vs-zero semantics.

## Alternatives considered

1. **Patch each renderer.** Rejected: duplicates the cache formula and causes
   JSON, HTML, and TUI drift.
2. **Allocate missing bucket costs from total cost.** Rejected: provider pricing
   and missing evidence make the result fabricated.
3. **Add a second usage ledger.** Rejected: conflicts with Pi's source-of-truth
   and creates reconciliation work Inspector cannot justify.

## Consequences

- Existing total token and total-cost values remain stable.
- Provider-specific bucket support is visible without guessing.
- Partial history is honest but may show `Known` values with coverage rather
  than a fabricated complete total.
- All surfaces gain a common economics contract and fixture-backed parity
  tests.
- The public report DTO grows additively; persisted Pi and Inspector storage
  formats do not.

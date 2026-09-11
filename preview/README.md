# M6 UI preview — approval checkpoint

Open [`m6.html`](./m6.html) directly in a browser (`file://`). Everything is inline: vanilla JavaScript, CSS, SVG icons, and synthetic fixtures. No server, CDN, fonts, storage access, or network requests. The HTML is approximately 37 KB.

## Try it

- Switch Current session / Session history / Global report.
- History and Global share a visible 7D / 14D / 30D / Custom range bar, defaulting to Last 14 days. Exact inclusive UTC dates always appear. Presets use the fixed preview snapshot date, September 7, 2026 (not the machine clock).
- Custom opens native From/To date inputs with Apply, Cancel, and reversed-range validation. Applying filters sample history rows, global totals, charts, and exported summaries. Current session ignores the global range; switching views preserves it.
- History has compact Duration, Tokens, Generations, Agents, Status, and full-tree Cost columns. Missing evidence is labeled Unavailable; an observed zero stays zero. Open a row to inspect full-tree scope.
- Switch active ancestry / full tree in a current report.
- Explore all nine sections. Commands, Skills, and Errors demonstrate unavailable evidence rather than invented counts.
- Search and sort detail tables. Daily activity is an inline SVG line chart with Cost / Tokens / Generations / Tool calls and an accessible exact-value table. Model cost and Tool activity remain horizontal bars.
- Entry scope and date range share a data-scope group. Theme and export are secondary utilities.
- Summary cards include explicit sample input/output/cache tokens and observed child-cost context (never added to native totals). Secondary text has slightly stronger light/dark contrast.
- Toggle light/dark themes or resize to mobile.
- Export sample JSON (synthetic scope/usage summary, **not** the production report DTO).

## Intentionally not wired

No changes to `src/`, commands, report DTOs, package dependencies, or version. Fixtures demonstrate layout and interactions, not real session analytics. Agent display aliases are synthetic; production must use validated report IDs.

After visual approval: wire the shared DTO, complete the English translation catalog/fallback, production HTML escaping/CSP tests, deterministic full-report JSON, safe platform opening, and report-cache cleanup. None of those M6 release requirements is claimed complete here.

## Optional browser check

`check.mjs` uses Playwright only as external development tooling; it is not a project dependency or part of the report. With Playwright and its browser installed separately:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node preview/check.mjs
```

Checks direct `file://` loading, section navigation, scope totals, history drill-down, chart switching, search escaping, sorting, JSON download, mobile overflow, themes, and absence of browser errors/external requests. Checks also cover shared date selection, line metric switching, empty/single-zero-day charts, token breakdown totals, and dense history columns. Screenshots are written to `/tmp/inspector-m6-{desktop,dark,mobile,history,date-range}.png`.

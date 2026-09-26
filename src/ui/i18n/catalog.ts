/**
 * The one local English catalog shared by TypeScript renderers and the browser
 * bundle. Keys describe Inspector presentation states; they never carry report
 * semantics or producer text.
 */
export const ENGLISH_CATALOG = {
  "report.title": "Pi Session Inspector",
  "nav.current": "Current session",
  "nav.history": "Session history",
  "nav.global": "Global report",
  "nav.back": "Back to tracked sessions",
  workspace: "Workspace",
  "tag.local": "LOCAL REPORT",
  "tag.snapshot": "Snapshot",
  "heading.current": "A session, in focus.",
  "heading.history": "Pick up the trail.",
  "heading.global": "The bigger picture.",
  "kicker.current": "SESSION REPORT",
  "kicker.history": "TRACKED HISTORY",
  "kicker.global": "WORKSPACE REPORT",
  "subtitle.current":
    "Resource use, tool activity, and the evidence behind it.",
  "subtitle.history":
    "Browse tracked sessions. No global Pi scan. No raw conversation content.",
  "subtitle.global":
    "Native usage within the selected dates. Each session counted once.",
  "theme.dark": "Dark theme",
  "theme.light": "Light theme",
  // What the one live region says while a request is in flight, and the visible
  // line the same words fill. The applied route replaces it once data lands.
  "state.loading": "Loading report…",
  // The header control that re-reads the report from the running Inspector.
  "action.refresh": "Refresh",
  "scope.label": "Entry scope",
  "scope.active": "Active path",
  "scope.tree": "Full session tree",
  "scope.active.note": "Selected entry and its parent ancestry",
  "scope.tree.note": "All tracked branches in this session",
  "scope.sameReport":
    "Active path and Full session tree produce the same report data for this session.",
  "scope.fixed": "History & Global use full tree.",
  "range.label": "Date range",
  "range.last": "Last {days} days",
  "range.custom": "Custom range",
  "range.inclusive": "Inclusive UTC dates",
  "range.custom.title": "Custom date range",
  "range.from": "From",
  "range.to": "To",
  "range.cancel": "Cancel",
  "range.apply": "Apply range",
  "range.error": "From must be on or before To.",
  "range.truncated": "Older days beyond the retained window are not shown.",
  "range.restored": "Range could not be restored; showing the default range.",
  // The one-line degradation notice a hash can produce (design §9.1): a section
  // or tab this document cannot render is named, never silently ignored.
  "nav.unavailable": "That view isn't available here.",
  // The live-region suffix a followed entity link adds; the highlighted row is
  // named by its own label, never by this string.
  "nav.entityFocus": "Focused entity",
  "panel.allDates": "All report dates",
  "tab.overview": "Overview",
  // One tab for the whole LLM side of a scope: the model table and, under it,
  // the child-run breakdown of the same rows.
  "tab.llm": "LLM",
  "tab.tools": "Tools",
  // The browser's inventory grouping (design §9.3): Commands and Sources are
  // sub-navigation inside this one environment panel. Skills has its own tab
  // beside Overview/LLM/Tools/Integrations/Errors/Ledger.
  "tab.environment": "Environment",
  // The LLM tab's two subjects: model usage, and the execution topology of the
  // child runs those models produced. The heading is what separates them.
  "section.agentExecution": "Agent execution",
  "tab.commands": "Commands",
  "tab.agents": "Agents",
  "tab.skills": "Skills",
  "tab.integrations": "Integrations",
  "tab.errors": "Errors",
  "tab.ledger": "Ledger",
  "metric.cost": "Native cost",
  "metric.knownCost": "Known native cost",
  "metric.costUnavailable": "Unavailable",
  "metric.tokens": "Total tokens",
  "metric.knownTokens": "Known tokens",
  "metric.correlated": "Correlated",
  "metric.cacheHit": "Cache hit",
  "metric.compactions": "Compactions",
  "metric.compactions.note": "Persisted native compaction events",
  "metric.generations": "Generations",
  "metric.tools": "Tool calls",
  "metric.sessions": "Tracked sessions",
  "metric.days": "Observed days",
  "metric.native": "Persisted usage · USD",
  "metric.input": "Input",
  "metric.output": "Output",
  "metric.cache": "Cache",
  "metric.cache.note": "Reuse = read / (input + read + write)",
  "metric.cacheRead": "Cache read",
  "metric.cacheWrite": "Cache write",
  "metric.inputTokens": "Input tokens",
  "metric.outputTokens": "Output tokens",
  "metric.cacheReadTokens": "Cache read tokens",
  "metric.cacheWriteTokens": "Cache write tokens",
  "metric.reasoningTokens": "Reasoning tokens",
  "metric.inputCost": "Input cost",
  "metric.outputCost": "Output cost",
  "metric.cacheReadCost": "Cache read cost",
  "metric.cacheWriteCost": "Cache write cost",
  "metric.cacheReuse": "Cache reuse",
  "metric.cacheDenominator": "Cache denominator",
  "metric.coverage": "Coverage",
  "metric.tokens.note": "Persisted split, summed by source",
  "metric.generations.note": "Recorded model responses",
  "metric.tools.note": "Observed native calls",
  "metric.days.note": "UTC days with persisted records",
  "metric.sessions.global.note":
    "All report dates; daily rows carry range detail",
  "metric.duration": "Duration",
  "metric.duration.note": "First to last native record · native confidence",
  "metric.usage.generations": "Generations",
  "metric.usage.toolResults": "Tool results",
  "metric.usage.compactions": "Compactions",
  "metric.usage.branchSummaries": "Branch summaries",
  "usage.title": "Usage composition",
  "usage.note":
    "Generations, tool results, compactions, and branch summaries are persisted native usage, counted once.",
  "usage.total": "Total",
  "usage.reconciled": "Reconciles to total",
  "usage.unreconciled": "Does not reconcile to total",
  "panel.models": "Model cost",
  "panel.tools": "Tool activity",
  "panel.evidence": "Evidence, not estimates.",
  "panel.daily": "Daily activity",
  "panel.history": "Tracked sessions",
  "panel.agents": "Agent breakdown",
  "panel.agentActivity": "Agent tool activity",
  "panel.integrations": "Integrations",
  "panel.ledger": "Chronological ledger",
  "evidence.native": "Native",
  "evidence.live": "Live",
  "evidence.cooperative": "Cooperative",
  "evidence.supported": "Supported",
  "evidence.unavailable": "Unavailable",
  "evidence.unsupported": "Unsupported",
  "evidence.source": "Source-aware",
  "evidence.note":
    "Every metric keeps its source. Missing observations stay missing.",
  "evidence.piRecords": "Pi persisted records",
  "evidence.piRecords.detail":
    "{generations} generations · {tools} tool calls · {models} models",
  "evidence.span": "Session span",
  "evidence.span.detail": "first to last native record",
  "evidence.span.missing": "Fewer than two native records",
  "evidence.toolTiming": "Tool timing (live)",
  "evidence.toolTiming.detail": "{count} correlated tool durations",
  "evidence.toolTiming.missing": "No correlated live timing",
  "evidence.child": "Child agent usage",
  "evidence.child.detail": "{count} runs · breakdown only, never added",
  "evidence.child.missing": "No native subagent activity observed",
  "evidence.errors": "Persisted error records",
  "evidence.errors.detail": "{count} bounded classifications",
  "evidence.integration": "Integration evidence",
  "evidence.integration.missing": "No persisted integration evidence",
  "evidence.retries": "Provider retries",
  "evidence.retries.detail": "Not observed; provider retries are unavailable",
  "evidence.history.sessions":
    "{available} of {total} tracked sessions replayed",
  "evidence.history.span": "{count} sessions with a native span",
  "evidence.history.child": "{count} sessions with supported child evidence",
  "evidence.history.integrations": "{count} supported integration observations",
  "evidence.history.errors": "{count} sessions with persisted error records",
  "evidence.global.days":
    "{days} observed UTC days · {sessions} replayed sessions",
  "evidence.global.composition": "Not exposed by global daily aggregates",
  "evidence.global.agents":
    "Global daily aggregates carry no native subagent activity",
  "evidence.global.integrations":
    "Global report carries no integration observations",
  "evidence.global.errors": "Global report carries no error records",
  "models.note":
    "Persisted generation usage grouped by provider and model. Tool results, compactions, and branch summaries carry no model attribution, so they stay in the session total and never in a model row.",
  "models.none": "No native generations recorded.",
  "tools.note":
    "Tokens and cost appear only when a matching tool result persisted usage.",
  "tools.none": "No native tool calls recorded.",
  "tools.summary": "Tools summary",
  "tools.calls": "Calls timeline",
  "tools.lastUsed": "Last used",
  "tools.usageFraction": "{withUsage} of {total} calls reported usage",
  "tools.durationFraction": "{withDuration} of {total} calls correlated",
  "tools.filteredBy": "Filtered by {tool}",
  "tools.clearFilter": "Show all tools",
  "tools.succeeded": "Succeeded",
  "tools.failed": "Failed",
  "tools.interrupted": "Interrupted",
  "tools.bars.note": "Call count by tool",
  "bars.empty": "No observations in the selected scope.",
  "agents.note":
    "Child usage is a breakdown only. It is never added to native totals.",
  "agents.activity.note":
    "Calls recorded from persisted tool results. Usage is a breakdown only.",
  "agents.unattributedInvocation":
    "Failed or interrupted native calls may have no child-run row when no child identity was published.",
  "agents.childRuns": "Child runs",
  "agents.none":
    "Child-run evidence is unavailable for this session, so no run count is inferred.",
  "agents.succeeded": "Succeeded",
  "agents.failed": "Failed",
  "agents.interrupted": "Interrupted",
  "agents.detached": "Detached",
  "agents.running": "Running",
  "agents.unknown": "Unknown",
  "agents.knownTokens": "Known child tokens",
  "agents.knownCost": "Known child cost",
  "agents.knownFailedCost": "Known failed-run cost",
  "agents.usageFraction": "{withUsage} of {total} runs reported usage",
  "agents.effortKnown": "Known",
  "agents.effortCoverage": "Effort coverage",
  // The Agents execution view. One presentation owns two readings of the same
  // runs: the tree is where the execution topology lives, and the table is the
  // flat breakdown it always was. The session root and a run container are
  // grouping nodes of this view alone: neither is an AgentRun, so neither is
  // ever worded or shaped like one.
  "agents.view.label": "Agents view",
  "agents.view.tree": "Tree",
  "agents.view.table": "Table",
  "agents.tree.session": "Primary session",
  // The root's own scope: the session's persisted native usage, never the
  // generation slice the model table shows and never a child-inclusive total.
  "agents.tree.scope":
    "Session total · persisted native usage for this range (generations, tool results, compactions, and branch summaries).",
  "agents.tree.container": "Run container",
  // Every container row reads the same, so the group ordinal is what tells two
  // of them apart (for a reader who cannot see which list they are in).
  "agents.tree.containerOrdinal": "Run container {ordinal}",
  "agents.tree.container.note":
    "A grouping of the runs this container published. The container is not an agent run, so it has no status, model, or usage of its own.",
  "agents.tree.generations": "{count, number} generations",
  // The singular form of every counted label is written out, so a session with
  // one generation, child, descendant, or model never reads as "1 generations".
  "agents.tree.generations_one": "{count, number} generation",
  "agents.tree.modelsUsed": "{count, number} models used",
  "agents.tree.modelsUsed_one": "{count, number} model used",
  // A capped model list states what it lists, never how many models ran.
  "agents.tree.modelsListed": "{count, number} models listed",
  "agents.tree.modelsListed_one": "{count, number} model listed",
  "agents.tree.models": "Models",
  // The snapshot prints the hierarchy and the flat breakdown of the same rows;
  // this label is what says the rows below are the flat reading.
  "agents.tree.flat": "Flat breakdown",
  "agents.tree.tokens": "{count, number} tokens",
  "agents.tree.tokens_one": "{count, number} token",
  "agents.tree.usageUnavailable": "usage Unavailable",
  "agents.tree.children": "{count, number} children",
  "agents.tree.children_one": "{count, number} child",
  "agents.tree.descendants": "{count, number} descendants",
  "agents.tree.descendants_one": "{count, number} descendant",
  "agents.tree.failed": "{count, number} failed",
  "agents.tree.interrupted": "{count, number} interrupted",
  "agents.tree.withoutUsage": "{count, number} without usage",
  "agents.tree.durationPartial": "{count, number} runs with Known duration",
  "agents.tree.durationPartial_one": "{count, number} run with Known duration",
  "agents.tree.durationUnavailable":
    "{count, number} runs with duration Unavailable",
  "agents.tree.durationUnavailable_one":
    "{count, number} run with duration Unavailable",
  "agents.tree.toolCallsPartial":
    "{count, number} runs with Known tool-call counts",
  "agents.tree.toolCallsPartial_one":
    "{count, number} run with Known tool-call count",
  "agents.tree.toolCallsUnavailable":
    "{count, number} runs with tool-call counts Unavailable",
  "agents.tree.toolCallsUnavailable_one":
    "{count, number} run with tool-call count Unavailable",
  "agents.tree.context": "context",
  "agents.tree.filterAll": "All",
  "agents.tree.durationCoverage": "Duration coverage",
  "agents.tree.filtered":
    "{matched} of {total} runs match · {context} kept for context",
  "agents.tree.empty": "No run matches the current filter.",
  "agents.tree.expand": "Expand {label}",
  "agents.tree.collapse": "Collapse {label}",
  "agents.parentNone": "Parent: none",
  "agents.parentOrchestrationRun": "Parent: orchestration run",
  "agents.parentOutsideScope": "Parent: outside selected scope",
  "agents.parentUnknown": "Parent: Unavailable",
  // A run without an observed time cannot be placed in any range, so an empty
  // range view states the cause instead of blaming the range for the gap.
  "agents.undated":
    "Child runs carry no observed time, so none can be placed in the selected range.",
  "agents.undatedAndOutOfRange":
    "No child run falls inside the selected range, and runs without an observed time cannot be placed in one.",
  "agents.outOfRange": "No child run falls inside the selected range.",
  "commands.note":
    "Loaded or available commands: inventory ≠ invocations. Counts are availability, never activity.",
  "commands.count":
    "No commands inventory on disk. {count} commands were recorded at session start.",
  "skills.note":
    "Loaded or available skills plus observed explicit invocations: inventory ≠ invocations.",
  "skills.empty": "No skills inventory or explicit invocations recorded.",
  "skills.otherInvocations": "+ {count} other invocations",
  // Sources are the capability providers an environment loads (`builtin`,
  // `npm:pi-lens`, `npm:pi-subagents`). The label is user-facing; the DTO field
  // it is read from stays the canonical `resources`.
  "panel.resources": "Sources",
  "resources.note":
    "Loaded or available sources. Counts are availability, never activity.",
  "resources.unavailable": "No source inventory recorded.",
  // The Environment summary (design §8.1): availability is inventory state and,
  // for skills only, the explicit folded counters are the invocation figure.
  // Commands have no counter evidence, so their observed side is Unavailable.
  "env.commands": "Commands",
  "env.skills": "Skills",
  "env.resources": "Sources",
  // The Environment subview labels. The panel values are route grammar
  // (`panel=commands`), so the copy is keyed by panel rather than reusing a
  // metric label whose key names a different thing (`env.resources`).
  "env.panel.commands": "Commands",
  "env.panel.sources": "Sources",
  "env.available": "Available: {count}",
  "env.observed": "Observed invocations: {value}",
  "env.invocationsObserved": "Explicit invocations observed: {count}",
  "env.invocationsUnavailable": "Explicit invocations observed: Unavailable",
  // Inventory is the current environment, not session activity, so the panel
  // carries this period label instead of any range label (§5.2).
  "env.note":
    "Current environment · Inventory is availability, never activity, and is not filtered by the selected range.",
  "table.error": "Error",
  "table.errorCount": "Error count",
  "table.name": "Name",
  "table.invocations": "Invocations",
  "table.scope": "Scope",
  "table.origin": "Origin",
  "table.description": "Description",
  "table.commands": "Commands",
  "table.skills": "Skills",
  "table.prompts": "Prompts",
  "table.calls": "Calls",
  "table.presence": "Presence",
  "table.message": "Message",
  "presence.present": "Present",
  "presence.absent": "Not observed",
  "presence.unknown": "Unknown",
  "integrations.note": "Evidence availability is not installation status.",
  // The four independent integration columns (design §8.2). Detection is
  // inventory-derived, telemetry is evidence-derived, and the two are never
  // reconciled; the reason strings are the closed telemetry vocabulary and the
  // note is a non-state remark that never changes the telemetry value.
  "integration.detected": "Detected",
  "integration.telemetry": "Telemetry",
  "integration.activity": "Activity",
  "integration.version": "Version",
  "integration.sessionTotal": "Session total",
  "integration.reasonUnsupported": "no compatible telemetry evidence",
  "integration.reasonMissing": "no telemetry observed in this session",
  "integration.noteNotDetected": "producer not detected in current inventory",
  "errors.note": "Bounded classifications from persisted stop and error state.",
  "errors.none": "No persisted error records. An observed zero stays zero.",
  // The Errors row leads with what failed: the joined tool's name when the
  // record has one, else the bounded classification label. The raw
  // `tool:call_…` id is never a headline; it stays a row detail.
  "errors.toolFailed": "{tool} failed",
  "errors.failed": "Tool call failed",
  "errors.generation": "Generation error",
  "errors.relatedTool": "Related tool",
  // One row may have many candidates, so the label stays plural-safe and no
  // candidate is ever named as the cause (design §7.5-3).
  "errors.relatedChildren": "Related child run(s)",
  // Missing or unusable error messages use this catalog value; sanitized
  // messages are carried by the shared DTO (design §7.5-4).
  "errors.messageUnavailable": "Unavailable",
  "empty.ledger": "No persisted records to order.",
  "history.note":
    "Open a row to inspect its full-tree sections with the same tabs.",
  "history.sessions.note": "Tracked sessions in the selected range",
  // The aggregate's own notice when a contributing session's retained dated
  // window cannot represent its spend; same bounded sentence as the current
  // view's `range.truncated` (design §5.1).
  "history.dailyTruncated":
    "Older days beyond the retained window are not shown.",
  // Sessions with no dated evidence cannot be attributed to any range.
  "history.groupUnknown": "Unavailable · dates unknown",
  "models.truncated":
    "Older dates' model rows beyond the retained window are not shown.",
  "notice.sensitive": "Local does not mean safe to share.",
  "notice.copy":
    "Report metadata can be sensitive. Review exports before sharing.",
  "walDetail.expired": "Detailed records expired",
  "walDetail.copy":
    "Records older than the 14-day retention window were pruned. Aggregates and native usage remain.",
  "footer.authority":
    "Pi-native usage is billing authority. Child usage is never added.",
  search: "Search rows",
  "search.placeholder": "Filter this table…",
  // The tree filters the same rows, so it carries the same control in its own
  // words rather than calling a tree a table.
  "agents.tree.searchPlaceholder": "Filter these runs…",
  // The default-on availability filters. Each view states the predicate in its
  // own terms, so no view inherits another's meaning of available, and the
  // counts always say what is hidden and how many rows are shown.
  "filter.withEvidence": "With evidence",
  "filter.invokedOnly": "Invoked only",
  "filter.availableOnly": "Available only",
  "filter.count": "{shown} shown · {hidden} hidden",
  "filter.countUnavailable": "{shown} shown · {hidden} hidden/unavailable",
  sort: "Sort order",
  "sort.default": "Source order",
  "sort.name": "Name A–Z",
  "sort.reverse": "Reverse source order",
  "sort.duration-desc": "Duration longest first",
  "chart.metric": "Chart metrics",
  "chart.sessions": "Sessions",
  "chart.cost": "Cost",
  "chart.tokens": "Tokens",
  "chart.generations": "Generations",
  "chart.tools": "Tool calls",
  "chart.inputTokens": "Input tokens",
  "chart.outputTokens": "Output tokens",
  "chart.cacheReadTokens": "Cache read tokens",
  "chart.cacheWriteTokens": "Cache write tokens",
  "chart.empty": "No daily observations match the selected range.",
  "chart.note":
    "{metrics} per observed UTC day. A day that does not publish a metric is a gap in its line, never a zero.",
  "chart.axes":
    "Cost is drawn on the right axis; the count metrics share the left one.",
  "chart.unavailable": "Unavailable in this range: {metrics}.",
  "chart.aria":
    "Daily {metrics} across {days} observed UTC days. Exact values are in the chart data table.",
  "chart.data": "View chart data",
  "table.source": "Source",
  "table.observation": "Observation",
  "table.confidence": "Confidence",
  "table.date": "Date",
  "table.session": "Session",
  "table.sessions": "Sessions",
  "table.tokens": "Tokens",
  "table.generations": "Generations",
  "table.tools": "Tool calls",
  "table.cost": "Cost (USD)",
  "table.duration": "Duration",
  "table.average": "Average",
  "table.agents": "Agents",
  "table.status": "Status",
  "table.inspect": "Inspect",
  "table.open": "Open",
  "table.provider": "Provider",
  "table.model": "Model",
  "table.input": "Input",
  "table.output": "Output",
  "table.cacheRead": "Cache read",
  "table.cacheWrite": "Cache write",
  "table.tool": "Tool",
  "table.run": "Run",
  "table.role": "Role",
  "table.artifacts": "Artifacts",
  "table.parent": "Parent",
  "table.evidence": "Evidence",
  "table.integration": "Integration",
  "table.version": "Version",
  "table.counters": "Counters",
  "table.id": "ID",
  // The Sources table's last column: the tools a source supplies, never the
  // observed runtime calls the Tools view counts.
  "table.sourceTools": "Tools",
  // The one label of an opaque id's copy control (§16); the control names the id
  // it copies, so one row's button is never confused with another's.
  "table.copyId": "Copy ID",
  "table.kind": "Kind",
  "table.timestamp": "Timestamp",
  "table.category": "Category",
  "table.action": "Action",
  "history.scope": "Full-tree report summaries.",
  "status.errors": "Error records",
  "status.interrupted": "Interrupted calls",
  "status.clean": "No error records",
  "unavailable.title": "Unavailable, not zero.",
  "unavailable.copy":
    "Inspector does not infer activity from prompts, outputs, or missing records.",
  "unavailable.session": "Open a tracked session row to inspect this section.",
  "unavailable.global":
    "Global reports carry daily aggregates only. The History report has per-session sections.",
  "unavailable.commands":
    "Pi does not persist command invocation records. Inspector will not infer them from prompts, outputs, or tool names.",
  "unavailable.skills":
    "Pi does not persist skill attribution records. Inspector will not infer them from prompts, outputs, or tool names.",
  "unavailable.composition": "This report carries no per-source usage split.",
  "unavailable.usage":
    "Usage unavailable. The native aggregate was rejected; no total is shown.",
  "unavailable.agents":
    "No native subagent activity recorded for this session.",
  "unavailable.current": "This current view could not be replayed offline.",
  "unavailable.integrations": "No persisted integration observations.",
  "ledger.materialized":
    "Shared projection rows, materialized only when this section opens.",
  offline: "OFFLINE · EN",
  "brand.tagline": "Understand your agent.",
  "local.design": "Local by design",
  "metric.child": "Observed child runs",
  "metric.child.note":
    "breakdown of the session's tool-result usage · never added",
  "coverage.title": "Coverage",
  "coverage.sessions":
    "{available} / {inspected} sessions · {unavailable} unavailable",
  "coverage.complete": "{available} / {inspected} sessions",
  "coverage.sessionsLimited":
    "{inspected} sessions inspected · additional sessions not inspected",
  "coverage.none": "No tracked sessions",
  "coverage.unknown": "Sessions: Unavailable",
  "coverage.reasons": "Reasons: {reasons}",
  "coverage.unknownCompletenessCost":
    "Known native cost — completeness unknown",
  "coverage.unknownCompletenessTokens": "Known tokens — completeness unknown",
} as const;

export type MessageKey = keyof typeof ENGLISH_CATALOG;
export type MessageValues = Record<string, string | number>;

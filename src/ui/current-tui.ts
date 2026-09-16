import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  type Component,
} from "@earendil-works/pi-tui";
import { cacheHitPercent } from "../core/reports.ts";
import { buildLedger } from "../core/ledger.ts";
import { sessionView } from "./report-projection.ts";
import { agentParentVerdicts, type UiAgentParent } from "./ui-projection.ts";
import {
  CURRENT_TABS,
  reduceCurrentTui,
  type CurrentTab,
  type CurrentTuiModel,
  type CurrentTuiState,
} from "./current.ts";

const WIDE_TABS_WIDTH = 87;
/**
 * Content lines rendered at once. The cursor moves by page over rendered lines,
 * never over logical entities, so one entity can never straddle a boundary in
 * the rendered output; header, tabs, scope and help stay outside the slice.
 */
const CONTENT_PAGE_LINES = 12;

/** Availability copy shared by the inventory tabs; never an activity claim. */
const INVENTORY_NOT_INVOCATIONS =
  "Inventory ≠ invocations. Counts are availability, never activity.";

type CurrentTuiComponent = Component & {
  handleInput(data: string): void;
};

const TAB_LABELS: Record<CurrentTab, string> = {
  overview: "Overview",
  models: "Models",
  tools: "Tools",
  commands: "Commands",
  agents: "Agents",
  skills: "Skills",
  integrations: "Integrations",
  errors: "Errors",
  ledger: "Ledger",
};

export function createCurrentTuiComponent({
  model,
  load,
  theme,
  requestRender,
  done,
  initialTab = "overview",
}: {
  model: CurrentTuiModel;
  load(scope: CurrentTuiModel["scope"]): Promise<CurrentTuiModel | undefined>;
  theme: Pick<Theme, "fg">;
  initialTab?: CurrentTab;
  requestRender: () => void;
  done: () => void;
}): CurrentTuiComponent {
  let currentModel = model;
  let state: CurrentTuiState = { tab: initialTab, scope: model.scope, page: 0 };
  let ledger: ReturnType<typeof buildLedger> | undefined;
  let agentRows: ReturnType<typeof agentParentVerdicts> | undefined;
  let latestScopeReload = 0;

  function update(action: Parameters<typeof reduceCurrentTui>[1]): void {
    state = reduceCurrentTui(state, action);
    requestRender();
  }

  async function reloadScope(scope: CurrentTuiModel["scope"]): Promise<void> {
    const requestId = ++latestScopeReload;
    try {
      const nextModel = await load(scope);
      if (requestId !== latestScopeReload || !nextModel) return;
      currentModel = nextModel;
      ledger = undefined;
      agentRows = undefined;
      update({ type: "set-scope", scope });
    } catch {
      // TUI loading failures leave the current report visible.
    }
  }

  return {
    invalidate: () => {},
    handleInput(data): void {
      if (matchesKey(data, Key.escape) || matchesKey(data, "q")) {
        done();
        return;
      }
      if (matchesKey(data, Key.left)) {
        update({ type: "previous-tab" });
      } else if (matchesKey(data, Key.right)) {
        update({ type: "next-tab" });
      } else if (matchesKey(data, Key.down)) {
        update({ type: "next-page", pageCount: contentPageCount() });
      } else if (matchesKey(data, Key.up)) {
        update({ type: "previous-page" });
      } else if (matchesKey(data, "a")) {
        void reloadScope("active");
      } else if (matchesKey(data, "t")) {
        void reloadScope("tree");
      }
    },
    render(width): string[] {
      const content = renderContent(state.tab);
      const pageCount = pageCountOf(content.length);
      // A page can only outlive its content if the content shrank; clamping
      // here keeps the view bounded without a second source of page state.
      const page = Math.min(state.page, pageCount - 1);
      const start = page * CONTENT_PAGE_LINES;
      const lines = [
        theme.fg("accent", "Pi Session Inspector"),
        `Scope: ${state.scope === "active" ? "Active" : "Tree"}`,
        ...renderTabs(width, state.tab),
        "",
        ...content.slice(start, start + CONTENT_PAGE_LINES),
        "",
        ...(pageCount === 1
          ? []
          : [
              `Page ${page + 1}/${pageCount} · lines ${start + 1}–${Math.min(start + CONTENT_PAGE_LINES, content.length)} of ${content.length}`,
            ]),
        theme.fg(
          "dim",
          pageCount === 1
            ? "←/→ tabs  a active  t tree  q quit"
            : "←/→ tabs  ↑/↓ page  a active  t tree  q quit",
        ),
      ];

      return lines.map((line) => truncateToWidth(line, Math.max(0, width), ""));
    },
  };

  /** Pages the current tab's rendered content, never its logical entities. */
  function pageCountOf(contentLines: number): number {
    return Math.max(1, Math.ceil(contentLines / CONTENT_PAGE_LINES));
  }

  function contentPageCount(): number {
    return pageCountOf(renderContent(state.tab).length);
  }

  function renderContent(tab: CurrentTab): string[] {
    switch (tab) {
      case "overview": {
        const usage = currentModel.report.usage;
        if (usage === undefined) return ["Usage: unavailable"];
        const cacheHit = cacheHitPercent(usage);
        const compactions = currentModel.report.compactions.filter(
          (entry) => entry.kind === "compaction",
        ).length;
        return [
          `Total tokens: ${usage.totalTokens}`,
          `Cache hit: ${cacheHit === undefined ? "Unavailable" : `${cacheHit.toFixed(1)}%`}`,
          `Compactions: ${compactions}`,
          `Cost: ${usage.cost}`,
        ];
      }
      case "models":
        return [`Models: ${currentModel.report.models.length}`];
      case "tools":
        return renderTools();
      case "commands":
        return renderCommands();
      case "agents":
        return renderAgents();
      case "skills":
        return renderSkills();
      case "integrations":
        return renderIntegrations();
      case "errors":
        return renderErrors();
      case "ledger":
        ledger ??= buildLedger(currentModel.report);
        return renderLedger(ledger);
      default:
        return ["Unavailable"];
    }
  }

  function renderTools(): string[] {
    const tools = currentModel.report.tools;
    return [
      `Tools: ${tools.length}`,
      ...tools.map(
        (tool) =>
          `Tool: ${tool.name}  Source: ${tool.source ?? "Unavailable"}  Status: ${tool.status}`,
      ),
    ];
  }

  function renderErrors(): string[] {
    const errors = currentModel.report.errors;
    if (errors.length === 0) return ["No persisted error records"];
    return errors.flatMap((error) => [
      `Error: ${error.kind}`,
      `Record: ${error.id}`,
      `Timestamp: ${error.timestamp}`,
      `Message: ${error.message ?? "Unavailable"}`,
      `Confidence: ${error.confidence}`,
    ]);
  }

  function renderLedger(items: ReturnType<typeof buildLedger>): string[] {
    // An ordered report with nothing to order is an observed zero, never
    // missing evidence; this is the HTML renderer's own empty-ledger copy.
    if (items.length === 0) return ["No persisted records to order."];
    return [
      `Ledger events: ${items.length}`,
      ...items.map(
        (item) => `${item.timestamp}  ${item.kind}  ${item.id}  ${item.status}`,
      ),
    ];
  }

  function renderCommands(): string[] {
    const commands = currentModel.report.commands;
    if (commands.state !== "supported") {
      return [
        evidenceLabel(commands.state),
        ...(commands.count === null
          ? []
          : [`Recorded at session start: ${commands.count}`]),
        INVENTORY_NOT_INVOCATIONS,
      ];
    }
    if (commands.items.length === 0) {
      return [
        "No commands inventory",
        ...(commands.count === null
          ? []
          : [`Recorded at session start: ${commands.count}`]),
        INVENTORY_NOT_INVOCATIONS,
      ];
    }
    return [
      `Commands: ${commands.items.length}`,
      INVENTORY_NOT_INVOCATIONS,
      ...commands.items.flatMap((command) => [
        `Command: ${command.name}`,
        `Source: ${command.sourceLabel || command.source}`,
        `Scope: ${command.scope}`,
      ]),
    ];
  }

  function renderSkills(): string[] {
    const skills = currentModel.report.skills;
    const countsKnown = skills.invocationState === "supported";
    const countsSummary = [
      ...(countsKnown && skills.invocationCount !== null
        ? [`Invocations: ${skills.invocationCount}`]
        : []),
      ...(skills.otherInvocations === null || skills.otherInvocations === 0
        ? []
        : [`+ ${skills.otherInvocations} other invocations`]),
    ];

    if (skills.state !== "supported") {
      // Durable invocation counts outlive the inventory snapshot. An expired
      // inventory shows the counted names with `state: "unavailable"`, never a
      // fabricated list; a wholesale `Unavailable` is only correct when there
      // is nothing at all to show (no rows and no counts).
      const hasCounts =
        countsKnown ||
        (skills.invocationCount !== null && skills.invocationCount > 0) ||
        (skills.otherInvocations !== null && skills.otherInvocations > 0);
      if (skills.items.length === 0 && !hasCounts) {
        return [evidenceLabel(skills.state), INVENTORY_NOT_INVOCATIONS];
      }
      return [
        `Inventory: ${evidenceLabel(skills.state)}`,
        INVENTORY_NOT_INVOCATIONS,
        ...countsSummary,
        ...renderSkillRows(skills.items),
      ];
    }

    if (skills.items.length === 0) {
      return ["No skills inventory", INVENTORY_NOT_INVOCATIONS];
    }
    return [
      // Availability is the inventory's own row count, never the rows this
      // view renders: a counted name the snapshot no longer lists is activity.
      `Skills: ${skills.count ?? "Unavailable"}`,
      INVENTORY_NOT_INVOCATIONS,
      ...countsSummary,
      ...renderSkillRows(skills.items),
    ];
  }

  function renderSkillRows(
    items: CurrentTuiModel["report"]["skills"]["items"],
  ): string[] {
    return items.flatMap((skill) => [
      `Skill: ${skill.name}`,
      // An absent per-skill count is unknown evidence, never zero.
      `invocations: ${skill.explicitInvocations ?? "Unavailable"}`,
      `Source: ${skill.sourceLabel ?? "Unavailable"}`,
      `Scope: ${skill.scope ?? "Unavailable"}`,
    ]);
  }

  function renderAgents(): string[] {
    const lines = renderAgentActivity();
    const agents = agentVerdicts();
    if (agents.length === 0) {
      // Native activity alone keeps the tab non-empty; otherwise the tab states
      // that no rich run evidence exists at all.
      return lines.length === 0
        ? [evidenceLabel(currentModel.report.agentEvidence)]
        : lines;
    }
    return [
      ...lines,
      ...renderChildRunSummary(),
      ...agents.flatMap((agent) => [
        `Agent: ${agent.id}`,
        parentLabel(agent.parent),
        ...(agent.agent == null ? [] : [`Label: ${agent.agent}`]),
        `Status: ${agent.status}`,
        ...(agent.artifacts == null ? [] : [`Artifacts: ${agent.artifacts}`]),
        `Evidence: ${agent.confidence}`,
        ...(agent.usage == null
          ? []
          : [
              `Tokens: ${agent.usage.totalTokens}`,
              `Cost: ${agent.usage.cost}`,
              "Child usage is a breakdown only; never added to session totals.",
            ]),
      ]),
    ];
  }

  /**
   * L2's own parent verdicts for the report's full row set. The rows pass
   * through the same normalizer the browser and snapshot use, so the TUI never
   * classifies a parent itself and never renders a raw run identity as one.
   * The TUI selects no subrange, so every parent this report carries is
   * `in-range` and `outside-range` cannot arise here.
   */
  function agentVerdicts(): ReturnType<typeof agentParentVerdicts> {
    if (agentRows === undefined) {
      const rows = sessionView(currentModel.report).agents;
      agentRows = agentParentVerdicts(rows, rows);
    }
    return agentRows;
  }

  /**
   * The child-run count and how many of those runs reported usage. Runs
   * without usage are absent evidence, so the fraction is what keeps a partial
   * set from reading as a complete one; it is never added to a session total.
   */
  function renderChildRunSummary(): string[] {
    const usage = currentModel.report.agentUsage;
    if (usage.runsTotal === 0) return [];
    return [
      `Child runs: ${usage.runsTotal}  usage reported by ${usage.runsWithUsage} of ${usage.runsTotal}`,
    ];
  }

  function renderAgentActivity(): string[] {
    const activity = currentModel.report.agentActivity;
    if (activity.state !== "supported") return [];
    return [
      `Calls: ${activity.calls}`,
      `Succeeded: ${activity.succeeded}`,
      `Failed: ${activity.failed}`,
      `Interrupted: ${activity.interrupted}`,
      ...activity.tools.map(
        (tool) => `Activity tool: ${tool.name}  Calls: ${tool.calls}`,
      ),
      ...(activity.usage === undefined
        ? []
        : [
            `Subagent tokens: ${activity.usage.totalTokens}`,
            `Subagent cost: ${activity.usage.cost}`,
            "Subagent usage is a breakdown only; never added to session totals.",
          ]),
    ];
  }

  function renderIntegrations(): string[] {
    const integrations = currentModel.report.integrations;
    return [
      ...(integrations.length === 0
        ? ["Unavailable"]
        : integrations.flatMap((integration) => [
            `Integration: ${integration.integration}`,
            `Presence: ${presenceLabel(integration.presence)}`,
            `State: ${evidenceLabel(integration.state)}`,
            `Version: ${integration.version ?? "Unavailable"}`,
            ...Object.entries(integration.counters ?? {}).map(
              ([name, value]) => `${name}: ${value}`,
            ),
          ])),
      ...renderResourceSources(),
    ];
  }

  function renderResourceSources(): string[] {
    const resources = currentModel.report.resources;
    if (resources.state !== "supported" || resources.items.length === 0) {
      return ["Resource sources: Unavailable"];
    }
    return [
      `Resource sources: ${resources.items.length}`,
      ...resources.items.map(
        (source) =>
          `Source: ${source.sourceLabel}  Scope: ${source.scope}  Origin: ${source.origin}  commands: ${source.commands}  skills: ${source.skills}  prompts: ${source.prompts}  tools: ${source.tools}`,
      ),
    ];
  }
}

/**
 * The parent cell of one run, worded from L2's published verdict rather than
 * from a raw run identity. Three of these are the browser's own strings; the
 * `in-range` case has no browser equivalent because the browser turns it into a
 * link to the parent row, which a TUI without drill-down cannot offer.
 */
function parentLabel(parent: UiAgentParent): string {
  switch (parent) {
    case "none":
      return "Parent: none";
    case "in-range":
      return "Parent: run in this report";
    case "outside-range":
      return "Parent: outside selected scope";
    case "orchestration-run":
      return "Parent: orchestration run";
    case "unknown":
      return "Parent: Unavailable";
  }
}

function presenceLabel(presence: "present" | "absent" | "unknown"): string {
  switch (presence) {
    case "present":
      return "Present";
    case "absent":
      return "Not observed";
    case "unknown":
      return "Unknown";
  }
}

function evidenceLabel(
  state: "supported" | "unavailable" | "unsupported",
): string {
  switch (state) {
    case "supported":
      return "Supported";
    case "unsupported":
      return "Unsupported";
    case "unavailable":
      return "Unavailable";
  }
}

function renderTabs(width: number, selectedTab: CurrentTab): string[] {
  if (width >= WIDE_TABS_WIDTH) {
    return [CURRENT_TABS.map((tab) => TAB_LABELS[tab]).join(" | ")];
  }

  return CURRENT_TABS.map(
    (tab) => `${tab === selectedTab ? ">" : " "} ${TAB_LABELS[tab]}`,
  );
}

import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  type Component,
} from "@earendil-works/pi-tui";
import { buildLedger } from "../core/ledger.ts";
import {
  CURRENT_TABS,
  reduceCurrentTui,
  type CurrentTab,
  type CurrentTuiModel,
  type CurrentTuiState,
} from "./current.ts";

const WIDE_TABS_WIDTH = 87;

/** Availability copy shared by the inventory tabs; never an activity claim. */
const INVENTORY_NOT_INVOCATIONS =
  "Inventory != invocations; counts are availability, never activity.";

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
  let state: CurrentTuiState = { tab: initialTab, scope: model.scope };
  let ledger: ReturnType<typeof buildLedger> | undefined;
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
      } else if (matchesKey(data, "a")) {
        void reloadScope("active");
      } else if (matchesKey(data, "t")) {
        void reloadScope("tree");
      }
    },
    render(width): string[] {
      const lines = [
        theme.fg("accent", "Pi Session Inspector"),
        `Scope: ${state.scope === "active" ? "Active" : "Tree"}`,
        ...renderTabs(width, state.tab),
        "",
        ...renderContent(state.tab),
        "",
        theme.fg("dim", "←/→ tabs  a active  t tree  q quit"),
      ];

      return lines.map((line) => truncateToWidth(line, Math.max(0, width), ""));
    },
  };

  function renderContent(tab: CurrentTab): string[] {
    switch (tab) {
      case "overview":
        return [
          `Total tokens: ${currentModel.report.usage.totalTokens}`,
          `Cost: ${currentModel.report.usage.cost}`,
        ];
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
    if (items.length === 0) return ["Unavailable"];
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
    // The inventory is the tab's spine: without it the tab degrades wholesale
    // rather than fabricating rows from counted names alone.
    if (skills.state !== "supported") {
      return [evidenceLabel(skills.state), INVENTORY_NOT_INVOCATIONS];
    }
    if (skills.items.length === 0) {
      return ["No skills inventory", INVENTORY_NOT_INVOCATIONS];
    }
    const countsKnown = skills.invocationState === "supported";
    return [
      `Skills: ${skills.items.length}`,
      INVENTORY_NOT_INVOCATIONS,
      ...(countsKnown && skills.invocationCount !== null
        ? [`Invocations: ${skills.invocationCount}`]
        : []),
      ...(skills.otherInvocations === null || skills.otherInvocations === 0
        ? []
        : [`+ ${skills.otherInvocations} other invocations`]),
      ...skills.items.flatMap((skill) => [
        `Skill: ${skill.name}`,
        // An absent per-skill count is unknown evidence, never zero.
        `invocations: ${skill.explicitInvocations ?? "Unavailable"}`,
        `Source: ${skill.sourceLabel ?? "Unavailable"}`,
        `Scope: ${skill.scope ?? "Unavailable"}`,
      ]),
    ];
  }

  function renderAgents(): string[] {
    const lines = renderAgentActivity();
    const agents = currentModel.report.agents;
    if (agents.length === 0) {
      // Native activity alone keeps the tab non-empty; otherwise the tab states
      // that no rich run evidence exists at all.
      return lines.length === 0
        ? [evidenceLabel(currentModel.report.agentEvidence)]
        : lines;
    }
    return [
      ...lines,
      ...agents.flatMap((agent) => [
        `Agent: ${agent.id}`,
        `Parent: ${agent.parentId ?? "Unavailable"}`,
        ...(agent.agent === undefined ? [] : [`Label: ${agent.agent}`]),
        `Status: ${agent.status}`,
        ...(agent.artifacts === undefined
          ? []
          : [`Artifacts: ${agent.artifacts}`]),
        `Evidence: ${agent.confidence}`,
        ...(agent.usage === undefined
          ? []
          : [
              `Tokens: ${agent.usage.totalTokens}`,
              `Cost: ${agent.usage.cost}`,
              "Child usage is a breakdown only; never added to session totals.",
            ]),
      ]),
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

function presenceLabel(
  presence: "present" | "absent" | "unknown",
): string {
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

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

const WIDE_TABS_WIDTH = 80;

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
  theme,
  requestRender,
  done,
}: {
  model: CurrentTuiModel;
  theme: Pick<Theme, "fg">;
  requestRender: () => void;
  done: () => void;
}): CurrentTuiComponent {
  let state: CurrentTuiState = { tab: "overview", scope: model.scope };
  let ledger: ReturnType<typeof buildLedger> | undefined;

  function update(action: Parameters<typeof reduceCurrentTui>[1]): void {
    state = reduceCurrentTui(state, action);
    requestRender();
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
        update({ type: "set-scope", scope: "active" });
      } else if (matchesKey(data, "t")) {
        update({ type: "set-scope", scope: "tree" });
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
          `Total tokens: ${model.report.usage.totalTokens}`,
          `Cost: ${model.report.usage.cost}`,
        ];
      case "models":
        return [`Models: ${model.report.models.length}`];
      case "tools":
        return [`Tools: ${model.report.tools.length}`];
      case "ledger":
        ledger ??= buildLedger(model.report);
        return [`Ledger events: ${ledger.length}`];
      default:
        return ["Unavailable"];
    }
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

import type { Scope } from "../core/events.ts";
import type { SessionReport } from "../core/reports.ts";

export const CURRENT_TABS = [
  "overview",
  "models",
  "tools",
  "commands",
  "agents",
  "skills",
  "integrations",
  "errors",
  "ledger",
] as const;

export type CurrentTab = (typeof CURRENT_TABS)[number];

export type CurrentTuiState = {
  tab: CurrentTab;
  scope: Scope;
};

export type CurrentTuiAction =
  | { type: "next-tab" }
  | { type: "previous-tab" }
  | { type: "set-scope"; scope: Scope };

export type CurrentTuiModel = {
  report: SessionReport;
  scope: Scope;
  unavailable: "unavailable";
  ledger: undefined;
};

/** Creates bounded layout-independent content; ledger projection remains lazy. */
export function createCurrentTuiModel(
  report: SessionReport,
  scope: Scope,
): CurrentTuiModel {
  return { report, scope, unavailable: "unavailable", ledger: undefined };
}

export function reduceCurrentTui(
  state: CurrentTuiState,
  action: CurrentTuiAction,
): CurrentTuiState {
  switch (action.type) {
    case "next-tab":
      return { ...state, tab: moveTab(state.tab, 1) };
    case "previous-tab":
      return { ...state, tab: moveTab(state.tab, -1) };
    case "set-scope":
      return { ...state, scope: action.scope };
  }
}

function moveTab(tab: CurrentTab, offset: number): CurrentTab {
  const index = CURRENT_TABS.indexOf(tab);
  const nextIndex = Math.max(
    0,
    Math.min(CURRENT_TABS.length - 1, index + offset),
  );
  return CURRENT_TABS[nextIndex];
}

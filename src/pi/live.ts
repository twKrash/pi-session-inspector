const observerHooks = [
  "session_start",
  "session_shutdown",
  "agent_start",
  "agent_end",
  "turn_start",
  "turn_end",
  "tool_execution_start",
  "tool_execution_end",
  "session_compact",
  "session_tree",
  "model_select",
  "thinking_level_select",
] as const;

type ObserverHook = (typeof observerHooks)[number];
type ObserverHandler = () => Promise<void>;

export type LiveObserverEvent = {
  kind: ObserverHook;
};

/** A structural subset of Pi's public lifecycle observer API. */
export type LiveObserverApi = {
  on(event: "session_start", handler: ObserverHandler): void;
  on(event: "session_shutdown", handler: ObserverHandler): void;
  on(event: "agent_start", handler: ObserverHandler): void;
  on(event: "agent_end", handler: ObserverHandler): void;
  on(event: "turn_start", handler: ObserverHandler): void;
  on(event: "turn_end", handler: ObserverHandler): void;
  on(event: "tool_execution_start", handler: ObserverHandler): void;
  on(event: "tool_execution_end", handler: ObserverHandler): void;
  on(event: "session_compact", handler: ObserverHandler): void;
  on(event: "session_tree", handler: ObserverHandler): void;
  on(event: "model_select", handler: ObserverHandler): void;
  on(event: "thinking_level_select", handler: ObserverHandler): void;
};

export type LiveObserver = (event: LiveObserverEvent) => void | Promise<void>;

/** Registers only Pi lifecycle observer hooks and never exposes hook payloads. */
export function registerLiveObserver(
  api: LiveObserverApi,
  observe: LiveObserver,
): void {
  for (const kind of observerHooks) {
    const handler = (): Promise<void> => {
      try {
        void Promise.resolve(observe({ kind })).catch(() => {
          // Observer failures must not alter Pi execution.
        });
      } catch {
        // Observer failures must not alter Pi execution.
      }
      return Promise.resolve();
    };

    try {
      registerHook(api, kind, handler);
    } catch {
      // Registration is best-effort and must not alter Pi execution.
    }
  }
}

function registerHook(
  api: LiveObserverApi,
  kind: ObserverHook,
  handler: ObserverHandler,
): void {
  switch (kind) {
    case "session_start":
      api.on("session_start", handler);
      break;
    case "session_shutdown":
      api.on("session_shutdown", handler);
      break;
    case "agent_start":
      api.on("agent_start", handler);
      break;
    case "agent_end":
      api.on("agent_end", handler);
      break;
    case "turn_start":
      api.on("turn_start", handler);
      break;
    case "turn_end":
      api.on("turn_end", handler);
      break;
    case "tool_execution_start":
      api.on("tool_execution_start", handler);
      break;
    case "tool_execution_end":
      api.on("tool_execution_end", handler);
      break;
    case "session_compact":
      api.on("session_compact", handler);
      break;
    case "session_tree":
      api.on("session_tree", handler);
      break;
    case "model_select":
      api.on("model_select", handler);
      break;
    case "thinking_level_select":
      api.on("thinking_level_select", handler);
      break;
  }
}

export const PARENT = "/sessions/parent.jsonl";

export const header = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "session",
    version: 3,
    id: "child",
    timestamp: "2026-11-02T00:00:00.000Z",
    cwd: "sanitized",
    parentSession: PARENT,
    ...extra,
  });

export const usage = (totalTokens: number, cost: number) => ({
  input: totalTokens,
  output: 0,
  totalTokens,
  cost: { total: cost },
});

export const assistant = (
  id: string,
  parentId: string | null,
  options: {
    model?: unknown;
    usage?: unknown;
    toolCalls?: string[];
  } = {},
) =>
  JSON.stringify({
    type: "message",
    id,
    parentId,
    timestamp: "2026-11-02T00:00:01.000Z",
    message: {
      role: "assistant",
      provider: "fixture-provider",
      model: "model" in options ? options.model : "fixture-model",
      ...("usage" in options ? { usage: options.usage } : {}),
      content: (options.toolCalls ?? []).map((callId) => ({
        type: "toolCall",
        id: callId,
        name: "fixture_tool",
        arguments: {},
      })),
    },
  });

export const user = (id: string, parentId: string | null) =>
  JSON.stringify({
    type: "message",
    id,
    parentId,
    timestamp: "2026-11-02T00:00:00.500Z",
    message: { role: "user", content: [] },
  });

/** Native usage with only a total and a cost, no component breakdown. */
export const bareUsage = (totalTokens: number, cost: number) => ({
  totalTokens,
  cost: { total: cost },
});

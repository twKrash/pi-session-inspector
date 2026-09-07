import type {
  Compaction,
  Generation,
  ReducedSession,
  SessionEntry,
  Tool,
  Usage,
} from "./events.ts";

const zeroUsage: Usage = { totalTokens: 0, cost: 0 };

export function reduceEntries(
  sessionId: string,
  entries: readonly SessionEntry[],
): ReducedSession {
  const generations: Generation[] = [];
  const tools: Tool[] = [];
  const compactions: Compaction[] = [];
  const toolsByCallId = new Map<string, Tool>();
  let usage = { ...zeroUsage };

  for (const entry of entries) {
    if (entry.type === "message" && isRecord(entry.message)) {
      const message = entry.message;
      if (message.role === "assistant") {
        const generationUsage = readUsage(message.usage);
        const generation = {
          id: `generation:${entry.id}`,
          timestamp: entry.timestamp,
          provider: stringOr(message.provider, "unknown"),
          model: stringOr(message.model, "unknown"),
          usage: generationUsage,
        };
        generations.push(generation);
        usage = addUsage(usage, generationUsage);
        for (const call of toolCalls(message.content)) {
          const tool = {
            id: `tool:${call.id}`,
            timestamp: entry.timestamp,
            name: call.name,
            status: "interrupted" as const,
            usage: { ...zeroUsage },
          };
          tools.push(tool);
          toolsByCallId.set(call.id, tool);
        }
      } else if (message.role === "toolResult") {
        const tool = toolsByCallId.get(stringOr(message.toolCallId, ""));
        if (tool) {
          tool.status = message.isError === true ? "failed" : "succeeded";
          tool.usage = readUsage(message.usage);
          usage = addUsage(usage, tool.usage);
        }
      }
    }
    if (entry.type === "compaction") {
      const compactionUsage = readUsage(entry.usage);
      compactions.push({
        id: `compaction:${entry.id}`,
        timestamp: entry.timestamp,
        usage: compactionUsage,
      });
      usage = addUsage(usage, compactionUsage);
    }
  }

  return { sessionId, usage, generations, tools, compactions };
}

function addUsage(left: Usage, right: Usage): Usage {
  return {
    totalTokens: left.totalTokens + right.totalTokens,
    cost:
      Math.round((left.cost + right.cost) * 1_000_000_000_000) /
      1_000_000_000_000,
  };
}

function readUsage(value: unknown): Usage {
  if (!isRecord(value) || !isRecord(value.cost)) return { ...zeroUsage };
  return {
    totalTokens: finite(value.totalTokens),
    cost: finite(value.cost.total),
  };
}

function toolCalls(value: unknown): { id: string; name: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) =>
    isRecord(item) &&
    item.type === "toolCall" &&
    typeof item.id === "string" &&
    typeof item.name === "string"
      ? [{ id: item.id, name: item.name }]
      : [],
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

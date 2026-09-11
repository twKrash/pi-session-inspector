const SKILL_PREFIX = "/skill:";

/** Extracts only a bounded skill identity; the remainder is never retained. */
export function readSkillCommandName(text: string): string | undefined {
  if (!text.startsWith(SKILL_PREFIX)) return undefined;
  const rest = text.slice(SKILL_PREFIX.length);
  const end = rest.search(/\s/);
  const name = end === -1 ? rest : rest.slice(0, end);
  return /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/.test(name) ? name : undefined;
}

export type LiveCounterWriter = {
  appendTelemetry(envelope: unknown): void;
  flush(): Promise<void>;
};

export type LiveCounterApi = {
  events: { on(channel: string, handler: (data: unknown) => void): () => void };
  on(
    event: "input",
    handler: (event: { text: string }, ctx?: unknown) => void,
  ): void;
};

export function registerLiveCounters(
  api: LiveCounterApi,
  writer: LiveCounterWriter,
  options: { inventoryNames(): ReadonlySet<string>; now(): Date },
): void {
  const append = (envelope: unknown): void => {
    try {
      writer.appendTelemetry(envelope);
    } catch {
      // Producer failures are observer-only.
    }
  };
  const decision = (data: unknown): void => {
    try {
      const row = asRecord(data);
      const result = row?.result;
      if (result !== "allow" && result !== "deny") return;
      append({
        schemaVersion: 1,
        source: "permission-system",
        metric: "permission.decision",
        kind: "counter",
        value: 1,
        dimensions: { result, resolution: String(row?.resolution ?? "") },
        timestamp: options.now().getTime(),
      });
    } catch {}
  };
  const prompt = (data: unknown): void => {
    try {
      const source = asRecord(data)?.source;
      if (
        source !== "tool_call" &&
        source !== "skill_input" &&
        source !== "skill_read"
      )
        return;
      append({
        schemaVersion: 1,
        source: "permission-system",
        metric: "permission.prompt",
        kind: "counter",
        value: 1,
        dimensions: { promptSource: source },
        timestamp: options.now().getTime(),
      });
    } catch {}
  };
  const ready = (): void => {
    try {
      append({
        schemaVersion: 1,
        source: "permission-system",
        metric: "permission.ready",
        kind: "counter",
        value: 1,
        timestamp: options.now().getTime(),
      });
    } catch {}
  };
  try {
    api.events.on("permissions:ready", ready);
    api.events.on("permissions:ui_prompt", prompt);
    api.events.on("permissions:decision", decision);
  } catch {}
  try {
    api.on("input", (event) => {
      try {
        const name = readSkillCommandName(
          typeof event?.text === "string" ? event.text : "",
        );
        if (name === undefined || !options.inventoryNames().has(name)) return;
        append({
          schemaVersion: 1,
          source: "pi-input",
          metric: "skill.invocation",
          kind: "counter",
          value: 1,
          dimensions: { skill: name },
          timestamp: options.now().getTime(),
        });
      } catch {
        // Input observation must never affect Pi execution.
      }
    });
  } catch {}
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

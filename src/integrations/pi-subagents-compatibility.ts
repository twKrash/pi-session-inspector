import { isRecord } from "./adapters/shared.ts";

export type CapabilityStatus = "supported" | "unavailable" | "unsupported";

export type PiSubagentsCapabilityMatrix = {
  statusProjection: CapabilityStatus;
  asyncStatusSnapshot: CapabilityStatus;
  fleetStatus: CapabilityStatus;
  cost: CapabilityStatus;
  processTerminalProof: CapabilityStatus;
  childStatusEvent: CapabilityStatus;
};

export type PiSubagentsCompatibility = {
  protocol: "supported" | "unsupported";
  capabilities: PiSubagentsCapabilityMatrix;
};

const CHILD_STATUS_EVENT = "subagent:child-status";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) && !Array.isArray(value) ? value : undefined;
}

function unsupportedProtocol(): PiSubagentsCompatibility {
  return {
    protocol: "unsupported",
    capabilities: {
      statusProjection: "unsupported",
      asyncStatusSnapshot: "unsupported",
      fleetStatus: "unsupported",
      cost: "unsupported",
      processTerminalProof: "unsupported",
      childStatusEvent: "unsupported",
    },
  };
}

function capability(
  record: Record<string, unknown> | undefined,
  name: string,
  accepts: (value: Record<string, unknown>) => boolean,
): CapabilityStatus {
  if (record === undefined || !Object.hasOwn(record, name)) {
    return "unavailable";
  }
  const value = asRecord(record[name]);
  return value !== undefined && accepts(value) ? "supported" : "unsupported";
}

function eventCapability(
  record: Record<string, unknown> | undefined,
  name: string,
  expected: string,
): CapabilityStatus {
  if (record === undefined || !Object.hasOwn(record, name)) {
    return "unavailable";
  }
  return record[name] === expected ? "supported" : "unsupported";
}

function validatePing(value: unknown): PiSubagentsCompatibility {
  const ping = asRecord(value);
  if (ping?.version !== 1) return unsupportedProtocol();

  const advertised = asRecord(ping.capabilities);
  const events = asRecord(ping.events);
  return {
    protocol: "supported",
    capabilities: {
      statusProjection: capability(
        advertised,
        "statusProjection",
        (value) =>
          value.version === 1 &&
          value.untargeted === "in-memory-when-ready" &&
          value.targeted === "executor",
      ),
      asyncStatusSnapshot: capability(
        advertised,
        "asyncStatusSnapshot",
        (value) =>
          value.kind === "pi-subagents.async-status-snapshot" &&
          value.version === 1,
      ),
      fleetStatus: capability(
        advertised,
        "fleetStatus",
        (value) => value.version === 1,
      ),
      cost: capability(advertised, "cost", (value) => value.version === 1),
      processTerminalProof: capability(
        advertised,
        "processTerminalProof",
        (value) => value.version === 1 && value.lifecycleArtifactVersion === 3,
      ),
      childStatusEvent: eventCapability(
        events,
        "childStatus",
        CHILD_STATUS_EVENT,
      ),
    },
  };
}

/** Validate only the pinned ping contract; never retain producer fields. */
export function validatePiSubagentsPing(
  value: unknown,
): PiSubagentsCompatibility {
  try {
    return validatePing(value);
  } catch {
    return unsupportedProtocol();
  }
}

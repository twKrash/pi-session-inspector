import { defineIntegration } from "../catalog.ts";
import type {
  IntegrationEvidence,
  IntegrationRegistration,
  IntegrationTelemetryFold,
  LiveIntegrationContext,
} from "../contract.ts";
import { isRecord } from "./shared.ts";

/**
 * The `pi-mcp-adapter` semantic protocol.
 *
 * Two producer contracts are consumed, both owned by the adapter and both
 * versioned:
 *
 * - `mcp-approval-v1` session entries: one persisted record per approval
 *   decision. The record carries a server name, a tool name, and two SHA-256
 *   hashes, so this adapter validates the declared shape exactly and keeps
 *   only the decision class. Names and hashes never leave the reader.
 * - the `pi-mcp-adapter/status/v1` event: a sanitized runtime snapshot. It is
 *   a current-state reading, not an activity stream, so it is a presence
 *   sighting and never a counter.
 */
const STATUS_CHANNEL = "pi-mcp-adapter/status/v1";
const STATUS_SNAPSHOT_VERSION = 1;
const APPROVAL_CUSTOM_TYPE = "mcp-approval-v1";
const SCHEMA_VERSION = 1;

/** The adapter's tool vocabulary; its proxy tools are `mcp__<server>`. */
const GATEWAY_TOOL = "mcp";
const SCRIPT_TOOL = "mcpScript";
const PROXY_PREFIX = "mcp__";

/** The event-bus subscription surface this integration needs. */
type McpBusApi = {
  events?: {
    on?(
      channel: string,
      handler: (data: unknown) => void,
    ): (() => void) | undefined;
  };
};

const TOOL_APPROVAL_KEYS = [
  "version",
  "kind",
  "decision",
  "serverName",
  "originalToolName",
  "definitionHash",
  "argsHash",
] as const;
const IFRAME_APPROVAL_KEYS = [
  "version",
  "kind",
  "decision",
  "serverName",
] as const;
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** One approval record class, with every producer string already discarded. */
type ApprovalClass = "toolApprovals" | "iframeApprovals" | "iframeDenials";

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX.test(value);
}

/**
 * Classifies one `mcp-approval-v1` record, or returns `undefined` when it is
 * not the declared shape. The server name, tool name, and hashes are validated
 * in place and never returned, so no producer string can be retained.
 */
function readApprovalClass(data: unknown): ApprovalClass | undefined {
  if (!isRecord(data) || data.version !== 1) return undefined;

  if (data.kind === "tool") {
    if (
      hasExactKeys(data, TOOL_APPROVAL_KEYS) &&
      data.decision === "allow_for_session" &&
      isNonEmptyString(data.serverName) &&
      isNonEmptyString(data.originalToolName) &&
      isSha256(data.definitionHash) &&
      isSha256(data.argsHash)
    ) {
      return "toolApprovals";
    }
    return undefined;
  }

  if (data.kind === "iframe") {
    if (
      !hasExactKeys(data, IFRAME_APPROVAL_KEYS) ||
      !isNonEmptyString(data.serverName)
    ) {
      return undefined;
    }
    if (data.decision === "allow") return "iframeApprovals";
    if (data.decision === "deny") return "iframeDenials";
  }

  return undefined;
}

/** True for the adapter's tool surface: the gateway, the script tool, proxies. */
function isMcpTool(name: string): boolean {
  return (
    name === GATEWAY_TOOL ||
    name === SCRIPT_TOOL ||
    name.startsWith(PROXY_PREFIX)
  );
}

export const mcpIntegration = defineIntegration({
  key: "mcp",
  schemas: {
    1: {
      counters: ["toolApprovals", "iframeApprovals", "iframeDenials"],
    },
  },
  hooks: {
    presence: ({ tools }) => (tools.some(isMcpTool) ? "present" : "absent"),
    persisted: ({ entries }) => {
      const counters: Record<ApprovalClass, number> = {
        toolApprovals: 0,
        iframeApprovals: 0,
        iframeDenials: 0,
      };
      let malformed = 0;

      for (const entry of entries) {
        if (
          entry.type !== "custom" ||
          entry.customType !== APPROVAL_CUSTOM_TYPE
        ) {
          continue;
        }
        const evidenceClass = readApprovalClass(entry.data);
        if (evidenceClass === undefined) {
          malformed += 1;
          continue;
        }
        counters[evidenceClass] += 1;
      }

      const approvals =
        counters.toolApprovals +
        counters.iframeApprovals +
        counters.iframeDenials;
      if (approvals === 0) {
        if (malformed === 0) return undefined;
        // Evidence of this integration exists but is not the declared shape.
        return {
          integration: "mcp",
          state: "unsupported",
          version: SCHEMA_VERSION,
          reason: "malformed-evidence",
        } satisfies IntegrationEvidence;
      }
      return {
        integration: "mcp",
        state: "supported",
        version: SCHEMA_VERSION,
        counters,
        reason: "evidence-supported",
      } satisfies IntegrationEvidence;
    },
    live: (context: LiveIntegrationContext) => {
      const api = context.api as McpBusApi;
      const disposers: Array<() => void> = [];

      const dispose = api.events?.on?.(STATUS_CHANNEL, (data) => {
        try {
          // Version and shape only: the snapshot's servers and counts are
          // producer detail this integration deliberately does not retain.
          if (
            !isRecord(data) ||
            data.version !== STATUS_SNAPSHOT_VERSION ||
            !Array.isArray(data.servers)
          ) {
            return;
          }
          context.markPresence("mcp");
          context.appendTelemetry({
            schemaVersion: SCHEMA_VERSION,
            source: "pi-mcp-adapter",
            metric: "mcp.status",
            kind: "counter",
            value: 1,
            timestamp: context.now().getTime(),
          });
        } catch {
          // Observation must never affect Pi execution.
        }
      });
      if (typeof dispose === "function") {
        disposers.push(dispose as () => void);
      }

      const registration: IntegrationRegistration = {
        dispose() {
          for (const dispose of disposers.splice(0)) {
            try {
              dispose();
            } catch {
              // Disposal failures are observer-only.
            }
          }
        },
      };
      return registration;
    },
    telemetry: (envelope: unknown): IntegrationTelemetryFold | undefined => {
      if (!isRecord(envelope)) return undefined;
      if (envelope.kind !== "counter" || envelope.value !== 1) return undefined;
      if (envelope.metric !== "mcp.status") return undefined;
      // A status snapshot is durable evidence that the adapter is running,
      // never an activity count.
      return { presence: true };
    },
  },
});

import { canonicalOpaqueDigest } from "../../core/opaque-id.ts";
import { defineIntegration } from "../catalog.ts";
import type {
  IntegrationRegistration,
  IntegrationTelemetryFold,
  LiveIntegrationContext,
} from "../contract.ts";
import { isRecord } from "./shared.ts";

const SCHEMA_VERSION = 1;
/** Byte bound shared with `canonicalOpaqueDigest` for raw opaque identities. */
const MAX_REQUEST_ID_BYTES = 512;
const encoder = new TextEncoder();

/**
 * Permission resolution classes are a closed vocabulary. Any producer value
 * outside this set is retained only as the bounded placeholder "other"; raw
 * producer text never reaches the WAL.
 */
const PERMISSION_RESOLUTIONS: ReadonlySet<string> = new Set([
  "policy_allow",
  "policy_deny",
  "session_approved",
  "infrastructure_auto_allowed",
  "user_approved",
  "user_approved_for_session",
  "user_denied",
  "auto_approved",
  "confirmation_unavailable",
  "authorizer_allowed",
  "authorizer_denied",
  "gate_error",
]);

/** The permission bus subscription surface this integration needs. */
type PermissionBusApi = {
  events?: {
    on?(
      channel: string,
      handler: (data: unknown) => void,
    ): (() => void) | undefined;
  };
};

function readResolution(value: unknown): string {
  return typeof value === "string" && PERMISSION_RESOLUTIONS.has(value)
    ? value
    : "other";
}

/**
 * Session-scoped, domain-separated hash of a validated permission request ID.
 * Returns `undefined` for an absent, non-string, empty, control-character, or
 * oversized `requestId`; a malformed ID yields no attribution rather than a
 * hash of a fallback. The raw producer ID never leaves this function.
 */
function readRequestAttribution(
  payload: unknown,
  sessionId: string,
): { request: string } | undefined {
  try {
    const requestId = isRecord(payload) ? payload.requestId : undefined;
    if (typeof requestId !== "string" || requestId.length === 0) {
      return undefined;
    }
    if (encoder.encode(requestId).byteLength > MAX_REQUEST_ID_BYTES) {
      return undefined;
    }
    const digest = canonicalOpaqueDigest(
      "permission-request",
      sessionId,
      requestId,
    );
    return { request: `permission-request-${digest}` };
  } catch {
    return undefined;
  }
}

/**
 * Permission evidence has two sources that share one v1 counter contract: the
 * public permission bus (persisted as bounded WAL envelopes and folded by the
 * telemetry subsystem) and the durable `permissions:ready` presence sighting,
 * which the presence subsystem records as a generic observation rather than an
 * integration verdict. Presence is a live or durable bus sighting; it is never
 * inferred from the absence of a bus, so this integration declares no presence
 * hook.
 */
export const permissionIntegration = defineIntegration({
  key: "permission",
  schemas: {
    1: {
      counters: [
        "decisions",
        "allowed",
        "denied",
        "prompts",
        "promptToolCall",
        "promptSkillInput",
        "promptSkillRead",
        "gateErrors",
      ],
    },
  },
  hooks: {
    live: (context: LiveIntegrationContext) => {
      const api = context.api as PermissionBusApi;
      const disposers: Array<() => void> = [];
      const subscribe = (channel: string, handler: (data: unknown) => void) => {
        try {
          const dispose = api.events?.on?.(channel, handler);
          if (typeof dispose === "function") {
            disposers.push(dispose as () => void);
          }
        } catch {
          // Subscription failures are observer-only.
        }
      };

      const append = (envelope: Record<string, unknown>): void => {
        try {
          context.appendTelemetry(envelope);
        } catch {
          // Producer failures are observer-only.
        }
      };

      subscribe("permissions:ready", () => {
        try {
          context.markPresence("permission");
          append({
            schemaVersion: SCHEMA_VERSION,
            source: "permission-system",
            metric: "permission.ready",
            kind: "counter",
            value: 1,
            timestamp: context.now().getTime(),
          });
        } catch {
          // Observation must never affect Pi execution.
        }
      });
      subscribe("permissions:ui_prompt", (data) => {
        try {
          const source = isRecord(data) ? data.source : undefined;
          if (
            source !== "tool_call" &&
            source !== "skill_input" &&
            source !== "skill_read"
          ) {
            return;
          }
          const attribution = readRequestAttribution(data, context.sessionId);
          append({
            schemaVersion: SCHEMA_VERSION,
            source: "permission-system",
            metric: "permission.prompt",
            kind: "counter",
            value: 1,
            dimensions: { promptSource: source },
            ...(attribution === undefined ? {} : { attribution }),
            timestamp: context.now().getTime(),
          });
        } catch {
          // Observation must never affect Pi execution.
        }
      });
      subscribe("permissions:decision", (data) => {
        try {
          const result = isRecord(data) ? data.result : undefined;
          if (result !== "allow" && result !== "deny") return;
          const attribution = readRequestAttribution(data, context.sessionId);
          append({
            schemaVersion: SCHEMA_VERSION,
            source: "permission-system",
            metric: "permission.decision",
            kind: "counter",
            value: 1,
            dimensions: {
              result,
              resolution: readResolution(
                isRecord(data) ? data.resolution : undefined,
              ),
            },
            ...(attribution === undefined ? {} : { attribution }),
            timestamp: context.now().getTime(),
          });
        } catch {
          // Observation must never affect Pi execution.
        }
      });

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
      const dimensions = isRecord(envelope.dimensions)
        ? envelope.dimensions
        : undefined;

      if (envelope.metric === "permission.decision") {
        const result = dimensions?.result;
        const resolution = dimensions?.resolution;
        if (result !== "allow" && result !== "deny") return undefined;
        if (typeof resolution !== "string") return undefined;
        return {
          counters: {
            decisions: 1,
            [result === "allow" ? "allowed" : "denied"]: 1,
            ...(resolution === "gate_error" ? { gateErrors: 1 } : {}),
          },
        };
      }
      if (envelope.metric === "permission.prompt") {
        const source = dimensions?.promptSource;
        if (
          source !== "tool_call" &&
          source !== "skill_input" &&
          source !== "skill_read"
        ) {
          return undefined;
        }
        const counter =
          source === "tool_call"
            ? "promptToolCall"
            : source === "skill_input"
              ? "promptSkillInput"
              : "promptSkillRead";
        return { counters: { prompts: 1, [counter]: 1 } };
      }
      if (envelope.metric === "permission.ready") {
        // Presence only: durable boolean, never an activity counter.
        return { presence: true };
      }
      return undefined;
    },
  },
});

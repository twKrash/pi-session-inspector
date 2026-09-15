import { debugLog } from "../debug/log.ts";
import { reportIntegrations } from "./catalog.ts";
import type { Integration, PresenceContext } from "./contract.ts";
import { integrations } from "./index.ts";

/** Why a presence row carries the value it does (debug/diagnostic only). */
export type IntegrationPresenceReason =
  | "inventory-signal"
  | "live-signal"
  | "not-observed"
  | "presence-failed";

export type IntegrationPresenceResult = {
  presence: Record<string, IntegrationPresenceVerdict>;
  reasons: Record<string, IntegrationPresenceReason>;
};

type IntegrationPresenceVerdict = "present" | "absent" | "unknown";

/**
 * The presence subsystem: it iterates the declared integrations and asks each
 * one for its own inventory signal.
 *
 * - a live or durably folded observation is generic state and wins: it is an
 *   observation, not an inventory inference;
 * - `absent` needs a readable inventory, otherwise the signal is merely
 *   unobserved and the row stays `unknown`;
 * - one failing integration degrades only its own row.
 */
export function readPresence(
  context: PresenceContext,
  list: readonly Integration[] = integrations,
): IntegrationPresenceResult {
  const observed = new Set(context.observed);
  const presence: Record<string, IntegrationPresenceVerdict> = {};
  const reasons: Record<string, IntegrationPresenceReason> = {};

  for (const integration of reportIntegrations(list)) {
    const key = integration.key;
    if (observed.has(key)) {
      presence[key] = "present";
      reasons[key] = "live-signal";
      continue;
    }
    const hook = integration.hooks?.presence;
    if (hook === undefined) {
      presence[key] = "unknown";
      reasons[key] = "not-observed";
      continue;
    }
    try {
      const signal = hook(context);
      presence[key] =
        signal === "absent" && !context.inventoryAvailable ? "unknown" : signal;
      reasons[key] = "inventory-signal";
    } catch {
      presence[key] = "unknown";
      reasons[key] = "presence-failed";
    }
  }

  for (const key of Object.keys(presence)) {
    debugLog("integration", "presence-evaluated", {
      integration: key,
      presence: presence[key],
      reason: reasons[key],
    });
  }

  return { presence, reasons };
}

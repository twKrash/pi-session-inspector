import type { IntegrationObservationInput } from "../core/events.ts";
import {
  integrationCounters,
  isAllowedIntegrationCounter,
  isKnownIntegrationVersion,
  reportIntegrations,
} from "./catalog.ts";
import type { IntegrationRowKey } from "../core/events.ts";
import type {
  Integration,
  IntegrationEvidence,
  IntegrationEvidenceReason,
  PersistedEvidenceContext,
} from "./contract.ts";
import { debugLog } from "../debug/log.ts";
import { integrations } from "./index.ts";

export type IntegrationPersistedResult = {
  rows: IntegrationObservationInput[];
  reasons: Record<string, IntegrationEvidenceReason>;
};

/**
 * The persisted-evidence subsystem: it iterates the declared integrations and
 * asks each one that has a `persisted` hook for its own evidence, then
 * re-validates the result against that integration's declared schema.
 *
 * A result that names another integration, a declared-version violation, or a
 * counter outside the declared allowlist never reaches a report: the row is
 * reported `unsupported` (with a bounded reason) or dropped, and one failing
 * integration never blocks another.
 */
export function readPersistedEvidence(
  context: PersistedEvidenceContext,
  list: readonly Integration[] = integrations,
): IntegrationPersistedResult {
  const rows: IntegrationObservationInput[] = [];
  const reasons: Record<string, IntegrationEvidenceReason> = {};

  for (const integration of reportIntegrations(list)) {
    const key = integration.key;
    const hook = integration.hooks?.persisted;
    if (hook === undefined) continue;

    let result: IntegrationEvidence | undefined;
    try {
      result = hook(context);
    } catch {
      reasons[key] = "evidence-failed";
      continue;
    }
    if (result === undefined) {
      // No persisted evidence is a reason, not a silence: the diagnostic
      // surface must be able to tell "no evidence" from "not read".
      reasons[key] = "no-persisted-evidence";
      debugLog("integration", "persisted-evidence", {
        integration: key,
        reason: "no-persisted-evidence",
      });
      continue;
    }
    const row = toObservationRow(list, key, result, reasons);
    if (row === undefined) {
      debugLog("integration", "evidence-rejected", {
        integration: key,
        reason: reasons[key] ?? "malformed-evidence",
      });
      continue;
    }
    debugLog("integration", "persisted-evidence", {
      integration: key,
      status: row.state,
      reason: reasons[key] ?? "evidence-supported",
      ...(row.version === undefined ? {} : { version: row.version }),
    });
    rows.push(row);
  }

  return { rows, reasons };
}

/** Converts one integration result into a publishable row, or reports it. */
function toObservationRow(
  list: readonly Integration[],
  key: string,
  result: IntegrationEvidence,
  reasons: Record<string, IntegrationEvidenceReason>,
): IntegrationObservationInput | undefined {
  if (result.integration !== key) {
    reasons[key] = "malformed-evidence";
    return undefined;
  }
  const version = result.version;
  if (version !== undefined && !isVersion(version)) {
    reasons[key] = "malformed-evidence";
    return undefined;
  }
  // `key` is a declared catalog key at the call site, so it is a valid row key.
  const rowKey = key as IntegrationRowKey;
  if (result.state === "supported") {
    // A supported result must name a declared version and counters inside that
    // version's allowlist. A violation is reported as `unsupported` (never a
    // silently trimmed counter set).
    if (
      version === undefined ||
      !isKnownIntegrationVersion(list, key, version) ||
      !hasAllowedCounters(list, key, version, result.counters)
    ) {
      reasons[key] = "unsupported-schema";
      return {
        integration: rowKey,
        ...(version === undefined ? {} : { version }),
        state: "unsupported",
      };
    }
    reasons[key] = result.reason;
    const counters = { ...(result.counters ?? {}) };
    return {
      integration: rowKey,
      version,
      state: "supported",
      // An empty counter map is omitted rather than published as `{}`: a row
      // whose schema declares no counters carries no counter column at all.
      ...(Object.keys(counters).length === 0 ? {} : { counters }),
    };
  }
  if (result.state === "unsupported") {
    // An unsupported row may name the version the producer claimed, which can
    // be a version this integration does not declare: that is the report.
    reasons[key] = result.reason;
    return {
      integration: rowKey,
      ...(version === undefined ? {} : { version }),
      state: "unsupported",
    };
  }
  reasons[key] = result.reason;
  return {
    integration: rowKey,
    ...(version === undefined ? {} : { version }),
    state: "unavailable",
  };
}

function hasAllowedCounters(
  list: readonly Integration[],
  key: string,
  version: number,
  counters: Readonly<Record<string, number | boolean>> | undefined,
): boolean {
  const declared = integrationCounters(list, key, version);
  if (declared === undefined) return false;
  const provided = counters === undefined ? {} : counters;
  const names = Object.keys(provided);
  // A schema that declares no counters (subagents: its rich evidence is the
  // runs/activity contribution, never a counter row) accepts exactly an empty
  // counter map. Any other count must be declared and bounded.
  if (names.length === 0) return declared.length === 0;
  return names.every(
    (name) =>
      isAllowedIntegrationCounter(list, key, version, name) &&
      isCounterValue(provided[name]),
  );
}

function isCounterValue(value: unknown): value is number | boolean {
  return (
    typeof value === "boolean" ||
    (typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0 &&
      value <= Number.MAX_SAFE_INTEGER)
  );
}

function isVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

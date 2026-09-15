import { debugLog } from "../debug/log.ts";
import { integrations } from "./index.ts";
import type {
  CanonicalIntegrationContext,
  CanonicalIntegrationContribution,
  Integration,
  IntegrationEvidenceReason,
} from "./contract.ts";

export type IntegrationContributionResult = {
  contributions: Record<string, CanonicalIntegrationContribution>;
  reasons: Record<string, IntegrationEvidenceReason>;
};

/**
 * The rich canonical contribution subsystem: it iterates the declared
 * integrations and invokes the `canonical` hook where an integration has one
 * (subagent runs and native activity today). Contributions are keyed by the
 * integration that produced them and one failing integration degrades only
 * itself.
 */
export async function readCanonicalContributions(
  context: CanonicalIntegrationContext,
  list: readonly Integration[] = integrations,
): Promise<IntegrationContributionResult> {
  const contributions: Record<string, CanonicalIntegrationContribution> = {};
  const reasons: Record<string, IntegrationEvidenceReason> = {};

  for (const integration of list) {
    if (integration.legacyOnly === true) continue;
    const hook = integration.hooks?.canonical;
    if (hook === undefined) continue;
    try {
      const contribution = await hook(context);
      if (contribution !== undefined) {
        contributions[integration.key] = contribution;
      }
    } catch {
      reasons[integration.key] = "contribution-failed";
      debugLog("integration", "evidence-rejected", {
        integration: integration.key,
        reason: "contribution-failed",
      });
    }
  }

  return { contributions, reasons };
}

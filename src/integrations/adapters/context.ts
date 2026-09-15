import { defineIntegration } from "../catalog.ts";
import type { IntegrationEvidence } from "../contract.ts";
import { schemaVersion, toolCallNames } from "./shared.ts";

const SUPPORTED_SCHEMA_VERSION = 1;
const CTX_PREFIX = "ctx_";

/** The two observation paths that can report one Context Mode invocation. */
type ContextEvidencePath = "custom" | "tool";

/**
 * Context Mode evidence is native `ctx_*` tool use and versioned `ctx_*` custom
 * entries. One invocation can be observed through both paths, so the two are
 * folded with a maximum rather than a sum: a single-path observation keeps its
 * exact count and a double-observed invocation is never counted twice.
 */
export const contextIntegration = defineIntegration({
  key: "context",
  aliases: ["ctx"],
  schemas: { 1: { counters: ["calls"] } },
  hooks: {
    presence: ({ tools }) =>
      tools.some((tool) => tool.startsWith(CTX_PREFIX)) ? "present" : "absent",
    persisted: ({ entries }) => {
      const calls = new Map<ContextEvidencePath, number>();
      let version: number | undefined;
      let conflicted = false;

      const record = (path: ContextEvidencePath, callsCount: number): void => {
        if (conflicted) return;
        calls.set(path, (calls.get(path) ?? 0) + callsCount);
      };

      for (const entry of entries) {
        if (entry.type === "custom" && typeof entry.customType === "string") {
          if (!entry.customType.startsWith(CTX_PREFIX)) continue;
          const observedVersion = schemaVersion(entry.data);
          if (observedVersion === undefined) continue;
          if (version === undefined) {
            version = observedVersion;
          } else if (version !== observedVersion) {
            version = observedVersion;
            conflicted = true;
            continue;
          }
          record("custom", 1);
          continue;
        }
        const names = toolCallNames(entry);
        if (names === undefined) continue;
        const observed = names.filter((name) =>
          name.startsWith(CTX_PREFIX),
        ).length;
        if (observed === 0) continue;
        version ??= SUPPORTED_SCHEMA_VERSION;
        record("tool", observed);
      }

      if (version === undefined) return undefined;
      if (conflicted) return unsupported(version);
      const peak = Math.max(...calls.values());
      return {
        integration: "context",
        state: "supported",
        version,
        counters: { calls: peak },
        reason: "evidence-supported",
      } satisfies IntegrationEvidence;
    },
  },
});

function unsupported(version: number): IntegrationEvidence {
  return {
    integration: "context",
    state: "unsupported",
    version,
    reason: "unsupported-schema",
  };
}

import type { IntegrationEvidence } from "../contract.ts";
import { type AdapterCounters, mergeCounters } from "./shared.ts";

/**
 * One accumulator for a persisted read that folds per-entry observations into a
 * single bounded result: the observed schema version, a conflict flag, and the
 * merged counters.
 */
export type PersistedAccumulator = {
  readonly add: (version: number, counters: AdapterCounters) => void;
  readonly result: () => IntegrationEvidence | undefined;
  readonly version: () => number | undefined;
  readonly conflict: () => boolean;
};

/**
 * A version conflict is not a merge: two producers claiming the same
 * integration with different schema versions are reported as `unsupported`
 * rather than summed under one version.
 */
export function createAccumulator(key: string): PersistedAccumulator {
  let version: number | undefined;
  let conflicted = false;
  let counters: AdapterCounters | undefined;

  return {
    add(nextVersion, next) {
      if (conflicted) return;
      if (version === undefined) {
        version = nextVersion;
      } else if (version !== nextVersion) {
        version = nextVersion;
        conflicted = true;
        return;
      }
      const merged = mergeCounters(counters, next);
      if (merged === undefined) {
        conflicted = true;
        return;
      }
      counters = merged;
    },
    result() {
      if (version === undefined) return undefined;
      if (conflicted) {
        return {
          integration: key,
          state: "unsupported",
          version,
          reason: "unsupported-schema",
        };
      }
      if (counters === undefined) return undefined;
      return {
        integration: key,
        state: "supported",
        version,
        counters,
        reason: "evidence-supported",
      };
    },
    version: () => version,
    conflict: () => conflicted,
  };
}

/** One `unsupported` result naming the version the producer claimed. */
export function unsupportedEvidence(
  key: string,
  version?: number,
): IntegrationEvidence {
  return {
    integration: key,
    state: "unsupported",
    ...(version === undefined ? {} : { version }),
    reason: "unsupported-schema",
  };
}

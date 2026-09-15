import { defineIntegration } from "../catalog.ts";
import type { IntegrationEvidence } from "../contract.ts";
import { createAccumulator, unsupportedEvidence } from "./accumulator.ts";
import {
  type AdapterCounters,
  booleanField,
  hasSchemaVersion,
  isRecord,
  nonNegativeNumber,
  schemaVersion,
} from "./shared.ts";

const SUPPORTED_SCHEMA_VERSION = 1;
const RTK_COUNTERS = [
  "compactions",
  "sourceChars",
  "compactedChars",
  "sourceLines",
  "compactedLines",
] as const;

/**
 * RTK evidence is the native and persisted `details.rtkCompaction` shape on
 * message entries. Both shapes collapse to the same v1 counter contract, so a
 * producer that changes shape is reported as `unsupported` rather than guessed.
 */
export const rtkIntegration = defineIntegration({
  key: "rtk",
  schemas: {
    1: {
      counters: [...RTK_COUNTERS, "truncated"],
    },
  },
  hooks: {
    persisted: ({ entries }) => {
      const accumulator = createAccumulator("rtk");
      let rejected: IntegrationEvidence | undefined;

      for (const entry of entries) {
        if (entry.type !== "message" || !isRecord(entry.message)) continue;
        const details = entry.message.details;
        if (!isRecord(details) || !isRecord(details.rtkCompaction)) continue;
        const compaction = details.rtkCompaction;

        if (hasSchemaVersion(compaction)) {
          const version = schemaVersion(compaction);
          if (version === undefined) {
            rejected ??= unsupportedEvidence("rtk");
            continue;
          }
          const counters = readPersistedCounters(compaction);
          if (counters === undefined) {
            rejected ??= unsupportedEvidence("rtk", version);
            continue;
          }
          accumulator.add(version, counters);
          continue;
        }

        const counters = readNativeCounters(compaction);
        if (counters === undefined) {
          rejected ??= unsupportedEvidence("rtk", SUPPORTED_SCHEMA_VERSION);
          continue;
        }
        accumulator.add(SUPPORTED_SCHEMA_VERSION, counters);
      }

      return accumulator.result() ?? rejected;
    },
  },
});

/** The persisted RTK shape: every field is required, never defaulted. */
function readPersistedCounters(
  value: Record<string, unknown>,
): AdapterCounters | undefined {
  const sourceChars = nonNegativeNumber(value.sourceChars);
  const compactedChars = nonNegativeNumber(value.compactedChars);
  const sourceLines = nonNegativeNumber(value.sourceLines);
  const compactedLines = nonNegativeNumber(value.compactedLines);
  const truncated = booleanField(value, "truncated");
  if (
    sourceChars === undefined ||
    compactedChars === undefined ||
    sourceLines === undefined ||
    compactedLines === undefined ||
    truncated === undefined
  ) {
    return undefined;
  }
  return {
    compactions: 1,
    sourceChars,
    compactedChars,
    sourceLines,
    compactedLines,
    truncated,
  };
}

/** The native RTK shape: an unapplied compaction carries no counters. */
function readNativeCounters(
  value: Record<string, unknown>,
): AdapterCounters | undefined {
  if (value.applied !== true) return undefined;
  const sourceChars = nonNegativeNumber(value.originalCharCount);
  const compactedChars = nonNegativeNumber(value.compactedCharCount);
  const sourceLines = nonNegativeNumber(value.originalLineCount);
  const compactedLines = nonNegativeNumber(value.compactedLineCount);
  const truncated = booleanField(value, "truncated");
  if (
    sourceChars === undefined ||
    compactedChars === undefined ||
    sourceLines === undefined ||
    compactedLines === undefined ||
    truncated === undefined
  ) {
    return undefined;
  }
  return {
    compactions: 1,
    sourceChars,
    compactedChars,
    sourceLines,
    compactedLines,
    truncated,
  };
}

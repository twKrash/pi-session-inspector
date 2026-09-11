import type { IntegrationKey } from "./events.ts";

/**
 * Counter names emitted by each supported integration adapter schema. Report
 * projection uses this same versioned contract rather than accepting producer
 * supplied names that merely resemble safe identifiers.
 */
const COUNTER_KEYS: Readonly<
  Record<
    IntegrationKey | "mode",
    Readonly<Record<number, ReadonlySet<string>>>
  >
> = {
  context: { 1: new Set(["calls"]) },
  rtk: {
    1: new Set([
      "compactions",
      "sourceChars",
      "compactedChars",
      "sourceLines",
      "compactedLines",
      "truncated",
    ]),
  },
  ponytail: { 1: new Set(["changes"]) },
  caveman: { 1: new Set(["changes"]) },
  mode: { 1: new Set(["changes"]) },
  permission: { 1: new Set(["events", "granted"]) },
  subagents: { 1: new Set() },
  lens: { 1: new Set(["calls"]) },
};

export function isKnownIntegrationVersion(
  integration: IntegrationKey | "mode",
  version: number,
): boolean {
  return COUNTER_KEYS[integration][version] !== undefined;
}

export function isAllowedIntegrationCounter(
  integration: IntegrationKey | "mode",
  version: number,
  key: string,
): boolean {
  return COUNTER_KEYS[integration][version]?.has(key) ?? false;
}

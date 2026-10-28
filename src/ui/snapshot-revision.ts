import { createHash } from "node:crypto";
import type { InspectorUiSnapshot } from "./ui-projection.ts";

export type UiSnapshotChanges = Partial<
  Pick<
    InspectorUiSnapshot,
    "current" | "history" | "global" | "initialScope" | "theme"
  >
>;

export function serializeUiSnapshot(snapshot: InspectorUiSnapshot): {
  body: string;
  etag: string;
} {
  const body = JSON.stringify(snapshot);
  return {
    body,
    etag: `"${createHash("sha256").update(body, "utf8").digest("base64url")}"`,
  };
}

export function diffUiSnapshot(
  previous: InspectorUiSnapshot,
  next: InspectorUiSnapshot,
): UiSnapshotChanges | undefined {
  const changes: UiSnapshotChanges = {};
  for (const key of [
    "current",
    "history",
    "global",
    "initialScope",
    "projectName",
    "theme",
  ] as const) {
    if (JSON.stringify(previous[key]) !== JSON.stringify(next[key])) {
      (changes as Record<string, unknown>)[key] = next[key];
    }
  }
  return Object.keys(changes).length === 0 ? undefined : changes;
}

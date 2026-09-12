import { createHash } from "node:crypto";

export const OPAQUE_ID_DOMAINS = [
  "live-tool",
  "permission-request",
  "subagent-run",
] as const;

export type OpaqueIdentityDomain = (typeof OPAQUE_ID_DOMAINS)[number];

const MAX_RAW_BYTES = 512;
const DOMAIN: ReadonlySet<string> = new Set(OPAQUE_ID_DOMAINS);
const encoder = new TextEncoder();
const NUL = new Uint8Array([0]);

/**
 * One binding, domain-separated, session-scoped opaque identity. Hook adapters,
 * WAL recovery, and L1 reconcilers must all call this helper so byte-identical
 * inputs yield byte-identical IDs. Raw producer IDs never persist.
 */
export function canonicalOpaqueDigest(
  domain: OpaqueIdentityDomain,
  sessionId: string,
  rawId: string,
): string {
  if (!DOMAIN.has(domain)) throw new TypeError("unknown opaque-id domain");
  if (typeof sessionId !== "string" || sessionId.length === 0)
    throw new TypeError("sessionId must be a non-empty string");
  if (typeof rawId !== "string" || rawId.length === 0)
    throw new TypeError("rawId must be a non-empty string");
  if (/\p{Cc}/u.test(rawId))
    throw new TypeError("rawId must not contain control characters");
  if (encoder.encode(rawId).byteLength > MAX_RAW_BYTES)
    throw new TypeError("rawId exceeds the byte bound");

  const hash = createHash("sha256");
  const parts = [
    "pi-session-inspector",
    "opaque-id",
    "v1",
    domain,
    sessionId,
    rawId,
  ];
  // NUL separators sit between fields only; the preimage has no trailing NUL.
  parts.forEach((part, index) => {
    hash.update(encoder.encode(part));
    if (index < parts.length - 1) hash.update(NUL);
  });
  return hash.digest("hex");
}

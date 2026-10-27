import { randomBytes, timingSafeEqual } from "node:crypto";

const BOOTSTRAP_TTL_MS = 60_000;

/** One bootstrap credential and one stable capability owned by one runtime. */
export function createUiCapabilities(now: () => number = Date.now): {
  newBootstrapToken(): string;
  exchange(token: string): string | undefined;
  authorize(capability: string): boolean;
  revoke(): void;
} {
  let bootstrap: { value: string; expiresAt: number } | undefined;
  let capability: string | undefined;
  return {
    newBootstrapToken() {
      const value = randomBytes(32).toString("base64url");
      bootstrap = { value, expiresAt: now() + BOOTSTRAP_TTL_MS };
      capability ??= randomBytes(32).toString("base64url");
      return value;
    },
    exchange(token) {
      const current = bootstrap;
      if (current === undefined) return undefined;
      if (current.expiresAt <= now()) {
        bootstrap = undefined;
        return undefined;
      }
      if (!safeEqual(current.value, token)) return undefined;
      bootstrap = undefined;
      return capability;
    },
    authorize(candidate) {
      return capability !== undefined && safeEqual(capability, candidate);
    },
    revoke() {
      bootstrap = undefined;
      capability = undefined;
    },
  };
}

function safeEqual(expected: string, candidate: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(candidate);
  return left.length === right.length && timingSafeEqual(left, right);
}

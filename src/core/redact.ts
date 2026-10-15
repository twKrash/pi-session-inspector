/**
 * Single shared bounded-redaction module. One implementation is used by entry
 * reduction (persisted error messages), telemetry, and inventory/report
 * descriptions, so the path/URL/secret policy cannot drift between callers.
 *
 * Nothing here reads raw content: it only transforms values a caller already
 * decided are safe to observe. Redaction is defense-in-depth, never a licence
 * to persist prompts, tool arguments, or tool-result bodies.
 */

import { Buffer } from "node:buffer";

export const REDACTED = "[REDACTED]";
export const PATH_MARKER = "[PATH]";
export const URL_MARKER = "[URL]";

const URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>()]+/gi;
const WINDOWS =
  /(?:^|[\s"'(=,])(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/])[^\s"'<>()]*/g;
const WINDOWS_INNER = /(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/])[^\s"'<>()]*/;
const POSIX = /(?:^|[\s"'(=,])(?:~\/|\/)[^\s"'<>():,;]*(?:\/[^\s"'<>():,;]*)+/g;
const POSIX_INNER = /(?:~\/|\/)[^\s"'<>():,;]*(?:\/[^\s"'<>():,;]*)+/;
const TRUNCATION = "…[TRUNCATED]";
const DOTTED_TOKEN = /(?:[A-Za-z0-9_-]+\.){2}[A-Za-z0-9_-]+/;

// Description policy: producer-authored text is dropped, not marked, when it
// is secret-like or path-like. Kept as a distinct predicate so the inventory,
// snapshot, and report folds keep their exact fail-closed behaviour.
const DESCRIPTION_SECRET_LIKE =
  /(?:secret|password|passwd|api[-_ ]?key|auth(?:orization)?|bearer|token)|\bsk-[A-Za-z0-9_-]{6,}/i;
const PATH_LIKE =
  /(?:^|[^A-Za-z0-9])(?:[/\\]|file:\/\/)|[A-Za-z]:[\\/]|(?:^|\s)~\//;

const encoder = new TextEncoder();

/**
 * Recognises secret-shaped values. Moved verbatim from the entry reducer and
 * the telemetry validator, which had agreed on this predicate by copy.
 */
export function secretLikeValue(value: string): boolean {
  return (
    /(?:secret|token|password|credential)/i.test(value) ||
    credentialShapedValue(value) ||
    DOTTED_TOKEN.test(value) ||
    /(?:^|[\\/])\.env(?:[.\\/]|$)|(?:^|[\\/])(?:credentials?|secrets?)(?:[.\\/]|$)/i.test(
      value,
    )
  );
}

/** Recognises credential structures without flagging ordinary label words. */
export function secretShapedValue(value: string): boolean {
  return credentialShapedValue(value) || hasJoseCredentialHeader(value);
}

function credentialShapedValue(value: string): boolean {
  return (
    /(?:^|\s)bearer\s+\S+/i.test(value) ||
    /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----/i.test(value) ||
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/.test(
      value,
    ) ||
    /\bsk-[A-Za-z0-9_-]{6,}/i.test(value) ||
    /[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@/i.test(value) ||
    /^[A-Za-z_][A-Za-z0-9_]*\s*=\s*\S+/.test(value)
  );
}

function hasJoseCredentialHeader(value: string): boolean {
  if (value.length > 64) return false;
  for (const match of value.matchAll(
    /(?=(?:^|[^A-Za-z0-9_-])([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*)/g,
  )) {
    const encodedHeader = match[1];
    if (encodedHeader === undefined) continue;
    const bytes = Buffer.from(encodedHeader, "base64url");
    if (bytes.toString("base64url") !== encodedHeader) continue;
    try {
      const header: unknown = JSON.parse(bytes.toString("utf8"));
      if (
        typeof header === "object" &&
        header !== null &&
        !Array.isArray(header) &&
        "alg" in header &&
        typeof (header as Record<string, unknown>).alg === "string" &&
        (header as Record<string, string>).alg.length > 0
      ) {
        // A valid protected header identifies JWS/JWE; payload and signature
        // need not be valid for a producer value to be sensitive.
        return true;
      }
    } catch {
      // A non-JSON dotted label is not a JOSE header.
    }
  }
  return false;
}

/**
 * Bounded, single-line, redacted rendering of a persisted string. Order:
 * reject unusable input → strip control characters → collapse whitespace →
 * replace URLs → replace path-like fragments → seal secret-shaped values →
 * truncate on a UTF-8 boundary. Returns `undefined` when nothing safe remains.
 */
export function redactBoundedText(
  value: unknown,
  maxBytes = 200,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const single = stripControlCharacters(value).replace(/\s+/g, " ").trim();
  if (single.length === 0) return undefined;
  const redacted = single
    .replace(URL, URL_MARKER)
    .replace(WINDOWS, (match) => match.replace(WINDOWS_INNER, PATH_MARKER))
    .replace(POSIX, (match) => match.replace(POSIX_INNER, PATH_MARKER));
  const sealed = secretLikeValue(redacted) ? REDACTED : redacted;
  if (byteLength(sealed) <= maxBytes) return sealed;
  // Honor the byte cap at every budget: when the truncation marker cannot fit,
  // emit a plain code-point-boundary cut instead of overflowing the budget.
  const limit = maxBytes - byteLength(TRUNCATION);
  if (limit <= 0) return truncateUtf8(sealed, maxBytes);
  return truncateUtf8(sealed, limit) + TRUNCATION;
}

/**
 * Shared description policy: single line after control-character stripping,
 * bounded, and rejected outright when secret-like or path-like. `undefined`
 * means "omit the description", never "fabricate a placeholder".
 */
export function boundedDescription(
  value: unknown,
  maxBytes = 120,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = stripControlCharacters(value).trim();
  if (trimmed.length === 0) return undefined;
  if (byteLength(trimmed) > maxBytes) return undefined;
  if (DESCRIPTION_SECRET_LIKE.test(trimmed) || PATH_LIKE.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function stripControlCharacters(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    out += code < 0x20 || (code >= 0x7f && code <= 0x9f) ? " " : char;
  }
  return out;
}

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

/** Cuts at a UTF-8 code-point boundary so no partial sequence is emitted. */
function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  const buffer = Buffer.from(value, "utf8");
  if (buffer.byteLength <= maxBytes) return value;
  let end = maxBytes;
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end--;
  return buffer.subarray(0, end).toString("utf8");
}

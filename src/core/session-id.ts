const ASCII_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_SESSION_ID_LENGTH = 128;

/** Returns whether a session ID is a bounded path-safe ASCII token. */
export function isSafeSessionId(sessionId: string): boolean {
  return (
    sessionId.length > 0 &&
    sessionId.length <= MAX_SESSION_ID_LENGTH &&
    ASCII_TOKEN.test(sessionId)
  );
}

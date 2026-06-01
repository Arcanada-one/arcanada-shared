/**
 * Extracts the token from a `Bearer <token>` Authorization header.
 *
 * The scheme keyword is matched case-insensitively; the token is the first
 * whitespace-delimited run after it. Returns `null` for a missing header, a
 * non-Bearer scheme, or an empty token — callers treat `null` as "no
 * credentials presented" (fail-closed → 401).
 */
export function extractBearer(header?: string): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)/i.exec(header);
  return match ? match[1] : null;
}

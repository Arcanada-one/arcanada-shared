/**
 * RFC 7807 / RFC 9457 Problem Details types for the Arcanada ecosystem.
 *
 * The base URI is NOT baked in — consumers pass their own error-namespace URI,
 * so the package carries no project domain.
 * The title map is frozen: titles are part of the wire contract, so adding a
 * code is an explicit edit here, never an ad-hoc string at a throw site.
 */

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance: string;
  code: string;
  trace_id?: string;
}

/** Frozen code → { http_status, title } map. */
export const PROBLEM_TITLES = Object.freeze({
  invalid_request: { status: 400, title: "Invalid request" },
  invalid_client: { status: 400, title: "Invalid client" },
  invalid_grant: { status: 400, title: "Invalid grant" },
  access_denied: { status: 400, title: "Access denied" },
  invalid_scope: { status: 400, title: "Invalid scope" },
  interaction_session_not_found: { status: 410, title: "Interaction expired" },
  insufficient_scope: { status: 403, title: "Insufficient scope" },
  invalid_token: { status: 401, title: "Invalid token" },
  csrf_failed: { status: 403, title: "CSRF check failed" },
  uid_mismatch: { status: 403, title: "Interaction uid mismatch" },
  oidc_disabled: { status: 503, title: "OIDC disabled" },
  uid_too_long: { status: 400, title: "Interaction uid too long" },
  rate_limited: { status: 429, title: "Rate limit exceeded" },
  internal_error: { status: 500, title: "Internal server error" },
} as const);

export type ProblemCode = keyof typeof PROBLEM_TITLES;

/** Builds a problem `type` URI from a consumer-supplied base and a code. */
export function problemTypeUri(baseUri: string, code: string): string {
  return `${baseUri}/${code}`;
}

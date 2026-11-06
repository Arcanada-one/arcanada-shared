/**
 * Live Lab scoped controls (KCLIVE-02).
 *
 * Identity from BrowserIdentity is never an execution or artifact grant.
 * Every command, snapshot, event subscription and download must bind a current
 * project/object/action grant. Reasons are typed and redacted — they never
 * disclose whether an inaccessible foreign object exists.
 */

export const LAB_ACTIONS = [
  "command",
  "snapshot",
  "event_subscribe",
  "download",
] as const;

export type LabAction = (typeof LAB_ACTIONS)[number];

export const REFUSAL_CODES = [
  "unauthenticated",
  "grant_required",
  "scope_mismatch",
  "cross_project_forbidden",
  "action_forbidden",
  "object_forbidden",
  "revoked",
  "unsafe_mutation",
] as const;

export type RefusalCode = (typeof REFUSAL_CODES)[number];

export interface ScopeGrant {
  /** Owning project id (opaque UUID or stable lab sample id). */
  readonly projectId: string;
  /** Object id within the project (run, artifact, snapshot, …). */
  readonly objectId: string;
  /** Allowed actions for this object. Empty means no actions. */
  readonly actions: readonly LabAction[];
}

export interface ScopedPrincipal {
  readonly subject: string;
  /** Current grants. Identity without grants authorizes nothing. */
  readonly grants: readonly ScopeGrant[];
  /** When true, every check fails with `revoked` (post-logout / explicit revoke). */
  readonly revoked?: boolean;
}

export interface ScopedRequest {
  readonly action: LabAction;
  readonly projectId: string;
  readonly objectId: string;
  /** True for state-changing commands (create/cancel/mutate). */
  readonly mutates?: boolean;
}

export type ScopedDecision =
  | { readonly allow: true; readonly grant: ScopeGrant }
  | { readonly allow: false; readonly code: RefusalCode };

const ACTION_SET: ReadonlySet<string> = new Set(LAB_ACTIONS);

export function isLabAction(value: unknown): value is LabAction {
  return typeof value === "string" && ACTION_SET.has(value);
}

function nonEmptyId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

/**
 * Evaluate one scoped request against the current principal.
 * Fail-closed: missing fields, unknown actions and empty grant sets deny.
 */
export function authorizeScoped(
  principal: ScopedPrincipal | null | undefined,
  request: ScopedRequest,
): ScopedDecision {
  if (
    !principal ||
    typeof principal.subject !== "string" ||
    !principal.subject
  ) {
    return { allow: false, code: "unauthenticated" };
  }
  if (principal.revoked) {
    return { allow: false, code: "revoked" };
  }
  if (!isLabAction(request.action)) {
    return { allow: false, code: "action_forbidden" };
  }
  if (!nonEmptyId(request.projectId) || !nonEmptyId(request.objectId)) {
    return { allow: false, code: "scope_mismatch" };
  }
  const grants = principal.grants ?? [];
  if (grants.length === 0) {
    // Identity alone is not an execution or artifact grant.
    return { allow: false, code: "grant_required" };
  }

  const sameProject = grants.filter((g) => g.projectId === request.projectId);
  if (sameProject.length === 0) {
    // Do not confirm whether the foreign project/object exists.
    return { allow: false, code: "cross_project_forbidden" };
  }

  const match = sameProject.find((g) => g.objectId === request.objectId);
  if (!match) {
    return { allow: false, code: "object_forbidden" };
  }
  if (!match.actions.includes(request.action)) {
    return { allow: false, code: "action_forbidden" };
  }
  if (request.mutates && request.action !== "command") {
    return { allow: false, code: "unsafe_mutation" };
  }
  return { allow: true, grant: match };
}

/** Pure helper: drop all grants and mark revoked (logout / explicit revoke). */
export function revokePrincipal(principal: ScopedPrincipal): ScopedPrincipal {
  return {
    subject: principal.subject,
    grants: [],
    revoked: true,
  };
}

/**
 * Build a redacted refusal body safe for browser/API clients.
 * Never includes object existence hints or grant inventories.
 */
export function redactedRefusal(code: RefusalCode): {
  error: { code: RefusalCode };
} {
  return { error: { code } };
}

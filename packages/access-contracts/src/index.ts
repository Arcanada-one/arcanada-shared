/**
 * Shared access and capability contract for Arcanada product surfaces.
 *
 * ## Why this lives here rather than in either consumer
 *
 * Two independent systems must agree on it: the authorization service that
 * evaluates capabilities, and the backend-for-frontend that enforces the
 * answer. A contract duplicated in both is a contract that will eventually
 * disagree, and the disagreement surfaces as an authorization bug rather than
 * as a type error.
 *
 * ## Fail-closed is encoded, not documented
 *
 * The contract requires that a missing decision, a malformed response, a
 * timeout, an authorization outage or an audit failure yields deny or
 * unavailable, and that a previous allow is never reused across a subject or
 * session boundary. Written as prose in two codebases, that rule survives
 * exactly as long as nobody is in a hurry. `resolveDecisions` implements it
 * once, and it iterates the REQUESTED checks rather than the returned
 * decisions, so anything a responder omitted is unavailable by construction
 * instead of by remembering to look.
 *
 * ## Deliberately dependency-free
 *
 * No validation library. A shared contract package is imported by everything,
 * so every dependency it takes is taken by every consumer, and a schema library
 * in this position is a supply-chain decision wearing the clothes of a
 * convenience. The validators below are hand-written and total.
 */

/* -------------------------------------------------------------------------- */
/* Capability vocabulary                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The complete capability vocabulary. Closed on purpose: an open-ended
 * capability string is an open-ended policy surface, and an unknown name has to
 * be rejected rather than evaluated.
 */
export const CAPABILITIES = [
  "spaces.read",
  "infrastructure.read",
  "dev_agents.read",
  "dev_agents.operate",
  "content.read",
  "content.write",
  "content.publish_live",
  "marketing.read",
  "support.tickets.read",
  "support.tickets.update",
  "provider_accounts.read_billing",
  "control.authorization.manage",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const CAPABILITY_SET: ReadonlySet<string> = new Set(CAPABILITIES);

export function isCapability(value: unknown): value is Capability {
  return typeof value === "string" && CAPABILITY_SET.has(value);
}

/* -------------------------------------------------------------------------- */
/* Resources                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Resource kinds a check may be scoped to. Only `space` exists today, because
 * it is the only scope the contract names — space-scoped actions additionally
 * require the relevant space relationship. Adding a kind is a deliberate
 * contract change, which is the point of keeping the set closed.
 */
export const RESOURCE_KINDS = ["space"] as const;

export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export interface ResourceRef {
  readonly kind: ResourceKind;
  readonly id: string;
}

const RESOURCE_KIND_SET: ReadonlySet<string> = new Set(RESOURCE_KINDS);

/**
 * Canonical UUID form. Rejecting a malformed subject at the edge stops an
 * invalid identifier reaching policy evaluation, where "no match" and "not a
 * subject" would otherwise look alike.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/* -------------------------------------------------------------------------- */
/* Requests                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Upper bound on a single batch. The contract requires oversized batches to be
 * rejected but does not fix the number, so it is fixed here — one place, both
 * sides — rather than chosen twice and differing. Thirty-two covers a route
 * family's worth of checks while keeping one evaluation bounded.
 */
export const MAX_CHECKS_PER_REQUEST = 32;

export interface CapabilityCheck {
  readonly capability: Capability;
  readonly resource?: ResourceRef;
}

export interface EntitlementRequest {
  readonly subject: string;
  readonly checks: readonly CapabilityCheck[];
}

/* -------------------------------------------------------------------------- */
/* Decisions                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * `unavailable` is distinct from `deny` on purpose. Both refuse, and a gate has
 * to treat them identically — but only one of them means the authorization
 * system actually answered. Collapsing them loses the difference between "you
 * may not" and "we do not know", which is the difference an operator needs when
 * a surface goes dark.
 */
export const EFFECTS = ["allow", "deny", "unavailable"] as const;

export type Effect = (typeof EFFECTS)[number];

export interface Decision {
  readonly capability: Capability;
  readonly resource?: ResourceRef;
  readonly effect: Effect;
}

export interface EntitlementResponse {
  readonly decisions: readonly Decision[];
  readonly policyVersion: string;
  readonly evaluatedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Unknown fields are rejected rather than ignored. A silently dropped field is
 * how a caller comes to believe it constrained something it did not.
 */
function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
): string | null {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return `${where}: unknown field '${key}'`;
  }
  return null;
}

function parseResource(
  value: unknown,
  where: string,
): ValidationResult<ResourceRef> {
  if (!isPlainObject(value))
    return { ok: false, error: `${where}: resource must be an object` };
  const unknown = rejectUnknownKeys(value, ["kind", "id"], where);
  if (unknown !== null) return { ok: false, error: unknown };
  const kind: unknown = value["kind"];
  const id: unknown = value["id"];
  if (typeof kind !== "string" || !RESOURCE_KIND_SET.has(kind)) {
    return { ok: false, error: `${where}: unknown resource kind` };
  }
  if (typeof id !== "string" || id.length === 0) {
    return {
      ok: false,
      error: `${where}: resource id must be a non-empty string`,
    };
  }
  return { ok: true, value: { kind: kind as ResourceKind, id } };
}

export function parseEntitlementRequest(
  value: unknown,
): ValidationResult<EntitlementRequest> {
  if (!isPlainObject(value))
    return { ok: false, error: "request must be an object" };
  const unknown = rejectUnknownKeys(value, ["subject", "checks"], "request");
  if (unknown !== null) return { ok: false, error: unknown };

  const subject: unknown = value["subject"];
  const checks: unknown = value["checks"];
  if (!isUuid(subject))
    return { ok: false, error: "request: subject must be a UUID" };
  if (!Array.isArray(checks))
    return { ok: false, error: "request: checks must be an array" };
  if (checks.length === 0)
    return { ok: false, error: "request: checks must not be empty" };
  if (checks.length > MAX_CHECKS_PER_REQUEST) {
    return {
      ok: false,
      error: `request: batch exceeds ${MAX_CHECKS_PER_REQUEST} checks`,
    };
  }

  const parsed: CapabilityCheck[] = [];
  for (let index = 0; index < checks.length; index += 1) {
    const where = `request.checks[${index}]`;
    const raw: unknown = checks[index];
    if (!isPlainObject(raw))
      return { ok: false, error: `${where}: must be an object` };
    const unknownCheck = rejectUnknownKeys(
      raw,
      ["capability", "resource"],
      where,
    );
    if (unknownCheck !== null) return { ok: false, error: unknownCheck };
    const capability: unknown = raw["capability"];
    if (!isCapability(capability))
      return { ok: false, error: `${where}: unknown capability` };
    const resourceRaw: unknown = raw["resource"];
    if (resourceRaw === undefined) {
      parsed.push({ capability });
      continue;
    }
    const resource = parseResource(resourceRaw, where);
    if (!resource.ok) return { ok: false, error: resource.error };
    parsed.push({ capability, resource: resource.value });
  }
  return { ok: true, value: { subject, checks: parsed } };
}

export function parseEntitlementResponse(
  value: unknown,
): ValidationResult<EntitlementResponse> {
  if (!isPlainObject(value))
    return { ok: false, error: "response must be an object" };
  const unknown = rejectUnknownKeys(
    value,
    ["decisions", "policyVersion", "evaluatedAt"],
    "response",
  );
  if (unknown !== null) return { ok: false, error: unknown };

  const decisions: unknown = value["decisions"];
  const policyVersion: unknown = value["policyVersion"];
  const evaluatedAt: unknown = value["evaluatedAt"];
  if (typeof policyVersion !== "string" || policyVersion.length === 0) {
    return {
      ok: false,
      error: "response: policyVersion must be a non-empty string",
    };
  }
  if (
    typeof evaluatedAt !== "string" ||
    Number.isNaN(Date.parse(evaluatedAt))
  ) {
    return {
      ok: false,
      error: "response: evaluatedAt must be an ISO timestamp",
    };
  }
  if (!Array.isArray(decisions))
    return { ok: false, error: "response: decisions must be an array" };

  const parsed: Decision[] = [];
  for (let index = 0; index < decisions.length; index += 1) {
    const where = `response.decisions[${index}]`;
    const raw: unknown = decisions[index];
    if (!isPlainObject(raw))
      return { ok: false, error: `${where}: must be an object` };
    const unknownDecision = rejectUnknownKeys(
      raw,
      ["capability", "resource", "effect"],
      where,
    );
    if (unknownDecision !== null) return { ok: false, error: unknownDecision };
    const capability: unknown = raw["capability"];
    if (!isCapability(capability))
      return { ok: false, error: `${where}: unknown capability` };
    const effect: unknown = raw["effect"];
    if (
      typeof effect !== "string" ||
      !(EFFECTS as readonly string[]).includes(effect)
    ) {
      return { ok: false, error: `${where}: unknown effect` };
    }
    const resourceRaw: unknown = raw["resource"];
    if (resourceRaw === undefined) {
      parsed.push({ capability, effect: effect as Effect });
      continue;
    }
    const resource = parseResource(resourceRaw, where);
    if (!resource.ok) return { ok: false, error: resource.error };
    parsed.push({
      capability,
      resource: resource.value,
      effect: effect as Effect,
    });
  }
  return { ok: true, value: { decisions: parsed, policyVersion, evaluatedAt } };
}

/* -------------------------------------------------------------------------- */
/* Fail-closed resolution                                                     */
/* -------------------------------------------------------------------------- */

function sameResource(
  a: ResourceRef | undefined,
  b: ResourceRef | undefined,
): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  return a.kind === b.kind && a.id === b.id;
}

/**
 * Resolve the effect for every requested check.
 *
 * Iteration is over the REQUESTED checks, never over the returned decisions.
 * That ordering is the whole safety property: a responder that omits a check,
 * returns a decision nobody asked for, or answers one check twice with
 * conflicting effects cannot produce an allow for something unanswered. An
 * implementation walking the response instead would pass every test that only
 * feeds it well-formed responses, and fail in production exactly when the
 * authorization service is degraded — which is when it matters.
 *
 * `null` means no usable response at all: timeout, transport failure,
 * authorization outage, audit failure, or a body that did not parse. Every
 * check then resolves to unavailable.
 *
 * A duplicate answer resolves to the most restrictive effect present, so a
 * response carrying both allow and deny for one check denies.
 */
export function resolveDecisions(
  requested: readonly CapabilityCheck[],
  response: EntitlementResponse | null,
): readonly Decision[] {
  return requested.map((check): Decision => {
    const base: Omit<Decision, "effect"> =
      check.resource === undefined
        ? { capability: check.capability }
        : { capability: check.capability, resource: check.resource };

    if (response === null) return { ...base, effect: "unavailable" };

    const matches = response.decisions.filter(
      (decision) =>
        decision.capability === check.capability &&
        sameResource(decision.resource, check.resource),
    );
    if (matches.length === 0) return { ...base, effect: "unavailable" };
    if (matches.some((decision) => decision.effect === "unavailable")) {
      return { ...base, effect: "unavailable" };
    }
    if (matches.some((decision) => decision.effect === "deny")) {
      return { ...base, effect: "deny" };
    }
    return { ...base, effect: "allow" };
  });
}

/** The single gate. Only an explicit allow permits an action. */
export function isAllowed(decision: Decision): boolean {
  return decision.effect === "allow";
}

/* -------------------------------------------------------------------------- */
/* Browser snapshot                                                           */
/* -------------------------------------------------------------------------- */

/**
 * What a browser is given: the capabilities that resolved to allow, and nothing
 * else. Never raw tuples, never policy internals, never the reason a check
 * failed — a denial reason is a description of the policy, and the browser is
 * not a place to publish one.
 *
 * Keyed by subject and session so it cannot outlive either. A snapshot without
 * those keys would be reusable across precisely the boundary the contract
 * forbids reusing an allow across.
 */
export interface CapabilitySnapshot {
  readonly subject: string;
  readonly sessionId: string;
  readonly allowed: readonly Capability[];
  readonly policyVersion: string;
  readonly evaluatedAt: string;
}

/**
 * Resource-scoped allows are deliberately excluded from the snapshot. A bare
 * capability name cannot express "on that space and no other", so including one
 * would tell the browser it may do something generally that it may only do
 * somewhere specific.
 */
export function buildSnapshot(args: {
  readonly subject: string;
  readonly sessionId: string;
  readonly decisions: readonly Decision[];
  readonly policyVersion: string;
  readonly evaluatedAt: string;
}): CapabilitySnapshot {
  const allowed = args.decisions
    .filter(
      (decision) =>
        decision.effect === "allow" && decision.resource === undefined,
    )
    .map((decision) => decision.capability);
  return {
    subject: args.subject,
    sessionId: args.sessionId,
    allowed: [...new Set(allowed)],
    policyVersion: args.policyVersion,
    evaluatedAt: args.evaluatedAt,
  };
}

/**
 * A snapshot is only usable for the subject and session it was built for.
 * Presentation is not enforcement — the backend gate re-checks regardless — but
 * a snapshot leaking across a boundary would show one user another's
 * navigation, which is a disclosure even when every action still fails closed.
 */
export function snapshotApplies(
  snapshot: CapabilitySnapshot,
  subject: string,
  sessionId: string,
): boolean {
  return snapshot.subject === subject && snapshot.sessionId === sessionId;
}

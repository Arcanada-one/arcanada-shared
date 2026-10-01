import type { ValidationResult } from "./index.js";
import { parsePersonalAuthJson } from "./personal-auth-json.js";
import {
  PERSONAL_AUTH_PROFILE,
  PERSONAL_AUTH_WIRE_VERSION,
  parsePersonalAuthParticipant,
  type PersonalAuthParticipant,
} from "./personal-auth-v1.js";
import { parsePersonalAuthLeaseAdmission } from "./personal-auth-lease-v1.js";
import {
  parsePersonalAuthOwnerOutcome,
  personalAuthOwnerOutcomeEffect,
  type PersonalAuthOwnerOutcome,
} from "./personal-auth-owner-outcome.js";
import { snapshotRecord } from "./wire-snapshot.js";

/** Proposed protected request structure, never caller authentication or settlement. */
export interface PersonalAuthOwnerOutcomeRequest {
  readonly wire_version: typeof PERSONAL_AUTH_WIRE_VERSION;
  readonly profile_id: typeof PERSONAL_AUTH_PROFILE;
  readonly request_id: string;
  readonly idempotency_key: string;
  readonly participant: PersonalAuthParticipant;
  readonly lease_id: string;
  readonly outcome: PersonalAuthOwnerOutcome;
}
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export function parsePersonalAuthOwnerOutcomeRequest(
  input: unknown,
): ValidationResult<PersonalAuthOwnerOutcomeRequest> {
  try {
    const value = snapshotRecord(input, [
      "wire_version",
      "profile_id",
      "request_id",
      "idempotency_key",
      "participant",
      "lease_id",
      "outcome",
    ]);
    if (
      !value ||
      value.wire_version !== PERSONAL_AUTH_WIRE_VERSION ||
      value.profile_id !== PERSONAL_AUTH_PROFILE ||
      ![value.request_id, value.idempotency_key, value.lease_id].every(
        (x) => typeof x === "string" && ID.test(x),
      )
    )
      throw new Error();
    const participant = parsePersonalAuthParticipant(value.participant);
    const outcome = parsePersonalAuthOwnerOutcome(value.outcome);
    if (!participant.ok || !outcome.ok) throw new Error();
    const p = participant.value,
      o = outcome.value;
    if (
      o.kind !== "link_repaired" &&
      p.role !==
        (o.kind === "disk_stored" || o.kind === "disk_cleaned"
          ? "disk"
          : "product")
    )
      throw new Error();
    return {
      ok: true,
      value: {
        wire_version: PERSONAL_AUTH_WIRE_VERSION,
        profile_id: PERSONAL_AUTH_PROFILE,
        request_id: value.request_id as string,
        idempotency_key: value.idempotency_key as string,
        lease_id: value.lease_id as string,
        participant: p,
        outcome: o,
      },
    };
  } catch {
    return { ok: false, error: "invalid personal owner outcome request" };
  }
}

/** Strict raw decoding precedes detached request parsing; neither authenticates. */
export function parsePersonalAuthOwnerOutcomeRequestJson(
  input: unknown,
): ValidationResult<PersonalAuthOwnerOutcomeRequest> {
  const parsed = parsePersonalAuthJson(input);
  return parsed.ok
    ? parsePersonalAuthOwnerOutcomeRequest(parsed.value)
    : parsed;
}

/**
 * Only same-generation structural overlap with an issuance effect lease.
 * Does NOT bind operation/intent/resource digest (absent in the lease record),
 * authenticate a caller, resolve owner references, prove durability or settle.
 * Replacement-generation recovery requires its separate authenticated protocol.
 */
export function personalAuthOwnerOutcomeRequestMatchesSameGenerationLease(
  input: unknown,
  leaseInput: unknown,
): boolean {
  const request = parsePersonalAuthOwnerOutcomeRequest(input);
  const lease = parsePersonalAuthLeaseAdmission(leaseInput);
  if (!request.ok || !lease.ok || lease.value.lease_kind !== "effect")
    return false;
  const r = request.value,
    l = lease.value;
  const effect = personalAuthOwnerOutcomeEffect(r.outcome);
  return (
    effect.ok &&
    effect.value === l.effect &&
    r.lease_id === l.lease_id &&
    r.outcome.realm_id === l.realm_id &&
    r.outcome.participant_id === l.participant.participant_id &&
    r.outcome.process_generation === l.participant.process_generation &&
    r.outcome.deployment_generation === l.participant.deployment_generation &&
    r.participant.participant_id === l.participant.participant_id &&
    r.participant.role === l.participant.role &&
    r.participant.process_generation === l.participant.process_generation &&
    r.participant.boot_id === l.participant.boot_id &&
    r.participant.deployment_generation === l.participant.deployment_generation
  );
}

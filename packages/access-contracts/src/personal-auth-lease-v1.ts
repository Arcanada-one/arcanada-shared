import type { ValidationResult } from "./index.js";
import {
  isPersonalAuthCounter,
  parsePersonalAuthParticipant,
  type PersonalAuthParticipant,
} from "./personal-auth-v1.js";
import { snapshotRecord } from "./wire-snapshot.js";

export interface PersonalAuthReleaseUnit {
  readonly delivery_id: string;
  readonly frame_index: number;
  readonly object_revision: string | null;
  readonly representation_binding_id: string;
  readonly offset_bytes: number;
  readonly length_bytes: number;
  readonly destination: "product" | "client";
  readonly destination_binding_id: string;
}

export type PersonalAuthEffect =
  | "intent_create"
  | "intent_stage"
  | "intent_cancel"
  | "disk_stage"
  | "product_publish"
  | "repair_link"
  | "cleanup_cancelled";

/** Issuance snapshot, not GET/settlement wire, a bearer ticket or an execution decision. */
interface PersonalAuthLeaseAdmissionBase {
  readonly lease_id: string;
  readonly flow_id: string;
  readonly grant_id: string;
  readonly participant: PersonalAuthParticipant;
  readonly realm_id: string;
  readonly policy_epoch: string;
  readonly participant_config_version: string;
  readonly admitted_seq: string;
  readonly admitted_at: string;
  readonly execute_before: string;
  readonly state: "admitted";
}

export type PersonalAuthLeaseAdmission = PersonalAuthLeaseAdmissionBase &
  (
    | {
        readonly lease_kind: "access";
        readonly effect: null;
        readonly resource_binding_id: string | null;
        readonly release_unit: null;
      }
    | {
        readonly lease_kind: "effect";
        readonly effect: PersonalAuthEffect;
        readonly resource_binding_id: string | null;
        readonly release_unit: null;
      }
    | {
        readonly lease_kind: "release";
        readonly effect: null;
        readonly resource_binding_id: string;
        readonly release_unit: PersonalAuthReleaseUnit;
      }
  );

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const id = (value: unknown): value is string =>
  typeof value === "string" && value.length === 36 && UUID.test(value);
const integer = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  !Object.is(value, -0);

function requireValue(value: unknown): asserts value {
  if (!value) throw new Error();
}
function record(
  input: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  const value = snapshotRecord(input, keys);
  requireValue(value !== null);
  return value;
}
function safely<T>(work: () => T): ValidationResult<T> {
  try {
    return { ok: true, value: work() };
  } catch {
    return { ok: false, error: "invalid personal lease wire" };
  }
}
function time(input: unknown): number {
  requireValue(
    typeof input === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input),
  );
  const parsed = Date.parse(input);
  requireValue(
    Number.isFinite(parsed) && new Date(parsed).toISOString() === input,
  );
  return parsed;
}

function release(input: unknown): PersonalAuthReleaseUnit {
  const value = record(input, [
    "delivery_id",
    "frame_index",
    "object_revision",
    "representation_binding_id",
    "offset_bytes",
    "length_bytes",
    "destination",
    "destination_binding_id",
  ]);
  requireValue(
    [
      value["delivery_id"],
      value["representation_binding_id"],
      value["destination_binding_id"],
    ].every(id),
  );
  requireValue(
    value["object_revision"] === null || id(value["object_revision"]),
  );
  requireValue(
    integer(value["frame_index"]) &&
      integer(value["offset_bytes"]) &&
      integer(value["length_bytes"]) &&
      value["length_bytes"] <= 65_536 &&
      value["offset_bytes"] + value["length_bytes"] <= 1_048_576,
  );
  requireValue(
    value["destination"] === "product" || value["destination"] === "client",
  );
  return value as unknown as PersonalAuthReleaseUnit;
}

/** Exact decoded structure; no connection, representation, byte or at-most-once proof. */
export function parsePersonalAuthReleaseUnit(
  input: unknown,
): ValidationResult<PersonalAuthReleaseUnit> {
  return safely(() => release(input));
}

/**
 * Check the issued lease record's shape and selected profile bounds.
 * Expired admitted records remain valid obligations: parsing observes no clock,
 * settles nothing and never authorizes replay or execution after restart.
 */
export function parsePersonalAuthLeaseAdmission(
  input: unknown,
): ValidationResult<PersonalAuthLeaseAdmission> {
  return safely(() => {
    const value = record(input, [
      "lease_id",
      "flow_id",
      "grant_id",
      "participant",
      "realm_id",
      "policy_epoch",
      "participant_config_version",
      "lease_kind",
      "effect",
      "resource_binding_id",
      "release_unit",
      "admitted_seq",
      "admitted_at",
      "execute_before",
      "state",
    ]);
    requireValue(
      [
        value["lease_id"],
        value["flow_id"],
        value["grant_id"],
        value["realm_id"],
      ].every(id),
    );
    requireValue(
      [
        value["policy_epoch"],
        value["participant_config_version"],
        value["admitted_seq"],
      ].every(isPersonalAuthCounter),
    );
    requireValue(value["state"] === "admitted");
    const parsed = parsePersonalAuthParticipant(value["participant"]);
    requireValue(parsed.ok);
    const participant = parsed.value;
    const kind = value["lease_kind"];
    const effect = value["effect"];
    const binding = value["resource_binding_id"];
    requireValue(binding === null || id(binding));
    let unit: PersonalAuthReleaseUnit | null = null;
    if (kind === "release") {
      requireValue(effect === null && binding !== null);
      unit = release(value["release_unit"]);
      requireValue(
        unit.destination ===
          (participant.role === "disk" ? "product" : "client"),
      );
    } else {
      requireValue(value["release_unit"] === null);
      if (kind === "access")
        requireValue(
          effect === null &&
            (participant.role === "product" || binding !== null),
        );
      else {
        requireValue(kind === "effect");
        const allowed =
          participant.role === "product"
            ? [
                "intent_create",
                "intent_stage",
                "intent_cancel",
                "product_publish",
                "repair_link",
              ]
            : ["disk_stage", "cleanup_cancelled", "repair_link"];
        requireValue(typeof effect === "string" && allowed.includes(effect));
        requireValue(binding !== null || effect === "intent_create");
      }
    }
    const admitted = time(value["admitted_at"]);
    const deadline = time(value["execute_before"]);
    requireValue(
      deadline >= admitted &&
        deadline - admitted <= (kind === "release" ? 1000 : 30_000),
    );
    return {
      ...value,
      participant,
      release_unit: unit,
    } as unknown as PersonalAuthLeaseAdmission;
  });
}

/** Compare issued snapshots only; both must be resolved through current Auth separately. */
export function comparePersonalAuthLeaseAdmission(
  expected: unknown,
  received: unknown,
): "same_admission" | "conflict" | "invalid" {
  const a = parsePersonalAuthLeaseAdmission(expected);
  const b = parsePersonalAuthLeaseAdmission(received);
  if (!a.ok || !b.ok) return "invalid";
  const identity = (lease: PersonalAuthLeaseAdmission) =>
    JSON.stringify([
      lease.lease_id,
      lease.flow_id,
      lease.grant_id,
      lease.realm_id,
      lease.policy_epoch,
      lease.participant_config_version,
      lease.admitted_seq,
      lease.admitted_at,
      lease.execute_before,
      lease.state,
      lease.lease_kind,
      lease.effect,
      lease.resource_binding_id,
      [
        lease.participant.participant_id,
        lease.participant.role,
        lease.participant.process_generation,
        lease.participant.boot_id,
        lease.participant.deployment_generation,
      ],
      lease.release_unit === null
        ? null
        : [
            lease.release_unit.delivery_id,
            lease.release_unit.frame_index,
            lease.release_unit.object_revision,
            lease.release_unit.representation_binding_id,
            lease.release_unit.offset_bytes,
            lease.release_unit.length_bytes,
            lease.release_unit.destination,
            lease.release_unit.destination_binding_id,
          ],
    ]);
  return identity(a.value) === identity(b.value)
    ? "same_admission"
    : "conflict";
}

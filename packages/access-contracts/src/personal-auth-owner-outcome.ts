import type { ValidationResult } from "./index.js";
import type { PersonalAuthEffect } from "./personal-auth-lease-v1.js";
import { isPersonalAuthCounter } from "./personal-auth-v1.js";
import {
  parsePersonalCaptureCancellation,
  parsePersonalCaptureStatus,
  parsePersonalObjectReceipt,
  type PersonalCaptureCancellation,
  type PersonalCaptureStatus,
  type PersonalObjectReceipt,
} from "./personal-capture.js";
import { counter, snapshotArray, snapshotRecord } from "./wire-snapshot.js";

interface OwnerOutcomeBase {
  readonly owner_receipt_id: string;
  readonly realm_id: string;
  readonly deployment_generation: string;
  readonly participant_id: string;
  readonly process_generation: string;
  readonly operation_id: string;
  readonly intent_id: string;
  readonly owner_commit_id: string;
  readonly local_seq: string;
  readonly resource_binding_digest: string;
}

export interface PersonalAuthCleanedObject {
  readonly part_id: string;
  readonly object_id: string;
  readonly object_revision: string;
}

/** Protected owner assertion structure; never authorization or durable proof. */
export type PersonalAuthOwnerOutcome = OwnerOutcomeBase &
  (
    | {
        readonly kind: "intent_created";
        readonly capture_status: PersonalCaptureStatus & {
          state: "awaiting_bytes";
        };
      }
    | {
        readonly kind: "intent_staged";
        readonly capture_status: PersonalCaptureStatus & { state: "staged" };
        readonly storage_receipt_ids: readonly string[];
      }
    | {
        readonly kind: "disk_stored";
        readonly object_receipt: PersonalObjectReceipt;
        readonly storage_receipt_id: string;
      }
    | {
        readonly kind: "product_committed";
        readonly capture_status: PersonalCaptureStatus & { state: "committed" };
        readonly publication_id: string;
        readonly manifest_digest: string;
        readonly storage_receipt_ids: readonly string[];
      }
    | {
        readonly kind: "product_cancelled";
        readonly capture_status: PersonalCaptureStatus & { state: "cancelled" };
      }
    | {
        readonly kind: "link_repaired";
        readonly committed_owner_outcome_id: string;
        readonly storage_receipt_id: string;
        readonly link_revision: number;
        readonly link_binding_digest: string;
      }
    | {
        readonly kind: "disk_cleaned";
        readonly cancelled_owner_outcome_id: string;
        readonly cancellation: PersonalCaptureCancellation;
        readonly cleaned_objects: readonly PersonalAuthCleanedObject[];
      }
  );

const COMMON = [
  "owner_receipt_id",
  "kind",
  "realm_id",
  "deployment_generation",
  "participant_id",
  "process_generation",
  "operation_id",
  "intent_id",
  "owner_commit_id",
  "local_seq",
  "resource_binding_digest",
] as const;
const VARIANTS = {
  intent_created: ["capture_status"],
  intent_staged: ["capture_status", "storage_receipt_ids"],
  disk_stored: ["object_receipt", "storage_receipt_id"],
  product_committed: [
    "capture_status",
    "publication_id",
    "manifest_digest",
    "storage_receipt_ids",
  ],
  product_cancelled: ["capture_status"],
  link_repaired: [
    "committed_owner_outcome_id",
    "storage_receipt_id",
    "link_revision",
    "link_binding_digest",
  ],
  disk_cleaned: [
    "cancelled_owner_outcome_id",
    "cancellation",
    "cleaned_objects",
  ],
} as const;
type Kind = keyof typeof VARIANTS;
const EFFECTS: Record<Kind, PersonalAuthEffect> = {
  intent_created: "intent_create",
  intent_staged: "intent_stage",
  disk_stored: "disk_stage",
  product_committed: "product_publish",
  product_cancelled: "intent_cancel",
  link_repaired: "repair_link",
  disk_cleaned: "cleanup_cancelled",
};
const ALL_KEYS = [...COMMON, ...new Set(Object.values(VARIANTS).flat())];
const id = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length === 36 &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value);
const digest = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length === 64 &&
  /^[0-9a-f]{64}$/u.test(value);
function requireValue(value: unknown): asserts value {
  if (!value) throw new Error();
}
function storageIds(input: unknown, count: number): string[] {
  const values = snapshotArray(input, count, count);
  requireValue(values !== null && values.every(id));
  requireValue(new Set(values).size === count);
  return values;
}
function cleanedObjects(input: unknown): PersonalAuthCleanedObject[] {
  const values = snapshotArray(input, 1, 2);
  requireValue(values !== null);
  const objects = values.map((item) => {
    const value = snapshotRecord(item, [
      "part_id",
      "object_id",
      "object_revision",
    ]);
    requireValue(value !== null && Object.values(value).every(id));
    return value as unknown as PersonalAuthCleanedObject;
  });
  requireValue(new Set(objects.map((x) => x.part_id)).size === objects.length);
  requireValue(
    new Set(objects.map((x) => x.object_id)).size === objects.length,
  );
  return objects;
}

/**
 * Parse a detached closed envelope, composing the existing capture invariants.
 * No caller role, previous status, receipt-ID mapping or inventory is available:
 * this cannot authenticate an owner, prove a CAS, completeness of cleanup,
 * durable effects, referenced outcomes or settlement. Never log this envelope.
 */
export function parsePersonalAuthOwnerOutcome(
  input: unknown,
): ValidationResult<PersonalAuthOwnerOutcome> {
  try {
    const value = snapshotRecord(input, ALL_KEYS, false);
    requireValue(value !== null);
    const kind = value["kind"];
    requireValue(typeof kind === "string" && Object.hasOwn(VARIANTS, kind));
    const keys = [...COMMON, ...VARIANTS[kind as Kind]];
    requireValue(
      Object.keys(value).length === keys.length &&
        keys.every((key) => Object.hasOwn(value, key)),
    );
    requireValue(
      [
        "owner_receipt_id",
        "realm_id",
        "participant_id",
        "operation_id",
        "intent_id",
        "owner_commit_id",
      ].every((key) => id(value[key])),
    );
    requireValue(
      ["deployment_generation", "process_generation", "local_seq"].every(
        (key) => isPersonalAuthCounter(value[key]),
      ),
    );
    requireValue(digest(value["resource_binding_digest"]));
    if (Object.hasOwn(value, "capture_status")) {
      const status = parsePersonalCaptureStatus(value["capture_status"]);
      requireValue(status.ok);
      const expected = {
        intent_created: "awaiting_bytes",
        intent_staged: "staged",
        product_committed: "committed",
        product_cancelled: "cancelled",
      };
      requireValue(
        status.value.state === expected[kind as keyof typeof expected],
      );
      requireValue(
        status.value.descriptor.realmId === value["realm_id"] &&
          status.value.descriptor.captureId === value["intent_id"],
      );
      if (kind === "intent_created")
        requireValue(status.value.intentRevision === 1);
      if (
        status.value.state === "staged" ||
        status.value.state === "committed"
      ) {
        value["storage_receipt_ids"] = storageIds(
          value["storage_receipt_ids"],
          status.value.receipts.length,
        );
        if (status.value.state === "committed") {
          requireValue(
            value["publication_id"] === status.value.manifestId &&
              digest(value["manifest_digest"]),
          );
        }
      }
      value["capture_status"] = status.value;
    } else if (kind === "disk_stored") {
      const receipt = parsePersonalObjectReceipt(value["object_receipt"]);
      requireValue(receipt.ok && id(value["storage_receipt_id"]));
      requireValue(
        receipt.value.realmId === value["realm_id"] &&
          receipt.value.captureId === value["intent_id"],
      );
      value["object_receipt"] = receipt.value;
    } else if (kind === "link_repaired") {
      requireValue(
        id(value["committed_owner_outcome_id"]) &&
          id(value["storage_receipt_id"]) &&
          counter(value["link_revision"]) &&
          digest(value["link_binding_digest"]),
      );
    } else {
      requireValue(
        kind === "disk_cleaned" && id(value["cancelled_owner_outcome_id"]),
      );
      const cancellation = parsePersonalCaptureCancellation(
        value["cancellation"],
      );
      requireValue(cancellation.ok);
      requireValue(
        cancellation.value.realmId === value["realm_id"] &&
          cancellation.value.captureId === value["intent_id"],
      );
      value["cancellation"] = cancellation.value;
      value["cleaned_objects"] = cleanedObjects(value["cleaned_objects"]);
    }
    return { ok: true, value: value as unknown as PersonalAuthOwnerOutcome };
  } catch {
    return { ok: false, error: "invalid personal owner outcome" };
  }
}

/** Source effect spelling only; gives no permission to execute or settle it. */
export function personalAuthOwnerOutcomeEffect(
  input: unknown,
): ValidationResult<PersonalAuthEffect> {
  const parsed = parsePersonalAuthOwnerOutcome(input);
  return parsed.ok ? { ok: true, value: EFFECTS[parsed.value.kind] } : parsed;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return (
      "{" +
      Object.keys(record)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + canonical(record[key]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value);
}

/** Exact vector order is retained; no index uniqueness or retry admission proof. */
export function comparePersonalAuthOwnerOutcome(
  expected: unknown,
  received: unknown,
): "same_outcome" | "different_receipt" | "conflict" | "invalid" {
  const a = parsePersonalAuthOwnerOutcome(expected);
  const b = parsePersonalAuthOwnerOutcome(received);
  if (!a.ok || !b.ok) return "invalid";
  if (a.value.owner_receipt_id !== b.value.owner_receipt_id)
    return "different_receipt";
  return canonical(a.value) === canonical(b.value)
    ? "same_outcome"
    : "conflict";
}

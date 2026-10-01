import type { ValidationResult } from "./index.js";
import {
  comparePersonalCaptureRetry,
  parsePersonalCaptureDescriptor,
  parsePersonalCaptureStatus,
  type PersonalCaptureDescriptor,
  type PersonalCapturePart,
  type PersonalCaptureStatus,
} from "./personal-capture.js";
import { snapshotArray, snapshotRecord } from "./wire-snapshot.js";

/** Structural contract candidate; it enables no Auth route or runtime grant. */
export const PERSONAL_AUTH_WIRE_VERSION = "auth-personal/1-proposed" as const;
export const PERSONAL_AUTH_PROFILE = "organize-me.synthetic/1" as const;

export interface PersonalCaptureBinding {
  readonly descriptor: PersonalCaptureDescriptor;
  /** Null is prospective allocation, never evidence of a current intent. */
  readonly status: PersonalCaptureStatus | null;
}

/** Compose the existing capture parser without accepting two different intents. */
export function parsePersonalCaptureBinding(
  input: unknown,
): ValidationResult<PersonalCaptureBinding> {
  try {
    const value = snapshotRecord(input, ["descriptor", "status"]);
    if (value !== null) {
      const descriptor = parsePersonalCaptureDescriptor(value["descriptor"]);
      if (descriptor.ok) {
        if (value["status"] === null)
          return {
            ok: true,
            value: { descriptor: descriptor.value, status: null },
          };
        const status = parsePersonalCaptureStatus(value["status"]);
        if (
          status.ok &&
          comparePersonalCaptureRetry(
            descriptor.value,
            status.value.descriptor,
          ) === "same_intent"
        )
          return {
            ok: true,
            value: { descriptor: descriptor.value, status: status.value },
          };
      }
    }
  } catch {
    // Hostile non-JSON values produce the same non-disclosing refusal.
  }
  return { ok: false, error: "capture binding: invalid or mismatched intent" };
}

const PART_KEYS = [
  "part_id",
  "part_kind",
  "object_id",
  "object_revision",
  "sha256",
  "size_bytes",
  "media_type",
] as const;

function partMatches(input: unknown, part: PersonalCapturePart): boolean {
  const value = snapshotRecord(input, PART_KEYS);
  return (
    value !== null &&
    value["part_id"] === part.partId &&
    value["part_kind"] === part.role &&
    value["object_id"] === part.objectId &&
    value["object_revision"] === part.objectRevision &&
    value["sha256"] === part.sha256 &&
    value["size_bytes"] === part.sizeBytes &&
    value["media_type"] === part.mediaType
  );
}

/**
 * Exact structural binding for intent, part and terminal cancellation resources.
 * False includes unsupported resource kinds. True proves no current authority,
 * lease, authenticated owner outcome, durability or database CAS.
 */
export function personalCaptureResourceMatches(
  realmId: unknown,
  resource: unknown,
  binding: unknown,
): boolean {
  try {
    const parsed = parsePersonalCaptureBinding(binding);
    if (!parsed.ok || realmId !== parsed.value.descriptor.realmId) return false;
    const { descriptor: d, status } = parsed.value;
    // Snapshot the discriminant together with every possible member, once.
    const value = snapshotRecord(
      resource,
      [
        "kind",
        "intent_id",
        "intent_revision",
        "conversation_id",
        "message_id",
        "expected_conversation_revision",
        "parts",
        ...PART_KEYS,
        "terminal_intent_revision",
        "cancellation_generation",
        "owner_outcome_id",
        "part_ids",
        "cancellation",
      ],
      false,
    );
    if (value === null || value["intent_id"] !== d.captureId) return false;
    const kind = value["kind"];
    const keys =
      kind === "intent"
        ? [
            "kind",
            "intent_id",
            "intent_revision",
            "conversation_id",
            "message_id",
            "expected_conversation_revision",
            "parts",
          ]
        : kind === "part"
          ? ["kind", "intent_id", "intent_revision", ...PART_KEYS]
          : kind === "cancellation"
            ? [
                "kind",
                "intent_id",
                "terminal_intent_revision",
                "cancellation_generation",
                "owner_outcome_id",
                "part_ids",
                "cancellation",
              ]
            : null;
    if (
      keys === null ||
      Object.keys(value).length !== keys.length ||
      !keys.every((key) => Object.hasOwn(value, key))
    )
      return false;
    if (kind === "intent") {
      const parts = snapshotArray(
        value["parts"],
        d.parts.length,
        d.parts.length,
      );
      return (
        value["intent_revision"] ===
          (status === null ? null : status.intentRevision) &&
        value["conversation_id"] === d.conversationId &&
        value["message_id"] === d.messageId &&
        value["expected_conversation_revision"] ===
          d.expectedConversationRevision &&
        parts !== null &&
        parts.every((part, index) => partMatches(part, d.parts[index]!))
      );
    }
    if (kind === "part") {
      if (status === null || value["intent_revision"] !== status.intentRevision)
        return false;
      const part = d.parts.find((p) => p.partId === value["part_id"]);
      const selector = Object.fromEntries(
        PART_KEYS.map((key) => [key, value[key]]),
      );
      return part !== undefined && partMatches(selector, part);
    }
    if (status === null || status.state !== "cancelled") return false;
    const ids = snapshotArray(
      value["part_ids"],
      d.parts.length,
      d.parts.length,
    );
    const cancellation = snapshotRecord(value["cancellation"], [
      "schemaVersion",
      "purpose",
      "realmId",
      "captureId",
      "requestFingerprint",
      "intentRevision",
      "cancellationGeneration",
    ]);
    const outcome = value["owner_outcome_id"];
    return (
      value["terminal_intent_revision"] === status.intentRevision &&
      value["cancellation_generation"] ===
        status.cancellation.cancellationGeneration &&
      typeof outcome === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        outcome,
      ) &&
      ids !== null &&
      new Set(ids).size === ids.length &&
      ids.every((id) => d.parts.some((part) => part.partId === id)) &&
      cancellation !== null &&
      Object.entries(status.cancellation).every(
        ([key, expected]) => cancellation[key] === expected,
      )
    );
  } catch {
    return false;
  }
}

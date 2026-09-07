import type { ValidationResult } from "./index.js";

/** Structural wire profile only. Nothing here authenticates an authority. */
export const PERSONAL_CAPTURE_VERSION = "personal-capture/v1" as const;
export const PERSONAL_CAPTURE_LIMITS = {
  parts: 2,
  noteBytes: 64 * 1024,
  attachmentBytes: 1024 * 1024,
} as const;

export interface PersonalCapturePart {
  readonly partId: string;
  readonly role: "note" | "attachment";
  readonly objectId: string;
  readonly objectRevision: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly mediaType: "text/plain;charset=utf-8";
}

export interface PersonalCaptureDescriptor {
  readonly schemaVersion: typeof PERSONAL_CAPTURE_VERSION;
  readonly realmId: string;
  readonly captureId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly expectedConversationRevision: number;
  readonly operation: "append_message";
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly cancellationGeneration: number;
  /** Exactly one note first, optionally followed by one text attachment. */
  readonly parts: readonly PersonalCapturePart[];
}

/** A provider's assertion; parsing does not prove durable bytes or inventory. */
export interface PersonalObjectReceipt {
  readonly schemaVersion: typeof PERSONAL_CAPTURE_VERSION;
  readonly realmId: string;
  readonly captureId: string;
  readonly partId: string;
  readonly objectId: string;
  readonly objectRevision: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly mediaType: "text/plain;charset=utf-8";
  readonly requestFingerprint: string;
  readonly cancellationGeneration: number;
}

/** Wire record to authenticate against the owner before staging cleanup. */
export interface PersonalCaptureCancellation {
  readonly schemaVersion: typeof PERSONAL_CAPTURE_VERSION;
  readonly purpose: "cancel_unpublished_capture";
  readonly realmId: string;
  readonly captureId: string;
  readonly requestFingerprint: string;
  readonly intentRevision: number;
  readonly cancellationGeneration: number;
}

interface CaptureStatusBase {
  readonly schemaVersion: typeof PERSONAL_CAPTURE_VERSION;
  readonly descriptor: PersonalCaptureDescriptor;
  readonly intentRevision: number;
}

export type PersonalCaptureStatus = CaptureStatusBase &
  (
    | { readonly state: "awaiting_bytes" }
    | {
        readonly state: "staged";
        readonly receipts: readonly PersonalObjectReceipt[];
      }
    | {
        readonly state: "committed";
        readonly receipts: readonly PersonalObjectReceipt[];
        readonly manifestId: string;
        readonly conversationRevision: number;
      }
    | {
        readonly state: "cancelled";
        readonly cancellation: PersonalCaptureCancellation;
      }
  );

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const PART_KEYS = [
  "partId",
  "role",
  "objectId",
  "objectRevision",
  "sha256",
  "sizeBytes",
  "mediaType",
];
const DESCRIPTOR_KEYS = [
  "schemaVersion",
  "realmId",
  "captureId",
  "conversationId",
  "messageId",
  "expectedConversationRevision",
  "operation",
  "idempotencyKey",
  "requestFingerprint",
  "cancellationGeneration",
  "parts",
];
const RECEIPT_KEYS = [
  "schemaVersion",
  "realmId",
  "captureId",
  "partId",
  "objectId",
  "objectRevision",
  "sha256",
  "sizeBytes",
  "mediaType",
  "requestFingerprint",
  "cancellationGeneration",
];
const CANCELLATION_KEYS = [
  "schemaVersion",
  "purpose",
  "realmId",
  "captureId",
  "requestFingerprint",
  "intentRevision",
  "cancellationGeneration",
];

function fail(error: string): { readonly ok: false; readonly error: string } {
  return { ok: false, error };
}

/** Capture data descriptors once; never validate one value then return another. */
function snapshotRecord(
  value: unknown,
  keys: readonly string[],
  exact = true,
): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length > keys.length || (exact && ownKeys.length !== keys.length))
    return null;
  const snapshot: Record<string, unknown> = {};
  for (const key of ownKeys) {
    if (typeof key !== "string" || !keys.includes(key)) return null;
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (
      property === undefined ||
      !property.enumerable ||
      !Object.hasOwn(property, "value")
    )
      return null;
    snapshot[key] = property.value;
  }
  return snapshot;
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && value.length === 36 && UUID.test(value);
}

function digest(value: unknown): value is string {
  return typeof value === "string" && value.length === 64 && SHA256.test(value);
}

function snapshotArray(
  value: unknown,
  min: number,
  max: number,
): unknown[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    return null;
  const lengthProperty = Object.getOwnPropertyDescriptor(value, "length");
  if (lengthProperty === undefined || !Object.hasOwn(lengthProperty, "value"))
    return null;
  const length: unknown = lengthProperty.value;
  if (
    !counter(length, min) ||
    length > max ||
    Reflect.ownKeys(value).length !== length + 1
  )
    return null;
  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const item = Object.getOwnPropertyDescriptor(value, String(index));
    if (item === undefined || !Object.hasOwn(item, "value") || !item.enumerable)
      return null;
    snapshot.push(item.value);
  }
  return snapshot;
}

function counter(value: unknown, min = 0): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= min
  );
}

function content(value: Record<string, unknown>, max: number): boolean {
  return (
    uuid(value["partId"]) &&
    uuid(value["objectId"]) &&
    uuid(value["objectRevision"]) &&
    digest(value["sha256"]) &&
    counter(value["sizeBytes"]) &&
    value["sizeBytes"] <= max &&
    value["mediaType"] === "text/plain;charset=utf-8"
  );
}

function parseDescriptor(
  input: unknown,
): ValidationResult<PersonalCaptureDescriptor> {
  const value = snapshotRecord(input, DESCRIPTOR_KEYS);
  if (value === null) return fail("descriptor: invalid fields");
  if (
    value["schemaVersion"] !== PERSONAL_CAPTURE_VERSION ||
    value["operation"] !== "append_message"
  )
    return fail("descriptor: invalid profile or operation");
  for (const key of [
    "realmId",
    "captureId",
    "conversationId",
    "messageId",
    "idempotencyKey",
  ]) {
    if (!uuid(value[key])) return fail("descriptor: invalid identifier");
  }
  if (
    !digest(value["requestFingerprint"]) ||
    !counter(value["expectedConversationRevision"]) ||
    value["expectedConversationRevision"] === Number.MAX_SAFE_INTEGER ||
    !counter(value["cancellationGeneration"]) ||
    value["cancellationGeneration"] === Number.MAX_SAFE_INTEGER
  )
    return fail("descriptor: invalid fingerprint or counter");
  const raw = snapshotArray(value["parts"], 1, PERSONAL_CAPTURE_LIMITS.parts);
  if (raw === null) return fail("descriptor: invalid part count");
  const parts: PersonalCapturePart[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const part = snapshotRecord(raw[index], PART_KEYS);
    const role = index === 0 ? "note" : "attachment";
    const limit =
      index === 0
        ? PERSONAL_CAPTURE_LIMITS.noteBytes
        : PERSONAL_CAPTURE_LIMITS.attachmentBytes;
    if (part === null || part["role"] !== role || !content(part, limit))
      return fail("descriptor: invalid part");
    parts.push({ ...part } as unknown as PersonalCapturePart);
  }
  if (
    new Set(parts.map((p) => p.partId)).size !== parts.length ||
    new Set(parts.map((p) => p.objectId)).size !== parts.length
  )
    return fail("descriptor: duplicate part or object");
  return {
    ok: true,
    value: { ...value, parts } as unknown as PersonalCaptureDescriptor,
  };
}

function parseReceipt(input: unknown): ValidationResult<PersonalObjectReceipt> {
  const value = snapshotRecord(input, RECEIPT_KEYS);
  if (
    value === null ||
    value["schemaVersion"] !== PERSONAL_CAPTURE_VERSION ||
    !uuid(value["realmId"]) ||
    !uuid(value["captureId"]) ||
    !digest(value["requestFingerprint"]) ||
    !counter(value["cancellationGeneration"]) ||
    !content(value, PERSONAL_CAPTURE_LIMITS.attachmentBytes)
  )
    return fail("receipt: invalid record");
  return { ok: true, value: { ...value } as unknown as PersonalObjectReceipt };
}

function parseCancellation(
  input: unknown,
): ValidationResult<PersonalCaptureCancellation> {
  const value = snapshotRecord(input, CANCELLATION_KEYS);
  if (
    value === null ||
    value["schemaVersion"] !== PERSONAL_CAPTURE_VERSION ||
    value["purpose"] !== "cancel_unpublished_capture" ||
    !uuid(value["realmId"]) ||
    !uuid(value["captureId"]) ||
    !digest(value["requestFingerprint"]) ||
    !counter(value["intentRevision"], 1) ||
    !counter(value["cancellationGeneration"], 1)
  )
    return fail("cancellation: invalid record");
  return {
    ok: true,
    value: { ...value } as unknown as PersonalCaptureCancellation,
  };
}

/** Guard non-JSON JavaScript values too; error text never echoes private input. */
function safely<T>(parse: () => ValidationResult<T>): ValidationResult<T> {
  try {
    return parse();
  } catch {
    return fail("invalid wire value");
  }
}

export function parsePersonalCaptureDescriptor(
  value: unknown,
): ValidationResult<PersonalCaptureDescriptor> {
  return safely(() => parseDescriptor(value));
}

export function parsePersonalObjectReceipt(
  value: unknown,
): ValidationResult<PersonalObjectReceipt> {
  return safely(() => parseReceipt(value));
}

export function parsePersonalCaptureCancellation(
  value: unknown,
): ValidationResult<PersonalCaptureCancellation> {
  return safely(() => parseCancellation(value));
}

function receiptMatches(
  descriptor: PersonalCaptureDescriptor,
  receipt: PersonalObjectReceipt,
): boolean {
  const part = descriptor.parts.find((p) => p.partId === receipt.partId);
  return (
    part !== undefined &&
    receipt.realmId === descriptor.realmId &&
    receipt.captureId === descriptor.captureId &&
    receipt.requestFingerprint === descriptor.requestFingerprint &&
    receipt.cancellationGeneration === descriptor.cancellationGeneration &&
    part.objectId === receipt.objectId &&
    part.objectRevision === receipt.objectRevision &&
    part.sha256 === receipt.sha256 &&
    part.sizeBytes === receipt.sizeBytes &&
    part.mediaType === receipt.mediaType
  );
}

/** Matching is structural; require authenticated provider readback separately. */
export function personalObjectReceiptMatches(
  descriptor: unknown,
  receipt: unknown,
): boolean {
  const d = parsePersonalCaptureDescriptor(descriptor);
  const r = parsePersonalObjectReceipt(receipt);
  return d.ok && r.ok && receiptMatches(d.value, r.value);
}

function parseStatus(input: unknown): ValidationResult<PersonalCaptureStatus> {
  // Capture the discriminant and all possible fields in the same single pass.
  const baseKeys = ["schemaVersion", "descriptor", "intentRevision", "state"];
  const value = snapshotRecord(
    input,
    [
      ...baseKeys,
      "receipts",
      "manifestId",
      "conversationRevision",
      "cancellation",
    ],
    false,
  );
  if (value === null) return fail("status: invalid record");
  const state = value["state"];
  const extra =
    state === "awaiting_bytes"
      ? []
      : state === "staged"
        ? ["receipts"]
        : state === "committed"
          ? ["receipts", "manifestId", "conversationRevision"]
          : state === "cancelled"
            ? ["cancellation"]
            : null;
  if (
    extra === null ||
    Object.keys(value).length !== baseKeys.length + extra.length ||
    ![...baseKeys, ...extra].every((key) => Object.hasOwn(value, key)) ||
    value["schemaVersion"] !== PERSONAL_CAPTURE_VERSION ||
    !counter(value["intentRevision"], 1)
  )
    return fail("status: invalid fields or revision");
  const descriptor = parseDescriptor(value["descriptor"]);
  if (!descriptor.ok) return descriptor;
  const base = {
    schemaVersion: PERSONAL_CAPTURE_VERSION,
    descriptor: descriptor.value,
    intentRevision: value["intentRevision"],
  };
  if (state === "awaiting_bytes")
    return { ok: true, value: { ...base, state } };
  if (state === "cancelled") {
    const c = parseCancellation(value["cancellation"]);
    if (!c.ok) return c;
    if (
      c.value.realmId !== descriptor.value.realmId ||
      c.value.captureId !== descriptor.value.captureId ||
      c.value.requestFingerprint !== descriptor.value.requestFingerprint ||
      c.value.intentRevision !== base.intentRevision ||
      c.value.cancellationGeneration !==
        descriptor.value.cancellationGeneration + 1
    )
      return fail("status: cancellation mismatch");
    return { ok: true, value: { ...base, state, cancellation: c.value } };
  }
  const raw = snapshotArray(
    value["receipts"],
    descriptor.value.parts.length,
    descriptor.value.parts.length,
  );
  if (raw === null) return fail("status: incomplete receipts");
  const receipts: PersonalObjectReceipt[] = [];
  for (const item of raw) {
    const receipt = parseReceipt(item);
    if (!receipt.ok) return receipt;
    if (!receiptMatches(descriptor.value, receipt.value))
      return fail("status: receipt mismatch");
    receipts.push(receipt.value);
  }
  if (new Set(receipts.map((r) => r.partId)).size !== receipts.length)
    return fail("status: duplicate receipt");
  if (state === "staged")
    return { ok: true, value: { ...base, state, receipts } };
  if (
    !uuid(value["manifestId"]) ||
    value["conversationRevision"] !==
      descriptor.value.expectedConversationRevision + 1
  )
    return fail("status: invalid committed result");
  return {
    ok: true,
    value: {
      ...base,
      state: "committed",
      receipts,
      manifestId: value["manifestId"],
      conversationRevision: value["conversationRevision"] as number,
    },
  };
}

export function parsePersonalCaptureStatus(
  value: unknown,
): ValidationResult<PersonalCaptureStatus> {
  return safely(() => parseStatus(value));
}

/** SHA-256 the UTF-8 result at the trusted request boundary, then compare it. */
export function personalCaptureFingerprintInput(
  value: unknown,
): ValidationResult<string> {
  const parsed = parsePersonalCaptureDescriptor(value);
  if (!parsed.ok) return parsed;
  const d = parsed.value;
  return {
    ok: true,
    value: JSON.stringify([
      PERSONAL_CAPTURE_VERSION,
      d.realmId,
      d.operation,
      d.conversationId,
      d.expectedConversationRevision,
      d.parts.map((p) => [p.role, p.sha256, p.sizeBytes, p.mediaType]),
    ]),
  };
}

function descriptorIdentity(d: PersonalCaptureDescriptor): string {
  return JSON.stringify([
    d.schemaVersion,
    d.realmId,
    d.captureId,
    d.conversationId,
    d.messageId,
    d.expectedConversationRevision,
    d.operation,
    d.idempotencyKey,
    d.requestFingerprint,
    d.cancellationGeneration,
    d.parts.map((p) => [
      p.partId,
      p.role,
      p.objectId,
      p.objectRevision,
      p.sha256,
      p.sizeBytes,
      p.mediaType,
    ]),
  ]);
}

export type PersonalCaptureRetryDecision =
  | "same_intent"
  | "conflict"
  | "different_scope"
  | "invalid";

/** Never use a caller's claimed fingerprint alone to establish retry identity. */
export function comparePersonalCaptureRetry(
  existing: unknown,
  retry: unknown,
): PersonalCaptureRetryDecision {
  const a = parsePersonalCaptureDescriptor(existing);
  const b = parsePersonalCaptureDescriptor(retry);
  if (!a.ok || !b.ok) return "invalid";
  if (
    a.value.realmId !== b.value.realmId ||
    a.value.idempotencyKey !== b.value.idempotencyKey
  )
    return "different_scope";
  return descriptorIdentity(a.value) === descriptorIdentity(b.value)
    ? "same_intent"
    : "conflict";
}

export type PersonalCaptureTransitionDecision =
  | "eligible"
  | "invalid"
  | "intent_mismatch"
  | "revision_conflict"
  | "terminal"
  | "invalid_transition";

/** Pure CAS precondition check, not an atomic update, grant, or publication. */
export function evaluatePersonalCaptureTransition(
  current: unknown,
  proposed: unknown,
  expectedRevision: number,
): PersonalCaptureTransitionDecision {
  const a = parsePersonalCaptureStatus(current);
  const b = parsePersonalCaptureStatus(proposed);
  if (!a.ok || !b.ok || !counter(expectedRevision, 1)) return "invalid";
  if (
    descriptorIdentity(a.value.descriptor) !==
    descriptorIdentity(b.value.descriptor)
  )
    return "intent_mismatch";
  if (
    a.value.intentRevision !== expectedRevision ||
    expectedRevision === Number.MAX_SAFE_INTEGER ||
    b.value.intentRevision !== expectedRevision + 1
  )
    return "revision_conflict";
  if (a.value.state === "cancelled" || a.value.state === "committed")
    return "terminal";
  if (
    b.value.state === "cancelled" ||
    (a.value.state === "awaiting_bytes" && b.value.state === "staged") ||
    (a.value.state === "staged" && b.value.state === "committed")
  )
    return "eligible";
  return "invalid_transition";
}

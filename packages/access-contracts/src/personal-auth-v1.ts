import type { ValidationResult } from "./index.js";
import {
  parsePersonalCaptureDescriptor,
  parsePersonalCaptureStatus,
  type PersonalCaptureDescriptor,
  type PersonalCaptureStatus,
} from "./personal-capture.js";
import { parsePersonalAuthJson } from "./personal-auth-json.js";

/** Proposed structural slice only: parsing/comparison never authenticates or grants access. */
export const PERSONAL_AUTH_WIRE_VERSION = "auth-personal/1-proposed" as const;
export const PERSONAL_AUTH_PROFILE = "organize-me.synthetic/1" as const;
export const PERSONAL_AUTH_SELECTED_LIMITS = Object.freeze({
  activeFlows: 1,
  waitingFlows: 0,
  ordinaryLeasesPerFlow: 3,
  unresolvedLeaseCeiling: 8,
  uploadCeiling: 2,
  readCeiling: 4,
});
export interface PersonalAuthParticipant {
  participant_id: string;
  role: "product" | "disk";
  process_generation: string;
  boot_id: string;
  deployment_generation: string;
}
export type PersonalAuthSession =
  | { kind: "paseto"; session_id: string }
  | {
      kind: "oidc";
      session_uid: string;
      client_id: string;
      client_sid: string;
      grant_id: string;
    };
export interface PersonalAuthPart {
  part_id: string;
  part_kind: "note" | "attachment";
  object_id: string;
  object_revision: string;
  sha256: string;
  size_bytes: number;
  media_type: "text/plain;charset=utf-8";
}
export interface PersonalAuthIntentResource {
  kind: "intent";
  intent_id: string;
  intent_revision: number | null;
  conversation_id: string;
  message_id: string;
  expected_conversation_revision: number;
  parts: PersonalAuthPart[];
}
export interface PersonalAuthCaptureBinding {
  descriptor: PersonalCaptureDescriptor;
  status: PersonalCaptureStatus | null;
}
export interface PersonalAuthOperationRequest {
  wire_version: typeof PERSONAL_AUTH_WIRE_VERSION;
  profile_id: typeof PERSONAL_AUTH_PROFILE;
  request_id: string;
  idempotency_key: string;
  operation_id: string;
  authority_kind: "person";
  person_proof: { kind: "oidc_access_token" | "paseto_session"; token: string };
  operation: "intent.create" | "capture.stage";
  purpose: "personal.capture" | "personal.resume";
  resource: PersonalAuthIntentResource;
  capture_binding: PersonalAuthCaptureBinding;
  participant: PersonalAuthParticipant;
  expected_realm_id?: string;
}
/** Local comparison projection of Auth-owned records, NOT a new provisioning endpoint. */
export interface PersonalAuthBindingContext {
  issuer: string;
  subject: string;
  session: PersonalAuthSession;
  authority_ref: string;
  authority_version: string;
  actor_client_id: string;
  consumer_client_id: string;
  realm_id: string;
  realm_binding_version: string;
  policy_version: string;
  policy_epoch: string;
  deployment_generation: string;
  participant_config_version: string;
  participant: PersonalAuthParticipant;
  provisioning: {
    realm_id: string;
    product_client_id: string;
    disk_client_id: string;
    product_participant_id: string;
    disk_participant_id: string;
    deployment_generation: string;
    participant_config_version: string;
  };
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const id = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const opaque = (v: unknown, max = 256): v is string =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= max &&
  /^[\x21-\x7e]+$/u.test(v);
export function isPersonalAuthCounter(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^(?:0|[1-9][0-9]{0,19})$/u.test(v) &&
    BigInt(v) <= 18_446_744_073_709_551_615n
  );
}
function owner(v: unknown, minimum = 0): v is number {
  return (
    typeof v === "number" &&
    Number.isSafeInteger(v) &&
    !Object.is(v, -0) &&
    v >= minimum &&
    v < Number.MAX_SAFE_INTEGER
  );
}
function record(
  v: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
  if (![Object.prototype, null].includes(Object.getPrototypeOf(v)))
    throw new Error();
  const properties = Object.getOwnPropertyDescriptors(v);
  const keys = Reflect.ownKeys(v);
  if (
    keys.some(
      (k) => typeof k !== "string" || ![...required, ...optional].includes(k),
    ) ||
    required.some((k) => !Object.hasOwn(properties, k))
  )
    throw new Error();
  const result: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const key of Object.keys(properties)) {
    const property = properties[key]!;
    if (!property.enumerable || !Object.hasOwn(property, "value"))
      throw new Error();
    result[key] = property.value as unknown;
  }
  return result;
}
function safely<T>(work: () => T): ValidationResult<T> {
  try {
    return { ok: true, value: work() };
  } catch {
    return { ok: false, error: "invalid personal wire or binding" };
  }
}
function requireValue(condition: unknown): asserts condition {
  if (!condition) throw new Error();
}
function participant(input: unknown): PersonalAuthParticipant {
  const v = record(input, [
    "participant_id",
    "role",
    "process_generation",
    "boot_id",
    "deployment_generation",
  ]);
  requireValue(
    id(v.participant_id) &&
      id(v.boot_id) &&
      (v.role === "product" || v.role === "disk") &&
      isPersonalAuthCounter(v.process_generation) &&
      isPersonalAuthCounter(v.deployment_generation),
  );
  return v as unknown as PersonalAuthParticipant;
}
export function parsePersonalAuthParticipant(
  input: unknown,
): ValidationResult<PersonalAuthParticipant> {
  return safely(() => participant(input));
}
function session(input: unknown): PersonalAuthSession {
  const tag = record(
    input,
    ["kind"],
    ["session_id", "session_uid", "client_id", "client_sid", "grant_id"],
  );
  if (tag.kind === "paseto") {
    const v = record(input, ["kind", "session_id"]);
    requireValue(id(v.session_id));
    return v as unknown as PersonalAuthSession;
  }
  const v = record(input, [
    "kind",
    "session_uid",
    "client_id",
    "client_sid",
    "grant_id",
  ]);
  requireValue(
    v.kind === "oidc" &&
      [v.session_uid, v.client_id, v.client_sid, v.grant_id].every((x) =>
        opaque(x),
      ),
  );
  return v as unknown as PersonalAuthSession;
}
function part(input: unknown): PersonalAuthPart {
  const v = record(input, [
    "part_id",
    "part_kind",
    "object_id",
    "object_revision",
    "sha256",
    "size_bytes",
    "media_type",
  ]);
  requireValue(
    id(v.part_id) &&
      id(v.object_id) &&
      id(v.object_revision) &&
      (v.part_kind === "note" || v.part_kind === "attachment") &&
      typeof v.sha256 === "string" &&
      DIGEST.test(v.sha256) &&
      owner(v.size_bytes) &&
      v.size_bytes <= (v.part_kind === "note" ? 65_536 : 1_048_576) &&
      v.media_type === "text/plain;charset=utf-8",
  );
  return v as unknown as PersonalAuthPart;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error();
  return encoded;
}
function canonicalNumbers(value: unknown): void {
  if (typeof value === "number")
    requireValue(
      Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0),
    );
  else if (Array.isArray(value)) value.forEach(canonicalNumbers);
  else if (value !== null && typeof value === "object")
    Object.values(value).forEach(canonicalNumbers);
}
function operation(input: unknown): PersonalAuthOperationRequest {
  const v = record(
    input,
    [
      "wire_version",
      "profile_id",
      "request_id",
      "idempotency_key",
      "operation_id",
      "authority_kind",
      "person_proof",
      "operation",
      "purpose",
      "resource",
      "capture_binding",
      "participant",
    ],
    ["expected_realm_id"],
  );
  requireValue(
    v.wire_version === PERSONAL_AUTH_WIRE_VERSION &&
      v.profile_id === PERSONAL_AUTH_PROFILE &&
      id(v.request_id) &&
      id(v.idempotency_key) &&
      id(v.operation_id) &&
      v.authority_kind === "person" &&
      (v.operation === "intent.create" || v.operation === "capture.stage") &&
      (v.purpose === "personal.capture" || v.purpose === "personal.resume"),
  );
  if (Object.hasOwn(v, "expected_realm_id"))
    requireValue(id(v.expected_realm_id));
  const proof = record(v.person_proof, ["kind", "token"]);
  requireValue(
    (proof.kind === "oidc_access_token" || proof.kind === "paseto_session") &&
      opaque(proof.token, 16_384),
  );
  const actor = participant(v.participant);
  requireValue(actor.role === "product");
  const binding = record(v.capture_binding, ["descriptor", "status"]);
  const descriptor = parsePersonalCaptureDescriptor(binding.descriptor);
  requireValue(descriptor.ok);
  canonicalNumbers(descriptor.value);
  let status: PersonalCaptureStatus | null = null;
  if (binding.status !== null) {
    const parsed = parsePersonalCaptureStatus(binding.status);
    requireValue(parsed.ok);
    status = parsed.value;
    canonicalNumbers(status);
    requireValue(canonical(status.descriptor) === canonical(descriptor.value));
  }
  requireValue(
    v.operation === "intent.create"
      ? status === null
      : status !== null && status.state === "awaiting_bytes",
  );
  const resource = record(v.resource, [
    "kind",
    "intent_id",
    "intent_revision",
    "conversation_id",
    "message_id",
    "expected_conversation_revision",
    "parts",
  ]);
  requireValue(
    resource.kind === "intent" &&
      Array.isArray(resource.parts) &&
      resource.parts.length >= 1 &&
      resource.parts.length <= 2,
  );
  const parts = resource.parts.map(part);
  const d = descriptor.value;
  requireValue(
    resource.intent_id === d.captureId &&
      resource.conversation_id === d.conversationId &&
      resource.message_id === d.messageId &&
      resource.expected_conversation_revision ===
        d.expectedConversationRevision &&
      owner(resource.expected_conversation_revision),
  );
  requireValue(
    status === null
      ? resource.intent_revision === null
      : resource.intent_revision === status.intentRevision &&
          owner(resource.intent_revision, 1),
  );
  requireValue(
    parts.length === d.parts.length &&
      parts.every((p, i) => {
        const q = d.parts[i]!;
        return (
          p.part_id === q.partId &&
          p.part_kind === q.role &&
          p.object_id === q.objectId &&
          p.object_revision === q.objectRevision &&
          p.sha256 === q.sha256 &&
          p.size_bytes === q.sizeBytes &&
          p.media_type === q.mediaType
        );
      }),
  );
  if (v.expected_realm_id !== undefined)
    requireValue(v.expected_realm_id === d.realmId);
  return {
    ...v,
    person_proof: proof,
    participant: actor,
    resource: { ...resource, parts },
    capture_binding: { descriptor: d, status },
  } as unknown as PersonalAuthOperationRequest;
}
export function parsePersonalAuthOperation(
  input: unknown,
): ValidationResult<PersonalAuthOperationRequest> {
  return safely(() => operation(input));
}
export function parsePersonalAuthOperationJson(
  input: unknown,
): ValidationResult<PersonalAuthOperationRequest> {
  const parsed = parsePersonalAuthJson(input);
  return parsed.ok ? parsePersonalAuthOperation(parsed.value) : parsed;
}
function context(input: unknown): PersonalAuthBindingContext {
  const v = record(input, [
    "issuer",
    "subject",
    "session",
    "authority_ref",
    "authority_version",
    "actor_client_id",
    "consumer_client_id",
    "realm_id",
    "realm_binding_version",
    "policy_version",
    "policy_epoch",
    "deployment_generation",
    "participant_config_version",
    "participant",
    "provisioning",
  ]);
  requireValue(opaque(v.issuer, 2048));
  const issuer = new URL(v.issuer);
  requireValue(
    issuer.protocol === "https:" &&
      (issuer.href === v.issuer || issuer.href === v.issuer + "/") &&
      !issuer.username &&
      !issuer.password &&
      !issuer.search &&
      !issuer.hash,
  );
  requireValue(
    [v.subject, v.authority_ref, v.realm_id].every(id) &&
      [v.actor_client_id, v.consumer_client_id, v.policy_version].every((x) =>
        opaque(x),
      ) &&
      [
        v.authority_version,
        v.realm_binding_version,
        v.policy_epoch,
        v.deployment_generation,
        v.participant_config_version,
      ].every(isPersonalAuthCounter),
  );
  const p = record(v.provisioning, [
    "realm_id",
    "product_client_id",
    "disk_client_id",
    "product_participant_id",
    "disk_participant_id",
    "deployment_generation",
    "participant_config_version",
  ]);
  requireValue(
    [p.realm_id, p.product_participant_id, p.disk_participant_id].every(id) &&
      [p.product_client_id, p.disk_client_id].every((x) => opaque(x)) &&
      p.product_client_id !== p.disk_client_id &&
      p.product_participant_id !== p.disk_participant_id &&
      [p.deployment_generation, p.participant_config_version].every(
        isPersonalAuthCounter,
      ),
  );
  const actor = participant(v.participant);
  const source = session(v.session);
  requireValue(
    actor.role === "product" &&
      actor.participant_id === p.product_participant_id &&
      v.actor_client_id === p.product_client_id &&
      v.consumer_client_id === p.product_client_id &&
      v.realm_id === p.realm_id &&
      v.deployment_generation === p.deployment_generation &&
      actor.deployment_generation === p.deployment_generation &&
      v.participant_config_version === p.participant_config_version,
  );
  return {
    ...v,
    session: source,
    participant: actor,
    provisioning: p,
  } as unknown as PersonalAuthBindingContext;
}
export function parsePersonalAuthBindingContext(
  input: unknown,
): ValidationResult<PersonalAuthBindingContext> {
  return safely(() => context(input));
}
function bound(
  request: PersonalAuthOperationRequest,
  binding: PersonalAuthBindingContext,
): void {
  requireValue(
    request.capture_binding.descriptor.realmId === binding.realm_id &&
      canonical(request.participant) === canonical(binding.participant),
  );
  requireValue(
    request.person_proof.kind === "paseto_session"
      ? binding.session.kind === "paseto"
      : binding.session.kind === "oidc",
  );
}
/** Structural consistency only. Context must come from authenticated durable Auth reads. */
export function personalAuthOperationMatchesBinding(
  request: unknown,
  binding: unknown,
): boolean {
  return safely(() => {
    bound(operation(request), context(binding));
    return true;
  }).ok;
}
/** JCS input for this restricted integer/string profile; caller hashes UTF-8 with SHA-256.
 * It contains private descriptors: never log it. No raw proof or transport request ID.
 */
export function personalAuthOperationFingerprintInput(
  request: unknown,
  binding: unknown,
): ValidationResult<string> {
  return safely(() => {
    const r = operation(request);
    const c = context(binding);
    bound(r, c);
    return canonical({
      wire_version: r.wire_version,
      profile_id: r.profile_id,
      operation_id: r.operation_id,
      authority_kind: r.authority_kind,
      operation: r.operation,
      purpose: r.purpose,
      resource: r.resource,
      capture_binding: r.capture_binding,
      authority: c,
    });
  });
}
export function personalAuthMutationIdentity(
  request: unknown,
  binding: unknown,
): ValidationResult<string> {
  return safely(() => {
    const r = operation(request);
    const c = context(binding);
    bound(r, c);
    return canonical([
      c.issuer,
      c.actor_client_id,
      c.realm_id,
      "operations",
      r.idempotency_key,
    ]);
  });
}
export function comparePersonalAuthOperationRetry(
  first: unknown,
  firstBinding: unknown,
  retry: unknown,
  currentBinding: unknown,
): "same_semantics" | "conflict" | "invalid" {
  const a = personalAuthOperationFingerprintInput(first, firstBinding);
  const b = personalAuthOperationFingerprintInput(retry, currentBinding);
  const ka = personalAuthMutationIdentity(first, firstBinding);
  const kb = personalAuthMutationIdentity(retry, currentBinding);
  if (!a.ok || !b.ok || !ka.ok || !kb.ok) return "invalid";
  return ka.value === kb.value && a.value === b.value
    ? "same_semantics"
    : "conflict";
}

export function incrementPersonalAuthCounter(
  value: unknown,
): ValidationResult<string> {
  return safely(() => {
    requireValue(
      isPersonalAuthCounter(value) && value !== "18446744073709551615",
    );
    return (BigInt(value) + 1n).toString();
  });
}

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  parsePersonalAuthOperationJson,
  parsePersonalAuthOperation,
  parsePersonalAuthJson,
  isPersonalAuthCounter,
  incrementPersonalAuthCounter,
  parsePersonalAuthBindingContext,
  personalAuthOperationMatchesBinding,
  comparePersonalAuthOperationRetry,
  personalAuthOperationFingerprintInput,
  personalAuthMutationIdentity,
  type PersonalAuthOperationRequest,
  type PersonalAuthBindingContext,
} from "../src/index.js";
const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
function fixture(): {
  request: PersonalAuthOperationRequest;
  context: PersonalAuthBindingContext;
} {
  const participant = {
    participant_id: id(10),
    role: "product" as const,
    process_generation: "1",
    boot_id: id(11),
    deployment_generation: "2",
  };
  const descriptor = {
    schemaVersion: "personal-capture/v1" as const,
    realmId: id(1),
    captureId: id(2),
    conversationId: id(3),
    messageId: id(4),
    expectedConversationRevision: 0,
    operation: "append_message" as const,
    idempotencyKey: id(5),
    requestFingerprint: "a".repeat(64),
    cancellationGeneration: 0,
    parts: [
      {
        partId: id(6),
        role: "note" as const,
        objectId: id(7),
        objectRevision: id(8),
        sha256: createHash("sha256").update("").digest("hex"),
        sizeBytes: 0,
        mediaType: "text/plain;charset=utf-8" as const,
      },
    ],
  };
  const p = descriptor.parts[0]!;
  return {
    request: {
      wire_version: "auth-personal/1-proposed",
      profile_id: "organize-me.synthetic/1",
      request_id: id(12),
      idempotency_key: id(13),
      operation_id: id(14),
      authority_kind: "person",
      person_proof: {
        kind: "oidc_access_token",
        token: "synthetic.access.token",
      },
      operation: "intent.create",
      purpose: "personal.capture",
      resource: {
        kind: "intent",
        intent_id: id(2),
        intent_revision: null,
        conversation_id: id(3),
        message_id: id(4),
        expected_conversation_revision: 0,
        parts: [
          {
            part_id: p.partId,
            part_kind: p.role,
            object_id: p.objectId,
            object_revision: p.objectRevision,
            sha256: p.sha256,
            size_bytes: p.sizeBytes,
            media_type: p.mediaType,
          },
        ],
      },
      capture_binding: { descriptor, status: null },
      participant,
    },
    context: {
      issuer: "https://auth.arcanada.ai",
      subject: id(15),
      session: {
        kind: "oidc",
        session_uid: "uid-not-sid",
        client_id: "browser-client",
        client_sid: "sid-not-uid",
        grant_id: "grant",
      },
      authority_ref: id(16),
      authority_version: "1",
      actor_client_id: "product-a",
      consumer_client_id: "product-a",
      realm_id: id(1),
      realm_binding_version: "1",
      policy_version: "synthetic-v1",
      policy_epoch: "2",
      deployment_generation: "2",
      participant_config_version: "1",
      participant,
      provisioning: {
        realm_id: id(1),
        product_client_id: "product-a",
        disk_client_id: "disk-a",
        product_participant_id: id(10),
        disk_participant_id: id(17),
        deployment_generation: "2",
        participant_config_version: "1",
      },
    },
  };
}
describe("proposed Auth operation structural slice", () => {
  it("parses a prospective intent, empty note and separately bound context without granting authority", () => {
    const { request, context } = fixture();
    expect(parsePersonalAuthOperationJson(JSON.stringify(request)).ok).toBe(
      true,
    );
    expect(parsePersonalAuthBindingContext(context).ok).toBe(true);
    expect(personalAuthOperationMatchesBinding(request, context)).toBe(true);
    expect(personalAuthMutationIdentity(request, context)).toEqual({
      ok: true,
      value: JSON.stringify([
        context.issuer,
        "product-a",
        id(1),
        "operations",
        id(13),
      ]),
    });
  });
  it("requires authenticated current allocated status for stage and exact dual mapping", () => {
    const { request } = fixture();
    request.operation = "capture.stage";
    expect(parsePersonalAuthOperation(request).ok).toBe(false);
    request.capture_binding.status = {
      schemaVersion: "personal-capture/v1",
      descriptor: structuredClone(request.capture_binding.descriptor),
      intentRevision: 1,
      state: "awaiting_bytes",
    };
    request.resource.intent_revision = 1;
    expect(parsePersonalAuthOperation(request).ok).toBe(true);
    request.capture_binding.status.descriptor.messageId = id(90);
    expect(parsePersonalAuthOperation(request).ok).toBe(false);
  });
  for (const field of ["intent_id", "conversation_id", "message_id"] as const)
    it(`rejects substituted ${field}`, () => {
      const { request } = fixture();
      request.resource[field] = id(90);
      expect(parsePersonalAuthOperation(request).ok).toBe(false);
    });
  for (const field of [
    "part_id",
    "object_id",
    "object_revision",
    "sha256",
  ] as const)
    it(`rejects substituted part ${field}`, () => {
      const { request } = fixture();
      request.resource.parts[0]![field] =
        field === "sha256" ? "b".repeat(64) : id(90);
      expect(parsePersonalAuthOperation(request).ok).toBe(false);
    });
  for (const field of [
    "realm_id",
    "actor_client_id",
    "consumer_client_id",
    "deployment_generation",
    "participant_config_version",
  ] as const)
    it(`rejects mismatched provision ${field}`, () => {
      const { request, context } = fixture();
      context[field] = field === "realm_id" ? id(99) : "3";
      expect(personalAuthOperationMatchesBinding(request, context)).toBe(false);
    });
  it("checks process generation and boot identity independently", () => {
    const { request, context } = fixture();
    const changed = structuredClone(request);
    changed.participant.boot_id = id(91);
    expect(personalAuthOperationMatchesBinding(changed, context)).toBe(false);
    changed.participant.boot_id = request.participant.boot_id;
    changed.participant.process_generation = "2";
    expect(personalAuthOperationMatchesBinding(changed, context)).toBe(false);
  });
  it("does not accept identity flags, ID token kind, maintenance, Disk actor or unimplemented operations", () => {
    const { request } = fixture();
    for (const mutation of [
      { verified: true },
      { authority_kind: "maintenance" },
      { operation: "capture.publish" },
      { person_proof: { kind: "id_token", token: "synthetic" } },
      { participant: { ...request.participant, role: "disk" } },
    ])
      expect(parsePersonalAuthOperation({ ...request, ...mutation }).ok).toBe(
        false,
      );
  });
  it("rejects unknown nested fields and numeric Auth counters", () => {
    const { request, context } = fixture();
    expect(
      parsePersonalAuthOperation({
        ...request,
        person_proof: { ...request.person_proof, verified: true },
      }).ok,
    ).toBe(false);
    expect(
      parsePersonalAuthBindingContext({ ...context, authority_version: 1 }).ok,
    ).toBe(false);
    expect(
      parsePersonalAuthBindingContext({
        ...context,
        provisioning: { ...context.provisioning, admin: true },
      }).ok,
    ).toBe(false);
  });
  it("rejects unavailable/unknown wire versions and profile", () => {
    const { request } = fixture();
    for (const mutation of [
      { wire_version: "auth-personal/1" },
      { profile_id: "production" },
      { expected_realm_id: id(90) },
    ])
      expect(parsePersonalAuthOperation({ ...request, ...mutation }).ok).toBe(
        false,
      );
  });
  it("does not invoke a getter as proof", () => {
    const { request } = fixture();
    let calls = 0;
    Object.defineProperty(request, "person_proof", {
      enumerable: true,
      get() {
        calls++;
        return { kind: "oidc_access_token", token: "x" };
      },
    });
    expect(parsePersonalAuthOperation(request).ok).toBe(false);
    expect(calls).toBe(0);
  });
  it("keeps tokens and request IDs out of fingerprints but not authority identity", () => {
    const { request, context } = fixture();
    const retry = structuredClone(request);
    retry.request_id = id(80);
    retry.person_proof.token = "refreshed.secret";
    expect(
      comparePersonalAuthOperationRetry(request, context, retry, context),
    ).toBe("same_semantics");
    const fingerprint = personalAuthOperationFingerprintInput(request, context);
    expect(fingerprint.ok).toBe(true);
    if (fingerprint.ok) {
      expect(fingerprint.value).not.toContain(request.person_proof.token);
      expect(fingerprint.value).not.toContain(request.request_id);
    }
    for (const patch of [
      { issuer: "https://auth.arcanada.one" },
      { authority_version: "2" },
      { subject: id(99) },
      { session: { ...context.session, session_uid: "different" } },
    ])
      expect(
        comparePersonalAuthOperationRetry(request, context, retry, {
          ...context,
          ...patch,
        }),
      ).toBe("conflict");
  });
  it("conflicts on changed allocation even with same claimed Product fingerprint", () => {
    const { request, context } = fixture();
    const retry = structuredClone(request);
    retry.capture_binding.descriptor.messageId = id(81);
    retry.resource.message_id = id(81);
    expect(
      comparePersonalAuthOperationRetry(request, context, retry, context),
    ).toBe("conflict");
  });
  it("does not mix OIDC and PASETO sessions", () => {
    const { request, context } = fixture();
    context.session = { kind: "paseto", session_id: id(21) };
    expect(personalAuthOperationMatchesBinding(request, context)).toBe(false);
    request.person_proof.kind = "paseto_session";
    expect(personalAuthOperationMatchesBinding(request, context)).toBe(true);
    expect(
      parsePersonalAuthBindingContext({
        ...context,
        session: { ...context.session, session_uid: "extra" },
      }).ok,
    ).toBe(false);
  });
  it.each([
    "00",
    "01",
    "+1",
    "-1",
    "1.0",
    "1e0",
    "18446744073709551616",
    1,
    null,
  ])("rejects invalid counter %s", (value) =>
    expect(isPersonalAuthCounter(value)).toBe(false),
  );
  it("handles uint64 boundaries without precision loss or wrap", () => {
    expect(isPersonalAuthCounter("18446744073709551615")).toBe(true);
    expect(incrementPersonalAuthCounter("18446744073709551614")).toEqual({
      ok: true,
      value: "18446744073709551615",
    });
    expect(incrementPersonalAuthCounter("18446744073709551615").ok).toBe(false);
  });
  it.each([
    '{"a":1,"a":2}',
    '{"a":1,"\\u0061":2}',
    '{"a":-0}',
    '{"a":1e0}',
    '{"a":1.0}',
    '{"a":9007199254740992}',
    '{"a":"\\ud800"}',
    '{"a":1,}',
    '{"a":01}',
  ])("rejects ambiguous raw JSON %s", (value) =>
    expect(parsePersonalAuthJson(value).ok).toBe(false),
  );
  it("rejects oversized/deep raw JSON", () => {
    expect(parsePersonalAuthJson('"' + "a".repeat(65536) + '"').ok).toBe(false);
    expect(
      parsePersonalAuthJson("[".repeat(30) + "0" + "]".repeat(30)).ok,
    ).toBe(false);
  });
});

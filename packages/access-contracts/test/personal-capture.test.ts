import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PERSONAL_CAPTURE_VERSION,
  comparePersonalCaptureRetry,
  evaluatePersonalCaptureTransition,
  parsePersonalCaptureCancellation,
  parsePersonalCaptureDescriptor,
  parsePersonalCaptureStatus,
  parsePersonalObjectReceipt,
  personalCaptureFingerprintInput,
  personalObjectReceiptMatches,
  type PersonalCaptureDescriptor,
  type PersonalObjectReceipt,
} from "../src/index.js";

const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const hash = (body: string) =>
  createHash("sha256").update(body, "utf8").digest("hex");

function changingProxy<T extends object>(
  target: T,
  key: string,
  changed: unknown,
) {
  const counts = { gets: 0, descriptors: 0 };
  const value = new Proxy(target, {
    get(object, property, receiver) {
      counts.gets += 1;
      return property === key && counts.gets > 1
        ? changed
        : Reflect.get(object, property, receiver);
    },
    getOwnPropertyDescriptor(object, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(object, property);
      if (property !== key || descriptor === undefined) return descriptor;
      counts.descriptors += 1;
      return counts.descriptors === 1
        ? descriptor
        : { ...descriptor, value: changed };
    },
  });
  return { value, counts };
}

function descriptor(): PersonalCaptureDescriptor {
  const d: PersonalCaptureDescriptor = {
    schemaVersion: PERSONAL_CAPTURE_VERSION,
    realmId: id(1),
    captureId: id(2),
    conversationId: id(3),
    messageId: id(4),
    expectedConversationRevision: 0,
    operation: "append_message",
    idempotencyKey: id(5),
    requestFingerprint: "a".repeat(64),
    cancellationGeneration: 0,
    parts: [
      {
        partId: id(6),
        role: "note",
        objectId: id(7),
        objectRevision: id(8),
        sha256: hash("note\n"),
        sizeBytes: 5,
        mediaType: "text/plain;charset=utf-8",
      },
      {
        partId: id(9),
        role: "attachment",
        objectId: id(10),
        objectRevision: id(11),
        sha256: hash("A".repeat(4096)),
        sizeBytes: 4096,
        mediaType: "text/plain;charset=utf-8",
      },
    ],
  };
  const input = personalCaptureFingerprintInput(d);
  if (!input.ok) throw new Error(input.error);
  return { ...d, requestFingerprint: hash(input.value) };
}

function receipts(d = descriptor()): PersonalObjectReceipt[] {
  return d.parts.map(({ role: _role, ...part }) => ({
    schemaVersion: PERSONAL_CAPTURE_VERSION,
    realmId: d.realmId,
    captureId: d.captureId,
    requestFingerprint: d.requestFingerprint,
    cancellationGeneration: d.cancellationGeneration,
    ...part,
  }));
}

function status(
  state: "awaiting_bytes" | "staged" | "committed" | "cancelled",
  intentRevision = 1,
) {
  const d = descriptor();
  const base = {
    schemaVersion: PERSONAL_CAPTURE_VERSION,
    descriptor: d,
    intentRevision,
    state,
  };
  if (state === "awaiting_bytes") return base;
  if (state === "cancelled")
    return {
      ...base,
      cancellation: {
        schemaVersion: PERSONAL_CAPTURE_VERSION,
        purpose: "cancel_unpublished_capture",
        realmId: d.realmId,
        captureId: d.captureId,
        requestFingerprint: d.requestFingerprint,
        intentRevision,
        cancellationGeneration: 1,
      },
    };
  if (state === "staged") return { ...base, receipts: receipts(d) };
  return {
    ...base,
    receipts: receipts(d),
    manifestId: id(12),
    conversationRevision: 1,
  };
}

describe("personal capture wire parsing", () => {
  it("accepts all four explicit states and detached descriptor snapshots", () => {
    for (const state of [
      "awaiting_bytes",
      "staged",
      "committed",
      "cancelled",
    ] as const) {
      expect(parsePersonalCaptureStatus(status(state)).ok).toBe(true);
    }
    const raw = descriptor();
    const parsed = parsePersonalCaptureDescriptor(raw);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).toEqual(raw);
      expect(parsed.value).not.toBe(raw);
      expect(parsed.value.parts[0]).not.toBe(raw.parts[0]);
    }
  });

  it.each([null, [], "capture", {}, { schemaVersion: "personal-capture/v2" }])(
    "rejects malformed descriptor %j",
    (raw) => {
      expect(parsePersonalCaptureDescriptor(raw).ok).toBe(false);
    },
  );

  it.each([
    { verified: true },
    { realmId: "../foreign" },
    { realmId: "a".repeat(100_000) },
    { requestFingerprint: "A".repeat(64) },
    { requestFingerprint: "f".repeat(63) },
    { idempotencyKey: "" },
    { expectedConversationRevision: -1 },
    { expectedConversationRevision: Number.MAX_SAFE_INTEGER },
    { cancellationGeneration: NaN },
    { cancellationGeneration: Infinity },
    { cancellationGeneration: 0.1 },
    { cancellationGeneration: Number.MAX_SAFE_INTEGER },
    { operation: "delete_content" },
  ])("rejects invalid or additional descriptor fields %j", (patch) => {
    expect(
      parsePersonalCaptureDescriptor({ ...descriptor(), ...patch }).ok,
    ).toBe(false);
  });

  it("bounds bodies and requires one note followed by at most one attachment", () => {
    const d = descriptor();
    const [note, attachment] = d.parts;
    for (const parts of [
      [],
      [attachment],
      [attachment, note],
      [note, note],
      Array(3).fill(note),
      [{ ...note, sizeBytes: 65537 }],
      [note, { ...attachment, sizeBytes: 1048577 }],
      [{ ...note, sizeBytes: -1 }],
      [{ ...note, sizeBytes: 1.5 }],
      [{ ...note, mediaType: "text/html" }],
      [{ ...note, filename: "../escape" }],
      [note, { ...attachment, objectId: note.objectId }],
      [note, { ...attachment, partId: note.partId }],
    ])
      expect(parsePersonalCaptureDescriptor({ ...d, parts }).ok).toBe(false);
    expect(
      parsePersonalCaptureDescriptor({
        ...d,
        parts: [
          { ...note, sizeBytes: 65536 },
          { ...attachment, sizeBytes: 1048576 },
        ],
      }).ok,
    ).toBe(true);
    expect(
      parsePersonalCaptureDescriptor({
        ...d,
        parts: [{ ...note, sizeBytes: 0 }],
      }).ok,
    ).toBe(true);
  });

  it("rejects non-JSON records without invoking their getters or leaking field contents", () => {
    let invoked = false;
    const raw = { ...descriptor() };
    Object.defineProperty(raw, "realmId", {
      enumerable: true,
      get() {
        invoked = true;
        throw new Error("private");
      },
    });
    expect(parsePersonalCaptureDescriptor(raw).ok).toBe(false);
    expect(invoked).toBe(false);
    expect(parsePersonalCaptureDescriptor(Object.create(descriptor())).ok).toBe(
      false,
    );
    const parts = [...descriptor().parts];
    Object.defineProperty(parts, "0", {
      enumerable: true,
      get() {
        invoked = true;
        return descriptor().parts[0];
      },
    });
    expect(parsePersonalCaptureDescriptor({ ...descriptor(), parts }).ok).toBe(
      false,
    );
    expect(invoked).toBe(false);
    expect(
      parsePersonalCaptureDescriptor({ ...descriptor(), parts: Array(2) }).ok,
    ).toBe(false);
    expect(
      parsePersonalCaptureDescriptor({
        ...descriptor(),
        [Symbol("private")]: true,
      }).ok,
    ).toBe(false);
    const proxy = Proxy.revocable({}, {});
    proxy.revoke();
    expect(parsePersonalCaptureDescriptor(proxy.proxy)).toEqual({
      ok: false,
      error: "invalid wire value",
    });
    expect(
      parsePersonalCaptureDescriptor({
        ...descriptor(),
        privateContent: "secret",
      }),
    ).toEqual({ ok: false, error: "descriptor: invalid fields" });
  });
});

describe("object receipt binding and exact state shapes", () => {
  it("returns validated snapshots when live proxies change later property reads", () => {
    const source = descriptor();
    const descriptorProxy = changingProxy(source, "realmId", "../foreign");
    expect(parsePersonalCaptureDescriptor(descriptorProxy.value)).toEqual({
      ok: true,
      value: source,
    });
    expect(descriptorProxy.counts).toEqual({ gets: 0, descriptors: 1 });

    const partProxy = changingProxy(source.parts[0], "sha256", "not-a-digest");
    const partArrayProxy = changingProxy(
      [partProxy.value, source.parts[1]],
      "0",
      {},
    );
    const nested = parsePersonalCaptureDescriptor({
      ...source,
      parts: partArrayProxy.value,
    });
    expect(nested).toEqual({ ok: true, value: source });
    expect(partProxy.counts).toEqual({ gets: 0, descriptors: 1 });
    expect(partArrayProxy.counts).toEqual({ gets: 0, descriptors: 1 });

    const receipt = receipts()[0];
    const receiptProxy = changingProxy(receipt, "objectRevision", "../foreign");
    expect(parsePersonalObjectReceipt(receiptProxy.value)).toEqual({
      ok: true,
      value: receipt,
    });
    expect(receiptProxy.counts).toEqual({ gets: 0, descriptors: 1 });

    const cancelled = status("cancelled", 3);
    if (!("cancellation" in cancelled)) throw new Error("fixture");
    const cancellationProxy = changingProxy(
      cancelled.cancellation,
      "cancellationGeneration",
      -1,
    );
    const statusProxy = changingProxy(
      { ...cancelled, cancellation: cancellationProxy.value },
      "state",
      "committed",
    );
    expect(parsePersonalCaptureStatus(statusProxy.value)).toEqual({
      ok: true,
      value: cancelled,
    });
    expect(cancellationProxy.counts).toEqual({ gets: 0, descriptors: 1 });
    expect(statusProxy.counts).toEqual({ gets: 0, descriptors: 1 });
  });

  it("snapshots receipt arrays and array length without invoking proxy get traps", () => {
    const original = receipts();
    const receiptProxy = changingProxy(original[0], "realmId", "../foreign");
    const listProxy = changingProxy(
      [receiptProxy.value, original[1]],
      "length",
      Number.MAX_SAFE_INTEGER,
    );
    const staged = status("staged", 2);
    expect(
      parsePersonalCaptureStatus({ ...staged, receipts: listProxy.value }),
    ).toEqual({ ok: true, value: staged });
    expect(listProxy.counts).toEqual({ gets: 0, descriptors: 1 });
    expect(receiptProxy.counts).toEqual({ gets: 0, descriptors: 1 });
  });

  it("rejects an invalid captured value even when a subsequent read would be valid", () => {
    const proxy = changingProxy(
      { ...descriptor(), realmId: "../foreign" },
      "realmId",
      id(1),
    );
    expect(parsePersonalCaptureDescriptor(proxy.value).ok).toBe(false);
    expect(proxy.counts).toEqual({ gets: 0, descriptors: 1 });
  });

  it("matches exact immutable bytes and scope, including equal-size foreign objects", () => {
    const d = descriptor();
    const r = receipts(d)[1];
    expect(personalObjectReceiptMatches(d, r)).toBe(true);
    for (const patch of [
      { realmId: id(99) },
      { captureId: id(99) },
      { partId: id(99) },
      { objectId: id(99) },
      { objectRevision: id(99) },
      { sha256: hash("B".repeat(4096)) },
      { sizeBytes: 4095 },
      { requestFingerprint: "b".repeat(64) },
      { cancellationGeneration: 1 },
    ]) {
      const altered = { ...r, ...patch };
      expect(parsePersonalObjectReceipt(altered).ok).toBe(true);
      expect(personalObjectReceiptMatches(d, altered)).toBe(false);
      expect(
        parsePersonalCaptureStatus({
          ...status("staged"),
          receipts: [receipts(d)[0], altered],
        }).ok,
      ).toBe(false);
    }
    expect(parsePersonalObjectReceipt({ ...r, verified: true }).ok).toBe(false);
    expect(parsePersonalObjectReceipt({ ...r, sizeBytes: 1048577 }).ok).toBe(
      false,
    );
  });

  it("rejects incomplete, duplicate and excess receipts and premature saved fields", () => {
    for (const list of [
      [],
      receipts().slice(0, 1),
      [receipts()[0], receipts()[0]],
      [...receipts(), receipts()[0]],
    ]) {
      expect(
        parsePersonalCaptureStatus({ ...status("staged"), receipts: list }).ok,
      ).toBe(false);
    }
    expect(
      parsePersonalCaptureStatus({
        ...status("staged"),
        receipts: receipts().reverse(),
      }).ok,
    ).toBe(true);
    for (const raw of [
      { ...status("awaiting_bytes"), receipts: [] },
      { ...status("awaiting_bytes"), manifestId: id(12) },
      { ...status("staged"), manifestId: id(12) },
      { ...status("committed"), conversationRevision: 0 },
      { ...status("committed"), conversationRevision: 2 },
      { ...status("cancelled"), receipts: receipts() },
      { ...status("awaiting_bytes"), state: "saved" },
      { ...status("staged"), intentRevision: 0 },
    ])
      expect(parsePersonalCaptureStatus(raw).ok).toBe(false);
  });

  it("requires a separate terminal cancellation record, never a content deletion instruction", () => {
    const cancelled = status("cancelled", 3);
    if (!("cancellation" in cancelled)) throw new Error("fixture");
    expect(parsePersonalCaptureCancellation(cancelled.cancellation).ok).toBe(
      true,
    );
    for (const patch of [
      { realmId: id(99) },
      { captureId: id(99) },
      { intentRevision: 2 },
      { cancellationGeneration: 0 },
      { cancellationGeneration: 2 },
      { requestFingerprint: "b".repeat(64) },
      { purpose: "delete_content" },
      { verified: true },
    ])
      expect(
        parsePersonalCaptureStatus({
          ...cancelled,
          cancellation: { ...cancelled.cancellation, ...patch },
        }).ok,
      ).toBe(false);
  });
});

describe("idempotency and CAS preconditions", () => {
  it("has stable canonical request input independent of JSON field order and assigned IDs", () => {
    const d = descriptor();
    const reversed = Object.fromEntries(Object.entries(d).reverse());
    expect(personalCaptureFingerprintInput(d)).toEqual(
      personalCaptureFingerprintInput(reversed),
    );
    expect(
      personalCaptureFingerprintInput({
        ...d,
        captureId: id(99),
        messageId: id(98),
      }),
    ).toEqual(personalCaptureFingerprintInput(d));
    const input = personalCaptureFingerprintInput(d);
    // Independent Python hashlib/json fixture pins the cross-language wire encoding.
    expect(input.ok && hash(input.value)).toBe(
      "f0ebdd013c900c71983ade3acce349567145e123aeafa0c5300afa88d890e6e8",
    );
    expect(comparePersonalCaptureRetry(d, reversed)).toBe("same_intent");
  });

  it("rejects changed payload even if the caller reuses the claimed fingerprint", () => {
    const d = descriptor();
    const changed = {
      ...d,
      parts: [d.parts[0], { ...d.parts[1], sha256: hash("B".repeat(4096)) }],
    };
    expect(comparePersonalCaptureRetry(d, changed)).toBe("conflict");
    expect(personalCaptureFingerprintInput(d)).not.toEqual(
      personalCaptureFingerprintInput(changed),
    );
    for (const patch of [
      { captureId: id(99) },
      { conversationId: id(99) },
      { messageId: id(99) },
      { expectedConversationRevision: 1 },
      { cancellationGeneration: 1 },
      { requestFingerprint: "b".repeat(64) },
    ]) {
      expect(comparePersonalCaptureRetry(d, { ...d, ...patch })).toBe(
        "conflict",
      );
    }
    expect(comparePersonalCaptureRetry(d, { ...d, realmId: id(99) })).toBe(
      "different_scope",
    );
    expect(
      comparePersonalCaptureRetry(d, { ...d, idempotencyKey: id(99) }),
    ).toBe("different_scope");
    expect(comparePersonalCaptureRetry(d, null)).toBe("invalid");
  });

  it.each(["partId", "objectId", "objectRevision"] as const)(
    "conflicts on an independently changed %s",
    (field) => {
      const original = descriptor();
      for (let index = 0; index < original.parts.length; index += 1) {
        const parts = original.parts.map((part, i) =>
          i === index ? { ...part, [field]: id(99) } : part,
        );
        const retry = { ...original, parts };
        expect(parsePersonalCaptureDescriptor(retry).ok).toBe(true);
        expect(comparePersonalCaptureRetry(original, retry)).toBe("conflict");
      }
    },
  );

  it("bounds the final safe revision increment without rounding or overflow", () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    expect(
      evaluatePersonalCaptureTransition(
        status("staged", maximum - 1),
        status("committed", maximum),
        maximum - 1,
      ),
    ).toBe("eligible");
    expect(
      evaluatePersonalCaptureTransition(
        status("staged", maximum),
        status("committed", maximum),
        maximum,
      ),
    ).toBe("revision_conflict");
    expect(
      evaluatePersonalCaptureTransition(
        status("staged", maximum),
        status("committed", maximum + 1),
        maximum,
      ),
    ).toBe("invalid");
    const d = {
      ...descriptor(),
      expectedConversationRevision: maximum - 1,
      cancellationGeneration: maximum - 1,
    };
    expect(
      parsePersonalCaptureStatus({
        ...status("committed", maximum),
        descriptor: d,
        receipts: receipts(d),
        conversationRevision: maximum,
      }).ok,
    ).toBe(true);
    expect(
      parsePersonalCaptureDescriptor({
        ...d,
        expectedConversationRevision: maximum,
      }).ok,
    ).toBe(false);
    expect(
      parsePersonalCaptureDescriptor({ ...d, cancellationGeneration: maximum })
        .ok,
    ).toBe(false);
    const cancelled = status("cancelled", maximum);
    if (!("cancellation" in cancelled)) throw new Error("fixture");
    expect(
      parsePersonalCaptureStatus({
        ...cancelled,
        descriptor: d,
        cancellation: {
          ...cancelled.cancellation,
          cancellationGeneration: maximum,
        },
      }).ok,
    ).toBe(true);
  });

  it.each(["committed", "cancelled"] as const)(
    "rejects every transition out of terminal %s",
    (current) => {
      for (const proposed of [
        "awaiting_bytes",
        "staged",
        "committed",
        "cancelled",
      ] as const) {
        expect(
          evaluatePersonalCaptureTransition(
            status(current, 3),
            status(proposed, 4),
            3,
          ),
        ).toBe("terminal");
      }
    },
  );

  it("allows only publication via staged and terminal cancellation from either pending state", () => {
    expect(
      evaluatePersonalCaptureTransition(
        status("awaiting_bytes"),
        status("staged", 2),
        1,
      ),
    ).toBe("eligible");
    expect(
      evaluatePersonalCaptureTransition(
        status("staged", 2),
        status("committed", 3),
        2,
      ),
    ).toBe("eligible");
    for (const state of ["awaiting_bytes", "staged"] as const) {
      expect(
        evaluatePersonalCaptureTransition(
          status(state),
          status("cancelled", 2),
          1,
        ),
      ).toBe("eligible");
    }
    expect(
      evaluatePersonalCaptureTransition(
        status("awaiting_bytes"),
        status("committed", 2),
        1,
      ),
    ).toBe("invalid_transition");
    expect(
      evaluatePersonalCaptureTransition(
        status("staged"),
        status("awaiting_bytes", 2),
        1,
      ),
    ).toBe("invalid_transition");
    expect(
      evaluatePersonalCaptureTransition(
        status("staged"),
        status("staged", 2),
        1,
      ),
    ).toBe("invalid_transition");
  });

  it("requires current revision and cannot publish after cancellation or cancel after publication", () => {
    expect(
      evaluatePersonalCaptureTransition(
        status("staged", 2),
        status("committed", 3),
        1,
      ),
    ).toBe("revision_conflict");
    expect(
      evaluatePersonalCaptureTransition(
        status("staged", 2),
        status("committed", 4),
        2,
      ),
    ).toBe("revision_conflict");
    expect(
      evaluatePersonalCaptureTransition(
        status("cancelled", 3),
        status("committed", 4),
        3,
      ),
    ).toBe("terminal");
    expect(
      evaluatePersonalCaptureTransition(
        status("committed", 3),
        status("cancelled", 4),
        3,
      ),
    ).toBe("terminal");
    expect(
      evaluatePersonalCaptureTransition(
        status("staged"),
        {
          ...status("committed", 2),
          descriptor: { ...descriptor(), realmId: id(99) },
          receipts: receipts({ ...descriptor(), realmId: id(99) }),
        },
        1,
      ),
    ).toBe("intent_mismatch");
    expect(
      evaluatePersonalCaptureTransition(null, status("committed"), 1),
    ).toBe("invalid");
  });
});

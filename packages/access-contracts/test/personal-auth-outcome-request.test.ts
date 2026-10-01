import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parsePersonalAuthOwnerOutcomeRequest as parse,
  parsePersonalAuthOwnerOutcomeRequestJson as raw,
  personalAuthOwnerOutcomeRequestMatchesSameGenerationLease as matches,
} from "../src/personal-auth-outcome-request.js";
const vectors = JSON.parse(
  readFileSync(
    new URL("./fixtures/personal-auth-outcome-request.json", import.meta.url),
    "utf8",
  ),
) as {
  cases: {
    name: string;
    request: any;
    lease: any;
    parse: boolean;
    match: boolean;
  }[];
};
const sample = vectors.cases[0]!;
describe("proposed owner outcome request", () => {
  it.each(vectors.cases)("$name", (v) => {
    expect(parse(v.request).ok).toBe(v.parse);
    expect(raw(JSON.stringify(v.request)).ok).toBe(v.parse);
    expect(matches(v.request, v.lease)).toBe(v.match);
  });
  it("rejects each extra field, version/profile drift and invalid ID", () => {
    for (const field of ["verified", "authority", "grant_id", "operation_id"])
      expect(parse({ ...sample.request, [field]: true }).ok).toBe(false);
    for (const field of [
      "wire_version",
      "profile_id",
      "request_id",
      "idempotency_key",
      "lease_id",
    ])
      for (const value of [null, "", "OTHER", 0])
        expect(parse({ ...sample.request, [field]: value }).ok).toBe(false);
  });
  it("does not invoke accessors, accept hidden fields or leak hostile input", () => {
    let invoked = false;
    for (const key of Object.keys(sample.request)) {
      const input = { ...sample.request };
      Object.defineProperty(input, key, {
        enumerable: true,
        get() {
          invoked = true;
          throw new Error("PRIVATE");
        },
      });
      expect(parse(input)).toEqual({
        ok: false,
        error: "invalid personal owner outcome request",
      });
    }
    expect(invoked).toBe(false);
    const hidden = { ...sample.request };
    Object.defineProperty(hidden, "private", { value: "PRIVATE" });
    expect(parse(hidden).ok).toBe(false);
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(parse(proxy).ok).toBe(false);
    expect(matches(proxy, sample.lease)).toBe(false);
  });
  it("returns detached structures", () => {
    const input = structuredClone(sample.request);
    const result = parse(input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    input.participant.boot_id = "changed";
    input.outcome.capture_status.descriptor.parts[0].sha256 = "changed";
    expect(result.value).toEqual(sample.request);
  });
  it("raw decoder rejects duplicate keys and noncanonical number spellings", () => {
    const text = JSON.stringify(sample.request);
    expect(raw(text).ok).toBe(true);
    expect(
      raw(
        text.replace(
          '"lease_id":',
          '"lease_id":"00000000-0000-4000-8000-000000000001","lease_id":',
        ),
      ).ok,
    ).toBe(false);
    for (const bad of ["-0", "0.0", "0e0"])
      expect(
        raw(
          text.replace(
            '"expectedConversationRevision":0',
            '"expectedConversationRevision":' + bad,
          ),
        ).ok,
      ).toBe(false);
  });
  it("requires sole-writer role except separately configured repair owner", () => {
    for (const v of vectors.cases.slice(0, 7)) {
      const r = structuredClone(v.request),
        l = structuredClone(v.lease);
      r.participant.role =
        r.participant.role === "product" ? "disk" : "product";
      l.participant.role = r.participant.role;
      expect(parse(r).ok).toBe(v.request.outcome.kind === "link_repaired");
      expect(matches(r, l)).toBe(v.request.outcome.kind === "link_repaired");
    }
  });
  it("exposes its limit: operation/intent/resource are absent from lease", () => {
    for (const [index, field, value] of [
      [0, "operation_id", "00000000-0000-4000-8000-000000000063"],
      [5, "intent_id", "00000000-0000-4000-8000-000000000063"],
      [0, "resource_binding_digest", "b".repeat(64)],
    ] as const) {
      const v = vectors.cases[index]!,
        r = structuredClone(v.request);
      r.outcome[field] = value;
      expect(matches(r, v.lease)).toBe(true); // Auth must resolve these separately.
    }
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PERSONAL_AUTH_PROFILE,
  PERSONAL_AUTH_WIRE_VERSION,
  parseBoundedJson,
  parsePersonalCaptureBinding,
  personalCaptureResourceMatches,
} from "../src/index.js";

const fixtures = JSON.parse(
  readFileSync(
    new URL("./fixtures/personal-auth-capture-v1.json", import.meta.url),
    "utf8",
  ),
) as {
  wire_version: string;
  profile_id: string;
  cases: {
    name: string;
    realmId: string;
    resource: Record<string, unknown>;
    binding: { descriptor: Record<string, unknown>; status: unknown };
    expected: boolean;
  }[];
};
const sample = fixtures.cases[0]!;

describe("personal authorization capture binding", () => {
  it("pins the candidate version and synthetic profile", () => {
    expect(fixtures.wire_version).toBe(PERSONAL_AUTH_WIRE_VERSION);
    expect(fixtures.profile_id).toBe(PERSONAL_AUTH_PROFILE);
  });
  it.each(fixtures.cases)(
    "$name",
    ({ realmId, resource, binding, expected }) => {
      expect(personalCaptureResourceMatches(realmId, resource, binding)).toBe(
        expected,
      );
    },
  );
  it("snapshots detached descriptor and status values", () => {
    const input = structuredClone(sample.binding);
    const parsed = parsePersonalCaptureBinding(input);
    expect(parsed.ok).toBe(true);
    input.descriptor["messageId"] = "changed";
    if (parsed.ok)
      expect(parsed.value.descriptor.messageId).toBe(
        sample.binding.descriptor["messageId"],
      );
  });
  it("refuses binding unknown fields, getters and throwing proxies without disclosure", () => {
    const secret = "private-input";
    const inputs = [
      { ...sample.binding, verified: true },
      Object.create(sample.binding),
      {
        descriptor: sample.binding.descriptor,
        get status() {
          throw new Error(secret);
        },
      },
      new Proxy(
        {},
        {
          ownKeys() {
            throw new Error(secret);
          },
        },
      ),
      null,
      [],
      undefined,
    ];
    for (const input of inputs) {
      const result = parsePersonalCaptureBinding(input);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(
        personalCaptureResourceMatches(sample.realmId, sample.resource, input),
      ).toBe(false);
    }
  });
  it("does not invoke selector accessors or directly read a mutable proxy", () => {
    let gets = 0;
    const resource = new Proxy(sample.resource, {
      get() {
        gets++;
        throw new Error("unexpected read");
      },
    });
    expect(
      personalCaptureResourceMatches(sample.realmId, resource, sample.binding),
    ).toBe(true);
    expect(gets).toBe(0);
    const accessor = { ...sample.resource };
    Object.defineProperty(accessor, "object_id", {
      enumerable: true,
      get() {
        gets++;
      },
    });
    expect(
      personalCaptureResourceMatches(sample.realmId, accessor, sample.binding),
    ).toBe(false);
    expect(gets).toBe(0);
  });
  it("checks and returns the same descriptor snapshot when proxy values change", () => {
    let reads = 0;
    const descriptor = new Proxy(sample.binding.descriptor, {
      getOwnPropertyDescriptor(target, key) {
        const value = Reflect.getOwnPropertyDescriptor(target, key);
        if (key !== "messageId" || value === undefined) return value;
        reads++;
        return reads === 1 ? value : { ...value, value: "substituted" };
      },
    });
    const result = parsePersonalCaptureBinding({
      descriptor,
      status: sample.binding.status,
    });
    expect(result.ok).toBe(true);
    expect(reads).toBe(1);
    if (result.ok)
      expect(result.value.descriptor.messageId).toBe(
        sample.binding.descriptor["messageId"],
      );
  });
  it("refuses sparse, accessor, extra-key arrays and nested unknown fields", () => {
    const intent = fixtures.cases[1]!;
    const parts = intent.resource["parts"] as unknown[];
    const sparse = [...parts];
    delete sparse[0];
    const extra = Object.assign([...parts], { verified: true });
    const accessor = [...parts];
    Object.defineProperty(accessor, "0", {
      enumerable: true,
      get() {
        throw new Error("private");
      },
    });
    for (const value of [
      sparse,
      extra,
      accessor,
      [{ ...(parts[0] as object), extra: true }, parts[1]],
    ]) {
      expect(
        personalCaptureResourceMatches(
          intent.realmId,
          { ...intent.resource, parts: value },
          intent.binding,
        ),
      ).toBe(false);
    }
  });
  it("uses the shared transport decoder to reject duplicate decoded binding keys", () => {
    const raw = new TextEncoder().encode(
      '{"descriptor":null,"descr\\u0069ptor":{}}',
    );
    expect(() => parseBoundedJson(raw)).toThrow("Invalid bounded JSON");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  comparePersonalAuthLeaseAdmission,
  parsePersonalAuthLeaseAdmission,
  parsePersonalAuthReleaseUnit,
} from "../src/personal-auth-lease-v1.js";

const fixtures = JSON.parse(
  readFileSync(
    new URL("./fixtures/personal-auth-lease-v1.json", import.meta.url),
    "utf8",
  ),
) as {
  cases: { name: string; input: Record<string, unknown>; expected: boolean }[];
};
const sample = fixtures.cases[0]!.input;

describe("personal Auth issued lease structure", () => {
  it.each(fixtures.cases)("$name", ({ input, expected }) => {
    expect(parsePersonalAuthLeaseAdmission(input).ok).toBe(expected);
  });
  it("compares a current expected snapshot independently of property order", () => {
    const reordered = Object.fromEntries(Object.entries(sample).reverse());
    expect(comparePersonalAuthLeaseAdmission(sample, reordered)).toBe(
      "same_admission",
    );
  });
  it("rejects every substituted valid identity, epoch, deadline or delivery binding", () => {
    const changedId = "00000000-0000-4000-8000-000000000063";
    for (const key of [
      "lease_id",
      "flow_id",
      "grant_id",
      "realm_id",
      "resource_binding_id",
    ])
      expect(
        comparePersonalAuthLeaseAdmission(sample, {
          ...sample,
          [key]: changedId,
        }),
      ).toBe("conflict");
    for (const key of [
      "policy_epoch",
      "participant_config_version",
      "admitted_seq",
    ])
      expect(
        comparePersonalAuthLeaseAdmission(sample, { ...sample, [key]: "2" }),
      ).toBe("conflict");
    expect(
      comparePersonalAuthLeaseAdmission(sample, {
        ...sample,
        execute_before: "2001-01-01T00:00:00.999Z",
      }),
    ).toBe("conflict");
    const unit = sample["release_unit"] as Record<string, unknown>;
    for (const key of [
      "delivery_id",
      "object_revision",
      "representation_binding_id",
      "destination_binding_id",
    ])
      expect(
        comparePersonalAuthLeaseAdmission(sample, {
          ...sample,
          release_unit: { ...unit, [key]: changedId },
        }),
      ).toBe("conflict");
    for (const key of ["frame_index", "length_bytes", "offset_bytes"])
      expect(
        comparePersonalAuthLeaseAdmission(sample, {
          ...sample,
          release_unit: { ...unit, [key]: 1 },
        }),
      ).toBe("conflict");
    const participant = sample["participant"] as Record<string, unknown>;
    for (const key of ["participant_id", "boot_id"])
      expect(
        comparePersonalAuthLeaseAdmission(sample, {
          ...sample,
          participant: { ...participant, [key]: changedId },
        }),
      ).toBe("conflict");
    for (const key of ["process_generation", "deployment_generation"])
      expect(
        comparePersonalAuthLeaseAdmission(sample, {
          ...sample,
          participant: { ...participant, [key]: "2" },
        }),
      ).toBe("conflict");
  });
  it("keeps an expired admission rather than manufacturing settlement", () => {
    const result = parsePersonalAuthLeaseAdmission(sample);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.state).toBe("admitted");
    expect(
      comparePersonalAuthLeaseAdmission(sample, {
        ...sample,
        state: "settled",
      }),
    ).toBe("invalid");
  });
  it("rejects negative zero in every release integer", () => {
    const unit = sample["release_unit"] as Record<string, unknown>;
    for (const key of ["frame_index", "offset_bytes", "length_bytes"])
      expect(parsePersonalAuthReleaseUnit({ ...unit, [key]: -0 }).ok).toBe(
        false,
      );
  });
  it("never invokes accessors or reads a proxy property directly", () => {
    let gets = 0;
    const proxy = new Proxy(sample, {
      get() {
        gets++;
        throw new Error("private");
      },
    });
    expect(parsePersonalAuthLeaseAdmission(proxy).ok).toBe(true);
    expect(gets).toBe(0);
    const accessor = { ...sample };
    Object.defineProperty(accessor, "participant", {
      enumerable: true,
      get() {
        gets++;
      },
    });
    expect(parsePersonalAuthLeaseAdmission(accessor).ok).toBe(false);
    expect(gets).toBe(0);
  });
  it("captures nested participant and unit properties once into detached records", () => {
    const input = structuredClone(sample);
    const participant = input["participant"] as Record<string, unknown>;
    let reads = 0;
    input["participant"] = new Proxy(participant, {
      getOwnPropertyDescriptor(target, key) {
        const property = Reflect.getOwnPropertyDescriptor(target, key);
        if (key !== "process_generation" || property === undefined)
          return property;
        reads++;
        return reads === 1 ? property : { ...property, value: "999" };
      },
    });
    const result = parsePersonalAuthLeaseAdmission(input);
    expect(result.ok).toBe(true);
    expect(reads).toBe(1);
    participant["process_generation"] = "888";
    (input["release_unit"] as Record<string, unknown>)["length_bytes"] = 123;
    if (result.ok) {
      expect(result.value.participant.process_generation).toBe("1");
      if (result.value.lease_kind === "release")
        expect(result.value.release_unit.length_bytes).toBe(0);
    }
  });
  it("refuses hidden/symbol fields and nested unknown fields without disclosing input", () => {
    const hidden = { ...sample };
    Object.defineProperty(hidden, "private", { value: "secret" });
    const symbol = { ...sample, [Symbol("private")]: "secret" };
    const nested = {
      ...sample,
      release_unit: { ...(sample["release_unit"] as object), url: "private" },
    };
    const throwing = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("private-secret");
        },
      },
    );
    for (const input of [
      hidden,
      symbol,
      nested,
      throwing,
      null,
      [],
      undefined,
    ]) {
      const result = parsePersonalAuthLeaseAdmission(input);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain("private");
    }
  });
});

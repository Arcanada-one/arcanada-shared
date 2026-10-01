import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  comparePersonalAuthOwnerOutcome,
  parsePersonalAuthOwnerOutcome,
  personalAuthOwnerOutcomeEffect,
} from "../src/personal-auth-owner-outcome.js";

const vectors = JSON.parse(
  readFileSync(
    new URL("./fixtures/personal-auth-owner-outcome.json", import.meta.url),
    "utf8",
  ),
) as {
  cases: { name: string; input: Record<string, unknown>; expected: boolean }[];
};
const samples = vectors.cases
  .filter((x) => x.name.endsWith(" valid"))
  .map((x) => x.input);
const differentId = "00000000-0000-4000-8000-000000000063";
function reorder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reorder);
  if (typeof value === "object" && value !== null)
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, child]) => [key, reorder(child)]),
    );
  return value;
}

describe("personal owner outcome structure", () => {
  it.each(vectors.cases)("$name", ({ input, expected }) => {
    expect(parsePersonalAuthOwnerOutcome(input).ok).toBe(expected);
  });
  it("keeps source effect names without returning authority", () => {
    const effects = [
      "intent_create",
      "intent_stage",
      "disk_stage",
      "product_publish",
      "intent_cancel",
      "repair_link",
      "cleanup_cancelled",
    ];
    samples.forEach((sample, index) =>
      expect(personalAuthOwnerOutcomeEffect(sample)).toEqual({
        ok: true,
        value: effects[index],
      }),
    );
    expect(
      personalAuthOwnerOutcomeEffect({ ...samples[0], kind: "constructor" }).ok,
    ).toBe(false);
  });
  it("compares every detached field independently of object key order", () => {
    for (const sample of samples) {
      expect(comparePersonalAuthOwnerOutcome(sample, reorder(sample))).toBe(
        "same_outcome",
      );
      for (const key of ["participant_id", "operation_id", "owner_commit_id"])
        expect(
          comparePersonalAuthOwnerOutcome(sample, {
            ...sample,
            [key]: differentId,
          }),
        ).toBe("conflict");
      for (const key of [
        "deployment_generation",
        "process_generation",
        "local_seq",
      ])
        expect(
          comparePersonalAuthOwnerOutcome(sample, { ...sample, [key]: "2" }),
        ).toBe("conflict");
      expect(
        comparePersonalAuthOwnerOutcome(sample, {
          ...sample,
          resource_binding_digest: "d".repeat(64),
        }),
      ).toBe("conflict");
      expect(
        comparePersonalAuthOwnerOutcome(sample, {
          ...sample,
          owner_receipt_id: differentId,
        }),
      ).toBe("different_receipt");
      expect(
        comparePersonalAuthOwnerOutcome(sample, { ...sample, kind: "unknown" }),
      ).toBe("invalid");
    }
    expect(comparePersonalAuthOwnerOutcome(samples[0], samples[1])).toBe(
      "conflict",
    );
  });
  it("retains exact storage and cleanup vector order for retries", () => {
    const staged = samples[1]!;
    const ids = staged["storage_receipt_ids"] as string[];
    expect(
      comparePersonalAuthOwnerOutcome(staged, {
        ...staged,
        storage_receipt_ids: [...ids].reverse(),
      }),
    ).toBe("conflict");
    const cleanup = samples[6]!;
    const objects = cleanup["cleaned_objects"] as unknown[];
    expect(
      comparePersonalAuthOwnerOutcome(cleanup, {
        ...cleanup,
        cleaned_objects: [...objects].reverse(),
      }),
    ).toBe("conflict");
  });
  it("does not authenticate selectors or invent missing context", () => {
    const repaired = samples[5]!;
    // No ParticipantRef, configured link owner or authenticated commit is in this record.
    expect(
      parsePersonalAuthOwnerOutcome({
        ...repaired,
        participant_id: differentId,
        committed_owner_outcome_id: differentId,
      }).ok,
    ).toBe(true);
    // Existing safe decoded OwnerCounter semantics; raw transport still requires strict JSON.
    expect(
      parsePersonalAuthOwnerOutcome({ ...repaired, link_revision: -0 }).ok,
    ).toBe(true);
    expect(
      comparePersonalAuthOwnerOutcome(repaired, {
        ...repaired,
        link_revision: -0,
      }),
    ).toBe("same_outcome");
  });
  it("snapshots without invoking getters or direct Proxy reads", () => {
    let reads = 0;
    const sample = samples[1]!;
    const proxy = new Proxy(sample, {
      get() {
        reads++;
        throw new Error("private");
      },
    });
    expect(parsePersonalAuthOwnerOutcome(proxy).ok).toBe(true);
    expect(reads).toBe(0);
    const accessor = { ...sample };
    Object.defineProperty(accessor, "kind", {
      enumerable: true,
      get() {
        reads++;
        return "intent_staged";
      },
    });
    expect(parsePersonalAuthOwnerOutcome(accessor).ok).toBe(false);
    expect(reads).toBe(0);
    expect(
      parsePersonalAuthOwnerOutcome(
        new Proxy(sample, {
          ownKeys() {
            throw new Error("private");
          },
        }),
      ).ok,
    ).toBe(false);
    expect(
      parsePersonalAuthOwnerOutcome(
        new Proxy(sample, {
          getPrototypeOf() {
            throw new Error("private");
          },
        }),
      ).ok,
    ).toBe(false);
  });
  it("rejects sparse, accessor, symbol and hidden-key arrays", () => {
    const cleanup = samples[6]!;
    for (const field of ["cleaned_objects", "storage_receipt_ids"]) {
      const sample = field === "cleaned_objects" ? cleanup : samples[1]!;
      const original = sample[field] as unknown[];
      const sparse = [...original];
      delete sparse[0];
      const hidden = [...original];
      Object.defineProperty(hidden, "private", { value: 1 });
      const symbol = [...original];
      Object.defineProperty(symbol, Symbol("private"), { value: 1 });
      const accessor = [...original];
      Object.defineProperty(accessor, "0", {
        enumerable: true,
        get() {
          throw new Error("private");
        },
      });
      for (const value of [sparse, hidden, symbol, accessor])
        expect(
          parsePersonalAuthOwnerOutcome({ ...sample, [field]: value }).ok,
        ).toBe(false);
    }
  });
  it("detaches nested capture, object and cleanup records", () => {
    for (const sample of samples) {
      const input = structuredClone(sample);
      const result = parsePersonalAuthOwnerOutcome(input);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const before = JSON.stringify(result.value);
      for (const child of Object.values(input)) {
        if (Array.isArray(child)) child.splice(0);
        else if (typeof child === "object" && child !== null)
          Object.assign(child, { realmId: differentId, kind: "bad" });
      }
      expect(JSON.stringify(result.value)).toBe(before);
    }
  });
});

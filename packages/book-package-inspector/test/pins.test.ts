import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PINS } from "../src/index.js";
import { loadDir, VENDOR, verdicts } from "./support.js";

const here = dirname(fileURLToPath(import.meta.url));
const gitBlob = (b: Uint8Array): string =>
  createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");
const pinned = JSON.parse(
  readFileSync(join(here, "fixtures", "pinned-blobs.json"), "utf8"),
) as Record<string, string>;

describe("vendored bytes equal the pinned knowledge-contract commit", () => {
  it("names the pinned commit, schema and checker", () => {
    expect(PINS.knowledge_contract_commit).toBe(
      "e351df0c28f0b9965a580f45b48a297d1872c3ce",
    );
    expect(PINS.schema_blob).toBe("fd721e6f610547ab5ac3748dcbde76f14c3b0899");
    expect(PINS.checker_blob).toBe("0221e4ad301ecccf0868019c4c2575120a71b16c");
    expect(verdicts.pins).toEqual({
      commit: PINS.knowledge_contract_commit,
      schema_blob: PINS.schema_blob,
      checker_blob: PINS.checker_blob,
    });
  });

  it("the vendored schema is byte-identical to the pinned blob", () => {
    const bytes = new Uint8Array(
      readFileSync(join(VENDOR, "schemas", "book-package.schema.json")),
    );
    expect(gitBlob(bytes)).toBe(PINS.schema_blob);
  });

  it("every vendored fixture is byte-identical to its pinned blob, and no pinned fixture is missing or extra", () => {
    const files = loadDir(VENDOR);
    const vendored = new Map<string, string>();
    for (const [rel, bytes] of files) vendored.set(rel, gitBlob(bytes));
    expect(Object.fromEntries([...vendored].sort())).toEqual(pinned);
    expect(Object.keys(pinned).length).toBe(91);
    void relative;
  });
});

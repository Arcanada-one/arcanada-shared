import {
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inspectBookPackage } from "../src/index.js";
import { readPackageDirectory } from "../src/node.js";
import { FIXTURES } from "./support.js";

describe("readPackageDirectory", () => {
  it("reads a package directory and the inspector passes it", () => {
    const r = inspectBookPackage(
      readPackageDirectory(join(FIXTURES, "valid", "synthetic-rle-primer")),
    );
    expect(r.verdict).toBe("pass");
  });

  it("does not follow a symlink: the linked component is reported missing, like the checker's safe_file", () => {
    const tmp = mkdtempSync(join(tmpdir(), "bpi-"));
    try {
      const src = join(FIXTURES, "valid", "synthetic-rle-primer");
      const files = readPackageDirectory(src);
      for (const [rel, bytes] of files) {
        if (rel === "readable.md") continue;
        mkdirSync(join(tmp, rel, ".."), { recursive: true });
        writeFileSync(join(tmp, rel), bytes);
      }
      symlinkSync(join(src, "readable.md"), join(tmp, "readable.md"));
      const r = inspectBookPackage(readPackageDirectory(tmp));
      expect(r.verdict).toBe("refused");
      expect(r.refusals.map((x) => x.code)).toEqual(["component_missing"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("refuses to read an unbounded directory", () => {
    expect(() =>
      readPackageDirectory(join(FIXTURES, "valid"), { maxFiles: 3 }),
    ).toThrow(RangeError);
  });
});

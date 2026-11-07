import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkOnSnapshot } from "../src/agree.js";
import { readPackageDirectoryReport } from "../src/node.js";

let work: string;
let pkg: string;
const sha = (b: Uint8Array | string): string =>
  createHash("sha256").update(b).digest("hex");

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "bpi-ag-"));
  pkg = join(work, "pkg-test-1");
  mkdirSync(pkg);
  writeFileSync(join(pkg, "a.txt"), "alpha");
  writeFileSync(join(pkg, "b.txt"), "bravo");
});
afterEach(() => rmSync(work, { recursive: true, force: true }));

/** A stand-in checker that judges exactly the directory it is given and reports what it saw. */
function fakeChecker(seen: { dir?: string; hashes?: Record<string, string> }) {
  return (dir: string) => {
    seen.dir = dir;
    seen.hashes = {
      "a.txt": sha(readFileSync(join(dir, "a.txt"))),
      "b.txt": sha(readFileSync(join(dir, "b.txt"))),
    };
    return { agreement: { checker_exit: 0, checker_passed: true } };
  };
}

describe("R-BPI-AGREE: the checker judges the inspector's bytes", () => {
  it("unchanged control: checker runs on a private copy with the same leaf name, hashes verified before and after, copy removed", () => {
    const read = readPackageDirectoryReport(pkg).files;
    const seen: { dir?: string; hashes?: Record<string, string> } = {};
    const { agreement } = checkOnSnapshot(read, pkg, fakeChecker(seen));
    expect(seen.dir).not.toBe(pkg);
    expect(basename(seen.dir as string)).toBe("pkg-test-1");
    expect(seen.hashes).toEqual({
      "a.txt": sha("alpha"),
      "b.txt": sha("bravo"),
    });
    const snap = agreement["snapshot"] as Record<string, unknown>;
    expect(snap["verified_before"]).toBe(true);
    expect(snap["verified_after"]).toBe(true);
    expect(snap["file_sha256"]).toEqual(seen.hashes);
    expect(agreement["checker_passed"]).toBe(true);
    expect(existsSync(seen.dir as string)).toBe(false);
  });

  it("the original directory changing between the inspector read and the checker read does not change what the checker sees", () => {
    const read = readPackageDirectoryReport(pkg).files;
    const seen: { dir?: string; hashes?: Record<string, string> } = {};
    const { agreement } = checkOnSnapshot(read, pkg, fakeChecker(seen), {
      beforeChecker: () => writeFileSync(join(pkg, "a.txt"), "MUTATED"),
    });
    expect(seen.hashes?.["a.txt"]).toBe(sha("alpha"));
    expect(agreement["verdict"]).toBeUndefined(); // not downgraded: the judged bytes are intact
    expect(
      (agreement["snapshot"] as Record<string, unknown>)["verified_after"],
    ).toBe(true);
  });

  it("the copy changed before the checker starts → NOT_MEASURED, checker not run", () => {
    const read = readPackageDirectoryReport(pkg).files;
    let ran = false;
    const { agreement } = checkOnSnapshot(
      read,
      pkg,
      () => {
        ran = true;
        return { agreement: {} };
      },
      { beforeChecker: (d) => writeFileSync(join(d, "b.txt"), "tampered") },
    );
    expect(agreement["verdict"]).toBe("NOT_MEASURED");
    expect(String(agreement["reason"])).toContain(
      "snapshot_changed_before_checker",
    );
    expect(ran).toBe(false);
  });

  it("the copy changed while/after the checker ran → NOT_MEASURED, never AGREE", () => {
    const read = readPackageDirectoryReport(pkg).files;
    const { agreement } = checkOnSnapshot(read, pkg, fakeChecker({}), {
      afterChecker: (d) => writeFileSync(join(d, "a.txt"), "tampered"),
    });
    expect(agreement["verdict"]).toBe("NOT_MEASURED");
    expect(String(agreement["reason"])).toContain(
      "snapshot_changed_during_checker",
    );
  });

  it("a file added to the copy → NOT_MEASURED", () => {
    const read = readPackageDirectoryReport(pkg).files;
    const { agreement } = checkOnSnapshot(read, pkg, fakeChecker({}), {
      afterChecker: (d) => writeFileSync(join(d, "extra.txt"), "x"),
    });
    expect(agreement["verdict"]).toBe("NOT_MEASURED");
    expect(String(agreement["reason"])).toContain("file set changed");
  });
});

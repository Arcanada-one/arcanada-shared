import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Deterministic race injection that does not depend on the implementation's own hooks: the node:fs entry points the reader uses
 * are wrapped, and a trap fires once at a named point. The old reader (lstatSync then readFileSync) is exposed at its lstat; the
 * descriptor reader is exposed at its open and at its first read. Both run the identical trap.
 */
const spy = vi.hoisted(() => ({
  trap: null as null | {
    kinds: string[];
    match: string;
    action: () => void;
    fired: boolean;
  },
  requested: [] as number[],
}));

vi.mock("node:fs", async (orig) => {
  const real = await orig<typeof import("node:fs")>();
  const fire = (kind: string, target: string): void => {
    const t = spy.trap;
    if (t && !t.fired && t.kinds.includes(kind) && target.endsWith(t.match)) {
      t.fired = true;
      t.action();
    }
  };
  return {
    ...real,
    lstatSync: (...a: Parameters<typeof real.lstatSync>) => {
      const r = real.lstatSync(...a);
      fire("lstat", String(a[0]));
      return r;
    },
    openSync: (...a: Parameters<typeof real.openSync>) => {
      fire("open", String(a[0]));
      return real.openSync(...a);
    },
    readSync: (...a: unknown[]) => {
      let target = "";
      try {
        target = real.readlinkSync(`/proc/self/fd/${String(a[0])}`);
      } catch {
        /* not a descriptor path */
      }
      fire("read", target);
      spy.requested.push(a[3] as number);
      return (real.readSync as (...x: unknown[]) => number)(...a);
    },
  };
});

const { readPackageDirectoryReport, ReadRefusal } =
  await import("../src/node.js");

let work: string;
let pkg: string;
let outside: string;
const SECRET = "OUTSIDE-SECRET-BYTES";
const text = (b: Uint8Array | undefined): string =>
  b === undefined ? "<absent>" : Buffer.from(b).toString("utf8");

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "bpi-rb-"));
  pkg = join(work, "pkg");
  outside = join(work, "outside");
  mkdirSync(join(pkg, "sub"), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(pkg, "a.txt"), "alpha-original");
  writeFileSync(join(pkg, "sub", "b.txt"), "bravo-original");
  writeFileSync(join(outside, "secret.txt"), SECRET);
  writeFileSync(join(outside, "b.txt"), SECRET);
  spy.trap = null;
  spy.requested = [];
});
afterEach(() => {
  spy.trap = null;
  rmSync(work, { recursive: true, force: true });
});

const arm = (kinds: string[], match: string, action: () => void): void => {
  spy.trap = { kinds, match, action, fired: false };
};
const refusalCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(RangeError);
    return e instanceof ReadRefusal ? e.code : "untyped";
  }
  return "no_refusal";
};
const noLeak = (files: Map<string, Uint8Array>): void => {
  for (const b of files.values()) expect(text(b)).not.toContain(SECRET);
};

describe("R-BPI-READ1: one open, no redirection by a swapped path", () => {
  it("unchanged controls: regular files and a subdirectory are read byte-exact", () => {
    const r = readPackageDirectoryReport(pkg);
    expect(text(r.files.get("a.txt"))).toBe("alpha-original");
    expect(text(r.files.get("sub/b.txt"))).toBe("bravo-original");
    expect(r.skipped).toEqual([]);
  });

  it("a file swapped for a symlink between the type check and the read is not followed", () => {
    arm(["lstat", "open"], "/a.txt", () => {
      rmSync(join(pkg, "a.txt"));
      symlinkSync(join(outside, "secret.txt"), join(pkg, "a.txt"));
    });
    const r = readPackageDirectoryReport(pkg);
    expect(spy.trap?.fired).toBe(true);
    noLeak(r.files);
    expect(r.files.has("a.txt")).toBe(false);
    expect(r.skipped.map((s) => s.path)).toContain("a.txt");
  });

  it("a parent directory swapped for a symlink after the walk entered it does not redirect the read", () => {
    arm(["lstat", "open"], "/b.txt", () => {
      renameSync(join(pkg, "sub"), join(pkg, "sub.moved"));
      symlinkSync(outside, join(pkg, "sub"));
    });
    const r = readPackageDirectoryReport(pkg);
    expect(spy.trap?.fired).toBe(true);
    noLeak(r.files);
    // The walk keeps reading the directory it actually opened.
    expect(text(r.files.get("sub/b.txt"))).toBe("bravo-original");
  });

  it("a subdirectory that is already a symlink is not descended", () => {
    rmSync(join(pkg, "sub"), { recursive: true });
    symlinkSync(outside, join(pkg, "sub"));
    const r = readPackageDirectoryReport(pkg);
    noLeak(r.files);
    expect([...r.files.keys()]).toEqual(["a.txt"]);
  });

  it("a FIFO is skipped without blocking", () => {
    execFileSync("mkfifo", [join(pkg, "pipe")]);
    const r = readPackageDirectoryReport(pkg);
    expect(r.files.has("pipe")).toBe(false);
    expect(r.skipped.map((s) => s.path)).toContain("pipe");
  });

  it("a root given as a symlink is resolved once and read", () => {
    const link = join(work, "rootlink");
    symlinkSync(pkg, link);
    const r = readPackageDirectoryReport(link);
    expect(r.root_realpath).toBe(pkg);
    expect(text(r.files.get("a.txt"))).toBe("alpha-original");
  });
});

describe("R-BPI-READ2: limits are charged on bytes actually read", () => {
  it("a file that grows after its size was taken is a typed refusal", () => {
    arm(["lstat", "read"], "/a.txt", () =>
      appendFileSync(join(pkg, "a.txt"), "-GROWN"),
    );
    expect(refusalCode(() => readPackageDirectoryReport(pkg))).toBe(
      "read_file_grew",
    );
  });

  it("a file that shrinks after its size was taken is a typed refusal", () => {
    arm(["lstat", "read"], "/a.txt", () => truncateSync(join(pkg, "a.txt"), 3));
    expect(refusalCode(() => readPackageDirectoryReport(pkg))).toBe(
      "read_file_shrunk",
    );
  });

  it("growth that crosses the cumulative budget is refused (actual bytes, not the earlier stat)", () => {
    writeFileSync(join(pkg, "a.txt"), Buffer.alloc(50, 1));
    writeFileSync(join(pkg, "sub", "b.txt"), Buffer.alloc(40, 2));
    arm(["lstat", "read"], "/b.txt", () =>
      appendFileSync(join(pkg, "sub", "b.txt"), Buffer.alloc(50, 3)),
    );
    expect(
      refusalCode(() =>
        readPackageDirectoryReport(pkg, { maxBytes: 100, maxFileBytes: 1000 }),
      ),
    ).toBe("read_total_too_large");
  });

  it("limit+1 bytes is refused; exactly the limit is read (controls both sides)", () => {
    writeFileSync(join(pkg, "a.txt"), Buffer.alloc(64, 1));
    rmSync(join(pkg, "sub"), { recursive: true });
    const ok = readPackageDirectoryReport(pkg, { maxFileBytes: 64 });
    expect(ok.files.get("a.txt")?.length).toBe(64);
    expect(ok.observed.bytes).toBe(64);
    writeFileSync(join(pkg, "a.txt"), Buffer.alloc(65, 1));
    expect(
      refusalCode(() => readPackageDirectoryReport(pkg, { maxFileBytes: 64 })),
    ).toBe("read_file_too_large");
  });

  it("an over-limit growth stops reading at limit+1: nothing further is requested or allocated", () => {
    writeFileSync(join(pkg, "a.txt"), Buffer.alloc(10, 1));
    rmSync(join(pkg, "sub"), { recursive: true });
    arm(["lstat", "read"], "/a.txt", () =>
      appendFileSync(join(pkg, "a.txt"), Buffer.alloc(4_000_000, 9)),
    );
    expect(
      refusalCode(() => readPackageDirectoryReport(pkg, { maxFileBytes: 100 })),
    ).toBe("read_file_too_large");
    expect(spy.requested.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(101);
  });

  it("the cumulative budget counts every file, and file-count is typed", () => {
    writeFileSync(join(pkg, "a.txt"), Buffer.alloc(60, 1));
    writeFileSync(join(pkg, "sub", "b.txt"), Buffer.alloc(60, 1));
    expect(
      refusalCode(() => readPackageDirectoryReport(pkg, { maxBytes: 100 })),
    ).toBe("read_total_too_large");
    expect(
      refusalCode(() => readPackageDirectoryReport(pkg, { maxFiles: 1 })),
    ).toBe("read_too_many_files");
    expect(existsSync(pkg)).toBe(true);
  });

  it("observed.bytes is the sum of bytes actually read", () => {
    const r = readPackageDirectoryReport(pkg);
    expect(r.observed.bytes).toBe(
      "alpha-original".length + "bravo-original".length,
    );
    expect(r.observed.largest_file?.bytes).toBe(14);
  });
});

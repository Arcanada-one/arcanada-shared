/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inspectBookPackage } from "../src/index.js";
import {
  DEFAULT_READ_LIMITS,
  readPackageDirectory,
  readPackageDirectoryReport,
} from "../src/node.js";
import { validPackage } from "./support.js";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array | undefined): string => new TextDecoder().decode(b);
const gitBlob = (b: Uint8Array): string =>
  createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");

function withReceipts(
  rightsClasses: Record<string, unknown>,
): Map<string, Uint8Array> {
  const out = new Map(validPackage("synthetic-rle-primer"));
  for (const [name, rc] of Object.entries(rightsClasses))
    out.set(
      `receipts/${name}.json`,
      enc(
        JSON.stringify(
          { schema: "PipelineStageReceipt/v1", stage: name, rights_class: rc },
          null,
          2,
        ) + "\n",
      ),
    );
  return out;
}

describe("rights determinations (each with provenance, never merged)", () => {
  it("agreeing fixture: manifest and receipts name the same class; every entry carries file, field path and blob", () => {
    const files = withReceipts({
      "01-intake": "author_open",
      "02-classify": "author_open",
    });
    const r = inspectBookPackage(files);
    expect(r.verdict).toBe("pass");
    const p = r.projection!;
    const manifest = JSON.parse(dec(files.get("manifest.json")));
    const rows = p.rights_determinations;
    const m = rows.find(
      (x) =>
        x.file === "manifest.json" && x.field_path === "/rights/license_class",
    )!;
    expect(m.value).toBe(manifest.rights.license_class);
    expect(m.source_kind).toBe("manifest");
    expect(m.file_git_blob).toBe(gitBlob(files.get("manifest.json")!));
    const receipts = rows.filter((x) => x.source_kind === "stage_receipt");
    expect(receipts.map((x) => x.file)).toEqual([
      "receipts/01-intake.json",
      "receipts/02-classify.json",
    ]);
    for (const x of receipts) {
      expect(x.field_path).toBe("/rights_class");
      expect(x.value).toBe("author_open");
      expect(x.file_git_blob).toBe(gitBlob(files.get(x.file)!));
    }
    expect(p.rights_comparison.disagree).toBe(false);
    expect(p.rights_comparison.class_values).toEqual([
      manifest.rights.license_class,
    ]);
  });

  it("disagreeing fixture: receipt says unknown, manifest says a class; both listed, flagged, nothing resolved", () => {
    const files = withReceipts({
      "01-intake": "unknown",
      "06-kc-package": "unknown",
    });
    const r = inspectBookPackage(files);
    expect(r.verdict).toBe("pass");
    const p = r.projection!;
    const manifest = JSON.parse(dec(files.get("manifest.json")));
    expect(p.rights_comparison.disagree).toBe(true);
    expect([...p.rights_comparison.class_values].sort()).toEqual(
      ["unknown", manifest.rights.license_class].sort(),
    );
    expect(
      p.rights_determinations.map((x) => [x.file, x.value]),
    ).toContainEqual(["manifest.json", manifest.rights.license_class]);
    expect(
      p.rights_determinations.filter((x) => x.value === "unknown"),
    ).toHaveLength(2);
    // no merged / effective value anywhere in the projection or the result
    expect(JSON.stringify(r)).not.toMatch(/effective|resolved_rights/i);
    // the manifest's own value is unchanged
    expect(p.rights).toEqual(manifest.rights);
    expect(r.kc2_admission).toBe("not_measured");
  });

  it("an unreadable receipt is listed as unreadable, not guessed and not a refusal", () => {
    const files = withReceipts({ "01-intake": "unknown" });
    files.set("receipts/02-classify.json", enc("{not json"));
    const r = inspectBookPackage(files);
    expect(r.verdict).toBe("pass");
    expect(r.projection!.rights_unreadable.map((x) => x.file)).toEqual([
      "receipts/02-classify.json",
    ]);
  });
});

describe("declared read limits", () => {
  it("refuses a file above the per-file limit from its size, before reading it, and reports the limits used", () => {
    const tmp = mkdtempSync(join(tmpdir(), "bpi-lim-"));
    try {
      writeFileSync(join(tmp, "big.bin"), Buffer.alloc(2048));
      expect(() => readPackageDirectory(tmp, { maxFileBytes: 1024 })).toThrow(
        /per-file/,
      );
      const ok = readPackageDirectory(tmp, { maxFileBytes: 4096 });
      expect(ok.size).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("records the limits actually used and what was observed", () => {
    const tmp = mkdtempSync(join(tmpdir(), "bpi-lim-"));
    try {
      writeFileSync(join(tmp, "a.bin"), Buffer.alloc(10));
      const d = readPackageDirectoryReport(tmp);
      expect(d.limits_used).toEqual(DEFAULT_READ_LIMITS);
      expect(d.observed).toEqual({
        files: 1,
        bytes: 10,
        largest_file: { path: "a.bin", bytes: 10 },
      });
      const c = readPackageDirectoryReport(tmp, { maxFileBytes: 99 });
      expect(c.limits_used.maxFileBytes).toBe(99);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

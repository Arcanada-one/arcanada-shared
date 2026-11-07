import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inspectBookPackage, inspectRecord } from "../src/index.js";
import {
  applyOverlay,
  compare,
  FIXTURES,
  validPackage,
  verdicts,
} from "./support.js";

const rows: {
  kind: string;
  name: string;
  checker: string;
  inspector: string;
  agree: boolean;
  exactLocations: boolean;
  typed: string;
  reasons: string[];
}[] = [];
const summary = (xs: string[]): string =>
  xs.length === 0 ? "PASS" : `FAIL(${xs.length})`;

describe("inspector agrees with the pinned checker's recorded verdict on every KC fixture", () => {
  it("valid packages: both pass, and the projection is produced", () => {
    for (const [name, v] of Object.entries(verdicts.valid_packages)) {
      const r = inspectBookPackage(validPackage(name));
      const c = compare(v.problems, r.refusals);
      rows.push({
        kind: "valid package",
        name,
        checker: summary(v.problems),
        inspector: r.verdict === "pass" ? "PASS" : "REFUSED",
        agree: c.agree,
        exactLocations: c.exactLocations,
        typed: "-",
        reasons: c.reasons,
      });
      expect(v.problems, name).toEqual([]);
      expect(r.refusals, name).toEqual([]);
      expect(r.verdict).toBe("pass");
      expect(r.projection).not.toBeNull();
    }
  });

  it("valid anchor records: both accept", () => {
    for (const [name, v] of Object.entries(verdicts.valid_records)) {
      const rec = JSON.parse(
        readFileSync(join(FIXTURES, "valid", "anchors", name), "utf8"),
      );
      const r = inspectRecord(rec);
      const c = compare(v.errors, r);
      rows.push({
        kind: "valid record",
        name,
        checker: summary(v.errors),
        inspector: r.length === 0 ? "PASS" : "REFUSED",
        agree: c.agree,
        exactLocations: c.exactLocations,
        typed: "-",
        reasons: c.reasons,
      });
      expect(v.errors, name).toEqual([]);
      expect(r, name).toEqual([]);
    }
  });

  it("invalid records: each is refused with a typed schema reason at a location the checker also reports", () => {
    const names = Object.keys(verdicts.invalid_records);
    expect(names.length).toBe(68);
    for (const [name, v] of Object.entries(verdicts.invalid_records)) {
      const rec = JSON.parse(
        readFileSync(join(FIXTURES, "invalid", name), "utf8"),
      );
      const r = inspectRecord(rec);
      const c = compare(
        v.errors.map((e) => `<record>: ${e}`),
        r,
      );
      rows.push({
        kind: "invalid record",
        name,
        checker: summary(v.errors),
        inspector: r.length === 0 ? "PASS" : "REFUSED",
        agree: c.agree,
        exactLocations: c.exactLocations,
        typed: [...new Set(r.map((x) => x.code))].join(","),
        reasons: c.reasons,
      });
      expect(v.errors.length, `${name}: checker must refuse`).toBeGreaterThan(
        0,
      );
      expect(r.length, `${name}: inspector must refuse`).toBeGreaterThan(0);
      expect(new Set(r.map((x) => x.code)), name).toEqual(
        new Set(["schema_violation"]),
      );
      expect(c.reasons, name).toEqual([]);
    }
  });

  it("package mutants and controls: same verdict, same cross-file problems, comparable schema locations", () => {
    const names = Object.keys(verdicts.mutants);
    expect(names.length).toBeGreaterThanOrEqual(60);
    for (const [name, v] of Object.entries(verdicts.mutants)) {
      const r = inspectBookPackage(
        applyOverlay(validPackage(v.base), v.overlay),
      );
      const c = compare(v.problems, r.refusals);
      rows.push({
        kind: "package mutant",
        name,
        checker: summary(v.problems),
        inspector: r.verdict === "pass" ? "PASS" : "REFUSED",
        agree: c.agree,
        exactLocations: c.exactLocations,
        typed: [...new Set(r.refusals.map((x) => x.code))].join(","),
        reasons: c.reasons,
      });
      expect(v.problems.length, `${name}: checker must refuse`).toBeGreaterThan(
        0,
      );
      expect(r.verdict, name).toBe("refused");
      expect(r.projection, name).toBeNull();
      expect(c.reasons, name).toEqual([]);
    }
  });

  it("writes the agreement table when AGREEMENT_OUT is set", () => {
    expect(rows.length).toBeGreaterThan(130);
    expect(rows.filter((r) => !r.agree)).toEqual([]);
    if (process.env["AGREEMENT_OUT"])
      writeFileSync(
        process.env["AGREEMENT_OUT"],
        JSON.stringify(rows, null, 1),
      );
  });
});

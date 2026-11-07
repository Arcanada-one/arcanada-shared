import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  inspectBookPackage,
  parseStrictJson,
  StrictJsonError,
  type Refusal,
} from "../src/index.js";
import { validPackage } from "./support.js";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array | undefined): string => new TextDecoder().decode(b);
const sha = (b: Uint8Array): string =>
  createHash("sha256").update(b).digest("hex");
const codes = (rs: Refusal[]): string[] => rs.map((r) => r.code);

/** Edit one JSON file of the RLE primer and re-pin its digest in the manifest, so only the intended rule can fail. */
function rewrite(
  files: Map<string, Uint8Array>,
  name: "objects" | "relations" | "edits" | "quality",
  edit: (rows: any[]) => void,
): Map<string, Uint8Array> {
  const out = new Map(files);
  const manifest = JSON.parse(dec(out.get("manifest.json")));
  const path = manifest.components[name].path as string;
  let bytes: Uint8Array;
  if (name === "quality") {
    const q = JSON.parse(dec(out.get(path)));
    const box = [q];
    edit(box);
    bytes = enc(JSON.stringify(box[0], Object.keys(box[0]).sort(), 1) + "\n");
    bytes = enc(JSON.stringify(sortKeys(box[0]), null, 1) + "\n");
  } else {
    const rows = dec(out.get(path))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    edit(rows);
    bytes = enc(rows.map((r) => JSON.stringify(sortKeys(r))).join("\n") + "\n");
    manifest.components[name].count = rows.length;
  }
  out.set(path, bytes);
  manifest.components[name].sha256 = sha(bytes);
  out.set(
    "manifest.json",
    enc(JSON.stringify(sortKeys(manifest), null, 1) + "\n"),
  );
  return out;
}
function sortKeys(v: any): any {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, sortKeys(v[k])]),
    );
  return v;
}

describe("projection of a passing package", () => {
  const result = inspectBookPackage(validPackage("synthetic-rle-primer"));
  const p = result.projection!;

  it("passes with kc2_admission fixed to not_measured and the pins named", () => {
    expect(result.verdict).toBe("pass");
    expect(result.kc2_admission).toBe("not_measured");
    expect(result.pins.knowledge_contract_commit).toBe(
      "e351df0c28f0b9965a580f45b48a297d1872c3ce",
    );
    expect(result.limits.join(" ")).toMatch(
      /no Muneral run, stream epoch or native event identity/,
    );
    expect(p.manifest["kc2_admission"]).toBe("not_measured");
  });

  it("exposes exact package identity and component hashes, recomputed from the bytes", () => {
    const files = validPackage("synthetic-rle-primer");
    expect(p.package_identity.package_id).toBe("synthetic-rle-primer");
    expect(p.package_identity.manifest_sha256).toBe(
      sha(files.get("manifest.json")!),
    );
    expect(p.package_identity.declared_package_status).toBe("knowledge_ready");
    expect(p.package_identity.derived_package_status).toBe("knowledge_ready");
    expect(
      result.components
        .filter((c) => c.state !== "verified")
        .map((c) => [c.name, c.state]),
    ).toEqual([["asset:asset.fig2", "declared_missing"]]);
    expect(result.components.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        "document_md",
        "readable_md",
        "edits",
        "objects",
        "relations",
        "quality",
        "asset:asset.fig1",
      ]),
    );
    const objects = result.components.find((c) => c.name === "objects")!;
    expect(objects.observed_sha256).toBe(sha(files.get("objects.jsonl")!));
    expect(objects.declared_count).toBe(4);
  });

  it("projects manifest, objects, relations, edits, quality, rights and source work/edition", () => {
    expect(p.objects).toHaveLength(4);
    expect(p.relations).toHaveLength(2);
    expect(p.edits).toHaveLength(1);
    expect(p.quality["schema"]).toBe("KCBookQuality/v2");
    expect(p.work["work_id"]).toBe("work.synthetic-rle-primer");
    expect(p.edition["edition_id"]).toBe("ed.synthetic-rle-primer.en");
    expect(p.rights["license_class"]).toBe("author_open");
    expect(p.representation["integrity"]).toBe("verified");
  });

  it("lists every anchor with its owner, and relation endpoints with their resolution", () => {
    const expected =
      p.objects.reduce((n, o) => n + (o["evidence"] as unknown[]).length, 0) +
      p.relations.reduce((n, r) => n + (r["evidence"] as unknown[]).length, 0) +
      p.edits.length;
    expect(p.anchors.length).toBe(expected);
    expect(new Set(p.anchors.map((a) => a.owner))).toEqual(
      new Set(["object", "relation", "edit"]),
    );
    expect(
      p.anchors.every(
        (a) => a.anchor["source_sha256"] === p.representation["source_sha256"],
      ),
    ).toBe(true);
    expect(p.relation_endpoints.every((e) => e.from_known && e.to_known)).toBe(
      true,
    );
  });

  it("keeps reviewer and generation distinctions visible", () => {
    expect(p.provenance.review).toMatchObject({
      present: true,
      reviewer_type: "blind_agent",
      declared_independent: true,
      binds_current_bytes: true,
    });
    expect(p.provenance.relations.some((r) => r.generated)).toBe(true);
    expect(
      p.provenance.objects.some(
        (o) => o.origin === "author_statement" && !o.generated,
      ),
    ).toBe(true);
    expect(p.provenance.document_md_tool).toMatchObject({
      tool: "fixture-generator",
    });
  });

  it("is read-only: the input bytes are untouched and a second run is identical", () => {
    const files = validPackage("synthetic-rle-primer");
    const before = new Map([...files].map(([k, v]) => [k, sha(v)]));
    const a = inspectBookPackage(files);
    const b = inspectBookPackage(files);
    expect(new Map([...files].map(([k, v]) => [k, sha(v)]))).toEqual(before);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("accepts a plain record of bytes as well as a Map, and reports unlisted files without failing", () => {
    const files = validPackage("synthetic-rle-primer");
    const record = Object.fromEntries(files);
    record["notes/extra.txt"] = enc("not listed in the manifest");
    const r = inspectBookPackage(record);
    expect(r.verdict).toBe("pass");
    expect(r.projection!.unlisted_files).toEqual(["notes/extra.txt"]);
  });

  it("projects the public-domain primer with its evidence record intact", () => {
    const r = inspectBookPackage(
      validPackage("synthetic-public-domain-primer"),
    );
    expect(r.verdict).toBe("pass");
    expect(r.projection!.rights["license_class"]).toBe("public_domain");
    expect(r.projection!.rights["public_domain"]).toBeDefined();
  });
});

describe("mutation controls are refused with a typed, located reason", () => {
  it("one changed byte in an object (manifest not updated) -> component_digest_mismatch, and the table shows which component", () => {
    const files = validPackage("synthetic-rle-primer");
    const bytes = new Uint8Array(files.get("objects.jsonl")!);
    bytes[bytes.indexOf(0x52 /* R of "Run-length" */)] = 0x72;
    files.set("objects.jsonl", bytes);
    const r = inspectBookPackage(files);
    expect(r.verdict).toBe("refused");
    expect(codes(r.refusals)).toEqual(["component_digest_mismatch"]);
    expect(r.refusals[0]!.where).toBe("objects");
    expect(r.components.find((c) => c.name === "objects")!.state).toBe(
      "digest_mismatch",
    );
    expect(
      r.components.filter(
        (c) => c.state !== "verified" && c.state !== "declared_missing",
      ),
    ).toHaveLength(1);
    expect(r.projection).toBeNull();
  });

  it("the same change with the manifest digest repaired -> review_binding_mismatch (stale review stays visible)", () => {
    const files = rewrite(
      validPackage("synthetic-rle-primer"),
      "objects",
      (rows) => {
        rows[0].text = rows[0].text.replace("Run-length", "run-length");
      },
    );
    const r = inspectBookPackage(files);
    expect(r.verdict).toBe("refused");
    expect(codes(r.refusals)).toContain("review_binding_mismatch");
    expect(r.refusals.map((x) => x.message)).toContain(
      "semantic review objects_sha256 is not bound to the current package bytes",
    );
  });

  it("a broken relation endpoint -> relation_endpoint_unknown naming the relation", () => {
    const files = rewrite(
      validPackage("synthetic-rle-primer"),
      "relations",
      (rows) => {
        rows[0].to = "obj.nowhere";
      },
    );
    const r = inspectBookPackage(files);
    expect(r.verdict).toBe("refused");
    expect(
      r.refusals.find((x) => x.code === "relation_endpoint_unknown"),
    ).toMatchObject({
      where: "relation rel.def",
      message:
        "relation rel.def: to endpoint obj.nowhere is not an object of this package",
    });
  });

  it("a relation that points an object at itself -> relation_self_loop", () => {
    const files = rewrite(
      validPackage("synthetic-rle-primer"),
      "relations",
      (rows) => {
        rows[0].to = rows[0].from;
      },
    );
    expect(codes(inspectBookPackage(files).refusals)).toContain(
      "relation_self_loop",
    );
  });

  it("a missing anchor (object with no evidence) -> schema_violation located at that object's evidence", () => {
    const files = rewrite(
      validPackage("synthetic-rle-primer"),
      "objects",
      (rows) => {
        rows[0].evidence = [];
      },
    );
    const r = inspectBookPackage(files);
    expect(r.verdict).toBe("refused");
    expect(
      r.refusals.some(
        (x) =>
          x.code === "schema_violation" &&
          x.where === "objects:1" &&
          /evidence/.test(x.message),
      ),
    ).toBe(true);
  });

  it("an anchor that names another source hash -> anchor_mismatch", () => {
    const files = rewrite(
      validPackage("synthetic-rle-primer"),
      "objects",
      (rows) => {
        rows[0].evidence[0].source_sha256 = "0".repeat(64);
      },
    );
    expect(codes(inspectBookPackage(files).refusals)).toContain(
      "anchor_mismatch",
    );
  });

  it("a component absent from the bytes -> component_missing, visible in the table as missing", () => {
    const files = validPackage("synthetic-rle-primer");
    files.delete("readable.md");
    const r = inspectBookPackage(files);
    expect(codes(r.refusals)).toEqual(["component_missing"]);
    expect(r.components.find((c) => c.name === "readable_md")!.state).toBe(
      "missing",
    );
  });

  it("an asset whose bytes are changed -> asset_missing_or_digest_mismatch", () => {
    const files = validPackage("synthetic-rle-primer");
    files.set("assets/fig1.svg", enc("<svg/>"));
    expect(codes(inspectBookPackage(files).refusals)).toEqual([
      "asset_missing_or_digest_mismatch",
    ]);
  });

  it("an empty package is refused as manifest_missing", () => {
    const r = inspectBookPackage(new Map());
    expect(codes(r.refusals)).toEqual(["manifest_missing"]);
    expect(r.kc2_admission).toBe("not_measured");
  });

  it("a path-traversal component path cannot reach another file", () => {
    const files = validPackage("synthetic-rle-primer");
    const manifest = JSON.parse(dec(files.get("manifest.json")));
    manifest.components.readable_md.path = "../readable.md";
    files.set("manifest.json", enc(JSON.stringify(manifest)));
    const r = inspectBookPackage(files);
    expect(r.verdict).toBe("refused");
    expect(codes(r.refusals).every((c) => c === "schema_violation")).toBe(true);
  });

  it("a stale declared status (partial source declared knowledge_ready) is not accepted", () => {
    const files = validPackage("synthetic-rle-primer");
    const manifest = JSON.parse(dec(files.get("manifest.json")));
    manifest.representation.completeness = "partial";
    files.set("manifest.json", enc(JSON.stringify(manifest)));
    expect(inspectBookPackage(files).verdict).toBe("refused");
  });
});

describe("strict JSON reader", () => {
  it.each([
    ['{"a":1,"a":2}', "duplicate_member"],
    ["[NaN]", "non_finite"],
    ["[Infinity]", "non_finite"],
    ['"\\ud800"', "surrogate"],
    ["[1e999]", "overflow"],
    ["[9007199254740993]", "unsupported_number"],
    ["{", "syntax"],
    ["[1,]", "syntax"],
    ["01", "syntax"],
    ['"a\tb"', "syntax"],
    ["[] x", "syntax"],
    ["﻿[]", "syntax"],
  ])("refuses %s as %s", (text, kind) => {
    try {
      parseStrictJson(text);
      throw new Error("accepted");
    } catch (e) {
      expect(e).toBeInstanceOf(StrictJsonError);
      expect((e as StrictJsonError).kind).toBe(kind);
    }
  });

  it("accepts valid values, escapes and surrogate pairs", () => {
    expect(
      parseStrictJson('{"a":[1,2.5,-0,"\\ud83d\\ude00",null,true],"b":{}}'),
    ).toEqual({ a: [1, 2.5, -0, "😀", null, true], b: {} });
  });

  it("does not let __proto__ pollute", () => {
    const v = parseStrictJson('{"__proto__":{"x":1}}') as Record<
      string,
      unknown
    >;
    expect(({} as Record<string, unknown>)["x"]).toBeUndefined();
    expect(Object.keys(v)).toEqual(["__proto__"]);
  });
});
